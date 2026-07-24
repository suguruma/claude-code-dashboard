# Claude Code Dashboard

Claude Code とのやり取りにおける「ルール」「スキル」「実行ログ／思考プロセス」をローカルで可視化・管理するダッシュボード。
Webアプリ側は重い処理を行わず、実際の `.claude/CLAUDE.md` / `.claude/skills/*/SKILL.md` / `execution_log.json` を直接
読み書きして描画するだけのCPUモード（外部API通信なし・コスト0円）で動作する。詳細は
[プロジェクト定義・開発仕様書](./Claude%20Code%20Dashboard%20プロジェクト定義・開発仕様書.txt) と
[docs/spec.md](./docs/spec.md)（実装版・こちらが最新）を参照。

## 実装済み機能

- **ルール管理**（`/rules`）— `CLAUDE.md` の `## 見出し` をルールとして直接パース。ON/OFFトグル（`<!-- CCD:DISABLED -->` で無効化）、追加/編集/削除、黄金プロンプト集（実行ログ由来）
- **スキル管理**（`/skills`）— `.claude/skills/*/SKILL.md` の一覧・追加・編集・削除
- **メモリ管理**（`/memory`）— `.claude/projects/*/memory/*.md`（AIメモリシステム）の一覧・閲覧。type別（user/feedback/project/reference）フィルタ。読み取り専用
- **タスク実行履歴**（`/tasks`）— `.claude/tasks/<session-id>/*.json` をセッション別に進捗バー・ステータスアイコン付きで可視化。読み取り専用
- **設定 & システム情報**（`/settings`）— `settings.json`（権限モード・環境変数・statusLine）/ バックアップ履歴 / ブロック済みプラグイン一覧をTabsで表示。読み取り専用
- **移行（エクスポート/インポート）**（`/migrate`）— ルール・スキルを1つのJSONファイルに書き出し、他のPC（別プロジェクト）に差分プレビュー付きで取り込む。上書き前に自動バックアップ
- **セッション監視**（`/session-monitor`）— `~/.claude/projects/*/*.jsonl`（Claude Codeの実行ログ）を解析し、トークン消費推移・ツール呼び出し集計・コンテキスト圧縮（コンパクション）履歴を可視化。ダッシュボードのプロジェクト登録とは独立し、このマシンで実行された全セッションが対象。自動更新トグルで3秒間隔のポーリングにも対応。読み取り専用
- **実行ログ & 思考プロセス可視化**（`/trace`）— エージェント議論・合意度メーター・トレードオフ比較・介入ハイライト・黄金プロンプトのワンクリック保存
- 複数プロジェクトの横断管理（画面右上のプロジェクトスイッチャー。実際の `~/.claude` をプロジェクトとして登録することも可能）

機能3（GPUモードによるルール矛盾・重複自動検出）は未実装（`/refactor` に導線のみ）。
メモリ管理・タスク実行履歴・設定/バックアップ/プラグイン・セッション監視は全て読み取り専用（編集・復元は次回以降のスコープ）。
移行機能はルール・スキルのみが対象で、settings.jsonの環境変数などは含まない。

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

> **注意**：`~/.claude` のような実際の設定フォルダを登録すると、本アプリからのトグル/追加/編集/削除がそのまま本番の
> `CLAUDE.md` / `SKILL.md` に書き込まれる。書き込み系の操作を試す際は `sample-data` プロジェクトに切り替えることを推奨する。

`config/projects.json` は個人環境の絶対パスを含むため `.gitignore` 対象。テンプレートは `config/projects.example.json` を参照。

## テスト・検証

```bash
npm test          # vitest によるlib層のユニットテスト（13ファイル・75件）
npx tsc --noEmit  # 型チェック
npx eslint .       # Lint
npm run build      # 本番ビルド
```

## ディレクトリ構成

```
src/
├── app/            # ページ & API Routes (App Router)
├── components/     # UIコンポーネント (layout / rules / skills / trace / ui / projects / memory / tasks / settings / migrate / sessionMonitor)
├── hooks/          # SWRベースのデータ取得フック
└── lib/            # ファイルI/O・CLAUDE.mdパーサー・スキル/実行ログ/メモリ/タスク履歴/設定/バックアップ/プラグイン/移行/セッション監視操作
config/
├── projects.json          # 監視対象プロジェクトの登録・選択状態（.gitignore対象）
└── projects.example.json  # コミット対象のテンプレート
sample-data/          # 自由記述形式のCLAUDE.md・サンプルスキル・settings.json・backups・pluginsを含むダミープロジェクト
docs/                 # plan.md（実装方針・5役3周の記録）, spec.md（仕様詳細・実装版）
```
