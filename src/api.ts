import {
    getCacheKey,
    getFromCache,
    saveToCache,
    updateCacheWithComparison,
    clearOldCache,
    extractRateLimitInfo,
    getApiErrorMessage,
    convertSearchItemsToPRs,
    convertGraphQLPRs,
    convertGraphQLRateLimit,
    buildSearchQuery,
    buildSearchUrl,
    buildApiHeaders,
    GRAPHQL_COMBINED_QUERY,
    GRAPHQL_SEARCH_QUERY,
} from '../lib';

import type {
    PullRequest,
    RateLimitInfo,
    AllPRCounts,
    SearchResponse,
    GraphQLResponse,
    CombinedQueryData,
    SingleSearchQueryData,
} from '../lib';

// Callback interface for loading progress updates — avoids circular dependency with UI
export interface LoadingCallbacks {
    updatePhase: (phase: string, message: string) => void;
    updateProgress: (current: number, total: number, message: string) => void;
}

export interface FetchResult {
    prs: PullRequest[];
    rateLimitInfo: RateLimitInfo | null;
    fromCache: boolean;
    allPRCounts?: AllPRCounts;
    allMergedPRs?: PullRequest[];
}

// ============================================================================
// GraphQL Execution
// ============================================================================

const GRAPHQL_URL = 'https://api.github.com/graphql';

async function executeGraphQL<T>(
    query: string,
    variables: Record<string, unknown>,
    token: string,
    signal: AbortSignal,
): Promise<{ data: T }> {
    const response = await fetch(GRAPHQL_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        signal,
    });

    if (!response.ok) {
        if (response.status === 401) {
            throw new Error('Authentication failed. GitHub GraphQL API requires a valid Personal Access Token.');
        }
        if (response.status === 403) {
            throw new Error(
                'Access forbidden (HTTP 403). Your token may lack required permissions, ' +
                'or SSO authorization may be needed for this organization.'
            );
        }
        throw new Error(`GraphQL request failed: HTTP ${response.status}`);
    }

    const result: GraphQLResponse<T> = await response.json();

    if (result.errors?.length) {
        const messages = result.errors.map(e => e.message).join('; ');
        throw new Error(`GraphQL error: ${messages}`);
    }

    if (!result.data) {
        throw new Error('GraphQL response contained no data');
    }

    return { data: result.data };
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function fetchCopilotPRsWithCache(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string,
    signal: AbortSignal,
    callbacks: LoadingCallbacks
): Promise<FetchResult> {
    // Clean up old cache entries
    clearOldCache();

    // Include authentication status in cache key to prevent security issue
    // where cached data fetched with a token could be served when no token is provided
    const hasToken = Boolean(token);
    const cacheKey = getCacheKey(owner, repo, fromDate, toDate, hasToken);
    const cached = getFromCache(cacheKey);

    if (cached) {
        // Show brief loading phase for cache
        callbacks.updatePhase('Loading from cache...', 'Using cached data from previous request');
        return {
            prs: cached.data,
            rateLimitInfo: cached.rateLimitInfo,
            fromCache: true,
            allPRCounts: cached.allPRCounts,
            allMergedPRs: cached.allMergedPRs,
        };
    }

    if (token) {
        // GraphQL API: combined query includes Copilot PRs + all PR counts + all merged PRs
        const result = await fetchWithGraphQL(owner, repo, fromDate, toDate, token, signal, callbacks);
        saveToCache(cacheKey, result.prs, result.rateLimitInfo, result.allPRCounts, result.allMergedPRs);
        return { ...result, fromCache: false };
    } else {
        // REST Search API fallback for unauthenticated users
        const result = await fetchCopilotPRsWithSearchAPI(owner, repo, fromDate, toDate, token, signal, callbacks);

        // Fetch comparison data inline (counts + merged PRs)
        let allPRCounts: AllPRCounts | undefined;
        let allMergedPRs: PullRequest[] | undefined;
        try {
            callbacks.updatePhase('Fetching comparison data...', 'Loading repository statistics and merged PRs');
            const headers = buildApiHeaders(token);
            const [countsResult, mergedResult] = await Promise.all([
                fetchAllPRCounts(owner, repo, fromDate, toDate, headers, null, signal),
                fetchAllMergedPRsData(owner, repo, fromDate, toDate, headers, signal),
            ]);
            allPRCounts = countsResult.counts;
            allMergedPRs = mergedResult.prs;
            const latestRateLimitInfo = mergedResult.rateLimitInfo ?? countsResult.rateLimitInfo;
            if (latestRateLimitInfo) result.rateLimitInfo = latestRateLimitInfo;
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') throw error;
            console.warn('Failed to fetch comparison data:', error);
        }

        saveToCache(cacheKey, result.prs, result.rateLimitInfo, allPRCounts, allMergedPRs);
        return { ...result, fromCache: false, allPRCounts, allMergedPRs };
    }
}

