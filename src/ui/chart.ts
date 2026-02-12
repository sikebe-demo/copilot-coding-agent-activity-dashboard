import { state, dom } from '../state';
import {
    prepareChartData,
    CHART_COLORS,
    getChartTheme,
} from '../../lib';
import type { PullRequest } from '../../lib';

/**
 * Lazily load Chart.js with only the components needed for bar charts.
 * This enables code splitting — Chart.js (~180 KB) is downloaded only when
 * the user actually views results, not on initial page load.
 */
export async function loadChartJS() {
    if (state.ChartCtor) return state.ChartCtor;
    const {
        Chart: ChartJS,
        BarController,
        BarElement,
        CategoryScale,
        LinearScale,
        Tooltip,
        Legend,
    } = await import('chart.js');
    ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);
    state.ChartCtor = ChartJS;
    return ChartJS;
}

export async function displayChart(prs: PullRequest[], fromDate: string, toDate: string): Promise<void> {
    const { dates, mergedData, closedData, openData } = prepareChartData(prs, fromDate, toDate);

    const chartContainer = dom.prChart;
    if (!chartContainer) return;

    // Dynamically load Chart.js (only the bar-chart components)
    const ChartJS = await loadChartJS();

    // Create canvas if it doesn't exist
    let canvas = chartContainer.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
    }

    // Accessibility: provide role, label, and detailed description for screen readers
    const descriptionId = 'pr-chart-description';
    let descriptionElement = chartContainer.querySelector<HTMLDivElement>('#' + descriptionId);
    if (!descriptionElement) {
        descriptionElement = document.createElement('div');
        descriptionElement.id = descriptionId;
        // Visually hidden but available to screen readers
        descriptionElement.style.position = 'absolute';
        descriptionElement.style.width = '1px';
        descriptionElement.style.height = '1px';
        descriptionElement.style.padding = '0';
        descriptionElement.style.margin = '-1px';
        descriptionElement.style.overflow = 'hidden';
        descriptionElement.style.clip = 'rect(0, 0, 0, 0)';
        descriptionElement.style.whiteSpace = 'nowrap';
        descriptionElement.style.border = '0';
        chartContainer.appendChild(descriptionElement);
    }
    descriptionElement.textContent = `Chart: Daily PR trend for ${prs.length} pull requests from ${fromDate} to ${toDate}. Displays daily counts of merged, closed, and open pull requests.`;

    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Daily PR trend chart showing ${prs.length} pull requests from ${fromDate} to ${toDate}`);
    canvas.setAttribute('aria-describedby', descriptionId);

    // Destroy previous chart if exists
    if (state.chartInstance) {
        state.chartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    state.chartInstance = new ChartJS(canvas, {
        type: 'bar',
        data: {
            labels: dates.map(date => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
            datasets: [
                {
                    label: 'Merged',
                    data: mergedData,
                    backgroundColor: CHART_COLORS.merged.backgroundColor,
                    borderColor: CHART_COLORS.merged.borderColor,
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Closed',
                    data: closedData,
                    backgroundColor: CHART_COLORS.closed.backgroundColor,
                    borderColor: CHART_COLORS.closed.borderColor,
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Open',
                    data: openData,
                    backgroundColor: CHART_COLORS.open.backgroundColor,
                    borderColor: CHART_COLORS.open.borderColor,
                    borderWidth: 2,
                    borderRadius: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: theme.textColor,
                        padding: 20,
                        font: {
                            size: 12,
                            weight: 600
                        },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: theme.tooltipBg,
                    titleColor: theme.textColor,
                    bodyColor: theme.textColor,
                    borderColor: theme.tooltipBorder,
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: theme.textColor,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: theme.gridColor
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: theme.textColor,
                        precision: 0,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: theme.gridColor
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    });
}

export function updateChartTheme(): void {
    if (!state.chartInstance) return;

    const isDark = document.documentElement.classList.contains('dark');
    const theme = getChartTheme(isDark);

    if (state.chartInstance.options.plugins?.legend?.labels) {
        state.chartInstance.options.plugins.legend.labels.color = theme.textColor;
    }
    if (state.chartInstance.options.plugins?.tooltip) {
        state.chartInstance.options.plugins.tooltip.backgroundColor = theme.tooltipBg;
        state.chartInstance.options.plugins.tooltip.titleColor = theme.textColor;
        state.chartInstance.options.plugins.tooltip.bodyColor = theme.textColor;
        state.chartInstance.options.plugins.tooltip.borderColor = theme.tooltipBorder;
    }
    if (state.chartInstance.options.scales?.x?.ticks) {
        state.chartInstance.options.scales.x.ticks.color = theme.textColor;
    }
    if (state.chartInstance.options.scales?.x?.grid) {
        state.chartInstance.options.scales.x.grid.color = theme.gridColor;
    }
    if (state.chartInstance.options.scales?.y?.ticks) {
        state.chartInstance.options.scales.y.ticks.color = theme.textColor;
    }
    if (state.chartInstance.options.scales?.y?.grid) {
        state.chartInstance.options.scales.y.grid.color = theme.gridColor;
    }

    state.chartInstance.update();
}
