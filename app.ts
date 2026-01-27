// Import Chart.js from npm
import Chart from 'chart.js/auto';

// Timer for rate limit countdown
let rateLimitCountdownInterval: number | null = null;

// Type definitions
interface GitHubUser {
    login: string;
}

interface PullRequest {
    id: number;
    number: number;
    title: string;
    state: 'open' | 'closed';
    merged_at: string | null;
    created_at: string;
    user: GitHubUser;
    html_url: string;
}

interface PRsByDate {
    [date: string]: {
        merged: number;
        closed: number;
        open: number;
    };
}

interface StatusConfig {
    class: string;
    icon: string;
    text: string;
}

interface StatusConfigMap {
    merged: StatusConfig;
    closed: StatusConfig;
    open: StatusConfig;
}

interface RateLimitInfo {
    limit: number;
    remaining: number;
    reset: number;
    used: number;
}

interface AllPRCounts {
    total: number;
    merged: number;
    closed: number;
    open: number;
}

interface CacheEntry {
    data: PullRequest[];
    timestamp: number;
    rateLimitInfo: RateLimitInfo | null;
    allPRCounts: AllPRCounts;
}

interface SearchResponse {
    total_count: number;
    incomplete_results: boolean;
    items: SearchIssueItem[];
}

interface SearchIssueItem {
    id: number;
    number: number;
    title: string;
    state: 'open' | 'closed';
    created_at: string;
    user: GitHubUser;
    html_url: string;
    pull_request?: {
        merged_at: string | null;
    };
}

// Global chart instance
let chartInstance: Chart | null = null;

// Cache settings
const CACHE_KEY_PREFIX = 'copilot_pr_cache_';
// Bump when cache schema changes to invalidate legacy entries
const CACHE_VERSION = 'v2';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeForm();
    setDefaultDates();
});

// Theme Management
function initializeTheme(): void {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('theme') || 'light';

    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    themeToggle?.addEventListener('click', toggleTheme);
}

function toggleTheme(): void {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');

    if (isDark) {
        html.classList.remove('dark');
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }

    // Update chart if it exists
    if (chartInstance) {
        updateChartTheme();
    }
}

// Set default dates (last 30 days)
function setDefaultDates(): void {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);

    const toInput = document.getElementById('toDate') as HTMLInputElement | null;
    const fromInput = document.getElementById('fromDate') as HTMLInputElement | null;

    if (toInput) toInput.valueAsDate = toDate;
    if (fromInput) fromInput.valueAsDate = fromDate;
}

// Form initialization
function initializeForm(): void {
    const form = document.getElementById('searchForm');
    form?.addEventListener('submit', handleFormSubmit);
}

async function handleFormSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const repoInputEl = document.getElementById('repoInput') as HTMLInputElement | null;
    const fromDateEl = document.getElementById('fromDate') as HTMLInputElement | null;
    const toDateEl = document.getElementById('toDate') as HTMLInputElement | null;
    const tokenInputEl = document.getElementById('tokenInput') as HTMLInputElement | null;

    const repoInput = repoInputEl?.value.trim() ?? '';
    const fromDate = fromDateEl?.value ?? '';
    const toDate = toDateEl?.value ?? '';
    const token = tokenInputEl?.value.trim() ?? '';

    const [owner, repo, ...rest] = repoInput.split('/');
    if (!owner || !repo || rest.length > 0) {
        showError('Please enter repository in "owner/repo" format');
        return;
    }

    // Validate owner and repo names to prevent path traversal attacks
    if (!isValidGitHubName(owner) || !isValidGitHubName(repo)) {
        showError('Invalid repository name. Names can only contain letters, numbers, hyphens, underscores, and periods.');
        return;
    }

    if (new Date(fromDate) > new Date(toDate)) {
        showError('Start date must be before end date');
        return;
    }

    showLoading();
    hideError();
    hideResults();
    hideRateLimitInfo();

    try {
        const result = await fetchCopilotPRsWithCache(owner, repo, fromDate, toDate, token);
        displayResults(result.prs, fromDate, toDate, result.allPRCounts);
        if (result.rateLimitInfo) {
            displayRateLimitInfo(result.rateLimitInfo, result.fromCache);
        }
    } catch (error) {
        showError(error instanceof Error ? error.message : 'An unknown error occurred');
    } finally {
        hideLoading();
    }
}

