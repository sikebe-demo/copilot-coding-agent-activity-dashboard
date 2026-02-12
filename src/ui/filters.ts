import { state, dom } from '../state';
import {
    FILTER_STYLE_MAP,
    FILTER_INACTIVE_STYLE,
    getAllFilterColorClasses,
} from '../../lib';
import type { PRFilterStatus } from '../../lib';
import { displayPRList } from './prList';

export function initializeFilters(): void {
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

export function applyFilters(): void {
    if (state.allFetchedPRs.length === 0) return;
    displayPRList(state.allFetchedPRs, true);
}

export function resetFilterUI(): void {
    // Reset search input
    if (dom.prSearchInput) dom.prSearchInput.value = '';

    // Reset button styles
    updateFilterButtonStyles();
}

export function updateFilterButtonStyles(): void {
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
