import { state, dom, cacheDOMElements } from './src/state';
import { fetchCopilotPRsWithCache, fetchComparisonData } from './src/api';
import { initializeTheme } from './src/ui/theme';
import { initializeFilters } from './src/ui/filters';
import { initializePRListEvents } from './src/ui/prList';
import { showLoading, hideLoading, updateLoadingPhase, updateLoadingProgress, showIndeterminateProgress } from './src/ui/loading';
import { showError, hideError } from './src/ui/error';
import { displayResults, hideResults, updateComparisonDisplay } from './src/ui/results';
import { displayRateLimitInfo, hideRateLimitInfo } from './src/ui/rateLimit';
import { parseRepoInput, validateDateRange } from './lib';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    cacheDOMElements();
    initializeTheme();
    initializeForm();
    initializeFilters();
    initializePRListEvents();
    initializeComparisonButton();
    setDefaultDates();
});

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
    if (state.comparisonAbortController) {
        state.comparisonAbortController.abort();
        state.comparisonAbortController = null;
    }
    state.currentAbortController = new AbortController();

    const requestId = ++state.currentRequestId;

    try {
        const result = await fetchCopilotPRsWithCache(
            owner, repo, fromDate, toDate, token,
            state.currentAbortController.signal,
            { updatePhase: updateLoadingPhase, updateProgress: updateLoadingProgress, showIndeterminate: showIndeterminateProgress }
        );
        // Ignore stale responses from earlier searches
        if (requestId !== state.currentRequestId) return;

        // Store search params for lazy comparison loading
        state.lastSearchParams = { owner, repo, fromDate, toDate, token };

        await displayResults(result.prs, fromDate, toDate, result.allPRCounts, result.allMergedPRs);
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

// Comparison data lazy loading
function initializeComparisonButton(): void {
    dom.comparisonButton?.addEventListener('click', handleLoadComparison);
}

async function handleLoadComparison(): Promise<void> {
    if (!state.lastSearchParams || state.comparisonLoaded) return;

    const { owner, repo, fromDate, toDate, token } = state.lastSearchParams;
    const button = dom.comparisonButton;

    if (button) {
        button.disabled = true;
        button.textContent = 'Loading...';
    }

    try {
        if (state.comparisonAbortController) {
            state.comparisonAbortController.abort();
        }
        state.comparisonAbortController = new AbortController();
        const result = await fetchComparisonData(owner, repo, fromDate, toDate, token, state.comparisonAbortController.signal);

        updateComparisonDisplay(result.allPRCounts, result.allMergedPRs);
        if (result.rateLimitInfo) {
            displayRateLimitInfo(result.rateLimitInfo, false);
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        showError(error instanceof Error ? error.message : 'Failed to load comparison data');
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = 'Load Repository Comparison';
        }
    }
}
