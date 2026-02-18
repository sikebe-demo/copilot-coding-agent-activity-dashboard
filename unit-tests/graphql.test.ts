import { describe, it, expect } from 'vitest';
import { convertGraphQLPRs, convertGraphQLRateLimit } from '../lib';
import type { GraphQLPullRequest, GraphQLRateLimit } from '../lib';

// ============================================================================
// convertGraphQLPRs
// ============================================================================

describe('convertGraphQLPRs', () => {
    function createGraphQLPR(overrides: Partial<GraphQLPullRequest> = {}): GraphQLPullRequest {
        return {
            databaseId: 100,
            number: 1,
            title: 'Test PR',
            state: 'OPEN',
            createdAt: '2026-01-15T10:00:00Z',
            mergedAt: null,
            url: 'https://github.com/owner/repo/pull/1',
            author: { login: 'testuser' },
            ...overrides,
        };
    }

    it('should return empty array for empty input', () => {
        expect(convertGraphQLPRs([])).toEqual([]);
    });

    it('should map OPEN state to "open"', () => {
        const result = convertGraphQLPRs([createGraphQLPR({ state: 'OPEN' })]);
        expect(result[0].state).toBe('open');
    });

    it('should map CLOSED state to "closed"', () => {
        const result = convertGraphQLPRs([createGraphQLPR({ state: 'CLOSED' })]);
        expect(result[0].state).toBe('closed');
    });

    it('should map MERGED state to "closed"', () => {
        const result = convertGraphQLPRs([createGraphQLPR({ state: 'MERGED', mergedAt: '2026-01-16T12:00:00Z' })]);
        expect(result[0].state).toBe('closed');
    });

    it('should preserve mergedAt as merged_at correctly', () => {
        const mergedPR = createGraphQLPR({ state: 'MERGED', mergedAt: '2026-01-16T12:00:00Z' });
        const openPR = createGraphQLPR({ state: 'OPEN', mergedAt: null });
        const closedPR = createGraphQLPR({ state: 'CLOSED', mergedAt: null });

        const result = convertGraphQLPRs([mergedPR, openPR, closedPR]);

        expect(result[0].merged_at).toBe('2026-01-16T12:00:00Z');
        expect(result[1].merged_at).toBeNull();
        expect(result[2].merged_at).toBeNull();
    });

    it('should map author to user correctly', () => {
        const pr = createGraphQLPR({ author: { login: 'copilot-swe-agent' } });
        const result = convertGraphQLPRs([pr]);
        expect(result[0].user).toEqual({ login: 'copilot-swe-agent' });
    });

    it('should map null author to null user', () => {
        const pr = createGraphQLPR({ author: null });
        const result = convertGraphQLPRs([pr]);
        expect(result[0].user).toBeNull();
    });

    it('should map databaseId to id', () => {
        const pr = createGraphQLPR({ databaseId: 42 });
        const result = convertGraphQLPRs([pr]);
        expect(result[0].id).toBe(42);
    });

    it('should map createdAt to created_at', () => {
        const pr = createGraphQLPR({ createdAt: '2026-02-01T08:30:00Z' });
        const result = convertGraphQLPRs([pr]);
        expect(result[0].created_at).toBe('2026-02-01T08:30:00Z');
    });

    it('should map url to html_url', () => {
        const pr = createGraphQLPR({ url: 'https://github.com/owner/repo/pull/99' });
        const result = convertGraphQLPRs([pr]);
        expect(result[0].html_url).toBe('https://github.com/owner/repo/pull/99');
    });

    it('should convert multiple PRs preserving order', () => {
        const prs = [
            createGraphQLPR({ databaseId: 1, number: 10, state: 'MERGED', mergedAt: '2026-01-16T12:00:00Z' }),
            createGraphQLPR({ databaseId: 2, number: 20, state: 'OPEN' }),
            createGraphQLPR({ databaseId: 3, number: 30, state: 'CLOSED' }),
        ];
        const result = convertGraphQLPRs(prs);

        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({ id: 1, number: 10, state: 'closed', merged_at: '2026-01-16T12:00:00Z' });
        expect(result[1]).toMatchObject({ id: 2, number: 20, state: 'open', merged_at: null });
        expect(result[2]).toMatchObject({ id: 3, number: 30, state: 'closed', merged_at: null });
    });
});

// ============================================================================
// convertGraphQLRateLimit
// ============================================================================

describe('convertGraphQLRateLimit', () => {
    it('should convert resetAt ISO string to Unix timestamp in seconds', () => {
        const resetAt = '2026-01-15T12:00:00Z';
        const expectedUnix = Math.floor(new Date(resetAt).getTime() / 1000);

        const rl: GraphQLRateLimit = { limit: 5000, remaining: 4995, resetAt, cost: 1, used: 5 };
        const result = convertGraphQLRateLimit(rl);

        expect(result.reset).toBe(expectedUnix);
    });

    it('should preserve limit, remaining, and used values', () => {
        const rl: GraphQLRateLimit = { limit: 5000, remaining: 4990, resetAt: '2026-01-15T12:00:00Z', cost: 2, used: 10 };
        const result = convertGraphQLRateLimit(rl);

        expect(result.limit).toBe(5000);
        expect(result.remaining).toBe(4990);
        expect(result.used).toBe(10);
    });

    it('should NOT include cost in output', () => {
        const rl: GraphQLRateLimit = { limit: 5000, remaining: 4999, resetAt: '2026-01-15T12:00:00Z', cost: 3, used: 1 };
        const result = convertGraphQLRateLimit(rl);

        expect(result).not.toHaveProperty('cost');
        expect(Object.keys(result).sort()).toEqual(['limit', 'remaining', 'reset', 'used']);
    });
});
