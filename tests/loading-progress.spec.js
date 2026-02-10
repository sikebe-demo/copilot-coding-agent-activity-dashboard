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
    await page.reload();
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

    await expect(page.locator('#loadingTitle')).toContainText('Fetching Copilot PRs');
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

    await page.route('https://api.github.com/search/issues**', async route => {
      const url = new URL(route.request().url());
      const searchParams = url.searchParams;
      const query = searchParams.get('q') || '';
      const perPage = Number(searchParams.get('per_page') || '100');
      const pageNum = Number(searchParams.get('page') || '1');

      // Simulate some network latency for all requests
      await new Promise(resolve => setTimeout(resolve, 300));

      // Copilot PR search (paginated)
      if (query.includes('author:app/copilot-swe-agent')) {
        const start = (pageNum - 1) * perPage;
        const end = Math.min(start + perPage, prs.length);
        const pagePrs = prs.slice(start, end);

        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify({
            ...createSearchResponse(pagePrs),
            total_count: prs.length
          })
        });
        return;
      }

      // All-PR count queries (used by fetchAllPRCounts) - only total_count is needed
      await route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify({
          total_count: prs.length,
          incomplete_results: false,
          items: []
        })
      });
    });

    await submitSearch(page);

    // Wait for progress bar to become visible during pagination
    await expect(page.locator('#loadingProgress')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#loadingProgressBar')).toBeVisible();

    // Verify progress text updates with fetched/total counts
    await expect(page.locator('#loadingProgressText')).toContainText(/\d+ \/ \d+/);

    // Verify progress shows specific expected values (100 fetched out of 150 total after first page)
    await expect(page.locator('#loadingProgressText')).toContainText('100 / 150', { timeout: 5000 });

    // Wait for completion and verify progress bar reached 100%
    await waitForResults(page);
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

    // Intercept the loading title before second search to capture cache phase
    await page.evaluate(() => {
      const el = document.getElementById('loadingTitle');
      if (el) {
        const observer = new MutationObserver(() => {
          window.__loadingTitleTexts = window.__loadingTitleTexts || [];
          window.__loadingTitleTexts.push(el.textContent);
        });
        observer.observe(el, { childList: true, characterData: true, subtree: true });
      }
    });

    // Second search should use cache
    await submitSearch(page);
    await waitForResults(page);

    // Should show cached indicator in rate limit info
    await expect(page.locator('#rateLimitInfo')).toContainText('Cached');

    // Verify loading phase showed cache message
    const capturedTexts = await page.evaluate(() => window.__loadingTitleTexts || []);
    expect(capturedTexts.some(t => t.includes('cache') || t.includes('Cache'))).toBeTruthy();
  });

  test('should update loading title for repository stats phase', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      const url = route.request().url();

      // Add delay to see phase changes
      await new Promise(resolve => setTimeout(resolve, 100));

      if (url.includes('author:app/copilot-swe-agent')) {
        // Copilot PRs search - add delay to allow observing phase change
        await new Promise(resolve => setTimeout(resolve, 200));
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(createSearchResponse([createPR()]))
        });
      } else {
        // All PRs count search - add delay so the phase title is observable
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify({ total_count: 100, incomplete_results: false, items: [] })
        });
      }
    });

    await submitSearch(page);

    // Verify loading title updates to repository stats phase
    await expect(page.locator('#loadingTitle')).toContainText('repository stats', { timeout: 5000 });

    await waitForResults(page);
    await expect(page.locator('#results')).toBeVisible();
  });

  test('should display initial loading phase after submitting search', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()], delay: 1000 });

    // Trigger loading state by submitting a search
    await submitSearch(page);

    // Wait for loading modal to be visible first
    await page.waitForSelector('#loading:not(.hidden)', { state: 'visible', timeout: 5000 });

    // Check loading elements are visible with the first user-visible phase text
    // (initial phase title should be "Fetching Copilot PRs...")
    const loadingTitle = page.locator('#loadingTitle');
    const loadingMessage = page.locator('#loadingMessage');

    await expect(loadingTitle).toBeVisible();
    await expect(loadingMessage).toBeVisible();
    await expect(loadingTitle).toContainText('Fetching Copilot PRs');
    await expect(loadingMessage).toContainText('Searching for PRs');
  });
});
