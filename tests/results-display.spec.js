import { test, expect } from '@playwright/test';
import {
  createPR,
  createPRs,
  createSearchResponse,
  createRateLimitHeaders,
  mockSearchAPI,
  submitSearch,
  waitForResults,
  waitForPRList,
  waitForChart,
  getDaysAgoISO,
  DEFAULT_TIMEOUT
} from './helpers.js';

// ============================================================================
// Results Display Tests
// ============================================================================
// Tests for statistics, PR list, and results display

test.describe('Results Display', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should display results for valid repository', async ({ page }) => {
    const prs = createPRs([
      { title: 'Test PR by Copilot', state: 'closed', merged_at: getDaysAgoISO(5), created_at: getDaysAgoISO(5) },
      { title: 'Another Copilot PR', state: 'open', created_at: getDaysAgoISO(3) }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('2');
    await expect(page.locator('#mergedPRs')).toContainText('1');
    await expect(page.locator('#openPRs')).toContainText('1');
    await expect(page.locator('#mergeRateValue')).toContainText('50%');
  });

  test('should display Copilot ratio in each stats card', async ({ page }) => {
    const copilotPRs = createPRs([
      { title: 'Copilot PR 1', state: 'closed', merged_at: getDaysAgoISO(5), created_at: getDaysAgoISO(5) },
      { title: 'Copilot PR 2', state: 'open', created_at: getDaysAgoISO(3) },
      { title: 'Copilot PR 3', state: 'closed', merged_at: getDaysAgoISO(1), created_at: getDaysAgoISO(2) }
    ]);

    await page.route('https://api.github.com/search/issues**', async (route, request) => {
      const url = request.url();
      const isCopilotQuery = url.includes('copilot-swe-agent');
      const isMergedQuery = url.includes('is%3Amerged') || url.includes('is:merged');
      const isOpenQuery = url.includes('is%3Aopen') || url.includes('is:open');
      const isClosedQuery = url.includes('is%3Aclosed') || url.includes('is:closed');

      if (isCopilotQuery) {
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(createSearchResponse(copilotPRs))
        });
      } else if (isMergedQuery) {
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 5, incomplete_results: false, items: [] })
        });
      } else if (isOpenQuery) {
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 3, incomplete_results: false, items: [] })
        });
      } else if (isClosedQuery) {
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 7, incomplete_results: false, items: [] })
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 10, incomplete_results: false, items: [] })
        });
      }
    });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('3');
    await expect(page.locator('#totalPRs')).toContainText('/ 10');
    await expect(page.locator('#mergedPRs')).toContainText('2');
    await expect(page.locator('#mergedPRs')).toContainText('/ 5');
    await expect(page.locator('#closedPRs')).toContainText('0');
    await expect(page.locator('#closedPRs')).toContainText('/ 2');
    await expect(page.locator('#openPRs')).toContainText('1');
    await expect(page.locator('#openPRs')).toContainText('/ 3');
  });

  test('should display fallback ratio when all PR count fails', async ({ page }) => {
    const copilotPRs = createPRs([
      { title: 'Copilot PR 1', state: 'open', created_at: getDaysAgoISO(3) }
    ]);

    await page.route('https://api.github.com/search/issues**', async (route, request) => {
      const url = request.url();
      const isCopilotQuery = url.includes('copilot-swe-agent');

      if (isCopilotQuery) {
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(createSearchResponse(copilotPRs))
        });
      } else {
        await route.fulfill({
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Internal Server Error' })
        });
      }
    });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs span:first-child')).toHaveText('1');
    await expect(page.locator('#totalPRs')).toContainText('/ -');
    await expect(page.locator('#mergedPRs span:first-child')).toHaveText('0');
    await expect(page.locator('#mergedPRs')).toContainText('/ -');
    await expect(page.locator('#closedPRs span:first-child')).toHaveText('0');
    await expect(page.locator('#closedPRs')).toContainText('/ -');
    await expect(page.locator('#openPRs span:first-child')).toHaveText('1');
    await expect(page.locator('#openPRs')).toContainText('/ -');
  });

  test('should handle empty results', async ({ page }) => {
    await mockSearchAPI(page, { prs: [] });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('0');
    await expect(page.locator('#prList')).toContainText(/No PRs created by Copilot Coding Agent found/i);
  });

  test('should display correct merge rate for edge cases', async ({ page }) => {
    const allMergedPRs = createPRs([
      { title: 'Merged PR 1', state: 'closed', merged_at: getDaysAgoISO(1) },
      { title: 'Merged PR 2', state: 'closed', merged_at: getDaysAgoISO(2) }
    ]);
    await mockSearchAPI(page, { prs: allMergedPRs });

    await submitSearch(page, { repo: 'merge-rate-test/repo1' });
    await waitForResults(page);

    await expect(page.locator('#mergeRateValue')).toContainText('100%');

    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const noMergedPRs = createPRs([
      { title: 'Open PR 1', state: 'open' },
      { title: 'Open PR 2', state: 'open' }
    ]);
    await mockSearchAPI(page, { prs: noMergedPRs });

    await submitSearch(page, { repo: 'merge-rate-test/repo2' });
    await waitForResults(page);

    await expect(page.locator('#mergeRateValue')).toContainText('0%');
  });

  test('should display merge rate bar with correct width', async ({ page }) => {
    const prs = createPRs([
      { title: 'Merged 1', state: 'closed', merged_at: getDaysAgoISO(1) },
      { title: 'Merged 2', state: 'closed', merged_at: getDaysAgoISO(2) },
      { title: 'Merged 3', state: 'closed', merged_at: getDaysAgoISO(3) },
      { title: 'Open 1', state: 'open' }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#mergeRateValue')).toContainText('75%');
    const barStyle = await page.locator('#mergeRateBar').getAttribute('style');
    expect(barStyle).toContain('width: 75%');
  });

  test('should handle closed PR that was not merged', async ({ page }) => {
    const closedNotMergedPRs = createPRs([
      { title: 'Closed but not merged', state: 'closed', merged_at: null }
    ]);
    await mockSearchAPI(page, { prs: closedNotMergedPRs });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#closedPRs')).toContainText('1');
    await expect(page.locator('#mergedPRs')).toContainText('0');
    await expect(page.locator('#prList')).toContainText('Closed');
  });
});

