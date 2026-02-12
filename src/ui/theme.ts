import { state, dom } from '../state';
import { updateChartTheme } from './chart';

export function initializeTheme(): void {
    const savedTheme = localStorage.getItem('theme') || 'light';

    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // Set initial aria-label reflecting current state
    updateThemeToggleLabel();

    dom.themeToggle?.addEventListener('click', toggleTheme);
}

export function toggleTheme(): void {
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

    // Update theme toggle button label
    updateThemeToggleLabel();

    // Update chart if it exists
    if (state.chartInstance) {
        updateChartTheme();
    }
}

export function updateThemeToggleLabel(): void {
    if (!dom.themeToggle) return;
    const isDark = document.documentElement.classList.contains('dark');
    dom.themeToggle.setAttribute(
        'aria-label',
        isDark
            ? 'Switch to light mode (currently dark mode)'
            : 'Switch to dark mode (currently light mode)'
    );
}