// Validate GitHub owner/repo segments using a conservative allowlist to prevent path traversal or injection
// NOTE: This is a *security* filter for safe path segments, not a complete implementation of GitHub's naming rules.
// It rejects "." and ".." and only allows letters, numbers, hyphens, underscores, and periods.
function isValidGitHubName(name: string): boolean {
    // Reject empty names, "." and ".." for path traversal prevention
    if (!name || name === '.' || name === '..') {
        return false;
    }
    // Only allow alphanumeric characters, hyphens, underscores, and periods
    const validPattern = /^[A-Za-z0-9_.-]+$/;
    return validPattern.test(name);
}

// Cache Functions
function getCacheKey(owner: string, repo: string, fromDate: string, toDate: string, hasToken: boolean): string {
    // Include authentication status in cache key to prevent serving authenticated data to unauthenticated users
    const authSuffix = hasToken ? '_auth' : '_noauth';
    // Use JSON.stringify to avoid ambiguous underscore-separated encoding that can cause cache key collisions
    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });
    return `${CACHE_KEY_PREFIX}${CACHE_VERSION}_${paramsKey}${authSuffix}`;
}

function getFromCache(cacheKey: string): CacheEntry | null {
    try {
        const cached = localStorage.getItem(cacheKey);
        if (!cached) return null;

        const entry: CacheEntry = JSON.parse(cached);
        const now = Date.now();

        // Check if cache is still valid
        if (now - entry.timestamp > CACHE_DURATION_MS) {
            localStorage.removeItem(cacheKey);
            return null;
        }

        return entry;
    } catch {
        return null;
    }
}

function saveToCache(cacheKey: string, data: PullRequest[], rateLimitInfo: RateLimitInfo | null, allPRCounts: AllPRCounts): void {
    try {
        const entry: CacheEntry = {
            data,
            timestamp: Date.now(),
            rateLimitInfo,
            allPRCounts
        };
        localStorage.setItem(cacheKey, JSON.stringify(entry));
    } catch {
        // Cache save failed (e.g., localStorage full), ignore
    }
}

function clearOldCache(): void {
    try {
        const keysToRemove: string[] = [];
        const currentVersionPrefix = `${CACHE_KEY_PREFIX}${CACHE_VERSION}_`;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(CACHE_KEY_PREFIX)) {
                // Remove entries that don't match current version
                if (!key.startsWith(currentVersionPrefix)) {
                    keysToRemove.push(key);
                    continue;
                }
                
                const cached = localStorage.getItem(key);
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
        keysToRemove.forEach(key => localStorage.removeItem(key));
    } catch {
        // Ignore cache cleanup errors
    }
}