// ============================================================================
// PR List Tests
// ============================================================================

test.describe('PR List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should display PR list with correct information', async ({ page }) => {
    const prs = [createPR({
      number: 123,
      title: 'Feature: Add new component',
      state: 'closed',
      merged_at: getDaysAgoISO(5),
      html_url: 'https://github.com/test/repo/pull/123'
    })];
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForPRList(page);

    const prList = page.locator('#prList');
    await expect(prList).toContainText('Feature: Add new component');
    await expect(prList).toContainText('#123');
    await expect(prList).toContainText('copilot');
    await expect(prList).toContainText('Merged');
  });

  test('should open PR links in new tab', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });

    await submitSearch(page);
    await page.waitForSelector('#prList a[target="_blank"]', { state: 'visible', timeout: DEFAULT_TIMEOUT });

    await expect(page.locator('#prList a[target="_blank"]').first()).toHaveAttribute('target', '_blank');
  });

  test('should sort PRs by created date (newest first)', async ({ page }) => {
    const prs = createPRs([
      { title: 'Oldest PR', state: 'open', created_at: '2026-01-01T10:00:00Z' },
      { title: 'Newest PR', state: 'open', created_at: '2026-01-10T10:00:00Z' },
      { title: 'Middle PR', state: 'open', created_at: '2026-01-05T10:00:00Z' }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForPRList(page);

    const prTitles = await page.locator('#prList h3').allTextContents();
    expect(prTitles[0].trim()).toBe('Newest PR');
    expect(prTitles[1].trim()).toBe('Middle PR');
    expect(prTitles[2].trim()).toBe('Oldest PR');
  });

  test('should handle PR with zero or negative number', async ({ page }) => {
    const prs = createPRs([
      { number: 0, title: 'PR with zero number' },
      { number: -1, title: 'PR with negative number' }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForPRList(page);

    const prList = page.locator('#prList');
    await expect(prList).toContainText('PR with zero number');
    await expect(prList).toContainText('PR with negative number');

    const prListText = await prList.textContent();
    expect(prListText).not.toContain('#0');
    expect(prListText).not.toContain('#-1');
  });

  test('should display PR created date in Japanese format', async ({ page }) => {
    const prs = createPRs([
      { title: 'Test PR', state: 'open', created_at: '2026-01-15T10:00:00Z' }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForPRList(page);

    await expect(page.locator('#prList')).toContainText('2026/1/15');
  });

  test('should handle very long PR title without breaking layout', async ({ page }) => {
    const longTitle = 'A'.repeat(500);
    const prs = createPRs([
      { title: longTitle, state: 'open' }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForPRList(page);

    const prList = page.locator('#prList');
    await expect(prList).toBeVisible();
    await expect(prList).toContainText('AAAA');
  });

  test('should handle null URL in sanitizeUrl', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      await route.fulfill({
        status: 200,
        headers: { ...createRateLimitHeaders() },
        body: JSON.stringify({
          total_count: 1,
          incomplete_results: false,
          items: [{
            id: 1,
            node_id: 'PR_1',
            number: 1,
            title: 'PR with null URL',
            state: 'open',
            created_at: getDaysAgoISO(1),
            user: { login: 'copilot' },
            html_url: null,
            pull_request: { merged_at: null }
          }]
        })
      });
    });

    await submitSearch(page);
    await waitForPRList(page);

    await expect(page.locator('#prList')).toContainText('PR with null URL');
    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe('#');
  });

  test('should handle undefined user login gracefully', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      await route.fulfill({
        status: 200,
        headers: { ...createRateLimitHeaders() },
        body: JSON.stringify({
          total_count: 1,
          incomplete_results: false,
          items: [{
            id: 1,
            node_id: 'PR_1',
            number: 1,
            title: 'PR with undefined user',
            state: 'open',
            created_at: getDaysAgoISO(1),
            user: { login: undefined },
            html_url: 'https://github.com/test/repo/pull/1',
            pull_request: { merged_at: null }
          }]
        })
      });
    });

    await submitSearch(page);
    await waitForPRList(page);

    await expect(page.locator('#prList')).toContainText('PR with undefined user');
  });

  test('should handle PR with missing pull_request.merged_at field', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      await route.fulfill({
        status: 200,
        headers: { ...createRateLimitHeaders() },
        body: JSON.stringify({
          total_count: 1,
          incomplete_results: false,
          items: [{
            id: 1,
            node_id: 'PR_1',
            number: 1,
            title: 'PR without merged_at',
            state: 'open',
            created_at: getDaysAgoISO(1),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1',
            pull_request: {}
          }]
        })
      });
    });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#openPRs')).toContainText('1');
    await expect(page.locator('#prList')).toContainText('Open');
  });
});

