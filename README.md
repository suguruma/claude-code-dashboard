# Claude Code Dashboard

Claude Code とのやり取りにおける「ルール」「スキル」「実行ログ／思考プロセス」をローカルで可視化・管理するダッシュボード。
Webアプリ側は重い処理を行わず、実際の `.claude/CLAUDE.md` / `.claude/skills/*/SKILL.md` / `execution_log.json` を直接
読み書きして描画するだけのCPUモード（外部API通信なし・コスト0円）で動作する。詳細は
[プロジェクト定義・開発仕様書](./Claude%20Code%20Dashboard%20プロジェクト定義・開発仕様書.txt) と
[docs/spec.md](./docs/spec.md)（実装版・こちらが最新）を参照。

## 実装済み機能

- **ルール管理**（`/rules`）— `CLAUDE.md` の `## 見出し` をルールとして直接パース。ON/OFFトグル（`<!-- CCD:DISABLED -->` で無効化）、追加/編集/削除、黄金プロンプト集（実行ログ由来）
- **スキル管理**（`/skills`）— `.claude/skills/*/SKILL.md` の一覧・追加・編集・削除
- **実行ログ & 思考プロセス可視化**（`/trace`）— エージェント議論・合意度メーター・トレードオフ比較・介入ハイライト・黄金プロンプトのワンクリック保存
- 複数プロジェクトの横断管理（画面右上のプロジェクトスイッチャー。実際の `~/.claude` をプロジェクトとして登録することも可能）

機能3（GPUモードによるルール矛盾・重複自動検出）は未実装（`/refactor` に導線のみ）。

## セットアップ

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開く。初回は `sample-data/` を対象にしたサンプルプロジェクトが登録済み。

画面右上の「+」から、`CLAUDE.md`（と任意で `skills/`, `execution_log.json`）を配置している任意の Claude Code
プロジェクト、または実際の `~/.claude` フォルダのルートパスを登録すると、そのプロジェクトを切り替えて管理できる。

> **注意**：`~/.claude` のような実際の設定フォルダを登録すると、本アプリからのトグル/追加/編集/削除がそのまま本番の
> `CLAUDE.md` / `SKILL.md` に書き込まれる。書き込み系の操作を試す際は `sample-data` プロジェクトに切り替えることを推奨する。

`config/projects.json` は個人環境の絶対パスを含むため `.gitignore` 対象。テンプレートは `config/projects.example.json` を参照。

## テスト・検証

```bash
npm test          # vitest によるlib層のユニットテスト（31件）
npx tsc --noEmit  # 型チェック
npx eslint .       # Lint
npm run build      # 本番ビルド
```

## ディレクトリ構成

```
src/
├── app/            # ページ & API Routes (App Router)
├── components/     # UIコンポーネント (layout / rules / skills / trace / ui)
├── hooks/          # SWRベースのデータ取得フック
└── lib/            # ファイルI/O・CLAUDE.mdパーサー・スキル/実行ログ操作
config/
├── projects.json          # 監視対象プロジェクトの登録・選択状態（.gitignore対象）
└── projects.example.json  # コミット対象のテンプレート
sample-data/          # 自由記述形式のCLAUDE.md・サンプルスキルを含むダミープロジェクト
docs/                 # plan.md（実装方針・5役3周の記録）, spec.md（仕様詳細・実装版）
```
