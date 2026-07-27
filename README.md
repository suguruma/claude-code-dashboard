# Claude Code Dashboard

Claude Code とのやり取りにおける「ルール」「スキル」「実行ログ／思考プロセス」をローカルで可視化・管理するダッシュボード。
Webアプリ側は重い処理を行わず、実際の `.claude/CLAUDE.md` / `.claude/skills/*/SKILL.md` / `execution_log.json` を直接
読み書きして描画するだけのCPUモード（外部API通信なし・コスト0円）で動作する。詳細は
[プロジェクト定義・開発仕様書](./docs/design-reference/Claude%20Code%20Dashboard%20プロジェクト定義・開発仕様書.txt) と
[docs/spec.md](./docs/spec.md)（実装版・こちらが最新）を参照。

## 実装済み機能

- **ルール管理**（`/rules`）— `CLAUDE.md` の `## 見出し` をルールとして直接パース。ON/OFFトグル（`<!-- CCD:DISABLED -->` で無効化）、追加/編集/削除、ドラッグ&ドロップによる表示順（=CLAUDE.mdの記載順）の並び替え、次回用プロンプト集（実行ログ由来）
- **スキル管理**（`/skills`）— `.claude/skills/*/SKILL.md` の一覧・追加・編集・削除・改名（ディレクトリ名変更。呼び出しコマンドが変わる旨を確認表示）・カテゴリ別グルーピング表示（frontmatterの`category`フィールドに基づく表示上の分類。実ファイルはフラット配置のまま）・成熟度バッジ（`references`/`scripts`/`evals`サブフォルダの有無を表示）
- **メモリ管理**（`/memory`）— `.claude/projects/*/memory/*.md`（AIメモリシステム）の一覧・閲覧。type別（user/feedback/project/reference）フィルタ。読み取り専用
- **タスク実行履歴**（`/tasks`）— `.claude/tasks/<session-id>/*.json` をセッション別に進捗バー・ステータスアイコン付きで可視化。読み取り専用
- **設定 & システム情報**（`/settings`）— `settings.json`（権限モード・環境変数・statusLine）/ バックアップ履歴 / ブロック済みプラグイン一覧をTabsで表示。読み取り専用
- **移行（エクスポート/インポート）**（`/migrate`）— ルール・スキルを1つのJSONファイルに書き出し、他のPC（別プロジェクト）に差分プレビュー付きで取り込む。上書き前に自動バックアップ
- **セッション監視**（`/session-monitor`）— `~/.claude/projects/*/*.jsonl`（Claude Codeの実行ログ）を解析し、トークン消費推移・ツール呼び出し集計・MCPサーバー別呼び出し・スキル/サブエージェント発火状況・ツール出力サイズランキング・コンテキスト圧縮（コンパクション）履歴を可視化。ダッシュボードのプロジェクト登録とは独立し、このマシンで実行された全セッションが対象。自動更新トグルで3秒間隔のポーリングにも対応。読み取り専用
- **実行ログ & 思考プロセス可視化**（`/trace`）— エージェント議論・合意度メーター・トレードオフ比較・介入ハイライト・次回用プロンプトのワンクリック保存。マルチエージェント構成図（指揮系統の肩書きはログごとに指定可能。無指定ならフラットなチーム編成として表示）と試行錯誤・リトライのタイムラインにも対応。`execution_log.json`自体は本ダッシュボードは生成せず、Claude Code側のスキル（5役体制の`autonomous-production-team`、または通常の会話を事後的に記録する`session-log-extractor`）が書き出す。書き出し先はスキルを実行した作業ディレクトリになるため、ページ上部の「分析対象プロジェクト」セレクター（TopBarの選択中プロジェクトとは独立、登録済みプロジェクトから選択）で見たいプロジェクトを切り替える。ルール保存先（CLAUDE.md）はTopBarの選択中プロジェクト側になる
- **使い方ガイド**（`/help`）— 初心者向けの用語集・各ページの使い方・FAQをまとめた解説ページ。サイドバー下部に常時リンクを表示
- **ルール整理**（`/refactor`）— Claude Code標準スキル`rule-optimizer`（execution_log.jsonの過去のユーザー介入履歴から矛盾・重複ルールを学習）が出力する`rule_refactor_proposal.json`を読み込み、現在のCLAUDE.mdとのDiffプレビュー・ステイル検知（提案生成後の編集を検知）・選択適用（バックアップ付き）を行う。ローカルLLM（GPUモード）連携構想は方針転換により廃止し、このスキル連携方式に統一した。`/trace`と同様、ページ上部の「分析対象プロジェクト」セレクターがTopBarの選択中プロジェクトとは独立しており、適用先のCLAUDE.mdもこのセレクターで選んだプロジェクトになる
- 複数プロジェクトの横断管理（画面右上のプロジェクトスイッチャー。実際の `~/.claude` をプロジェクトとして登録することも可能）
- ライト/ダーク/システム追従のテーマ切替（TopBar右側）

