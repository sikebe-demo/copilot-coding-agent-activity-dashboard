// ============================================================================
// Shared Test Helpers
// ============================================================================
// This module provides reusable helper functions for E2E tests

// ============================================================================
// Test Constants
// ============================================================================

export const DEFAULT_TIMEOUT = 10000;
export const RATE_LIMIT_TIMEOUT = 5000;

// ============================================================================
// Date Helpers
// ============================================================================

/**
 * Returns a Date object for N days ago from now
 * @param {number} days - Number of days ago
 * @returns {Date}
 */
export function getDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Returns an ISO string for N days ago
 * @param {number} days - Number of days ago
 * @returns {string}
 */
export function getDaysAgoISO(days) {
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
export function createPR(overrides = {}) {
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
export function createPRs(prConfigs) {
  return prConfigs.map((config, index) => createPR({
    id: index + 1,
    number: index + 1,
    html_url: `https://github.com/test/repo/pull/${index + 1}`,
    ...config
  }));
}

// ============================================================================
// GitHub API Response Helpers
// ============================================================================

/**
 * Helper function to create Search API response format
 *
 * Based on GitHub REST API documentation:
 * https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests
 */
export function createSearchResponse(prs) {
  return {
    total_count: prs.length,
    incomplete_results: false,
    items: prs.map((pr, index) => {
      const urlMatch = pr.html_url?.match(/github\.com\/([^/]+)\/([^/]+)\/pull/);
      const owner = urlMatch ? urlMatch[1] : 'test';
      const repo = urlMatch ? urlMatch[2] : 'repo';

      return {
        id: pr.id,
        node_id: `PR_${pr.id}`,
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}`,
        repository_url: `https://api.github.com/repos/${owner}/${repo}`,
        labels_url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/labels{/name}`,
        comments_url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/comments`,
        events_url: `https://api.github.com/repos/${owner}/${repo}/issues/${pr.number}/events`,
        html_url: pr.html_url,
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
        labels: pr.labels || [],
        assignee: pr.assignee || null,
        assignees: pr.assignees || [],
        milestone: pr.milestone || null,
        state: pr.state,
        locked: pr.locked || false,
        created_at: pr.created_at,
        updated_at: pr.updated_at || pr.created_at,
        closed_at: pr.state === 'closed' ? (pr.closed_at || pr.created_at) : null,
        pull_request: {
          url: `https://api.github.com/repos/${owner}/${repo}/pulls/${pr.number}`,
          html_url: pr.html_url,
          diff_url: `${pr.html_url}.diff`,
          patch_url: `${pr.html_url}.patch`,
          merged_at: pr.merged_at
        },
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
 */
export function createRateLimitHeaders(remaining = 4999, limit = 5000, used = 1) {
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

// ============================================================================
// API Mock Helpers
// ============================================================================

/**
 * Sets up a mock for the GitHub Search API
 * @param {Page} page - Playwright page object
 * @param {object} options - Mock configuration
 */
export async function mockSearchAPI(page, options = {}) {
  const {
    prs = [],
    allMergedPRs = null,
    allPRCounts = null,
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

    // If allPRCounts is provided, handle count queries (per_page=1)
    if (allPRCounts !== null) {
      const url = route.request().url();
      const queryParam = new URL(url).searchParams.get('q') || '';
      const perPage = new URL(url).searchParams.get('per_page') || '';

      if (perPage === '1' && !queryParam.includes('author:')) {
        let count = 0;
        if (queryParam.includes('is:merged')) {
          count = allPRCounts.merged || 0;
        } else if (queryParam.includes('is:open')) {
          count = allPRCounts.open || 0;
        } else {
          count = allPRCounts.total || 0;
        }
        const response = createSearchResponse([]);
        response.total_count = count;
        await route.fulfill({
          status,
          headers: { ...createRateLimitHeaders(), ...headers },
          body: JSON.stringify(response)
        });
        return;
      }
    }

    // If allMergedPRs is provided, differentiate queries
    if (allMergedPRs !== null) {
      const url = route.request().url();
      const queryParam = new URL(url).searchParams.get('q') || '';
      const perPage = new URL(url).searchParams.get('per_page') || '';

      // "All merged PRs" query: has is:merged, no author:, and per_page != 1
      if (queryParam.includes('is:merged') && !queryParam.includes('author:') && perPage !== '1') {
        // Support pagination: slice allMergedPRs based on page parameter
        const pageNum = parseInt(new URL(url).searchParams.get('page') || '1', 10);
        const pageSize = parseInt(perPage, 10) || 100;
        const start = (pageNum - 1) * pageSize;
        const pageItems = allMergedPRs.slice(start, start + pageSize);
        const response = createSearchResponse(pageItems);
        response.total_count = allMergedPRs.length;

        await route.fulfill({
          status,
          headers: { ...createRateLimitHeaders(), ...headers },
          body: JSON.stringify(response)
        });
        return;
      }
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
export async function mockSearchAPIWithCounter(page, prs = []) {
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
 */
export async function submitSearch(page, options = {}) {
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
export async function waitForResults(page) {
  await page.waitForSelector('#results', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

/**
 * Waits for the PR list to be visible
 * @param {Page} page - Playwright page object
 */
export async function waitForPRList(page) {
  await page.waitForSelector('#prList', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

/**
 * Waits for the error message to be visible
 * @param {Page} page - Playwright page object
 */
export async function waitForError(page) {
  await page.waitForSelector('#error', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

/**
 * Waits for the rate limit info to be visible
 * @param {Page} page - Playwright page object
 */
export async function waitForRateLimitInfo(page) {
  await page.waitForSelector('#rateLimitInfo', { state: 'visible', timeout: RATE_LIMIT_TIMEOUT });
}

/**
 * Waits for the chart canvas to be visible
 * @param {Page} page - Playwright page object
 */
export async function waitForChart(page) {
  await page.waitForSelector('#prChart canvas', { state: 'visible', timeout: DEFAULT_TIMEOUT });
}

// ============================================================================
// GraphQL API Response Helpers
// ============================================================================

/**
 * Converts a PR object to GraphQL node format
 * @param {object} pr - PR object from createPR()
 * @returns {object} GraphQL node
 */
export function createGraphQLPRNode(pr) {
  return {
    databaseId: pr.id,
    number: pr.number,
    title: pr.title,
    state: pr.merged_at ? 'MERGED' : pr.state === 'open' ? 'OPEN' : 'CLOSED',
    createdAt: pr.created_at,
    mergedAt: pr.merged_at || null,
    url: pr.html_url,
    author: pr.user ? { login: pr.user.login || 'copilot' } : null,
  };
}

/**
 * Creates a default GraphQL rate limit object
 */
export function createGraphQLRateLimit(remaining = 4995, limit = 5000, used = 5) {
  return {
    limit,
    remaining,
    resetAt: new Date(Date.now() + 3600000).toISOString(),
    cost: 1,
    used,
  };
}

/**
 * Creates a combined GraphQL response (Copilot PRs + all PR counts + all merged PRs)
 */
export function createGraphQLCombinedResponse(prs, allPRCounts = null, allMergedPRs = null) {
  const nodes = prs.map(createGraphQLPRNode);
  const counts = allPRCounts || {
    total: prs.length,
    merged: prs.filter(p => p.merged_at).length,
    open: prs.filter(p => p.state === 'open' && !p.merged_at).length,
  };
  const closed = Math.max(0, counts.total - counts.merged - counts.open);

  // allMergedPRs defaults to merged PRs from the provided prs list
  const mergedPRsList = allMergedPRs || prs.filter(p => p.merged_at);
  // Paginate: only include first 100 nodes (matching real GraphQL behavior)
  const mergedPageSize = 100;
  const firstPageMerged = mergedPRsList.slice(0, mergedPageSize);
  const mergedNodes = firstPageMerged.map(createGraphQLPRNode);
  const hasMoreMerged = mergedPRsList.length > mergedPageSize;

  return {
    data: {
      copilotPRs: {
        issueCount: prs.length,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes,
      },
      allMergedPRs: {
        issueCount: mergedPRsList.length,
        pageInfo: { hasNextPage: hasMoreMerged, endCursor: hasMoreMerged ? 'cursor_100' : null },
        nodes: mergedNodes,
      },
      totalCount: { issueCount: counts.total },
      mergedCount: { issueCount: counts.merged },
      openCount: { issueCount: counts.open },
      rateLimit: createGraphQLRateLimit(),
    }
  };
}

/**
 * Creates a simple GraphQL search response
 */
export function createGraphQLSearchResponse(prs) {
  const nodes = prs.map(createGraphQLPRNode);
  return {
    data: {
      search: {
        issueCount: prs.length,
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes,
      },
      rateLimit: createGraphQLRateLimit(),
    }
  };
}

/**
 * Sets up a mock for the GitHub GraphQL API
 * @param {Page} page - Playwright page object
 * @param {object} options - Mock configuration
 */
export async function mockGraphQLAPI(page, options = {}) {
  const {
    prs = [],
    allMergedPRs = null,
    allPRCounts = null,
    status = 200,
    body = null,
    delay = 0,
    onRequest = null,
  } = options;

  await page.route('https://api.github.com/graphql', async route => {
    if (onRequest) onRequest(route.request());
    if (delay > 0) await new Promise(r => setTimeout(r, delay));

    if (status !== 200) {
      await route.fulfill({
        status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? { message: 'Error' }),
      });
      return;
    }

    // Parse the request to determine query type
    const reqBody = JSON.parse(route.request().postData() || '{}');
    const query = reqBody.query || '';
    const isCombined = query.includes('copilotPRs:');

    if (isCombined) {
      // Check if this is a comparison data fetch (copilotQuery contains "is:merged" without "author:")
      const copilotQueryVar = reqBody.variables?.copilotQuery || '';
      const isComparisonFetch = copilotQueryVar.includes('is:merged') && !copilotQueryVar.includes('author:');

      if (isComparisonFetch && allMergedPRs !== null) {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createGraphQLCombinedResponse(allMergedPRs, allPRCounts)),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? createGraphQLCombinedResponse(prs, allPRCounts, allMergedPRs)),
        });
      }
    } else {
      // Simple search query — used for pagination or comparison merged PRs
      const queryVar = reqBody.variables?.query || '';
      const isComparisonMergedFetch = queryVar.includes('is:merged') && !queryVar.includes('author:');

      if (isComparisonMergedFetch && allMergedPRs !== null) {
        // Support cursor-based pagination for allMergedPRs
        const after = reqBody.variables?.after || null;
        const pageSize = 100;
        let startIndex = 0;
        if (after && after.startsWith('cursor_')) {
          startIndex = parseInt(after.replace('cursor_', ''), 10);
        }
        const pageItems = allMergedPRs.slice(startIndex, startIndex + pageSize);
        const hasNextPage = startIndex + pageSize < allMergedPRs.length;
        const endCursor = hasNextPage ? `cursor_${startIndex + pageSize}` : null;

        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: {
              search: {
                issueCount: allMergedPRs.length,
                pageInfo: { hasNextPage, endCursor },
                nodes: pageItems.map(createGraphQLPRNode),
              },
              rateLimit: createGraphQLRateLimit(),
            }
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? createGraphQLSearchResponse(prs)),
        });
      }
    }
  });
}
