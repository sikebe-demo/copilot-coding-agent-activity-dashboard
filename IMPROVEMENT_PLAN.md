# 改善計画 (Improvement Plan)

> **作成日**: 2026-02-12
> **対象リポジトリ**: copilot-coding-agent-activity-dashboard
> **レビュー方法**: セキュリティ / パフォーマンス / アクセシビリティ・UX / コード品質・設計 / テスト品質 — 5ペルソナ並列分析

---

## 総合評価サマリー

| 観点 | Critical | High | Medium | Low | Info | 評価 |
|:---|:---:|:---:|:---:|:---:|:---:|:---:|
| セキュリティ | 0 | 0 | 1 | 2 | 3 | **A** |
| パフォーマンス | 0 | 3 | 5 | 4 | 0 | **B** |
| アクセシビリティ/UX | 2 | 3 | 6 | 2 | 0 | **C+** |
| コード品質/設計 | 0 | 3 | 7 | 3 | 2 | **B+** |
| テスト品質 | 0 | 3 | 7 | 5 | 2 | **B+** |

---

## 全指摘事項一覧

### セキュリティ

| ID | 重大度 | 問題 | ファイル | 詳細 |
|:---|:---|:---|:---|:---|
| SEC-1 | Medium | CSP メタタグ未設定 | `index.html` | `<head>` に `Content-Security-Policy` がなく、XSS 発生時の多層防御が欠如 |
| SEC-2 | Low | トークン入力に `autocomplete="off"` なし | `index.html` (`#tokenInput`) | ブラウザがトークン値を記憶・自動補完する可能性がある |
| SEC-3 | Low | `displayRateLimitInfo` の巨大 innerHTML | `app.ts` | 現在は安全だが、将来の変更で外部入力混入時に XSS リスク。DOM API 移行を推奨 |
| SEC-4 | Info | `Permissions-Policy` / `X-Frame-Options` ヘッダ欠如 | ホスティング設定 | GitHub Pages では設定困難だが、自己ホスティング時は要対応 |
| SEC-5 | Info | 依存関係のバージョン範囲指定（`^`） | `package.json` | `npm ci` + lockfile の運用確認。Dependabot / Renovate の導入推奨 |
| SEC-6 | Info | localStorage キャッシュデータの範囲 | `lib.ts` | 公開データのみ保存で問題ないが、同一オリジン・拡張機能からアクセス可能である点を認識 |

### パフォーマンス

| ID | 影響度 | 問題 | ファイル | 詳細 |
|:---|:---|:---|:---|:---|
| PERF-1 | High | `chart.js/auto` のフルバンドルインポート | `app.ts` L2 | 棒グラフのみ使用なのに全コンポーネントを登録。JS バンドルの大部分（180-200KB / 237.90KB）が未使用 |
| PERF-2 | High | 未使用の `lucide` 依存関係 | `package.json` | コード上でインポートされていないが `dependencies` に存在。`npm install` 時に不要なダウンロード |
| PERF-3 | High | コード分割の欠如 | `vite.config.ts` | 全コードが単一 JS バンドル（237.90KB）に出力。Chart.js は初期表示に不要 |
| PERF-4 | Medium | `displayPRList` の DOM 操作効率 | `app.ts` | ページ切替のたびに全子要素破棄 → ループ内 createElement → innerHTML → querySelectorAll → replaceWith → appendChild |
| PERF-5 | Medium | `displayRateLimitInfo` の大規模 innerHTML 書き換え | `app.ts` | 約50行のHTML文字列を毎回パース・構築 |
| PERF-6 | Medium | `updateFilterButtonStyles` のクラス操作量 | `app.ts` | 4ボタン × 42クラスの spread remove が毎回発生 |
| PERF-7 | Medium | `displayPagination` の毎回再構築 | `app.ts` | ページ切替のたびにUI全体を `innerHTML = ''` で破棄し完全再構築 |
| PERF-8 | Medium | `backdrop-blur-xl` の描画コスト | `style.css` (`.glass-card`) | スクロール時に GPU 合成が必要。低スペック端末でジャンク原因 |
| PERF-9 | Low | API preconnect ヒントの欠如 | `index.html` | DNS 解決・TLS ハンドシェイクの事前処理なし |
| PERF-10 | Low | `getElementById` の重複呼び出し | `app.ts` | 同じ要素を複数関数で毎回取得 |
| PERF-11 | Low | localStorage の大量データ読み書き | `lib.ts` | `clearOldCache` で毎回全キーイテレート + `JSON.parse` |
| PERF-12 | Low | `bg-pattern` のパフォーマンス影響 | `style.css` | 2つの `linear-gradient` を `body` に適用。リペイント時に再計算 |

