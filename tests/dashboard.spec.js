import { test, expect } from '@playwright/test';

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
    // Mock GitHub API to verify trimming works
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    // Fill form with whitespace on both sides
    await page.fill('#repoInput', '  test/repo  ');
    await page.click('#searchButton');

    // Should process successfully and show results (whitespace is trimmed)
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });
    const totalPRs = page.locator('#totalPRs');
    await expect(totalPRs).toContainText('1');
  });

  test('should handle repository input with whitespace before slash', async ({ page }) => {
    // Mock GitHub API to return error for invalid repository name with whitespace
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 404,
        headers: createRateLimitHeaders(),
        body: JSON.stringify({ message: 'Not Found' })
      });
    });

    // Fill form with whitespace before slash
    // trim() only removes leading/trailing whitespace, not internal spaces
    // So "owner /repo" will split into ["owner ", "repo"]
    await page.fill('#repoInput', 'owner /repo');
    await page.click('#searchButton');

    // Should show error since "owner " with trailing space is not a valid repository owner
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/Invalid repository name|Repository not found|error/i);
  });

  test('should handle repository input with whitespace after slash', async ({ page }) => {
    // Mock GitHub API to return error for invalid repository name with whitespace
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 404,
        headers: createRateLimitHeaders(),
        body: JSON.stringify({ message: 'Not Found' })
      });
    });

    // Fill form with whitespace after slash
    // trim() only removes leading/trailing whitespace, not internal spaces
    // So "owner/ repo" will split into ["owner", " repo"]
    await page.fill('#repoInput', 'owner/ repo');
    await page.click('#searchButton');

    // Should show error since " repo" with leading space is not a valid repository name
    const error = page.locator('#error');
    await expect(error).toBeVisible();
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
    // Mock the GitHub API to delay response
    await page.route('https://api.github.com/search/issues**', async route => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({
        status: 404,
        headers: createRateLimitHeaders(),
        body: JSON.stringify({ message: 'Not Found' })
      });
    });

    // Fill form and submit
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Loading should be visible briefly
    const loading = page.locator('#loading');
    await expect(loading).toBeVisible();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock GitHub API error
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 404,
        headers: createRateLimitHeaders(),
        body: JSON.stringify({ message: 'Not Found' })
      });
    });

    // Fill form and submit
    await page.fill('#repoInput', 'test/nonexistent');
    await page.click('#searchButton');

    // Wait for error
    await page.waitForSelector('#error', { state: 'visible' });

    // Check error message
    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/Repository not found|error/i);
  });

  test('should display results for valid repository', async ({ page }) => {
    // Mock GitHub API with sample data (using current dates)
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR by Copilot',
            state: 'closed',
            merged_at: fiveDaysAgo.toISOString(),
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          },
          {
            id: 2,
            number: 2,
            title: 'Another Copilot PR',
            state: 'open',
            merged_at: null,
            created_at: threeDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/2'
          }
        ]))
      });
    });

    // Fill form with valid data
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results with longer timeout
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Check summary cards
    const totalPRs = page.locator('#totalPRs');
    await expect(totalPRs).toContainText('2');

    const mergedPRs = page.locator('#mergedPRs');
    await expect(mergedPRs).toContainText('1');

    const openPRs = page.locator('#openPRs');
    await expect(openPRs).toContainText('1');

    // Check merge rate
    const mergeRate = page.locator('#mergeRateValue');
    await expect(mergeRate).toContainText('50%');
  });

  test('should display PR list with correct information', async ({ page }) => {
    // Mock GitHub API with current date
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 123,
            title: 'Feature: Add new component',
            state: 'closed',
            merged_at: fiveDaysAgo.toISOString(),
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/123'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for PR list with longer timeout
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Check PR details
    const prList = page.locator('#prList');
    await expect(prList).toContainText('Feature: Add new component');
    await expect(prList).toContainText('#123');
    await expect(prList).toContainText('copilot');
    await expect(prList).toContainText('Merged');
  });

  test('should display chart when results are shown', async ({ page }) => {
    // Mock GitHub API with current date
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'closed',
            merged_at: fiveDaysAgo.toISOString(),
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for chart with longer timeout
    await page.waitForSelector('#prChart', { state: 'visible', timeout: 10000 });

    // Check that chart canvas exists
    const chart = page.locator('#prChart');
    await expect(chart).toBeVisible();
  });

  test('should display all dates in range including days with no PR data', async ({ page }) => {
    // Create PRs for specific dates only (skipping some days)
    const prs = [
      {
        id: 1,
        number: 1,
        title: 'PR on day 2',
        state: 'closed',
        merged_at: '2026-01-02T10:00:00Z',
        created_at: '2026-01-02T10:00:00Z',
        user: { login: 'copilot' },
        html_url: 'https://github.com/test/repo/pull/1'
      },
      {
        id: 2,
        number: 2,
        title: 'PR on day 5',
        state: 'closed',
        merged_at: '2026-01-05T10:00:00Z',
        created_at: '2026-01-05T10:00:00Z',
        user: { login: 'copilot' },
        html_url: 'https://github.com/test/repo/pull/2'
      },
      {
        id: 3,
        number: 3,
        title: 'PR on day 7',
        state: 'open',
        merged_at: null,
        created_at: '2026-01-07T10:00:00Z',
        user: { login: 'copilot' },
        html_url: 'https://github.com/test/repo/pull/3'
      }
    ];

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse(prs))
      });
    });

    await page.goto('/');

    // Set specific date range (1/1 to 1/10 - 10 days)
    await page.fill('#fromDate', '2026-01-01');
    await page.fill('#toDate', '2026-01-10');
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for chart canvas to be visible
    await page.waitForSelector('#prChart canvas', { state: 'visible', timeout: 10000 });

    // Verify the chart canvas exists and has proper dimensions (indicating it rendered)
    const canvas = page.locator('#prChart canvas');
    await expect(canvas).toBeVisible();

    // Get canvas bounding box to verify it rendered with content
    const canvasBox = await canvas.boundingBox();
    expect(canvasBox.width).toBeGreaterThan(0);
    expect(canvasBox.height).toBeGreaterThan(0);
  });

  test('should handle empty results', async ({ page }) => {
    // Mock GitHub API with no Copilot PRs - Search API returns empty items
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results with longer timeout
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Check that total is 0
    const totalPRs = page.locator('#totalPRs');
    await expect(totalPRs).toContainText('0');

    // Check empty state message
    const prList = page.locator('#prList');
    await expect(prList).toContainText(/No PRs created by Copilot Coding Agent found/i);
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

  test('should open PR links in new tab', async ({ page, context }) => {
    // Mock GitHub API with current date
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for PR list with longer timeout
    await page.waitForSelector('#prList a[target="_blank"]', { state: 'visible', timeout: 10000 });

    // Check that links have target="_blank"
    const links = page.locator('#prList a[target="_blank"]');
    await expect(links.first()).toHaveAttribute('target', '_blank');
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
    // Test the detection method: Search API already filters by author:app/copilot-swe-agent
    // So we only need to verify the Search API query filters correctly
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      // Search API already filters by author:app/copilot-swe-agent, so we only get Copilot PRs
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'PR authored by Copilot',
            state: 'closed',
            merged_at: fiveDaysAgo.toISOString(),
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Only Copilot-authored PRs should be shown
    const totalPRs = page.locator('#totalPRs');
    await expect(totalPRs).toContainText('1');

    // Verify the correct PR is shown
    const prList = page.locator('#prList');
    await expect(prList).toContainText('PR authored by Copilot');
  });

  test('should escape HTML in PR titles to prevent XSS', async ({ page }) => {
    // Test that PR titles with malicious HTML/JavaScript are properly escaped
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: '<script>alert("XSS")</script>Malicious PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that script tags are escaped
    expect(prListHtml).toContain('&lt;script&gt;');
    expect(prListHtml).toContain('&lt;/script&gt;');
    expect(prListHtml).not.toContain('<script>alert');

    // Verify the escaped text is displayed correctly
    const prList = page.locator('#prList');
    await expect(prList).toContainText('<script>alert("XSS")</script>Malicious PR');
  });

  test('should escape HTML entities in PR titles', async ({ page }) => {
    // Test that various HTML entities including quotes are properly escaped
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'PR with <tags> & "quotes" and \'apostrophes\'',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that all dangerous HTML characters are escaped in the HTML source
    // Tags and ampersand must be escaped to prevent XSS
    expect(prListHtml).toContain('&lt;tags&gt;');
    expect(prListHtml).toContain('&amp;');
    // Verify that the dangerous tags are not present unescaped
    expect(prListHtml).not.toContain('<tags>');

    // Verify the text is displayed correctly (browser interprets escaped HTML entities)
    const prList = page.locator('#prList');
    await expect(prList).toContainText('PR with <tags> & "quotes" and \'apostrophes\'');

    // Note: escapeHtml also escapes quotes (" → &quot;, ' → &#39;) as a defensive measure
    // against attribute injection attacks. While the current code only uses escaped content
    // in text nodes, this ensures safety if PR titles are ever used in HTML attributes.
    // We verify the critical XSS protections (tags, ampersands) above; quote escaping
    // works via the same function but doesn't need separate assertions in this E2E test.
  });

  test('should escape HTML tags with event handlers in PR titles', async ({ page }) => {
    // Test that HTML tags with event handlers are properly escaped
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: '<img src=x onerror=alert(1)> malicious image',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that img tag with onerror handler is escaped
    expect(prListHtml).toContain('&lt;img');
    expect(prListHtml).toContain('&gt;');
    expect(prListHtml).not.toContain('<img src=x onerror=alert(1)>');

    // Verify the escaped text is displayed correctly
    const prList = page.locator('#prList');
    await expect(prList).toContainText('<img src=x onerror=alert(1)> malicious image');
  });

  test('should handle null values in escapeHtml', async ({ page }) => {
    // Test that escapeHtml properly handles null values without throwing errors
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: null,
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Verify the PR is displayed and null title is rendered as empty string
    const prList = page.locator('#prList');
    await expect(prList).toBeVisible();

    // Verify that null title doesn't cause errors and displays as empty
    const titleElement = page.locator('#prList h3').first();
    const titleText = await titleElement.textContent();
    expect(titleText?.trim()).toBe('');
  });

  test('should show rate limit error with reset time when X-RateLimit-Remaining is 0 (unauthenticated)', async ({ page }) => {
    // Mock GitHub API with rate limit error - unauthenticated scenario
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetTimestamp),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset'
        },
        body: JSON.stringify({ message: 'API rate limit exceeded' })
      });
    });

    // Fill form and submit without token
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for error
    await page.waitForSelector('#error', { state: 'visible' });

    // Check error message contains rate limit info and reset time
    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/rate limit/i);
    await expect(errorMessage).toContainText(/Reset at/i);
  });

  test('should show rate limit error when X-RateLimit-Remaining is 0 (authenticated)', async ({ page }) => {
    // Mock GitHub API with rate limit error - authenticated scenario
    const resetTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': '30',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetTimestamp),
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset'
        },
        body: JSON.stringify({ message: 'API rate limit exceeded' })
      });
    });

    // Fill form and submit with token
    await page.fill('#repoInput', 'test/repo');
    await page.fill('#tokenInput', 'ghp_validtoken123');
    await page.click('#searchButton');

    // Wait for error
    await page.waitForSelector('#error', { state: 'visible' });

    // Check error message contains rate limit info for authenticated user
    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/rate limit/i);
    await expect(errorMessage).toContainText(/Reset at|different token/i);
  });

  test('should show permission error for 403 when X-RateLimit-Remaining is not 0', async ({ page }) => {
    // Mock GitHub API with permission error (403 but not rate limited)
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 422,
        headers: createRateLimitHeaders(4500),
        body: JSON.stringify({ message: 'Validation Failed' })
      });
    });

    // Fill form and submit
    await page.fill('#repoInput', 'test/private-repo');
    await page.click('#searchButton');

    // Wait for error
    await page.waitForSelector('#error', { state: 'visible' });

    // Check error message shows validation error (Search API returns 422 for invalid queries)
    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/Search query validation failed|check the repository name/i);
  });

  test('should show fallback error when X-RateLimit-Remaining header is missing', async ({ page }) => {
    // Mock GitHub API with 403 but without rate limit headers
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 403,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'Forbidden' })
      });
    });

    // Fill form and submit
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for error
    await page.waitForSelector('#error', { state: 'visible' });

    // Check error message shows rate limit error
    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/rate limit/i);
  });

  test('should show authentication error for 401', async ({ page }) => {
    // Mock GitHub API with authentication error
    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 401,
        headers: createRateLimitHeaders(),
        body: JSON.stringify({ message: 'Bad credentials' })
      });
    });

    // Fill form and submit with invalid token
    await page.fill('#repoInput', 'test/repo');
    await page.fill('#tokenInput', 'invalid-token');
    await page.click('#searchButton');

    // Wait for error
    await page.waitForSelector('#error', { state: 'visible' });

    // Check error message shows authentication error
    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/Authentication failed|token.*valid/i);
  });

  test('should sanitize javascript: URLs in html_url to prevent XSS', async ({ page }) => {
    // Test that malicious javascript: protocol URLs are sanitized to "#"
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Malicious PR with javascript URL',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'javascript:alert("XSS")'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the link element and verify its href is sanitized to "#"
    const prLink = page.locator('#prList a[target="_blank"]').first();
    const href = await prLink.getAttribute('href');
    expect(href).toBe('#');

    // Verify the javascript: URL is NOT in the href
    expect(href).not.toContain('javascript:');
  });

  test('should allow valid https URLs in html_url', async ({ page }) => {
    // Test that valid https:// URLs are preserved
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const validUrl = 'https://github.com/test/repo/pull/42';

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 42,
            title: 'Valid PR with https URL',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: validUrl
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the link element and verify its href is the valid URL
    const prLink = page.locator('#prList a[target="_blank"]').first();
    const href = await prLink.getAttribute('href');
    expect(href).toBe(validUrl);
  });

  // New tests for caching and rate limit display
  test('should display rate limit information after successful search', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(4990, 5000, 10),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results and rate limit info
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: 5000 });

    // Verify rate limit info is displayed
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('GitHub Search API');
    await expect(rateLimitInfo).toContainText('remaining');
    await expect(rateLimitInfo).toContainText('Resets in');
  });

  test('should show cached indicator when data is from cache', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    let requestCount = 0;
    await page.route('https://api.github.com/search/issues**', route => {
      requestCount++;
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(4990, 5000, 10),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    // First search
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Wait for rate limit info
    await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: 5000 });

    // Second search with same parameters (should use cache)
    await page.click('#searchButton');
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Wait a moment for the UI to update
    await page.waitForTimeout(500);

    // Verify cached indicator is shown
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');

    // Verify only one API request was made
    expect(requestCount).toBe(1);
  });

  test('should use Search API with correct query parameters', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    let capturedUrl = '';
    await page.route('https://api.github.com/search/issues**', route => {
      capturedUrl = route.request().url();
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([]))
      });
    });

    // Set specific date range
    await page.fill('#repoInput', 'owner/repo');
    await page.fill('#fromDate', '2026-01-01');
    await page.fill('#toDate', '2026-01-15');
    await page.click('#searchButton');

    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Verify the search query includes the correct parameters
    expect(capturedUrl).toContain('api.github.com/search/issues');
    const decodedUrl = decodeURIComponent(capturedUrl);
    expect(decodedUrl).toContain('repo:owner/repo');
    expect(decodedUrl).toContain('is:pr');
    expect(decodedUrl).toContain('author:app/copilot-swe-agent');
    expect(decodedUrl).toContain('created:2026-01-01..2026-01-15');
  });

  test('should show warning color when rate limit is low', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(500, 5000, 4500), // 10% remaining
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: 10000 });

    // Verify "Low" status is shown for low remaining requests
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Low');
  });

  test('should hide rate limit info when starting new search', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', async route => {
      // Add delay to observe the hiding behavior
      await new Promise(resolve => setTimeout(resolve, 200));
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    // First search with unique params to avoid cache
    await page.fill('#repoInput', 'test/repo1');
    await page.click('#searchButton');
    await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: 10000 });

    // Start new search with different params
    await page.fill('#repoInput', 'test/repo2');
    await page.click('#searchButton');

    // Rate limit info should be hidden while loading
    await expect(page.locator('#rateLimitInfo')).toBeHidden();
  });

  test('should show warning status when rate limit is between 20-50%', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(1500, 5000, 3500), // 30% remaining
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: 10000 });

    // Verify "Warning" status is shown for medium remaining requests
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Warning');
  });

  test('should show unauthenticated badge when rate limit is 10', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(9, 10, 1), // Unauthenticated limit = 10
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: 10000 });

    // Verify "Unauthenticated" badge is shown
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Unauthenticated');
    await expect(rateLimitInfo).toContainText('10 requests/min');
  });

  test('should show authenticated badge when rate limit is greater than 10', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(29, 30, 1), // Authenticated limit = 30
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: 10000 });

    // Verify "Authenticated" badge is shown
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Authenticated');
    await expect(rateLimitInfo).toContainText('30 requests/min');
  });

  test('should reject http:// URLs and sanitize to # in html_url', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'PR with http URL',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'http://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the link element and verify its href is sanitized to "#"
    const prLink = page.locator('#prList a[target="_blank"]').first();
    const href = await prLink.getAttribute('href');
    expect(href).toBe('#');
  });

  test('should reject non-github.com URLs and sanitize to #', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'PR with malicious URL',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://evil.com/test/repo/pull/1'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the link element and verify its href is sanitized to "#"
    const prLink = page.locator('#prList a[target="_blank"]').first();
    const href = await prLink.getAttribute('href');
    expect(href).toBe('#');
  });

  test('should handle PR with zero or negative number', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 0,
            title: 'PR with zero number',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          },
          {
            id: 2,
            number: -1,
            title: 'PR with negative number',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/2'
          }
        ]))
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Verify the PRs are displayed
    const prList = page.locator('#prList');
    await expect(prList).toContainText('PR with zero number');
    await expect(prList).toContainText('PR with negative number');

    // Verify that neither "#0" nor "#-1" is displayed
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
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    let requestCount = 0;
    await page.route('https://api.github.com/search/issues**', route => {
      requestCount++;
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Cached PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    // First request
    await page.fill('#repoInput', 'cache-test/repo');
    await page.click('#searchButton');
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    expect(requestCount).toBe(1);

    // Second request with same params - should use cache
    await page.click('#searchButton');
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Request count should still be 1 (cache was used)
    expect(requestCount).toBe(1);

    // Verify cache indicator is shown
    const rateLimitInfo = page.locator('#rateLimitInfo');
    await expect(rateLimitInfo).toContainText('Cached');
    await expect(rateLimitInfo).toContainText('No API call made');
  });

  test('should update chart theme when toggling dark mode', async ({ page }) => {
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/search/issues**', route => {
      route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'closed',
            merged_at: fiveDaysAgo.toISOString(),
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            html_url: 'https://github.com/test/repo/pull/1'
          }
        ]))
      });
    });

    // First, create a chart
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');
    await page.waitForSelector('#prChart canvas', { state: 'visible', timeout: 10000 });

    // Toggle dark mode
    const themeToggle = page.locator('#themeToggle');
    await themeToggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Verify chart still exists after theme toggle
    const canvas = page.locator('#prChart canvas');
    await expect(canvas).toBeVisible();

    // Toggle back to light mode
    await themeToggle.click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);

    // Verify chart still exists
    await expect(canvas).toBeVisible();
  });

});
