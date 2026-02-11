import { test, expect } from '@playwright/test';
import {
  createPR,
  createPRs,
  createSearchResponse,
  createRateLimitHeaders,
  mockSearchAPI,
  submitSearch,
  waitForResults,
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

  test('should handle empty results', async ({ page }) => {
    await mockSearchAPI(page, { prs: [] });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('0');
    await expect(page.locator('#prList')).toContainText(/No PRs created by Copilot Coding Agent found/i);
  });

});

// ============================================================================
// PR List Tests
// ============================================================================
// Note: Detailed PR rendering tests (XSS escaping, URL sanitization, null user/URL handling,
// sorting, target="_blank") have been moved to unit-tests/rendering.test.ts.
// Only integration smoke tests that verify the full E2E flow remain here.

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
    await waitForResults(page);

    const prList = page.locator('#prList');
    await expect(prList).toContainText('Feature: Add new component');
    await expect(prList).toContainText('#123');
    await expect(prList).toContainText('Merged');
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

});