### アクセシビリティ / UX

| ID | 重大度 | WCAG | Level | 問題 | ファイル |
|:---|:---|:---|:---|:---|:---|
| A11Y-1 | Critical | 4.1.3 | AA | エラー表示がスクリーンリーダーに通知されない（`role="alert"` 欠如） | `index.html` `#error` |
| A11Y-2 | Critical | 1.1.1 | A | チャート (Canvas) にフォールバック・aria-label なし | `app.ts` `displayChart()` |
| A11Y-3 | High | 2.4.1 | A | スキップリンクの欠如 | `index.html` |
| A11Y-4 | High | 1.3.1 / 4.1.2 | A | ページネーションのアクセシビリティ不足（`<nav>`, `aria-current`, `aria-label` 欠如） | `app.ts` `displayPagination()` |
| A11Y-5 | High | 4.1.3 | AA | 結果表示時のスクリーンリーダー通知欠如 | `app.ts` `displayResults()` |
| A11Y-6 | Medium | 4.1.2 | A | テーマ切替ボタンが現在の状態を伝えない | `index.html` / `app.ts` |
| A11Y-7 | Medium | 1.1.1 | A | 装飾 SVG に `aria-hidden="true"` 未設定 | `index.html` / `lib.ts` |
| A11Y-8 | Medium | 2.1.1 | A | PR カード `role="link"` で Space キー未対応 | `app.ts` `displayPRList()` |
| A11Y-9 | Medium | 1.3.1 | A | Merge Rate バーに `role="meter"` / ARIA 属性なし | `index.html` `#mergeRateBar` |
| A11Y-10 | Medium | 2.5.8 | AA | タッチターゲットサイズ不足（プリセットボタン ~24px / フィルターボタン ~28px） | `index.html` |
| A11Y-11 | Medium | 1.4.1 | A | チャートが色のみに依存した情報伝達 | `app.ts` Chart.js config |
| A11Y-12 | Low | 1.3.1 | A | トークン入力の説明テキストが `aria-describedby` で紐付いていない | `index.html` |
| A11Y-13 | Low | 1.4.3 | AA | グラデーションテキストのコントラスト比が不明確 | `style.css` / `index.html` |

### コード品質 / アーキテクチャ

| ID | 重大度 | 問題 | ファイル | 詳細 |
|:---|:---|:---|:---|:---|
| ARCH-1 | High | `app.ts` が約550行で複数責務を担っている | `app.ts` | API通信・キャッシュ制御・UI状態管理・Chart.js描画・ページネーション・フィルターが混在 |
| ARCH-2 | High | `displayRateLimitInfo` の60行HTMLテンプレートリテラル | `app.ts` | ロジックとテンプレートが密結合。テスト不能 |
| ARCH-3 | High | `updateFilterButtonStyles` のTailwindクラス手動管理 | `app.ts` | 5箇所（`allColorClasses`, `allHoverClasses`, `activeStyles`, `inactiveStyle`, `hoverStyles`）の同期が必要 |
| ARCH-4 | Medium | 6つのグローバル `let` 変数による状態管理 | `app.ts` L35-50 | 状態間の依存関係が暗黙的 |
| ARCH-5 | Medium | `fetch` の `AbortController` 未使用 | `app.ts` | 古いリクエストは無視されるが HTTP リクエスト自体はキャンセルされない |
| ARCH-6 | Medium | `fetchAllPRCounts` の4並列APIリクエストのレートリミットリスク | `app.ts` | メイン検索と合わせて最大5リクエスト/操作 |
| ARCH-7 | Medium | `displayPRList` 内の過大な DOM 操作 | `app.ts` | `generatePRItemHtml` にリンク有無パラメータを追加して事前制御すべき |
| ARCH-8 | Medium | チャートカラーのハードコード重複 | `app.ts` | `displayChart` と `updateChartTheme` で同じ色コードが散在 |
| ARCH-9 | Medium | `CacheEntry` のバリデーション不足 | `lib.ts` | `JSON.parse` 結果を型キャストで信頼。型ガード関数がない |
| ARCH-10 | Medium | `lucide` 依存が未使用 | `package.json` | = PERF-2 と同一 |
| ARCH-11 | Low | `getElementById` の繰り返しパターン | `app.ts` | DOMContentLoaded 時にキャッシュ推奨 |
| ARCH-12 | Low | `PRFilterStatus` の型定義が間接的 | `lib.ts` | `keyof StatusConfigMap` → 直接記述のほうが可読性高い |
| ARCH-13 | Low | `@types/node` がフロントエンドプロジェクトに含まれる | `package.json` | Vite 設定ファイル用のみ。本来不要 |
| ARCH-14 | Info | `tsconfig.json` の `include` が `["*.ts"]` のみ | `tsconfig.json` | ディレクトリ移動時に対象外になるリスク |
| ARCH-15 | Info | `vitest.config.ts` の `globals: true` と明示的 import の不整合 | `vitest.config.ts` | テストファイルで毎回 `import { describe, it, expect }` しているなら `globals: true` は不要、またはその逆 |

