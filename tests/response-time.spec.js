import { test, expect } from '@playwright/test';
import {
  createPRs,
  createPR,
  mockSearchAPI,
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
    await mockSearchAPI(page, { prs: copilotPRs, allMergedPRs: allMerged });

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
});
