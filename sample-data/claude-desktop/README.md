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
