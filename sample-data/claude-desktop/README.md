# Claude Desktop セッション一覧のサンプルデータ（合成）

`/desktop-sessions`（Desktopセッション）画面の動作確認とテスト用に作った、**すべて架空のデータ**です。
実際のセッション名・ID・パスは含みません。Claude Desktopの内部形式に似せた次のファイルで構成されています。

| 場所 | 内容 |
|---|---|
| `data/claude-code-sessions/<アカウント>/<組織>/local_*.json` | セッションごとのメタデータ（6件） |
| `data/claude_desktop_config.json` | サイドバーのグループ・ピン留め。`mcpServers` は「APIに出ない」ことの確認用のダミー |
| `data/config.json` | 実際のDesktopでは認証トークンが入るファイル。Dashboardは**読みません**（ダミー） |
| `projects/<フォルダ>/<cliSessionId>.jsonl` | 会話ログ（`~/.claude/projects/` の代わり。5件。1件は会話ログなし） |

## 画面で確認する方法

`config/desktop-sessions.json`（Gitの管理対象外）を次のように作り、開発サーバーを起動します。パスは自分の環境のものに置き換えてください。

```json
{
  "dataDir": "<このリポジトリ>/sample-data/claude-desktop/data",
  "projectsRoot": "<このリポジトリ>/sample-data/claude-desktop/projects"
}
```

状態の「実行中」は会話ログの更新時刻から推定するため、ファイルをコピーした直後は全件が実行中に見えます。
確認用に、更新時刻を過去へずらしてください（PowerShellの例。`001` の会話ログだけ数十秒前のままにすると「実行中」になります）。

```powershell
Get-ChildItem sample-data/claude-desktop/projects -Recurse -Filter *.jsonl |
  Where-Object { $_.Name -notlike '*000000000001.jsonl' } |
  ForEach-Object { $_.LastWriteTime = (Get-Date).AddHours(-3) }
```

## 組織図の確認用データを作る

`/desktop-sessions/org`（サイドバーの「組織図」。指示・報告・他グループ連絡の動き）の確認用に、すべて架空のデータを作るスクリプトがあります。
現在時刻を基準に直近4時間の出来事を作るので、画面を開く直前に実行してください（古くなったら作り直します）。

```bash
node scripts/make-org-chart-sample.mjs <出力先のフォルダ>
```

表示された `dataDir` と `projectsRoot` を `config/desktop-sessions.json` に書いて、ダッシュボードを（再）起動します。
同じ出力先に合成データを作り直したときも、ダッシュボードを再起動してください（会話ログの読み込みは差分読みなので、再起動しないと古い値のまま残ります）。
既定の接頭辞 `00_` で、グループ「試験グループ」（指揮役1・子4）と「別グループ」（指揮役1・子1）が見えます。

「試験グループ」で確認できること:

- 指示8本（受け手の会話ログまで確認できたもの7、送り手の記録だけのもの1）、報告5本、報告なしで終了2件（その間のツール呼び出し 30回・19回）
- 他グループからの連絡1件と、外部（CLI）からの連絡1件（指揮役のカードに点線で入る）
- 作業中の子1件（カードが脈動する）、コンテキストの圧縮1件、コンテキスト80%超・90%超の子、送信上限（10回）で停止中の子1件

ライブで動きを見るには、画面を開いたまま、会話ログ（`projects/` の下の `.jsonl`）の末尾に、指示・報告に当たる行を追記します。
追記した行だけが粒として流れます（開いた直後に過去の出来事を一斉に再生することはありません）。
期待する件数は、スクリプトの最後に表示されます。