### テスト品質

| ID | 重大度 | 問題 | ファイル | 詳細 |
|:---|:---|:---|:---|:---|
| TEST-1 | High | `incomplete_results: true` のテストが E2E/ユニット共に欠如 | `app.ts` / E2E | API が `incomplete_results: true` を返した場合のエラースロー未検証 |
| TEST-2 | High | `validateDateRange` が無効な日付文字列を検証しない + テスト不足 | `lib.ts` / `validation.test.ts` | `new Date('invalid')` → `Invalid Date` → 比較は常に `false` でエラーなし通過 |
| TEST-3 | High | `adjustClosedCount` の `merged > closed` 境界値テスト欠如 | `pr-logic.test.ts` | `Math.max(0, closed - merged)` のガードが未テスト |
| TEST-4 | Medium | E2E の `waitForTimeout(500)` によるフレイキーリスク | `filter.spec.js` (5箇所) | 固定タイムアウト → DOM 変化の直接待機に置換推奨 |
| TEST-5 | Medium | `loading-progress.spec.js` のタイミング依存テスト | `loading-progress.spec.js` | 中間ローディング状態が人工的遅延に依存 |
| TEST-6 | Medium | `getPageNumbersToShow` の `total=0` / `total=1` 未テスト | `pr-logic.test.ts` | エッジケース |
| TEST-7 | Medium | `prepareChartData` の空文字列日付レンジ未テスト | `pr-logic.test.ts` | `else` ブランチのカバレッジ |
| TEST-8 | Medium | `filterPRs` の特殊文字入力テスト不足 | `filter.test.ts` | 正規表現メタ文字・Unicode 文字 |
| TEST-9 | Medium | `escapeHtml` の数値入力テスト | `security.test.ts` | `String(text)` 変換の実行時ケース |
| TEST-10 | Medium | E2E キャッシュテストのリクエスト数マジックナンバー | `cache.spec.js` L35 | `expect(counter.getCount()).toBe(5)` がハードコード |
| TEST-11 | Low | vitest にカバレッジ閾値が未設定 | `vitest.config.ts` | カバレッジ低下を CI で検知できない |
| TEST-12 | Low | `createRatioHtml` の境界値テスト不足 | `pr-logic.test.ts` | 負の数・`MAX_SAFE_INTEGER` |
| TEST-13 | Low | `sanitizeUrl` のクエリパラメータ/フラグメント付き URL 未テスト | `security.test.ts` | `?param=value` / `#fragment` パターン |
| TEST-14 | Low | Playwright ブラウザが Chromium のみ | `playwright.config.ts` | ブラウザ互換性リスク |
| TEST-15 | Low | `formatCountdown` の0秒ちょうどの境界値テスト欠如 | `rate-limit.test.ts` | リセットタイムスタンプ == 現在時刻 |
| TEST-16 | Info | `rendering.test.ts` が globals に依存（他ファイルと import 方式不一致） | `rendering.test.ts` | 一貫性のため明示的 import 推奨 |
| TEST-17 | Info | `buildSearchUrl` テストで URL 全体の完全性検証がない | `rendering.test.ts` | 部分一致のみ |

