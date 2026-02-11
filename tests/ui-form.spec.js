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

  test('should have all required form fields', async ({ page }) => {
    const repoInput = page.locator('#repoInput');
    await expect(repoInput).toBeVisible();
    await expect(repoInput).toHaveAttribute('placeholder', /microsoft\/vscode|owner\/repo/);

    const fromDate = page.locator('#fromDate');
    const toDate = page.locator('#toDate');
    await expect(fromDate).toBeVisible();
    await expect(toDate).toBeVisible();

    const tokenInput = page.locator('#tokenInput');
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveAttribute('type', 'password');

    const submitButton = page.locator('#searchButton');
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toContainText('Start Analysis');
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

  test('should have accessible labels and ARIA attributes', async ({ page }) => {
    await expect(page.locator('label[for="repoInput"]')).toBeVisible();
    await expect(page.locator('label[for="fromDate"]')).toBeVisible();
    await expect(page.locator('label[for="toDate"]')).toBeVisible();
    await expect(page.locator('label[for="tokenInput"]')).toBeVisible();

    await expect(page.locator('#repoInput')).toHaveAttribute('required', '');
    await expect(page.locator('#fromDate')).toHaveAttribute('required', '');
    await expect(page.locator('#toDate')).toHaveAttribute('required', '');
  });

  test('should prevent form submission when required fields are empty', async ({ page }) => {
    await page.fill('#repoInput', '');
    await page.click('#searchButton');

    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#error')).toBeHidden();
  });

  test('should show footer with correct links', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer).toContainText('Copilot Coding Agent PR Dashboard');
    await expect(footer).toContainText('GitHub API');

    const githubLink = footer.locator('a[href="https://github.com"]');
    await expect(githubLink).toHaveAttribute('target', '_blank');
    await expect(githubLink).toHaveAttribute('rel', /noopener/);
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

  test('should display preset repository buttons', async ({ page }) => {
    const presetButtons = page.locator('.preset-repo-btn');
    await expect(presetButtons).toHaveCount(3);

    await expect(presetButtons.nth(0)).toContainText('microsoft/vscode');
    await expect(presetButtons.nth(1)).toContainText('microsoft/typespec');
    await expect(presetButtons.nth(2)).toContainText('Azure/azure-sdk-for-net');
  });

  test('should display "Popular:" label before preset buttons', async ({ page }) => {
    const label = page.locator('.preset-repo-btn').first().locator('..').locator('span').first();
    await expect(label).toContainText('Popular:');
  });

  test('should fill repo input when preset button is clicked', async ({ page }) => {
    const repoInput = page.locator('#repoInput');

    await page.locator('.preset-repo-btn[data-repo="microsoft/vscode"]').click();
    await expect(repoInput).toHaveValue('microsoft/vscode');

    await page.locator('.preset-repo-btn[data-repo="microsoft/typespec"]').click();
    await expect(repoInput).toHaveValue('microsoft/typespec');

    await page.locator('.preset-repo-btn[data-repo="Azure/azure-sdk-for-net"]').click();
    await expect(repoInput).toHaveValue('Azure/azure-sdk-for-net');
  });

  test('should focus repo input after preset button click', async ({ page }) => {
    await page.locator('.preset-repo-btn[data-repo="microsoft/vscode"]').click();

    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId).toBe('repoInput');
  });

  test('should not submit form when preset button is clicked', async ({ page }) => {
    let apiCalled = false;
    await page.route('https://api.github.com/search/issues**', async route => {
      apiCalled = true;
      await route.abort();
    });

    await page.locator('.preset-repo-btn[data-repo="microsoft/vscode"]').click();

    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('#results')).toBeHidden();
    expect(apiCalled).toBe(false);
  });

  test('should allow submitting search after preset button click', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });

    await page.locator('.preset-repo-btn[data-repo="microsoft/vscode"]').click();
    await page.click('#searchButton');

    await waitForResults(page);
    await expect(page.locator('#totalPRs')).toContainText('1');
  });

  test('should have correct data-repo attributes', async ({ page }) => {
    const buttons = page.locator('.preset-repo-btn');
    await expect(buttons.nth(0)).toHaveAttribute('data-repo', 'microsoft/vscode');
    await expect(buttons.nth(1)).toHaveAttribute('data-repo', 'microsoft/typespec');
    await expect(buttons.nth(2)).toHaveAttribute('data-repo', 'Azure/azure-sdk-for-net');
  });

  test('should have type="button" to prevent form submission', async ({ page }) => {
    const buttons = page.locator('.preset-repo-btn');
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      await expect(buttons.nth(i)).toHaveAttribute('type', 'button');
    }
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
// Form Validation Tests
// ============================================================================

test.describe('Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('should show error for invalid repository format', async ({ page }) => {
    await page.fill('#repoInput', 'invalid-repo');
    await page.click('#searchButton');

    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with empty owner', async ({ page }) => {
    await page.fill('#repoInput', '/repo');
    await page.click('#searchButton');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with empty repo', async ({ page }) => {
    await page.fill('#repoInput', 'owner/');
    await page.click('#searchButton');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with multiple slashes', async ({ page }) => {
    await page.fill('#repoInput', 'owner/repo/extra');
    await page.click('#searchButton');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should handle repository input with leading and trailing whitespace', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });
    await submitSearch(page, { repo: '  test/repo  ' });

    await waitForResults(page);
    await expect(page.locator('#totalPRs')).toContainText('1');
  });

  test('should handle repository input with whitespace before slash', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });
    await submitSearch(page, { repo: 'owner /repo' });

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/Invalid repository name|Repository not found|error/i);
  });

  test('should handle repository input with whitespace after slash', async ({ page }) => {
    await mockSearchAPI(page, { status: 404, body: { message: 'Not Found' } });
    await submitSearch(page, { repo: 'owner/ repo' });

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/Invalid repository name|Repository not found|error/i);
  });

  test('should show error when start date is after end date', async ({ page }) => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    await page.fill('#repoInput', 'test/repo');
    await page.fill('#fromDate', futureDate.toISOString().split('T')[0]);
    await page.fill('#toDate', pastDate.toISOString().split('T')[0]);
    await page.click('#searchButton');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/start date.*before.*end date/i);
  });

  test('should reject repository names with path traversal attempts', async ({ page }) => {
    await page.fill('#repoInput', 'owner/..');
    await page.click('#searchButton');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('Invalid repository name');
  });

  test('should reject repository names with single dot', async ({ page }) => {
    await page.fill('#repoInput', 'owner/.');
    await page.click('#searchButton');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('Invalid repository name');
  });

  test('should handle special characters in repository name', async ({ page }) => {
    await mockSearchAPI(page, { prs: [createPR()] });
    await submitSearch(page, { repo: 'my-org_123/repo.name-test_v2' });
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('1');
  });

  test('should reject repository names with invalid characters', async ({ page }) => {
    await page.fill('#repoInput', 'owner/repo@name');
    await page.click('#searchButton');

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('Invalid repository name');
  });

  test('should validate date range', async ({ page }) => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    await page.fill('#fromDate', futureDate.toISOString().split('T')[0]);
    await page.fill('#toDate', pastDate.toISOString().split('T')[0]);
    await page.fill('#repoInput', 'test/repo');

    const fromValue = await page.locator('#fromDate').inputValue();
    const toValue = await page.locator('#toDate').inputValue();

    expect(fromValue).toBeTruthy();
    expect(toValue).toBeTruthy();
  });

  test('should handle same start and end date', async ({ page }) => {
    const prs = [createPR({ title: 'Same day PR', state: 'open', created_at: '2026-01-15T10:00:00Z' })];
    await mockSearchAPI(page, { prs });

    await submitSearch(page, { fromDate: '2026-01-15', toDate: '2026-01-15' });
    await waitForResults(page);

    await expect(page.locator('#totalPRs')).toContainText('1');
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
    // Freeze the clock to avoid flakiness around midnight
    const fixedTime = new Date('2025-06-15T12:00:00');
    await page.clock.install({ time: fixedTime });
    await page.goto('/');

    const expectedToday = '2025-06-15';
    const toDateValue = await page.inputValue('#toDate');
    expect(toDateValue).toBe(expectedToday);
  });

  test('should set fromDate to 30 days before local today', async ({ page }) => {
    // Freeze the clock to avoid flakiness around midnight
    const fixedTime = new Date('2025-06-15T12:00:00');
    await page.clock.install({ time: fixedTime });
    await page.goto('/');

    const expectedFrom = '2025-05-16';
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
    await page.route('https://api.github.com/search/issues**', async route => {
      callCount++;
      const url = route.request().url();
      if (url.includes('first-owner')) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(createSearchResponse(prsFirst)),
        });
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

    // Wait for the delayed first search response to resolve, then re-assert
    // that stale results did not overwrite the fresh ones
    await page.waitForTimeout(2500);
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

  test('should allow same from and to date (not show error)', async ({ page }) => {
    const prs = createPRs([
      { title: 'Same Day PR', state: 'open', created_at: '2024-06-15T10:00:00Z' },
    ]);

    await mockSearchAPI(page, { prs });
    await submitSearch(page, {
      repo: 'test/repo',
      fromDate: '2024-06-15',
      toDate: '2024-06-15',
    });

    await waitForResults(page);
    await expect(page.locator('#error')).toBeHidden();
  });

  test('should accept repo names with consecutive dots', async ({ page }) => {
    await mockSearchAPI(page, { prs: [] });
    await submitSearch(page, { repo: 'owner/my..repo' });

    await waitForResults(page);
    await expect(page.locator('#error')).toBeHidden();
  });

  test('should accept repo names starting with dot', async ({ page }) => {
    await mockSearchAPI(page, { prs: [] });
    await submitSearch(page, { repo: 'owner/.hidden' });

    await waitForResults(page);
    await expect(page.locator('#error')).toBeHidden();
  });
});
