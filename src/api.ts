import {
    getCacheKey,
    getFromCache,
    saveToCache,
    updateCacheWithComparison,
    clearOldCache,
    extractRateLimitInfo,
    getApiErrorMessage,
    convertSearchItemsToPRs,
    buildSearchQuery,
    buildSearchUrl,
    buildApiHeaders,
} from '../lib';

import type {
    PullRequest,
    RateLimitInfo,
    AllPRCounts,
    SearchResponse,
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
            allMergedPRs: cached.allMergedPRs
        };
    }

    const result = await fetchCopilotPRsWithSearchAPI(owner, repo, fromDate, toDate, token, signal, callbacks);

    // Save to cache (without comparison data initially)
    saveToCache(cacheKey, result.prs, result.rateLimitInfo);

    return { ...result, fromCache: false };
}

// Use Search API instead of REST API for better efficiency
// Search API allows filtering by date and author directly, reducing API calls significantly
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

    // Build search query for Copilot PRs within date range
    const query = buildSearchQuery(owner, repo, fromDate, toDate);

    const allPRs: PullRequest[] = [];
    let page = 1;
    const perPage = 100; // Search API max is 100
    let rateLimitInfo: RateLimitInfo | null = null;
    let totalCount = 0;
    let incompleteResults = false;

    // Update loading phase
    callbacks.updatePhase('Fetching Copilot PRs...', 'Searching for PRs created by Copilot Coding Agent');

    while (true) {
        const url = buildSearchUrl(query, perPage, page);

        const response = await fetch(url, { headers, signal });

        // Extract rate limit info from response
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

        // Store total_count from first response
        if (page === 1) {
            totalCount = searchResponse.total_count;
        }
        // Update incompleteResults on every page; any true value is preserved
        incompleteResults = incompleteResults || searchResponse.incomplete_results;

        if (items.length === 0) break;

        // Convert search results to PullRequest format
        const prs = convertSearchItemsToPRs(items);

        allPRs.push(...prs);

        // Update progress
        callbacks.updateProgress(allPRs.length, totalCount, `Fetched ${allPRs.length} of ${totalCount} Copilot PRs`);

        // Search API returns max 1000 results, check if we need more pages
        if (items.length < perPage || allPRs.length >= searchResponse.total_count) {
            break;
        }

        // Search API has a limit of 1000 results (10 pages of 100)
        if (page >= 10) {
            // If total_count exceeds 1000, warn the user about incomplete results
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

    // Check if GitHub API indicated incomplete results (e.g., due to timeouts)
    if (incompleteResults) {
        throw new Error(
            'Search results may be incomplete due to GitHub API limitations (timeouts or other issues). ' +
            'Please try again or narrow your date range for more reliable results.'
        );
    }

    return {
        prs: allPRs,
        rateLimitInfo,
    };
}

export interface ComparisonResult {
    allPRCounts: AllPRCounts;
    allMergedPRs: PullRequest[];
    rateLimitInfo: RateLimitInfo | null;
}

// Fetch comparison data (allPRCounts + allMergedPRs) on demand to save API calls.
// This is separated from the main fetch so that the initial search is fast and cheap.
export async function fetchComparisonData(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string,
    signal: AbortSignal,
): Promise<ComparisonResult> {
    const headers = buildApiHeaders(token);
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

    // Fetch counts and merged PRs in parallel
    const [countsResult, mergedResult] = await Promise.all([
        fetchAllPRCounts(owner, repo, fromDate, toDate, headers, null, signal),
        fetchAllMergedPRsData(owner, repo, fromDate, toDate, headers, signal),
    ]);

    const result: ComparisonResult = {
        allPRCounts: countsResult.counts,
        allMergedPRs: mergedResult.prs,
        rateLimitInfo: mergedResult.rateLimitInfo ?? countsResult.rateLimitInfo,
    };

    // Update existing cache entry with comparison data
    updateCacheWithComparison(cacheKey, result.allPRCounts, result.allMergedPRs, result.rateLimitInfo);

    return result;
}

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

    // Build search queries for total, merged, and open counts
    // Closed count is calculated as total - merged - open (avoids a 4th API call)
    const queries = [
        { key: 'total' as const, query: `repo:${owner}/${repo} is:pr created:${fromDate}..${toDate}` },
        { key: 'merged' as const, query: `repo:${owner}/${repo} is:pr is:merged created:${fromDate}..${toDate}` },
        { key: 'open' as const, query: `repo:${owner}/${repo} is:pr is:open created:${fromDate}..${toDate}` },
    ];

    const counts: AllPRCounts = { ...defaultCounts };
    // Track which queries succeeded to ensure correct closed calculation
    const succeeded = new Set<string>();

    try {
        // Execute all API calls in parallel using Promise.allSettled
        const results = await Promise.allSettled(
            queries.map(async ({ key, query }) => {
                const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
                const response = await fetch(url, { headers, signal });
                return { key, response };
            })
        );

        // Process results and extract rate limit info
        for (let i = 0; i < results.length; i++) {
            const result = results[i];

            if (result.status === 'rejected') {
                // If the request was aborted, rethrow to prevent caching incomplete data
                if (result.reason instanceof DOMException && result.reason.name === 'AbortError') {
                    throw result.reason;
                }
                console.warn(`Failed to fetch ${queries[i].key} PR count:`, result.reason);
                continue;
            }

            const { key, response } = result.value;

            // Extract rate limit info from response
            rateLimitInfo = extractRateLimitInfo(response.headers) ?? rateLimitInfo;

            if (!response.ok) {
                console.warn(`Failed to fetch ${key} PR count:`, response.status);
                continue;
            }

            const searchResponse: SearchResponse = await response.json();
            counts[key] = searchResponse.total_count;
            succeeded.add(key);
        }

        // Calculate closed count from total - merged - open (avoids a 4th API call)
        if (succeeded.has('total') && succeeded.has('merged') && succeeded.has('open')) {
            counts.closed = Math.max(0, counts.total - counts.merged - counts.open);
            succeeded.add('closed');
        }

        return { counts, rateLimitInfo };
    } catch (error) {
        // Propagate aborts so callers can avoid caching/displaying incomplete data
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
        }
        console.warn('Error fetching all PR counts:', error);
        return { counts: defaultCounts, rateLimitInfo };
    }
}