メモリ管理・タスク実行履歴・設定/バックアップ/プラグイン・セッション監視は全て読み取り専用（編集・復元は次回以降のスコープ）。
移行機能はルール・スキルのみが対象で、settings.jsonの環境変数などは含まない。

ナビゲーションは左サイドバーに「設定管理」「分析・振り返り」「ツール」のカテゴリでグループ化されている。
サイドバー下部のボタンでアイコンのみの表示に折りたためる。

残課題・今後の実装候補は [TODO.md](./TODO.md) を参照。

## セットアップ

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開く。初回は `sample-data/` を対象にしたサンプルプロジェクトが登録済み。

画面右上の「+」から、`CLAUDE.md`（と任意で `skills/`, `execution_log.json`）を配置している任意の Claude Code
プロジェクト、または実際の `~/.claude` フォルダのルートパスを登録すると、そのプロジェクトを切り替えて管理できる。
パスはディレクトリツリーを辿って選択でき（フォルダ名クリックで選択、シェブロンクリックでインライン展開）、
`CLAUDE.md` / `skills` 等の検出対象には自動でバッジが付く。手入力も可能。

選択中プロジェクトの右隣の鉛筆アイコンから、登録名・パスの編集やダッシュボードからの登録解除（削除）ができる。
実際のフォルダやファイルが削除されるわけではなく、`config/projects.json` 上の登録情報のみが変更される。

> **注意**：`~/.claude` のような実際の設定フォルダを登録すると、本アプリからのトグル/追加/編集/削除がそのまま本番の
> `CLAUDE.md` / `SKILL.md` に書き込まれる。書き込み系の操作を試す際は `sample-data` プロジェクトに切り替えることを推奨する。

`config/projects.json` は個人環境の絶対パスを含むため `.gitignore` 対象。テンプレートは `config/projects.example.json` を参照。

## Windows向け配布用exeのビルド

Electron + electron-builder で、インストール不要のポータブルexe（1ファイル）にパッケージできる。

```bash
npm run dist:win
```

`release/ClaudeCodeDashboard-<version>-portable.exe` が生成される。実行すると、Next.jsのstandaloneサーバーを
Electronの内部プロセスとして起動し、ネイティブウィンドウでダッシュボードを表示する（外部ブラウザ不要）。

- 初回起動時のみ、`config/projects.example.json`（個人パスを含まないテンプレート）と `sample-data/` を、OSごとの
  ユーザーデータ領域（Windowsなら `%APPDATA%/claude-code-dashboard`）へ複製する。以後の登録・編集内容はすべて
  そこに永続化され、exe本体の再配布・上書きには影響されない。
- `electron/main.js` が起動処理の実体。`electron-builder.yml` の `extraResources` で、実行に必要な
  `.next/standalone`（node_modules・サーバー本体）と上記の初期データのみを明示的に同梱している
  （`config/projects.json` 等、`.gitignore` 対象の個人データは同梱しない）。
- コード署名は行っていないため、初回実行時にWindows SmartScreenの警告が出る（「詳細情報」→「実行」で起動可能）。

## テスト・検証

```bash
npm test          # vitest によるlib層のユニットテスト（16ファイル・144件）
npx tsc --noEmit  # 型チェック
npx eslint .       # Lint
npm run build      # 本番ビルド
```

## ディレクトリ構成

```
src/
├── app/            # ページ & API Routes (App Router)、help/page.tsx（使い方ガイド）
├── components/     # UIコンポーネント (layout[SideNav/TopBar/ThemeToggle] / rules / skills / trace / ui / projects / memory / tasks / settings / migrate / sessionMonitor / refactor)、theme-provider.tsx
├── hooks/          # SWRベースのデータ取得フック
└── lib/            # ファイルI/O・CLAUDE.mdパーサー・スキル/実行ログ/メモリ/タスク履歴/設定/バックアップ/プラグイン/移行/セッション監視/ルール整理提案操作
config/
├── projects.json          # 監視対象プロジェクトの登録・選択状態（.gitignore対象）
└── projects.example.json  # コミット対象のテンプレート
sample-data/          # 自由記述形式のCLAUDE.md・サンプルスキル・settings.json・backups・pluginsを含むダミープロジェクト
docs/
├── spec.md                 # 仕様詳細・実装版（最新の一次情報）
├── plan.md                 # 開発時の判断記録（.gitignore対象・ローカルのみ。率直な指摘・自己批評を含むため非公開）
└── design-reference/       # 開発時に参照した設計原案（プロジェクト定義書・指示プロンプト・スキル一覧等）
TODO.md               # 優先度別の残課題バックログ
LICENSE                # MITライセンス
```

## ライセンス

[MIT License](./LICENSE)

> **要対応**：[LICENSE](./LICENSE) の著作権表示 `Copyright (c) 2026 [Your Name]` は仮の記載です。公開前に `[Your Name]` を実名またはGitHubユーザー名に置き換えてください。
