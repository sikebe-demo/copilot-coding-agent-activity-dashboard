// Import Chart.js from npm
import Chart from 'chart.js/auto';

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
    getRateLimitStatus,
    getPageNumbersToShow,
    classifyPRs,
    prepareChartData,
    getApiErrorMessage,
    convertSearchItemsToPRs,
    buildSearchQuery,
    buildSearchUrl,
    buildApiHeaders,
    adjustClosedCount,
    createRatioHtml,
    sortPRsByDate,
    filterPRs,
    generatePRItemHtml,
    generateEmptyListHtml,
    generateFilteredEmptyListHtml,
    ITEMS_PER_PAGE,
} from './lib';

import type {
    PullRequest,
    RateLimitInfo,
    AllPRCounts,
    SearchResponse,
    PRFilterStatus,
} from './lib';

// Timer for rate limit countdown
let rateLimitCountdownInterval: number | null = null;

// Request sequencing: ignore stale responses from earlier searches
let currentRequestId = 0;

// Global chart instance
let chartInstance: Chart | null = null;

// Pagination state
let currentPage = 1;
let currentPRs: PullRequest[] = [];

// Filter state
let allFetchedPRs: PullRequest[] = [];
let activeStatusFilter: PRFilterStatus = 'all';
let activeSearchText = '';

// Default loading text (shared between index.html initial state and resetLoadingProgress)
const DEFAULT_LOADING_TITLE = 'Fetching data...';
const DEFAULT_LOADING_MESSAGE = 'Loading PR information from GitHub API';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeForm();
    initializeFilters();
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
    initializePresetRepos();
}

// Preset repository buttons
function initializePresetRepos(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.preset-repo-btn');
    const repoInput = document.getElementById('repoInput') as HTMLInputElement | null;

    if (!repoInput) {
        return;
    }

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
                activeStatusFilter = filter;
                updateFilterButtonStyles();
                applyFilters();
            }
        });
    });

    // Text search input with debounce
    const searchInput = document.getElementById('prSearchInput') as HTMLInputElement | null;
    let debounceTimer: number | null = null;
    searchInput?.addEventListener('input', () => {
        if (debounceTimer !== null) clearTimeout(debounceTimer);
        debounceTimer = window.setTimeout(() => {
            activeSearchText = searchInput.value;
            applyFilters();
        }, 300);
    });
}

function applyFilters(): void {
    if (allFetchedPRs.length === 0) return;
    displayPRList(allFetchedPRs, true);
}

function resetFilterUI(): void {
    // Reset search input
    const searchInput = document.getElementById('prSearchInput') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';

    // Reset button styles
    updateFilterButtonStyles();
}

