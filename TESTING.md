# Running Tests Locally

## Prerequisites

Before running tests, you need to install Playwright browsers:

```bash
# Install npm dependencies
npm install

# Install Playwright browsers (required for E2E tests)
npx playwright install chromium

# Or install all browsers (optional, takes more time and disk space)
npx playwright install
```

## Running Tests

```bash
# Run all tests (default: chromium only for speed)
npm test

# Run tests in debug mode (opens browser UI)
npm run test:debug

# Run tests in interactive UI mode
npm run test:ui

# Run tests in headed mode (see the browser)
npm run test:headed

# Run specific browser tests
npm run test:chrome
npm run test:firefox
npm run test:webkit
```

## Test Configuration

The test suite is configured to:
- Run only on **Chromium by default** for faster execution (~30 seconds)
- Automatically start the Vite dev server on port 8080
- Use timeouts to prevent hanging:
  - 30 seconds per test
  - 10 seconds for navigation
  - 5 seconds for actions

### Testing on Multiple Browsers

To test on Firefox, WebKit, and mobile viewports, uncomment the additional browser projects in `playwright.config.js`. Note: This will increase test execution time to ~2-3 minutes.

## Troubleshooting

### Tests hang or don't start
1. Check if browsers are installed: `npx playwright --version`
2. Reinstall browsers: `npx playwright install chromium`
3. Kill any existing dev server: `pkill -f vite` or `pkill -f http-server`

### Browser download fails
If you're behind a corporate proxy or firewall, browser downloads may be blocked. In this case:
1. Tests will fail quickly with clear error messages
2. Consider running tests in CI/CD environment instead
3. Or configure proxy settings for npm/playwright

### Port 8080 already in use
Kill the process using port 8080:
```bash
# Find process
lsof -i :8080

# Kill process (replace PID with actual process ID)
kill -9 <PID>
```

## CI/CD Configuration

In GitHub Actions CI:
- All browsers are tested (chromium, firefox, webkit, mobile)
- Tests run with 2 retries per test
- Tests run sequentially (workers: 1) for stability
- Browsers are installed automatically via GitHub Actions

## Performance Tips

1. **Local development**: Use chromium only (default config)
2. **Before committing**: Run `npm test` to verify changes
3. **CI will catch**: Browser-specific issues in other browsers
4. **Use test:ui**: For debugging test failures interactively
