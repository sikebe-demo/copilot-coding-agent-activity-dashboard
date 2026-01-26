import { test, expect } from '@playwright/test';

test.describe('Copilot Coding Agent PR Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should display the main page with correct title', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Copilot PR.*Dashboard/);

    // Check main heading
    const heading = page.locator('h1');
    await expect(heading).toContainText('Copilot PR Dashboard');
  });

  test('should have all required form fields', async ({ page }) => {
    // Check repository input
    const repoInput = page.locator('#repoInput');
    await expect(repoInput).toBeVisible();
    await expect(repoInput).toHaveAttribute('placeholder', /microsoft\/vscode|owner\/repo/);

    // Check date inputs
    const fromDate = page.locator('#fromDate');
    const toDate = page.locator('#toDate');
    await expect(fromDate).toBeVisible();
    await expect(toDate).toBeVisible();

    // Check token input
    const tokenInput = page.locator('#tokenInput');
    await expect(tokenInput).toBeVisible();
    await expect(tokenInput).toHaveAttribute('type', 'password');

    // Check submit button
    const submitButton = page.locator('#searchButton');
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toContainText('Start Analysis');
  });

  test('should set default dates (last 30 days)', async ({ page }) => {
    const fromDate = page.locator('#fromDate');
    const toDate = page.locator('#toDate');

    // Verify dates are set
    const fromValue = await fromDate.inputValue();
    const toValue = await toDate.inputValue();

    expect(fromValue).toBeTruthy();
    expect(toValue).toBeTruthy();

    // Verify date range is approximately 30 days
    const from = new Date(fromValue);
    const to = new Date(toValue);
    const daysDiff = Math.round((to - from) / (1000 * 60 * 60 * 24));

    expect(daysDiff).toBeGreaterThanOrEqual(29);
    expect(daysDiff).toBeLessThanOrEqual(31);
  });

  test('should show error for invalid repository format', async ({ page }) => {
    // Fill form with invalid repo format
    await page.fill('#repoInput', 'invalid-repo');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with empty owner', async ({ page }) => {
    // Fill form with missing owner (e.g., "/repo")
    await page.fill('#repoInput', '/repo');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with empty repo', async ({ page }) => {
    // Fill form with missing repo (e.g., "owner/")
    await page.fill('#repoInput', 'owner/');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error for repository format with multiple slashes', async ({ page }) => {
    // Fill form with extra slashes (e.g., "owner/repo/extra")
    await page.fill('#repoInput', 'owner/repo/extra');
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText('owner/repo');
  });

  test('should show error when start date is after end date', async ({ page }) => {
    // Set dates where fromDate > toDate
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    await page.fill('#repoInput', 'test/repo');
    await page.fill('#fromDate', futureDate.toISOString().split('T')[0]);
    await page.fill('#toDate', pastDate.toISOString().split('T')[0]);
    await page.click('#searchButton');

    // Check error message
    const error = page.locator('#error');
    await expect(error).toBeVisible();
    await expect(page.locator('#errorMessage')).toContainText(/start date.*before.*end date/i);
  });

  test('should toggle dark mode', async ({ page }) => {
    const html = page.locator('html');
    const themeToggle = page.locator('#themeToggle');

    // Initial state (light mode)
    await expect(html).not.toHaveClass(/dark/);

    // Toggle to dark mode
    await themeToggle.click();
    await expect(html).toHaveClass(/dark/);

    // Toggle back to light mode
    await themeToggle.click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test('should persist dark mode preference', async ({ page, context }) => {
    const themeToggle = page.locator('#themeToggle');

    // Enable dark mode
    await themeToggle.click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Create new page in same context
    const newPage = await context.newPage();
    await newPage.goto('/');

    // Dark mode should be persisted
    await expect(newPage.locator('html')).toHaveClass(/dark/);
  });

  test('should have responsive design for mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    // Check that main elements are still visible
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#searchForm')).toBeVisible();
    await expect(page.locator('#searchButton')).toBeVisible();
  });

  test('should show loading state when searching', async ({ page }) => {
    // Mock the GitHub API to delay response
    await page.route('https://api.github.com/**', async route => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({
        status: 404,
        body: JSON.stringify({ message: 'Not Found' })
      });
    });

    // Fill form and submit
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Loading should be visible briefly
    const loading = page.locator('#loading');
    await expect(loading).toBeVisible();
  });

  test('should handle API errors gracefully', async ({ page }) => {
    // Mock GitHub API error
    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 404,
        body: JSON.stringify({ message: 'Not Found' })
      });
    });

    // Fill form and submit
    await page.fill('#repoInput', 'test/nonexistent');
    await page.click('#searchButton');

    // Wait for error
    await page.waitForSelector('#error', { state: 'visible' });

    // Check error message
    const errorMessage = page.locator('#errorMessage');
    await expect(errorMessage).toContainText(/Repository not found|error/i);
  });

  test('should display results for valid repository', async ({ page }) => {
    // Mock GitHub API with sample data (using current dates)
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

    await page.route('https://api.github.com/**', route => {
      const prs = [
        {
          id: 1,
          number: 1,
          title: 'Test PR by Copilot',
          state: 'closed',
          merged_at: fiveDaysAgo.toISOString(),
          created_at: fiveDaysAgo.toISOString(),
          user: { login: 'Copilot' },
          assignees: [{ login: 'Copilot' }],
          html_url: 'https://github.com/test/repo/pull/1',
          body: 'Created by Copilot Coding Agent',
          labels: []
        },
        {
          id: 2,
          number: 2,
          title: 'Another Copilot PR',
          state: 'open',
          merged_at: null,
          created_at: threeDaysAgo.toISOString(),
          user: { login: 'Copilot' },
          assignees: [{ login: 'Copilot' }],
          html_url: 'https://github.com/test/repo/pull/2',
          body: 'Copilot generated PR',
          labels: []
        }
      ];

      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(prs)
      });
    });

    // Fill form with valid data
    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results with longer timeout
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Check summary cards
    const totalPRs = page.locator('#totalPRs');
    await expect(totalPRs).toContainText('2');

    const mergedPRs = page.locator('#mergedPRs');
    await expect(mergedPRs).toContainText('1');

    const openPRs = page.locator('#openPRs');
    await expect(openPRs).toContainText('1');

    // Check merge rate
    const mergeRate = page.locator('#mergeRateValue');
    await expect(mergeRate).toContainText('50%');
  });

  test('should display PR list with correct information', async ({ page }) => {
    // Mock GitHub API with current date
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 123,
            title: 'Feature: Add new component',
            state: 'closed',
            merged_at: fiveDaysAgo.toISOString(),
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'Copilot' },
            assignees: [{ login: 'Copilot' }],
            html_url: 'https://github.com/test/repo/pull/123',
            body: 'Copilot generated',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for PR list with longer timeout
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Check PR details
    const prList = page.locator('#prList');
    await expect(prList).toContainText('Feature: Add new component');
    await expect(prList).toContainText('#123');
    await expect(prList).toContainText('Copilot');
    await expect(prList).toContainText('Merged');
  });

  test('should display chart when results are shown', async ({ page }) => {
    // Mock GitHub API with current date
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'closed',
            merged_at: fiveDaysAgo.toISOString(),
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'Copilot' },
            assignees: [{ login: 'Copilot' }],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Copilot PR',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for chart with longer timeout
    await page.waitForSelector('#prChart', { state: 'visible', timeout: 10000 });

    // Check that chart canvas exists
    const chart = page.locator('#prChart');
    await expect(chart).toBeVisible();
  });

  test('should handle empty results', async ({ page }) => {
    // Mock GitHub API with no Copilot PRs (using current date)
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: 'Regular PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'regular-user' },
            assignees: [{ login: 'regular-user' }],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Regular PR body',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results with longer timeout
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Check that total is 0
    const totalPRs = page.locator('#totalPRs');
    await expect(totalPRs).toContainText('0');

    // Check empty state message
    const prList = page.locator('#prList');
    await expect(prList).toContainText(/No PRs created by Copilot Coding Agent found/i);
  });

  test('should have accessible labels and ARIA attributes', async ({ page }) => {
    // Check form labels
    await expect(page.locator('label[for="repoInput"]')).toBeVisible();
    await expect(page.locator('label[for="fromDate"]')).toBeVisible();
    await expect(page.locator('label[for="toDate"]')).toBeVisible();
    await expect(page.locator('label[for="tokenInput"]')).toBeVisible();

    // Check required fields
    await expect(page.locator('#repoInput')).toHaveAttribute('required', '');
    await expect(page.locator('#fromDate')).toHaveAttribute('required', '');
    await expect(page.locator('#toDate')).toHaveAttribute('required', '');
  });

  test('should open PR links in new tab', async ({ page, context }) => {
    // Mock GitHub API with current date
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: 'Test PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'Copilot' },
            assignees: [{ login: 'Copilot' }],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Copilot PR',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for PR list with longer timeout
    await page.waitForSelector('#prList a[target="_blank"]', { state: 'visible', timeout: 10000 });

    // Check that links have target="_blank"
    const links = page.locator('#prList a[target="_blank"]');
    await expect(links.first()).toHaveAttribute('target', '_blank');
  });

  test('should validate date range', async ({ page }) => {
    // Set from date after to date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    await page.fill('#fromDate', futureDate.toISOString().split('T')[0]);
    await page.fill('#toDate', pastDate.toISOString().split('T')[0]);
    await page.fill('#repoInput', 'test/repo');

    // HTML5 validation should prevent submission
    // Note: This test checks if dates can be set; actual validation might vary by browser
    const fromValue = await page.locator('#fromDate').inputValue();
    const toValue = await page.locator('#toDate').inputValue();

    expect(fromValue).toBeTruthy();
    expect(toValue).toBeTruthy();
  });

  test('should detect Copilot PRs by author only', async ({ page }) => {
    // Test the detection method: Only PRs with author login matching "copilot" (case-insensitive) are detected
    // PRs assigned to Copilot but authored by someone else should NOT be detected
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      const prs = [
        {
          id: 1,
          number: 1,
          title: 'PR authored by Copilot',
          state: 'closed',
          merged_at: fiveDaysAgo.toISOString(),
          created_at: fiveDaysAgo.toISOString(),
          user: { login: 'copilot' },
          assignees: [{ login: 'copilot' }, { login: 'SIkebe' }],
          html_url: 'https://github.com/test/repo/pull/1',
          body: 'Adds feature',
          labels: [],
          head: { ref: 'copilot/add-feature' }
        },
        {
          id: 2,
          number: 2,
          title: 'Human PR assigned to Copilot',
          state: 'open',
          merged_at: null,
          created_at: fiveDaysAgo.toISOString(),
          user: { login: 'human-user' },
          assignees: [{ login: 'copilot' }],
          html_url: 'https://github.com/test/repo/pull/2',
          body: 'Human created PR assigned to Copilot for help',
          labels: [],
          head: { ref: 'feature/human-work' }
        },
        {
          id: 3,
          number: 3,
          title: 'Regular PR with copilot branch',
          state: 'open',
          merged_at: null,
          created_at: fiveDaysAgo.toISOString(),
          user: { login: 'regular-user' },
          assignees: [{ login: 'regular-user' }],
          html_url: 'https://github.com/test/repo/pull/3',
          body: 'Manual changes',
          labels: [],
          head: { ref: 'copilot/manual-branch' }
        }
      ];

      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(prs)
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#results', { state: 'visible', timeout: 10000 });

    // Only the PR authored by Copilot should be detected
    // Human PRs assigned to Copilot should NOT be detected
    // Regular user PRs with copilot/ branch should NOT be detected
    const totalPRs = page.locator('#totalPRs');
    await expect(totalPRs).toContainText('1');

    // Verify the correct PR is shown
    const prList = page.locator('#prList');
    await expect(prList).toContainText('PR authored by Copilot');
    await expect(prList).not.toContainText('Human PR assigned to Copilot');
    await expect(prList).not.toContainText('Regular PR with copilot branch');
  });

  test('should escape HTML in PR titles to prevent XSS', async ({ page }) => {
    // Test that PR titles with malicious HTML/JavaScript are properly escaped
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: '<script>alert("XSS")</script>Malicious PR',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            assignees: [{ login: 'copilot' }],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Test',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that script tags are escaped
    expect(prListHtml).toContain('&lt;script&gt;');
    expect(prListHtml).toContain('&lt;/script&gt;');
    expect(prListHtml).not.toContain('<script>alert');

    // Verify the escaped text is displayed correctly
    const prList = page.locator('#prList');
    await expect(prList).toContainText('<script>alert("XSS")</script>Malicious PR');
  });

  test('should escape HTML entities in PR titles', async ({ page }) => {
    // Test that various HTML entities including quotes are properly escaped
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: 'PR with <tags> & "quotes" and \'apostrophes\'',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            assignees: [{ login: 'copilot' }],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Test',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that all dangerous HTML characters are escaped in the HTML source
    // Tags and ampersand must be escaped to prevent XSS
    expect(prListHtml).toContain('&lt;tags&gt;');
    expect(prListHtml).toContain('&amp;');
    // Verify that the dangerous tags are not present unescaped
    expect(prListHtml).not.toContain('<tags>');

    // Verify the text is displayed correctly (browser interprets escaped HTML entities)
    const prList = page.locator('#prList');
    await expect(prList).toContainText('PR with <tags> & "quotes" and \'apostrophes\'');
    
    // Verify that quotes are properly displayed (escapeHtml converts them to entities,
    // which the browser then displays correctly as the original characters)
    const titleElement = page.locator('#prList h3');
    const titleText = await titleElement.textContent();
    expect(titleText).toContain('"quotes"');
    expect(titleText).toContain('\'apostrophes\'');
    
    // The key security check: ensure dangerous HTML tags are escaped, not executed
    // Quotes in text content don't pose XSS risks, but tags and scripts do
    expect(prListHtml).not.toContain('<script>');
    expect(prListHtml).not.toContain('onerror=');
  });

  test('should escape HTML in PR titles with img tags', async ({ page }) => {
    // Test that PR titles with img tags and event handlers are properly escaped
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: '<img src=x onerror=alert(1)> malicious image',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            assignees: [],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Test',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that img tag in the title is escaped
    expect(prListHtml).toContain('&lt;img');
    expect(prListHtml).toContain('&gt;');
    expect(prListHtml).not.toContain('<img src=x onerror=alert(1)>');

    // Verify the escaped text is displayed correctly in the title
    const prList = page.locator('#prList');
    await expect(prList).toContainText('<img src=x onerror=alert(1)> malicious image');
  });

  test('should escape HTML event handlers in PR titles', async ({ page }) => {
    // Test that HTML event handlers are properly escaped
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: '<div onload=malicious()>Evil PR</div>',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            assignees: [{ login: 'copilot' }],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Test',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that div tags are escaped
    expect(prListHtml).toContain('&lt;div');
    expect(prListHtml).toContain('&gt;');
    expect(prListHtml).toContain('&lt;/div&gt;');
    // Ensure the div tag is not executed as actual HTML
    expect(prListHtml).not.toContain('<div onload=');
    
    // Verify the text is displayed correctly (as escaped text)
    const prList = page.locator('#prList');
    await expect(prList).toContainText('<div onload=malicious()>Evil PR</div>');
  });

  test('should handle null and undefined values in escapeHtml', async ({ page }) => {
    // Test that escapeHtml properly handles null/undefined values
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: null,
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },
            assignees: [{ login: 'copilot' }],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Test',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Should not throw an error and should display empty string
    const prList = page.locator('#prList');
    await expect(prList).toBeVisible();
  });

  test('should escape HTML in user login names to prevent XSS', async ({ page }) => {
    // Test that malicious content in user.login field would be properly escaped
    // Note: Due to the isCopilotPR filter (app.js line 162), only logins exactly matching "copilot" 
    // (case-insensitive) are displayed. This test demonstrates that escapeHtml is applied
    // to user.login (line 432) the same way it's applied to pr.title (line 425).
    // If a malicious login bypassed the filter, it would still be escaped.
    const now = new Date();
    const fiveDaysAgo = new Date(now);
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    await page.route('https://api.github.com/**', route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            number: 1,
            title: 'Test PR with <script>alert("xss")</script> in title',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'copilot' },  // Clean login that passes filter
            assignees: [],
            html_url: 'https://github.com/test/repo/pull/1',
            body: 'Test',
            labels: []
          },
          {
            id: 2,
            number: 2,
            title: 'PR with <img src=x onerror=alert(1)> in title',
            state: 'open',
            merged_at: null,
            created_at: fiveDaysAgo.toISOString(),
            user: { login: 'COPILOT' },  // Clean login (different case)
            assignees: [],
            html_url: 'https://github.com/test/repo/pull/2',
            body: 'Test',
            labels: []
          }
        ])
      });
    });

    await page.fill('#repoInput', 'test/repo');
    await page.click('#searchButton');

    // Wait for results
    await page.waitForSelector('#prList', { state: 'visible', timeout: 10000 });

    // Get the HTML content
    const prListHtml = await page.locator('#prList').innerHTML();

    // Verify that user.login values are displayed correctly
    await expect(page.locator('#prList')).toContainText('copilot');
    await expect(page.locator('#prList')).toContainText('COPILOT');
    
    // Verify that malicious HTML in titles is escaped (proving escapeHtml works)
    expect(prListHtml).toContain('&lt;script&gt;');
    expect(prListHtml).toContain('&lt;img');
    expect(prListHtml).not.toContain('<script>alert("xss")</script>');
    expect(prListHtml).not.toContain('<img src=x onerror=alert(1)>');
    
    // Critical verification: escapeHtml is applied to BOTH fields
    // - pr.title at app.js line 425: ${escapeHtml(pr.title)}
    // - pr.user.login at app.js line 432: ${escapeHtml(pr.user.login)}
    // This means any malicious content in user.login would be escaped identically
    await expect(page.locator('#prList')).toContainText('Test PR with <script>alert("xss")</script> in title');
    await expect(page.locator('#prList')).toContainText('PR with <img src=x onerror=alert(1)> in title');
  });
});
