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

  test('should show validation error for 422', async ({ page }) => {
    await mockSearchAPI(page, {
      status: 422,
      headers: createRateLimitHeaders(4500),
      body: { message: 'Validation Failed' }
    });

    await submitSearch(page, { repo: 'test/private-repo' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Search query validation failed/i);
  });

  test('should show detailed error for 422 with cannot-be-searched message', async ({ page }) => {
    await mockSearchAPI(page, {
      status: 422,
      headers: createRateLimitHeaders(4500),
      body: {
        message: 'Validation Failed',
        errors: [{
          message: 'The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.',
          resource: 'Search',
          field: 'q',
          code: 'invalid'
        }]
      }
    });

    await submitSearch(page, { repo: 'microsoft/vscode' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/could not be resolved/i);
    await expect(page.locator('#errorMessage')).toContainText(/verify the repository name/i);
  });

  test('should show permission error for 403 when X-RateLimit-Remaining is not 0', async ({ page }) => {
    await mockSearchAPI(page, {
      status: 403,
      headers: createRateLimitHeaders(4500),
      body: { message: 'Forbidden' }
    });

    await submitSearch(page, { repo: 'test/private-repo' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Access forbidden.*HTTP 403.*insufficient permissions|SSO|abuse protection/i);
  });

  test('should show fallback error when X-RateLimit-Remaining header is missing', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 403,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Forbidden' })
      });
    });

    await submitSearch(page);
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Access forbidden|HTTP 403/i);
  });

  test('should show authentication error for 401', async ({ page }) => {
    await mockSearchAPI(page, { status: 401, body: { message: 'Bad credentials' } });
    await submitSearch(page, { token: 'invalid-token' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Authentication failed|token.*valid/i);
  });

  test('should handle 500 Internal Server Error gracefully', async ({ page }) => {
    await mockSearchAPI(page, {
      status: 500,
      body: { message: 'Internal Server Error' }
    });

    await submitSearch(page);
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/GitHub API Error.*500/i);
  });

  test('should handle network error gracefully', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', route => {
      route.abort('failed');
    });

    await submitSearch(page);
    await waitForError(page);

    await expect(page.locator('#error')).toBeVisible();
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

  test('should show rate limit error when X-RateLimit-Remaining is 0 (authenticated)', async ({ page }) => {
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
    await mockSearchAPI(page, {
      status: 403,
      headers: {
        'X-RateLimit-Limit': '30',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(resetTimestamp)
      },
      body: { message: 'API rate limit exceeded' }
    });

    await submitSearch(page, { token: 'ghp_validtoken123' });
    await waitForError(page);

    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/rate limit/i);
    await expect(errorMessage).toContainText(/Reset at|different token/i);
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

  test('should show warning color when rate limit is low', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(500, 5000, 4500)
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    await expect(page.locator('#rateLimitInfo')).toContainText('Low');
  });

  test('should hide rate limit info when starting new search', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()], delay: 200 });

    await submitSearch(page, { repo: 'test/repo1' });
    await waitForRateLimitInfo(page);

    await submitSearch(page, { repo: 'test/repo2' });

    await expect(page.locator('#rateLimitInfo')).toBeHidden();
  });

  test('should show warning status when rate limit is between 20-50%', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(1500, 5000, 3500)
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    await expect(page.locator('#rateLimitInfo')).toContainText('Warning');
  });

  test('should show unauthenticated badge when rate limit is 10', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(9, 10, 1)
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Unauthenticated');
    await expect(rateLimitInfo).toContainText('10 requests/min');
  });

  test('should show authenticated badge when rate limit is greater than 10', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(29, 30, 1)
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Authenticated');
    await expect(rateLimitInfo).toContainText('30 requests/min');
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

  test('should handle API response with missing rate limit headers', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createSearchResponse([createPR()]))
      });
    });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('1');
  });

  test('should handle extractRateLimitInfo with NaN values', async ({ page }) => {
    await page.route('https://api.github.com/search/issues**', async route => {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': 'invalid',
          'X-RateLimit-Remaining': '50',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 3600)
        },
        body: JSON.stringify(createSearchResponse([createPR()]))
      });
    });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('1');
  });
});

// ============================================================================
// API Query Tests
// ============================================================================

test.describe('API Query', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should use Search API with correct query parameters', async ({ page }) => {
    let capturedUrls = [];
    await mockSearchAPI(page, {
      prs: [],
      onRequest: (req) => { capturedUrls.push(req.url()); }
    });

    await submitSearch(page, { repo: 'owner/repo', fromDate: '2026-01-01', toDate: '2026-01-15' });
    await waitForResults(page);

    expect(capturedUrls.length).toBe(5);

    const copilotUrl = capturedUrls[0];
    expect(copilotUrl).toContain('api.github.com/search/issues');
    const decodedCopilotUrl = decodeURIComponent(copilotUrl);
    expect(decodedCopilotUrl).toContain('repo:owner/repo');
    expect(decodedCopilotUrl).toContain('is:pr');
    expect(decodedCopilotUrl).toContain('author:app/copilot-swe-agent');
    expect(decodedCopilotUrl).toContain('created:2026-01-01..2026-01-15');

    const totalUrl = capturedUrls[1];
    const decodedTotalUrl = decodeURIComponent(totalUrl);
    expect(decodedTotalUrl).toContain('repo:owner/repo');
    expect(decodedTotalUrl).toContain('is:pr');
    expect(decodedTotalUrl).not.toContain('author:app/copilot-swe-agent');
  });

  test('should detect Copilot PRs by author only', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: 'PR authored by Copilot' })] });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('1');
    await expect(page.locator('#prList')).toContainText('PR authored by Copilot');
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

  test('should show error when incomplete_results flag is true', async ({ page }) => {
    const prs = createPRs([
      { title: 'PR 1', state: 'closed', merged_at: getDaysAgoISO(5) },
      { title: 'PR 2', state: 'open' }
    ]);

    await page.route('https://api.github.com/search/issues**', async route => {
      await route.fulfill({
        status: 200,
        headers: { ...createRateLimitHeaders() },
        body: JSON.stringify({
          total_count: prs.length,
          incomplete_results: true,
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
    await expect(errorMessage).toContainText(/Search results may be incomplete/i);
    await expect(errorMessage).toContainText(/GitHub API limitations.*timeouts/i);
    await expect(errorMessage).toContainText(/try again.*narrow your date range/i);
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
});
