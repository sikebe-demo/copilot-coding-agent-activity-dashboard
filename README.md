# Copilot Coding Agent PR Dashboard

GitHub Copilot Coding Agentが作成したPull Requestを分析・可視化する静的Webアプリケーションです。

🚀 **[Live Demo](https://sikebe-demo.github.io/copilot-coding-agent-activity-dashboard/)**

## 機能

- 📊 **統計サマリー**: マージ済・クローズ済・オープンPRの件数を表示
- 📈 **マージ率**: PR全体のマージ成功率を可視化
- 📅 **日別推移**: 日ごとのPR作成数をグラフで表示
- 📋 **PR一覧**: 全PRの詳細リストを表示
- 🌓 **ダークモード**: ライト/ダークテーマの切り替え対応
- 📱 **レスポンシブ**: モバイル・タブレット・デスクトップに対応

## 技術スタック

- **HTML5**: セマンティックなマークアップ
- **JavaScript (ES6+)**: モダンなJavaScript機能を使用
- **Tailwind CSS**: ユーティリティファーストCSSフレームワーク
- **Lucide Icons**: 美しいアイコンセット
- **Chart.js**: データ可視化ライブラリ
- **GitHub API**: リポジトリデータの取得

## 使い方

### GitHub Pagesでホストされたバージョンを使用

[https://sikebe-demo.github.io/copilot-coding-agent-activity-dashboard/](https://sikebe-demo.github.io/copilot-coding-agent-activity-dashboard/) にアクセスして、すぐに使用できます。

### ローカルで実行

1. ブラウザで `index.html` を開く
2. リポジトリ情報を入力（例: `microsoft/vscode`）
3. 分析期間を選択（開始日・終了日）
4. オプション: GitHub Personal Access Tokenを入力（API制限回避のため推奨）
5. 「分析開始」ボタンをクリック

### GitHub Personal Access Token（推奨）

API制限を回避し、プライベートリポジトリにアクセスするために、Personal Access Tokenの使用を推奨します。

1. [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)にアクセス
2. "Generate new token" をクリック
3. `repo` スコープを選択
4. トークンを生成してコピー
5. アプリケーションの「GitHub Personal Access Token」フィールドに貼り付け

## Copilot PRの検出方法

以下の条件でCopilot Coding Agentが作成したPRを判定します：

- **ユーザー名**: `copilot-workspace-helper`, `github-copilot`, `copilot`などを含む
- **タイトル・本文**: "copilot", "github copilot", "ai generated"などのキーワードを含む
- **ラベル**: "copilot"を含むラベルが付与されている

## デプロイ

### GitHub Pagesへの自動デプロイ

このリポジトリは、`main`ブランチへのプッシュ時に自動的にGitHub Pagesにデプロイされます。

1. リポジトリの Settings > Pages に移動
2. Source を "GitHub Actions" に設定
3. `main`ブランチにプッシュすると、自動的にデプロイされます

デプロイされたサイトは以下のURLで利用可能です：
`https://<username>.github.io/copilot-coding-agent-activity-dashboard/`

## ファイル構成

```
.
├── index.html      # メインHTMLファイル
├── app.js          # アプリケーションロジック
├── style.css       # カスタムスタイル
├── README.md       # プロジェクトドキュメント
├── package.json    # 依存関係とスクリプト
└── tests/          # E2Eテスト
    └── dashboard.spec.js
```

## 開発

### 前提条件

- Node.js 18以上
- npm または yarn

### セットアップ

```bash
# 依存関係のインストール
npm install

# E2Eテストの実行
npm test

# テストのデバッグモード
npm run test:debug

# 特定のブラウザでテスト
npm run test:chrome
npm run test:firefox
npm run test:webkit
```

### E2Eテスト

Playwrightを使用したE2Eテストが含まれています：

- フォーム入力のバリデーション
- GitHub APIとの連携
- データの可視化
- ダークモード切り替え
- レスポンシブデザイン

## ライセンス

MIT License

## 貢献

Pull Requestsを歓迎します！バグ報告や機能提案はIssuesで受け付けています。

## 作者

Created with ❤️ by GitHub Copilot