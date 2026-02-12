import { test, expect } from '@playwright/test';
import {
  createPRs,
  mockSearchAPI,
  submitSearch,
  waitForResults,
  getDaysAgoISO,
} from './helpers.js';

// ============================================================================
// Filter Feature E2E Tests
// ============================================================================
// Tests for PR filtering UI: status filter buttons, search input, and
// their interaction with pagination and display.

test.describe('PR Filtering', () => {
  /** Helper: create a diverse set of PRs for filter tests */
  function createFilterTestPRs() {
    return createPRs([
      { title: 'Add login feature', state: 'closed', merged_at: getDaysAgoISO(1), created_at: getDaysAgoISO(1) },
      { title: 'Fix parser bug', state: 'closed', merged_at: null, created_at: getDaysAgoISO(2) },
      { title: 'Update README', state: 'open', created_at: getDaysAgoISO(3) },
      { title: 'Add logout feature', state: 'closed', merged_at: getDaysAgoISO(4), created_at: getDaysAgoISO(4) },
      { title: 'Refactor utils', state: 'open', created_at: getDaysAgoISO(5) },
    ]);
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  // --------------------------------------------------------------------------
  // Status Filter Buttons
  // --------------------------------------------------------------------------

  test('should show all PRs by default with "All" filter active', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    // "All" button should have aria-pressed="true"
    await expect(page.locator('#filterAll')).toHaveAttribute('aria-pressed', 'true');
    // All 5 PRs should be visible
    const prItems = page.locator('#prList > div');
    await expect(prItems).toHaveCount(5);
  });

  test('should filter by merged status when Merged button is clicked', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.click('#filterMerged');

    // Merged button should now be active
    await expect(page.locator('#filterMerged')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#filterAll')).toHaveAttribute('aria-pressed', 'false');

    // Only merged PRs (2 items)
    const prItems = page.locator('#prList > div');
    await expect(prItems).toHaveCount(2);
    await expect(page.locator('#prList')).toContainText('Add login feature');
    await expect(page.locator('#prList')).toContainText('Add logout feature');
  });

  test('should filter by closed (not merged) status', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.click('#filterClosed');

    await expect(page.locator('#filterClosed')).toHaveAttribute('aria-pressed', 'true');
    const prItems = page.locator('#prList > div');
    await expect(prItems).toHaveCount(1);
    await expect(page.locator('#prList')).toContainText('Fix parser bug');
  });

  test('should filter by open status', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.click('#filterOpen');

    await expect(page.locator('#filterOpen')).toHaveAttribute('aria-pressed', 'true');
    const prItems = page.locator('#prList > div');
    await expect(prItems).toHaveCount(2);
    await expect(page.locator('#prList')).toContainText('Update README');
    await expect(page.locator('#prList')).toContainText('Refactor utils');
  });

  test('should return to showing all PRs when All button is clicked', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    // Filter to merged first
    await page.click('#filterMerged');
    await expect(page.locator('#prList > div')).toHaveCount(2);

    // Click All to reset
    await page.click('#filterAll');
    await expect(page.locator('#filterAll')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#prList > div')).toHaveCount(5);
  });

  // --------------------------------------------------------------------------
  // Search Input
  // --------------------------------------------------------------------------

  test('should filter PRs by search text', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.fill('#prSearchInput', 'feature');
    // Wait for debounce (300ms) + rendering
    await page.waitForTimeout(500);

    const prItems = page.locator('#prList > div');
    await expect(prItems).toHaveCount(2);
    await expect(page.locator('#prList')).toContainText('Add login feature');
    await expect(page.locator('#prList')).toContainText('Add logout feature');
  });

  test('should show empty state when search matches nothing', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    await page.fill('#prSearchInput', 'nonexistent');
    await page.waitForTimeout(500);

    await expect(page.locator('#prList')).toContainText(/No PRs/i);
  });

  // --------------------------------------------------------------------------
  // Combined Filters
  // --------------------------------------------------------------------------

  test('should combine status filter and search text', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    // Filter to merged + search "login"
    await page.click('#filterMerged');
    await page.fill('#prSearchInput', 'login');
    await page.waitForTimeout(500);

    const prItems = page.locator('#prList > div');
    await expect(prItems).toHaveCount(1);
    await expect(page.locator('#prList')).toContainText('Add login feature');
  });

  // --------------------------------------------------------------------------
  // Pagination Interaction
  // --------------------------------------------------------------------------

  test('should reset to page 1 when filter changes', async ({ page }) => {
    // Create enough PRs to have pagination (>10 items)
    const manyPRs = createPRs(
      Array.from({ length: 15 }, (_, i) => ({
        title: `PR ${i + 1}${i < 5 ? ' feature' : ''}`,
        state: i % 2 === 0 ? 'closed' : 'open',
        merged_at: i % 2 === 0 ? getDaysAgoISO(i + 1) : null,
        created_at: getDaysAgoISO(i + 1),
      }))
    );
    await mockSearchAPI(page, { prs: manyPRs });
    await submitSearch(page);
    await waitForResults(page);

    // Should show pagination for 15 items
    await expect(page.locator('#prPagination')).not.toBeEmpty();

    // Apply a filter — pagination should reset
    await page.click('#filterOpen');
    // Open PRs are fewer than 10, so pagination should be gone or reset
    const prItems = page.locator('#prList > div');
    const count = await prItems.count();
    expect(count).toBeLessThanOrEqual(10);
  });

  // --------------------------------------------------------------------------
  // Accessibility
  // --------------------------------------------------------------------------

  test('should have accessible filter button group', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    // Filter container should have role="group" and aria-label
    const filterGroup = page.locator('[role="group"][aria-label="Filter by status"]');
    await expect(filterGroup).toBeVisible();

    // All filter buttons should have aria-pressed attribute
    const buttons = page.locator('.pr-filter-btn');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      await expect(buttons.nth(i)).toHaveAttribute('aria-pressed', /.*/);
    }
  });

  test('should have accessible search input with aria-label', async ({ page }) => {
    const prs = createFilterTestPRs();
    await mockSearchAPI(page, { prs });
    await submitSearch(page);
    await waitForResults(page);

    const searchInput = page.locator('#prSearchInput');
    await expect(searchInput).toHaveAttribute('aria-label', /search/i);
  });
});
