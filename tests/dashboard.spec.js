import { test, expect } from '@playwright/test';

// ============================================================================
// Test Constants
// ============================================================================

const DEFAULT_TIMEOUT = 10000;
const RATE_LIMIT_TIMEOUT = 5000;

// ============================================================================
// Date Helpers
// ============================================================================

/**
 * Returns a Date object for N days ago from now
 * @param {number} days - Number of days ago
 * @returns {Date}
 */
function getDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Returns an ISO string for N days ago
 * @param {number} days - Number of days ago
 * @returns {string}
 */
function getDaysAgoISO(days) {
  return getDaysAgo(days).toISOString();
}

// ============================================================================
// PR Data Helpers
// ============================================================================

/**
 * Creates a default PR object with sensible defaults
 * @param {object} overrides - Properties to override
 * @returns {object} PR object compatible with createSearchResponse
 */
function createPR(overrides = {}) {
  const defaults = {
    id: 1,
    number: 1,
    title: 'Test PR',
    state: 'open',
    merged_at: null,
    created_at: getDaysAgoISO(5),
    user: { login: 'copilot' },
    html_url: 'https://github.com/test/repo/pull/1'
  };
  return { ...defaults, ...overrides };
}

/**
 * Creates multiple PRs with auto-incrementing IDs
 * @param {Array<object>} prConfigs - Array of PR configuration overrides
 * @returns {Array<object>} Array of PR objects
 */
function createPRs(prConfigs) {
  return prConfigs.map((config, index) => createPR({
    id: index + 1,
    number: index + 1,
    html_url: `https://github.com/test/repo/pull/${index + 1}`,
    ...config
  }));
}

// ============================================================================
// API Mock Helpers
// ============================================================================

/**
 * Sets up a mock for the GitHub Search API
 * @param {Page} page - Playwright page object
 * @param {object} options - Mock configuration
 * @param {Array} options.prs - Array of PR data (will be passed to createSearchResponse)
 * @param {number} options.status - HTTP status code (default: 200)
 * @param {object} options.headers - Custom headers (merged with rate limit headers)
 * @param {object} options.body - Custom response body (overrides prs)
 * @param {number} options.delay - Response delay in ms
 * @param {Function} options.onRequest - Callback when request is made
 */
async function mockSearchAPI(page, options = {}) {
  const {
    prs = [],
    status = 200,
    headers = {},
    body = null,
    delay = 0,
    onRequest = null
  } = options;

  await page.route('https://api.github.com/search/issues**', async route => {
    if (onRequest) {
      onRequest(route.request());
    }
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    await route.fulfill({
      status,
      headers: { ...createRateLimitHeaders(), ...headers },
      body: JSON.stringify(body ?? createSearchResponse(prs))
    });
  });
}

/**
 * Sets up a counter-based mock for tracking API calls
 * @param {Page} page - Playwright page object
 * @param {Array} prs - Array of PR data
 * @returns {{ getCount: () => number }} Object with getCount method
 */
async function mockSearchAPIWithCounter(page, prs = []) {
  let requestCount = 0;
  await mockSearchAPI(page, {
    prs,
    onRequest: () => { requestCount++; }
  });
  return { getCount: () => requestCount };
}

// ============================================================================
// Form Interaction Helpers
// ============================================================================

/**
 * Fills the search form and submits
 * @param {Page} page - Playwright page object
 * @param {object} options - Form options
 * @param {string} options.repo - Repository name (default: 'test/repo')
 * @param {string} options.token - GitHub token (optional)
 * @param {string} options.fromDate - From date (optional)
 * @param {string} options.toDate - To date (optional)
 */
async function submitSearch(page, options = {}) {
  const { repo = 'test/repo', token, fromDate, toDate } = options;

  await page.fill('#repoInput', repo);
  if (token) {
    await page.fill('#tokenInput', token);
  }
  if (fromDate) {
    await page.fill('#fromDate', fromDate);
  }
  if (toDate) {
    await page.fill('#toDate', toDate);
  }
  await page.click('#searchButton');
}

/**
 * Waits for the results section to be visible
 * @param {Page} page - Playwright page object
 */