// ============================================================================
// GraphQL Fetch (Primary Path — Authenticated)
// ============================================================================

// Combined GraphQL query: fetches Copilot PRs + all PR counts in a single request.
// First page uses aliased queries to get counts for free; subsequent pages use simple search.
async function fetchWithGraphQL(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string,
    signal: AbortSignal,
    callbacks: LoadingCallbacks
): Promise<{ prs: PullRequest[]; rateLimitInfo: RateLimitInfo | null; allPRCounts: AllPRCounts; allMergedPRs: PullRequest[] }> {
    const copilotQuery = buildSearchQuery(owner, repo, fromDate, toDate);
    const baseQuery = `repo:${owner}/${repo} is:pr created:${fromDate}..${toDate}`;
    const mergedAllQuery = `${baseQuery} is:merged`;
    const totalQuery = baseQuery;
    const mergedQuery = mergedAllQuery;
    const openQuery = `${baseQuery} is:open`;

    callbacks.updatePhase('Fetching via GraphQL API...', 'Combined query for Copilot PRs, repository statistics, and merged PRs');

    const allPRs: PullRequest[] = [];
    let rateLimitInfo: RateLimitInfo | null = null;
    let totalCount = 0;
    let allPRCounts: AllPRCounts = { total: 0, merged: 0, closed: 0, open: 0 };
    let allMergedPRs: PullRequest[] = [];
    let after: string | null = null;
    let page = 0;

    while (true) {
        page++;

        if (page === 1) {
            // First page: combined query with counts + all merged PRs (all in one request)
            const result = await executeGraphQL<CombinedQueryData>(
                GRAPHQL_COMBINED_QUERY,
                { copilotQuery, mergedAllQuery, totalQuery, mergedQuery, openQuery, first: 100, after },
                token, signal,
            );
            const data = result.data;
            totalCount = data.copilotPRs.issueCount;

            allPRCounts = {
                total: data.totalCount.issueCount,
                merged: data.mergedCount.issueCount,
                open: data.openCount.issueCount,
                closed: Math.max(0, data.totalCount.issueCount - data.mergedCount.issueCount - data.openCount.issueCount),
            };

            allMergedPRs = convertGraphQLPRs(data.allMergedPRs.nodes);

            rateLimitInfo = convertGraphQLRateLimit(data.rateLimit);
            allPRs.push(...convertGraphQLPRs(data.copilotPRs.nodes));

            if (!data.copilotPRs.pageInfo.hasNextPage) break;
            after = data.copilotPRs.pageInfo.endCursor;
        } else {
            // Subsequent pages: simple search query
            const result = await executeGraphQL<SingleSearchQueryData>(
                GRAPHQL_SEARCH_QUERY,
                { query: copilotQuery, first: 100, after },
                token, signal,
            );
            const data = result.data;
            rateLimitInfo = convertGraphQLRateLimit(data.rateLimit);
            allPRs.push(...convertGraphQLPRs(data.search.nodes));

            if (!data.search.pageInfo.hasNextPage) break;
            after = data.search.pageInfo.endCursor;
        }

        callbacks.updateProgress(allPRs.length, totalCount, `Fetched ${allPRs.length} of ${totalCount} Copilot PRs`);

        // Search API limit of 1000 results applies to GraphQL search too
        if (page >= 10) {
            if (totalCount > 1000) {
                throw new Error(
                    `Results truncated: Found ${totalCount} PRs, but only the first 1000 could be fetched due to GitHub Search API limitations. ` +
                    `The retrieved results cannot be displayed because the result set is incomplete. Please narrow your date range to see complete results.`
                );
            }
            break;
        }
    }

    return { prs: allPRs, rateLimitInfo, allPRCounts, allMergedPRs };
}

// ============================================================================
// REST Search API Fetch (Fallback — Unauthenticated)
// ============================================================================

