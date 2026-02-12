import {
    buildSearchUrl,
    getPRStatus,
    generatePRItemHtml,
    generateEmptyListHtml,
    generateFilteredEmptyListHtml,
    PR_STATUS_CONFIG,
    CHART_COLORS,
    getChartTheme,
    generateRateLimitHtml,
    getAllFilterColorClasses,
    FILTER_STYLE_MAP,
    FILTER_INACTIVE_STYLE,
} from '../lib';
import type { PullRequest, RateLimitInfo } from '../lib';

function createTestPR(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
        id: 1,
        number: 1,
        title: 'Test PR',
        state: 'open',
        merged_at: null,
        created_at: '2026-01-15T10:00:00Z',
        user: { login: 'testuser' },
        html_url: 'https://github.com/test/repo/pull/1',
        ...overrides,
    };
}

// ============================================================================
// buildSearchUrl
// ============================================================================

describe('buildSearchUrl', () => {
    it('should construct correct URL with encoded query', () => {
        const url = buildSearchUrl('repo:owner/repo is:pr', 100, 1);
        expect(url).toContain('https://api.github.com/search/issues?q=');
        expect(url).toContain(encodeURIComponent('repo:owner/repo is:pr'));
    });

    it('should include per_page, page, sort, and order parameters', () => {
        const url = buildSearchUrl('test', 50, 3);
        expect(url).toContain('per_page=50');
        expect(url).toContain('page=3');
        expect(url).toContain('sort=created');
        expect(url).toContain('order=desc');
    });

    it('should handle special characters in query', () => {
        const query = 'repo:owner/repo is:pr author:app/copilot-swe-agent created:2026-01-01..2026-01-31';
        const url = buildSearchUrl(query, 100, 1);
        // Spaces and colons should be percent-encoded
        expect(url).not.toContain(' ');
        expect(url).toContain(encodeURIComponent(query));
    });
});

// ============================================================================
// getPRStatus
// ============================================================================

describe('getPRStatus', () => {
    it("should return 'merged' when merged_at is not null", () => {
        const pr = createTestPR({ state: 'closed', merged_at: '2026-01-16T12:00:00Z' });
        expect(getPRStatus(pr)).toBe('merged');
    });

    it("should return 'closed' when state is closed and merged_at is null", () => {
        const pr = createTestPR({ state: 'closed', merged_at: null });
        expect(getPRStatus(pr)).toBe('closed');
    });

    it("should return 'open' when state is open and merged_at is null", () => {
        const pr = createTestPR({ state: 'open', merged_at: null });
        expect(getPRStatus(pr)).toBe('open');
    });
});

// ============================================================================
// generatePRItemHtml
// ============================================================================

describe('generatePRItemHtml', () => {
    it('should escape HTML in PR titles to prevent XSS', () => {
        const pr = createTestPR({ title: '<script>alert("XSS")</script>Malicious PR' });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>alert');
    });

    it('should sanitize javascript: URLs in html_url', () => {
        const pr = createTestPR({ html_url: 'javascript:alert("XSS")' });
        const html = generatePRItemHtml(pr);
        expect(html).not.toContain('javascript:');
        // Invalid URL should not show "Open in GitHub" title
        expect(html).not.toContain('title="Open in GitHub"');
    });

    it('should display correct PR information', () => {
        const pr = createTestPR({
            number: 123,
            title: 'Feature: Add new component',
            state: 'closed',
            merged_at: '2026-01-16T12:00:00Z',
        });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('#123');
        expect(html).toContain('Feature: Add new component');
        expect(html).toContain('Merged');
    });

    it('should render external link as span with title for valid URLs', () => {
        const pr = createTestPR();
        const html = generatePRItemHtml(pr);
        expect(html).toContain('title="Open in GitHub"');
        // External link rendered as span, not anchor
        expect(html).not.toContain('<a ');
    });

    it('should handle invalid URL by omitting title attribute', () => {
        const pr = createTestPR({ html_url: 'not-a-valid-url' as string });
        const html = generatePRItemHtml(pr);
        expect(html).not.toContain('title="Open in GitHub"');
        // Uses span instead of anchor for external link
        expect(html).not.toContain('<a ');
    });

    it('should handle PR with null user showing "unknown"', () => {
        const pr = createTestPR({ user: null });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('unknown');
    });

    it('should show correct status badge for merged PR', () => {
        const pr = createTestPR({ state: 'closed', merged_at: '2026-01-16T12:00:00Z' });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('Merged');
        expect(html).toContain(PR_STATUS_CONFIG.merged.class);
    });

    it('should show correct status badge for open PR', () => {
        const pr = createTestPR({ state: 'open', merged_at: null });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('Open');
        expect(html).toContain(PR_STATUS_CONFIG.open.class);
    });

    it('should show correct status badge for closed (not merged) PR', () => {
        const pr = createTestPR({ state: 'closed', merged_at: null });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('Closed');
        expect(html).toContain(PR_STATUS_CONFIG.closed.class);
    });

    it('should format PR number correctly for valid numbers', () => {
        const pr = createTestPR({ number: 42 });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('#42');
    });

    it('should not display PR number for invalid numbers', () => {
        const pr = createTestPR({ number: 0 });
        const html = generatePRItemHtml(pr);
        expect(html).not.toContain('#0');
    });

    it('should include hover classes on title when isInteractive is true', () => {
        const pr = createTestPR();
        const html = generatePRItemHtml(pr, true);
        expect(html).toContain('hover:text-indigo-600');
        expect(html).toContain('dark:hover:text-indigo-400');
    });

    it('should not include hover classes on title when isInteractive is false', () => {
        const pr = createTestPR();
        const html = generatePRItemHtml(pr, false);
        expect(html).not.toContain('hover:text-indigo-600');
        expect(html).not.toContain('dark:hover:text-indigo-400');
    });

    it('should include cursor-pointer on external link when isInteractive is true', () => {
        const pr = createTestPR();
        const html = generatePRItemHtml(pr, true);
        expect(html).toContain('cursor-pointer');
    });

    it('should not include cursor-pointer on external link when isInteractive is false', () => {
        const pr = createTestPR();
        const html = generatePRItemHtml(pr, false);
        expect(html).not.toContain('cursor-pointer');
    });

    it('should default isInteractive to true', () => {
        const pr = createTestPR();
        const defaultHtml = generatePRItemHtml(pr);
        const explicitHtml = generatePRItemHtml(pr, true);
        expect(defaultHtml).toBe(explicitHtml);
    });
});