// GitHub API Functions
function extractRateLimitInfo(response: Response): RateLimitInfo | null {
    const limit = response.headers.get('X-RateLimit-Limit');
    const remaining = response.headers.get('X-RateLimit-Remaining');
    const reset = response.headers.get('X-RateLimit-Reset');
    const usedHeader = response.headers.get('X-RateLimit-Used');

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

interface FetchResult {
    prs: PullRequest[];
    rateLimitInfo: RateLimitInfo | null;
    fromCache: boolean;
    allPRCounts: AllPRCounts;
}

async function fetchCopilotPRsWithCache(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string
): Promise<FetchResult> {
    // Clean up old cache entries
    clearOldCache();

    // Include authentication status in cache key to prevent security issue
    // where cached data fetched with a token could be served when no token is provided
    const hasToken = Boolean(token);
    const cacheKey = getCacheKey(owner, repo, fromDate, toDate, hasToken);
    const cached = getFromCache(cacheKey);

    if (cached) {
        return {
            prs: cached.data,
            rateLimitInfo: cached.rateLimitInfo,
            fromCache: true,
            allPRCounts: cached.allPRCounts
        };
    }

    const result = await fetchCopilotPRsWithSearchAPI(owner, repo, fromDate, toDate, token);

    // Save to cache
    saveToCache(cacheKey, result.prs, result.rateLimitInfo, result.allPRCounts);

    return { ...result, fromCache: false };
}

// Use Search API instead of REST API for better efficiency
// Search API allows filtering by date and author directly, reducing API calls significantly
// Old REST API: Fetches ALL PRs page by page, then filters -> many requests
// New Search API: Filters at query level -> typically 1-2 requests
async function fetchCopilotPRsWithSearchAPI(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    token: string
): Promise<{ prs: PullRequest[]; rateLimitInfo: RateLimitInfo | null; allPRCounts: AllPRCounts }> {
    const headers: HeadersInit = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    // Build search query for Copilot PRs within date range
    // Search API requires 'author:app/copilot-swe-agent' to search for Copilot Coding Agent PRs
    // Note: Do NOT encode owner/repo here - the query string will be encoded when added to URL
    const query = `repo:${owner}/${repo} is:pr author:app/copilot-swe-agent created:${fromDate}..${toDate}`;

    const allPRs: PullRequest[] = [];
    let page = 1;
    const perPage = 100; // Search API max is 100
    let rateLimitInfo: RateLimitInfo | null = null;
    let totalCount = 0;
    let incompleteResults = false;

    while (true) {
        const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&sort=created&order=desc`;

        const response = await fetch(url, { headers });

        // Extract rate limit info from response
        rateLimitInfo = extractRateLimitInfo(response);

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Repository not found');
            } else if (response.status === 401) {
                throw new Error('Authentication failed. Please check that your GitHub token is valid.');
            } else if (response.status === 403) {
                const isRateLimit =
                    rateLimitInfo && rateLimitInfo.remaining !== undefined
                        ? String(rateLimitInfo.remaining) === '0'
                        : false;

                if (isRateLimit) {
                    const resetTime = rateLimitInfo?.reset
                        ? new Date(rateLimitInfo.reset * 1000).toLocaleString('ja-JP', { timeZoneName: 'short' })
                        : 'unknown';
                    throw new Error(
                        `API rate limit reached. Reset at: ${resetTime}. Try again later or use a different token.`
                    );
                } else {
                    throw new Error(
                        'Access forbidden (HTTP 403). This may be due to insufficient permissions, SSO not being authorized, or temporary abuse protection on the GitHub API.'
                    );
                }
            } else if (response.status === 422) {
                throw new Error('Search query validation failed. Please check the repository name.');
            } else {
                throw new Error(`GitHub API Error: ${response.status}`);
            }
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
        const prs: PullRequest[] = items.map(item => ({
            id: item.id,
            number: item.number,
            title: item.title,
            state: item.state,
            merged_at: item.pull_request?.merged_at ?? null,
            created_at: item.created_at,
            user: item.user,
            html_url: item.html_url
        }));

        allPRs.push(...prs);

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

    // Fetch all PR counts (total, merged, closed, open) for all authors
    const allPRCounts = await fetchAllPRCounts(owner, repo, fromDate, toDate, headers, rateLimitInfo);

    return { prs: allPRs, rateLimitInfo: allPRCounts.rateLimitInfo ?? rateLimitInfo, allPRCounts: allPRCounts.counts };
}

// Fetch counts of all PRs in the repository within the date range (all authors)
// Returns counts for total, merged, closed, and open PRs
async function fetchAllPRCounts(
    owner: string,
    repo: string,
    fromDate: string,
    toDate: string,
    headers: HeadersInit,
    existingRateLimitInfo: RateLimitInfo | null
): Promise<{ counts: AllPRCounts; rateLimitInfo: RateLimitInfo | null }> {
    const defaultCounts: AllPRCounts = { total: 0, merged: 0, closed: 0, open: 0 };
    let rateLimitInfo = existingRateLimitInfo;

    // Build search queries for different states
    // Note: In GitHub, 'closed' PRs include both merged and unmerged PRs
    // So we query 'is:closed' directly and calculate closed_not_merged = closed - merged
    const queries = [
        { key: 'total' as const, query: `repo:${owner}/${repo} is:pr created:${fromDate}..${toDate}` },
        { key: 'merged' as const, query: `repo:${owner}/${repo} is:pr is:merged created:${fromDate}..${toDate}` },
        { key: 'open' as const, query: `repo:${owner}/${repo} is:pr is:open created:${fromDate}..${toDate}` },
        { key: 'closed' as const, query: `repo:${owner}/${repo} is:pr is:closed created:${fromDate}..${toDate}` }
    ];

    const counts: AllPRCounts = { ...defaultCounts };

    try {
        // Execute all API calls in parallel using Promise.allSettled
        // This allows all requests to complete even if some fail
        const results = await Promise.allSettled(
            queries.map(async ({ key, query }) => {
                const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=1`;
                const response = await fetch(url, { headers });
                return { key, response };
            })
        );

        // Process results and extract rate limit info
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            
            if (result.status === 'rejected') {
                console.warn(`Failed to fetch ${queries[i].key} PR count:`, result.reason);
                continue;
            }

            const { key, response } = result.value;

            // Extract rate limit info from response
            rateLimitInfo = extractRateLimitInfo(response) ?? rateLimitInfo;

            if (!response.ok) {
                console.warn(`Failed to fetch ${key} PR count:`, response.status);
                continue;
            }

            const searchResponse: SearchResponse = await response.json();
            counts[key] = searchResponse.total_count;
        }

        // Adjust closed count to represent only "closed but not merged" PRs:
        // closed_not_merged = closed (from API, includes merged + unmerged) - merged
        // NOTE: After this line, counts.closed represents "closed not merged" PRs.
        counts.closed = Math.max(0, counts.closed - counts.merged);

        return { counts, rateLimitInfo };
    } catch (error) {
        console.warn('Error fetching all PR counts:', error);
        return { counts: defaultCounts, rateLimitInfo };
    }
}

