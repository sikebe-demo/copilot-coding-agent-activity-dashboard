// Import Chart.js types only (actual library loaded dynamically for code splitting)
import type { Chart } from 'chart.js';

// Type alias for the Chart.js constructor (avoids typeof on a type-only import)
type ChartStatic = typeof Chart;

// Import pure functions and types from lib
import {
    parseRepoInput,
    validateDateRange,
    getCacheKey,
    getFromCache,
    saveToCache,
    clearOldCache,
    extractRateLimitInfo,
    formatCountdown,
    getPageNumbersToShow,
    classifyPRs,
    prepareChartData,
    getApiErrorMessage,
    convertSearchItemsToPRs,
    buildSearchQuery,
    buildSearchUrl,
    buildApiHeaders,
    createRatioHtml,
    sortPRsByDate,
    filterPRs,
    generatePRItemHtml,
    generateEmptyListHtml,
    generateFilteredEmptyListHtml,
    sanitizeUrl,
    ITEMS_PER_PAGE,
    CHART_COLORS,
    getChartTheme,
    FILTER_STYLE_MAP,
    FILTER_INACTIVE_STYLE,
    getAllFilterColorClasses,
    generateRateLimitHtml,
} from './lib';

import type {
    PullRequest,
    RateLimitInfo,
    AllPRCounts,
    SearchResponse,
    PRFilterStatus,
} from './lib';

// Consolidated application state
interface AppState {
    rateLimitCountdownInterval: number | null;
    currentRequestId: number;
    chartInstance: Chart | null;
    ChartCtor: ChartStatic | null;
    currentPage: number;
    currentPRs: PullRequest[];
    allFetchedPRs: PullRequest[];
    activeStatusFilter: PRFilterStatus;
    activeSearchText: string;
    currentAbortController: AbortController | null;
}

const state: AppState = {
    rateLimitCountdownInterval: null,
    currentRequestId: 0,
    chartInstance: null,
    ChartCtor: null,
    currentPage: 1,
    currentPRs: [],
    allFetchedPRs: [],
    activeStatusFilter: 'all',
    activeSearchText: '',
    currentAbortController: null,
};

// Cached DOM element references (populated once at DOMContentLoaded)
interface DOMElements {
    searchForm: HTMLFormElement | null;
    repoInput: HTMLInputElement | null;
    fromDate: HTMLInputElement | null;
    toDate: HTMLInputElement | null;
    tokenInput: HTMLInputElement | null;
    loading: HTMLElement | null;
    error: HTMLElement | null;
    errorMessage: HTMLElement | null;
    results: HTMLElement | null;
    totalPRs: HTMLElement | null;
    mergedPRs: HTMLElement | null;
    closedPRs: HTMLElement | null;
    openPRs: HTMLElement | null;
    mergeRateValue: HTMLElement | null;
    mergeRateText: HTMLElement | null;
    mergeRateBar: HTMLElement | null;
    prChart: HTMLElement | null;
    prList: HTMLElement | null;
    prPagination: HTMLElement | null;
    prSearchInput: HTMLInputElement | null;
    rateLimitInfo: HTMLElement | null;
    themeToggle: HTMLElement | null;
    loadingProgress: HTMLElement | null;
    loadingProgressBar: HTMLElement | null;
    loadingProgressText: HTMLElement | null;
    loadingTitle: HTMLElement | null;
    loadingMessage: HTMLElement | null;
}

const dom: DOMElements = {
    searchForm: null,
    repoInput: null,
    fromDate: null,
    toDate: null,
    tokenInput: null,
    loading: null,
    error: null,
    errorMessage: null,
    results: null,
    totalPRs: null,
    mergedPRs: null,
    closedPRs: null,
    openPRs: null,
    mergeRateValue: null,
    mergeRateText: null,
    mergeRateBar: null,
    prChart: null,
    prList: null,
    prPagination: null,
    prSearchInput: null,
    rateLimitInfo: null,
    themeToggle: null,
    loadingProgress: null,
    loadingProgressBar: null,
    loadingProgressText: null,
    loadingTitle: null,
    loadingMessage: null,
};

