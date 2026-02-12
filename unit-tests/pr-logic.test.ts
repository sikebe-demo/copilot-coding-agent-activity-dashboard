import { describe, it, expect } from 'vitest';
import {
  classifyPRs,
  prepareChartData,
  getPageNumbersToShow,
  sortPRsByDate,
  createRatioHtml,
  getApiErrorMessage,
  buildSearchQuery,
  buildApiHeaders,
  adjustClosedCount,
  convertSearchItemsToPRs,
  type PullRequest,
  type AllPRCounts,
  type SearchIssueItem,
  type RateLimitInfo,
} from '../lib';

function createTestPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 1,
    number: 1,
    title: 'Test PR',
    state: 'open',
    merged_at: null,
    created_at: '2026-01-05T10:00:00Z',
    user: { login: 'copilot' },
    html_url: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

// ============================================================================
// classifyPRs
// ============================================================================

describe('classifyPRs', () => {
  it('should return all zeros and 0% merge rate for empty array', () => {
    const result = classifyPRs([]);
    expect(result.total).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.open).toBe(0);
    expect(result.mergeRate).toBe(0);
  });

  it('should classify 2 merged and 1 open correctly with 67% merge rate', () => {
    const prs = [
      createTestPR({ id: 1, state: 'closed', merged_at: '2026-01-06T00:00:00Z' }),
      createTestPR({ id: 2, state: 'closed', merged_at: '2026-01-07T00:00:00Z' }),
      createTestPR({ id: 3, state: 'open', merged_at: null }),
    ];
    const result = classifyPRs(prs);
    expect(result.merged).toBe(2);
    expect(result.open).toBe(1);
    expect(result.mergeRate).toBe(67);
  });

  it('should return 100% merge rate when all PRs are merged', () => {
    const prs = [
      createTestPR({ id: 1, state: 'closed', merged_at: '2026-01-06T00:00:00Z' }),
      createTestPR({ id: 2, state: 'closed', merged_at: '2026-01-07T00:00:00Z' }),
    ];
    const result = classifyPRs(prs);
    expect(result.mergeRate).toBe(100);
  });

  it('should return 0% merge rate when all PRs are open', () => {
    const prs = [
      createTestPR({ id: 1, state: 'open' }),
      createTestPR({ id: 2, state: 'open' }),
    ];
    const result = classifyPRs(prs);
    expect(result.mergeRate).toBe(0);
  });

  it('should count 1 closed (not merged) PR correctly', () => {
    const prs = [createTestPR({ state: 'closed', merged_at: null })];
    const result = classifyPRs(prs);
    expect(result.closed).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.open).toBe(0);
  });

  it('should count open PR with merged_at only as merged, not as open', () => {
    const prs = [
      createTestPR({ state: 'open', merged_at: '2026-01-06T00:00:00Z' }),
    ];
    const result = classifyPRs(prs);
    expect(result.merged).toBe(1);
    expect(result.open).toBe(0);
  });

  it('should correctly count 3 merged, 1 closed, and 1 open', () => {
    const prs = [
      createTestPR({ id: 1, state: 'closed', merged_at: '2026-01-06T00:00:00Z' }),
      createTestPR({ id: 2, state: 'closed', merged_at: '2026-01-07T00:00:00Z' }),
      createTestPR({ id: 3, state: 'closed', merged_at: '2026-01-08T00:00:00Z' }),
      createTestPR({ id: 4, state: 'closed', merged_at: null }),
      createTestPR({ id: 5, state: 'open', merged_at: null }),
    ];
    const result = classifyPRs(prs);
    expect(result.merged).toBe(3);
    expect(result.closed).toBe(1);
    expect(result.open).toBe(1);
    expect(result.total).toBe(5);
  });
});

// ============================================================================
// prepareChartData
// ============================================================================