// Display Functions
function displayResults(prs: PullRequest[], fromDate: string, toDate: string, allPRCounts: AllPRCounts): void {
    const merged = prs.filter(pr => pr.merged_at !== null);
    const closed = prs.filter(pr => pr.state === 'closed' && pr.merged_at === null);
    const open = prs.filter(pr => pr.state === 'open');

    const mergeRate = prs.length > 0
        ? Math.round((merged.length / prs.length) * 100)
        : 0;

    // Helper function to create ratio HTML with large numerator and small denominator
    const createRatioHtml = (copilotCount: number, totalCount: number, colorClass: string): string => {
        if (totalCount > 0) {
            return `<span class="text-4xl font-bold ${colorClass}">${copilotCount}</span><span class="text-lg text-slate-500 dark:text-slate-400 ml-1">/ ${totalCount}</span>`;
        }
        return `<span class="text-4xl font-bold ${colorClass}">${copilotCount}</span><span class="text-lg text-slate-500 dark:text-slate-400 ml-1">/ -</span>`;
    };

    // Update summary cards with ratio display
    const totalPRsEl = document.getElementById('totalPRs');
    const mergedPRsEl = document.getElementById('mergedPRs');
    const closedPRsEl = document.getElementById('closedPRs');
    const openPRsEl = document.getElementById('openPRs');

    if (totalPRsEl) totalPRsEl.innerHTML = createRatioHtml(prs.length, allPRCounts.total, 'text-slate-800 dark:text-slate-100');
    if (mergedPRsEl) mergedPRsEl.innerHTML = createRatioHtml(merged.length, allPRCounts.merged, 'text-green-700 dark:text-green-400');
    if (closedPRsEl) closedPRsEl.innerHTML = createRatioHtml(closed.length, allPRCounts.closed, 'text-red-600 dark:text-red-400');
    if (openPRsEl) openPRsEl.innerHTML = createRatioHtml(open.length, allPRCounts.open, 'text-blue-600 dark:text-blue-400');

    // Update merge rate
    const mergeRateValueEl = document.getElementById('mergeRateValue');
    const mergeRateTextEl = document.getElementById('mergeRateText');
    const mergeRateBarEl = document.getElementById('mergeRateBar') as HTMLElement | null;

    if (mergeRateValueEl) mergeRateValueEl.textContent = `${mergeRate}%`;
    if (mergeRateTextEl) mergeRateTextEl.textContent = `${mergeRate}%`;
    if (mergeRateBarEl) mergeRateBarEl.style.width = `${mergeRate}%`;

    // Display chart with date range passed from form submission
    displayChart(prs, fromDate, toDate);

    // Display PR list
    displayPRList(prs);

    showResults();
}

