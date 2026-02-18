import { test, expect } from '@playwright/test';
import {
  createPRs,
  createPR,
  mockSearchAPI,
  mockGraphQLAPI,
  createSearchResponse,
  createRateLimitHeaders,
  submitSearch,
  waitForResults,
  DEFAULT_TIMEOUT,
} from './helpers.js';

test.describe('Response Time Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('マージ済み PR がある場合、レスポンスタイムセクションが表示される', async ({ page }) => {
    const prs = createPRs([
      { title: 'Fast PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
      { title: 'Medium PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T12:00:00Z' },
      { title: 'Slow PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-16T00:00:00Z' },
      { title: 'Open PR', state: 'open' },
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#responseTimeSection')).toBeVisible();
  });

  test('4つの統計カードに正しい値が表示される', async ({ page }) => {
    const prs = createPRs([
      { title: 'Fast PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
      { title: 'Medium PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T12:00:00Z' },
      { title: 'Slow PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-16T00:00:00Z' },
      { title: 'Open PR', state: 'open' },
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    const stats = page.locator('#responseTimeStats');
    await expect(stats).toBeVisible();

    await expect(stats).toContainText('12.7 hours');
    await expect(stats).toContainText('12.0 hours');
    await expect(stats).toContainText('2.0 hours');
    await expect(stats).toContainText('1.0 days');

    await expect(stats).toContainText('Average Response Time');
    await expect(stats).toContainText('Median Response Time');
    await expect(stats).toContainText('Fastest PR');
    await expect(stats).toContainText('Slowest PR');
  });

  test('副題テキストが Copilot 形式で表示される', async ({ page }) => {
    const prs = createPRs([
      { title: 'PR1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
      { title: 'PR2', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T12:00:00Z' },
      { title: 'PR3', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-16T00:00:00Z' },
      { title: 'Open', state: 'open' },
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    // Initial display shows copilot-only subtitle (comparison data not loaded yet)
    await expect(page.locator('#responseTimeSubtitle')).toContainText('Copilot');
    await expect(page.locator('#responseTimeSubtitle')).toContainText('merged PR');
  });

  test('ヒストグラムの canvas が描画される', async ({ page }) => {
    const prs = createPRs([
      { title: 'PR1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    await page.waitForSelector('#responseTimeChart canvas', { state: 'visible', timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#responseTimeChart canvas')).toBeVisible();
  });

  test('マージ済み PR がない場合、空状態メッセージが表示される', async ({ page }) => {
    const prs = createPRs([
      { title: 'Open PR 1', state: 'open' },
      { title: 'Open PR 2', state: 'open' },
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#responseTimeEmpty')).toContainText('No merged PRs found for response time analysis');
    await expect(page.locator('#responseTimeStats')).toBeHidden();
    await expect(page.locator('#responseTimeChart')).toBeHidden();
  });

  test('ダークモードでヒストグラムが正しく表示される', async ({ page }) => {
    const prs = createPRs([
      { title: 'PR1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' },
    ]);
    await mockSearchAPI(page, { prs });

    await submitSearch(page);
    await waitForResults(page);
    await page.waitForSelector('#responseTimeChart canvas', { state: 'visible', timeout: DEFAULT_TIMEOUT });

    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await expect(page.locator('#responseTimeChart canvas')).toBeVisible();

    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.locator('#responseTimeChart canvas')).toBeVisible();
  });

  test('連続検索: マージあり → なし', async ({ page }) => {
    const prsWithMerged = createPRs([
      { title: 'Merged PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' },
    ]);
    await mockSearchAPI(page, { prs: prsWithMerged });

    await submitSearch(page);
    await waitForResults(page);
    await expect(page.locator('#responseTimeStats')).toBeVisible();
    await page.waitForSelector('#responseTimeChart canvas', { state: 'visible', timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#responseTimeSubtitle')).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await page.unroute('https://api.github.com/search/issues**');
    const prsAllOpen = createPRs([
      { title: 'Open PR', state: 'open' },
    ]);
    await mockSearchAPI(page, { prs: prsAllOpen });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#responseTimeEmpty')).toBeVisible();
    await expect(page.locator('#responseTimeStats')).toBeHidden();
    await expect(page.locator('#responseTimeChart')).toBeHidden();
    await expect(page.locator('#responseTimeSubtitle')).toBeHidden();
  });

  test('連続検索: マージなし → あり', async ({ page }) => {
    const prsAllOpen = createPRs([
      { title: 'Open PR', state: 'open' },
    ]);
    await mockSearchAPI(page, { prs: prsAllOpen });

    await submitSearch(page);
    await waitForResults(page);
    await expect(page.locator('#responseTimeEmpty')).toBeVisible();

    await page.evaluate(() => localStorage.clear());
    await page.unroute('https://api.github.com/search/issues**');
    const prsWithMerged = createPRs([
      { title: 'Merged PR', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' },
      { title: 'Another', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T12:00:00Z' },
    ]);
    await mockSearchAPI(page, { prs: prsWithMerged });

    await submitSearch(page);
    await waitForResults(page);

    await expect(page.locator('#responseTimeStats')).toBeVisible();
    await expect(page.locator('#responseTimeChart')).toBeVisible();
    await expect(page.locator('#responseTimeEmpty')).toBeHidden();
    await expect(page.locator('#responseTimeSubtitle')).toContainText('Copilot');
  });

  test('Copilot vs Others 比較: 比較ボタンクリック後に比較表示', async ({ page }) => {
    // Copilot PRs: fast (2h, 6h)
    const copilotPRs = createPRs([
      { title: 'Copilot Fast', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
      { title: 'Copilot Medium', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' },
    ]);
    // All merged PRs: includes Copilot PRs + others (slower)
    const allMerged = [
      createPR({ id: 1, number: 1, title: 'Copilot Fast', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' }),
      createPR({ id: 2, number: 2, title: 'Copilot Medium', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' }),
      createPR({ id: 100, number: 100, title: 'Human Fix', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-16T00:00:00Z' }),
      createPR({ id: 101, number: 101, title: 'Human Feature', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-18T00:00:00Z' }),
    ];
    const allPRCounts = { total: 6, merged: 4, open: 2 };
    await mockSearchAPI(page, { prs: copilotPRs, allMergedPRs: allMerged, allPRCounts });

    await submitSearch(page);
    await waitForResults(page);

    // Comparison data is loaded inline — comparison shown immediately
    await expect(page.locator('#responseTimeSubtitle')).toContainText('2 Copilot');

    const stats = page.locator('#responseTimeStats');
    await expect(stats).toBeVisible();

    // Should show comparison labels
    await expect(stats).toContainText('Copilot');
    await expect(stats).toContainText('Others');

    // Subtitle should mention both groups
    await expect(page.locator('#responseTimeSubtitle')).toContainText('2 Copilot');
    await expect(page.locator('#responseTimeSubtitle')).toContainText('2 other');

    // Chart should be visible
    await page.waitForSelector('#responseTimeChart canvas', { state: 'visible', timeout: DEFAULT_TIMEOUT });
    await expect(page.locator('#responseTimeChart canvas')).toBeVisible();
  });

  test('REST: 100件超の allMergedPRs をページネーションで全件取得', async ({ page }) => {
    const copilotPRs = createPRs([
      { title: 'Copilot PR 1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
      { title: 'Copilot PR 2', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T04:00:00Z' },
    ]);
    // Generate 120 "other" merged PRs — requires 2 pages (100 + 20)
    const otherMergedPRs = Array.from({ length: 120 }, (_, i) => createPR({
      id: 1000 + i,
      number: 1000 + i,
      title: `Other Merged PR ${i + 1}`,
      state: 'closed',
      created_at: '2024-01-15T00:00:00Z',
      merged_at: '2024-01-16T00:00:00Z',
      user: { login: 'human-dev' },
      html_url: `https://github.com/test/repo/pull/${1000 + i}`,
    }));
    const allMerged = [...copilotPRs, ...otherMergedPRs];
    const allPRCounts = { total: 200, merged: 122, open: 78 };

    await mockSearchAPI(page, { prs: copilotPRs, allMergedPRs: allMerged, allPRCounts });

    await submitSearch(page);
    await waitForResults(page);

    // All 120 other PRs should be counted using allPRCounts.merged - copilotMerged
    await expect(page.locator('#responseTimeSubtitle')).toContainText('2 Copilot');
    await expect(page.locator('#responseTimeSubtitle')).toContainText('120 other');

    // Warning should NOT appear since all data was fetched
    await expect(page.locator('#responseTimeWarning')).toBeHidden();
  });

  test('GraphQL: 100件超の allMergedPRs をページネーションで全件取得', async ({ page }) => {
    const copilotPRs = createPRs([
      { title: 'Copilot PR 1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
      { title: 'Copilot PR 2', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T04:00:00Z' },
    ]);
    // Generate 120 "other" merged PRs — requires 2 pages (100 + 20)
    const otherMergedPRs = Array.from({ length: 120 }, (_, i) => createPR({
      id: 1000 + i,
      number: 1000 + i,
      title: `Other Merged PR ${i + 1}`,
      state: 'closed',
      created_at: '2024-01-15T00:00:00Z',
      merged_at: '2024-01-16T00:00:00Z',
      user: { login: 'human-dev' },
      html_url: `https://github.com/test/repo/pull/${1000 + i}`,
    }));
    const allMerged = [...copilotPRs, ...otherMergedPRs];
    const allPRCounts = { total: 200, merged: 122, open: 78 };

    await mockGraphQLAPI(page, { prs: copilotPRs, allMergedPRs: allMerged, allPRCounts });

    await submitSearch(page, { token: 'ghp_test123456789' });
    await waitForResults(page);

    // All 120 other PRs should be counted using allPRCounts.merged - copilotMerged
    await expect(page.locator('#responseTimeSubtitle')).toContainText('2 Copilot');
    await expect(page.locator('#responseTimeSubtitle')).toContainText('120 other');

    // Warning should NOT appear since all data was fetched
    await expect(page.locator('#responseTimeWarning')).toBeHidden();
  });

  test('GraphQL: 部分データ取得時（レートリミット等）に適切な警告を表示', async ({ page }) => {
    const copilotPRs = createPRs([
      { title: 'Copilot PR 1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
    ]);
    // Simulate: only 100 of 1500 merged PRs fetched (partial data, e.g. rate limit)
    const fetchedMergedPRs = Array.from({ length: 100 }, (_, i) => createPR({
      id: 1000 + i,
      number: 1000 + i,
      title: `Merged PR ${i + 1}`,
      state: 'closed',
      created_at: '2024-01-15T00:00:00Z',
      merged_at: '2024-01-16T00:00:00Z',
      user: { login: 'human-dev' },
      html_url: `https://github.com/test/repo/pull/${1000 + i}`,
    }));
    const allMerged = [...copilotPRs, ...fetchedMergedPRs];
    // allPRCounts.merged = 1500 (true count from issueCount)
    const allPRCounts = { total: 2000, merged: 1500, open: 500 };

    await mockGraphQLAPI(page, { prs: copilotPRs, allMergedPRs: allMerged, allPRCounts });

    await submitSearch(page, { token: 'ghp_test123456789' });
    await waitForResults(page);

    // Should show 1499 other (1500 merged - 1 copilot), not 100
    await expect(page.locator('#responseTimeSubtitle')).toContainText('1 Copilot');
    await expect(page.locator('#responseTimeSubtitle')).toContainText('1499 other');

    // Warning should be visible with rate limit message (fetched < 1000)
    await expect(page.locator('#responseTimeWarning')).toBeVisible();
    await expect(page.locator('#responseTimeWarning')).toContainText('interrupted');
  });

  test('GraphQL: 1000件上限到達時にAPI制限の警告を表示', async ({ page }) => {
    const copilotPRs = createPRs([
      { title: 'Copilot PR 1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
    ]);
    // Generate 1001 allMergedPRs (1 copilot + 1000 others) — app can only fetch 1000
    const otherMergedPRs = Array.from({ length: 1000 }, (_, i) => createPR({
      id: 2000 + i,
      number: 2000 + i,
      title: `Merged PR ${i + 1}`,
      state: 'closed',
      created_at: '2024-01-15T00:00:00Z',
      merged_at: '2024-01-16T00:00:00Z',
      user: { login: 'human-dev' },
      html_url: `https://github.com/test/repo/pull/${2000 + i}`,
    }));
    const allMerged = [...copilotPRs, ...otherMergedPRs];
    const allPRCounts = { total: 2000, merged: 1500, open: 500 };

    await mockGraphQLAPI(page, { prs: copilotPRs, allMergedPRs: allMerged, allPRCounts });

    await submitSearch(page, { token: 'ghp_test123456789' });
    await waitForResults(page);

    // Subtitle uses allPRCounts.merged for accurate count
    await expect(page.locator('#responseTimeSubtitle')).toContainText('1 Copilot');
    await expect(page.locator('#responseTimeSubtitle')).toContainText('1499 other');

    // Warning should show API limit message (fetched >= 1000)
    await expect(page.locator('#responseTimeWarning')).toBeVisible();
    await expect(page.locator('#responseTimeWarning')).toContainText('GitHub API limit');
  });

  test('REST: レートリミットで部分データ取得時に警告を表示', async ({ page }) => {
    const copilotPRs = createPRs([
      { title: 'Copilot PR 1', state: 'closed', created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' },
    ]);
    // 200 other merged PRs (needs 2 pages), but page 2 will return 403
    const otherMergedPRs = Array.from({ length: 200 }, (_, i) => createPR({
      id: 1000 + i,
      number: 1000 + i,
      title: `Other Merged PR ${i + 1}`,
      state: 'closed',
      created_at: '2024-01-15T00:00:00Z',
      merged_at: '2024-01-16T00:00:00Z',
      user: { login: 'human-dev' },
      html_url: `https://github.com/test/repo/pull/${1000 + i}`,
    }));
    const allPRCounts = { total: 300, merged: 201, open: 99 };

    // Custom mock: Copilot PRs normal, count queries normal, but allMergedPRs page 2 returns 403
    let mergedPageCounter = 0;
    await page.route('https://api.github.com/search/issues**', async route => {
      const url = route.request().url();
      const urlObj = new URL(url);
      const queryParam = urlObj.searchParams.get('q') || '';
      const perPage = urlObj.searchParams.get('per_page') || '';
      const pageNum = parseInt(urlObj.searchParams.get('page') || '1', 10);

      // Count queries (per_page=1)
      if (perPage === '1' && !queryParam.includes('author:')) {
        let count = 0;
        if (queryParam.includes('is:merged')) count = allPRCounts.merged;
        else if (queryParam.includes('is:open')) count = allPRCounts.open;
        else count = allPRCounts.total;
        const response = createSearchResponse([]);
        response.total_count = count;
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(response),
        });
        return;
      }

      // All merged PRs query (is:merged without author:)
      if (queryParam.includes('is:merged') && !queryParam.includes('author:') && perPage !== '1') {
        mergedPageCounter++;
        if (mergedPageCounter >= 2) {
          // Simulate rate limit on page 2
          await route.fulfill({
            status: 403,
            headers: createRateLimitHeaders(0),
            body: JSON.stringify({ message: 'API rate limit exceeded' }),
          });
          return;
        }
        // Page 1: return first 100 items
        const start = (pageNum - 1) * 100;
        const pageItems = otherMergedPRs.slice(start, start + 100);
        const response = createSearchResponse(pageItems);
        response.total_count = otherMergedPRs.length;
        await route.fulfill({
          status: 200,
          headers: createRateLimitHeaders(),
          body: JSON.stringify(response),
        });
        return;
      }

      // Copilot PR search query
      await route.fulfill({
        status: 200,
        headers: createRateLimitHeaders(),
        body: JSON.stringify(createSearchResponse(copilotPRs)),
      });
    });

    await submitSearch(page);
    await waitForResults(page);

    // Count should be accurate (from allPRCounts), stats from partial data
    await expect(page.locator('#responseTimeSubtitle')).toContainText('1 Copilot');
    await expect(page.locator('#responseTimeSubtitle')).toContainText('200 other');

    // Warning should show rate limit message (fetched < 1000)
    await expect(page.locator('#responseTimeWarning')).toBeVisible();
    await expect(page.locator('#responseTimeWarning')).toContainText('interrupted');
  });
});