function cacheDOMElements(): void {
    dom.searchForm = document.getElementById('searchForm') as HTMLFormElement | null;
    dom.repoInput = document.getElementById('repoInput') as HTMLInputElement | null;
    dom.fromDate = document.getElementById('fromDate') as HTMLInputElement | null;
    dom.toDate = document.getElementById('toDate') as HTMLInputElement | null;
    dom.tokenInput = document.getElementById('tokenInput') as HTMLInputElement | null;
    dom.loading = document.getElementById('loading');
    dom.error = document.getElementById('error');
    dom.errorMessage = document.getElementById('errorMessage');
    dom.results = document.getElementById('results');
    dom.totalPRs = document.getElementById('totalPRs');
    dom.mergedPRs = document.getElementById('mergedPRs');
    dom.closedPRs = document.getElementById('closedPRs');
    dom.openPRs = document.getElementById('openPRs');
    dom.mergeRateValue = document.getElementById('mergeRateValue');
    dom.mergeRateText = document.getElementById('mergeRateText');
    dom.mergeRateBar = document.getElementById('mergeRateBar');
    dom.prChart = document.getElementById('prChart');
    dom.prList = document.getElementById('prList');
    dom.prPagination = document.getElementById('prPagination');
    dom.prSearchInput = document.getElementById('prSearchInput') as HTMLInputElement | null;
    dom.rateLimitInfo = document.getElementById('rateLimitInfo');
    dom.themeToggle = document.getElementById('themeToggle');
    dom.loadingProgress = document.getElementById('loadingProgress');
    dom.loadingProgressBar = document.getElementById('loadingProgressBar');
    dom.loadingProgressText = document.getElementById('loadingProgressText');
    dom.loadingTitle = document.getElementById('loadingTitle');
    dom.loadingMessage = document.getElementById('loadingMessage');
}

/**
 * Lazily load Chart.js with only the components needed for bar charts.
 * This enables code splitting — Chart.js (~180 KB) is downloaded only when
 * the user actually views results, not on initial page load.
 */
async function loadChartJS(): Promise<ChartStatic> {
    if (state.ChartCtor) return state.ChartCtor;
    const {
        Chart: ChartJS,
        BarController,
        BarElement,
        CategoryScale,
        LinearScale,
        Tooltip,
        Legend,
    } = await import('chart.js');
    ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);
    state.ChartCtor = ChartJS;
    return ChartJS;
}

// Default loading text (shared between index.html initial state and resetLoadingProgress)
const DEFAULT_LOADING_TITLE = 'Fetching data...';
const DEFAULT_LOADING_MESSAGE = 'Loading PR information from GitHub API';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    initializeTheme();
    initializeForm();
    initializeFilters();
    setDefaultDates();
});

// Theme Management
function initializeTheme(): void {
    const savedTheme = localStorage.getItem('theme') || 'light';

    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // Set initial aria-label reflecting current state
    updateThemeToggleLabel();

    dom.themeToggle?.addEventListener('click', toggleTheme);
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

    // Update theme toggle button label
    updateThemeToggleLabel();

    // Update chart if it exists
    if (state.chartInstance) {
        updateChartTheme();
    }
}

function updateThemeToggleLabel(): void {
    if (!dom.themeToggle) return;
    const isDark = document.documentElement.classList.contains('dark');
    dom.themeToggle.setAttribute(
        'aria-label',
        isDark
            ? 'Switch to light mode (currently dark mode)'
            : 'Switch to dark mode (currently light mode)'
    );
}

// Set default dates (last 30 days)
function setDefaultDates(): void {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);

    if (dom.toDate) dom.toDate.valueAsDate = toDate;
    if (dom.fromDate) dom.fromDate.valueAsDate = fromDate;
}

