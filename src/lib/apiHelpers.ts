import { NextRequest } from "next/server"
import { getProjectById, getSelectedProject } from "./projects"
import { ProjectConfig } from "./types"

export class ApiValidationError extends Error {}

export async function resolveRequestProject(req: NextRequest): Promise<ProjectConfig> {
  const projectId = req.nextUrl.searchParams.get("projectId")
  const project = projectId ? await getProjectById(projectId) : await getSelectedProject()
  if (!project) {
    throw new ApiValidationError("対象プロジェクトが見つかりません。先にプロジェクトを登録してください")
  }
  return project
}