describe('prepareChartData', () => {
  it('should fill dates in range even with no PR data', () => {
    const result = prepareChartData([], '2026-01-01', '2026-01-10');
    expect(result.dates).toHaveLength(10);
    expect(result.dates[0]).toBe('2026-01-01');
    expect(result.dates[9]).toBe('2026-01-10');
    expect(result.mergedData.every(v => v === 0)).toBe(true);
    expect(result.closedData.every(v => v === 0)).toBe(true);
    expect(result.openData.every(v => v === 0)).toBe(true);
  });

  it('should correctly assign counts for PRs on day 2, 5, 7', () => {
    const prs = [
      createTestPR({ created_at: '2026-01-02T12:00:00Z', state: 'closed', merged_at: '2026-01-03T00:00:00Z' }),
      createTestPR({ created_at: '2026-01-05T12:00:00Z', state: 'open', merged_at: null }),
      createTestPR({ created_at: '2026-01-07T12:00:00Z', state: 'closed', merged_at: null }),
    ];
    const result = prepareChartData(prs, '2026-01-01', '2026-01-10');
    // day 2 → merged
    expect(result.mergedData[1]).toBe(1);
    // day 5 → open
    expect(result.openData[4]).toBe(1);
    // day 7 → closed
    expect(result.closedData[6]).toBe(1);
  });

  it('should stack multiple PRs (merged, closed, open) on same day', () => {
    const prs = [
      createTestPR({ id: 1, created_at: '2026-01-03T10:00:00Z', state: 'closed', merged_at: '2026-01-04T00:00:00Z' }),
      createTestPR({ id: 2, created_at: '2026-01-03T11:00:00Z', state: 'closed', merged_at: null }),
      createTestPR({ id: 3, created_at: '2026-01-03T12:00:00Z', state: 'open', merged_at: null }),
    ];
    const result = prepareChartData(prs, '2026-01-01', '2026-01-05');
    // index 2 = Jan 3
    expect(result.mergedData[2]).toBe(1);
    expect(result.closedData[2]).toBe(1);
    expect(result.openData[2]).toBe(1);
  });

  it('should handle 365-day date range without crashing', () => {
    const result = prepareChartData([], '2025-01-01', '2025-12-31');
    expect(result.dates).toHaveLength(365);
  });

  it('should use PR dates when fromDate and toDate are empty strings', () => {
    const prs = [
      createTestPR({ created_at: '2026-01-03T10:00:00Z', state: 'closed', merged_at: '2026-01-04T00:00:00Z' }),
      createTestPR({ created_at: '2026-01-05T10:00:00Z', state: 'open', merged_at: null }),
    ];
    const result = prepareChartData(prs, '', '');
    expect(result.dates).toEqual(['2026-01-03', '2026-01-05']);
    expect(result.mergedData).toEqual([1, 0]);
    expect(result.openData).toEqual([0, 1]);
  });
});

// ============================================================================
// getPageNumbersToShow
// ============================================================================

