import { dom } from '../state';

// Default loading text (shared between index.html initial state and resetLoadingProgress)
const DEFAULT_LOADING_TITLE = 'Fetching data...';
const DEFAULT_LOADING_MESSAGE = 'Loading PR information from GitHub API';

export function showLoading(): void {
    if (dom.loading) {
        dom.loading.classList.remove('hidden');
    }
    // Reset progress display
    resetLoadingProgress();
}

export function hideLoading(): void {
    if (dom.loading) dom.loading.classList.add('hidden');
    // Reset progress display
    resetLoadingProgress();
}

export function resetLoadingProgress(): void {
    if (dom.loadingProgress) dom.loadingProgress.classList.add('hidden');
    if (dom.loadingProgressBar) {
        const bar = dom.loadingProgressBar as HTMLElement;
        bar.style.width = '0%';
        bar.classList.remove('progress-indeterminate');
        dom.loadingProgressBar.setAttribute('aria-valuenow', '0');
    }
    if (dom.loadingProgressText) dom.loadingProgressText.textContent = '';
    if (dom.loadingTitle) dom.loadingTitle.textContent = DEFAULT_LOADING_TITLE;
    if (dom.loadingMessage) dom.loadingMessage.textContent = DEFAULT_LOADING_MESSAGE;
}

export function showIndeterminateProgress(message: string): void {
    if (dom.loadingProgress) dom.loadingProgress.classList.remove('hidden');
    if (dom.loadingProgressBar) {
        const bar = dom.loadingProgressBar as HTMLElement;
        bar.style.width = '0%';
        bar.classList.add('progress-indeterminate');
        bar.removeAttribute('aria-valuenow');
        bar.removeAttribute('aria-valuemin');
        bar.removeAttribute('aria-valuemax');
    }
    if (dom.loadingProgressText) dom.loadingProgressText.textContent = '';
    if (dom.loadingMessage) dom.loadingMessage.textContent = message;
}

export function updateLoadingProgress(current: number, total: number, message: string): void {
    if (dom.loadingProgress) dom.loadingProgress.classList.remove('hidden');
    if (dom.loadingProgressBar && total > 0) {
        const bar = dom.loadingProgressBar as HTMLElement;
        bar.classList.remove('progress-indeterminate');
        const percent = Math.min(Math.round((current / total) * 100), 100);
        bar.style.width = `${percent}%`;
        dom.loadingProgressBar.setAttribute('aria-valuenow', String(percent));
        dom.loadingProgressBar.setAttribute('aria-valuemin', '0');
        dom.loadingProgressBar.setAttribute('aria-valuemax', '100');
    }
    if (dom.loadingProgressText) dom.loadingProgressText.textContent = `${current} / ${total}`;
    if (dom.loadingMessage) dom.loadingMessage.textContent = message;
}

export function updateLoadingPhase(phase: string, message: string): void {
    if (dom.loadingTitle) dom.loadingTitle.textContent = phase;
    if (dom.loadingMessage) dom.loadingMessage.textContent = message;
}
