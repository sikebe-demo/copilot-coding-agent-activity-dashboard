import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getCacheKey,
  getFromCache,
  saveToCache,
  clearOldCache,
  isCacheEntry,
  CACHE_KEY_PREFIX,
  CACHE_VERSION,
  CACHE_DURATION_MS,
  resetCacheCleanupTimer,
  CACHE_CLEANUP_INTERVAL_MS,
} from '../lib';
import type { PullRequest, CacheEntry, AllPRCounts } from '../lib';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(initialData: Record<string, string> = {}): Storage {
  const store = new Map<string, string>(Object.entries(initialData));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  } as Storage;
}

function createTestPR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 1,
    number: 1,
    title: 'Test PR',
    state: 'open',
    merged_at: null,
    created_at: '2026-01-01T00:00:00Z',
    user: { login: 'copilot' },
    html_url: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

const defaultAllPRCounts: AllPRCounts = { total: 1, merged: 0, closed: 0, open: 1 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getCacheKey', () => {
  it('should include version prefix (v3)', () => {
    const key = getCacheKey('owner', 'repo', '2026-01-01', '2026-01-31', false);
    expect(key).toContain(CACHE_VERSION);
    expect(key).toContain(CACHE_KEY_PREFIX);
  });

  it('should separate authenticated and unauthenticated cache keys', () => {
    const authKey = getCacheKey('owner', 'repo', '2026-01-01', '2026-01-31', true);
    const noAuthKey = getCacheKey('owner', 'repo', '2026-01-01', '2026-01-31', false);
    expect(authKey).not.toBe(noAuthKey);
    expect(authKey).toContain('_auth');
    expect(noAuthKey).toContain('_noauth');
  });

  it('should produce different keys for different repos', () => {
    const key1 = getCacheKey('owner', 'repo-a', '2026-01-01', '2026-01-31', false);
    const key2 = getCacheKey('owner', 'repo-b', '2026-01-01', '2026-01-31', false);
    expect(key1).not.toBe(key2);
  });

  it('should produce different keys for different date ranges', () => {
    const key1 = getCacheKey('owner', 'repo', '2026-01-01', '2026-01-31', false);
    const key2 = getCacheKey('owner', 'repo', '2026-02-01', '2026-02-28', false);
    expect(key1).not.toBe(key2);
  });
});

describe('getFromCache', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    vi.restoreAllMocks();
  });

  it('should return null for missing key', () => {
    expect(getFromCache('nonexistent_key', storage)).toBeNull();
  });

  it('should return cached entry when valid', () => {
    const pr = createTestPR();
    const entry: CacheEntry = {
      data: [pr],
      timestamp: Date.now(),
      rateLimitInfo: { limit: 30, remaining: 29, reset: 0, used: 1 },
      allPRCounts: defaultAllPRCounts,
      allMergedPRs: [],
    };
    const key = 'test_cache_key';
    storage.setItem(key, JSON.stringify(entry));

    const result = getFromCache(key, storage);
    expect(result).not.toBeNull();
    expect(result!.data).toHaveLength(1);
    expect(result!.data[0].title).toBe('Test PR');
    expect(result!.allPRCounts).toEqual(defaultAllPRCounts);
  });

  it('should return null and remove expired entries', () => {
    const pr = createTestPR();
    const entry: CacheEntry = {
      data: [pr],
      timestamp: Date.now() - CACHE_DURATION_MS - 1000, // expired
      rateLimitInfo: null,
      allPRCounts: defaultAllPRCounts,
      allMergedPRs: [],
    };
    const key = 'expired_key';
    storage.setItem(key, JSON.stringify(entry));

    const result = getFromCache(key, storage);
    expect(result).toBeNull();
    // Entry should be removed from storage
    expect(storage.getItem(key)).toBeNull();
  });

  it('should return null for malformed JSON entry', () => {
    const key = 'malformed_key';
    storage.setItem(key, '{invalid json!!!');

    const result = getFromCache(key, storage);
    expect(result).toBeNull();
  });

  it('should handle entries with null rateLimitInfo', () => {
    const pr = createTestPR();
    const entry: CacheEntry = {
      data: [pr],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: defaultAllPRCounts,
      allMergedPRs: [],
    };
    const key = 'null_ratelimit_key';
    storage.setItem(key, JSON.stringify(entry));

    const result = getFromCache(key, storage);
    expect(result).not.toBeNull();
    expect(result!.rateLimitInfo).toBeNull();
    expect(result!.data).toHaveLength(1);
  });
});

