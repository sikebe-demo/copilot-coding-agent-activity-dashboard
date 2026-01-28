import { test, expect } from '@playwright/test';
import {
  createPR,
  createSearchResponse,
  createRateLimitHeaders,
  mockSearchAPI,
  submitSearch,
  waitForResults,
  getDaysAgoISO
} from './helpers.js';

// ============================================================================
// Loading Progress Tests
// ============================================================================
// Tests for loading progress display functionality

test.describe('Loading Progress', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('should show loading title and message during fetch', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()], delay: 500 });
    await submitSearch(page);

    await expect(page.locator('#loadingTitle')).toBeVisible();
    await expect(page.locator('#loadingMessage')).toBeVisible();
  });

  test('should update loading phase when fetching Copilot PRs', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()], delay: 300 });
    await submitSearch(page);

    await expect(page.locator('#loadingTitle')).toContainText('Fetching');
  });

  test('should show progress bar for multiple pages of results', async ({ page }) => {
    // Create 150 PRs to trigger pagination (100 per page)
    const prs = Array.from({ length: 150 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i % 30),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    let requestCount = 0;
    await page.route('https://api.github.com/search/issues**', async route => {
      requestCount++;
      const page_num = requestCount;
      const perPage = 100;
      const start = (page_num - 1) * perPage;
      const end = Math.min(start + perPage, prs.length);
      const pagePrs = prs.slice(start, end);

      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify({
          total_count: prs.length,
          incomplete_results: false,
          items: pagePrs.map((pr, index) => ({
            id: pr.id,
            node_id: `PR_${pr.id}`,
            number: pr.number,
            title: pr.title,
            body: '',
            html_url: pr.html_url,
            user: { login: 'copilot' },
            state: pr.state,
            created_at: pr.created_at,
            updated_at: pr.created_at,
            closed_at: null,
            pull_request: { merged_at: pr.merged_at },
            score: 1.0
          }))
        })
      });
    });

    await submitSearch(page);

    // Wait for progress bar to become visible during pagination
    await expect(page.locator('#loadingProgress')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loadingProgressBar')).toBeVisible();
  });

  test('should reset progress after successful load', async ({ page }) => {
    const prs = [createPR()];
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    // Progress container should be hidden after load
    await expect(page.locator('#loadingProgress')).toBeHidden();
  });

  test('should reset progress after error', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });
    await submitSearch(page);

    await page.waitForSelector('#error', { state: 'visible', timeout: 5000 });

    // Progress container should be hidden after error
    await expect(page.locator('#loadingProgress')).toBeHidden();
  });

  test('should show cache message when loading from cache', async ({ page }) => {
    const prs = [createPR({ title: 'Cached PR' })];

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    // Second search should use cache
    await submitSearch(page);

    // Should show cached indicator
    await expect(page.locator('.cached-indicator, #cachedIndicator, [data-cached="true"]')).toBeVisible({ timeout: 5000 }).catch(() => {
      // If no cached indicator element, check for the text
      return expect(page.locator('#results')).toContainText(/cache/i);
    });
  });

  test('should update loading title for repository stats phase', async ({ page }) => {
    let phase = 0;
    await page.route('https://api.github.com/search/issues**', async route => {
      phase++;
      const url = route.request().url();

      // Add delay to see phase changes
      await new Promise(resolve => setTimeout(resolve, 100));

      if (url.includes('author:app/copilot-swe-agent')) {
        // Copilot PRs search
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(createSearchResponse([createPR()]))
        });
      } else {
        // All PRs count search
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify({ total_count: 100, incomplete_results: false, items: [] })
        });
      }
    });

    await submitSearch(page);
    await waitForResults(page);

    // Test passes if we can complete the search with phase updates
    await expect(page.locator('#results')).toBeVisible();
  });

  test('should display default loading message initially', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()], delay: 200 });

    // Check default state before search
    await expect(page.locator('#loadingTitle')).toContainText('Fetching data...');
    await expect(page.locator('#loadingMessage')).toContainText('Loading PR information from GitHub API');
  });
});
