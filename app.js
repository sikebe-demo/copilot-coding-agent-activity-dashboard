// Import Chart.js from npm
import Chart from 'chart.js/auto';

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    initializeTheme();
    initializeForm();
    setDefaultDates();
});

// Theme Management
function initializeTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('theme') || 'light';

    if (savedTheme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    themeToggle?.addEventListener('click', toggleTheme);
}

function toggleTheme() {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark');

    if (isDark) {
        html.classList.remove('dark');
        html.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        html.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }

    // Update chart if it exists
    if (chartInstance) {
        updateChartTheme();
    }
}

// Set default dates (last 30 days)
function setDefaultDates() {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);

    const toInput = document.getElementById('toDate');
    const fromInput = document.getElementById('fromDate');

    if (toInput) toInput.valueAsDate = toDate;
    if (fromInput) fromInput.valueAsDate = fromDate;
}

// Form initialization
function initializeForm() {
    const form = document.getElementById('searchForm');
    form?.addEventListener('submit', handleFormSubmit);
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const repoInput = document.getElementById('repoInput').value.trim();
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const token = document.getElementById('tokenInput').value.trim();

    if (!repoInput.includes('/')) {
        showError('Please enter repository in "owner/repo" format');
        return;
    }

    const [owner, repo] = repoInput.split('/');

    showLoading();
    hideError();
    hideResults();

    try {
        const prs = await fetchCopilotPRs(owner, repo, fromDate, toDate, token);
        displayResults(prs, owner, repo);
    } catch (error) {
        showError(error.message);
    } finally {
        hideLoading();
    }
}