---

## 実装プラン（STEP 順）

### STEP 1: 即座に対応 — Critical + 労力極小の改善

> **目標**: WCAG Critical 2件 + 労力極小の High/Medium 改善を一括対応
> **想定作業時間**: 1〜2 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 1-1 | A11Y-1 | `index.html` の `#error` 要素に `role="alert" aria-live="assertive"` を追加 |
| 1-2 | A11Y-2 | `app.ts` `displayChart()` で canvas に `role="img"` + `aria-label` + テキストフォールバック追加 |
| 1-3 | PERF-2 / ARCH-10 | `npm uninstall lucide` で未使用依存を削除 |
| 1-4 | SEC-2 | `index.html` の `#tokenInput` に `autocomplete="off"` 追加 |
| 1-5 | A11Y-3 | `index.html` の `<body>` 直後にスキップリンクを追加 |
| 1-6 | PERF-9 | `index.html` `<head>` に `<link rel="preconnect" href="https://api.github.com" crossorigin>` 追加 |
| 1-7 | SEC-1 | `index.html` `<head>` に CSP メタタグ追加 |
| 1-8 | A11Y-12 | `#tokenInput` に `aria-describedby="tokenDescription"` を追加し、説明文に `id="tokenDescription"` を付与 |

---

### STEP 2: アクセシビリティ High/Medium — WCAG 準拠に向けた重点改善

> **目標**: High 3件 + Medium の A11Y 改善を一括対応
> **想定作業時間**: 2〜3 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 2-1 | A11Y-4 | `displayPagination()` を `<nav aria-label="PR list pagination">` でラップ。前/次ボタンに `aria-label="Previous page"` / `"Next page"`。現在ページに `aria-current="page"`。各ページボタンに `aria-label="Page N"` |
| 2-2 | A11Y-5 | `showResults()` で結果表示時に `aria-live="polite"` の status region を動的追加し、PR件数を通知 |
| 2-3 | A11Y-6 | `toggleTheme()` と `initializeTheme()` でテーマ切替ボタンの `aria-label` に現在状態を反映（例: `"Switch to dark mode (currently light mode)"`） |
| 2-4 | A11Y-7 | `index.html` と `lib.ts` (`PR_STATUS_CONFIG`) 内の装飾 SVG に `aria-hidden="true"` を追加。情報を持つ SVG には `role="img"` + `aria-label` |
| 2-5 | A11Y-8 | `displayPRList()` の keydown ハンドラに `e.key === ' '` （Space キー）対応を追加 |
| 2-6 | A11Y-9 | `index.html` の `#mergeRateBar` に `role="meter" aria-label="Merge success rate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"` を追加。`displayResults()` で `aria-valuenow` を更新 |
| 2-7 | A11Y-10 | プリセットリポジトリボタン・フィルターボタンに `min-h-[44px]` を追加しタッチターゲットサイズを確保 |

---

### STEP 3: パフォーマンス — バンドルサイズ大幅削減

> **目標**: JS バンドルサイズを 237KB → ~80KB 以下に削減
> **想定作業時間**: 2〜3 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 3-1 | PERF-1 | `chart.js/auto` → 個別コンポーネント import に変更（`BarController`, `BarElement`, `CategoryScale`, `LinearScale`, `Tooltip`, `Legend` のみ登録） |
| 3-2 | PERF-3 | Chart.js を動的 `import()` に変更してコード分割を実現。`vite.config.ts` に `manualChunks: { chartjs: ['chart.js'] }` 追加 |
| 3-3 | PERF-8 | `.glass-card` の `backdrop-blur-xl` を `backdrop-blur-sm` に軽減（特にヘッダー）。`@media (prefers-reduced-motion)` で blur 無効化 |

---

### STEP 4: テスト品質 — カバレッジギャップの解消