// ============================================================================
// generateEmptyListHtml
// ============================================================================

describe('generateEmptyListHtml', () => {
    it('should contain "No PRs created by Copilot Coding Agent found" text', () => {
        const html = generateEmptyListHtml();
        expect(html).toContain('No PRs created by Copilot Coding Agent found');
    });

    it('should return non-empty HTML string', () => {
        const html = generateEmptyListHtml();
        expect(html.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// generateFilteredEmptyListHtml
// ============================================================================

describe('generateFilteredEmptyListHtml', () => {
    it('should contain "No PRs match the current filters" text', () => {
        const html = generateFilteredEmptyListHtml();
        expect(html).toContain('No PRs match the current filters');
    });

    it('should contain guidance to adjust filters', () => {
        const html = generateFilteredEmptyListHtml();
        expect(html).toContain('Try adjusting your status filter or search text');
    });

    it('should return non-empty HTML string', () => {
        const html = generateFilteredEmptyListHtml();
        expect(html.length).toBeGreaterThan(0);
    });
});

// ============================================================================
// PR_STATUS_CONFIG
// ============================================================================

describe('PR_STATUS_CONFIG', () => {
    it('should have merged, closed, and open keys', () => {
        expect(PR_STATUS_CONFIG).toHaveProperty('merged');
        expect(PR_STATUS_CONFIG).toHaveProperty('closed');
        expect(PR_STATUS_CONFIG).toHaveProperty('open');
    });

    it("merged config should have text 'Merged'", () => {
        expect(PR_STATUS_CONFIG.merged.text).toBe('Merged');
    });

    it("closed config should have text 'Closed'", () => {
        expect(PR_STATUS_CONFIG.closed.text).toBe('Closed');
    });

    it("open config should have text 'Open'", () => {
        expect(PR_STATUS_CONFIG.open.text).toBe('Open');
    });
});

// ============================================================================
// CHART_COLORS
// ============================================================================

describe('CHART_COLORS', () => {
    it('should have merged, closed, and open keys', () => {
        expect(CHART_COLORS).toHaveProperty('merged');
        expect(CHART_COLORS).toHaveProperty('closed');
        expect(CHART_COLORS).toHaveProperty('open');
    });

    it('should have backgroundColor and borderColor for each status', () => {
        for (const status of ['merged', 'closed', 'open'] as const) {
            expect(CHART_COLORS[status]).toHaveProperty('backgroundColor');
            expect(CHART_COLORS[status]).toHaveProperty('borderColor');
            expect(typeof CHART_COLORS[status].backgroundColor).toBe('string');
            expect(typeof CHART_COLORS[status].borderColor).toBe('string');
        }
    });

    it('should use rgba format for colors', () => {
        expect(CHART_COLORS.merged.backgroundColor).toMatch(/^rgba\(/);
        expect(CHART_COLORS.merged.borderColor).toMatch(/^rgba\(/);
    });
});

// ============================================================================
// getChartTheme
// ============================================================================

describe('getChartTheme', () => {
    it('should return dark theme colors when isDark is true', () => {
        const theme = getChartTheme(true);
        expect(theme.textColor).toBe('#f1f5f9');
        expect(theme.gridColor).toBe('#475569');
        expect(theme.tooltipBg).toContain('15, 23, 42');
        expect(theme.tooltipBorder).toBe('#334155');
    });

    it('should return light theme colors when isDark is false', () => {
        const theme = getChartTheme(false);
        expect(theme.textColor).toBe('#1e293b');
        expect(theme.gridColor).toBe('#e2e8f0');
        expect(theme.tooltipBg).toContain('255, 255, 255');
        expect(theme.tooltipBorder).toBe('#e2e8f0');
    });

    it('should return all four properties', () => {
        const theme = getChartTheme(true);
        expect(Object.keys(theme)).toEqual(['textColor', 'gridColor', 'tooltipBg', 'tooltipBorder']);
    });
});

// ============================================================================
// generateRateLimitHtml
// ============================================================================

describe('generateRateLimitHtml', () => {
    const baseInfo: RateLimitInfo = {
        limit: 30,
        remaining: 25,
        reset: Math.floor(Date.now() / 1000) + 60,
        used: 5,
    };

    it('should show remaining and limit values', () => {
        const html = generateRateLimitHtml({ info: baseInfo, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('25');
        expect(html).toContain('/ 30 remaining');
    });

    it('should show Authenticated badge when limit > 10', () => {
        const html = generateRateLimitHtml({ info: baseInfo, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('Authenticated');
    });

    it('should show Unauthenticated badge when limit <= 10', () => {
        const info = { ...baseInfo, limit: 10 };
        const html = generateRateLimitHtml({ info, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('Unauthenticated');
    });

    it('should show Cached indicator when fromCache is true', () => {
        const html = generateRateLimitHtml({ info: baseInfo, fromCache: true, resetCountdown: '1:00' });
        expect(html).toContain('Cached');
        expect(html).toContain('Data loaded from cache');
    });

    it('should not show Cached indicator when fromCache is false', () => {
        const html = generateRateLimitHtml({ info: baseInfo, fromCache: false, resetCountdown: '1:00' });
        expect(html).not.toContain('Cached');
        expect(html).toContain(`Used ${baseInfo.used} requests`);
    });

    it('should show Good status when remaining > 50%', () => {
        const html = generateRateLimitHtml({ info: baseInfo, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('Good');
    });

    it('should show Warning status when remaining is between 20% and 50%', () => {
        const info = { ...baseInfo, remaining: 8, used: 22 };
        const html = generateRateLimitHtml({ info, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('Warning');
    });

    it('should show Low status when remaining <= 20%', () => {
        const info = { ...baseInfo, remaining: 2, used: 28 };
        const html = generateRateLimitHtml({ info, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('Low');
    });

    it('should highlight remaining count in red when low', () => {
        const info = { ...baseInfo, remaining: 2, used: 28 };
        const html = generateRateLimitHtml({ info, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('text-red-600 dark:text-red-400');
    });

    it('should include reset countdown value', () => {
        const html = generateRateLimitHtml({ info: baseInfo, fromCache: false, resetCountdown: '2:30' });
        expect(html).toContain('2:30');
    });

    it('should include progress bar with correct width', () => {
        const info = { ...baseInfo, remaining: 15, used: 15 };
        const html = generateRateLimitHtml({ info, fromCache: false, resetCountdown: '1:00' });
        // usagePercent = 50%, so progress bar width = 50%
        expect(html).toContain('width: 50%');
    });

    it('should show green progress bar when remaining > 50%', () => {
        const html = generateRateLimitHtml({ info: baseInfo, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('bg-green-500');
    });

    it('should show PAT link for unauthenticated users', () => {
        const info = { ...baseInfo, limit: 10 };
        const html = generateRateLimitHtml({ info, fromCache: false, resetCountdown: '1:00' });
        expect(html).toContain('href="https://docs.github.com/en/rest/search/search#rate-limit"');
    });
});

// ============================================================================
// getAllFilterColorClasses
// ============================================================================

describe('getAllFilterColorClasses', () => {
    it('should return an array of strings', () => {
        const classes = getAllFilterColorClasses();
        expect(Array.isArray(classes)).toBe(true);
        expect(classes.length).toBeGreaterThan(0);
        classes.forEach(c => expect(typeof c).toBe('string'));
    });

    it('should include classes from FILTER_INACTIVE_STYLE', () => {
        const classes = getAllFilterColorClasses();
        const inactiveClasses = FILTER_INACTIVE_STYLE.split(' ');
        for (const c of inactiveClasses) {
            expect(classes).toContain(c);
        }
    });

    it('should include active classes from all filter types', () => {
        const classes = getAllFilterColorClasses();
        for (const config of Object.values(FILTER_STYLE_MAP)) {
            for (const c of config.active.split(' ')) {
                expect(classes).toContain(c);
            }
        }
    });

    it('should include hover classes from all filter types', () => {
        const classes = getAllFilterColorClasses();
        for (const config of Object.values(FILTER_STYLE_MAP)) {
            for (const c of config.hover.split(' ')) {
                expect(classes).toContain(c);
            }
        }
    });

    it('should not have duplicates', () => {
        const classes = getAllFilterColorClasses();
        const uniqueClasses = new Set(classes);
        expect(classes.length).toBe(uniqueClasses.size);
    });
});
