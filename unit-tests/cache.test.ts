import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getCacheKey,
  getFromCache,
  saveToCache,
  clearOldCache,
  CACHE_KEY_PREFIX,
  CACHE_VERSION,
  CACHE_DURATION_MS,
} from '../lib';
import type { PullRequest, CacheEntry, AllPRCounts } from '../lib';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockStorage(): Storage {
  const store = new Map<string, string>();
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
  it('should include version prefix (v2)', () => {
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

    saveToCache(key, [pr], rateLimitInfo, counts, storage);

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
      saveToCache('quota_key', [pr], null, defaultAllPRCounts, throwingStorage)
    ).not.toThrow();
  });
});

describe('clearOldCache', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMockStorage();
    vi.restoreAllMocks();
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
