import { NextRequest, NextResponse } from "next/server"
import { InvalidInputError, messageOfError, statusOfError } from "./errors"
import { getProjectById, getSelectedProject } from "./projects"
import { ProjectConfig } from "./types"

export async function resolveRequestProject(req: NextRequest): Promise<ProjectConfig> {
  const projectId = req.nextUrl.searchParams.get("projectId")
  const project = projectId ? await getProjectById(projectId) : await getSelectedProject()
  if (!project) {
    throw new InvalidInputError("対象プロジェクトが見つかりません。先にプロジェクトを登録してください")
  }
  return project
}

/**
 * リクエストの本文を、JSON のオブジェクトとして読む（ルートが `req.json()` を直接呼ばず、これを使う）。
 * 壊れた JSON・オブジェクトでない本文（null・配列・数値など）は InvalidInputError（400）にする。
 * エラーの文言には、本文の内容も JSON の解析エラーも入れない。
 * optional: 本文が空でもよい（空なら `{}`）。空でなければ、壊れた JSON は 400。
 */
// 戻り値は、`req.json()` と同じ any（各ルートが、受け取る項目を typeof で確かめて使う）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonBody(req: Request, options: { optional?: boolean } = {}): Promise<any> {
  const text = await req.text()
  if (options.optional && text.trim() === "") return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new InvalidInputError("リクエストの本文を JSON として読めません")
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidInputError("リクエストの本文は JSON のオブジェクトで指定してください")
  }
  return parsed
}

export interface ErrorResponseOptions {
  /** Error でない値が投げられたときの文言 */
  fallbackMessage?: string
}

/**
 * API ルートの catch で使う、エラー → レスポンスの変換。状態コードはエラーの種類で決まる（lib/errors.ts）。
 * 種類のない（想定外の）エラーは 500。文言（message）は状態コードに影響しない。
 */
export function errorResponse(err: unknown, options: ErrorResponseOptions = {}): NextResponse {
  return NextResponse.json({ error: messageOfError(err, options.fallbackMessage) }, { status: statusOfError(err) })
}
