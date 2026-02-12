import { dom } from '../state';

export function showError(message: string): void {
    if (dom.error && dom.errorMessage) {
        dom.errorMessage.textContent = message;
        dom.error.classList.remove('hidden');
    }
}

export function hideError(): void {
    if (dom.error) dom.error.classList.add('hidden');
}
