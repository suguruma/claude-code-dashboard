# Claude Code Dashboard

Claude Code とのやり取りにおける「ルール」「スキル」「実行ログ／思考プロセス」をローカルで可視化・管理するダッシュボード。
Webアプリ側は重い処理を行わず、実際の `.claude/CLAUDE.md` / `.claude/skills/*/SKILL.md` / `execution_log.json` を直接
読み書きして描画するだけのCPUモード（外部API通信なし・コスト0円）で動作する。

## 実装済み機能

- **ルール管理**（`/rules`）— `CLAUDE.md` の `## 見出し` をルールとして直接パース。ON/OFFトグル（`<!-- CCD:DISABLED -->` で無効化）、追加/編集/削除、ドラッグ&ドロップによる表示順（=CLAUDE.mdの記載順）の並び替え、次回用プロンプト集（実行ログ由来）
- **スキル管理**（`/skills`）— `.claude/skills/*/SKILL.md` の一覧・追加・編集・削除・改名（ディレクトリ名変更。呼び出しコマンドが変わる旨を確認表示）・カテゴリ別グルーピング表示（frontmatterの`category`フィールドに基づく表示上の分類。実ファイルはフラット配置のまま）・成熟度バッジ（`references`/`scripts`/`evals`サブフォルダの有無を表示）・対象モデルの記録（frontmatterの`target-model`。自由入力。一覧に🎯バッジで表示）
- **メモリ管理**（`/memory`）— `.claude/projects/*/memory/*.md`（AIメモリシステム）の一覧・閲覧。type別（user/feedback/project/reference）フィルタ。読み取り専用
- **タスク実行履歴**（`/tasks`）— `.claude/tasks/<session-id>/*.json` をセッション別に進捗バー・ステータスアイコン付きで可視化。読み取り専用
- **設定 & システム情報**（`/settings`）— `settings.json`（権限モード・環境変数・statusLine）/ バックアップ履歴 / ブロック済みプラグイン一覧をTabsで表示。読み取り専用
- **移行（エクスポート/インポート）**（`/migrate`）— ルール・スキルを1つのJSONファイルに書き出し、他のPC（別プロジェクト）に差分プレビュー付きで取り込む。上書き前に自動バックアップ。インポートの「ファイルを選択」はドラッグ&ドロップにも対応し、配布版exeでは`dialog.showOpenDialog`をIPC経由で直接呼び出す経路を優先する（環境差でファイル選択ダイアログが開かない事例への対処）
- **セッション監視**（`/session-monitor`）— `~/.claude/projects/*/*.jsonl`（Claude Codeの実行ログ）を解析し、**そのセッションが健全かを8つの観点で診断**する。セッションの寿命（コンパクション）・無限ループの兆候（エラー率）・読み取りの精度・コストと応答速度（キャッシュヒット率）・ワークフローの安定性・作業の分業・MCPの稼働・お任せ度をそれぞれ良好/注意/要対処で判定し、`/clear`でのリセットやgrepでの読み取り範囲の限定といった**具体的な対処を提示**する。判定の根拠としきい値も併記するため、しきい値の妥当性を自分で確認できる。数値の多寡は単独では判断できないため、同一プロジェクトの過去セッションを古い順に並べた推移グラフ（選択中のみ強調）と中央値との比較を用意。セッション一覧には先頭発話の抜粋（表示名）と発火したスキル名を表示し、どのやりとりだったか判別できるようにしている。生の集計値と個別グラフ（トークン推移・ツール呼び出し・MCP別・出力サイズ・圧縮履歴）は「詳細データ」を開いたときだけ取得・表示し、初期表示のペイロードを抑えている。Claude Code側のスキル`session-diagnostician`を実行すると、要求の誤解・手戻りの繰り返しといった意味的な診断（AI診断）も併記表示される（ダッシュボード自身はLLMを呼ばない方針のため、スキルが生成する`session_diagnosis.json`を読むだけ）。自動更新トグルで3秒間隔のポーリングにも対応。読み取り専用
- **Desktopセッション**（`/desktop-sessions`）— Claude Desktopの全セッションを1画面で一覧する読み取り専用ビュー（5秒更新）。一覧の主データはDesktopが保存するセッションのメタデータ（`claude-code-sessions/*/*/local_*.json`）で、要対応のセッションには要対応の内容の先頭60文字を表示し、会話ログ（`~/.claude/projects/*/<id>.jsonl`）から最新の指示（先頭60文字・発信元つき）・コンテキスト使用量・タスクリストの進み具合・圧縮回数を補い、サイドバーのグループ・ピン留めは`claude_desktop_config.json`の`preferences.epitaxyPrefs`の該当キーだけを読む。状態は、Desktopが付ける分類（要対応・確認待ち・完了）と、会話ログの更新状況からの推定（実行中・中断の可能性）を併記する。Desktopの内部形式は非公開・非保証のため読み取り処理は`src/lib/desktopSessions.ts`に隔離し、読めない場合は会話ログだけの縮退表示に切り替える。認証トークンを含む`config.json`は読まず、APIは表示用の許可リスト項目だけを返す。サンプルは`sample-data/claude-desktop/`（すべて合成データ）
- **実行ログ & 思考プロセス可視化**（`/trace`）— エージェント議論・合意度メーター・トレードオフ比較・介入ハイライト・次回用プロンプトのワンクリック保存。マルチエージェント構成図（指揮系統の肩書きはログごとに指定可能。無指定ならフラットなチーム編成として表示）と試行錯誤・リトライのタイムラインにも対応。`execution_log.json`自体は本ダッシュボードは生成せず、Claude Code側のスキル（5役体制の`autonomous-production-team`、または通常の会話を事後的に記録する`session-log-extractor`）が書き出す。書き出し先はスキルを実行した作業ディレクトリになるため、ページ上部の「分析対象プロジェクト」セレクター（TopBarの選択中プロジェクトとは独立、登録済みプロジェクトから選択）で見たいプロジェクトを切り替える。ルール保存先（CLAUDE.md）はTopBarの選択中プロジェクト側になる
- **使い方ガイド**（`/help`）— 初心者向けの用語集・各ページの使い方・FAQをまとめた解説ページ。サイドバー下部に常時リンクを表示
- **ルール整理**（`/refactor`）— Claude Code標準スキル`rule-optimizer`（execution_log.jsonの過去のユーザー介入履歴から矛盾・重複ルールを学習）が出力する`rule_refactor_proposal.json`を読み込み、現在のCLAUDE.mdとのDiffプレビュー・ステイル検知（提案生成後の編集を検知）・選択適用（バックアップ付き）を行う。ローカルLLM（GPUモード）連携構想は方針転換により廃止し、このスキル連携方式に統一した。`/trace`と同様、ページ上部の「分析対象プロジェクト」セレクターがTopBarの選択中プロジェクトとは独立しており、適用先のCLAUDE.mdもこのセレクターで選んだプロジェクトになる
- 複数プロジェクトの横断管理（画面右上のプロジェクトスイッチャー。実際の `~/.claude` をプロジェクトとして登録することも可能）
- ライト/ダーク/システム追従のテーマ切替（TopBar右側）

