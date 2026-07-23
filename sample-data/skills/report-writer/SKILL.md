---
name: report-writer
description: テーマと対象読者を指定してビジネスレポートを作成します。役員報告や週次報告など、定型フォーマットの文書作成に使用します。
argument-schema:
  type: object
  properties:
    theme:
      type: string
      description: レポートのテーマ
    audience:
      type: string
      description: 想定読者（役員 / チームメンバー 等）
---

# レポート作成スキル

## 入力パラメータ

- テーマ: $theme
- 対象読者: $audience

## 手順

1. 結論（エグゼクティブサマリー）を冒頭に配置する
2. 対象読者に応じてトーン・専門用語の注記レベルを調整する
3. 数値データは表形式でまとめる
