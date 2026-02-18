// ============================================================================
// Pure/testable functions extracted from app.ts
// ============================================================================
// These functions contain no DOM dependencies and can be unit tested directly.

// ============================================================================
// Type Definitions
// ============================================================================

export interface GitHubUser {
    login?: string;
}

export interface PullRequest {
    id: number;
    number: number;
    title: string | null;
    state: 'open' | 'closed';
    merged_at: string | null;
    created_at: string;
    user: GitHubUser | null;
    html_url: string | null;
}

export interface PRsByDate {
    [date: string]: {
        merged: number;
        closed: number;
        open: number;
    };
}

export interface StatusConfig {
    class: string;
    icon: string;
    text: string;
}

export interface StatusConfigMap {
    merged: StatusConfig;
    closed: StatusConfig;
    open: StatusConfig;
}

export interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
    used: number;
}

export interface AllPRCounts {
    total: number;
    merged: number;
    closed: number;
    open: number;
}

export interface CacheEntry {
    data: PullRequest[];
    timestamp: number;
    rateLimitInfo: RateLimitInfo | null;
    allPRCounts?: AllPRCounts;
    allMergedPRs?: PullRequest[];
}

export interface SearchResponse {
    total_count: number;
    incomplete_results: boolean;
    items: SearchIssueItem[];
}

export interface SearchIssueItem {
    id: number;
    number: number;
    title: string | null;
    state: 'open' | 'closed';
    created_at: string;
    user: GitHubUser | null;
    html_url: string | null;
    pull_request?: {
        merged_at: string | null;
    };
}

// ============================================================================
// GraphQL Types
// ============================================================================

export interface GraphQLResponse<T> {
    data?: T;
    errors?: Array<{ message: string; type?: string; path?: string[] }>;
}

export interface GraphQLRateLimit {
    limit: number;
    remaining: number;
    resetAt: string;
    cost: number;
    used: number;
}

export interface GraphQLSearchResult {
    issueCount: number;
    pageInfo: {
        hasNextPage: boolean;
        endCursor: string | null;
    };
    nodes: GraphQLPullRequest[];
}

export interface GraphQLPullRequest {
    databaseId: number;
    number: number;
    title: string | null;
    state: 'OPEN' | 'CLOSED' | 'MERGED';
    createdAt: string;
    mergedAt: string | null;
    url: string;
    author: { login: string } | null;
}

export interface CombinedQueryData {
    copilotPRs: GraphQLSearchResult;
    allMergedPRs: GraphQLSearchResult;
    totalCount: { issueCount: number };
    mergedCount: { issueCount: number };
    openCount: { issueCount: number };
    rateLimit: GraphQLRateLimit;
}

export interface SingleSearchQueryData {
    search: GraphQLSearchResult;
    rateLimit: GraphQLRateLimit;
}

// ============================================================================
// Constants
// ============================================================================

export const ITEMS_PER_PAGE = 10;
export const CACHE_KEY_PREFIX = 'copilot_pr_cache_';
export const CACHE_VERSION = 'v3';
export const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
export const CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

// ============================================================================
// GraphQL Utilities
// ============================================================================

/**
 * Converts GraphQL PullRequest nodes to internal PullRequest format.
 * GraphQL state MERGED/CLOSED both map to state:'closed'; merged_at distinguishes them.
 */
export function convertGraphQLPRs(nodes: GraphQLPullRequest[]): PullRequest[] {
    return nodes.map(pr => ({
        id: pr.databaseId,
        number: pr.number,
        title: pr.title,
        state: pr.state === 'OPEN' ? 'open' as const : 'closed' as const,
        merged_at: pr.mergedAt,
        created_at: pr.createdAt,
        user: pr.author ? { login: pr.author.login } : null,
        html_url: pr.url,
    }));
}

/**
 * Converts a GraphQL rate limit object to our internal RateLimitInfo format.
 */
export function convertGraphQLRateLimit(rl: GraphQLRateLimit): RateLimitInfo {
    return {
        limit: rl.limit,
        remaining: rl.remaining,
        reset: Math.floor(new Date(rl.resetAt).getTime() / 1000),
        used: rl.used,
    };
}

// ============================================================================
// GraphQL Query Constants
// ============================================================================

const GRAPHQL_PR_FRAGMENT_DEF = `
fragment PRFields on PullRequest {
    databaseId
    number
    title
    state
    createdAt
    mergedAt
    url
    author { login }
}
`;

/**
 * Combined query: fetches Copilot PRs + all PR counts in a single request.
 * Uses aliases to run multiple search queries simultaneously.
 */
