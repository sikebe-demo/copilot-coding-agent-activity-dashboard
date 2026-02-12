import { test, expect } from '@playwright/test';
import {
  createPR,
  createSearchResponse,
  createRateLimitHeaders,
  mockSearchAPIWithCounter,
  submitSearch,
  waitForResults,
  waitForRateLimitInfo
} from './helpers.js';

// Expected API call count per search: 1 search query + 3 fetchAllPRCounts queries (total, merged, open)
// Note: closed count is calculated as total - merged - open (no separate API call)
const EXPECTED_API_CALLS = 4;

// ============================================================================
// Cache Tests
// ============================================================================
// Tests for localStorage caching, cache versioning, and cache invalidation

test.describe('Caching', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should show cached indicator and reuse cache for subsequent requests', async ({ page }) => {
    const counter = await mockSearchAPIWithCounter(page, [createPR({ title: 'Cached PR' })]);

    await submitSearch(page, { repo: 'cache-test/repo' });
    await waitForResults(page);
    await waitForRateLimitInfo(page);
    expect(counter.getCount()).toBe(EXPECTED_API_CALLS);

    // Second search should use cache - no additional API calls
    await page.click('#searchButton');
    await waitForResults(page);
    await page.waitForTimeout(500);
    expect(counter.getCount()).toBe(EXPECTED_API_CALLS);

    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(rateLimitInfo).toContainText('No API call made');
  });

  test('should maintain separate caches for authenticated and unauthenticated requests', async ({ page }) => {
    let requestCount = 0;
    await page.route('https://api.github.com/search/issues**', async route => {
      requestCount++;
      const hasAuthHeader = route.request().headers()['authorization'] !== undefined;

      const responseData = hasAuthHeader
        ? [createPR({ id: 1, number: 1, title: 'Authenticated PR' })]
        : [createPR({ id: 2, number: 2, title: 'Unauthenticated PR' })];

      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...createRateLimitHeaders(4999, 5000, 1)
        },
        body: JSON.stringify(createSearchResponse(responseData))
      });
    });

    await submitSearch(page, { repo: 'auth-cache-test/repo' });
    await waitForResults(page);
    expect(requestCount).toBe(EXPECTED_API_CALLS);
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(EXPECTED_API_CALLS);
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    await submitSearch(page, { repo: 'auth-cache-test/repo', token: 'ghp_test123' });
    await waitForResults(page);
    expect(requestCount).toBe(EXPECTED_API_CALLS * 2);
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(EXPECTED_API_CALLS * 2);
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    await page.fill('#tokenInput', '');
    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(EXPECTED_API_CALLS * 2);
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');
  });
});
