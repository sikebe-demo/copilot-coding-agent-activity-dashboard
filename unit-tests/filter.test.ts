import { describe, it, expect } from 'vitest';
import { filterPRs } from '../lib';
import type { PullRequest } from '../lib';

function createTestPR(overrides: Partial<PullRequest> = {}): PullRequest {
    return {
        id: 1,
        number: 100,
        title: 'Test PR',
        state: 'open',
        merged_at: null,
        created_at: '2024-06-01T00:00:00Z',
        user: { login: 'copilot' },
        html_url: 'https://github.com/owner/repo/pull/100',
        ...overrides,
    };
}

describe('filterPRs', () => {
    const prs: PullRequest[] = [
        createTestPR({ id: 1, title: 'Add login feature', state: 'closed', merged_at: '2024-06-02T00:00:00Z' }),
        createTestPR({ id: 2, title: 'Fix bug in parser', state: 'closed', merged_at: null }),
        createTestPR({ id: 3, title: 'Update README', state: 'open', merged_at: null }),
        createTestPR({ id: 4, title: 'Add logout feature', state: 'closed', merged_at: '2024-06-03T00:00:00Z' }),
    ];

    it('returns all PRs when filter is "all" and no search text', () => {
        const result = filterPRs(prs, 'all', '');
        expect(result).toHaveLength(4);
    });

    it('filters by merged status', () => {
        const result = filterPRs(prs, 'merged', '');
        expect(result).toHaveLength(2);
        expect(result.every(pr => pr.merged_at !== null)).toBe(true);
    });

    it('filters by closed (not merged) status', () => {
        const result = filterPRs(prs, 'closed', '');
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Fix bug in parser');
    });

    it('filters by open status', () => {
        const result = filterPRs(prs, 'open', '');
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Update README');
    });

    it('filters by search text (case-insensitive)', () => {
        const result = filterPRs(prs, 'all', 'feature');
        expect(result).toHaveLength(2);
        expect(result.map(pr => pr.title)).toEqual(['Add login feature', 'Add logout feature']);
    });

    it('combines status filter and search text', () => {
        const result = filterPRs(prs, 'merged', 'login');
        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Add login feature');
    });

    it('returns empty array when no PRs match', () => {
        const result = filterPRs(prs, 'open', 'nonexistent');
        expect(result).toHaveLength(0);
    });

    it('trims whitespace from search text', () => {
        const result = filterPRs(prs, 'all', '  README  ');
        expect(result).toHaveLength(1);
    });

    it('handles PRs with null title gracefully', () => {
        const prsWithNull = [createTestPR({ title: null })];
        const result = filterPRs(prsWithNull, 'all', 'test');
        expect(result).toHaveLength(0);
    });

    it('returns all when search is empty whitespace', () => {
        const result = filterPRs(prs, 'all', '   ');
        expect(result).toHaveLength(4);
    });
});
