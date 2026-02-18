import { describe, it, expect } from 'vitest';
import {
  calculateResponseTimes,
  formatDuration,
  generateResponseTimeStatsHtml,
} from '../lib';
import type { PullRequest, ResponseTimeMetrics } from '../lib';

// ---------------------------------------------------------------------------
// ヘルパー: テスト用 PR を手軽に作る
// ---------------------------------------------------------------------------
function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 1,
    number: 1,
    title: 'Test PR',
    state: 'closed',
    merged_at: null,
    created_at: '2024-01-15T10:00:00Z',
    user: { login: 'copilot' },
    html_url: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

// ===========================================================================
// calculateResponseTimes
// ===========================================================================
describe('calculateResponseTimes', () => {

  it('2件（24h, 12h）で平均・中央値・最速・最遅を計算', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T10:00:00Z', merged_at: '2024-01-16T10:00:00Z' }), // 24h
      makePR({ created_at: '2024-01-15T10:00:00Z', merged_at: '2024-01-15T22:00:00Z' }), // 12h
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.average).toBe(18);
    expect(m.median).toBe(18);
    expect(m.fastest).toBe(12);
    expect(m.slowest).toBe(24);
  });

  it('マージ済み 0 件で null を返す', () => {
    const prs = [makePR({ state: 'open', merged_at: null })];
    expect(calculateResponseTimes(prs)).toBeNull();
  });

  it('空配列で null を返す', () => {
    expect(calculateResponseTimes([])).toBeNull();
  });

  it('merged_at が null の PR は除外', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T10:00:00Z', merged_at: '2024-01-15T16:00:00Z' }), // 6h
      makePR({ merged_at: null }),
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.totalMerged).toBe(1);
    expect(m.average).toBe(6);
  });

  it('1件のみの場合 avg=median=fastest=slowest', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T10:00:00Z', merged_at: '2024-01-15T13:00:00Z' }), // 3h
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.average).toBe(3);
    expect(m.median).toBe(3);
    expect(m.fastest).toBe(3);
    expect(m.slowest).toBe(3);
  });

  it('バケット分布の正確性', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T00:30:00Z' }), // 0.5h → <1h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T03:00:00Z' }), // 3h → 1-6h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T12:00:00Z' }), // 12h → 6-24h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-16T12:00:00Z' }), // 36h → 1-3d
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-19T00:00:00Z' }), // 96h → 3-7d
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-25T00:00:00Z' }), // 240h → 7d+
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.buckets.map(b => b.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('偶数個の中央値: 4件 (2h, 6h, 12h, 48h) → median=9', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' }),  // 2h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' }),  // 6h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T12:00:00Z' }),  // 12h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-17T00:00:00Z' }),  // 48h
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.median).toBe(9);
    expect(m.average).toBe(17);
  });

  it('負のレスポンスタイム: merged_at < created_at はフィルタアウト', () => {
    const prs = [
      makePR({ created_at: '2024-01-16T00:00:00Z', merged_at: '2024-01-15T00:00:00Z' }), // -24h
    ];
    expect(calculateResponseTimes(prs)).toBeNull();
  });

  it('NaN のレスポンスタイム: 不正な日時はフィルタアウト', () => {
    const prs = [
      makePR({ created_at: 'invalid-date', merged_at: '2024-01-15T00:00:00Z' }),
    ];
    expect(calculateResponseTimes(prs)).toBeNull();
  });

  it('ゼロのレスポンスタイム: created_at === merged_at → <1h バケット', () => {
    const ts = '2024-01-15T10:00:00Z';
    const prs = [makePR({ created_at: ts, merged_at: ts })];
    const m = calculateResponseTimes(prs)!;
    expect(m.fastest).toBe(0);
    expect(m.buckets[0].label).toBe('<1h');
    expect(m.buckets[0].count).toBe(1);
  });

  it('全 PR が同一バケット（1-6h）', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T02:00:00Z' }), // 2h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T03:00:00Z' }), // 3h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T05:00:00Z' }), // 5h
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.buckets[1].label).toBe('1-6h');
    expect(m.buckets[1].count).toBe(3);
    expect(m.buckets.filter(b => b.count > 0)).toHaveLength(1);
  });

  it('バケット境界値: 1h, 6h, 24h, 72h, 168h は上位バケットに分類', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T01:00:00Z' }),   // 1h → 1-6h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' }),   // 6h → 6-24h
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-16T00:00:00Z' }),   // 24h → 1-3d
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-18T00:00:00Z' }),   // 72h → 3-7d
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-22T00:00:00Z' }),   // 168h → 7d+
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.buckets[0].count).toBe(0); // <1h
    expect(m.buckets[1].count).toBe(1); // 1-6h (1h)
    expect(m.buckets[2].count).toBe(1); // 6-24h (6h)
    expect(m.buckets[3].count).toBe(1); // 1-3d (24h)
    expect(m.buckets[4].count).toBe(1); // 3-7d (72h)
    expect(m.buckets[5].count).toBe(1); // 7d+ (168h)
  });

  it('mixed valid+invalid: 有効2件 + NaN + 負値', () => {
    const prs = [
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T06:00:00Z' }),   // 6h valid
      makePR({ created_at: '2024-01-15T00:00:00Z', merged_at: '2024-01-15T12:00:00Z' }),   // 12h valid
      makePR({ created_at: 'bad-date', merged_at: '2024-01-15T00:00:00Z' }),                 // NaN
      makePR({ created_at: '2024-01-16T00:00:00Z', merged_at: '2024-01-15T00:00:00Z' }),   // -24h
    ];
    const m = calculateResponseTimes(prs)!;
    expect(m.totalMerged).toBe(2);
    expect(m.average).toBe(9);
    expect(m.median).toBe(9);
  });
});

