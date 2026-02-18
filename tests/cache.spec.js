import { test, expect } from '@playwright/test';
import {
  createPR,
  createSearchResponse,
  createRateLimitHeaders,
  createGraphQLCombinedResponse,
  mockSearchAPIWithCounter,
  submitSearch,
  waitForResults,
  waitForRateLimitInfo
} from './helpers.js';

// Expected API call counts per search:
// REST: 1 search (Copilot PRs) + 3 counts (total/merged/open) + 1 merged PRs = 5
// GraphQL: 1 combined query = 1
const REST_API_CALLS = 5;
const GRAPHQL_API_CALLS = 1;

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
    expect(counter.getCount()).toBe(REST_API_CALLS);

    // Second search should use cache - no additional API calls
    await page.click('#searchButton');
    await waitForResults(page);
    await page.waitForTimeout(500);
    expect(counter.getCount()).toBe(REST_API_CALLS);

    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(rateLimitInfo).toContainText('No API call made');
  });

  test('should maintain separate caches for authenticated and unauthenticated requests', async ({ page }) => {
    let requestCount = 0;

    // REST mock for unauthenticated requests
    await page.route('https://api.github.com/search/issues**', async route => {
      requestCount++;
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...createRateLimitHeaders(4999, 5000, 1)
        },
        body: JSON.stringify(createSearchResponse([createPR({ id: 2, number: 2, title: 'Unauthenticated PR' })]))
      });
    });

    // GraphQL mock for authenticated requests (token triggers GraphQL path)
    await page.route('https://api.github.com/graphql', async route => {
      requestCount++;
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createGraphQLCombinedResponse(
          [createPR({ id: 1, number: 1, title: 'Authenticated PR' })]
        ))
      });
    });

    await submitSearch(page, { repo: 'auth-cache-test/repo' });
    await waitForResults(page);
    expect(requestCount).toBe(REST_API_CALLS);
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(REST_API_CALLS);
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    await submitSearch(page, { repo: 'auth-cache-test/repo', token: 'ghp_test123' });
    await waitForResults(page);
    expect(requestCount).toBe(REST_API_CALLS + GRAPHQL_API_CALLS);
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(REST_API_CALLS + GRAPHQL_API_CALLS);
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    await page.fill('#tokenInput', '');
    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(REST_API_CALLS + GRAPHQL_API_CALLS);
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');
  });
});