// Form initialization
function initializeForm(): void {
    dom.searchForm?.addEventListener('submit', handleFormSubmit);
    initializePresetRepos();
}

// Preset repository buttons
function initializePresetRepos(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.preset-repo-btn');

    if (!dom.repoInput) {
        return;
    }

    const repoInput = dom.repoInput;
    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            const repo = button.dataset.repo;
            if (repo) {
                repoInput.value = repo;
                repoInput.focus();
            }
        });
    });
}

// PR List Filter initialization
function initializeFilters(): void {
    // Status filter buttons
    const filterButtons = document.querySelectorAll<HTMLButtonElement>('.pr-filter-btn');
    filterButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const filter = button.dataset.filter as PRFilterStatus | undefined;
            if (filter) {
                state.activeStatusFilter = filter;
                updateFilterButtonStyles();
                applyFilters();
            }
        });
    });

    // Text search input with debounce
    let debounceTimer: number | null = null;
    dom.prSearchInput?.addEventListener('input', () => {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            state.activeSearchText = dom.prSearchInput?.value ?? '';
            applyFilters();
        }, 300);
    });
}

function applyFilters(): void {
    if (state.allFetchedPRs.length === 0) return;
    displayPRList(state.allFetchedPRs, true);
}

function resetFilterUI(): void {
    // Reset search input
    if (dom.prSearchInput) dom.prSearchInput.value = '';

    // Reset button styles
    updateFilterButtonStyles();
}

function updateFilterButtonStyles(): void {
    const filterButtons = document.querySelectorAll<HTMLButtonElement>('.pr-filter-btn');
    const allClasses = getAllFilterColorClasses();

    filterButtons.forEach((button) => {
        const filter = button.dataset.filter ?? '';
        const isActive = filter === state.activeStatusFilter;
        const styleConfig = FILTER_STYLE_MAP[filter as PRFilterStatus];

        // Remove all color-related classes
        button.classList.remove(...allClasses);

        if (isActive && styleConfig) {
            button.classList.add(...styleConfig.active.split(' '));
        } else {
            button.classList.add(...FILTER_INACTIVE_STYLE.split(' '));
            if (styleConfig) {
                button.classList.add(...styleConfig.hover.split(' '));
            }
        }

        button.setAttribute('aria-pressed', String(isActive));
    });
}

async function handleFormSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const repoInput = dom.repoInput?.value.trim() ?? '';
    const fromDate = dom.fromDate?.value ?? '';
    const toDate = dom.toDate?.value ?? '';
    const token = dom.tokenInput?.value.trim() ?? '';

    const parseResult = parseRepoInput(repoInput);
    if (typeof parseResult === 'string') {
        showError(parseResult);
        return;
    }
    const { owner, repo } = parseResult;

    const dateError = validateDateRange(fromDate, toDate);
    if (dateError) {
        showError(dateError);
        return;
    }

    showLoading();
    hideError();
    hideResults();
    hideRateLimitInfo();

    // Abort any in-flight requests from previous search
    if (state.currentAbortController) {
        state.currentAbortController.abort();
    }
    state.currentAbortController = new AbortController();

    const requestId = ++state.currentRequestId;

    try {
        const result = await fetchCopilotPRsWithCache(owner, repo, fromDate, toDate, token, state.currentAbortController.signal);
        // Ignore stale responses from earlier searches
        if (requestId !== state.currentRequestId) return;
        await displayResults(result.prs, fromDate, toDate, result.allPRCounts);
        if (result.rateLimitInfo) {
            displayRateLimitInfo(result.rateLimitInfo, result.fromCache);
        }
    } catch (error) {
        // Ignore errors from stale requests
        if (requestId !== state.currentRequestId) return;
        // Ignore AbortError — it means we intentionally cancelled a previous request
        if (error instanceof DOMException && error.name === 'AbortError') return;
        showError(error instanceof Error ? error.message : 'An unknown error occurred');
    } finally {
        if (requestId === state.currentRequestId) {
            hideLoading();
        }
    }
}

