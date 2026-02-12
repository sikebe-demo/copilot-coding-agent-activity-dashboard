import { describe, it, expect } from 'vitest';
import { escapeHtml, sanitizeUrl, formatPRNumber } from '../lib';

describe('escapeHtml', () => {
  it('should return empty string for null input', () => {
    expect(escapeHtml(null)).toBe('');
  });

  it('should return empty string for undefined input', () => {
    expect(escapeHtml(undefined)).toBe('');
  });

  it('should escape <script> tags', () => {
    const input = '<script>alert("XSS")</script>';
    const result = escapeHtml(input);
    expect(result).not.toContain('<script>');
    expect(result).not.toContain('</script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('should escape <img> event handler tags', () => {
    const input = '<img src=x onerror=alert(1)>';
    const result = escapeHtml(input);
    expect(result).not.toContain('<img');
    expect(result).toContain('&lt;img');
  });

  it('should escape tags, ampersands, quotes, and apostrophes', () => {
    const result = escapeHtml('<tags> & "quotes" and \'apostrophes\'');
    expect(result).toContain('&lt;tags&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&quot;');
    expect(result).toContain('&#39;');
  });

  it('should handle regular text without modification', () => {
    expect(escapeHtml('Hello World')).toBe('Hello World');
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

});

describe('sanitizeUrl', () => {
  it('should return "#" for null input', () => {
    expect(sanitizeUrl(null)).toBe('#');
  });

  it('should return "#" for undefined input', () => {
    expect(sanitizeUrl(undefined)).toBe('#');
  });

  it('should return "#" for javascript: URLs', () => {
    expect(sanitizeUrl('javascript:alert("XSS")')).toBe('#');
  });

  it('should allow valid https://github.com URLs', () => {
    const url = 'https://github.com/test/repo/pull/42';
    expect(sanitizeUrl(url)).toBe(url);
  });

  it('should reject http:// URLs (non-https)', () => {
    expect(sanitizeUrl('http://github.com/test/repo/pull/1')).toBe('#');
  });

  it('should reject non-github.com domains', () => {
    expect(sanitizeUrl('https://evil.com/test/repo/pull/1')).toBe('#');
  });

  it('should return "#" for invalid URL strings', () => {
    expect(sanitizeUrl('not-a-url')).toBe('#');
  });

  it('should handle empty string', () => {
    expect(sanitizeUrl('')).toBe('#');
  });

  it('should allow github.com URLs with query parameters', () => {
    const url = 'https://github.com/test/repo/pull/42?diff=unified';
    expect(sanitizeUrl(url)).toBe(url);
  });

  it('should allow github.com URLs with fragment', () => {
    const url = 'https://github.com/test/repo/pull/42#issuecomment-123';
    expect(sanitizeUrl(url)).toBe(url);
  });

  it('should allow github.com URLs with both query and fragment', () => {
    const url = 'https://github.com/test/repo/pull/42?diff=unified#discussion_r123';
    expect(sanitizeUrl(url)).toBe(url);
  });
});

describe('formatPRNumber', () => {
  it('should format positive number as #123', () => {
    expect(formatPRNumber(123)).toBe('#123');
  });

  it('should return empty string for 0', () => {
    expect(formatPRNumber(0)).toBe('');
  });

  it('should return empty string for negative numbers', () => {
    expect(formatPRNumber(-1)).toBe('');
  });

  it('should return empty string for non-safe integers', () => {
    expect(formatPRNumber(Infinity)).toBe('');
    expect(formatPRNumber(NaN)).toBe('');
  });
});
