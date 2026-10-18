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

export interface ErrorResponseOptions {
  /** エラーの種類が決まらない（想定外の）エラーの状態コード。既定は 500 */
  fallbackStatus?: number
  /** Error でない値が投げられたときの文言 */
  fallbackMessage?: string
}

/**
 * API ルートの catch で使う、エラー → レスポンスの変換。状態コードはエラーの種類で決まる（lib/errors.ts）。
 * 文言（message）は状態コードに影響しない。
 */
export function errorResponse(err: unknown, options: ErrorResponseOptions = {}): NextResponse {
  return NextResponse.json(
    { error: messageOfError(err, options.fallbackMessage) },
    { status: statusOfError(err, options.fallbackStatus) }
  )
}