// GitHub API Functions

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
    token: string,
    signal: AbortSignal
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
        updateLoadingPhase('Loading from cache...', 'Using cached data from previous request');
        return {
            prs: cached.data,
            rateLimitInfo: cached.rateLimitInfo,
            fromCache: true,
            allPRCounts: cached.allPRCounts
        };
    }

    const result = await fetchCopilotPRsWithSearchAPI(owner, repo, fromDate, toDate, token, signal);

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
    token: string,
    signal: AbortSignal
): Promise<{ prs: PullRequest[]; rateLimitInfo: RateLimitInfo | null; allPRCounts: AllPRCounts }> {
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
    updateLoadingPhase('Fetching Copilot PRs...', 'Searching for PRs created by Copilot Coding Agent');

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
        updateLoadingProgress(allPRs.length, totalCount, `Fetched ${allPRs.length} of ${totalCount} Copilot PRs`);

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

    // Update phase for fetching all PR counts
    updateLoadingPhase('Fetching repository stats...', 'Loading PR statistics for comparison');

    // Fetch all PR counts (total, merged, closed, open) for all authors
    const allPRCounts = await fetchAllPRCounts(owner, repo, fromDate, toDate, headers, rateLimitInfo, signal);

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
        // This allows all requests to complete even if some fail
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
        console.warn('Error fetching all PR counts:', error);
        return { counts: defaultCounts, rateLimitInfo };
    }
}

// Display Functions
async function displayResults(prs: PullRequest[], fromDate: string, toDate: string, allPRCounts: AllPRCounts): Promise<void> {
    const counts = classifyPRs(prs);

    // Update summary cards with ratio display
    if (dom.totalPRs) dom.totalPRs.innerHTML = createRatioHtml(counts.total, allPRCounts.total, 'text-slate-800 dark:text-slate-100');
    if (dom.mergedPRs) dom.mergedPRs.innerHTML = createRatioHtml(counts.merged, allPRCounts.merged, 'text-green-700 dark:text-green-400');
    if (dom.closedPRs) dom.closedPRs.innerHTML = createRatioHtml(counts.closed, allPRCounts.closed, 'text-red-600 dark:text-red-400');
    if (dom.openPRs) dom.openPRs.innerHTML = createRatioHtml(counts.open, allPRCounts.open, 'text-blue-600 dark:text-blue-400');

    // Update merge rate
    if (dom.mergeRateValue) dom.mergeRateValue.textContent = `${counts.mergeRate}%`;
    if (dom.mergeRateText) dom.mergeRateText.textContent = `${counts.mergeRate}%`;
    if (dom.mergeRateBar) {
        (dom.mergeRateBar as HTMLElement).style.width = `${counts.mergeRate}%`;
        dom.mergeRateBar.setAttribute('aria-valuenow', String(counts.mergeRate));
    }

    // Display chart with date range passed from form submission
    await displayChart(prs, fromDate, toDate);

    // Store all fetched PRs for filtering and reset filter state
    state.allFetchedPRs = sortPRsByDate(prs);
    state.activeStatusFilter = 'all';
    state.activeSearchText = '';
    resetFilterUI();

    // Display PR list
    displayPRList(state.allFetchedPRs);

    showResults();
}