// ============================================================================
// Chart Tests
// ============================================================================

test.describe('Chart', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should display chart when results are shown', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ state: 'closed', merged_at: getDaysAgoISO(5) })] });

    await submitSearch(page);
    await page.waitForSelector('#prChart', { state: 'visible', timeout: DEFAULT_TIMEOUT });

    await expect(page.locator('#prChart')).toBeVisible();
  });

  test('should display all dates in range including days with no PR data', async ({ page }) => {
    const prs = createPRs([
      { title: 'PR on day 2', state: 'closed', merged_at: '2026-01-02T10:00:00Z', created_at: '2026-01-02T10:00:00Z' },
      { title: 'PR on day 5', state: 'closed', merged_at: '2026-01-05T10:00:00Z', created_at: '2026-01-05T10:00:00Z' },
      { title: 'PR on day 7', state: 'open', created_at: '2026-01-07T10:00:00Z' }
    ]);
    await mockSearchAPI(page, { prs });

    await page.goto('/');
    await submitSearch(page, { repo: 'test/repo', fromDate: '2026-01-01', toDate: '2026-01-10' });
    await waitForChart(page);

    const canvas = page.locator('#prChart canvas');
    await expect(canvas).toBeVisible();
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox.width).toBeGreaterThan(0);
    expect(canvasBox.height).toBeGreaterThan(0);
  });

  test('should update chart theme when toggling dark mode', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ state: 'closed', merged_at: getDaysAgoISO(5) })] });

    await submitSearch(page);
    await waitForChart(page);

    const canvas = page.locator('#prChart canvas');

    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(canvas).toBeVisible();

    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(canvas).toBeVisible();
  });

  test('should correctly calculate chart data for PRs grouped by date', async ({ page }) => {
    const prs = createPRs([
      { title: 'Merged on day 1', state: 'closed', merged_at: '2026-01-10T10:00:00Z', created_at: '2026-01-10T10:00:00Z' },
      { title: 'Open on day 1', state: 'open', created_at: '2026-01-10T14:00:00Z' },
      { title: 'Closed on day 1', state: 'closed', merged_at: null, created_at: '2026-01-10T18:00:00Z' }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page, { fromDate: '2026-01-10', toDate: '2026-01-10' });
    await waitForChart(page);

    const canvas = page.locator('#prChart canvas');
    await expect(canvas).toBeVisible();
  });
});
