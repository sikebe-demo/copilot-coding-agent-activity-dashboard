// Initialize Lucide icons
document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
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
    }
    
    themeToggle.addEventListener('click', toggleTheme);
    updateThemeIcon();
}

function toggleTheme() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon();
}

function updateThemeIcon() {
    const themeToggle = document.getElementById('themeToggle');
    const isDark = document.documentElement.classList.contains('dark');
    themeToggle.innerHTML = isDark 
        ? '<i data-lucide="sun" class="w-6 h-6"></i>' 
        : '<i data-lucide="moon" class="w-6 h-6"></i>';
    lucide.createIcons();
}

// Set default dates (last 30 days)
function setDefaultDates() {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - 30);
    
    document.getElementById('toDate').valueAsDate = toDate;
    document.getElementById('fromDate').valueAsDate = fromDate;
}

// Form initialization
function initializeForm() {
    const form = document.getElementById('searchForm');
    form.addEventListener('submit', handleFormSubmit);
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    const repoInput = document.getElementById('repoInput').value.trim();
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const token = document.getElementById('tokenInput').value.trim();
    
    if (!repoInput.includes('/')) {
        showError('リポジトリは "owner/repo" の形式で入力してください');
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
        headers['Authorization'] = `token ${token}`;
    }
    
    const allPRs = [];
    let page = 1;
    const perPage = 100;
    
    while (true) {
        const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=${perPage}&page=${page}&sort=created&direction=desc`;
        
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('リポジトリが見つかりません');
            } else if (response.status === 403) {
                throw new Error('API制限に達しました。トークンを使用してください');
            } else {
                throw new Error(`GitHub API エラー: ${response.status}`);
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
    
    // Update summary cards
    document.getElementById('totalPRs').textContent = prs.length;
    document.getElementById('mergedPRs').textContent = merged.length;
    document.getElementById('closedPRs').textContent = closed.length;
    document.getElementById('openPRs').textContent = open.length;
    
    // Update merge rate
    document.getElementById('mergeRateValue').textContent = `${mergeRate}%`;
    document.getElementById('mergeRateText').textContent = `${mergeRate}%`;
    document.getElementById('mergeRateBar').style.width = `${mergeRate}%`;
    
    // Display chart
    displayChart(prs);
    
    // Display PR list
    displayPRList(prs);
    
    showResults();
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
    
    const ctx = document.getElementById('prChart');
    
    // Destroy previous chart if exists
    if (chartInstance) {
        chartInstance.destroy();
    }
    
    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#e5e7eb' : '#1f2937';
    const gridColor = isDark ? '#374151' : '#e5e7eb';
    
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'マージ済',
                    data: mergedData,
                    backgroundColor: 'rgba(34, 197, 94, 0.8)',
                    borderColor: 'rgba(34, 197, 94, 1)',
                    borderWidth: 1
                },
                {
                    label: 'クローズ済',
                    data: closedData,
                    backgroundColor: 'rgba(239, 68, 68, 0.8)',
                    borderColor: 'rgba(239, 68, 68, 1)',
                    borderWidth: 1
                },
                {
                    label: 'オープン',
                    data: openData,
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    labels: {
                        color: textColor
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    ticks: {
                        color: textColor
                    },
                    grid: {
                        color: gridColor
                    }
                },
                y: {
                    stacked: true,
                    ticks: {
                        color: textColor,
                        precision: 0
                    },
                    grid: {
                        color: gridColor
                    }
                }
            }
        }
    });
}

function displayPRList(prs) {
    const prList = document.getElementById('prList');
    prList.innerHTML = '';
    
    if (prs.length === 0) {
        prList.innerHTML = `
            <div class="text-center py-8 text-gray-500">
                <i data-lucide="inbox" class="w-12 h-12 mx-auto mb-2 opacity-50"></i>
                <p>Copilot Coding Agentが作成したPRは見つかりませんでした</p>
            </div>
        `;
        lucide.createIcons();
        return;
    }
    
    // Sort PRs by created date (newest first)
    const sortedPRs = [...prs].sort((a, b) => 
        new Date(b.created_at) - new Date(a.created_at)
    );
    
    sortedPRs.forEach(pr => {
        const createdDate = new Date(pr.created_at).toLocaleDateString('ja-JP');
        const status = pr.merged_at ? 'merged' : pr.state;
        const statusConfig = {
            merged: {
                class: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
                icon: 'check-circle',
                text: 'マージ済'
            },
            closed: {
                class: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
                icon: 'x-circle',
                text: 'クローズ済'
            },
            open: {
                class: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
                icon: 'git-pull-request',
                text: 'オープン'
            }
        };
        
        const config = statusConfig[status];
        
        const prElement = document.createElement('div');
        prElement.className = 'border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow';
        prElement.innerHTML = `
            <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-2">
                        <span class="px-3 py-1 rounded-full text-xs font-medium ${config.class} flex items-center gap-1">
                            <i data-lucide="${config.icon}" class="w-3 h-3"></i>
                            ${config.text}
                        </span>
                        <span class="text-sm text-gray-500">#${pr.number}</span>
                    </div>
                    <a href="${pr.html_url}" target="_blank" class="text-lg font-medium hover:text-primary transition-colors block mb-1 truncate">
                        ${escapeHtml(pr.title)}
                    </a>
                    <div class="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                        <span class="flex items-center gap-1">
                            <i data-lucide="user" class="w-4 h-4"></i>
                            ${escapeHtml(pr.user.login)}
                        </span>
                        <span class="flex items-center gap-1">
                            <i data-lucide="calendar" class="w-4 h-4"></i>
                            ${createdDate}
                        </span>
                    </div>
                </div>
                <a href="${pr.html_url}" target="_blank" class="flex-shrink-0 p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
                    <i data-lucide="external-link" class="w-5 h-5"></i>
                </a>
            </div>
        `;
        prList.appendChild(prElement);
    });
    
    lucide.createIcons();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// UI State Management
function showLoading() {
    document.getElementById('loading').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading').classList.add('hidden');
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('error').classList.remove('hidden');
}

function hideError() {
    document.getElementById('error').classList.add('hidden');
}

function showResults() {
    document.getElementById('results').classList.remove('hidden');
}

function hideResults() {
    document.getElementById('results').classList.add('hidden');
}