// GitHub API Functions
async function fetchCopilotPRs(owner, repo, fromDate, toDate, token) {
    const headers = {
        'Accept': 'application/vnd.github.v3+json'
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const allPRs = [];
    let page = 1;
    const perPage = 100;

    while (true) {
        const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=${perPage}&page=${page}&sort=created&direction=desc`;

        const response = await fetch(url, { headers });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Repository not found');
            } else if (response.status === 403) {
                throw new Error('API rate limit reached. Please use a token');
            } else {
                throw new Error(`GitHub API Error: ${response.status}`);
            }
        }

        const prs = await response.json();

        if (prs.length === 0) break;

        // Filter PRs by date range
        const fromDateObj = new Date(fromDate);
        const toDateObj = new Date(toDate);
        toDateObj.setHours(23, 59, 59, 999);

        const filteredPRs = prs.filter(pr => {
            const createdAt = new Date(pr.created_at);
            return createdAt >= fromDateObj && createdAt <= toDateObj;
        });

        allPRs.push(...filteredPRs);

        // If the oldest PR in this batch is before our date range, stop fetching
        if (prs.length > 0 && new Date(prs[prs.length - 1].created_at) < fromDateObj) {
            break;
        }

        // If we got fewer PRs than requested, we've reached the end
        if (prs.length < perPage) break;

        page++;
    }

    // Filter for Copilot-created PRs
    const copilotPRs = allPRs.filter(pr => isCopilotPR(pr));

    return copilotPRs;
}

function isCopilotPR(pr) {
    // Check if PR was created by copilot
    const copilotUsers = ['copilot-workspace-helper', 'github-copilot', 'copilot'];
    const isCopilotUser = copilotUsers.some(user =>
        pr.user.login.toLowerCase().includes(user)
    );

    // Check PR title/body for copilot indicators
    const copilotIndicators = [
        'copilot',
        'github copilot',
        'ai generated',
        'workspace ai',
        'copilot workspace'
    ];

    const titleBody = `${pr.title} ${pr.body || ''}`.toLowerCase();
    const hasIndicator = copilotIndicators.some(indicator =>
        titleBody.includes(indicator)
    );

    // Check labels
    const hasLabel = pr.labels && pr.labels.some(label =>
        label.name.toLowerCase().includes('copilot')
    );

    return isCopilotUser || hasIndicator || hasLabel;
}

// Display Functions
function displayResults(prs, owner, repo) {
    const merged = prs.filter(pr => pr.merged_at !== null);
    const closed = prs.filter(pr => pr.state === 'closed' && pr.merged_at === null);
    const open = prs.filter(pr => pr.state === 'open');

    const mergeRate = prs.length > 0
        ? Math.round((merged.length / prs.length) * 100)
        : 0;

    // Update summary cards with animation
    animateValue('totalPRs', 0, prs.length, 1000);
    animateValue('mergedPRs', 0, merged.length, 1000);
    animateValue('closedPRs', 0, closed.length, 1000);
    animateValue('openPRs', 0, open.length, 1000);

    // Update merge rate with animation
    document.getElementById('mergeRateValue').textContent = `${mergeRate}%`;
    document.getElementById('mergeRateText').textContent = `${mergeRate}%`;

    setTimeout(() => {
        document.getElementById('mergeRateBar').style.width = `${mergeRate}%`;
    }, 100);

    // Display chart
    displayChart(prs);

    // Display PR list
    displayPRList(prs);

    showResults();
}

// Animate number counting
function animateValue(id, start, end, duration) {
    const element = document.getElementById(id);
    if (!element) return;

    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;

    const timer = setInterval(() => {
        current += increment;
        if (current >= end) {
            element.textContent = Math.round(end);
            clearInterval(timer);
        } else {
            element.textContent = Math.round(current);
        }
    }, 16);
}

let chartInstance = null;

function displayChart(prs) {
    // Group PRs by date
    const prsByDate = {};

    prs.forEach(pr => {
        const date = new Date(pr.created_at).toISOString().split('T')[0];
        if (!prsByDate[date]) {
            prsByDate[date] = { merged: 0, closed: 0, open: 0 };
        }

        if (pr.merged_at) {
            prsByDate[date].merged++;
        } else if (pr.state === 'closed') {
            prsByDate[date].closed++;
        } else {
            prsByDate[date].open++;
        }
    });

    // Sort dates
    const dates = Object.keys(prsByDate).sort();
    const mergedData = dates.map(date => prsByDate[date].merged);
    const closedData = dates.map(date => prsByDate[date].closed);
    const openData = dates.map(date => prsByDate[date].open);

    const chartContainer = document.getElementById('prChart');
    if (!chartContainer) return;

    // Create canvas if it doesn't exist
    let canvas = chartContainer.querySelector('canvas');
    if (!canvas) {
        canvas = document.createElement('canvas');
        chartContainer.appendChild(canvas);
    }

    // Destroy previous chart if exists
    if (chartInstance) {
        chartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e2e8f0' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    chartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: dates.map(date => new Date(date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })),
            datasets: [
                {
                    label: 'Merged',
                    data: mergedData,
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Closed',
                    data: closedData,
                    backgroundColor: 'rgba(239, 68, 68, 0.8)',
                    borderColor: 'rgba(239, 68, 68, 1)',
                    borderWidth: 2,
                    borderRadius: 8
                },
                {
                    label: 'Open',
                    data: openData,
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 2,
                    borderRadius: 8
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: textColor,
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
                    backgroundColor: isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)',
                    titleColor: textColor,
                    bodyColor: textColor,
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 12,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: textColor,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: gridColor,
                        drawBorder: false
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: textColor,
                        precision: 0,
                        font: {
                            size: 11
                        }
                    },
                    grid: {
                        color: gridColor,
                        drawBorder: false
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

function updateChartTheme() {
    if (!chartInstance) return;

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e2e8f0' : '#1e293b';
    const gridColor = isDark ? '#334155' : '#e2e8f0';

    chartInstance.options.plugins.legend.labels.color = textColor;
    chartInstance.options.plugins.tooltip.backgroundColor = isDark ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.9)';
    chartInstance.options.plugins.tooltip.titleColor = textColor;
    chartInstance.options.plugins.tooltip.bodyColor = textColor;
    chartInstance.options.plugins.tooltip.borderColor = isDark ? '#334155' : '#e2e8f0';
    chartInstance.options.scales.x.ticks.color = textColor;
    chartInstance.options.scales.x.grid.color = gridColor;
    chartInstance.options.scales.y.ticks.color = textColor;
    chartInstance.options.scales.y.grid.color = gridColor;

    chartInstance.update();
}

function displayPRList(prs) {
    const prList = document.getElementById('prList');
    if (!prList) return;

    prList.innerHTML = '';

    if (prs.length === 0) {
        prList.innerHTML = `
            <div class="text-center py-16">
                <svg class="w-16 h-16 mx-auto mb-4 text-slate-300 dark:text-slate-700" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <p class="text-slate-500 dark:text-slate-400">No PRs created by Copilot Coding Agent found</p>
            </div>
        `;
        return;
    }

    // Sort PRs by created date (newest first)
    const sortedPRs = [...prs].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
    );

    sortedPRs.forEach((pr, index) => {
        const createdDate = new Date(pr.created_at).toLocaleDateString('ja-JP');
        const status = pr.merged_at ? 'merged' : pr.state;
        const statusConfig = {
            merged: {
                class: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
                icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
                text: 'Merged'
            },
            closed: {
                class: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
                icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
                text: 'Closed'
            },
            open: {
                class: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                icon: `<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle></svg>`,
                text: 'Open'
            }
        };

        const config = statusConfig[status];

        const prElement = document.createElement('div');
        prElement.className = 'pr-item p-4 rounded-xl bg-white/50 dark:bg-slate-800/50 border-2 border-slate-200 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-400 animate-slide-in';
        prElement.style.animationDelay = `${index * 0.05}s`;
        prElement.innerHTML = `
            <div class="flex items-start justify-between gap-4 mb-3">
                <div class="flex items-center gap-2 flex-shrink-0">
                    <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${config.class}">
                        ${config.icon}
                        ${config.text}
                    </span>
                    <span class="text-xs text-slate-500 dark:text-slate-400">#${pr.number}</span>
                </div>
                <a href="${pr.html_url}" target="_blank" rel="noopener"
                   class="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                   title="GitHubで開く">
                    <svg class="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                </a>
            </div>
            <h3 class="font-semibold text-slate-800 dark:text-slate-100 mb-2 pr-8">${escapeHtml(pr.title)}</h3>
            <div class="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                <span class="flex items-center gap-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    ${escapeHtml(pr.user.login)}
                </span>
                <span class="flex items-center gap-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                    </svg>
                    ${createdDate}
                </span>
            </div>
        `;
        prList.appendChild(prElement);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// UI State Management
function showLoading() {
    const loading = document.getElementById('loading');
    if (loading) {
        loading.classList.remove('hidden');
        loading.classList.add('animate-fade-in');
    }
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
}

function showError(message) {
    const errorEl = document.getElementById('error');
    const errorMessage = document.getElementById('errorMessage');
    if (errorEl && errorMessage) {
        errorMessage.textContent = message;
        errorEl.classList.remove('hidden');
        errorEl.classList.add('animate-fade-in');
    }
}

function hideError() {
    const errorEl = document.getElementById('error');
    if (errorEl) errorEl.classList.add('hidden');
}

function showResults() {
    const results = document.getElementById('results');
    if (results) {
        results.classList.remove('hidden');
    }
}

function hideResults() {
    const results = document.getElementById('results');
    if (results) results.classList.add('hidden');
}
