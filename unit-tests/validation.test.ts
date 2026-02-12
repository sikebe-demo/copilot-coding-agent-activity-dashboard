import { describe, it, expect } from 'vitest';
import { isValidGitHubName, parseRepoInput, validateDateRange } from '../lib';

describe('isValidGitHubName', () => {
  it("should accept valid name like 'my-org_123'", () => {
    expect(isValidGitHubName('my-org_123')).toBe(true);
  });

  it("should accept 'repo.name-test_v2'", () => {
    expect(isValidGitHubName('repo.name-test_v2')).toBe(true);
  });

  it("should accept names starting with dot like '.hidden'", () => {
    expect(isValidGitHubName('.hidden')).toBe(true);
  });

  it("should accept names with consecutive dots like 'my..repo'", () => {
    expect(isValidGitHubName('my..repo')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(isValidGitHubName('')).toBe(false);
  });

  it("should reject '.' (single dot)", () => {
    expect(isValidGitHubName('.')).toBe(false);
  });

  it("should reject '..' (path traversal)", () => {
    expect(isValidGitHubName('..')).toBe(false);
  });

  it("should reject names with '@' character", () => {
    expect(isValidGitHubName('name@org')).toBe(false);
  });

  it("should reject names with spaces like 'owner '", () => {
    expect(isValidGitHubName('owner ')).toBe(false);
  });

  it('should reject names with special characters', () => {
    expect(isValidGitHubName('owner/repo')).toBe(false);
    expect(isValidGitHubName('name!')).toBe(false);
    expect(isValidGitHubName('a b')).toBe(false);
  });
});

describe('parseRepoInput', () => {
  it("should parse valid 'owner/repo' format", () => {
    const result = parseRepoInput('owner/repo');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it("should return error for 'invalid-repo' (no slash)", () => {
    const result = parseRepoInput('invalid-repo');
    expect(typeof result).toBe('string');
  });

  it("should return error for '/repo' (empty owner)", () => {
    const result = parseRepoInput('/repo');
    expect(typeof result).toBe('string');
  });

  it("should return error for 'owner/' (empty repo)", () => {
    const result = parseRepoInput('owner/');
    expect(typeof result).toBe('string');
  });

  it("should return error for 'owner/repo/extra' (too many segments)", () => {
    const result = parseRepoInput('owner/repo/extra');
    expect(typeof result).toBe('string');
  });

  it("should handle leading/trailing whitespace like '  test/repo  '", () => {
    const result = parseRepoInput('  test/repo  ');
    expect(result).toEqual({ owner: 'test', repo: 'repo' });
  });

  it("should return error for 'owner/..' (path traversal)", () => {
    const result = parseRepoInput('owner/..');
    expect(typeof result).toBe('string');
  });

  it("should return error for 'owner/.' (single dot repo)", () => {
    const result = parseRepoInput('owner/.');
    expect(typeof result).toBe('string');
  });

  it("should return error for 'owner/repo@name' (invalid characters)", () => {
    const result = parseRepoInput('owner/repo@name');
    expect(typeof result).toBe('string');
  });

  it("should accept 'my-org_123/repo.name-test_v2'", () => {
    const result = parseRepoInput('my-org_123/repo.name-test_v2');
    expect(result).toEqual({ owner: 'my-org_123', repo: 'repo.name-test_v2' });
  });
});

describe('validateDateRange', () => {
  it('should return null for valid range (fromDate before toDate)', () => {
    expect(validateDateRange('2024-01-01', '2024-01-31')).toBeNull();
  });

  it('should return null for same date (fromDate === toDate)', () => {
    expect(validateDateRange('2024-01-15', '2024-01-15')).toBeNull();
  });

  it('should return error message when fromDate is after toDate', () => {
    const result = validateDateRange('2024-02-01', '2024-01-01');
    expect(result).toBe('Start date must be before end date');
  });

  it('should return error for invalid fromDate string', () => {
    const result = validateDateRange('invalid', '2024-01-31');
    expect(result).toBe('Invalid date format');
  });

  it('should return error for invalid toDate string', () => {
    const result = validateDateRange('2024-01-01', 'not-a-date');
    expect(result).toBe('Invalid date format');
  });

  it('should return error when both dates are invalid', () => {
    const result = validateDateRange('foo', 'bar');
    expect(result).toBe('Invalid date format');
  });
});
