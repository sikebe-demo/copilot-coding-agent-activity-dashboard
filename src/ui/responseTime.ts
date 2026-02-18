import { state, dom } from '../state';
import {
    calculateResponseTimes,
    generateResponseTimeStatsHtml,
    RESPONSE_TIME_CHART_COLORS,
    RESPONSE_TIME_OTHERS_CHART_COLORS,
    getChartTheme,
} from '../../lib';
import type { PullRequest, AllPRCounts } from '../../lib';
import { loadChartJS } from './chart';

export async function displayResponseTimeAnalysis(copilotPRs: PullRequest[], allMergedPRs?: PullRequest[], allPRCounts?: AllPRCounts): Promise<void> {
    if (!dom.responseTimeStats || !dom.responseTimeChart || !dom.responseTimeEmpty || !dom.responseTimeSubtitle) return;

    // 前回のチャートインスタンスを破棄
    if (state.responseTimeChartInstance) {
        state.responseTimeChartInstance.destroy();
        state.responseTimeChartInstance = null;
    }

    const copilotMetrics = calculateResponseTimes(copilotPRs);

    // Only compute "Others" metrics when comparison data has been explicitly loaded
    const hasComparisonData = allMergedPRs && allMergedPRs.length > 0;
    let othersMetrics: ReturnType<typeof calculateResponseTimes> = null;
    let otherMergedPRs: PullRequest[] = [];
    if (hasComparisonData) {
        const copilotIds = new Set(copilotPRs.map(pr => pr.id));
        otherMergedPRs = allMergedPRs.filter(pr => !copilotIds.has(pr.id));
        othersMetrics = calculateResponseTimes(otherMergedPRs);
    }

    if (!copilotMetrics && !othersMetrics) {
        // マージ済み0件: 空状態表示
        dom.responseTimeEmpty.classList.remove('hidden');
        dom.responseTimeStats.classList.add('hidden');
        dom.responseTimeChart.classList.add('hidden');
        dom.responseTimeSubtitle.classList.add('hidden');
        if (dom.responseTimeWarning) dom.responseTimeWarning.classList.add('hidden');
        return;
    }

    // メトリクスあり: 表示
    dom.responseTimeEmpty.classList.add('hidden');
    dom.responseTimeStats.classList.remove('hidden');
    dom.responseTimeChart.classList.remove('hidden');
    dom.responseTimeSubtitle.classList.remove('hidden');

    const copilotCount = copilotMetrics?.totalMerged ?? 0;
    // Use allPRCounts.merged for accurate "other" count when available
    // (allMergedPRs may be capped at 1000 by GitHub Search API)
    const othersCount = (allPRCounts && allPRCounts.merged > 0)
        ? allPRCounts.merged - copilotCount
        : (othersMetrics?.totalMerged ?? 0);
    if (hasComparisonData) {
        dom.responseTimeSubtitle.textContent = `Based on ${copilotCount} Copilot & ${othersCount} other merged PR${copilotCount + othersCount === 1 ? '' : 's'}`;
    } else {
        dom.responseTimeSubtitle.textContent = `Based on ${copilotCount} Copilot merged PR${copilotCount === 1 ? '' : 's'}`;
    }

    // Show warning when allMergedPRs data is incomplete due to GitHub API 1000-item limit
    if (dom.responseTimeWarning) {
        const totalMergedCount = allPRCounts?.merged ?? 0;
        const fetchedCount = allMergedPRs?.length ?? 0;
        if (hasComparisonData && totalMergedCount > fetchedCount) {
            const othersActualFetched = fetchedCount - copilotCount;
            if (fetchedCount >= 1000) {
                dom.responseTimeWarning.textContent = `⚠ Response time statistics for "Others" are based on ${othersActualFetched} of ${othersCount} merged PRs (GitHub API limit: 1,000 items per search)`;
            } else {
                dom.responseTimeWarning.textContent = `⚠ Response time statistics for "Others" are based on ${othersActualFetched} of ${othersCount} merged PRs (data retrieval was interrupted, possibly due to API rate limits)`;
            }
            dom.responseTimeWarning.classList.remove('hidden');
        } else {
            dom.responseTimeWarning.classList.add('hidden');
        }
    }

    // 統計カード生成
    if (copilotMetrics) {
        dom.responseTimeStats.innerHTML = generateResponseTimeStatsHtml(copilotMetrics, hasComparisonData ? othersMetrics : undefined);
    } else if (othersMetrics) {
        // Only others have merged PRs - show others only
        dom.responseTimeStats.innerHTML = generateResponseTimeStatsHtml(othersMetrics);
    }

    // Chart.js をロード
    const ChartJS = await loadChartJS();

    // Canvas 生成（既存パターン）
    let canvas = dom.responseTimeChart.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        dom.responseTimeChart.appendChild(canvas);
    }

    // ARIA 属性
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Response time distribution histogram comparing Copilot and other PRs');
    canvas.setAttribute('aria-describedby', 'response-time-chart-description');

    // 隠し説明要素
    let descEl = dom.responseTimeChart.querySelector<HTMLDivElement>('#response-time-chart-description');
    if (!descEl) {
        descEl = document.createElement('div');
        descEl.id = 'response-time-chart-description';
        descEl.style.position = 'absolute';
        descEl.style.width = '1px';
        descEl.style.height = '1px';
        descEl.style.overflow = 'hidden';
        descEl.style.clip = 'rect(0,0,0,0)';
        dom.responseTimeChart.appendChild(descEl);
    }
    descEl.textContent = `Histogram: Response time distribution comparing ${copilotCount} Copilot and ${othersCount} other merged pull requests across 6 time buckets`;

    // テーマ
    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    // Build datasets
    const bucketLabels = ['<1h', '1-6h', '6-24h', '1-3d', '3-7d', '7d+'];
    const datasets = [];

    if (copilotMetrics) {
        datasets.push({
            label: 'Copilot',
            data: copilotMetrics.buckets.map(b => b.count),
            backgroundColor: RESPONSE_TIME_CHART_COLORS.backgroundColor,
            borderColor: RESPONSE_TIME_CHART_COLORS.borderColor,
            borderWidth: 2,
            borderRadius: 8,
        });
    }

    if (othersMetrics) {
        datasets.push({
            label: 'Others',
            data: othersMetrics.buckets.map(b => b.count),
            backgroundColor: RESPONSE_TIME_OTHERS_CHART_COLORS.backgroundColor,
            borderColor: RESPONSE_TIME_OTHERS_CHART_COLORS.borderColor,
            borderWidth: 2,
            borderRadius: 8,
        });
    }

    // ヒストグラム描画
    state.responseTimeChartInstance = new ChartJS(canvas, {
        type: 'bar',
        data: {
            labels: bucketLabels,
            datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: datasets.length > 1, labels: { color: theme.textColor } },
                tooltip: {
                    backgroundColor: theme.tooltipBg,
                    titleColor: theme.textColor,
                    bodyColor: theme.textColor,
                    borderColor: theme.tooltipBorder,
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8,
                },
            },
            scales: {
                x: {
                    ticks: { color: theme.textColor },
                    grid: { color: theme.gridColor },
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: theme.textColor, precision: 0 },
                    grid: { color: theme.gridColor },
                },
            },
        },
    });
}

export function updateResponseTimeChartTheme(): void {
    if (!state.responseTimeChartInstance) return;

    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    if (state.responseTimeChartInstance.options.plugins?.tooltip) {
        state.responseTimeChartInstance.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
        state.responseTimeChartInstance.options.plugins.tooltip.titleColor = theme.textColor;
        state.responseTimeChartInstance.options.plugins.tooltip.bodyColor = theme.textColor;
        state.responseTimeChartInstance.options.plugins.tooltip.borderColor = theme.tooltipBorder;
    }
    if (state.responseTimeChartInstance.options.scales?.x?.ticks) {
        state.responseTimeChartInstance.options.scales.x.ticks.color = theme.textColor;
    }
    if (state.responseTimeChartInstance.options.scales?.x?.grid) {
        state.responseTimeChartInstance.options.scales.x.grid.color = theme.gridColor;
    }
    if (state.responseTimeChartInstance.options.scales?.y?.ticks) {
        state.responseTimeChartInstance.options.scales.y.ticks.color = theme.textColor;
    }
    if (state.responseTimeChartInstance.options.scales?.y?.grid) {
        state.responseTimeChartInstance.options.scales.y.grid.color = theme.gridColor;
    }

    state.responseTimeChartInstance.update();
}