function updateFilterButtonStyles(): void {
    const filterButtons = document.querySelectorAll<HTMLButtonElement>('.pr-filter-btn');

    // Active & inactive style maps per filter type
    const activeStyles: Record<PRFilterStatus, string> = {
        all: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border-indigo-400 dark:border-indigo-500',
        merged: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-400 dark:border-green-500',
        closed: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-400 dark:border-red-500',
        open: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-400 dark:border-blue-500',
    };
    const inactiveStyle = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700';

    // Classes that should be removed when switching between states
    const allColorClasses = [
        'bg-indigo-100', 'dark:bg-indigo-900/30', 'text-indigo-700', 'dark:text-indigo-300', 'border-indigo-400', 'dark:border-indigo-500',
        'bg-green-100', 'dark:bg-green-900/30', 'text-green-700', 'dark:text-green-300', 'border-green-400', 'dark:border-green-500',
        'bg-red-100', 'dark:bg-red-900/30', 'text-red-700', 'dark:text-red-300', 'border-red-400', 'dark:border-red-500',
        'bg-blue-100', 'dark:bg-blue-900/30', 'text-blue-700', 'dark:text-blue-300', 'border-blue-400', 'dark:border-blue-500',
        'bg-slate-100', 'dark:bg-slate-800', 'text-slate-600', 'dark:text-slate-400', 'border-slate-200', 'dark:border-slate-700',
    ];

    // Hover classes that should be removed when a button is active
    const allHoverClasses = [
        'hover:bg-indigo-50', 'dark:hover:bg-indigo-900/20', 'hover:text-indigo-700', 'dark:hover:text-indigo-300', 'hover:border-indigo-300', 'dark:hover:border-indigo-500',
        'hover:bg-green-50', 'dark:hover:bg-green-900/20', 'hover:text-green-700', 'dark:hover:text-green-300', 'hover:border-green-300', 'dark:hover:border-green-600',
        'hover:bg-red-50', 'dark:hover:bg-red-900/20', 'hover:text-red-700', 'dark:hover:text-red-300', 'hover:border-red-300', 'dark:hover:border-red-600',
        'hover:bg-blue-50', 'dark:hover:bg-blue-900/20', 'hover:text-blue-700', 'dark:hover:text-blue-300', 'hover:border-blue-300', 'dark:hover:border-blue-600',
    ];

    // Hover classes for inactive buttons per filter type
    const hoverStyles: Record<string, string> = {
        all: 'hover:bg-indigo-50 dark:hover:bg-indigo-900/20 hover:text-indigo-700 dark:hover:text-indigo-300 hover:border-indigo-300 dark:hover:border-indigo-500',
        merged: 'hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-300 hover:border-green-300 dark:hover:border-green-600',
        closed: 'hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-300 hover:border-red-300 dark:hover:border-red-600',
        open: 'hover:bg-blue-50 dark:hover:bg-blue-900/20 hover:text-blue-700 dark:hover:text-blue-300 hover:border-blue-300 dark:hover:border-blue-600',
    };

    filterButtons.forEach((button) => {
        const filter = button.dataset.filter ?? '';
        const isActive = filter === activeStatusFilter;

        // Remove all color-related classes and hover classes
        button.classList.remove(...allColorClasses, ...allHoverClasses);

        // Add appropriate classes
        const classes = isActive ? (activeStyles[filter as PRFilterStatus] ?? inactiveStyle) : inactiveStyle;
        button.classList.add(...classes.split(' '));

        // Re-add hover classes only for inactive buttons
        if (!isActive && hoverStyles[filter]) {
            button.classList.add(...hoverStyles[filter].split(' '));
        }

        // Set aria-pressed for accessibility
        button.setAttribute('aria-pressed', String(isActive));
    });
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

    const requestId = ++currentRequestId;

    try {
        const result = await fetchCopilotPRsWithCache(owner, repo, fromDate, toDate, token);
        // Ignore stale responses from earlier searches
        if (requestId !== currentRequestId) return;
        displayResults(result.prs, fromDate, toDate, result.allPRCounts);
        if (result.rateLimitInfo) {
            displayRateLimitInfo(result.rateLimitInfo, result.fromCache);
        }
    } catch (error) {
        // Ignore errors from stale requests
        if (requestId !== currentRequestId) return;
        showError(error instanceof Error ? error.message : 'An unknown error occurred');
    } finally {
        if (requestId === currentRequestId) {
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
        // Show brief loading phase for cache
        updateLoadingPhase('Loading from cache...', 'Using cached data from previous request');
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

        const response = await fetch(url, { headers });

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
    // Track which queries succeeded to ensure correct closed calculation
    const succeeded = new Set<string>();

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
            rateLimitInfo = extractRateLimitInfo(response.headers) ?? rateLimitInfo;

            if (!response.ok) {
                console.warn(`Failed to fetch ${key} PR count:`, response.status);
                continue;
            }

            const searchResponse: SearchResponse = await response.json();
            counts[key] = searchResponse.total_count;
            succeeded.add(key);
        }

        // Adjust closed count to represent only "closed but not merged" PRs
        const adjustedCounts = adjustClosedCount(counts, succeeded);

        return { counts: adjustedCounts, rateLimitInfo };
    } catch (error) {
        console.warn('Error fetching all PR counts:', error);
        return { counts: defaultCounts, rateLimitInfo };
    }
}