describe('saveToCache', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    vi.restoreAllMocks();
  });

  it('should save and retrieve data correctly', () => {
    const pr = createTestPR({ title: 'Saved PR' });
    const rateLimitInfo = { limit: 30, remaining: 25, reset: 1700000000, used: 5 };
    const counts: AllPRCounts = { total: 1, merged: 0, closed: 0, open: 1 };
    const key = 'save_test_key';

    saveToCache(key, [pr], rateLimitInfo, counts, [], storage);

    const raw = storage.getItem(key);
    expect(raw).not.toBeNull();

    const parsed: CacheEntry = JSON.parse(raw!);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].title).toBe('Saved PR');
    expect(parsed.rateLimitInfo).toEqual(rateLimitInfo);
    expect(parsed.allPRCounts).toEqual(counts);
    expect(parsed.timestamp).toBeGreaterThan(0);
  });

  it('should silently handle storage quota exceeded', () => {
    const throwingStorage = createMockStorage();
    throwingStorage.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };

    const pr = createTestPR();
    // Should not throw
    expect(() =>
      saveToCache('quota_key', [pr], null, defaultAllPRCounts, [], throwingStorage)
    ).not.toThrow();
  });
});

describe('clearOldCache', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    vi.restoreAllMocks();
    resetCacheCleanupTimer();
  });

  it('should remove legacy cache entries (no version prefix)', () => {
    const legacyKey = `${CACHE_KEY_PREFIX}someOldData`;
    storage.setItem(legacyKey, JSON.stringify({ data: [], timestamp: Date.now() }));

    clearOldCache(storage);

    expect(storage.getItem(legacyKey)).toBeNull();
  });

  it('should remove v1 cache entries (wrong version)', () => {
    const v1Key = `${CACHE_KEY_PREFIX}v1_someData`;
    storage.setItem(v1Key, JSON.stringify({ data: [], timestamp: Date.now() }));

    clearOldCache(storage);

    expect(storage.getItem(v1Key)).toBeNull();
  });

  it('should keep v2 cache entries (current version)', () => {
    const v2Key = `${CACHE_KEY_PREFIX}${CACHE_VERSION}_validEntry`;
    const entry: CacheEntry = {
      data: [createTestPR()],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: defaultAllPRCounts,
      allMergedPRs: [],
    };
    storage.setItem(v2Key, JSON.stringify(entry));

    clearOldCache(storage);

    expect(storage.getItem(v2Key)).not.toBeNull();
  });

  it('should remove expired v2 entries', () => {
    const expiredKey = `${CACHE_KEY_PREFIX}${CACHE_VERSION}_expiredEntry`;
    const entry: CacheEntry = {
      data: [createTestPR()],
      timestamp: Date.now() - CACHE_DURATION_MS - 1000,
      rateLimitInfo: null,
      allPRCounts: defaultAllPRCounts,
      allMergedPRs: [],
    };
    storage.setItem(expiredKey, JSON.stringify(entry));

    clearOldCache(storage);

    expect(storage.getItem(expiredKey)).toBeNull();
  });

  it('should remove malformed entries', () => {
    const malformedKey = `${CACHE_KEY_PREFIX}${CACHE_VERSION}_malformed`;
    storage.setItem(malformedKey, '{not valid json');

    clearOldCache(storage);

    expect(storage.getItem(malformedKey)).toBeNull();
  });
});