async function displayChart(prs: PullRequest[], fromDate: string, toDate: string): Promise<void> {
    const { dates, mergedData, closedData, openData } = prepareChartData(prs, fromDate, toDate);

    const chartContainer = dom.prChart;
    if (!chartContainer) return;

    // Dynamically load Chart.js (only the bar-chart components)
    const ChartJS = await loadChartJS();

    // Create canvas if it doesn't exist
    let canvas = chartContainer.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
    }

    // Accessibility: provide role, label, and detailed description for screen readers
    const descriptionId = 'pr-chart-description';
    let descriptionElement = chartContainer.querySelector<HTMLDivElement>('#' + descriptionId);
    if (!descriptionElement) {
        descriptionElement = document.createElement('div');
        descriptionElement.id = descriptionId;
        // Visually hidden but available to screen readers
        descriptionElement.style.position = 'absolute';
        descriptionElement.style.width = '1px';
        descriptionElement.style.height = '1px';
        descriptionElement.style.padding = '0';
        descriptionElement.style.margin = '-1px';
        descriptionElement.style.overflow = 'hidden';
        descriptionElement.style.clip = 'rect(0, 0, 0, 0)';
        descriptionElement.style.whiteSpace = 'nowrap';
        descriptionElement.style.border = '0';
        chartContainer.appendChild(descriptionElement);
    }
    descriptionElement.textContent = `Chart: Daily PR trend for ${prs.length} pull requests from ${fromDate} to ${toDate}. Displays daily counts of merged, closed, and open pull requests.`;

    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Daily PR trend chart showing ${prs.length} pull requests from ${fromDate} to ${toDate}`);
    canvas.setAttribute('aria-describedby', descriptionId);

    // Destroy previous chart if exists
    if (state.chartInstance) {
        state.chartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    state.chartInstance = new ChartJS(canvas, {
        type: 'bar',
        data: {
            labels: dates.map(date => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
            datasets: [
                {
                    label: 'Merged',
                    data: mergedData,
                    backgroundColor: CHART_COLORS.merged.backgroundColor,
                    borderColor: CHART_COLORS.merged.borderColor,
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Closed',
                    data: closedData,
                    backgroundColor: CHART_COLORS.closed.backgroundColor,
                    borderColor: CHART_COLORS.closed.borderColor,
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Open',
                    data: openData,
                    backgroundColor: CHART_COLORS.open.backgroundColor,
                    borderColor: CHART_COLORS.open.borderColor,
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
                        color: theme.textColor,
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
                    backgroundColor: theme.tooltipBg,
                    titleColor: theme.textColor,
                    bodyColor: theme.textColor,
                    borderColor: theme.tooltipBorder,
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: theme.textColor,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: theme.gridColor
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: theme.textColor,
                        precision: 0,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: theme.gridColor
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
    if (!state.chartInstance) return;

    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    if (state.chartInstance.options.plugins?.legend?.labels) {
        state.chartInstance.options.plugins.legend.labels.color = theme.textColor;
    }
    if (state.chartInstance.options.plugins?.tooltip) {
        state.chartInstance.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
        state.chartInstance.options.plugins.tooltip.titleColor = theme.textColor;
        state.chartInstance.options.plugins.tooltip.bodyColor = theme.textColor;
        state.chartInstance.options.plugins.tooltip.borderColor = theme.tooltipBorder;
    }
    if (state.chartInstance.options.scales?.x?.ticks) {
        state.chartInstance.options.scales.x.ticks.color = theme.textColor;
    }
    if (state.chartInstance.options.scales?.x?.grid) {
        state.chartInstance.options.scales.x.grid.color = theme.gridColor;
    }
    if (state.chartInstance.options.scales?.y?.ticks) {
        state.chartInstance.options.scales.y.ticks.color = theme.textColor;
    }
    if (state.chartInstance.options.scales?.y?.grid) {
        state.chartInstance.options.scales.y.grid.color = theme.gridColor;
    }

    state.chartInstance.update();
}

function displayPRList(prs: PullRequest[], resetPage = true): void {
    const prList = dom.prList;
    if (!prList) return;

    // Apply filters and store globally, resetting page if needed
    if (resetPage) {
        state.currentPRs = sortPRsByDate(filterPRs(prs, state.activeStatusFilter, state.activeSearchText));
        state.currentPage = 1;
    }

    prList.innerHTML = '';

    if (state.currentPRs.length === 0) {
        const isFiltered = state.activeStatusFilter !== 'all' || state.activeSearchText.trim() !== '';
        prList.innerHTML = isFiltered ? generateFilteredEmptyListHtml() : generateEmptyListHtml();
        displayPagination(0, 0);
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(state.currentPRs.length / ITEMS_PER_PAGE);
    const startIndex = (state.currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, state.currentPRs.length);
    const paginatedPRs = state.currentPRs.slice(startIndex, endIndex);

    paginatedPRs.forEach((pr) => {
        const prElement = document.createElement('div');
        const sanitizedUrl = sanitizeUrl(pr.html_url);
        const hasValidUrl = sanitizedUrl !== '#';

        const baseClasses =
            'p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 border-2 border-slate-200 dark:border-slate-700 transition-all';
        const interactiveClasses =
            ' hover:border-indigo-500 dark:hover:border-indigo-400 cursor-pointer hover:shadow-md';

        prElement.className = hasValidUrl ? baseClasses + interactiveClasses : baseClasses;

        if (hasValidUrl) {
            prElement.setAttribute('data-url', sanitizedUrl);
            prElement.setAttribute('role', 'link');
            prElement.setAttribute('aria-label', `Open pull request: ${pr.title || 'Untitled'}`);
            prElement.setAttribute('tabindex', '0');

            const openPR = () => {
                const url = prElement.getAttribute('data-url');
                if (url) {
                    window.open(url, '_blank', 'noopener,noreferrer');
                }
            };

            prElement.addEventListener('click', (e) => {
                // Don't navigate if user clicked on the existing icon link itself
                const target = e.target;
                if (target instanceof Element && target.closest('a')) return;
                openPR();
            });
            prElement.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openPR();
                }
            });
        } else {
            prElement.setAttribute('aria-label', `Pull request (no link available): ${pr.title || 'Untitled'}`);
        }

        // Set PR item HTML directly on the element
        prElement.innerHTML = generatePRItemHtml(pr);

        if (hasValidUrl) {
            // Add hover color styles to the PR title only when the item is interactive
            const titleEl = prElement.querySelector('h3');
            if (titleEl) {
                titleEl.classList.add('hover:text-indigo-600', 'dark:hover:text-indigo-400');
            }
            // Replace inner anchors with non-interactive spans to avoid nested link semantics
            const innerLinks = prElement.querySelectorAll('a');
            innerLinks.forEach((anchor) => {
                const span = document.createElement('span');
                span.className = anchor.className;
                span.innerHTML = anchor.innerHTML;
                anchor.replaceWith(span);
            });
        } else {
            // Remove or neutralize any anchors that point to "#" so they are not focusable fake links
            const placeholderLinks = prElement.querySelectorAll('a[href="#"]');
            placeholderLinks.forEach((anchor) => {
                const span = document.createElement('span');
                // Copy only non-interactive classes so the icon/text doesn't look clickable
                const filteredClasses = anchor.className
                    .split(/\s+/)
                    .filter(
                        (cls) =>
                            cls &&
                            !cls.startsWith('cursor-') &&
                            !cls.startsWith('hover:') &&
                            !cls.startsWith('focus:')
                    )
                    .join(' ');
                span.className = filteredClasses;
                span.innerHTML = anchor.innerHTML;
                anchor.replaceWith(span);
            });
        }
        prList.appendChild(prElement);
    });

    // Display pagination
    displayPagination(totalPages, state.currentPRs.length);
}

function displayPagination(totalPages: number, totalItems: number): void {
    const paginationContainer = dom.prPagination;
    if (!paginationContainer) return;

    paginationContainer.innerHTML = '';

    if (totalPages <= 1) {
        return;
    }

    const startItem = (state.currentPage - 1) * ITEMS_PER_PAGE + 1;
    const endItem = Math.min(state.currentPage * ITEMS_PER_PAGE, totalItems);

    const navEl = document.createElement('nav');
    navEl.setAttribute('aria-label', 'PR list pagination');

    const paginationEl = document.createElement('div');
    paginationEl.className = 'flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-slate-200 dark:border-slate-700';

    // Page info
    const pageInfo = document.createElement('div');
    pageInfo.className = 'text-sm text-slate-600 dark:text-slate-400';
    pageInfo.textContent = `${startItem}-${endItem} of ${totalItems}`;

    // Navigation buttons
    const navContainer = document.createElement('div');
    navContainer.className = 'flex items-center gap-2';

    // Previous button
    const prevButton = document.createElement('button');
    prevButton.className = `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        state.currentPage === 1
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer'
    }`;
    prevButton.setAttribute('aria-label', 'Previous page');
    prevButton.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
    `;
    prevButton.disabled = state.currentPage === 1;
    prevButton.addEventListener('click', () => goToPage(state.currentPage - 1));

    // Page numbers
    const pageNumbers = document.createElement('div');
    pageNumbers.className = 'flex items-center gap-1';

    const pagesToShow = getPageNumbersToShow(state.currentPage, totalPages);
    pagesToShow.forEach((page) => {
        if (page === '...') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'px-2 text-slate-400 dark:text-slate-600';
            ellipsis.setAttribute('aria-hidden', 'true');
            ellipsis.textContent = '...';
            pageNumbers.appendChild(ellipsis);
        } else {
            const pageButton = document.createElement('button');
            const pageNum = page as number;
            pageButton.className = `w-9 h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                pageNum === state.currentPage
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`;
            pageButton.textContent = String(pageNum);
            pageButton.setAttribute('aria-label', `Page ${pageNum}`);
            if (pageNum === state.currentPage) {
                pageButton.setAttribute('aria-current', 'page');
            }
            pageButton.addEventListener('click', () => goToPage(pageNum));
            pageNumbers.appendChild(pageButton);
        }
    });

    // Next button
    const nextButton = document.createElement('button');
    nextButton.className = `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        state.currentPage === totalPages
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer'
    }`;
    nextButton.setAttribute('aria-label', 'Next page');
    nextButton.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    nextButton.disabled = state.currentPage === totalPages;
    nextButton.addEventListener('click', () => goToPage(state.currentPage + 1));

    navContainer.appendChild(prevButton);
    navContainer.appendChild(pageNumbers);
    navContainer.appendChild(nextButton);

    paginationEl.appendChild(pageInfo);
    paginationEl.appendChild(navContainer);
    navEl.appendChild(paginationEl);
    paginationContainer.appendChild(navEl);
}

