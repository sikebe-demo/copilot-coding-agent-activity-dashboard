import { state, dom } from '../state';
import {
    filterPRs,
    sortPRsByDate,
    sanitizeUrl,
    generatePRItemHtml,
    generateEmptyListHtml,
    generateFilteredEmptyListHtml,
    ITEMS_PER_PAGE,
} from '../../lib';
import type { PullRequest } from '../../lib';
import { displayPagination } from './pagination';

export function displayPRList(prs: PullRequest[], resetPage = true): void {
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

    const fragment = document.createDocumentFragment();

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
        } else {
            prElement.setAttribute('aria-label', `Pull request (no link available): ${pr.title || 'Untitled'}`);
        }

        prElement.innerHTML = generatePRItemHtml(pr, hasValidUrl);
        fragment.appendChild(prElement);
    });

    prList.appendChild(fragment);

    // Display pagination
    displayPagination(totalPages, state.currentPRs.length);
}

export function initializePRListEvents(): void {
    if (!dom.prList) return;

    dom.prList.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof Element)) return;
        // Don't navigate if user clicked on an inner anchor
        if (target.closest('a')) return;
        const prCard = target.closest('[data-url]') as HTMLElement | null;
        if (prCard) {
            const url = prCard.getAttribute('data-url');
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }
    });

    dom.prList.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const target = e.target;
        if (!(target instanceof Element)) return;
        const prCard = target.closest('[data-url]') as HTMLElement | null;
        if (prCard) {
            e.preventDefault();
            const url = prCard.getAttribute('data-url');
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        }
    });
}
