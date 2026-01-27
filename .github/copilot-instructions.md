# Copilot Instructions

## Project Overview
Single-page TypeScript dashboard for analyzing GitHub Copilot Coding Agent PRs. Fetches data via GitHub Search API (`author:app/copilot-swe-agent`), displays statistics with Chart.js, and supports dark mode with localStorage persistence.

## Architecture
- **Single entry point**: `app.ts` contains all application logic (~1000 lines) - API calls, caching, display, and chart rendering
- **No framework**: Vanilla TypeScript with DOM manipulation, bundled by Vite
- **Static files**: `index.html` (Tailwind-based UI), `style.css` (custom utilities)
- **Build output**: `dist/` folder for GitHub Pages deployment at `/copilot-coding-agent-activity-dashboard/`

## Key Patterns

### GitHub API Integration
```typescript
// Search query for Copilot Coding Agent PRs (app.ts)
const query = `repo:${owner}/${repo} is:pr author:app/copilot-swe-agent created:${fromDate}..${toDate}`;
```
- Use Search Issues API (`/search/issues`) not REST API for efficiency
- Handle rate limits via `X-RateLimit-*` headers
- Cache responses in localStorage with 5-minute TTL and `CACHE_VERSION` for invalidation

### TypeScript Conventions
- Strict mode enabled with `noUnusedLocals`, `noUnusedParameters`
- All types defined as interfaces at top of `app.ts` (e.g., `PullRequest`, `CacheEntry`, `RateLimitInfo`)
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
```

## Testing Approach
- E2E tests only in `tests/dashboard.spec.js` (Playwright)
- Mock GitHub API via `page.route()` - see helper functions `mockSearchAPI()`, `createSearchResponse()`
- Tests run against dev server (`baseURL: 'http://localhost:8080'`)
- Clear `localStorage` in `beforeEach` to ensure clean state

### Test Helpers (reuse these patterns)
```javascript
// Create PR test data
const prs = createPRs([
  { title: 'Fix bug', state: 'closed', merged_at: '2024-01-15' },
  { title: 'Add feature', state: 'open' }
]);

// Mock API response
await mockSearchAPI(page, { prs });
```

## Important Constraints
- **Search API limit**: Max 1000 results (10 pages × 100). Show error if exceeded.
- **No backend**: All API calls from browser; token stored only in memory
- **Cache key includes auth**: Separate cache for authenticated vs unauthenticated requests
- **Input validation**: `isValidGitHubName()` prevents path traversal in repo names

## Cache Versioning
When modifying `CacheEntry` schema (adding/removing/renaming fields), bump `CACHE_VERSION` in `app.ts`:
```typescript
const CACHE_VERSION = 'v2';  // Increment to 'v3', 'v4', etc.
```
This invalidates old cached entries automatically. Current version: **v2** (added `allPRCounts` field).
