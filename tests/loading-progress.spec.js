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

      // Small delay to allow progress UI to render
      await new Promise(resolve => setTimeout(resolve, 50));

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

    // Verify progress text shows fetched/total pattern at some point during loading
    await expect(page.locator('#loadingProgressText')).toContainText(/\d+ \/ \d+/, { timeout: 5000 });

    // Wait for completion and verify final state
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

  test('should update loading title for Copilot PRs phase', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      // Small delay to allow phase change to render
      await new Promise(resolve => setTimeout(resolve, 200));
      await route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([createPR()]))
      });
    });

    await submitSearch(page);

    // Verify loading title shows Copilot PRs phase
    await expect(page.locator('#loadingTitle')).toContainText('Copilot PRs', { timeout: 5000 });

    // Verify final state: results are displayed after phase completes
    await waitForResults(page);
    await expect(page.locator('#results')).toBeVisible();
  });

});