export const GRAPHQL_COMBINED_QUERY = `
query CopilotDashboard($copilotQuery: String!, $mergedAllQuery: String!, $totalQuery: String!, $mergedQuery: String!, $openQuery: String!, $first: Int!, $after: String) {
    copilotPRs: search(query: $copilotQuery, type: ISSUE, first: $first, after: $after) {
        issueCount
        pageInfo { hasNextPage endCursor }
        nodes { ...PRFields }
    }
    # Note: allMergedPRs is hardcoded to first 100 items without $after pagination.
    # Additional pages are fetched separately via fetchMergedPRsWithPagination().
    allMergedPRs: search(query: $mergedAllQuery, type: ISSUE, first: 100) {
        issueCount
        pageInfo { hasNextPage endCursor }
        nodes { ...PRFields }
    }
    totalCount: search(query: $totalQuery, type: ISSUE, first: 1) { issueCount }
    mergedCount: search(query: $mergedQuery, type: ISSUE, first: 1) { issueCount }
    openCount: search(query: $openQuery, type: ISSUE, first: 1) { issueCount }
    rateLimit { limit remaining resetAt cost used }
}
${GRAPHQL_PR_FRAGMENT_DEF}
`;

/**
 * Simple search query for pagination and single-purpose fetches.
 */
export const GRAPHQL_SEARCH_QUERY = `
query SearchQuery($query: String!, $first: Int!, $after: String) {
    search(query: $query, type: ISSUE, first: $first, after: $after) {
        issueCount
        pageInfo { hasNextPage endCursor }
        nodes { ...PRFields }
    }
    rateLimit { limit remaining resetAt cost used }
}
${GRAPHQL_PR_FRAGMENT_DEF}
`;

// ============================================================================
// HTML Escaping & Sanitization
// ============================================================================

/**
 * Escapes HTML special characters to prevent XSS attacks.
 */
export function escapeHtml(text: string | null | undefined): string {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Sanitizes a URL to prevent XSS attacks.
 * Only allows HTTPS URLs from github.com.
 */
export function sanitizeUrl(url: string | null | undefined): string {
    if (url == null) return '#';
    try {
        const parsedUrl = new URL(String(url).trim());
        if (parsedUrl.protocol === 'https:' && parsedUrl.hostname === 'github.com') {
            return parsedUrl.href;
        }
    } catch {
        // Invalid URL
    }
    return '#';
}

// ============================================================================
// Input Validation
// ============================================================================

/**
 * Validates GitHub owner/repo segments using a conservative allowlist.
 * Rejects "." and ".." and only allows letters, numbers, hyphens, underscores, and periods.
 */
export function isValidGitHubName(name: string): boolean {
    if (!name || name === '.' || name === '..') {
        return false;
    }
    const validPattern = /^[A-Za-z0-9_.-]+$/;
    return validPattern.test(name);
}

/**
 * Parses and validates the repository input string.
 * Returns { owner, repo } on success, or an error message string on failure.
 */
export function parseRepoInput(repoInput: string): { owner: string; repo: string } | string {
    const trimmed = repoInput.trim();
    const [owner, repo, ...rest] = trimmed.split('/');
    if (!owner || !repo || rest.length > 0) {
        return 'Please enter repository in "owner/repo" format';
    }
    if (!isValidGitHubName(owner) || !isValidGitHubName(repo)) {
        return 'Invalid repository name. Names can only contain letters, numbers, hyphens, underscores, and periods.';
    }
    return { owner, repo };
}

/**
 * Validates that date strings parse to valid dates and that fromDate is not after toDate.
 */
export function validateDateRange(fromDate: string, toDate: string): string | null {
    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return 'Invalid date format';
    }
    if (from > to) {
        return 'Start date must be before end date';
    }
    return null;
}

// ============================================================================
// Date Range Splitting
// ============================================================================

/**
 * Splits a date range into non-overlapping segments.
 * Used to overcome GitHub Search API's 1,000 result limit per query.
 * Each segment covers a contiguous portion of the date range with no overlap.
 */
export function splitDateRange(fromDate: string, toDate: string, segments: number): Array<{ from: string; to: string }> {
    const dayMs = 24 * 60 * 60 * 1000;
    const start = new Date(fromDate + 'T00:00:00Z');
    const end = new Date(toDate + 'T00:00:00Z');
    const totalDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;

    const actualSegments = Math.min(Math.max(1, segments), totalDays);
    if (actualSegments <= 1) {
        return [{ from: fromDate, to: toDate }];
    }

    const ranges: Array<{ from: string; to: string }> = [];
    let currentDay = 0;

    for (let i = 0; i < actualSegments; i++) {
        const remainingSegments = actualSegments - i;
        const remainingDays = totalDays - currentDay;
        const daysInSegment = Math.ceil(remainingDays / remainingSegments);

        const segStart = new Date(start.getTime() + currentDay * dayMs);
        const segEnd = i === actualSegments - 1
            ? end
            : new Date(start.getTime() + (currentDay + daysInSegment - 1) * dayMs);

        ranges.push({
            from: segStart.toISOString().split('T')[0],
            to: segEnd.toISOString().split('T')[0],
        });

        currentDay += daysInSegment;
    }

    return ranges;
}

// ============================================================================
// Cache Functions
// ============================================================================