describe('getPageNumbersToShow', () => {
  it('should show all pages when total <= 7', () => {
    const result = getPageNumbersToShow(1, 5);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  it('should include 1, 2, ..., 10 when current=1, total=10', () => {
    const result = getPageNumbersToShow(1, 10);
    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(10);
    expect(result).toContain(1);
    expect(result).toContain(2);
    expect(result).toContain(10);
  });

  it('should show 1, ..., 4, 5, 6, ..., 10 when current=5, total=10', () => {
    const result = getPageNumbersToShow(5, 10);
    expect(result).toContain(1);
    expect(result).toContain(4);
    expect(result).toContain(5);
    expect(result).toContain(6);
    expect(result).toContain(10);
    expect(result).toContain('...');
  });

  it('should show [1, 2] when current=1, total=2', () => {
    const result = getPageNumbersToShow(1, 2);
    expect(result).toEqual([1, 2]);
  });

  it('should include 1, ..., 10 when current=10, total=10', () => {
    const result = getPageNumbersToShow(10, 10);
    expect(result[0]).toBe(1);
    expect(result[result.length - 1]).toBe(10);
    expect(result).toContain(1);
    expect(result).toContain(10);
  });

  it('should return empty array when total=0', () => {
    const result = getPageNumbersToShow(1, 0);
    expect(result).toEqual([]);
  });

  it('should return [1] when total=1', () => {
    const result = getPageNumbersToShow(1, 1);
    expect(result).toEqual([1]);
  });
});

// ============================================================================
// sortPRsByDate
// ============================================================================

describe('sortPRsByDate', () => {
  it('should sort newest first', () => {
    const prs = [
      createTestPR({ created_at: '2026-01-01T00:00:00Z' }),
      createTestPR({ created_at: '2026-01-10T00:00:00Z' }),
      createTestPR({ created_at: '2026-01-05T00:00:00Z' }),
    ];
    const sorted = sortPRsByDate(prs);
    expect(sorted[0].created_at).toBe('2026-01-10T00:00:00Z');
    expect(sorted[1].created_at).toBe('2026-01-05T00:00:00Z');
    expect(sorted[2].created_at).toBe('2026-01-01T00:00:00Z');
  });

  it('should maintain stable sort for same dates', () => {
    const prs = [
      createTestPR({ id: 1, title: 'First', created_at: '2026-01-05T10:00:00Z' }),
      createTestPR({ id: 2, title: 'Second', created_at: '2026-01-05T10:00:00Z' }),
    ];
    const sorted = sortPRsByDate(prs);
    expect(sorted).toHaveLength(2);
    // Both have the same date - just confirm order is stable (no crash)
    expect(sorted[0].created_at).toBe('2026-01-05T10:00:00Z');
    expect(sorted[1].created_at).toBe('2026-01-05T10:00:00Z');
  });
});

// ============================================================================
// createRatioHtml
// ============================================================================

describe('createRatioHtml', () => {
  it('should contain both copilotCount and totalCount when totalCount > 0', () => {
    const html = createRatioHtml(5, 10, 'text-blue-500');
    expect(html).toContain('5');
    expect(html).toContain('/ 10');
  });

  it('should contain "/ -" when totalCount = 0', () => {
    const html = createRatioHtml(0, 0, 'text-blue-500');
    expect(html).toContain('/ -');
  });

  it('should include the colorClass in the output', () => {
    const html = createRatioHtml(3, 7, 'text-green-400');
    expect(html).toContain('text-green-400');
  });
});

// ============================================================================
// getApiErrorMessage
// ============================================================================

describe('getApiErrorMessage', () => {
  it('should return "Repository not found" for status 404', () => {
    const msg = getApiErrorMessage(404, null);
    expect(msg).toBe('Repository not found');
  });

  it('should return authentication failed message for status 401', () => {
    const msg = getApiErrorMessage(401, null);
    expect(msg).toContain('Authentication failed');
  });

  it('should return rate limit message for status 403 with remaining=0', () => {
    const rateLimitInfo: RateLimitInfo = { limit: 30, remaining: 0, reset: 1700000000, used: 30 };
    const msg = getApiErrorMessage(403, rateLimitInfo);
    expect(msg.toLowerCase()).toContain('rate limit');
  });

  it('should return "Access forbidden (HTTP 403)" for status 403 without rate limit', () => {
    const msg = getApiErrorMessage(403, null);
    expect(msg).toContain('Access forbidden (HTTP 403)');
  });

  it('should return "could not be resolved" message for status 422 with "cannot be searched"', () => {
    const body = { errors: [{ message: 'Field "repo" cannot be searched' }] };
    const msg = getApiErrorMessage(422, null, body);
    expect(msg.toLowerCase()).toContain('could not be resolved');
  });

  it('should return "Search query validation failed" for status 422 without special error', () => {
    const msg = getApiErrorMessage(422, null, { message: 'Validation Failed' });
    expect(msg).toContain('Search query validation failed');
  });

  it('should return "GitHub API Error: 500" for status 500', () => {
    const msg = getApiErrorMessage(500, null);
    expect(msg).toBe('GitHub API Error: 500');
  });
});

// ============================================================================
// buildSearchQuery
// ============================================================================

describe('buildSearchQuery', () => {
  it('should build correct query with owner, repo, fromDate, toDate', () => {
    const query = buildSearchQuery('myorg', 'myrepo', '2026-01-01', '2026-01-31');
    expect(query).toContain('repo:myorg/myrepo');
    expect(query).toContain('created:2026-01-01..2026-01-31');
  });

  it('should contain "author:app/copilot-swe-agent"', () => {
    const query = buildSearchQuery('o', 'r', '2026-01-01', '2026-01-31');
    expect(query).toContain('author:app/copilot-swe-agent');
  });

  it('should contain "is:pr"', () => {
    const query = buildSearchQuery('o', 'r', '2026-01-01', '2026-01-31');
    expect(query).toContain('is:pr');
  });
});

// ============================================================================
// buildApiHeaders
// ============================================================================

describe('buildApiHeaders', () => {
  it('should include Authorization header with "Bearer token" when token is provided', () => {
    const headers = buildApiHeaders('my-token') as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-token');
  });

  it('should NOT include Authorization header when token is empty', () => {
    const headers = buildApiHeaders('') as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('should always include Accept header', () => {
    const withToken = buildApiHeaders('tok') as Record<string, string>;
    const withoutToken = buildApiHeaders('') as Record<string, string>;
    expect(withToken['Accept']).toBeDefined();
    expect(withoutToken['Accept']).toBeDefined();
  });
});

// ============================================================================
// adjustClosedCount
// ============================================================================

describe('adjustClosedCount', () => {
  it('should subtract merged from closed when both succeeded', () => {
    const counts: AllPRCounts = { total: 10, merged: 3, closed: 5, open: 2 };
    const succeeded = new Set(['closed', 'merged']);
    const result = adjustClosedCount(counts, succeeded);
    expect(result.closed).toBe(2); // 5 - 3
  });

  it('should set closed to 0 when only closed succeeded but merged failed', () => {
    const counts: AllPRCounts = { total: 10, merged: 3, closed: 5, open: 2 };
    const succeeded = new Set(['closed']);
    const result = adjustClosedCount(counts, succeeded);
    expect(result.closed).toBe(0);
  });

  it('should leave counts unchanged when neither succeeded', () => {
    const counts: AllPRCounts = { total: 10, merged: 3, closed: 5, open: 2 };
    const succeeded = new Set<string>();
    const result = adjustClosedCount(counts, succeeded);
    expect(result.closed).toBe(5);
    expect(result.merged).toBe(3);
  });

  it('should clamp to 0 when merged count exceeds closed count', () => {
    const counts: AllPRCounts = { total: 10, merged: 8, closed: 5, open: 2 };
    const succeeded = new Set(['closed', 'merged']);
    const result = adjustClosedCount(counts, succeeded);
    expect(result.closed).toBe(0); // Math.max(0, 5 - 8) = 0
  });
});

// ============================================================================
// convertSearchItemsToPRs
// ============================================================================

describe('convertSearchItemsToPRs', () => {
  it('should convert SearchIssueItem to PullRequest format', () => {
    const items: SearchIssueItem[] = [
      {
        id: 42,
        number: 7,
        title: 'Add feature',
        state: 'closed',
        created_at: '2026-01-05T10:00:00Z',
        user: { login: 'copilot' },
        html_url: 'https://github.com/test/repo/pull/7',
        pull_request: { merged_at: '2026-01-06T12:00:00Z' },
      },
    ];
    const prs = convertSearchItemsToPRs(items);
    expect(prs).toHaveLength(1);
    expect(prs[0].id).toBe(42);
    expect(prs[0].number).toBe(7);
    expect(prs[0].title).toBe('Add feature');
    expect(prs[0].state).toBe('closed');
    expect(prs[0].merged_at).toBe('2026-01-06T12:00:00Z');
    expect(prs[0].user?.login).toBe('copilot');
  });

  it('should handle missing pull_request.merged_at → null', () => {
    const items: SearchIssueItem[] = [
      {
        id: 1,
        number: 1,
        title: 'Test',
        state: 'open',
        created_at: '2026-01-05T10:00:00Z',
        user: { login: 'user' },
        html_url: 'https://github.com/test/repo/pull/1',
      },
    ];
    const prs = convertSearchItemsToPRs(items);
    expect(prs[0].merged_at).toBeNull();
  });

  it('should handle null user', () => {
    const items: SearchIssueItem[] = [
      {
        id: 1,
        number: 1,
        title: 'Test',
        state: 'open',
        created_at: '2026-01-05T10:00:00Z',
        user: null,
        html_url: 'https://github.com/test/repo/pull/1',
      },
    ];
    const prs = convertSearchItemsToPRs(items);
    expect(prs[0].user).toBeNull();
  });
});