function goToPage(page: number): void {
    const totalPages = Math.ceil(state.currentPRs.length / ITEMS_PER_PAGE);
    if (page < 1 || page > totalPages) return;

    state.currentPage = page;
    displayPRList(state.currentPRs, false);

    // Scroll to PR list section
    if (dom.prList) {
        dom.prList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// UI State Management
function showLoading(): void {
    if (dom.loading) {
        dom.loading.classList.remove('hidden');
    }
    // Reset progress display
    resetLoadingProgress();
}

function hideLoading(): void {
    if (dom.loading) dom.loading.classList.add('hidden');
    // Reset progress display
    resetLoadingProgress();
}

function resetLoadingProgress(): void {
    if (dom.loadingProgress) dom.loadingProgress.classList.add('hidden');
    if (dom.loadingProgressBar) {
        (dom.loadingProgressBar as HTMLElement).style.width = '0%';
        dom.loadingProgressBar.setAttribute('aria-valuenow', '0');
    }
    if (dom.loadingProgressText) dom.loadingProgressText.textContent = '';
    if (dom.loadingTitle) dom.loadingTitle.textContent = DEFAULT_LOADING_TITLE;
    if (dom.loadingMessage) dom.loadingMessage.textContent = DEFAULT_LOADING_MESSAGE;
}

function updateLoadingProgress(current: number, total: number, message: string): void {
    if (dom.loadingProgress) dom.loadingProgress.classList.remove('hidden');
    if (dom.loadingProgressBar && total > 0) {
        const percent = Math.min(Math.round((current / total) * 100), 100);
        (dom.loadingProgressBar as HTMLElement).style.width = `${percent}%`;
        dom.loadingProgressBar.setAttribute('aria-valuenow', String(percent));
    }
    if (dom.loadingProgressText) dom.loadingProgressText.textContent = `${current} / ${total}`;
    if (dom.loadingMessage) dom.loadingMessage.textContent = message;
}

function updateLoadingPhase(phase: string, message: string): void {
    if (dom.loadingTitle) dom.loadingTitle.textContent = phase;
    if (dom.loadingMessage) dom.loadingMessage.textContent = message;
}

function showError(message: string): void {
    if (dom.error && dom.errorMessage) {
        dom.errorMessage.textContent = message;
        dom.error.classList.remove('hidden');
    }
}

function hideError(): void {
    if (dom.error) dom.error.classList.add('hidden');
}

function showResults(): void {
    if (dom.results) {
        dom.results.classList.remove('hidden');
    }

    // Announce results to screen readers
    announceToScreenReader(`Results loaded. Found ${state.currentPRs.length} pull requests.`);
}

function announceToScreenReader(message: string): void {
    let announcer = document.getElementById('sr-announcer');
    if (!announcer) {
        announcer = document.createElement('div');
        announcer.id = 'sr-announcer';
        announcer.setAttribute('role', 'status');
        announcer.setAttribute('aria-live', 'polite');
        announcer.setAttribute('aria-atomic', 'true');
        announcer.className = 'sr-only';
        document.body.appendChild(announcer);
    }
    // Clear then set to ensure re-announcement
    announcer.textContent = '';
    requestAnimationFrame(() => {
        announcer!.textContent = message;
    });
}

function hideResults(): void {
    if (dom.results) dom.results.classList.add('hidden');
}

// Rate Limit Display Functions
function startRateLimitCountdown(resetTimestamp: number): void {
    // Clear any existing countdown
    if (state.rateLimitCountdownInterval !== null) {
        clearInterval(state.rateLimitCountdownInterval);
        state.rateLimitCountdownInterval = null;
    }

    const countdownEl = document.getElementById('rateLimitCountdown');
    if (!countdownEl) return;

    // Update countdown every second
    const updateCountdown = () => {
        const countdown = formatCountdown(resetTimestamp);
        countdownEl.textContent = countdown;

        // Stop countdown when it reaches 0:00
        if (countdown === '0:00' && state.rateLimitCountdownInterval !== null) {
            clearInterval(state.rateLimitCountdownInterval);
            state.rateLimitCountdownInterval = null;
        }
    };

    // Initial update
    updateCountdown();

    // Update every second
    state.rateLimitCountdownInterval = window.setInterval(updateCountdown, 1000);
}

function displayRateLimitInfo(info: RateLimitInfo, fromCache: boolean): void {
    if (!dom.rateLimitInfo) return;

    const resetCountdown = formatCountdown(info.reset);
    dom.rateLimitInfo.innerHTML = generateRateLimitHtml({ info, fromCache, resetCountdown });
    dom.rateLimitInfo.classList.remove('hidden');

    // Start countdown timer
    startRateLimitCountdown(info.reset);
}

function hideRateLimitInfo(): void {
    // Clear countdown timer
    if (state.rateLimitCountdownInterval !== null) {
        clearInterval(state.rateLimitCountdownInterval);
        state.rateLimitCountdownInterval = null;
    }
    if (dom.rateLimitInfo) dom.rateLimitInfo.classList.add('hidden');
}
