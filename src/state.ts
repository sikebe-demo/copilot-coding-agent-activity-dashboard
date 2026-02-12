import type { Chart } from 'chart.js';
import type { PullRequest, PRFilterStatus } from '../lib';

type ChartStatic = typeof Chart;

export interface AppState {
    rateLimitCountdownInterval: number | null;
    currentRequestId: number;
    chartInstance: Chart | null;
    ChartCtor: ChartStatic | null;
    currentPage: number;
    currentPRs: PullRequest[];
    allFetchedPRs: PullRequest[];
    activeStatusFilter: PRFilterStatus;
    activeSearchText: string;
    currentAbortController: AbortController | null;
}

export const state: AppState = {
    rateLimitCountdownInterval: null,
    currentRequestId: 0,
    chartInstance: null,
    ChartCtor: null,
    currentPage: 1,
    currentPRs: [],
    allFetchedPRs: [],
    activeStatusFilter: 'all',
    activeSearchText: '',
    currentAbortController: null,
};

export interface DOMElements {
    searchForm: HTMLFormElement | null;
    repoInput: HTMLInputElement | null;
    fromDate: HTMLInputElement | null;
    toDate: HTMLInputElement | null;
    tokenInput: HTMLInputElement | null;
    loading: HTMLElement | null;
    error: HTMLElement | null;
    errorMessage: HTMLElement | null;
    results: HTMLElement | null;
    totalPRs: HTMLElement | null;
    mergedPRs: HTMLElement | null;
    closedPRs: HTMLElement | null;
    openPRs: HTMLElement | null;
    mergeRateValue: HTMLElement | null;
    mergeRateText: HTMLElement | null;
    mergeRateBar: HTMLElement | null;
    prChart: HTMLElement | null;
    prList: HTMLElement | null;
    prPagination: HTMLElement | null;
    prSearchInput: HTMLInputElement | null;
    rateLimitInfo: HTMLElement | null;
    themeToggle: HTMLElement | null;
    loadingProgress: HTMLElement | null;
    loadingProgressBar: HTMLElement | null;
    loadingProgressText: HTMLElement | null;
    loadingTitle: HTMLElement | null;
    loadingMessage: HTMLElement | null;
}

export const dom: DOMElements = {
    searchForm: null,
    repoInput: null,
    fromDate: null,
    toDate: null,
    tokenInput: null,
    loading: null,
    error: null,
    errorMessage: null,
    results: null,
    totalPRs: null,
    mergedPRs: null,
    closedPRs: null,
    openPRs: null,
    mergeRateValue: null,
    mergeRateText: null,
    mergeRateBar: null,
    prChart: null,
    prList: null,
    prPagination: null,
    prSearchInput: null,
    rateLimitInfo: null,
    themeToggle: null,
    loadingProgress: null,
    loadingProgressBar: null,
    loadingProgressText: null,
    loadingTitle: null,
    loadingMessage: null,
};

export function cacheDOMElements(): void {
    dom.searchForm = document.getElementById('searchForm') as HTMLFormElement | null;
    dom.repoInput = document.getElementById('repoInput') as HTMLInputElement | null;
    dom.fromDate = document.getElementById('fromDate') as HTMLInputElement | null;
    dom.toDate = document.getElementById('toDate') as HTMLInputElement | null;
    dom.tokenInput = document.getElementById('tokenInput') as HTMLInputElement | null;
    dom.loading = document.getElementById('loading');
    dom.error = document.getElementById('error');
    dom.errorMessage = document.getElementById('errorMessage');
    dom.results = document.getElementById('results');
    dom.totalPRs = document.getElementById('totalPRs');
    dom.mergedPRs = document.getElementById('mergedPRs');
    dom.closedPRs = document.getElementById('closedPRs');
    dom.openPRs = document.getElementById('openPRs');
    dom.mergeRateValue = document.getElementById('mergeRateValue');
    dom.mergeRateText = document.getElementById('mergeRateText');
    dom.mergeRateBar = document.getElementById('mergeRateBar');
    dom.prChart = document.getElementById('prChart');
    dom.prList = document.getElementById('prList');
    dom.prPagination = document.getElementById('prPagination');
    dom.prSearchInput = document.getElementById('prSearchInput') as HTMLInputElement | null;
    dom.rateLimitInfo = document.getElementById('rateLimitInfo');
    dom.themeToggle = document.getElementById('themeToggle');
    dom.loadingProgress = document.getElementById('loadingProgress');
    dom.loadingProgressBar = document.getElementById('loadingProgressBar');
    dom.loadingProgressText = document.getElementById('loadingProgressText');
    dom.loadingTitle = document.getElementById('loadingTitle');
    dom.loadingMessage = document.getElementById('loadingMessage');
}
