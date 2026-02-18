import { state, dom } from '../state';
import {
    classifyPRs,
    createRatioHtml,
    sortPRsByDate,
} from '../../lib';
import type { PullRequest, AllPRCounts } from '../../lib';
import { displayChart } from './chart';
import { displayPRList } from './prList';
import { resetFilterUI } from './filters';
import { displayResponseTimeAnalysis } from './responseTime';

export async function displayResults(prs: PullRequest[], fromDate: string, toDate: string, allPRCounts?: AllPRCounts, allMergedPRs?: PullRequest[]): Promise<void> {
    const counts = classifyPRs(prs);

    const hasComparison = !!allPRCounts;

    // Update summary cards
    if (hasComparison) {
        if (dom.totalPRs) dom.totalPRs.innerHTML = createRatioHtml(counts.total, allPRCounts.total, 'text-slate-800 dark:text-slate-100');
        if (dom.mergedPRs) dom.mergedPRs.innerHTML = createRatioHtml(counts.merged, allPRCounts.merged, 'text-green-700 dark:text-green-400');
        if (dom.closedPRs) dom.closedPRs.innerHTML = createRatioHtml(counts.closed, allPRCounts.closed, 'text-red-600 dark:text-red-400');
        if (dom.openPRs) dom.openPRs.innerHTML = createRatioHtml(counts.open, allPRCounts.open, 'text-blue-600 dark:text-blue-400');
    } else {
        // Show copilot-only counts without ratio
        if (dom.totalPRs) dom.totalPRs.innerHTML = `<span class="text-4xl font-bold text-slate-800 dark:text-slate-100">${counts.total}</span>`;
        if (dom.mergedPRs) dom.mergedPRs.innerHTML = `<span class="text-4xl font-bold text-green-700 dark:text-green-400">${counts.merged}</span>`;
        if (dom.closedPRs) dom.closedPRs.innerHTML = `<span class="text-4xl font-bold text-red-600 dark:text-red-400">${counts.closed}</span>`;
        if (dom.openPRs) dom.openPRs.innerHTML = `<span class="text-4xl font-bold text-blue-600 dark:text-blue-400">${counts.open}</span>`;
    }

    // Update merge rate
    if (dom.mergeRateValue) dom.mergeRateValue.textContent = `${counts.mergeRate}%`;
    if (dom.mergeRateText) dom.mergeRateText.textContent = `${counts.mergeRate}%`;
    if (dom.mergeRateBar) {
        (dom.mergeRateBar as HTMLElement).style.width = `${counts.mergeRate}%`;
        dom.mergeRateBar.setAttribute('aria-valuenow', String(counts.mergeRate));
    }

    // Display chart with date range passed from form submission
    await displayChart(prs, fromDate, toDate);

    // Display response time analysis
    try {
        await displayResponseTimeAnalysis(prs, allMergedPRs ?? [], allPRCounts);
    } catch (e) {
        console.error('Response time analysis failed:', e);
    }

    // Show/hide comparison banner
    // With inline fetching, comparison data (counts + merged PRs) is either fully
    // available or not available at all. Use hasComparison as the single flag.
    if (dom.comparisonBanner) {
        if (hasComparison) {
            dom.comparisonBanner.classList.add('hidden');
            state.comparisonLoaded = true;
        } else {
            dom.comparisonBanner.classList.remove('hidden');
            state.comparisonLoaded = false;
            const bannerTitle = document.getElementById('comparisonBannerTitle');
            const bannerSubtitle = document.getElementById('comparisonBannerSubtitle');
            if (bannerTitle && bannerSubtitle) {
                bannerTitle.textContent = 'Repository-wide comparison data is currently unavailable';
                bannerSubtitle.textContent =
                    'Some comparison features are limited because repository-wide data for this view is not currently available.';
            }
        }
    }

    // Store all fetched PRs for filtering and reset filter state
    state.allFetchedPRs = sortPRsByDate(prs);
    state.activeStatusFilter = 'all';
    state.activeSearchText = '';
    resetFilterUI();

    // Display PR list
    displayPRList(state.allFetchedPRs);

    showResults();
}

export function updateComparisonDisplay(allPRCounts: AllPRCounts, allMergedPRs: PullRequest[]): void {
    const counts = classifyPRs(state.allFetchedPRs);

    // Update summary cards with ratio display
    if (dom.totalPRs) dom.totalPRs.innerHTML = createRatioHtml(counts.total, allPRCounts.total, 'text-slate-800 dark:text-slate-100');
    if (dom.mergedPRs) dom.mergedPRs.innerHTML = createRatioHtml(counts.merged, allPRCounts.merged, 'text-green-700 dark:text-green-400');
    if (dom.closedPRs) dom.closedPRs.innerHTML = createRatioHtml(counts.closed, allPRCounts.closed, 'text-red-600 dark:text-red-400');
    if (dom.openPRs) dom.openPRs.innerHTML = createRatioHtml(counts.open, allPRCounts.open, 'text-blue-600 dark:text-blue-400');

    // Update response time analysis with comparison data
    displayResponseTimeAnalysis(state.allFetchedPRs, allMergedPRs, allPRCounts).catch(e => {
        console.error('Response time comparison update failed:', e);
    });

    // Hide the comparison banner
    if (dom.comparisonBanner) {
        dom.comparisonBanner.classList.add('hidden');
    }
    state.comparisonLoaded = true;
}

export function showResults(): void {
    if (dom.results) {
        dom.results.classList.remove('hidden');
    }

    // Announce results to screen readers
    announceToScreenReader(`Results loaded. Found ${state.currentPRs.length} pull requests.`);
}

export function announceToScreenReader(message: string): void {
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

export function hideResults(): void {
    if (dom.results) dom.results.classList.add('hidden');
}
