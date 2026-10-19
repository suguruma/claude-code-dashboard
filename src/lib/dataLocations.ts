import os from "os"
import path from "path"
import type { DataLocation } from "./desktopSessionTypes"

export type { DataLocation, DataLocationOrigin } from "./desktopSessionTypes"

/**
 * 本物のデータの場所を自動で探すかどうか(⑧-2)。
 * この環境変数が "0" のときは、Claude Desktop のデータフォルダ・会話ログのルート・利用上限の記録を、設定ファイルか環境変数で
 * 明示した場所からだけ読み、明示が無いものは「無い」として扱う。合成データで撮る・確かめるときに、設定ファイルが無くても
 * この PC の本物のデータを読まないようにするための止め方。配布 exe は設定しないので、exe では今までどおり自動で探す。
 */
export const AUTODETECT_ENV = "CCD_DESKTOP_AUTODETECT"

export type Env = Record<string, string | undefined>

export function isAutodetectDisabled(env: Env = process.env): boolean {
  return env[AUTODETECT_ENV]?.trim() === "0"
}

/** 設定ファイル → 環境変数 → 自動(止めていれば null)の順に、場所を決める */
export function locateData(
  configured: string | null | undefined,
  envName: string | null,
  auto: () => string,
  env: Env = process.env
): DataLocation {
  const fromConfig = configured?.trim()
  if (fromConfig) return { path: fromConfig, origin: "explicit-config" }
  const fromEnv = envName ? env[envName]?.trim() : undefined
  if (fromEnv) return { path: fromEnv, origin: "explicit-env" }
  if (isAutodetectDisabled(env)) return { path: null, origin: "disabled" }
  return { path: auto(), origin: "auto" }
}

/** 会話ログのルートを明示する環境変数(Desktop のセッション一覧・利用上限・セッション監視で共通) */
export const PROJECTS_ROOT_ENV = "CLAUDE_DESKTOP_PROJECTS_ROOT"

/** 既定の会話ログのルート(`~/.claude/projects`) */
export function defaultClaudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects")
}

/** 既定の利用上限の公式値の記録(`~/.claude-dashboard/usage-snapshots.jsonl`) */
export function defaultSnapshotsPath(): string {
  return path.join(os.homedir(), ".claude-dashboard", "usage-snapshots.jsonl")
}

/**
 * 会話ログのルート。configured はサービスの設定(設定ファイルと環境変数を合わせたもの)。
 * 明示が無く、自動の探索を止めているときは null(会話ログは無いものとして扱う)
 */
export function resolveProjectsRoot(configured: string | null | undefined, env: Env = process.env): string | null {
  return locateData(configured, PROJECTS_ROOT_ENV, defaultClaudeProjectsRoot, env).path
}
