import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 *
 * Test files are organized by category for better maintainability:
 * - ui-form.spec.js: UI display, form fields, validation, dark mode, responsive design
 * - api-errors.spec.js: API errors, rate limiting, network issues
 * - cache.spec.js: localStorage caching, cache versioning
 * - results-display.spec.js: Statistics, PR list, chart display
 * - security.spec.js: XSS prevention, URL sanitization
 * - pagination.spec.js: PR list pagination
 */
export default defineConfig({
  testDir: './tests',
  /* Ignore helper file */
  testIgnore: ['**/helpers.js'],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Use more workers for faster parallel execution */
  workers: process.env.CI ? 2 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Timeout for each test */
  timeout: 30000, // 30 seconds per test
  /* Global expect timeout */
  expect: {
    timeout: 5000, // 5 seconds for expect assertions
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:8080',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Navigation timeout */
    navigationTimeout: 10000, // 10 seconds for navigation
    /* Action timeout */
    actionTimeout: 5000, // 5 seconds for actions
    /* Reduce screenshot overhead */
    screenshot: 'only-on-failure',
    /* Reduce video overhead */
    video: 'off',
  },

  /* Configure projects for major browsers - default to chromium only for speed */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Firefox runs only in CI for broader browser coverage
    ...(process.env.CI ? [{
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    }] : []),
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    port: 8080,
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes to start server
  },
});
