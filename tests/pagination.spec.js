import { test, expect } from '@playwright/test';
import {
  createPR,
  createPRs,
  mockSearchAPI,
  submitSearch,
  waitForResults,
  getDaysAgoISO
} from './helpers.js';

// ============================================================================
// PR List Pagination Tests
// ============================================================================
// Tests for PR list pagination functionality

test.describe('PR List Pagination', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
  });

  test('should not show pagination for less than 10 PRs', async ({ page }) => {
    const prs = [
      createPR({ id: 1, number: 1, title: 'PR 1', state: 'open', html_url: 'https://github.com/test/repo/pull/1' }),
      createPR({ id: 2, number: 2, title: 'PR 2', state: 'open', html_url: 'https://github.com/test/repo/pull/2' }),
      createPR({ id: 3, number: 3, title: 'PR 3', state: 'closed', merged_at: getDaysAgoISO(1), html_url: 'https://github.com/test/repo/pull/3' })
    ];

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#prPagination')).toBeEmpty();
    await expect(page.locator('#prList')).toContainText('PR 1');
    await expect(page.locator('#prList')).toContainText('PR 2');
    await expect(page.locator('#prList')).toContainText('PR 3');
  });

  test('should show pagination for more than 10 PRs', async ({ page }) => {
    const prs = Array.from({ length: 15 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#prPagination')).not.toBeEmpty();
    await expect(page.locator('#prPagination')).toContainText('1-10 / 15件');
    await expect(page.locator('#prPagination button:has-text("1")')).toBeVisible();
    await expect(page.locator('#prPagination button:has-text("2")')).toBeVisible();
  });

  test('should navigate to next page', async ({ page }) => {
    const prs = Array.from({ length: 15 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `[PR-${String(i + 1).padStart(2, '0')}] Test Feature`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#prList')).toContainText('[PR-01]');
    await expect(page.locator('#prList')).toContainText('[PR-10]');

    await page.locator('#prPagination button').last().click();

    await expect(page.locator('#prList')).toContainText('[PR-11]');
    await expect(page.locator('#prList')).toContainText('[PR-15]');
    await expect(page.locator('#prList')).not.toContainText('[PR-01]');
    await expect(page.locator('#prList')).not.toContainText('[PR-10]');

    await expect(page.locator('#prPagination')).toContainText('11-15 / 15件');
  });

  test('should navigate to previous page', async ({ page }) => {
    const prs = Array.from({ length: 15 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.locator('#prPagination button:has-text("2")').click();
    await expect(page.locator('#prPagination')).toContainText('11-15 / 15件');

    await page.locator('#prPagination button').first().click();

    await expect(page.locator('#prList')).toContainText('PR 1');
    await expect(page.locator('#prPagination')).toContainText('1-10 / 15件');
  });

  test('should navigate using page number buttons', async ({ page }) => {
    const prs = Array.from({ length: 25 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.locator('#prPagination button:has-text("2")').click();
    await expect(page.locator('#prPagination')).toContainText('11-20 / 25件');

    await page.locator('#prPagination button:has-text("3")').click();
    await expect(page.locator('#prPagination')).toContainText('21-25 / 25件');
  });

  test('should disable previous button on first page', async ({ page }) => {
    const prs = Array.from({ length: 15 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    const prevButton = page.locator('#prPagination button').first();
    await expect(prevButton).toBeDisabled();
  });

  test('should disable next button on last page', async ({ page }) => {
    const prs = Array.from({ length: 15 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.locator('#prPagination button:has-text("2")').click();

    const nextButton = page.locator('#prPagination button').last();
    await expect(nextButton).toBeDisabled();
  });

  test('should reset to page 1 on new search', async ({ page }) => {
    const prs = Array.from({ length: 15 }, (_, i) => createPR({
      id: i + 1,
      number: i + 1,
      title: `First Search PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo/pull/${i + 1}`
    }));

    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.locator('#prPagination button:has-text("2")').click();
    await expect(page.locator('#prPagination')).toContainText('11-15 / 15件');

    const newPrs = Array.from({ length: 12 }, (_, i) => createPR({
      id: i + 100,
      number: i + 100,
      title: `Second Search PR ${i + 1}`,
      state: 'open',
      created_at: getDaysAgoISO(i),
      html_url: `https://github.com/test/repo2/pull/${i + 100}`
    }));

    await page.unroute('https://api.github.com/search/issues**');
    await mockSearchAPI(page, { prs: newPrs });
    await submitSearch(page, { repo: 'test/repo2' });
    await waitForResults(page);

    await expect(page.locator('#prPagination')).toContainText('1-10 / 12件');
    await expect(page.locator('#prList')).toContainText('Second Search PR 1');
  });

  test('should NOT show pagination for exactly 10 PRs', async ({ page }) => {
    const prs = createPRs(
      Array.from({ length: 10 }, (_, i) => ({
        title: `PR ${i + 1}`,
        state: 'open',
        created_at: getDaysAgoISO(i + 1),
      }))
    );

    await mockSearchAPI(page, { prs });
    await submitSearch(page, { repo: 'test/repo' });
    await waitForResults(page);

    const pagination = page.locator('#prPagination');
    await expect(pagination).toBeEmpty();
  });

  test('should show pagination for exactly 11 PRs', async ({ page }) => {
    const prs = createPRs(
      Array.from({ length: 11 }, (_, i) => ({
        title: `PR ${i + 1}`,
        state: 'open',
        created_at: getDaysAgoISO(i + 1),
      }))
    );

    await mockSearchAPI(page, { prs });
    await submitSearch(page, { repo: 'test/repo' });
    await waitForResults(page);

    const pagination = page.locator('#prPagination');
    await expect(pagination).not.toBeEmpty();
    await expect(pagination).toContainText('1-10');
    await expect(pagination).toContainText('11件');
  });
});
