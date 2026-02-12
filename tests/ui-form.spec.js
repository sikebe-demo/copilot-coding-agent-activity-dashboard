import { test, expect } from '@playwright/test';
import {
  createPR,
  createPRs,
  createSearchResponse,
  createRateLimitHeaders,
  mockSearchAPI,
  submitSearch,
  waitForResults,
  waitForError,
  getDaysAgoISO
} from './helpers.js';

// ============================================================================
// UI & Form Tests
// ============================================================================
// Tests for basic UI display, form fields, validation, dark mode, and responsive design

test.describe('UI & Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should display the main page with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Copilot PR.*Dashboard/);
    const heading = page.locator('h1');
    await expect(heading).toContainText('Copilot PR Dashboard');
  });

  test('should set default dates (last 30 days)', async ({ page }) => {
    const fromDate = page.locator('#fromDate');
    const toDate = page.locator('#toDate');

    const fromValue = await fromDate.inputValue();
    const toValue = await toDate.inputValue();

    expect(fromValue).toBeTruthy();
    expect(toValue).toBeTruthy();

    const from = new Date(fromValue);
    const to = new Date(toValue);
    const daysDiff = Math.round((to - from) / (1000 * 60 * 60 * 24));

    expect(daysDiff).toBeGreaterThanOrEqual(29);
    expect(daysDiff).toBeLessThanOrEqual(31);
  });

  test('should prevent form submission when required fields are empty', async ({ page }) => {
    await page.fill('#repoInput', '');
    await page.click('#searchButton');

    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#error')).toBeHidden();
  });

});

// ============================================================================
// Preset Repository Buttons Tests
// ============================================================================

test.describe('Preset Repository Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should allow submitting search after preset button click', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });

    await page.locator('.preset-repo-btn[data-repo="microsoft/vscode"]').click();
    await page.click('#searchButton');

    await waitForResults(page);
    await expect(page.locator('#totalPRs')).toContainText('1');
  });
});

// ============================================================================
// Dark Mode Tests
// ============================================================================

