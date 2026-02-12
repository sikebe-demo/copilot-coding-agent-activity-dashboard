import { state, dom } from '../state';
import {
    getPageNumbersToShow,
    ITEMS_PER_PAGE,
} from '../../lib';
import { displayPRList } from './prList';

export function displayPagination(totalPages: number, totalItems: number): void {
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

    const fragment = document.createDocumentFragment();
    fragment.appendChild(navEl);
    paginationContainer.appendChild(fragment);
}

export function goToPage(page: number): void {
    const totalPages = Math.ceil(state.currentPRs.length / ITEMS_PER_PAGE);
    if (page < 1 || page > totalPages) return;

    state.currentPage = page;
    displayPRList(state.currentPRs, false);

    // Scroll to PR list section
    if (dom.prList) {
        dom.prList.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
