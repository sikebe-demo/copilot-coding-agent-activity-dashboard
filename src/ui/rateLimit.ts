import { state, dom } from '../state';
import {
    formatCountdown,
    generateRateLimitHtml,
} from '../../lib';
import type { RateLimitInfo } from '../../lib';

export function startRateLimitCountdown(resetTimestamp: number): void {
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

export function displayRateLimitInfo(info: RateLimitInfo, fromCache: boolean): void {
    if (!dom.rateLimitInfo) return;

    const resetCountdown = formatCountdown(info.reset);
    dom.rateLimitInfo.innerHTML = generateRateLimitHtml({ info, fromCache, resetCountdown });
    dom.rateLimitInfo.classList.remove('hidden');

    // Start countdown timer
    startRateLimitCountdown(info.reset);
}

export function hideRateLimitInfo(): void {
    // Clear countdown timer
    if (state.rateLimitCountdownInterval !== null) {
        clearInterval(state.rateLimitCountdownInterval);
        state.rateLimitCountdownInterval = null;
    }
    if (dom.rateLimitInfo) dom.rateLimitInfo.classList.add('hidden');
}