// Display Functions
function displayResults(prs: PullRequest[], fromDate: string, toDate: string, allPRCounts: AllPRCounts): void {
    const counts = classifyPRs(prs);

    // Update summary cards with ratio display
    const totalPRsEl = document.getElementById('totalPRs');
    const mergedPRsEl = document.getElementById('mergedPRs');
    const closedPRsEl = document.getElementById('closedPRs');
    const openPRsEl = document.getElementById('openPRs');

    if (totalPRsEl) totalPRsEl.innerHTML = createRatioHtml(counts.total, allPRCounts.total, 'text-slate-800 dark:text-slate-100');
    if (mergedPRsEl) mergedPRsEl.innerHTML = createRatioHtml(counts.merged, allPRCounts.merged, 'text-green-700 dark:text-green-400');
    if (closedPRsEl) closedPRsEl.innerHTML = createRatioHtml(counts.closed, allPRCounts.closed, 'text-red-600 dark:text-red-400');
    if (openPRsEl) openPRsEl.innerHTML = createRatioHtml(counts.open, allPRCounts.open, 'text-blue-600 dark:text-blue-400');

    // Update merge rate
    const mergeRateValueEl = document.getElementById('mergeRateValue');
    const mergeRateTextEl = document.getElementById('mergeRateText');
    const mergeRateBarEl = document.getElementById('mergeRateBar') as HTMLElement | null;

    if (mergeRateValueEl) mergeRateValueEl.textContent = `${counts.mergeRate}%`;
    if (mergeRateTextEl) mergeRateTextEl.textContent = `${counts.mergeRate}%`;
    if (mergeRateBarEl) mergeRateBarEl.style.width = `${counts.mergeRate}%`;

    // Display chart with date range passed from form submission
    displayChart(prs, fromDate, toDate);

    // Store all fetched PRs for filtering and reset filter state
    allFetchedPRs = sortPRsByDate(prs);
    activeStatusFilter = 'all';
    activeSearchText = '';
    resetFilterUI();

    // Display PR list
    displayPRList(allFetchedPRs);

    showResults();
}