export function getCacheKey(owner: string, repo: string, fromDate: string, toDate: string, hasToken: boolean): string {
    const authSuffix = hasToken ? '_auth' : '_noauth';
    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });
    return `${CACHE_KEY_PREFIX}${CACHE_VERSION}_${paramsKey}${authSuffix}`;
}

function isValidAllPRCounts(value: unknown): value is AllPRCounts {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return (
        typeof obj.total === 'number' &&
        typeof obj.merged === 'number' &&
        typeof obj.closed === 'number' &&
        typeof obj.open === 'number'
    );
}

function isValidRateLimitInfo(value: unknown): value is RateLimitInfo | null {
    if (value === null) return true;
    if (typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    return (
        typeof obj.limit === 'number' &&
        typeof obj.remaining === 'number' &&
        typeof obj.reset === 'number' &&
        typeof obj.used === 'number'
    );
}

/**
 * Type guard that validates a parsed object conforms to the CacheEntry schema.
 */
export function isCacheEntry(value: unknown): value is CacheEntry {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;

    if (!Array.isArray(obj.data)) return false;
    if (typeof obj.timestamp !== 'number') return false;
    if (!isValidRateLimitInfo(obj.rateLimitInfo)) return false;

    // Optional comparison data validation
    if (obj.allPRCounts !== undefined && !isValidAllPRCounts(obj.allPRCounts)) return false;
    if (obj.allMergedPRs !== undefined && !Array.isArray(obj.allMergedPRs)) return false;

    return true;
}

export function getFromCache(cacheKey: string, storage: Storage = localStorage): CacheEntry | null {
    try {
        const cached = storage.getItem(cacheKey);
        if (!cached) return null;

        const parsed: unknown = JSON.parse(cached);
        if (!isCacheEntry(parsed)) {
            storage.removeItem(cacheKey);
            return null;
        }

        const now = Date.now();
        if (now - parsed.timestamp > CACHE_DURATION_MS) {
            storage.removeItem(cacheKey);
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

export function saveToCache(cacheKey: string, data: PullRequest[], rateLimitInfo: RateLimitInfo | null, allPRCounts?: AllPRCounts, allMergedPRs?: PullRequest[], storage: Storage = localStorage): void {
    try {
        const entry: CacheEntry = {
            data,
            timestamp: Date.now(),
            rateLimitInfo,
        };
        if (allPRCounts) entry.allPRCounts = allPRCounts;
        if (allMergedPRs !== undefined) entry.allMergedPRs = allMergedPRs;
        storage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
        // Cache save failed (e.g., localStorage full), ignore
    }
}

export function updateCacheWithComparison(cacheKey: string, allPRCounts: AllPRCounts, allMergedPRs: PullRequest[], rateLimitInfo: RateLimitInfo | null, storage: Storage = localStorage): void {
    try {
        const cached = storage.getItem(cacheKey);
        if (!cached) return;
        const parsed: unknown = JSON.parse(cached);
        if (!isCacheEntry(parsed)) return;
        parsed.allPRCounts = allPRCounts;
        parsed.allMergedPRs = allMergedPRs;
        if (rateLimitInfo) parsed.rateLimitInfo = rateLimitInfo;
        storage.setItem(cacheKey, JSON.stringify(parsed));
    } catch {
        // ignore
    }
}

let lastCacheCleanupTime = 0;

export function resetCacheCleanupTimer(): void {
    lastCacheCleanupTime = 0;
}

export function clearOldCache(storage: Storage = localStorage): void {
    const now = Date.now();
    if (now - lastCacheCleanupTime < CACHE_CLEANUP_INTERVAL_MS) {
        return; // Skip if cleaned recently
    }
    lastCacheCleanupTime = now;
    try {
        const keysToRemove: string[] = [];
        const currentVersionPrefix = `${CACHE_KEY_PREFIX}${CACHE_VERSION}_`;
        for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (key?.startsWith(CACHE_KEY_PREFIX)) {
                if (!key.startsWith(currentVersionPrefix)) {
                    keysToRemove.push(key);
                    continue;
                }

                const cached = storage.getItem(key);
                if (cached) {
                    try {
                        const entry: CacheEntry = JSON.parse(cached);
                        if (Date.now() - entry.timestamp > CACHE_DURATION_MS) {
                            keysToRemove.push(key);
                        }
                    } catch {
                        keysToRemove.push(key);
                    }
                }
            }
        }
        keysToRemove.forEach(key => storage.removeItem(key));
    } catch {
        // Ignore cache cleanup errors
    }
}

// ============================================================================
// Rate Limit Functions
// ============================================================================

/**
 * Extracts rate limit information from response headers.
 * Accepts a Headers-like object (or a real Response for convenience).
 */
export function extractRateLimitInfo(headers: { get(name: string): string | null }): RateLimitInfo | null {
    const limit = headers.get('X-RateLimit-Limit');
    const remaining = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');
    const usedHeader = headers.get('X-RateLimit-Used');

    if (!limit || !remaining || !reset) {
        return null;
    }

    const limitNum = parseInt(limit, 10);
    const remainingNum = parseInt(remaining, 10);
    const resetNum = parseInt(reset, 10);

    if (Number.isNaN(limitNum) || Number.isNaN(remainingNum) || Number.isNaN(resetNum)) {
        return null;
    }

    let usedNum: number;
    if (usedHeader !== null) {
        usedNum = parseInt(usedHeader, 10);
        if (Number.isNaN(usedNum)) {
            return null;
        }
    } else {
        usedNum = limitNum - remainingNum;
        if (Number.isNaN(usedNum)) {
            return null;
        }
    }

    return {
        limit: limitNum,
        remaining: remainingNum,
        reset: resetNum,
        used: usedNum
    };
}

export function formatCountdown(resetTimestamp: number): string {
    const now = Date.now();
    const diffMs = resetTimestamp * 1000 - now;
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
    const minutes = Math.floor(diffSecs / 60);
    const seconds = diffSecs % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Determines rate limit status based on remaining and limit.
 */
export function getRateLimitStatus(remaining: number, limit: number): { statusText: string; isAuthenticated: boolean } {
    const isAuthenticated = limit > 10;
    let statusText: string;
    if (remaining > limit * 0.5) {
        statusText = 'Good';
    } else if (remaining > limit * 0.2) {
        statusText = 'Warning';
    } else {
        statusText = 'Low';
    }
    return { statusText, isAuthenticated };
}

// ============================================================================
// Pagination
// ============================================================================

export function getPageNumbersToShow(current: number, total: number): (number | string)[] {
    const pages: (number | string)[] = [];
    const delta = 1;

    if (total <= 7) {
        for (let i = 1; i <= total; i++) {
            pages.push(i);
        }
    } else {
        pages.push(1);

        if (current > delta + 2) {
            pages.push('...');
        }

        const start = Math.max(2, current - delta);
        const end = Math.min(total - 1, current + delta);

        for (let i = start; i <= end; i++) {
            pages.push(i);
        }

        if (current < total - delta - 1) {
            pages.push('...');
        }

        pages.push(total);
    }

    return pages;
}

// ============================================================================
// PR Classification Logic
// ============================================================================

export interface PRCounts {
    total: number;
    merged: number;
    closed: number;
    open: number;
    mergeRate: number;
}

/**
 * Classifies PRs into merged, closed (not merged), and open categories.
 */
export function classifyPRs(prs: PullRequest[]): PRCounts {
    const merged = prs.filter(pr => pr.merged_at !== null);
    const closed = prs.filter(pr => pr.state === 'closed' && pr.merged_at === null);
    const open = prs.filter(pr => pr.state === 'open' && pr.merged_at === null);
    const mergeRate = prs.length > 0
        ? Math.round((merged.length / prs.length) * 100)
        : 0;

    return {
        total: prs.length,
        merged: merged.length,
        closed: closed.length,
        open: open.length,
        mergeRate
    };
}

export function calculateResponseTimes(prs: PullRequest[]): ResponseTimeMetrics | null {
  const mergedPRs = prs.filter(pr => pr.merged_at !== null);

  const hours = mergedPRs
    .map(pr => {
      const created = new Date(pr.created_at).getTime();
      const merged = new Date(pr.merged_at!).getTime();
      return (merged - created) / (1000 * 60 * 60);
    })
    .filter(h => Number.isFinite(h) && h >= 0);

  if (hours.length === 0) return null;

  const sorted = [...hours].sort((a, b) => a - b);

  const average = sorted.reduce((sum, h) => sum + h, 0) / sorted.length;
  const fastest = sorted[0];
  const slowest = sorted[sorted.length - 1];

  let median: number;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    median = (sorted[mid - 1] + sorted[mid]) / 2;
  } else {
    median = sorted[mid];
  }

  const bucketDefs: { label: string; min: number; max: number }[] = [
    { label: '<1h',   min: 0,   max: 1 },
    { label: '1-6h',  min: 1,   max: 6 },
    { label: '6-24h', min: 6,   max: 24 },
    { label: '1-3d',  min: 24,  max: 72 },
    { label: '3-7d',  min: 72,  max: 168 },
    { label: '7d+',   min: 168, max: Infinity },
  ];

  const buckets = bucketDefs.map(def => ({
    label: def.label,
    count: hours.filter(h => h >= def.min && h < def.max).length,
  }));
  buckets[buckets.length - 1].count = hours.filter(h => h >= 168).length;

  return {
    average,
    median,
    fastest,
    slowest,
    buckets,
    totalMerged: hours.length,
  };
}

export function formatDuration(hours: number): string {
  if (!Number.isFinite(hours)) return '0 min';
  hours = Math.max(0, hours);

  if (hours < 1) {
    const mins = Math.round(hours * 60);
    if (mins >= 60) return '1.0 hours';
    return `${mins} min`;
  }
  if (hours < 24) {
    const fixed = parseFloat(hours.toFixed(1));
    if (fixed >= 24) return `${(fixed / 24).toFixed(1)} days`;
    return `${hours.toFixed(1)} hours`;
  }
  return `${(hours / 24).toFixed(1)} days`;
}

export function generateResponseTimeStatsHtml(metrics: ResponseTimeMetrics, othersMetrics?: ResponseTimeMetrics | null): string {
  const entries = [
    { label: 'Average Response Time', value: metrics.average, othersValue: othersMetrics?.average },
    { label: 'Median Response Time',  value: metrics.median,  othersValue: othersMetrics?.median },
    { label: 'Fastest PR',            value: metrics.fastest, othersValue: othersMetrics?.fastest },
    { label: 'Slowest PR',            value: metrics.slowest, othersValue: othersMetrics?.slowest },
  ];

  const showComparison = othersMetrics !== undefined;

  return entries.map(entry => {
    const mainValue = formatDuration(entry.value);

    const valueHtml = showComparison
      ? `<div class="space-y-1.5">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Copilot</span>
              <span class="text-xl font-bold text-slate-800 dark:text-slate-100">${mainValue}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">Others</span>
              <span class="text-xl font-bold text-slate-800 dark:text-slate-100">${entry.othersValue != null ? formatDuration(entry.othersValue) : '-'}</span>
            </div>
          </div>`
      : `<p class="text-2xl font-bold text-slate-800 dark:text-slate-100">${mainValue}</p>`;

    return `
    <div class="glass-card rounded-2xl p-6 relative overflow-hidden">
      <div class="absolute top-0 right-0 w-32 h-32 bg-linear-to-br from-amber-500/10 to-orange-500/10 rounded-full -translate-y-16 translate-x-16"></div>
      <div class="relative">
        <div class="flex items-center gap-2 mb-3">
          <div class="p-2 rounded-lg bg-linear-to-br from-amber-500 to-orange-500">
            <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <span class="text-sm font-medium text-slate-600 dark:text-slate-300">${escapeHtml(entry.label)}</span>
        </div>
        ${valueHtml}
      </div>
    </div>
  `;
  }).join('');
}

// ============================================================================
// Chart Data Preparation
// ============================================================================

export interface ChartData {
    dates: string[];
    mergedData: number[];
    closedData: number[];
    openData: number[];
}

export interface ResponseTimeMetrics {
  average: number;    // 平均所要時間（hours）
  median: number;     // 中央値（hours）
  fastest: number;    // 最速（hours）
  slowest: number;    // 最遅（hours）
  buckets: { label: string; count: number }[];  // ヒストグラム用バケット（6個）
  totalMerged: number; // 対象マージ済みPR数
}

/**
 * Groups PRs by date and generates chart data.
 */
export function prepareChartData(prs: PullRequest[], fromDate: string, toDate: string): ChartData {
    const prsByDate: PRsByDate = {};

    prs.forEach(pr => {
        const date = new Date(pr.created_at).toISOString().split('T')[0];
        if (!prsByDate[date]) {
            prsByDate[date] = { merged: 0, closed: 0, open: 0 };
        }

        if (pr.merged_at) {
            prsByDate[date].merged++;
        } else if (pr.state === 'closed') {
            prsByDate[date].closed++;
        } else {
            prsByDate[date].open++;
        }
    });

    const dates: string[] = [];
    if (fromDate && toDate) {
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            dates.push(currentDate.toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else {
        dates.push(...Object.keys(prsByDate).sort());
    }

    const mergedData = dates.map(date => prsByDate[date]?.merged ?? 0);
    const closedData = dates.map(date => prsByDate[date]?.closed ?? 0);
    const openData = dates.map(date => prsByDate[date]?.open ?? 0);

    return { dates, mergedData, closedData, openData };
}

// ============================================================================
// API Error Message Generation
// ============================================================================

/**
 * Generates an appropriate error message based on HTTP status code and response.
 */
export function getApiErrorMessage(
    status: number,
    rateLimitInfo: RateLimitInfo | null,
    responseBody?: { message?: string; errors?: Array<{ message?: string }> }
): string {
    if (status === 404) {
        return 'Repository not found';
    }

    if (status === 401) {
        return 'Authentication failed. Please check that your GitHub token is valid.';
    }

    if (status === 403) {
        const isRateLimit = rateLimitInfo?.remaining === 0;

        if (isRateLimit) {
            const resetTime = rateLimitInfo?.reset
                ? new Date(rateLimitInfo.reset * 1000).toLocaleString('en-US', { timeZoneName: 'short' })
                : 'unknown';
            return `API rate limit reached. Reset at: ${resetTime}. Try again later or use a different token.`;
        } else {
            return 'Access forbidden (HTTP 403). This may be due to insufficient permissions, SSO not being authorized, or temporary abuse protection on the GitHub API.';
        }
    }

    if (status === 422) {
        const detail = responseBody?.errors?.[0]?.message ?? '';
        if (detail.toLowerCase().includes('cannot be searched')) {
            return (
                'Search query validation failed. The repository or author filter could not be resolved. ' +
                'This may happen if the repository does not exist, you do not have permission to access it, ' +
                'or the Copilot Coding Agent app is not installed on the repository. ' +
                'Please verify the repository name and ensure your token has access.'
            );
        }
        return `Search query validation failed. ${detail || 'Please check the repository name.'}`;
    }

    return `GitHub API Error: ${status}`;
}

// ============================================================================
// Search Result Processing
// ============================================================================

/**
 * Converts search API items to PullRequest format.
 */
export function convertSearchItemsToPRs(items: SearchIssueItem[]): PullRequest[] {
    return items.map(item => ({
        id: item.id,
        number: item.number,
        title: item.title,
        state: item.state,
        merged_at: item.pull_request?.merged_at ?? null,
        created_at: item.created_at,
        user: item.user,
        html_url: item.html_url
    }));
}

/**
 * Builds the search query string for copilot PRs.
 */
export function buildSearchQuery(owner: string, repo: string, fromDate: string, toDate: string): string {
    return `repo:${owner}/${repo} is:pr author:app/copilot-swe-agent created:${fromDate}..${toDate}`;
}

/**
 * Builds the search URL for GitHub API.
 */
export function buildSearchUrl(query: string, perPage: number, page: number): string {
    return `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&sort=created&order=desc`;
}

/**
 * Builds request headers for GitHub API.
 */
export function buildApiHeaders(token: string): Record<string, string> {
    const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * Adjusts closed PR count by subtracting merged PRs.
 * GitHub's "closed" state includes both merged and unmerged PRs.
 */
export function adjustClosedCount(
    counts: AllPRCounts,
    succeeded: Set<string>
): AllPRCounts {
    const adjusted = { ...counts };

    if (succeeded.has('closed') && succeeded.has('merged')) {
        adjusted.closed = Math.max(0, adjusted.closed - adjusted.merged);
    } else if (succeeded.has('closed') && !succeeded.has('merged')) {
        adjusted.closed = 0;
    }

    return adjusted;
}

// ============================================================================
// PR Number Display
// ============================================================================

/**
 * Formats PR number for display. Returns empty string for invalid numbers.
 */
export function formatPRNumber(num: number): string {
    return Number.isSafeInteger(num) && num > 0 ? `#${num}` : '';
}

// ============================================================================
// Ratio Display
// ============================================================================

/**
 * Creates HTML for ratio display (copilot count / total count).
 */
export function createRatioHtml(copilotCount: number, totalCount: number, colorClass: string): string {
    if (totalCount > 0) {
        return `<span class="text-4xl font-bold ${colorClass}">${copilotCount}</span><span class="text-lg text-slate-500 dark:text-slate-400 ml-1">/ ${totalCount}</span>`;
    }
    return `<span class="text-4xl font-bold ${colorClass}">${copilotCount}</span><span class="text-lg text-slate-500 dark:text-slate-400 ml-1">/ -</span>`;
}

// ============================================================================
// Sort Functions
// ============================================================================

/**
 * Sorts PRs by created date (newest first).
 */
export function sortPRsByDate(prs: PullRequest[]): PullRequest[] {
    return [...prs].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
}

/**
 * Filter type for PR status: 'all' shows everything, others match the PR status.
 */
export type PRFilterStatus = 'all' | 'merged' | 'closed' | 'open';

/**
 * Filters PRs by status and/or search text.
 * Pure function with no DOM dependencies.
 */
export function filterPRs(
    prs: PullRequest[],
    statusFilter: PRFilterStatus,
    searchText: string
): PullRequest[] {
    let filtered = prs;

    // Filter by status
    if (statusFilter !== 'all') {
        filtered = filtered.filter(pr => getPRStatus(pr) === statusFilter);
    }

    // Filter by search text (case-insensitive title match)
    const query = searchText.trim().toLowerCase();
    if (query) {
        filtered = filtered.filter(pr =>
            (pr.title ?? '').toLowerCase().includes(query)
        );
    }

    return filtered;
}

// ============================================================================
// PR List Rendering (Pure HTML generation)
// ============================================================================

/**
 * Status configuration for PR display badges.
 */
export const PR_STATUS_CONFIG: StatusConfigMap = {
    merged: {
        class: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
        icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
        text: 'Merged'
    },
    closed: {
        class: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
        icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
        text: 'Closed'
    },
    open: {
        class: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
        icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle></svg>`,
        text: 'Open'
    }
};

/**
 * Determines the display status of a PR.
 */
export function getPRStatus(pr: PullRequest): keyof StatusConfigMap {
    return pr.merged_at ? 'merged' : pr.state;
}

/**
 * Generates the inner HTML for a single PR list item.
 * Returns a pure HTML string with no DOM dependencies.
 *
 * @param isInteractive When true, renders hover/cursor classes on the external link
 *   and hover color classes on the title. When false, omits them.
 */
export function generatePRItemHtml(pr: PullRequest, isInteractive = true): string {
    const createdDate = new Date(pr.created_at).toLocaleDateString('en-US');
    const status = getPRStatus(pr);
    const config = PR_STATUS_CONFIG[status];
    const prNumberDisplay = formatPRNumber(pr.number);

    const sanitizedUrl = sanitizeUrl(pr.html_url);
    const hasValidUrl = sanitizedUrl !== '#';

    // External link: render as span (not anchor) to avoid nested link issues
    const externalLinkClasses = isInteractive
        ? 'shrink-0 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer'
        : 'shrink-0 p-1.5 rounded-lg transition-colors';

    const externalLink = `
                <span class="${externalLinkClasses}"${hasValidUrl ? ' title="Open in GitHub"' : ''}>
                    <svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                </span>`;

    const titleHoverClasses = isInteractive ? ' hover:text-indigo-600 dark:hover:text-indigo-400' : '';

    return `
            <div class="flex items-start justify-between gap-4 mb-3">
                <div class="flex items-center gap-2 shrink-0">
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${config.class}">
                        ${config.icon}
                        ${config.text}
                    </span>
                    ${prNumberDisplay ? `<span class="text-xs text-slate-600 dark:text-slate-400">${prNumberDisplay}</span>` : ''}
                </div>
                ${externalLink}
            </div>
            <h3 class="font-semibold text-slate-800 dark:text-slate-100 mb-2 pr-8 transition-colors${titleHoverClasses}">${escapeHtml(pr.title)}</h3>
            <div class="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                <span class="flex items-center gap-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    ${escapeHtml(pr.user?.login ?? 'unknown')}
                </span>
                <span class="flex items-center gap-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    ${createdDate}
                </span>
            </div>
        `;
}

/**
 * Generates HTML for empty PR list state.
 */
export function generateEmptyListHtml(): string {
    return `
            <div class="text-center py-16">
                <svg class="w-16 h-16 mx-auto mb-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p class="text-slate-600 dark:text-slate-400">No PRs created by Copilot Coding Agent found</p>
            </div>
        `;
}

/**
 * Generates HTML for the empty PR list state when filters/search yield no results.
 */
export function generateFilteredEmptyListHtml(): string {
    return `
            <div class="text-center py-16">
                <svg class="w-16 h-16 mx-auto mb-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
                <p class="text-slate-600 dark:text-slate-400">No PRs match the current filters</p>
                <p class="text-sm text-slate-500 dark:text-slate-500 mt-1">Try adjusting your status filter or search text</p>
            </div>
        `;
}

// ============================================================================
// Chart Constants
// ============================================================================

export const CHART_COLORS = {
    merged: {
        backgroundColor: 'rgba(16, 185, 129, 0.8)',
        borderColor: 'rgba(16, 185, 129, 1)',
    },
    closed: {
        backgroundColor: 'rgba(239, 68, 68, 0.8)',
        borderColor: 'rgba(239, 68, 68, 1)',
    },
    open: {
        backgroundColor: 'rgba(59, 130, 246, 0.8)',
        borderColor: 'rgba(59, 130, 246, 1)',
    },
} as const;

export const RESPONSE_TIME_CHART_COLORS = {
  backgroundColor: 'rgba(245, 158, 11, 0.8)',
  borderColor: 'rgba(245, 158, 11, 1)',
} as const;

export const RESPONSE_TIME_OTHERS_CHART_COLORS = {
  backgroundColor: 'rgba(99, 102, 241, 0.6)',
  borderColor: 'rgba(99, 102, 241, 1)',
} as const;

export interface ChartTheme {
    textColor: string;
    gridColor: string;
    tooltipBg: string;
    tooltipBorder: string;
}

export function getChartTheme(isDark: boolean): ChartTheme {
    return {
        textColor: isDark ? '#f1f5f9' : '#1e293b',
        gridColor: isDark ? '#475569' : '#e2e8f0',
        tooltipBg: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
        tooltipBorder: isDark ? '#334155' : '#e2e8f0',
    };
}

// ============================================================================
// Filter Button Style Constants
// ============================================================================

export interface FilterStyleConfig {
    active: string;
    hover: string;
}

export const FILTER_STYLE_MAP: Record<PRFilterStatus, FilterStyleConfig> = {
    all: {
        active: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-400 dark:border-indigo-500',
        hover: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-700 dark:hover:text-indigo-300 hover:border-indigo-300 dark:hover:border-indigo-500',
    },
    merged: {
        active: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-400 dark:border-green-500',
        hover: 'hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-300 hover:border-green-300 dark:hover:border-green-600',
    },
    closed: {
        active: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-400 dark:border-red-500',
        hover: 'hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300 hover:border-red-300 dark:hover:border-red-600',
    },
    open: {
        active: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-500',
        hover: 'hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-300 dark:hover:border-blue-600',
    },
};

export const FILTER_INACTIVE_STYLE = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';

/**
 * Derives the complete set of color-related classes from the style map + inactive style.
 * Used to remove all color classes before applying the correct ones.
 */
export function getAllFilterColorClasses(): string[] {
    const classes = new Set<string>();
    // Collect from inactive style
    FILTER_INACTIVE_STYLE.split(' ').forEach(c => classes.add(c));
    // Collect from all active, hover styles
    for (const config of Object.values(FILTER_STYLE_MAP)) {
        config.active.split(' ').forEach(c => classes.add(c));
        config.hover.split(' ').forEach(c => classes.add(c));
    }
    return [...classes];
}

// ============================================================================
// Rate Limit HTML Generation
// ============================================================================

export interface RateLimitDisplayParams {
    info: RateLimitInfo;
    fromCache: boolean;
    resetCountdown: string;
}

/**
 * Generates HTML for the rate limit info panel.
 * Pure function with no DOM dependencies.
 */
export function generateRateLimitHtml(params: RateLimitDisplayParams): string {
    const { info, fromCache, resetCountdown } = params;
    const usagePercent = info.limit > 0
        ? Math.max(0, Math.min(100, Math.round((info.used / info.limit) * 100)))
        : 0;
    const { statusText, isAuthenticated } = getRateLimitStatus(info.remaining, info.limit);

    const authStatusBadge = isAuthenticated
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Authenticated</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">Unauthenticated</span>';

    let statusClass: string;
    let statusBgClass: string;
    if (statusText === 'Good') {
        statusClass = 'text-green-600 dark:text-green-400';
        statusBgClass = 'bg-green-100 dark:bg-green-900/30';
    } else if (statusText === 'Warning') {
        statusClass = 'text-yellow-600 dark:text-yellow-400';
        statusBgClass = 'bg-yellow-100 dark:bg-yellow-900/30';
    } else {
        statusClass = 'text-red-600 dark:text-red-400';
        statusBgClass = 'bg-red-100 dark:bg-red-900/30';
    }

    const cacheIndicator = fromCache
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Cached</span>'
        : '';

    const progressBarColor = info.remaining > info.limit * 0.5
        ? 'bg-green-500'
        : info.remaining > info.limit * 0.2
            ? 'bg-yellow-500'
            : 'bg-red-500';

    const remainingHighlight = info.remaining <= info.limit * 0.2
        ? 'text-red-600 dark:text-red-400'
        : '';

    // Heuristic detection of GraphQL vs REST rate limits:
    // - GitHub GraphQL API currently allows 5,000 points/hour.
    // - GitHub REST Search API currently allows 30 requests/min (authenticated)
    //   and 10 requests/min (unauthenticated).
    // Any limit >= 100 is therefore treated as GraphQL here.
    const isGraphQL = info.limit >= 100;

    const infoText = fromCache
        ? '<p>📦 Data loaded from cache (5 min TTL). No API call made.</p>'
        : isGraphQL
            ? `<p>🔄 Used ${info.used} points this hour</p>`
            : `<p>🔄 Used ${info.used} requests this minute</p>`;

    const authTip = isGraphQL
        ? 'Authenticated via GraphQL API. Rate limit: 5,000 points/hour — dramatically more generous than REST Search API.'
        : isAuthenticated
            ? 'Authenticated with Personal Access Token. Search API allows up to 30 requests/min.'
            : 'Limited to 10 requests/min without authentication. Set up a <a href="https://docs.github.com/en/rest/search/search#rate-limit" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">PAT</a> to increase to 30 requests/min.';

    return `
        <div class="space-y-3">
            <!-- Header -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-slate-700 dark:text-slate-200">${isGraphQL ? 'GitHub GraphQL API' : 'GitHub Search API'}</span>
                    ${authStatusBadge}
                    ${cacheIndicator}
                </div>
                <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium ${statusClass} ${statusBgClass}">${statusText}</span>
            </div>

            <!-- Progress Section -->
            <div class="space-y-2">
                <div class="flex justify-between items-baseline">
                    <div class="text-lg font-semibold text-slate-800 dark:text-slate-100">
                        <span class="${remainingHighlight}">${info.remaining}</span>
                        <span class="text-sm font-normal text-slate-500 dark:text-slate-400">/ ${info.limit} remaining</span>
                    </div>
                    <div class="text-right">
                        <div class="text-xs text-slate-500 dark:text-slate-400">Resets in</div>
                        <div id="rateLimitCountdown" class="text-sm font-mono font-medium text-slate-700 dark:text-slate-200">${resetCountdown}</div>
                    </div>
                </div>
                <div class="relative h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div class="absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${progressBarColor}" style="width: ${100 - usagePercent}%"></div>
                </div>
            </div>

            <!-- Info Section -->
            <div class="pt-2 border-t border-slate-200 dark:border-slate-700">
                <div class="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    ${infoText}
                    <p class="flex items-start gap-1">
                        <span class="shrink-0">💡</span>
                        <span>${authTip}</span>
                    </p>
                </div>
            </div>
        </div>
    `;
}
