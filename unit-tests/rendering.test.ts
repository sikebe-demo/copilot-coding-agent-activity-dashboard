import {
    buildSearchUrl,
    getPRStatus,
    generatePRItemHtml,
    generateEmptyListHtml,
    PR_STATUS_CONFIG,
} from '../lib';
import type { PullRequest } from '../lib';

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
        expect(html).toContain('href="#"');
        expect(html).not.toContain('javascript:');
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

    it('should include target="_blank" on PR links', () => {
        const pr = createTestPR();
        const html = generatePRItemHtml(pr);
        expect(html).toContain('target="_blank"');
    });

    it('should handle null URL', () => {
        const pr = createTestPR({ html_url: 'not-a-valid-url' as string });
        const html = generatePRItemHtml(pr);
        expect(html).toContain('href="#"');
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