function displayChart(prs: PullRequest[], fromDate: string, toDate: string): void {
    const { dates, mergedData, closedData, openData } = prepareChartData(prs, fromDate, toDate);

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

function displayPRList(prs: PullRequest[], resetPage = true): void {
    const prList = document.getElementById('prList');
    if (!prList) return;

    // Apply filters and store globally, resetting page if needed
    if (resetPage) {
        currentPRs = sortPRsByDate(filterPRs(prs, activeStatusFilter, activeSearchText));
        currentPage = 1;
    }

    prList.innerHTML = '';

    if (currentPRs.length === 0) {
        const isFiltered = activeStatusFilter !== 'all' || activeSearchText.trim() !== '';
        prList.innerHTML = isFiltered ? generateFilteredEmptyListHtml() : generateEmptyListHtml();
        displayPagination(0, 0);
        return;
    }

    // Calculate pagination
    const totalPages = Math.ceil(currentPRs.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = Math.min(startIndex + ITEMS_PER_PAGE, currentPRs.length);
    const paginatedPRs = currentPRs.slice(startIndex, endIndex);

    paginatedPRs.forEach((pr) => {
        const prElement = document.createElement('div');
        prElement.className = 'p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400';
        prElement.innerHTML = generatePRItemHtml(pr);
        prList.appendChild(prElement);
    });

    // Display pagination
    displayPagination(totalPages, currentPRs.length);
}

function displayPagination(totalPages: number, totalItems: number): void {
    const paginationContainer = document.getElementById('prPagination');
    if (!paginationContainer) return;

    paginationContainer.innerHTML = '';

    if (totalPages <= 1) {
        return;
    }

    const startItem = (currentPage - 1) * ITEMS_PER_PAGE + 1;
    const endItem = Math.min(currentPage * ITEMS_PER_PAGE, totalItems);

    const paginationEl = document.createElement('div');
    paginationEl.className = 'flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t border-slate-200 dark:border-slate-700';

    // Page info
    const pageInfo = document.createElement('div');
    pageInfo.className = 'text-sm text-slate-600 dark:text-slate-400';
    pageInfo.textContent = `${startItem}-${endItem} / ${totalItems}件`;

    // Navigation buttons
    const navContainer = document.createElement('div');
    navContainer.className = 'flex items-center gap-2';

    // Previous button
    const prevButton = document.createElement('button');
    prevButton.className = `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        currentPage === 1
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer'
    }`;
    prevButton.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
    `;
    prevButton.disabled = currentPage === 1;
    prevButton.addEventListener('click', () => goToPage(currentPage - 1));

    // Page numbers
    const pageNumbers = document.createElement('div');
    pageNumbers.className = 'flex items-center gap-1';

    const pagesToShow = getPageNumbersToShow(currentPage, totalPages);
    pagesToShow.forEach((page) => {
        if (page === '...') {
            const ellipsis = document.createElement('span');
            ellipsis.className = 'px-2 text-slate-400 dark:text-slate-600';
            ellipsis.textContent = '...';
            pageNumbers.appendChild(ellipsis);
        } else {
            const pageButton = document.createElement('button');
            const pageNum = page as number;
            pageButton.className = `w-9 h-9 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                pageNum === currentPage
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`;
            pageButton.textContent = String(pageNum);
            pageButton.addEventListener('click', () => goToPage(pageNum));
            pageNumbers.appendChild(pageButton);
        }
    });

    // Next button
    const nextButton = document.createElement('button');
    nextButton.className = `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
        currentPage === totalPages
            ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer'
    }`;
    nextButton.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="9 18 15 12 9 6"></polyline>
        </svg>
    `;
    nextButton.disabled = currentPage === totalPages;
    nextButton.addEventListener('click', () => goToPage(currentPage + 1));

    navContainer.appendChild(prevButton);
    navContainer.appendChild(pageNumbers);
    navContainer.appendChild(nextButton);

    paginationEl.appendChild(pageInfo);
    paginationEl.appendChild(navContainer);
    paginationContainer.appendChild(paginationEl);
}

function goToPage(page: number): void {
    const totalPages = Math.ceil(currentPRs.length / ITEMS_PER_PAGE);
    if (page < 1 || page > totalPages) return;

    currentPage = page;
    displayPRList(currentPRs, false);

    // Scroll to PR list section
    const prListSection = document.getElementById('prList');
    if (prListSection) {
        prListSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// UI State Management
function showLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.classList.remove('hidden');
    }
    // Reset progress display
    resetLoadingProgress();
}

function hideLoading(): void {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
    // Reset progress display
    resetLoadingProgress();
}

function resetLoadingProgress(): void {
    const progressContainer = document.getElementById('loadingProgress');
    const progressBar = document.getElementById('loadingProgressBar') as HTMLElement | null;
    const progressText = document.getElementById('loadingProgressText');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingMessage = document.getElementById('loadingMessage');

    if (progressContainer) progressContainer.classList.add('hidden');
    if (progressBar) {
        progressBar.style.width = '0%';
        progressBar.setAttribute('aria-valuenow', '0');
    }
    if (progressText) progressText.textContent = '';
    if (loadingTitle) loadingTitle.textContent = DEFAULT_LOADING_TITLE;
    if (loadingMessage) loadingMessage.textContent = DEFAULT_LOADING_MESSAGE;
}

function updateLoadingProgress(current: number, total: number, message: string): void {
    const progressContainer = document.getElementById('loadingProgress');
    const progressBar = document.getElementById('loadingProgressBar') as HTMLElement | null;
    const progressText = document.getElementById('loadingProgressText');
    const loadingMessage = document.getElementById('loadingMessage');

    if (progressContainer) progressContainer.classList.remove('hidden');
    if (progressBar && total > 0) {
        const percent = Math.min(Math.round((current / total) * 100), 100);
        progressBar.style.width = `${percent}%`;
        progressBar.setAttribute('aria-valuenow', String(percent));
    }
    if (progressText) progressText.textContent = `${current} / ${total}`;
    if (loadingMessage) loadingMessage.textContent = message;
}

function updateLoadingPhase(phase: string, message: string): void {
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingMessage = document.getElementById('loadingMessage');

    if (loadingTitle) loadingTitle.textContent = phase;
    if (loadingMessage) loadingMessage.textContent = message;
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

    // Determine rate limit status and authentication state
    const { statusText, isAuthenticated } = getRateLimitStatus(info.remaining, info.limit);
    const authStatusBadge = isAuthenticated
        ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">Authenticated</span>'
        : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400">Unauthenticated</span>';

    // Map status text to CSS classes
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