// ===========================================================================
// formatDuration
// ===========================================================================
describe('formatDuration', () => {
  it('0.5h → "30 min"', () => expect(formatDuration(0.5)).toBe('30 min'));
  it('2.5h → "2.5 hours"', () => expect(formatDuration(2.5)).toBe('2.5 hours'));
  it('48h → "2.0 days"', () => expect(formatDuration(48)).toBe('2.0 days'));
  it('0 → "0 min"', () => expect(formatDuration(0)).toBe('0 min'));
  it('1.0 → "1.0 hours"', () => expect(formatDuration(1.0)).toBe('1.0 hours'));
  it('24.0 → "1.0 days"', () => expect(formatDuration(24.0)).toBe('1.0 days'));
  it('NaN → "0 min"', () => expect(formatDuration(NaN)).toBe('0 min'));
  it('Infinity → "0 min"', () => expect(formatDuration(Infinity)).toBe('0 min'));
  it('-Infinity → "0 min"', () => expect(formatDuration(-Infinity)).toBe('0 min'));
  it('-5 → "0 min"', () => expect(formatDuration(-5)).toBe('0 min'));
  it('0.9917 → 境界エスカレーション → "1.0 hours"', () => expect(formatDuration(0.9917)).toBe('1.0 hours'));
  it('23.96 → 境界エスカレーション → "1.0 days"', () => expect(formatDuration(23.96)).toBe('1.0 days'));
});

// ===========================================================================
// generateResponseTimeStatsHtml
// ===========================================================================
describe('generateResponseTimeStatsHtml', () => {
  it('4つのカードラベルと値を含む HTML を返す', () => {
    const metrics: ResponseTimeMetrics = {
      average: 18,
      median: 12,
      fastest: 2,
      slowest: 48,
      buckets: [
        { label: '<1h', count: 0 },
        { label: '1-6h', count: 1 },
        { label: '6-24h', count: 1 },
        { label: '1-3d', count: 0 },
        { label: '3-7d', count: 0 },
        { label: '7d+', count: 0 },
      ],
      totalMerged: 2,
    };
    const html = generateResponseTimeStatsHtml(metrics);

    // ラベルの存在
    expect(html).toContain('Average Response Time');
    expect(html).toContain('Median Response Time');
    expect(html).toContain('Fastest PR');
    expect(html).toContain('Slowest PR');

    // formatDuration 変換後の値
    expect(html).toContain('18.0 hours');  // average
    expect(html).toContain('12.0 hours');  // median
    expect(html).toContain('2.0 hours');   // fastest
    expect(html).toContain('2.0 days');    // slowest (48h)
  });

  it('comparison mode: Copilot と Others の値を両方表示', () => {
    const copilotMetrics: ResponseTimeMetrics = {
      average: 6,
      median: 5,
      fastest: 2,
      slowest: 12,
      buckets: [
        { label: '<1h', count: 0 },
        { label: '1-6h', count: 2 },
        { label: '6-24h', count: 1 },
        { label: '1-3d', count: 0 },
        { label: '3-7d', count: 0 },
        { label: '7d+', count: 0 },
      ],
      totalMerged: 3,
    };
    const othersMetrics: ResponseTimeMetrics = {
      average: 48,
      median: 36,
      fastest: 12,
      slowest: 96,
      buckets: [
        { label: '<1h', count: 0 },
        { label: '1-6h', count: 0 },
        { label: '6-24h', count: 1 },
        { label: '1-3d', count: 1 },
        { label: '3-7d', count: 1 },
        { label: '7d+', count: 0 },
      ],
      totalMerged: 3,
    };
    const html = generateResponseTimeStatsHtml(copilotMetrics, othersMetrics);

    // Copilot/Others ラベルの存在
    expect(html).toContain('Copilot');
    expect(html).toContain('Others');

    // Copilot の値
    expect(html).toContain('6.0 hours');   // copilot average
    expect(html).toContain('2.0 hours');   // copilot fastest

    // Others の値
    expect(html).toContain('2.0 days');    // others average (48h)
    expect(html).toContain('4.0 days');    // others slowest (96h)
  });

  it('comparison mode with null othersMetrics: Others が "-" 表示', () => {
    const copilotMetrics: ResponseTimeMetrics = {
      average: 6,
      median: 5,
      fastest: 2,
      slowest: 12,
      buckets: [],
      totalMerged: 3,
    };
    const html = generateResponseTimeStatsHtml(copilotMetrics, null);

    expect(html).toContain('Copilot');
    expect(html).toContain('Others');
    // Others values should be "-"
    const othersMatches = html.match(/>-</g);
    expect(othersMatches).not.toBeNull();
    expect(othersMatches!.length).toBe(4); // 4 cards with "-"
  });
});
