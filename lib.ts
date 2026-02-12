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
    allPRCounts: AllPRCounts;
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
// Constants
// ============================================================================

export const ITEMS_PER_PAGE = 10;
export const CACHE_KEY_PREFIX = 'copilot_pr_cache_';
export const CACHE_VERSION = 'v2';
export const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

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
 * Validates that fromDate is not after toDate.
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
// Cache Functions
// ============================================================================

export function getCacheKey(owner: string, repo: string, fromDate: string, toDate: string, hasToken: boolean): string {
    const authSuffix = hasToken ? '_auth' : '_noauth';
    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });
    return `${CACHE_KEY_PREFIX}${CACHE_VERSION}_${paramsKey}${authSuffix}`;
}

export function getFromCache(cacheKey: string, storage: Storage = localStorage): CacheEntry | null {
    try {
        const cached = storage.getItem(cacheKey);
        if (!cached) return null;

        const entry: CacheEntry = JSON.parse(cached);
        const now = Date.now();

        if (now - entry.timestamp > CACHE_DURATION_MS) {
            storage.removeItem(cacheKey);
            return null;
        }

        return entry;
    } catch {
        return null;
    }
}

export function saveToCache(cacheKey: string, data: PullRequest[], rateLimitInfo: RateLimitInfo | null, allPRCounts: AllPRCounts, storage: Storage = localStorage): void {
    try {
        const entry: CacheEntry = {
            data,
            timestamp: Date.now(),
            rateLimitInfo,
            allPRCounts
        };
        storage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
        // Cache save failed (e.g., localStorage full), ignore
    }
}

export function clearOldCache(storage: Storage = localStorage): void {
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

// ============================================================================
// Chart Data Preparation
// ============================================================================

export interface ChartData {
    dates: string[];
    mergedData: number[];
    closedData: number[];
    openData: number[];
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
export type PRFilterStatus = 'all' | keyof StatusConfigMap;

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
 */
export function generatePRItemHtml(pr: PullRequest): string {
    const createdDate = new Date(pr.created_at).toLocaleDateString('en-US');
    const status = getPRStatus(pr);
    const config = PR_STATUS_CONFIG[status];
    const prNumberDisplay = formatPRNumber(pr.number);

    return `
            <div class="flex items-start justify-between gap-4 mb-3">
                <div class="flex items-center gap-2 shrink-0">
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${config.class}">
                        ${config.icon}
                        ${config.text}
                    </span>
                    ${prNumberDisplay ? `<span class="text-xs text-slate-600 dark:text-slate-400">${prNumberDisplay}</span>` : ''}
                </div>
                <a href="${sanitizeUrl(pr.html_url)}" target="_blank" rel="noopener noreferrer"
                   class="shrink-0 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                   title="Open in GitHub">
                    <svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                </a>
            </div>
            <h3 class="font-semibold text-slate-800 dark:text-slate-100 mb-2 pr-8 transition-colors">${escapeHtml(pr.title)}</h3>
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
