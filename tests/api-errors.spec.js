import { test, expect } from '@playwright/test';
import {
  createPR,
  createPRs,
  createSearchResponse,
  createRateLimitHeaders,
  mockSearchAPI,
  submitSearch,
  waitForResults,
  waitForError,
  waitForRateLimitInfo,
  getDaysAgoISO
} from './helpers.js';

// ============================================================================
// API Error Handling Tests
// ============================================================================
// Tests for API errors, rate limiting, and network issues

test.describe('API Errors', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });
    await submitSearch(page, { repo: 'test/nonexistent' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Repository not found|error/i);
  });

  test('should show authentication error for 401', async ({ page }) => {
    await mockSearchAPI(page, { status: 401, body: { message: 'Bad credentials' } });
    await submitSearch(page, { token: 'invalid-token' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Authentication failed|token.*valid/i);
  });

  test('should handle network error gracefully', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', route => {
      route.abort('failed');
    });

    await submitSearch(page);
    await waitForError(page);

    await expect(page.locator('#error')).toBeVisible();
  });

  test('should have correct ARIA attributes on error element for screen readers', async ({ page }) => {
    await mockSearchAPI(page, { status: 500, body: { message: 'Server Error' } });
    await submitSearch(page);
    await waitForError(page);

    const errorElement = page.locator('#error');
    await expect(errorElement).toHaveAttribute('role', 'alert');
    await expect(errorElement).toHaveAttribute('aria-live', 'assertive');
  });

  test('should show error when API returns incomplete_results: true', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      await route.fulfill({
        status: 200,
        headers: { ...createRateLimitHeaders() },
        body: JSON.stringify({
          total_count: 5,
          incomplete_results: true,
          items: []
        })
      });
    });

    await submitSearch(page);
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/incomplete/i);
  });
});

// ============================================================================
// Rate Limit Tests
// ============================================================================

test.describe('Rate Limiting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should show rate limit error with reset time when X-RateLimit-Remaining is 0 (unauthenticated)', async ({ page }) => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
    await mockSearchAPI(page, {
      status: 403,
      headers: {
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(resetTimestamp)
      },
      body: { message: 'API rate limit exceeded' }
    });

    await submitSearch(page);
    await waitForError(page);

    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/rate limit/i);
    await expect(errorMessage).toContainText(/Reset at/i);
  });

  test('should display rate limit information after successful search', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(4990, 5000, 10)
    });

    await submitSearch(page);
    await waitForResults(page);
    await waitForRateLimitInfo(page);

    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('GitHub Search API');
    await expect(rateLimitInfo).toContainText('remaining');
    await expect(rateLimitInfo).toContainText('Resets in');
  });

  test('should hide rate limit info when starting new search', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()], delay: 200 });

    await submitSearch(page, { repo: 'test/repo1' });
    await waitForRateLimitInfo(page);

    await submitSearch(page, { repo: 'test/repo2' });

    await expect(page.locator('#rateLimitInfo')).toBeHidden();
  });

  test('should display rate limit info with countdown timer', async ({ page }) => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 120;
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: {
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': '25',
        'X-RateLimit-Reset': String(resetTimestamp),
        'X-RateLimit-Used': '5'
      }
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    const countdownText = await page.locator('#rateLimitCountdown').textContent();
    expect(countdownText).toMatch(/\d+:\d{2}/);
  });

});

// ============================================================================
// Pagination & Large Results Tests
// ============================================================================

test.describe('Large Results Handling', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should show error when total_count exceeds 1000 results', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      const url = new URL(route.request().url());
      const currentPage = parseInt(url.searchParams.get('page') || '1');

      const prs = Array.from({ length: 100 }, (_, i) => createPR({
        id: (currentPage - 1) * 100 + i + 1,
        number: (currentPage - 1) * 100 + i + 1,
        title: `PR ${(currentPage - 1) * 100 + i + 1}`,
        state: 'closed',
        merged_at: getDaysAgoISO(5)
      }));

      await route.fulfill({
        status: 200,
        headers: { ...createRateLimitHeaders() },
        body: JSON.stringify({
          total_count: 1500,
          incomplete_results: false,
          items: prs.map(pr => ({
            id: pr.id,
            node_id: `PR_${pr.id}`,
            number: pr.number,
            title: pr.title,
            state: pr.state,
            created_at: pr.created_at,
            user: { login: 'copilot' },
            html_url: pr.html_url,
            pull_request: { merged_at: pr.merged_at }
          }))
        })
      });
    });

    await submitSearch(page);
    await waitForError(page);

    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/Results truncated.*1500.*PRs/i);
    await expect(errorMessage).toContainText(/only the first 1000 could be fetched/i);
    await expect(errorMessage).toContainText(/narrow your date range/i);
  });

  test('should handle pagination for multiple pages of results', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async (route, request) => {
      const url = new URL(request.url());
      const currentPage = parseInt(url.searchParams.get('page') || '1');
      const isCopilotQuery = url.searchParams.get('q')?.includes('copilot-swe-agent');

      if (!isCopilotQuery) {
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders() },
          body: JSON.stringify({ total_count: 150, incomplete_results: false, items: [] })
        });
        return;
      }

      const itemCount = currentPage === 1 ? 100 : 50;
      const prs = Array.from({ length: itemCount }, (_, i) => ({
        id: (currentPage - 1) * 100 + i + 1,
        node_id: `PR_${(currentPage - 1) * 100 + i + 1}`,
        number: (currentPage - 1) * 100 + i + 1,
        title: `PR ${(currentPage - 1) * 100 + i + 1}`,
        state: 'open',
        created_at: getDaysAgoISO(1),
        user: { login: 'copilot' },
        html_url: `https://github.com/test/repo/pull/${(currentPage - 1) * 100 + i + 1}`,
        pull_request: { merged_at: null }
      }));

      await route.fulfill({
        status: 200,
        headers: { ...createRateLimitHeaders() },
        body: JSON.stringify({
          total_count: 150,
          incomplete_results: false,
          items: prs
        })
      });
    });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('150');
  });

  test('should clear error and show results when retry succeeds', async ({ page }) => {
    const prs = createPRs([
      { title: 'Success PR', state: 'open', created_at: getDaysAgoISO(5) },
    ]);

    await page.route('https://api.github.com/search/issues**', async route => {
      const url = decodeURIComponent(route.request().url());
      if (url.includes('fail-repo')) {
        await route.fulfill({
          status: 500,
          headers: createRateLimitHeaders(),
          body: JSON.stringify({ message: 'Internal Server Error' }),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(createSearchResponse(prs)),
        });
      }
    });

    await submitSearch(page, { repo: 'test/fail-repo' });
    await waitForError(page);
    await expect(page.locator('#error')).toBeVisible();

    await submitSearch(page, { repo: 'test/success-repo' });
    await waitForResults(page);

    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#results')).toBeVisible();
  });
});
