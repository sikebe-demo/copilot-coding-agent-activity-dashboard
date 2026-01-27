import { test, expect } from '@playwright/test';
import {
  createPR,
  createRateLimitHeaders,
  mockSearchAPI,
  submitSearch,
  waitForPRList
} from './helpers.js';

// ============================================================================
// Security Tests
// ============================================================================
// Tests for XSS prevention, URL sanitization, and HTML escaping

test.describe('XSS Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should escape HTML in PR titles to prevent XSS', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: '<script>alert("XSS")</script>Malicious PR' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const prListHtml = await page.locator('#prList').innerHTML();
    expect(prListHtml).toContain('&lt;script&gt;');
    expect(prListHtml).toContain('&lt;/script&gt;');
    expect(prListHtml).not.toContain('<script>alert');
    await expect(page.locator('#prList')).toContainText('<script>alert("XSS")</script>Malicious PR');
  });

  test('should escape HTML entities in PR titles', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: 'PR with <tags> & "quotes" and \'apostrophes\'' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const prListHtml = await page.locator('#prList').innerHTML();
    expect(prListHtml).toContain('&lt;tags&gt;');
    expect(prListHtml).toContain('&amp;');
    expect(prListHtml).not.toContain('<tags>');
    await expect(page.locator('#prList')).toContainText('PR with <tags> & "quotes" and \'apostrophes\'');
  });

  test('should escape HTML tags with event handlers in PR titles', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: '<img src=x onerror=alert(1)> malicious image' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const prListHtml = await page.locator('#prList').innerHTML();
    expect(prListHtml).toContain('&lt;img');
    expect(prListHtml).toContain('&gt;');
    expect(prListHtml).not.toContain('<img src=x onerror=alert(1)>');
    await expect(page.locator('#prList')).toContainText('<img src=x onerror=alert(1)> malicious image');
  });

  test('should handle null values in escapeHtml', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ title: null })] });

    await submitSearch(page);
    await waitForPRList(page);

    await expect(page.locator('#prList')).toBeVisible();
    const titleText = await page.locator('#prList h3').first().textContent();
    expect(titleText?.trim()).toBe('');
  });
});

// ============================================================================
// URL Sanitization Tests
// ============================================================================

test.describe('URL Sanitization', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should sanitize javascript: URLs in html_url to prevent XSS', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ html_url: 'javascript:alert("XSS")' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe('#');
    expect(href).not.toContain('javascript:');
  });

  test('should allow valid https URLs in html_url', async ({ page }) => {
    const validUrl = 'https://github.com/test/repo/pull/42';
    await mockSearchAPI(page, { prs: [createPR({ number: 42, html_url: validUrl })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe(validUrl);
  });

  test('should reject http:// URLs and sanitize to # in html_url', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ html_url: 'http://github.com/test/repo/pull/1' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe('#');
  });

  test('should reject non-github.com URLs and sanitize to #', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR({ html_url: 'https://evil.com/test/repo/pull/1' })] });

    await submitSearch(page);
    await waitForPRList(page);

    const href = await page.locator('#prList a[target="_blank"]').first().getAttribute('href');
    expect(href).toBe('#');
  });
});
