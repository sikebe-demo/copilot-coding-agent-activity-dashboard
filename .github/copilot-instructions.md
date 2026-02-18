# Copilot Instructions

## Project Overview
Single-page TypeScript dashboard for analyzing GitHub Copilot Coding Agent PRs. Uses GitHub GraphQL API (with REST Search API fallback) via query `author:app/copilot-swe-agent`, displays statistics with Chart.js, and supports dark mode with localStorage persistence.

## Architecture
- **Modular structure**: `app.ts` (orchestration), `lib.ts` (pure functions/types/constants), `src/api.ts` (API calls), `src/state.ts` (state management), `src/ui/*.ts` (UI modules)
- **No framework**: Vanilla TypeScript with DOM manipulation, bundled by Vite
- **Static files**: `index.html` (Tailwind-based UI), `style.css` (custom utilities)
- **Build output**: `dist/` folder for GitHub Pages deployment at `/copilot-coding-agent-activity-dashboard/`

## Key Patterns

### GitHub API Integration — Hybrid GraphQL/REST
The app uses a **hybrid API strategy**:
- **With token**: GraphQL API (`POST https://api.github.com/graphql`) — combines Copilot PRs + all PR counts in a single request. Rate limit: 5,000 points/hour.
- **Without token**: REST Search API (`GET https://api.github.com/search/issues`) — fallback for unauthenticated users. Rate limit: 10 req/min.

```typescript
// GraphQL combined query fetches Copilot PRs + repo-wide counts in 1 request
// See GRAPHQL_COMBINED_QUERY and GRAPHQL_SEARCH_QUERY in lib.ts
// Routing logic in src/api.ts: fetchCopilotPRsWithCache() → fetchWithGraphQL() or fetchCopilotPRsWithSearchAPI()
```

Key API functions in `src/api.ts`:
- `executeGraphQL<T>()` — generic GraphQL POST executor with error handling
- `fetchWithGraphQL()` — combined query on page 1, simple search for pagination
- `fetchCopilotPRsWithSearchAPI()` — REST fallback
- `fetchComparisonData()` — routes to GraphQL or REST based on token
- `convertGraphQLPRs()` / `convertGraphQLRateLimit()` — conversion utilities in `lib.ts`

### Rate Limit Display
- GraphQL detected by `info.limit >= 100` — shows "GitHub GraphQL API", "points this hour"
- REST detected by `info.limit < 100` — shows "GitHub Search API", "requests this minute"

### TypeScript Conventions
- Strict mode enabled with `noUnusedLocals`, `noUnusedParameters`
- Types defined in `lib.ts` (e.g., `PullRequest`, `CacheEntry`, `RateLimitInfo`, `GraphQLResponse`, `GraphQLSearchResult`)
- DOM elements accessed via `getElementById()` with null checks and type assertions

### CSS Architecture
- Tailwind CSS v4 with PostCSS
- Dark mode via `.dark` class on `<html>` (not media query)
- Custom components in `style.css`: `.glass-card`, `.gradient-text`, `.bg-pattern`

## Development Commands
```bash
npm run dev        # Vite dev server at localhost:8080
npm run build      # Production build to dist/
npm test           # Playwright E2E tests (chromium only by default)
npm run test:ui    # Interactive test UI
npx vitest         # Unit tests (vitest)
```

## Testing Approach

### Unit Tests (Vitest)
- Located in `unit-tests/*.test.ts`
- Test files: `validation.test.ts`, `cache.test.ts`, `filter.test.ts`, `pr-logic.test.ts`, `rate-limit.test.ts`, `rendering.test.ts`, `response-time.test.ts`, `security.test.ts`, `graphql.test.ts`
- `graphql.test.ts` tests `convertGraphQLPRs()` and `convertGraphQLRateLimit()` conversion functions

### E2E Tests (Playwright)
- Located in `tests/*.spec.js` with shared helpers in `tests/helpers.js`
- Mock GitHub API via `page.route()` — helper functions:
  - **REST**: `mockSearchAPI()`, `mockSearchAPIWithCounter()`, `createSearchResponse()`
  - **GraphQL**: `mockGraphQLAPI()`, `createGraphQLCombinedResponse()`, `createGraphQLSearchResponse()`
- Tests run against dev server (`baseURL: 'http://localhost:8080'`)
- Clear `localStorage` in `beforeEach` to ensure clean state

### Test Helpers (reuse these patterns)
```javascript
// Create PR test data
const prs = createPRs([
  { title: 'Fix bug', state: 'closed', merged_at: '2024-01-15' },
  { title: 'Add feature', state: 'open' }
]);

// Mock REST API response (no token)
await mockSearchAPI(page, { prs });

// Mock GraphQL API response (with token)
await mockGraphQLAPI(page, { prs, allPRCounts: { total: 100, merged: 80, open: 20 } });
```

## Important Constraints
- **Search API limit**: Max 1000 results (10 pages × 100). Show error if exceeded.
- **No backend**: All API calls from browser; token stored only in memory
- **Cache key includes auth**: Separate cache for authenticated vs unauthenticated requests
- **Input validation**: `isValidGitHubName()` prevents path traversal in repo names

## Lazy Loading Comparison Data
Both paths fetch all data (Copilot PRs + comparison data) in the initial request:
- **With token (GraphQL)**: The combined query fetches Copilot PRs + all PR counts + all merged PRs in **a single request** (1 API call).
- **Without token (REST)**: Fetches Copilot PRs (~1-2 calls) then comparison data inline via `Promise.all` — `allPRCounts` (3 calls) + `allMergedPRs` (1 call). Total ~5 calls. If comparison fetch fails, results still display gracefully.

Relevant functions:
- `fetchCopilotPRsWithCache()` — routes to GraphQL or REST, fetches all data including comparison
- `fetchComparisonData()` — fallback for on-demand comparison loading (button still exists as graceful degradation)
- `updateCacheWithComparison()` — updates existing cache entry with comparison data

## Cache Versioning
When modifying `CacheEntry` schema (adding/removing/renaming fields), bump `CACHE_VERSION` in `lib.ts`:
```typescript
const CACHE_VERSION = 'v6';  // Increment to 'v7', 'v8', etc.
```
This invalidates old cached entries automatically. Current version: **v6** (inline comparison data for both GraphQL and REST).