describe('isCacheEntry', () => {
  it('should return true for valid cache entry', () => {
    const entry = {
      data: [createTestPR()],
      timestamp: Date.now(),
      rateLimitInfo: null,
      allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 },
      allMergedPRs: [],
    };
    expect(isCacheEntry(entry)).toBe(true);
  });

  it('should return true for valid cache entry without comparison data', () => {
    const entry = {
      data: [createTestPR()],
      timestamp: Date.now(),
      rateLimitInfo: null,
    };
    expect(isCacheEntry(entry)).toBe(true);
  });

  it('should return false for null', () => {
    expect(isCacheEntry(null)).toBe(false);
  });

  it('should return false for non-object', () => {
    expect(isCacheEntry('string')).toBe(false);
    expect(isCacheEntry(42)).toBe(false);
  });

  it('should return false when data is not an array', () => {
    expect(isCacheEntry({ data: 'not-array', timestamp: 1, allPRCounts: {}, allMergedPRs: [] })).toBe(false);
  });

  it('should return false when timestamp is missing', () => {
    expect(isCacheEntry({ data: [], allPRCounts: {}, allMergedPRs: [] })).toBe(false);
  });

  it('should return true when allPRCounts is missing (optional)', () => {
    expect(isCacheEntry({ data: [], timestamp: 1, allMergedPRs: [], rateLimitInfo: null })).toBe(true);
  });

  it('should return false when allPRCounts has missing numeric fields', () => {
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: {}, allMergedPRs: [], rateLimitInfo: null })).toBe(false);
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 1 }, allMergedPRs: [], rateLimitInfo: null })).toBe(false);
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 1, merged: 0, closed: 0 }, allMergedPRs: [], rateLimitInfo: null })).toBe(false);
  });

  it('should return false when allPRCounts has non-numeric fields', () => {
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 'x', merged: 0, closed: 0, open: 0 }, allMergedPRs: [], rateLimitInfo: null })).toBe(false);
  });

  it('should return false when rateLimitInfo is a non-object non-null value', () => {
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }, allMergedPRs: [], rateLimitInfo: 'invalid' })).toBe(false);
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 1, merged: 0, closed: 0, open: 1 }, allMergedPRs: [], rateLimitInfo: 42 })).toBe(false);
  });

  it('should return false when rateLimitInfo is missing required fields', () => {
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 }, allMergedPRs: [], rateLimitInfo: { limit: 60, remaining: 55, reset: 123456 } })).toBe(false);
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 }, allMergedPRs: [], rateLimitInfo: {} })).toBe(false);
  });

  it('should accept valid rateLimitInfo as object or null', () => {
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 }, allMergedPRs: [], rateLimitInfo: null })).toBe(true);
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 }, allMergedPRs: [], rateLimitInfo: { limit: 60, remaining: 55, reset: 123456, used: 5 } })).toBe(true);
  });

  it('should accept missing allMergedPRs (optional) but reject invalid values', () => {
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 }, rateLimitInfo: null })).toBe(true);
    expect(isCacheEntry({ data: [], timestamp: 1, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 }, allMergedPRs: 'invalid', rateLimitInfo: null })).toBe(false);
  });
});

describe('clearOldCache throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T00:00:00Z'));
    resetCacheCleanupTimer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute on first call', () => {
    const storage = createMockStorage({
      'copilot_pr_cache_old_key': JSON.stringify({ data: [], timestamp: 0, rateLimitInfo: null, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 } }),
    });
    clearOldCache(storage);
    expect(storage.getItem('copilot_pr_cache_old_key')).toBeNull();
  });

  it('should skip cleanup when called within throttle interval', () => {
    const storage = createMockStorage();
    clearOldCache(storage);

    storage.setItem('copilot_pr_cache_old_key', JSON.stringify({ data: [], timestamp: 0, rateLimitInfo: null, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 } }));

    vi.advanceTimersByTime(30_000); // 30 seconds, less than 60s throttle
    clearOldCache(storage);
    expect(storage.getItem('copilot_pr_cache_old_key')).not.toBeNull();
  });

  it('should execute again after throttle interval', () => {
    const storage = createMockStorage();
    clearOldCache(storage);

    storage.setItem('copilot_pr_cache_old_key', JSON.stringify({ data: [], timestamp: 0, rateLimitInfo: null, allPRCounts: { total: 0, merged: 0, closed: 0, open: 0 } }));

    vi.advanceTimersByTime(CACHE_CLEANUP_INTERVAL_MS + 1);
    clearOldCache(storage);
    expect(storage.getItem('copilot_pr_cache_old_key')).toBeNull();
  });
});
