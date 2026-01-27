import { test, expect } from '@playwright/test';
import {
  createPR,
  createPRs,
  createSearchResponse,
  createRateLimitHeaders,
  mockSearchAPI,
  mockSearchAPIWithCounter,
  submitSearch,
  waitForResults,
  waitForRateLimitInfo,
  getDaysAgoISO
} from './helpers.js';

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

  test('should show cached indicator when data is from cache', async ({ page }) => {
    const counter = await mockSearchAPIWithCounter(page, [createPR()]);

    await submitSearch(page);
    await waitForResults(page);
    await waitForRateLimitInfo(page);

    await page.click('#searchButton');
    await waitForResults(page);
    await page.waitForTimeout(500);

    await expect(page.locator('#rateLimitInfo')).toContainText('Cached');
    expect(counter.getCount()).toBe(5);
  });

  test('should cache data and use it for subsequent requests', async ({ page }) => {
    const counter = await mockSearchAPIWithCounter(page, [createPR({ title: 'Cached PR' })]);

    await submitSearch(page, { repo: 'cache-test/repo' });
    await waitForResults(page);
    expect(counter.getCount()).toBe(5);

    await page.click('#searchButton');
    await waitForResults(page);
    expect(counter.getCount()).toBe(5);

    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(rateLimitInfo).toContainText('No API call made');
  });

  test('should ignore legacy cache without version prefix and refetch', async ({ page }) => {
    const counter = await mockSearchAPIWithCounter(page, [createPR({ title: 'Fresh PR' })]);

    const owner = 'cache-test';
    const repo = 'repo';
    const fromDate = '2026-01-01';
    const toDate = '2026-01-10';

    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });
    const oldCacheKey = `copilot_pr_cache_${paramsKey}_noauth`;
    const legacyEntry = {
      data: [createPR({ title: 'Legacy PR' })],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }
    };

    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: oldCacheKey, value: JSON.stringify(legacyEntry) });

    await submitSearch(page, { repo: `${owner}/${repo}`, fromDate, toDate });
    await waitForResults(page);

    expect(counter.getCount()).toBe(5);

    const prList = page.locator('#prList');
    await expect(prList).toContainText('Fresh PR');
    await expect(prList).not.toContainText('Legacy PR');
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
    expect(requestCount).toBe(5);
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(5);
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    await submitSearch(page, { repo: 'auth-cache-test/repo', token: 'ghp_test123' });
    await waitForResults(page);
    expect(requestCount).toBe(10);
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(10);
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    await page.fill('#tokenInput', '');
    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(10);
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');
  });

  test('should cleanup cache entries with mismatched version on search submission', async ({ page }) => {
    const counter = await mockSearchAPIWithCounter(page, [createPR({ title: 'Current PR' })]);

    const owner = 'version-cleanup-test';
    const repo = 'repo';
    const fromDate = '2026-01-01';
    const toDate = '2026-01-10';

    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });

    const legacyKey = `copilot_pr_cache_${paramsKey}_noauth`;
    const legacyEntry = {
      data: [createPR({ title: 'Legacy PR' })],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }
    };

    const v1Key = `copilot_pr_cache_v1_${paramsKey}_noauth`;
    const v1Entry = {
      data: [createPR({ title: 'V1 PR' })],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }
    };

    const v2Key = `copilot_pr_cache_v2_${paramsKey}_noauth`;
    const v2Entry = {
      data: [createPR({ title: 'V2 PR' })],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }
    };

    await page.evaluate(({ legacy, v1, v2 }) => {
      localStorage.setItem(legacy.key, legacy.value);
      localStorage.setItem(v1.key, v1.value);
      localStorage.setItem(v2.key, v2.value);
    }, {
      legacy: { key: legacyKey, value: JSON.stringify(legacyEntry) },
      v1: { key: v1Key, value: JSON.stringify(v1Entry) },
      v2: { key: v2Key, value: JSON.stringify(v2Entry) }
    });

    const beforeLoad = await page.evaluate(({ legacy, v1, v2 }) => ({
      legacyExists: localStorage.getItem(legacy) !== null,
      v1Exists: localStorage.getItem(v1) !== null,
      v2Exists: localStorage.getItem(v2) !== null
    }), { legacy: legacyKey, v1: v1Key, v2: v2Key });

    expect(beforeLoad.legacyExists).toBe(true);
    expect(beforeLoad.v1Exists).toBe(true);
    expect(beforeLoad.v2Exists).toBe(true);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await submitSearch(page, { repo: `${owner}/${repo}`, fromDate, toDate });
    await waitForResults(page);

    const afterCleanup = await page.evaluate(({ legacy, v1, v2 }) => ({
      legacyExists: localStorage.getItem(legacy) !== null,
      v1Exists: localStorage.getItem(v1) !== null,
      v2Exists: localStorage.getItem(v2) !== null
    }), { legacy: legacyKey, v1: v1Key, v2: v2Key });

    expect(afterCleanup.legacyExists).toBe(false);
    expect(afterCleanup.v1Exists).toBe(false);
    expect(afterCleanup.v2Exists).toBe(true);

    expect(counter.getCount()).toBe(0);

    const prList = page.locator('#prList');
    await expect(prList).toContainText('V2 PR');
  });

  test('should clear old cache entries when making new requests', async ({ page }) => {
    const owner = 'expired-cache';
    const repo = 'repo';
    const fromDate = '2026-01-01';
    const toDate = '2026-01-10';

    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });
    const expiredCacheKey = `copilot_pr_cache_v2_${paramsKey}_noauth`;
    const expiredEntry = {
      data: [createPR({ title: 'Expired PR' })],
      timestamp: Date.now() - (10 * 60 * 1000),
      rateLimitInfo: null,
      allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }
    };

    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
      key: expiredCacheKey,
      value: JSON.stringify(expiredEntry)
    });

    const counter = await mockSearchAPIWithCounter(page, [createPR({ title: 'Fresh PR' })]);

    await submitSearch(page, { repo: `${owner}/${repo}`, fromDate, toDate });
    await waitForResults(page);

    expect(counter.getCount()).toBe(5);
    await expect(page.locator('#prList')).toContainText('Fresh PR');
    await expect(page.locator('#prList')).not.toContainText('Expired PR');
  });

  test('should handle localStorage quota exceeded gracefully', async ({ page }) => {
    await page.evaluate(() => {
      try {
        const largeData = 'x'.repeat(5 * 1024 * 1024);
        for (let i = 0; i < 10; i++) {
          localStorage.setItem(`fill_${i}`, largeData);
        }
      } catch {
        // Expected to fail
      }
    });

    await mockSearchAPI(page, { prs: [createPR()] });
    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('1');
  });

  test('should handle malformed cache entry gracefully', async ({ page }) => {
    const owner = 'malformed-cache';
    const repo = 'repo';
    const fromDate = '2026-01-01';
    const toDate = '2026-01-10';

    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });
    const cacheKey = `copilot_pr_cache_v2_${paramsKey}_noauth`;

    await page.evaluate(({ key }) => localStorage.setItem(key, 'not-valid-json'), { key: cacheKey });

    await mockSearchAPI(page, { prs: [createPR({ title: 'Fresh Data' })] });
    await submitSearch(page, { repo: `${owner}/${repo}`, fromDate, toDate });
    await waitForResults(page);

    await expect(page.locator('#prList')).toContainText('Fresh Data');
  });
});