function displayChart(prs: PullRequest[], fromDate: string, toDate: string): void {
    // Group PRs by date
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

    // Generate all dates in the range (including days with no data)
    const dates: string[] = [];
    if (fromDate && toDate) {
        const startDate = new Date(fromDate);
        const endDate = new Date(toDate);

        // Use a new Date object for each iteration to avoid mutation issues
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            dates.push(currentDate.toISOString().split('T')[0]);
            currentDate.setDate(currentDate.getDate() + 1);
        }
    } else {
        // Fallback: use dates from PRs if date range is not available
        dates.push(...Object.keys(prsByDate).sort());
    }

    // Map data for all dates (0 for dates with no PRs)
    const mergedData = dates.map(date => prsByDate[date]?.merged ?? 0);
    const closedData = dates.map(date => prsByDate[date]?.closed ?? 0);
    const openData = dates.map(date => prsByDate[date]?.open ?? 0);

    const chartContainer = document.getElementById('prChart');
    if (!chartContainer) return;

    // Create canvas if it doesn't exist
    let canvas = chartContainer.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
    }

    // Destroy previous chart if exists
    if (chartInstance) {
        chartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#475569' : '#e2e8f0';

    chartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: dates.map(date => new Date(date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })),
            datasets: [
                {
                    label: 'Merged',
                    data: mergedData,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Closed',
                    data: closedData,
                    backgroundColor: 'rgba(239, 68, 68, 0.8)',
                    borderColor: 'rgba(239, 68, 68, 1)',
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Open',
                    data: openData,
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 2,
                    borderRadius: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: textColor,
                        padding: 20,
                        font: {
                            size: 12,
                            weight: 600
                        },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: textColor,
                    bodyColor: textColor,
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: textColor,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: gridColor
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: textColor,
                        precision: 0,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: gridColor
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

function updateChartTheme(): void {
    if (!chartInstance) return;

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#f1f5f9' : '#1e293b';
    const gridColor = isDark ? '#475569' : '#e2e8f0';

    if (chartInstance.options.plugins?.legend?.labels) {
        chartInstance.options.plugins.legend.labels.color = textColor;
    }
    if (chartInstance.options.plugins?.tooltip) {
        chartInstance.options.plugins.tooltip.backgroundColor = isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)';
        chartInstance.options.plugins.tooltip.titleColor = textColor;
        chartInstance.options.plugins.tooltip.bodyColor = textColor;
        chartInstance.options.plugins.tooltip.borderColor = isDark ? '#334155' : '#e2e8f0';
    }
    if (chartInstance.options.scales?.x?.ticks) {
        chartInstance.options.scales.x.ticks.color = textColor;
    }
    if (chartInstance.options.scales?.x?.grid) {
        chartInstance.options.scales.x.grid.color = gridColor;
    }
    if (chartInstance.options.scales?.y?.ticks) {
        chartInstance.options.scales.y.ticks.color = textColor;
    }
    if (chartInstance.options.scales?.y?.grid) {
        chartInstance.options.scales.y.grid.color = gridColor;
    }

    chartInstance.update();
}

function displayPRList(prs: PullRequest[]): void {
    const prList = document.getElementById('prList');
    if (!prList) return;

    prList.innerHTML = '';

    if (prs.length === 0) {
        prList.innerHTML = `
            <div class="text-center py-16">
                <svg class="w-16 h-16 mx-auto mb-4 text-slate-400 dark:text-slate-500" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p class="text-slate-600 dark:text-slate-400">No PRs created by Copilot Coding Agent found</p>
            </div>
        `;
        return;
    }

    // Sort PRs by created date (newest first)
    const sortedPRs = [...prs].sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    sortedPRs.forEach((pr) => {
        const createdDate = new Date(pr.created_at).toLocaleDateString('ja-JP');
        const status: keyof StatusConfigMap = pr.merged_at ? 'merged' : pr.state;
        const statusConfig: StatusConfigMap = {
            merged: {
                class: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
                text: 'Merged'
            },
            closed: {
                class: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
                icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
                text: 'Closed'
            },
            open: {
                class: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>`,
                text: 'Open'
            }
        };

        const config = statusConfig[status];

        // Validate PR number - use Number.isSafeInteger since pr.number is typed as number
        // Display empty string for invalid numbers to avoid showing misleading "#0"
        const prNumberDisplay = Number.isSafeInteger(pr.number) && pr.number > 0 ? `#${pr.number}` : '';

        const prElement = document.createElement('div');
        prElement.className = 'p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400';
        prElement.innerHTML = `
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
                   title="GitHubで開く">
                    <svg class="w-4 h-4 text-slate-500 dark:text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                </a>
            </div>
            <h3 class="font-semibold text-slate-800 dark:text-slate-100 mb-2 pr-8">${escapeHtml(pr.title)}</h3>
            <div class="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                <span class="flex items-center gap-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    ${escapeHtml(pr.user.login)}
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
        prList.appendChild(prElement);
    });
}

function escapeHtml(text: string | null | undefined): string {
    if (text == null) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Sanitize URL to prevent XSS attacks - only allows HTTPS URLs from github.com
function sanitizeUrl(url: string | null | undefined): string {
    if (url == null) return '#';
    try {
        const parsedUrl = new URL(String(url).trim());
        // Only allow HTTPS GitHub URLs using URL constructor validation
        // The URL constructor normalizes and encodes the URL, so no additional escaping needed
        if (parsedUrl.protocol === 'https:' && parsedUrl.hostname === 'github.com') {
            return parsedUrl.href;
        }
    } catch {
        // Invalid URL
    }
    return '#';
}

// UI State Management
function showLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.classList.remove('hidden');
    }
}

function hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
}

function showError(message: string): void {
    const errorEl = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    if (errorEl && errorMessage) {
        errorMessage.textContent = message;
        errorEl.classList.remove('hidden');
    }
}

function hideError(): void {
    const errorEl = document.getElementById('error');
    if (errorEl) errorEl.classList.add('hidden');
}

function showResults(): void {
    const results = document.getElementById('results');
    if (results) {
        results.classList.remove('hidden');
    }
}

function hideResults(): void {
    const results = document.getElementById('results');
    if (results) results.classList.add('hidden');
}

// Rate Limit Display Functions
function formatCountdown(resetTimestamp: number): string {
    const now = Date.now();
    const diffMs = resetTimestamp * 1000 - now;
    const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
    const minutes = Math.floor(diffSecs / 60);
    const seconds = diffSecs % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function startRateLimitCountdown(resetTimestamp: number): void {
    // Clear any existing countdown
    if (rateLimitCountdownInterval !== null) {
        clearInterval(rateLimitCountdownInterval);
        rateLimitCountdownInterval = null;
    }

    const countdownEl = document.getElementById('rateLimitCountdown');
    if (!countdownEl) return;

    // Update countdown every second
    const updateCountdown = () => {
        const countdown = formatCountdown(resetTimestamp);
        countdownEl.textContent = countdown;

        // Stop countdown when it reaches 0:00
        if (countdown === '0:00' && rateLimitCountdownInterval !== null) {
            clearInterval(rateLimitCountdownInterval);
            rateLimitCountdownInterval = null;
        }
    };

    // Initial update
    updateCountdown();

    // Update every second
    rateLimitCountdownInterval = window.setInterval(updateCountdown, 1000);
}

function displayRateLimitInfo(info: RateLimitInfo, fromCache: boolean): void {
    const rateLimitEl = document.getElementById('rateLimitInfo');
    if (!rateLimitEl) return;

    const resetCountdown = formatCountdown(info.reset);
    const usagePercent = Math.round((info.used / info.limit) * 100);

    // Determine if authenticated based on limit (10 = unauthenticated, 30 = authenticated for search)
    const isAuthenticated = info.limit > 10;
    const authStatusBadge = isAuthenticated
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Authenticated</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">Unauthenticated</span>';

    // Determine status color based on remaining requests
    let statusClass: string;
    let statusText: string;
    let statusBgClass: string;
    if (info.remaining > info.limit * 0.5) {
        statusClass = 'text-green-600 dark:text-green-400';
        statusBgClass = 'bg-green-100 dark:bg-green-900/30';
        statusText = 'Good';
    } else if (info.remaining > info.limit * 0.2) {
        statusClass = 'text-yellow-600 dark:text-yellow-400';
        statusBgClass = 'bg-yellow-100 dark:bg-yellow-900/30';
        statusText = 'Warning';
    } else {
        statusClass = 'text-red-600 dark:text-red-400';
        statusBgClass = 'bg-red-100 dark:bg-red-900/30';
        statusText = 'Low';
    }

    const cacheIndicator = fromCache
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">Cached</span>'
        : '';

    rateLimitEl.innerHTML = `
        <div class="space-y-3">
            <!-- Header -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium text-slate-700 dark:text-slate-200">GitHub Search API</span>
                    ${authStatusBadge}
                    ${cacheIndicator}
                </div>
                <span class="inline-flex items-center px-2 py-1 rounded text-xs font-medium ${statusClass} ${statusBgClass}">${statusText}</span>
            </div>

            <!-- Progress Section -->
            <div class="space-y-2">
                <div class="flex justify-between items-baseline">
                    <div class="text-lg font-semibold text-slate-800 dark:text-slate-100">
                        <span class="${info.remaining <= info.limit * 0.2 ? 'text-red-600 dark:text-red-400' : ''}">${info.remaining}</span>
                        <span class="text-sm font-normal text-slate-500 dark:text-slate-400">/ ${info.limit} remaining</span>
                    </div>
                    <div class="text-right">
                        <div class="text-xs text-slate-500 dark:text-slate-400">Resets in</div>
                        <div id="rateLimitCountdown" class="text-sm font-mono font-medium text-slate-700 dark:text-slate-200">${resetCountdown}</div>
                    </div>
                </div>
                <div class="relative h-2.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div class="absolute left-0 top-0 h-full rounded-full transition-all duration-300 ${info.remaining > info.limit * 0.5 ? 'bg-green-500' : info.remaining > info.limit * 0.2 ? 'bg-yellow-500' : 'bg-red-500'}" style="width: ${100 - usagePercent}%"></div>
                </div>
            </div>

            <!-- Info Section -->
            <div class="pt-2 border-t border-slate-200 dark:border-slate-700">
                <div class="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                    ${fromCache
                        ? '<p>📦 Data loaded from cache (5 min TTL). No API call made.</p>'
                        : `<p>🔄 Used ${info.used} requests this minute</p>`
                    }
                    <p class="flex items-start gap-1">
                        <span class="shrink-0">💡</span>
                        <span>${isAuthenticated
                            ? 'Authenticated with Personal Access Token. Search API allows up to 30 requests/min.'
                            : 'Limited to 10 requests/min without authentication. Set up a <a href="https://docs.github.com/en/rest/search/search#rate-limit" target="_blank" rel="noopener noreferrer" class="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer">PAT</a> to increase to 30 requests/min.'
                        }</span>
                    </p>
                </div>
            </div>
        </div>
    `;
    rateLimitEl.classList.remove('hidden');

    // Start countdown timer
    startRateLimitCountdown(info.reset);
}

function hideRateLimitInfo(): void {
    // Clear countdown timer
    if (rateLimitCountdownInterval !== null) {
        clearInterval(rateLimitCountdownInterval);
        rateLimitCountdownInterval = null;
    }
    const rateLimitEl = document.getElementById('rateLimitInfo');
    if (rateLimitEl) rateLimitEl.classList.add('hidden');
}