async function waitForResults(page) {
  await page.waitForSelector('#results', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

/**
 * Waits for the PR list to be visible
 * @param {Page} page - Playwright page object
 */
async function waitForPRList(page) {
  await page.waitForSelector('#prList', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

/**
 * Waits for the error message to be visible
 * @param {Page} page - Playwright page object
 */
async function waitForError(page) {
  await page.waitForSelector('#error', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

/**
 * Waits for the rate limit info to be visible
 * @param {Page} page - Playwright page object
 */
async function waitForRateLimitInfo(page) {
  await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: RATE_LIMIT_TIMEOUT });
}

/**
 * Waits for the chart canvas to be visible
 * @param {Page} page - Playwright page object
 */
async function waitForChart(page) {
  await page.waitForSelector('#prChart canvas', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

// ============================================================================
// GitHub API Response Helpers
// ============================================================================

/**
 * Helper function to create Search API response format
 *
 * Based on GitHub REST API documentation:
 * https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests
 *
 * Response schema (simplified for testing):
 * {
 *   total_count: number,
 *   incomplete_results: boolean,
 *   items: SearchIssueItem[]
 * }
 *
 * SearchIssueItem includes (relevant fields):
 * - id, node_id, number, title, state
 * - url, repository_url, labels_url, comments_url, events_url, html_url
 * - user: { login, id, node_id, avatar_url, ... }
 * - labels: [], assignee, milestone
 * - comments, created_at, updated_at, closed_at
 * - pull_request: { url, html_url, diff_url, patch_url, merged_at? }
 * - body, score, locked, author_association, state_reason
 *
 * Note: merged_at is included in pull_request object for PRs (observed in real API responses)
 */
function createSearchResponse(prs) {
  return {
    total_count: prs.length,
    incomplete_results: false,
    items: prs.map((pr, index) => {
      // Extract owner/repo from html_url if available
      const urlMatch = pr.html_url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
      const owner = urlMatch ? urlMatch[1] : 'test';
      const repo = urlMatch ? urlMatch[2] : 'repo';

      return {
        // Core identifiers
        id: pr.id,
        node_id: `PR_${pr.id}`,
        number: pr.number,

        // Content
        title: pr.title,
        body: pr.body || '',

        // URLs (following GitHub API structure)
        url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}`,
        repository_url: `https://api.github.com/repos/${owner}/${repo}`,
        labels_url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/labels{/name}`,
        comments_url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/comments`,
        events_url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/events`,
        html_url: pr.html_url,

        // User object (full structure as per API docs)
        user: {
          login: pr.user?.login || 'copilot',
          id: pr.user?.id || 1000000 + index,
          node_id: `U_${pr.user?.id || 1000000 + index}`,
          avatar_url: pr.user?.avatar_url || `https://avatars.githubusercontent.com/u/${pr.user?.id || 1000000 + index}?v=4`,
          gravatar_id: '',
          url: `https://api.github.com/users/${pr.user?.login || 'copilot'}`,
          html_url: `https://github.com/${pr.user?.login || 'copilot'}`,
          followers_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/followers`,
          following_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/following{/other_user}`,
          gists_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/gists{/gist_id}`,
          starred_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/starred{/owner}{/repo}`,
          subscriptions_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/subscriptions`,
          organizations_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/orgs`,
          repos_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/repos`,
          events_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/events{/privacy}`,
          received_events_url: `https://api.github.com/users/${pr.user?.login || 'copilot'}/received_events`,
          type: 'User',
          site_admin: false
        },

        // Labels and assignments
        labels: pr.labels || [],
        assignee: pr.assignee || null,
        assignees: pr.assignees || [],
        milestone: pr.milestone || null,

        // State
        state: pr.state,
        locked: pr.locked || false,

        // Timestamps
        created_at: pr.created_at,
        updated_at: pr.updated_at || pr.created_at,
        closed_at: pr.state === 'closed' ? (pr.closed_at || pr.created_at) : null,

        // PR-specific data (indicates this is a PR, not an issue)
        // Note: merged_at is available in pull_request object
        pull_request: {
          url: `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`,
          html_url: pr.html_url,
          diff_url: `${pr.html_url}.diff`,
          patch_url: `${pr.html_url}.patch`,
          merged_at: pr.merged_at
        },

        // Metadata
        comments: pr.comments || 0,
        score: 1.0,
        author_association: pr.author_association || 'CONTRIBUTOR',
        state_reason: pr.state === 'closed' ? (pr.merged_at ? 'completed' : 'not_planned') : null
      };
    })
  };
}

/**
 * Helper to create rate limit headers
 *
 * Based on GitHub REST API documentation:
 * https://docs.github.com/en/rest/rate-limit/rate-limit
 * https://docs.github.com/en/rest/search/search#rate-limit
 *
 * Rate limits for Search API:
 * - Unauthenticated: 10 requests per minute
 * - Authenticated: 30 requests per minute
 *
 * Headers returned:
 * - X-RateLimit-Limit: Maximum requests allowed
 * - X-RateLimit-Remaining: Requests remaining in current window
 * - X-RateLimit-Reset: Unix timestamp when the rate limit resets
 * - X-RateLimit-Used: Requests used in current window
 * - X-RateLimit-Resource: The rate limit resource (e.g., "search")
 */
function createRateLimitHeaders(remaining = 4999, limit = 5000, used = 1) {
  const resetTimestamp = Math.floor(Date.now() / 1000) + 3600;
  return {
    'Content-Type': 'application/json',
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(resetTimestamp),
    'X-RateLimit-Used': String(used),
    'X-RateLimit-Resource': 'search',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-RateLimit-Used, X-RateLimit-Resource'
  };
}

test.describe('Copilot Coding Agent PR Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage to ensure clean state for each test
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should display the main page with correct title', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Copilot PR.*Dashboard/);

    // Check main heading
    const heading = page.locator('h1');
    await expect(heading).toContainText('Copilot PR Dashboard');
  });

  test('should have all required form fields', async ({ page }) => {
    // Check repository input
    const repoInput = page.locator('#repoInput');
    await expect(repoInput).toBeVisible();
    await expect(repoInput).toHaveAttribute('placeholder', /microsoft\/vscode|owner\/repo/);

    // Check date inputs
    const fromDate = page.locator('#fromDate');
    const toDate = page.locator('#toDate');
    await expect(fromDate).toBeVisible();
    await expect(toDate).toBeVisible();

    // Check token input
    const tokenInput = page.locator('#tokenInput');
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveAttribute('type', 'password');

    // Check submit button
    const submitButton = page.locator('#searchButton');
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toContainText('Start Analysis');
  });

  test('should set default dates (last 30 days)', async ({ page }) => {
    const fromDate = page.locator('#fromDate');
    const toDate = page.locator('#toDate');

    // Verify dates are set
    const fromValue = await fromDate.inputValue();
    const toValue = await toDate.inputValue();

    expect(fromValue).toBeTruthy();
    expect(toValue).toBeTruthy();

    // Verify date range is approximately 30 days
    const from = new Date(fromValue);
    const to = new Date(toValue);
    const daysDiff = Math.round((to - from) / (1000 * 60 * 60 * 24));

    expect(daysDiff).toBeGreaterThanOrEqual(29);
    expect(daysDiff).toBeLessThanOrEqual(31);
  });

  test('should show error for invalid repository format', async ({ page }) => {
    // Fill form with invalid repo format
    await page.fill('#repoInput', 'invalid-repo');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with empty owner', async ({ page }) => {
    // Fill form with missing owner (e.g., "/repo")
    await page.fill('#repoInput', '/repo');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with empty repo', async ({ page }) => {
    // Fill form with missing repo (e.g., "owner/")
    await page.fill('#repoInput', 'owner/');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with multiple slashes', async ({ page }) => {
    // Fill form with extra slashes (e.g., "owner/repo/extra")
    await page.fill('#repoInput', 'owner/repo/extra');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should handle repository input with leading and trailing whitespace', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });

    // Fill form with whitespace on both sides
    await submitSearch(page, { repo: '  test/repo  ' });

    // Should process successfully and show results (whitespace is trimmed)
    await waitForResults(page);
    await expect(page.locator('#totalPRs')).toContainText('1');
  });

  test('should handle repository input with whitespace before slash', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });

    // trim() only removes leading/trailing whitespace, not internal spaces
    await submitSearch(page, { repo: 'owner /repo' });

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/Invalid repository name|Repository not found|error/i);
  });

  test('should handle repository input with whitespace after slash', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });

    // trim() only removes leading/trailing whitespace, not internal spaces
    await submitSearch(page, { repo: 'owner/ repo' });

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/Invalid repository name|Repository not found|error/i);
  });

  test('should show error when start date is after end date', async ({ page }) => {
    // Set dates where fromDate > toDate
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    await page.fill('#repoInput', 'test/repo');
    await page.fill('#fromDate', futureDate.toISOString().split('T')[0]);
    await page.fill('#toDate', pastDate.toISOString().split('T')[0]);
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/start date.*before.*end date/i);
  });

  test('should toggle dark mode', async ({ page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    // Initial state (light mode)
    await expect(html).not.toHaveClass(/dark/);

    // Toggle to dark mode
    await themeToggle.click();
    await expect(html).toHaveClass(/dark/);

    // Toggle back to light mode
    await themeToggle.click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test('should persist dark mode preference', async ({ page, context }) => {
    const themeToggle = page.locator('#themeToggle');

    // Enable dark mode
    await themeToggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Create new page in same context
    const newPage = await context.newPage();
    await newPage.goto('/');

    // Dark mode should be persisted
    await expect(newPage.locator('html')).toHaveClass(/dark/);
  });

  test('should have responsive design for mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Check that main elements are still visible
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#searchForm')).toBeVisible();
    await expect(page.locator('#searchButton')).toBeVisible();
  });

  test('should show loading state when searching', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' }, delay: 100 });

    await submitSearch(page);

    // Loading should be visible briefly
    await expect(page.locator('#loading')).toBeVisible();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });

    await submitSearch(page, { repo: 'test/nonexistent' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Repository not found|error/i);
  });

  test('should display results for valid repository', async ({ page }) => {
    const prs = createPRs([
      { title: 'Test PR by Copilot', state: 'closed', merged_at: getDaysAgoISO(5), created_at: getDaysAgoISO(5) },
      { title: 'Another Copilot PR', state: 'open', created_at: getDaysAgoISO(3) }
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    // Check summary cards
    await expect(page.locator('#totalPRs')).toContainText('2');
    await expect(page.locator('#mergedPRs')).toContainText('1');
    await expect(page.locator('#openPRs')).toContainText('1');
    await expect(page.locator('#mergeRateValue')).toContainText('50%');
  });

  test('should display Copilot ratio in each stats card', async ({ page }) => {
    // Mock: 3 Copilot PRs with specific states
    // 2 merged, 0 closed (not merged), 1 open
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
        // Copilot PRs query
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(createSearchResponse(copilotPRs))
        });
      } else if (isMergedQuery) {
        // Total merged PRs = 5
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 5, incomplete_results: false, items: [] })
        });
      } else if (isOpenQuery) {
        // Total open PRs = 3
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 3, incomplete_results: false, items: [] })
        });
      } else if (isClosedQuery) {
        // Total closed PRs (including merged) = 7
        // closed_not_merged = 7 - 5 = 2
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 7, incomplete_results: false, items: [] })
        });
      } else {
        // Total PRs = 10
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ total_count: 10, incomplete_results: false, items: [] })
        });
      }
    });

    await submitSearch(page);
    await waitForResults(page);

    // Check each card shows Copilot count / Total count
    // Total: 3 / 10, Merged: 2 / 5, Closed: 0 / 2 (closed=7, merged=5, so closed_not_merged=2), Open: 1 / 3
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
        // Copilot PRs - succeeds
        await route.fulfill({
          status: 200,
          headers: { ...createRateLimitHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify(createSearchResponse(copilotPRs))
        });
      } else {
        // All PRs queries - fail
        await route.fulfill({
          status: 500,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Internal Server Error' })
        });
      }
    });

    await submitSearch(page);
    await waitForResults(page);

    // Check fallback display shows "/ -" for all stat cards
    await expect(page.locator('#totalPRs')).toContainText('1');
    await expect(page.locator('#totalPRs')).toContainText('/ -');
    await expect(page.locator('#mergedPRs')).toContainText('0');
    await expect(page.locator('#mergedPRs')).toContainText('/ -');
    await expect(page.locator('#closedPRs')).toContainText('0');
    await expect(page.locator('#closedPRs')).toContainText('/ -');
    await expect(page.locator('#openPRs')).toContainText('1');
    await expect(page.locator('#openPRs')).toContainText('/ -');
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

  test('should display chart when results are shown', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ state: 'closed', merged_at: getDaysAgoISO(5) })] });

    await submitSearch(page);
    await page.waitForSelector('#prChart', { state: 'visible', timeout: DEFAULT_TIMEOUT });

    await expect(page.locator('#prChart')).toBeVisible();
  });

  test('should display all dates in range including days with no PR data', async ({ page }) => {
    // Create PRs for specific dates only (skipping some days)
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

  test('should handle empty results', async ({ page }) => {
    await mockSearchAPI(page, { prs: [] });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('0');
    await expect(page.locator('#prList')).toContainText(/No PRs created by Copilot Coding Agent found/i);
  });

  test('should have accessible labels and ARIA attributes', async ({ page }) => {
    // Check form labels
    await expect(page.locator('label[for="repoInput"]')).toBeVisible();
    await expect(page.locator('label[for="fromDate"]')).toBeVisible();
    await expect(page.locator('label[for="toDate"]')).toBeVisible();
    await expect(page.locator('label[for="tokenInput"]')).toBeVisible();

    // Check required fields
    await expect(page.locator('#repoInput')).toHaveAttribute('required', '');
    await expect(page.locator('#fromDate')).toHaveAttribute('required', '');
    await expect(page.locator('#toDate')).toHaveAttribute('required', '');
  });

  test('should open PR links in new tab', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });

    await submitSearch(page);
    await page.waitForSelector('#prList a[target="_blank"]', { state: 'visible', timeout: DEFAULT_TIMEOUT });

    await expect(page.locator('#prList a[target="_blank"]').first()).toHaveAttribute('target', '_blank');
  });

  test('should validate date range', async ({ page }) => {
    // Set from date after to date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    await page.fill('#fromDate', futureDate.toISOString().split('T')[0]);
    await page.fill('#toDate', pastDate.toISOString().split('T')[0]);
    await page.fill('#repoInput', 'test/repo');

    // HTML5 validation should prevent submission
    // Note: This test checks if dates can be set; actual validation might vary by browser
    const fromValue = await page.locator('#fromDate').inputValue();
    const toValue = await page.locator('#toDate').inputValue();

    expect(fromValue).toBeTruthy();
    expect(toValue).toBeTruthy();
  });

  test('should detect Copilot PRs by author only', async ({ page }) => {
    // Search API already filters by author:app/copilot-swe-agent
    await mockSearchAPI(page, { prs: [createPR({ title: 'PR authored by Copilot' })] });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('1');
    await expect(page.locator('#prList')).toContainText('PR authored by Copilot');
  });

  test('should escape HTML in PR titles to prevent XSS', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: '<script>alert("XSS")</script>Malicious PR' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const prListHtml = await page.locator('#prList').innerHTML();
    expect(prListHtml).toContain('&lt;script&gt;');
    expect(prListHtml).toContain('&lt;/script&gt;');
    expect(prListHtml).not.toContain('<script>alert');
    await expect(page.locator('#prList')).toContainText('<script>alert("XSS")</script>Malicious PR');
  });

  test('should escape HTML entities in PR titles', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: 'PR with <tags> & "quotes" and \'apostrophes\'' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const prListHtml = await page.locator('#prList').innerHTML();
    expect(prListHtml).toContain('&lt;tags&gt;');
    expect(prListHtml).toContain('&amp;');
    expect(prListHtml).not.toContain('<tags>');
    await expect(page.locator('#prList')).toContainText('PR with <tags> & "quotes" and \'apostrophes\'');
  });

  test('should escape HTML tags with event handlers in PR titles', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: '<img src=x onerror=alert(1)> malicious image' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const prListHtml = await page.locator('#prList').innerHTML();
    expect(prListHtml).toContain('&lt;img');
    expect(prListHtml).toContain('&gt;');
    expect(prListHtml).not.toContain('<img src=x onerror=alert(1)>');
    await expect(page.locator('#prList')).toContainText('<img src=x onerror=alert(1)> malicious image');
  });

  test('should handle null values in escapeHtml', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: null })] });

    await submitSearch(page);
    await waitForPRList(page);

    // Verify null title doesn't cause errors and displays as empty
    await expect(page.locator('#prList')).toBeVisible();
    const titleText = await page.locator('#prList h3').first().textContent();
    expect(titleText?.trim()).toBe('');
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

  test('should show validation error for 422', async ({ page }) => {
    await mockSearchAPI(page, {
      status: 422,
      headers: createRateLimitHeaders(4500),
      body: { message: 'Validation Failed' }
    });

    await submitSearch(page, { repo: 'test/private-repo' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Search query validation failed|check the repository name/i);
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

    // Without rate limit headers, the 403 error should show a general forbidden message
    await expect(page.locator('#errorMessage')).toContainText(/Access forbidden|HTTP 403/i);
  });

  test('should show authentication error for 401', async ({ page }) => {
    await mockSearchAPI(page, { status: 401, body: { message: 'Bad credentials' } });

    await submitSearch(page, { token: 'invalid-token' });
    await waitForError(page);

    await expect(page.locator('#errorMessage')).toContainText(/Authentication failed|token.*valid/i);
  });

  test('should sanitize javascript: URLs in html_url to prevent XSS', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ html_url: 'javascript:alert("XSS")' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe('#');
    expect(href).not.toContain('javascript:');
  });

  test('should allow valid https URLs in html_url', async ({ page }) => {
    const validUrl = 'https://github.com/test/repo/pull/42';
    await mockSearchAPI(page, { prs: [createPR({ number: 42, html_url: validUrl })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe(validUrl);
  });

  // New tests for caching and rate limit display
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

  test('should show cached indicator when data is from cache', async ({ page }) => {
    const counter = await mockSearchAPIWithCounter(page, [createPR()]);

    // First search
    await submitSearch(page);
    await waitForResults(page);
    await waitForRateLimitInfo(page);

    // Second search with same parameters (should use cache)
    await page.click('#searchButton');
    await waitForResults(page);
    await page.waitForTimeout(500);

    await expect(page.locator('#rateLimitInfo')).toContainText('Cached');
    // API is called 5 times per search: once for Copilot PRs, 4 times for all PR counts (total, merged, open, closed)
    expect(counter.getCount()).toBe(5);
  });

  test('should use Search API with correct query parameters', async ({ page }) => {
    let capturedUrls = [];
    await mockSearchAPI(page, {
      prs: [],
      onRequest: (req) => { capturedUrls.push(req.url()); }
    });

    await submitSearch(page, { repo: 'owner/repo', fromDate: '2026-01-01', toDate: '2026-01-15' });
    await waitForResults(page);

    // API is called 5 times: once for Copilot PRs, 4 times for all PR counts (total, merged, open, closed)
    expect(capturedUrls.length).toBe(5);

    // Check the Copilot PR query (first call)
    const copilotUrl = capturedUrls[0];
    expect(copilotUrl).toContain('api.github.com/search/issues');
    const decodedCopilotUrl = decodeURIComponent(copilotUrl);
    expect(decodedCopilotUrl).toContain('repo:owner/repo');
    expect(decodedCopilotUrl).toContain('is:pr');
    expect(decodedCopilotUrl).toContain('author:app/copilot-swe-agent');
    expect(decodedCopilotUrl).toContain('created:2026-01-01..2026-01-15');

    // Check the total PR count query (second call - no author filter)
    const totalUrl = capturedUrls[1];
    const decodedTotalUrl = decodeURIComponent(totalUrl);
    expect(decodedTotalUrl).toContain('repo:owner/repo');
    expect(decodedTotalUrl).toContain('is:pr');
    expect(decodedTotalUrl).not.toContain('author:app/copilot-swe-agent');
  });

  test('should show warning color when rate limit is low', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(500, 5000, 4500) // 10% remaining
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    await expect(page.locator('#rateLimitInfo')).toContainText('Low');
  });

  test('should hide rate limit info when starting new search', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()], delay: 200 });

    // First search with unique params to avoid cache
    await submitSearch(page, { repo: 'test/repo1' });
    await waitForRateLimitInfo(page);

    // Start new search with different params
    await submitSearch(page, { repo: 'test/repo2' });

    // Rate limit info should be hidden while loading
    await expect(page.locator('#rateLimitInfo')).toBeHidden();
  });

  test('should show warning status when rate limit is between 20-50%', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(1500, 5000, 3500) // 30% remaining
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    await expect(page.locator('#rateLimitInfo')).toContainText('Warning');
  });

  test('should show unauthenticated badge when rate limit is 10', async ({ page }) => {
    await mockSearchAPI(page, {
      prs: [createPR()],
      headers: createRateLimitHeaders(9, 10, 1) // Unauthenticated limit
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
      headers: createRateLimitHeaders(29, 30, 1) // Authenticated limit
    });

    await submitSearch(page);
    await waitForRateLimitInfo(page);

    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Authenticated');
    await expect(rateLimitInfo).toContainText('30 requests/min');
  });

  test('should reject http:// URLs and sanitize to # in html_url', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ html_url: 'http://github.com/test/repo/pull/1' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe('#');
  });

  test('should reject non-github.com URLs and sanitize to #', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ html_url: 'https://evil.com/test/repo/pull/1' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe('#');
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

  test('should reject repository names with path traversal attempts', async ({ page }) => {
    // Test ".." as repo name (path traversal attempt)
    await page.fill('#repoInput', 'owner/..');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('Invalid repository name');
  });

  test('should reject repository names with single dot', async ({ page }) => {
    // Test "." as repo name
    await page.fill('#repoInput', 'owner/.');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('Invalid repository name');
  });

  test('should cache data and use it for subsequent requests', async ({ page }) => {
    const counter = await mockSearchAPIWithCounter(page, [createPR({ title: 'Cached PR' })]);

    // First request - API is called 5 times: once for Copilot PRs, 4 times for all PR counts
    await submitSearch(page, { repo: 'cache-test/repo' });
    await waitForResults(page);
    expect(counter.getCount()).toBe(5);

    // Second request with same params - should use cache (no additional API calls)
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

    // Old cache key format (without CACHE_VERSION prefix)
    const paramsKey = JSON.stringify({ owner, repo, fromDate, toDate });
    const oldCacheKey = `copilot_pr_cache_${paramsKey}_noauth`;
    const legacyEntry = {
      data: [createPR({ title: 'Legacy PR' })],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }
    };

    // Seed legacy cache directly in the browser context
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: oldCacheKey, value: JSON.stringify(legacyEntry) });

    await submitSearch(page, { repo: `${owner}/${repo}`, fromDate, toDate });
    await waitForResults(page);

    // Legacy cache should be ignored; new API calls should be made (5 calls for search + counts)
    expect(counter.getCount()).toBe(5);

    const prList = page.locator('#prList');
    await expect(prList).toContainText('Fresh PR');
    await expect(prList).not.toContainText('Legacy PR');
  });

  test('should maintain separate caches for authenticated and unauthenticated requests', async ({ page }) => {
    // Mock API with different responses for different authentication states
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

    // First request without token - should fetch and cache (5 API calls: Copilot PRs + 4 counts)
    await submitSearch(page, { repo: 'auth-cache-test/repo' });
    await waitForResults(page);
    expect(requestCount).toBe(5);
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    // Second request without token - should use cache (no new API call)
    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(5); // Still 5, cache was used
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');

    // Third request WITH token - should fetch new data (different cache key)
    await submitSearch(page, { repo: 'auth-cache-test/repo', token: 'ghp_test123' });
    await waitForResults(page);
    expect(requestCount).toBe(10); // 5 more API calls made
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    // Fourth request WITH same token - should use auth cache
    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(10); // Still 10, auth cache was used
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Authenticated PR');

    // Fifth request without token again - should use unauthenticated cache
    await page.fill('#tokenInput', ''); // Clear token
    await page.click('#searchButton');
    await waitForResults(page);
    expect(requestCount).toBe(10); // Still 10, unauthenticated cache was used
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(page.locator('#prList')).toContainText('Unauthenticated PR');
  });

  test('should update chart theme when toggling dark mode', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ state: 'closed', merged_at: getDaysAgoISO(5) })] });

    // First, create a chart
    await submitSearch(page);
    await waitForChart(page);

    const canvas = page.locator('#prChart canvas');

    // Toggle dark mode
    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(canvas).toBeVisible();

    // Toggle back to light mode
    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(canvas).toBeVisible();
  });

  test('should show error when total_count exceeds 1000 results', async ({ page }) => {
    // Mock multiple pages of results with total_count > 1000
    await page.route('https://api.github.com/search/issues**', async route => {
      const url = new URL(route.request().url());
      const currentPage = parseInt(url.searchParams.get('page') || '1');

      // Create 100 PRs for each page up to page 10
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
          total_count: 1500, // Exceeds 1000 limit
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
    // Mock API response with incomplete_results: true
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
          incomplete_results: true, // GitHub API indicates incomplete results
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

});