> **目標**: High 3件 + Medium のテストギャップを埋める
> **想定作業時間**: 2〜3 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 4-1 | TEST-2 | `validateDateRange` に無効日付文字列の検証ロジック追加 + テスト `'should return error for invalid date strings'` |
| 4-2 | TEST-3 | `adjustClosedCount` の `merged > closed` テスト追加: `'should clamp to 0 when merged count exceeds closed count'` |
| 4-3 | TEST-1 | E2E テスト追加: `'should show error when API returns incomplete_results: true'` |
| 4-4 | TEST-6 | `getPageNumbersToShow` テスト追加: `total=0` → 空配列、`total=1` → `[1]` |
| 4-5 | TEST-7 | `prepareChartData` テスト追加: `fromDate='', toDate=''` の else ブランチ |
| 4-6 | TEST-8 | `filterPRs` テスト追加: 正規表現メタ文字 (`.*+?`) / Unicode 文字列 |
| 4-7 | TEST-15 | `formatCountdown` テスト追加: リセット == 現在時刻の境界値 |
| 4-8 | TEST-13 | `sanitizeUrl` テスト追加: `?param=value` / `#fragment` 付き URL |
| 4-9 | TEST-4 | `filter.spec.js` の `waitForTimeout(500)` 5箇所を DOM 変化待機に置換 |
| 4-10 | TEST-11 | `vitest.config.ts` にカバレッジ設定追加: `coverage: { provider: 'v8', thresholds: { statements: 80, branches: 75, functions: 80 } }` |

---

### STEP 5: コード品質 — 状態管理・エラーハンドリング改善

> **目標**: グローバル状態の整理と HTTP リクエスト効率改善
> **想定作業時間**: 2〜3 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 5-1 | ARCH-5 | `AbortController` を導入し、新しい検索実行時に前回の fetch をキャンセル |
| 5-2 | ARCH-4 | 6つのグローバル `let` 変数を `AppState` オブジェクトに集約 |
| 5-3 | ARCH-9 | `lib.ts` に `isCacheEntry()` 型ガード関数を追加し、`getFromCache` で使用 |
| 5-4 | ARCH-6 | `fetchAllPRCounts` のリクエスト数削減: `total` - `merged` - `open` = `closed` で計算し API 呼出しを 4 → 3 に削減 |
| 5-5 | ARCH-12 | `PRFilterStatus` を `'all' | 'merged' | 'closed' | 'open'` と直接記述に変更 |

---

### STEP 6: コード品質 — 定数抽出・重複排除

> **目標**: マジックナンバーの定数化、テンプレートの関数化
> **想定作業時間**: 2〜3 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 6-1 | ARCH-8 | `lib.ts` に `CHART_COLORS` / `CHART_THEME` 定数を定義し、`displayChart` / `updateChartTheme` から参照 |
| 6-2 | ARCH-3 | `lib.ts` に `FILTER_STYLE_MAP` / `FILTER_INACTIVE_STYLE` を定義。`allColorClasses` を自動導出 |
| 6-3 | ARCH-2 | `displayRateLimitInfo` の HTML テンプレートを `lib.ts` の純粋関数 `generateRateLimitHtml()` に移動 |
| 6-4 | ARCH-11 / PERF-10 | DOMContentLoaded 時に DOM 要素参照をキャッシュし、各関数で再利用 |

---

### STEP 7: DOM 操作の効率化

> **目標**: ページ切替・フィルター操作時のレンダリングパフォーマンス改善
> **想定作業時間**: 3〜4 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 7-1 | PERF-4 / ARCH-7 | `displayPRList` で `DocumentFragment` を使ったバッチ追加に変更 |
| 7-2 | PERF-4 | PR リスト (`#prList`) に対するイベント委譲（Event Delegation）で click/keydown リスナーを1つに集約 |
| 7-3 | ARCH-7 | `generatePRItemHtml` に `isInteractive: boolean` パラメータを追加し、リンク有無を事前制御。`querySelectorAll` + `replaceWith` ループを廃止 |
| 7-4 | PERF-5 | レートリミット UI をテンプレートとして `index.html` に定義し、`textContent` / `style` の部分更新のみに変更 |
| 7-5 | PERF-6 | フィルターボタンのスタイル切替を `data-active` 属性 + CSS セレクター方式に変更 |
| 7-6 | PERF-7 | ページネーションの差分更新: ボタンの `disabled` / `textContent` / アクティブクラスのみ更新 |

---

### STEP 8: アーキテクチャ — モジュール分割