メモリ管理・タスク実行履歴・設定/バックアップ/プラグイン・セッション監視は全て読み取り専用（編集・復元は次回以降のスコープ）。
移行機能はルール・スキルのみが対象で、settings.jsonの環境変数などは含まない。

ナビゲーションは左サイドバーに「設定管理」「分析・振り返り」「ツール」のカテゴリでグループ化されている。
サイドバー下部のボタンでアイコンのみの表示に折りたためる。

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

- 初回起動時のみ、`config/projects.example.json`（個人パスを含まない空のテンプレート）を、OSごとの
  ユーザーデータ領域（Windowsなら `%APPDATA%/claude-code-dashboard`）へ複製する。以後の登録・編集内容はすべて
  そこに永続化され、exe本体の再配布・上書きには影響されない。
- `electron/main.js` が起動処理の実体。`electron-builder.yml` の `extraResources` で、実行に必要な
  `.next/standalone`（node_modules・サーバー本体）と上記のテンプレートのみを明示的に同梱している
  （サンプルデータや `config/projects.json` 等、個人データ・非本質的なファイルは同梱しない）。
- コード署名は行っていないため、初回実行時にWindows SmartScreenの警告が出る（「詳細情報」→「実行」で起動可能）。
- 起動中は進捗％と残り時間の目安を表示する小さなスプラッシュ画面（`electron/splash.html`）を表示する。
  **注意**：portable exeは起動のたびにOSレベルで自身を一時フォルダへ自己展開してからアプリ本体が動き出すため
  （実測で起動時間の大半を占める）、スプラッシュはその自己展開フェーズ**より後**の「サーバー起動〜画面描画」
  区間しか可視化できない。

### サンプルデータを試す

exe本体にはサンプルデータを同梱していない（本体を必要最低限に保つため）。試したい場合は、Releaseページから
`sample-data-v<version>.zip` を別途ダウンロードして展開し、アプリ右上の「+」からその展開先フォルダを
プロジェクトとして登録する。`npm run package:sample-data` でこのzipをリポジトリの `sample-data/` から生成できる。

## テスト・検証

```bash
npm test          # vitest によるlib層のユニットテスト（18ファイル・185件）
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
scripts/
└── package-sample-data.mjs # sample-data/ をRelease添付用zipにまとめるスクリプト
LICENSE                # MITライセンス
```

## ライセンス

[MIT License](./LICENSE)