async function fetchCopilotPRsWithSearchAPI(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string,
    signal: AbortSignal,
    callbacks: LoadingCallbacks
): Promise<{ prs: PullRequest[]; rateLimitInfo: RateLimitInfo | null }> {
    const headers = buildApiHeaders(token);
    const query = buildSearchQuery(owner, repo, fromDate, toDate);

    const allPRs: PullRequest[] = [];
    let page = 1;
    const perPage = 100;
    let rateLimitInfo: RateLimitInfo | null = null;
    let totalCount = 0;
    let incompleteResults = false;

    callbacks.updatePhase('Fetching Copilot PRs...', 'Searching for PRs created by Copilot Coding Agent');

    while (true) {
        const url = buildSearchUrl(query, perPage, page);
        const response = await fetch(url, { headers, signal });
        rateLimitInfo = extractRateLimitInfo(response.headers);

        if (!response.ok) {
            let responseBody: { message?: string; errors?: Array<{ message?: string }> } | undefined;
            if (response.status === 422) {
                try {
                    responseBody = await response.json();
                } catch {
                    // ignore parse errors
                }
            }
            throw new Error(getApiErrorMessage(response.status, rateLimitInfo, responseBody));
        }

        const searchResponse: SearchResponse = await response.json();
        const items = searchResponse.items;

        if (page === 1) {
            totalCount = searchResponse.total_count;
        }
        incompleteResults = incompleteResults || searchResponse.incomplete_results;

        if (items.length === 0) break;

        const prs = convertSearchItemsToPRs(items);
        allPRs.push(...prs);

        callbacks.updateProgress(allPRs.length, totalCount, `Fetched ${allPRs.length} of ${totalCount} Copilot PRs`);

        if (items.length < perPage || allPRs.length >= searchResponse.total_count) {
            break;
        }

        if (page >= 10) {
            if (totalCount > 1000) {
                throw new Error(
                    `Results truncated: Found ${totalCount} PRs, but only the first 1000 could be fetched due to GitHub Search API limitations. ` +
                    `The retrieved results cannot be displayed because the result set is incomplete. Please narrow your date range to see complete results.`
                );
            }
            break;
        }

        page++;
    }

    if (incompleteResults) {
        throw new Error(
            'Search results may be incomplete due to GitHub API limitations (timeouts or other issues). ' +
            'Please try again or narrow your date range for more reliable results.'
        );
    }

    return { prs: allPRs, rateLimitInfo };
}

// ============================================================================
// Comparison Data (Lazy-loaded)
// ============================================================================

export interface ComparisonResult {
    allPRCounts: AllPRCounts;
    allMergedPRs: PullRequest[];
    rateLimitInfo: RateLimitInfo | null;
}

// Fetch comparison data on demand: allPRCounts + allMergedPRs.
// Routes to GraphQL (1 request) or REST (4 requests) based on token availability.
export async function fetchComparisonData(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string,
    signal: AbortSignal,
): Promise<ComparisonResult> {
    const hasToken = Boolean(token);
    const cacheKey = getCacheKey(owner, repo, fromDate, toDate, hasToken);

    // Check if comparison data is already cached
    const cached = getFromCache(cacheKey);
    if (cached?.allPRCounts && cached?.allMergedPRs) {
        return {
            allPRCounts: cached.allPRCounts,
            allMergedPRs: cached.allMergedPRs,
            rateLimitInfo: cached.rateLimitInfo,
        };
    }

    if (token) {
        return fetchComparisonDataGraphQL(owner, repo, fromDate, toDate, token, signal, cacheKey, cached?.allPRCounts);
    } else {
        return fetchComparisonDataREST(owner, repo, fromDate, toDate, token, signal, cacheKey);
    }
}

// GraphQL: fetch comparison data efficiently.
// If counts are already cached (from initial combined query), only fetch merged PRs (1 request).
// Otherwise, use combined query to get both counts + merged PRs (1 request).
async function fetchComparisonDataGraphQL(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string,
    signal: AbortSignal,
    cacheKey: string,
    cachedCounts?: AllPRCounts,
): Promise<ComparisonResult> {
    const mergedQuery = `repo:${owner}/${repo} is:pr is:merged created:${fromDate}..${toDate}`;

    if (cachedCounts) {
        // Counts already available from initial query — just fetch merged PR details
        const result = await executeGraphQL<SingleSearchQueryData>(
            GRAPHQL_SEARCH_QUERY,
            { query: mergedQuery, first: 100, after: null },
            token, signal,
        );
        const allMergedPRs = convertGraphQLPRs(result.data.search.nodes);
        const rateLimitInfo = convertGraphQLRateLimit(result.data.rateLimit);

        updateCacheWithComparison(cacheKey, cachedCounts, allMergedPRs, rateLimitInfo);
        return { allPRCounts: cachedCounts, allMergedPRs, rateLimitInfo };
    } else {
        // Need both counts and merged PRs — reuse combined query structure
        const baseQuery = `repo:${owner}/${repo} is:pr created:${fromDate}..${toDate}`;
        const result = await executeGraphQL<CombinedQueryData>(
            GRAPHQL_COMBINED_QUERY,
            {
                copilotQuery: mergedQuery,
                mergedAllQuery: mergedQuery,
                totalQuery: baseQuery,
                mergedQuery: `${baseQuery} is:merged`,
                openQuery: `${baseQuery} is:open`,
                first: 100,
                after: null,
            },
            token, signal,
        );

        const allMergedPRs = convertGraphQLPRs(result.data.allMergedPRs.nodes);
        const rateLimitInfo = convertGraphQLRateLimit(result.data.rateLimit);
        const allPRCounts: AllPRCounts = {
            total: result.data.totalCount.issueCount,
            merged: result.data.mergedCount.issueCount,
            open: result.data.openCount.issueCount,
            closed: Math.max(0, result.data.totalCount.issueCount - result.data.mergedCount.issueCount - result.data.openCount.issueCount),
        };

        updateCacheWithComparison(cacheKey, allPRCounts, allMergedPRs, rateLimitInfo);
        return { allPRCounts, allMergedPRs, rateLimitInfo };
    }
}

