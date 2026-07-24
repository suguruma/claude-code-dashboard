---
name: project-deploy-owner
description: 本番デプロイはオーナー自身が実施する。AIは提案とコマンド提示に留める。
metadata:
  type: project
---

本番環境へのデプロイ・リリース作業は必ずオーナー自身が実行する。

**Why:** 本番影響のある操作を誤って自動実行しないための安全策。

**How to apply:** デプロイ用コマンドは提示するが、実行はオーナーに委ねる。
