# Claude Code Dashboard

Claude Code とのやり取りにおける「ルール」「実行ログ／思考プロセス」をローカルで可視化・管理するダッシュボード。
Webアプリ側は重い処理を行わず、ローカルの `rules.json` / `execution_log.json` / `CLAUDE.md` を読み書きして描画するだけの
CPUモード（外部API通信なし・コスト0円）で動作する。詳細は
[プロジェクト定義・開発仕様書](./Claude%20Code%20Dashboard%20プロジェクト定義・開発仕様書.txt) と
[docs/spec.md](./docs/spec.md) を参照。

## 実装済み機能

- **機能1: スキル & ルール管理**（`/rules`）— カテゴリ別ルール表示、ON/OFFトグル、追加/編集/削除、`CLAUDE.md`自動同期、獲得スキル（黄金プロンプト）一覧
- **機能2: 実行ログ & 思考プロセス可視化**（`/trace`）— エージェント議論・合意度メーター・トレードオフ比較・介入ハイライト・黄金プロンプトのワンクリック保存
- 複数プロジェクトの横断管理（画面右上のプロジェクトスイッチャー）

機能3（GPUモードによるルール矛盾・重複自動検出）は未実装（`/refactor` に導線のみ）。

## セットアップ

```bash
npm install
npm run dev
```

[http://localhost:3000](http://localhost:3000) を開く。初回は `sample-data/` を対象にしたサンプルプロジェクトが登録済み。

画面右上の「+」から、`rules.json` / `execution_log.json` / `CLAUDE.md` を配置している任意の Claude Code
プロジェクトのルートパスを登録すると、そのプロジェクトを切り替えて管理できる。

## テスト・検証

```bash
npm test          # vitest によるlib層のユニットテスト
npx tsc --noEmit  # 型チェック
npx eslint .       # Lint
npm run build      # 本番ビルド
```

## ディレクトリ構成

```
src/
├── app/            # ページ & API Routes (App Router)
├── components/     # UIコンポーネント (layout / rules / trace / ui)
├── hooks/          # SWRベースのデータ取得フック
└── lib/            # ファイルI/O・ルール/実行ログ操作・CLAUDE.md同期ロジック
config/projects.json # 監視対象プロジェクトの登録・選択状態
sample-data/          # 仕様書サンプルをそのまま格納した初期プロジェクト
docs/                 # plan.md（実装方針・5役3周の記録）, spec.md（仕様詳細）
```
