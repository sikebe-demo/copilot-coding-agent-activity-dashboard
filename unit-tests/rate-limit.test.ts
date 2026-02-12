import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractRateLimitInfo,
  formatCountdown,
  getRateLimitStatus,
} from '../lib';
import type { RateLimitInfo } from '../lib';

function createMockHeaders(headers: Record<string, string>): { get(name: string): string | null } {
  return {
    get(name: string) { return headers[name] ?? null; }
  };
}

describe('extractRateLimitInfo', () => {
  it('should extract valid rate limit info with all headers present', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Reset': '1700000000',
      'X-RateLimit-Used': '5',
    });
    const result = extractRateLimitInfo(headers);
    expect(result).toEqual({
      limit: 60,
      remaining: 55,
      reset: 1700000000,
      used: 5,
    });
  });

  it('should return null when X-RateLimit-Limit is missing', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Reset': '1700000000',
      'X-RateLimit-Used': '5',
    });
    expect(extractRateLimitInfo(headers)).toBeNull();
  });

  it('should return null when X-RateLimit-Remaining is missing', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Reset': '1700000000',
      'X-RateLimit-Used': '5',
    });
    expect(extractRateLimitInfo(headers)).toBeNull();
  });

  it('should return null when X-RateLimit-Reset is missing', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Used': '5',
    });
    expect(extractRateLimitInfo(headers)).toBeNull();
  });

  it('should calculate used from limit - remaining when X-RateLimit-Used is missing', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Reset': '1700000000',
    });
    const result = extractRateLimitInfo(headers);
    expect(result).toEqual({
      limit: 60,
      remaining: 55,
      reset: 1700000000,
      used: 5, // 60 - 55
    });
  });

  it('should return null when X-RateLimit-Limit is invalid (NaN)', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': 'invalid',
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Reset': '1700000000',
      'X-RateLimit-Used': '5',
    });
    expect(extractRateLimitInfo(headers)).toBeNull();
  });

  it('should return null when X-RateLimit-Used is invalid (NaN)', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': '60',
      'X-RateLimit-Remaining': '55',
      'X-RateLimit-Reset': '1700000000',
      'X-RateLimit-Used': 'invalid',
    });
    expect(extractRateLimitInfo(headers)).toBeNull();
  });

  it('should handle limit=10 (unauthenticated) correctly', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': '10',
      'X-RateLimit-Remaining': '9',
      'X-RateLimit-Reset': '1700000000',
      'X-RateLimit-Used': '1',
    });
    const result = extractRateLimitInfo(headers);
    expect(result).toEqual({
      limit: 10,
      remaining: 9,
      reset: 1700000000,
      used: 1,
    });
  });

  it('should handle limit=30 (authenticated) correctly', () => {
    const headers = createMockHeaders({
      'X-RateLimit-Limit': '30',
      'X-RateLimit-Remaining': '25',
      'X-RateLimit-Reset': '1700000000',
      'X-RateLimit-Used': '5',
    });
    const result = extractRateLimitInfo(headers);
    expect(result).toEqual({
      limit: 30,
      remaining: 25,
      reset: 1700000000,
      used: 5,
    });
  });
});

describe('formatCountdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should format future timestamp as 'm:ss'", () => {
    vi.useFakeTimers();
    // Fix time to an exact second boundary to avoid truncation issues
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const nowSec = Date.now() / 1000; // exactly on a second boundary
    const resetTimestamp = nowSec + 59 * 60 + 59;
    const result = formatCountdown(resetTimestamp);
    expect(result).toBe('59:59');
  });

  it("should return '0:00' for past timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const nowSec = Date.now() / 1000;
    const resetTimestamp = nowSec - 60; // 60 seconds in the past
    const result = formatCountdown(resetTimestamp);
    expect(result).toBe('0:00');
  });

  it('should pad seconds with leading zero', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const nowSec = Date.now() / 1000;
    // 1 minute and 5 seconds in the future
    const resetTimestamp = nowSec + 65;
    const result = formatCountdown(resetTimestamp);
    expect(result).toBe('1:05');
  });

  it("should return '0:00' when reset timestamp equals current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const nowSec = Date.now() / 1000;
    const result = formatCountdown(nowSec);
    expect(result).toBe('0:00');
  });
});

describe('getRateLimitStatus', () => {
  it("should return 'Good' when remaining > 50% of limit", () => {
    const result = getRateLimitStatus(60, 100);
    expect(result.statusText).toBe('Good');
  });

  it("should return 'Warning' when remaining is between 20-50% of limit", () => {
    const result = getRateLimitStatus(30, 100);
    expect(result.statusText).toBe('Warning');
  });

  it("should return 'Low' when remaining <= 20% of limit", () => {
    const result = getRateLimitStatus(20, 100);
    expect(result.statusText).toBe('Low');
  });

  it('should return isAuthenticated=true when limit > 10', () => {
    const result = getRateLimitStatus(25, 30);
    expect(result.isAuthenticated).toBe(true);
  });

  it('should return isAuthenticated=false when limit <= 10', () => {
    const result = getRateLimitStatus(9, 10);
    expect(result.isAuthenticated).toBe(false);
  });

  it('should return correct status for unauthenticated limit=10, remaining=9 (Good)', () => {
    const result = getRateLimitStatus(9, 10);
    expect(result.statusText).toBe('Good');
    expect(result.isAuthenticated).toBe(false);
  });

  it('should return correct status for unauthenticated limit=10, remaining=1 (Low)', () => {
    const result = getRateLimitStatus(1, 10);
    expect(result.statusText).toBe('Low');
    expect(result.isAuthenticated).toBe(false);
  });

  it('should return correct status for authenticated limit=30, remaining=25 (Good)', () => {
    const result = getRateLimitStatus(25, 30);
    expect(result.statusText).toBe('Good');
    expect(result.isAuthenticated).toBe(true);
  });

  it('should return correct status for authenticated limit=5000, remaining=1500 (Warning)', () => {
    const result = getRateLimitStatus(1500, 5000);
    expect(result.statusText).toBe('Warning');
    expect(result.isAuthenticated).toBe(true);
  });

  it('should return correct status for authenticated limit=5000, remaining=500 (Low)', () => {
    const result = getRateLimitStatus(500, 5000);
    expect(result.statusText).toBe('Low');
    expect(result.isAuthenticated).toBe(true);
  });
});