> **目標**: `app.ts` の責務分離で保守性・テスタビリティ向上
> **想定作業時間**: 4〜6 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 8-1 | ARCH-1 | `app.ts` を以下のモジュールに分割: |
| | | - `src/api/fetchCopilotPRs.ts` — API 通信 + キャッシュ呼び出し |
| | | - `src/ui/chart.ts` — Chart.js 生成・テーマ更新 |
| | | - `src/ui/pagination.ts` — ページネーション DOM 生成 |
| | | - `src/ui/filterButtons.ts` — フィルターボタンスタイル管理 |
| | | - `src/ui/loading.ts` — ローディング状態管理 |
| | | - `src/ui/rateLimitDisplay.ts` — レートリミット表示 |
| | | - `app.ts` — エントリポイント（イベント登録のみ） |
| 8-2 | ARCH-14 | `tsconfig.json` の `include` を `["**/*.ts"]` に変更 |
| 8-3 | ARCH-13 | `@types/node` の必要性を再評価。不要なら削除 |

---

### STEP 9: テスト・CI 強化

> **目標**: テスト安定性とブラウザカバレッジの向上
> **想定作業時間**: 1〜2 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 9-1 | TEST-5 | `loading-progress.spec.js` のタイミング依存テストを最終状態検証中心に見直し |
| 9-2 | TEST-10 | `cache.spec.js` の API コール数マジックナンバーを定数化または `toBeGreaterThan(0)` に変更 |
| 9-3 | TEST-14 | `playwright.config.ts` で CI 時に Firefox を追加（`process.env.CI` 分岐） |
| 9-4 | TEST-16 | `rendering.test.ts` に `import { describe, it, expect } from 'vitest'` を追加して一貫性確保 |
| 9-5 | ARCH-15 | `vitest.config.ts` の `globals: true` と明示的 import の方針を統一 |

---

### STEP 10: 低優先度の改善

> **目標**: アクセシビリティの細部改善、情報レベルの指摘対応
> **想定作業時間**: 1〜2 時間

| # | 対象 ID | 作業内容 |
|:---|:---|:---|
| 10-1 | A11Y-11 | チャートに `chartjs-plugin-pattern` またはボーダースタイル差別化を導入し、色以外での情報伝達を追加 |
| 10-2 | A11Y-13 | `.gradient-text` のコントラスト比を検証し、必要に応じてフォールバック色を追加 |
| 10-3 | PERF-11 | `clearOldCache` の実行間隔制限（最終クリーン時刻チェック）を導入 |
| 10-4 | PERF-12 | `bg-pattern` をパフォーマンス計測結果に応じて画像に置換検討 |
| 10-5 | SEC-4 | 自己ホスティング移行時の `X-Frame-Options` / `Permissions-Policy` 設計メモ作成 |
| 10-6 | SEC-5 | Dependabot / Renovate 設定ファイル（`.github/dependabot.yml`）追加 |
| 10-7 | SEC-3 | `displayRateLimitInfo` の DOM API 移行（STEP 7-4 で部分対応済み） |
| 10-8 | TEST-9 | `escapeHtml` の数値入力テスト追加 |
| 10-9 | TEST-12 | `createRatioHtml` の負値・巨大数テスト追加 |
| 10-10 | TEST-17 | `buildSearchUrl` の URL パース完全性テスト追加 |

---

## STEP 別 総合ロードマップ

```
STEP 1  ■■          (1-2h)  Critical + 労力極小  ← 最優先
STEP 2  ■■■         (2-3h)  A11Y High/Medium
STEP 3  ■■■         (2-3h)  バンドルサイズ削減
STEP 4  ■■■         (2-3h)  テストギャップ解消
STEP 5  ■■■         (2-3h)  状態管理・エラー改善
STEP 6  ■■■         (2-3h)  定数化・重複排除
STEP 7  ■■■■        (3-4h)  DOM 操作効率化
STEP 8  ■■■■■       (4-6h)  モジュール分割
STEP 9  ■■          (1-2h)  テスト・CI 強化
STEP 10 ■■          (1-2h)  低優先度改善
                    ─────────
                    合計: 20-29 時間
```

> **推奨**: STEP 1〜4 を優先的に実施（約8〜11時間）。これにより WCAG AA 準拠に大きく近づき、バンドルサイズを60%以上削減し、テストの信頼性を向上させることができます。