// REST: fetch comparison data (4 API calls: 3 counts + 1 merged list)
async function fetchComparisonDataREST(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string,
    signal: AbortSignal,
    cacheKey: string,
): Promise<ComparisonResult> {
    const headers = buildApiHeaders(token);

    const [countsResult, mergedResult] = await Promise.all([
        fetchAllPRCounts(owner, repo, fromDate, toDate, headers, null, signal),
        fetchAllMergedPRsData(owner, repo, fromDate, toDate, headers, signal),
    ]);

    const result: ComparisonResult = {
        allPRCounts: countsResult.counts,
        allMergedPRs: mergedResult.prs,
        rateLimitInfo: mergedResult.rateLimitInfo ?? countsResult.rateLimitInfo,
    };

    updateCacheWithComparison(cacheKey, result.allPRCounts, result.allMergedPRs, result.rateLimitInfo);
    return result;
}

// ============================================================================
// REST Helper Functions (used by REST fallback paths)
// ============================================================================

// Fetch all merged PRs in the date range (all authors) for response time comparison.
// Limited to first page (100 items) to conserve API calls.
async function fetchAllMergedPRsData(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    headers: HeadersInit,
    signal: AbortSignal,
): Promise<{ prs: PullRequest[]; rateLimitInfo: RateLimitInfo | null }> {
    const query = `repo:${owner}/${repo} is:pr is:merged created:${fromDate}..${toDate}`;
    const perPage = 100;

    try {
        const url = buildSearchUrl(query, perPage, 1);
        const response = await fetch(url, { headers, signal });
        const rateLimitInfo = extractRateLimitInfo(response.headers);

        if (!response.ok) {
            console.warn('Failed to fetch all merged PRs:', response.status);
            return { prs: [], rateLimitInfo };
        }

        const searchResponse: SearchResponse = await response.json();
        const prs = convertSearchItemsToPRs(searchResponse.items);
        return { prs, rateLimitInfo };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
        }
        console.warn('Error fetching all merged PRs:', error);
        return { prs: [], rateLimitInfo: null };
    }
}

// Fetch counts of all PRs in the repository within the date range (all authors)
async function fetchAllPRCounts(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    headers: HeadersInit,
    existingRateLimitInfo: RateLimitInfo | null,
    signal: AbortSignal
): Promise<{ counts: AllPRCounts; rateLimitInfo: RateLimitInfo | null }> {
    const defaultCounts: AllPRCounts = { total: 0, merged: 0, closed: 0, open: 0 };
    let rateLimitInfo = existingRateLimitInfo;

    const queries = [
        { key: 'total' as const, query: `repo:${owner}/${repo} is:pr created:${fromDate}..${toDate}` },
        { key: 'merged' as const, query: `repo:${owner}/${repo} is:pr is:merged created:${fromDate}..${toDate}` },
        { key: 'open' as const, query: `repo:${owner}/${repo} is:pr is:open created:${fromDate}..${toDate}` },
    ];

    const counts: AllPRCounts = { ...defaultCounts };
    const succeeded = new Set<string>();

    try {
        const results = await Promise.allSettled(
            queries.map(async ({ key, query }) => {
                const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
                const response = await fetch(url, { headers, signal });
                return { key, response };
            })
        );

        for (let i = 0; i < results.length; i++) {
            const result = results[i];

            if (result.status === 'rejected') {
                if (result.reason instanceof DOMException && result.reason.name === 'AbortError') {
                    throw result.reason;
                }
                console.warn(`Failed to fetch ${queries[i].key} PR count:`, result.reason);
                continue;
            }

            const { key, response } = result.value;
            rateLimitInfo = extractRateLimitInfo(response.headers) ?? rateLimitInfo;

            if (!response.ok) {
                console.warn(`Failed to fetch ${key} PR count:`, response.status);
                continue;
            }

            const searchResponse: SearchResponse = await response.json();
            counts[key] = searchResponse.total_count;
            succeeded.add(key);
        }

        if (succeeded.has('total') && succeeded.has('merged') && succeeded.has('open')) {
            counts.closed = Math.max(0, counts.total - counts.merged - counts.open);
            succeeded.add('closed');
        }

        return { counts, rateLimitInfo };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
        }
        console.warn('Error fetching all PR counts:', error);
        return { counts: defaultCounts, rateLimitInfo };
    }
}
