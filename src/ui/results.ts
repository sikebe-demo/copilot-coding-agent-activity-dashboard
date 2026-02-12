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

export async function displayResults(prs: PullRequest[], fromDate: string, toDate: string, allPRCounts: AllPRCounts): Promise<void> {
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
