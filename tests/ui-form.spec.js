import { test, expect } from '@playwright/test';
import {
  createPR,
  mockSearchAPI,
  submitSearch,
  waitForResults,
  waitForError
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
});