test.describe('Dark Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should toggle dark mode', async ({ page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    await expect(html).not.toHaveClass(/dark/);
    await themeToggle.click();
    await expect(html).toHaveClass(/dark/);
    await themeToggle.click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test('should persist dark mode preference', async ({ page, context }) => {
    const themeToggle = page.locator('#themeToggle');

    await themeToggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    const newPage = await context.newPage();
    await newPage.goto('/');
    await expect(newPage.locator('html')).toHaveClass(/dark/);
  });
});

// ============================================================================
// Responsive Design Tests
// ============================================================================

test.describe('Responsive Design', () => {
  test('should have responsive design for mobile', async ({ page }) => {
    await page.goto('/');
    await page.setViewportSize({ width: 375, height: 667 });

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#searchForm')).toBeVisible();
    await expect(page.locator('#searchButton')).toBeVisible();
  });
});

// ============================================================================
// Loading State Tests
// ============================================================================

test.describe('Loading State', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should show loading state when searching', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' }, delay: 100 });
    await submitSearch(page);

    await expect(page.locator('#loading')).toBeVisible();
  });

  test('should hide error section when starting new search', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });
    await submitSearch(page, { repo: 'error/repo1' });
    await waitForError(page);
    await expect(page.locator('#error')).toBeVisible();

    await mockSearchAPI(page, { prs: [createPR()], delay: 100 });
    await submitSearch(page, { repo: 'success/repo2' });

    await expect(page.locator('#error')).toBeHidden();
  });

  test('should hide results section when starting new search', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });
    await submitSearch(page, { repo: 'test/repo1' });
    await waitForResults(page);
    await expect(page.locator('#results')).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await mockSearchAPI(page, { prs: [createPR()], delay: 200 });
    await submitSearch(page, { repo: 'test/repo2' });

    await expect(page.locator('#results')).toBeHidden();
  });

  test('should set toDate to local today, not UTC today', async ({ page }) => {
    // Freeze the clock to a time near midnight (explicit UTC) to reliably
    // distinguish local today vs UTC today across time zones.
    const fixedTime = new Date('2025-06-15T00:30:00Z');
    await page.clock.install({ time: fixedTime });
    await page.goto('/');

    const expectedToday = await page.evaluate(() => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    });
    const toDateValue = await page.inputValue('#toDate');
    expect(toDateValue).toBe(expectedToday);
  });

  test('should set fromDate to 30 days before local today', async ({ page }) => {
    // Freeze the clock to a time near midnight (explicit UTC) to reliably
    // distinguish local dates vs UTC dates across time zones.
    const fixedTime = new Date('2025-06-15T00:30:00Z');
    await page.clock.install({ time: fixedTime });
    await page.goto('/');

    const expectedFrom = await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    });
    const fromDateValue = await page.inputValue('#fromDate');
    expect(fromDateValue).toBe(expectedFrom);
  });

  test('should handle rapid double-submit without corrupted display', async ({ page }) => {
    const prs = createPRs([
      { title: 'Test PR', state: 'open', created_at: getDaysAgoISO(5) },
    ]);

    await page.route('https://api.github.com/search/issues**', async route => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse(prs)),
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');
    await page.click('#searchButton');

    await page.waitForSelector('#results:not(.hidden)', { timeout: 15000 });
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#results')).toBeVisible();
  });

  test('should not show stale results from first search when second search completes first', async ({ page }) => {
    const prsFirst = createPRs([
      { title: 'Stale PR', state: 'open', created_at: getDaysAgoISO(5) },
    ]);
    const prsSecond = createPRs([
      { title: 'Fresh PR', state: 'open', created_at: getDaysAgoISO(2) },
    ]);

    let callCount = 0;
    const firstOwnerFulfills = [];
    await page.route('https://api.github.com/search/issues**', async route => {
      callCount++;
      const url = route.request().url();
      if (url.includes('first-owner')) {
        const p = (async () => {
          await new Promise(resolve => setTimeout(resolve, 2000));
          await route.fulfill({
            status: 200,
            headers: createRateLimitHeaders(),
            body: JSON.stringify(createSearchResponse(prsFirst)),
          });
        })();
        firstOwnerFulfills.push(p);
        await p;
      } else {
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(createSearchResponse(prsSecond)),
        });
      }
    });

    await page.fill('#repoInput', 'first-owner/repo');
    await page.click('#searchButton');
    await page.fill('#repoInput', 'second-owner/repo');
    await page.click('#searchButton');

    await waitForResults(page);
    const prList = page.locator('#prList');
    await expect(prList).toBeVisible();
    // Ensure only the fresh results from the second search are displayed
    await expect(prList.locator('text=Fresh PR')).toBeVisible();
    await expect(prList.locator('text=Stale PR')).toHaveCount(0);
    // Ensure both searches were actually issued
    expect(callCount).toBeGreaterThanOrEqual(2);

    // Wait for all delayed first-owner requests to fully resolve, then re-assert
    // that stale results did not overwrite the fresh ones
    await Promise.all(firstOwnerFulfills);
    await expect(prList.locator('text=Fresh PR')).toBeVisible();
    await expect(prList.locator('text=Stale PR')).toHaveCount(0);
  });

  test('should update all stats when searching different repos consecutively', async ({ page }) => {
    const prsRepo1 = createPRs([
      { title: 'Repo1 PR', state: 'open', created_at: getDaysAgoISO(5) },
    ]);
    const prsRepo2 = createPRs([
      { title: 'Repo2 PR 1', state: 'closed', merged_at: getDaysAgoISO(3), created_at: getDaysAgoISO(5) },
      { title: 'Repo2 PR 2', state: 'closed', merged_at: getDaysAgoISO(2), created_at: getDaysAgoISO(4) },
      { title: 'Repo2 PR 3', state: 'open', created_at: getDaysAgoISO(1) },
    ]);

    await page.route('https://api.github.com/search/issues**', async route => {
      const url = decodeURIComponent(route.request().url());
      if (url.includes('repo1')) {
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(createSearchResponse(prsRepo1)),
        });
      } else {
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(createSearchResponse(prsRepo2)),
        });
      }
    });

    await submitSearch(page, { repo: 'owner/repo1' });
    await waitForResults(page);
    const totalAfterFirst = await page.locator('#totalPRs').textContent();
    expect(totalAfterFirst).toContain('1');

    await submitSearch(page, { repo: 'owner/repo2' });
    await waitForResults(page);
    const totalAfterSecond = await page.locator('#totalPRs').textContent();
    expect(totalAfterSecond).toContain('3');

    await expect(page.locator('#mergeRateValue')).toHaveText('67%');
  });

});
