import path from "path"
import { readJsonFile, writeJsonFile } from "./fileIO"
import { ProjectConfig, ProjectsFile } from "./types"

const PROJECTS_CONFIG_PATH = path.join(process.cwd(), "config", "projects.json")

const DEFAULT_PROJECTS: ProjectsFile = {
  projects: [
    { id: "sample", name: "サンプルプロジェクト", path: "./sample-data" },
  ],
  selectedProjectId: "sample",
}

export async function getProjectsFile(): Promise<ProjectsFile> {
  const data = await readJsonFile<ProjectsFile>(PROJECTS_CONFIG_PATH, DEFAULT_PROJECTS)
  if (!data.selectedProjectId && data.projects.length > 0) {
    data.selectedProjectId = data.projects[0].id
  }
  return data
}

export async function saveProjectsFile(data: ProjectsFile): Promise<void> {
  await writeJsonFile(PROJECTS_CONFIG_PATH, data)
}

export async function getSelectedProject(): Promise<ProjectConfig | null> {
  const data = await getProjectsFile()
  return data.projects.find((p) => p.id === data.selectedProjectId) ?? data.projects[0] ?? null
}

export async function getProjectById(id: string): Promise<ProjectConfig | null> {
  const data = await getProjectsFile()
  return data.projects.find((p) => p.id === id) ?? null
}

export async function addProject(name: string, projectPath: string): Promise<ProjectConfig> {
  const data = await getProjectsFile()
  const id = `proj_${Date.now().toString(36)}`
  const project: ProjectConfig = { id, name, path: projectPath }
  data.projects.push(project)
  if (!data.selectedProjectId) data.selectedProjectId = id
  await saveProjectsFile(data)
  return project
}

export async function removeProject(id: string): Promise<void> {
  const data = await getProjectsFile()
  data.projects = data.projects.filter((p) => p.id !== id)
  if (data.selectedProjectId === id) {
    data.selectedProjectId = data.projects[0]?.id ?? null
  }
  await saveProjectsFile(data)
}

export async function selectProject(id: string): Promise<void> {
  const data = await getProjectsFile()
  if (!data.projects.some((p) => p.id === id)) {
    throw new Error("指定されたプロジェクトが見つかりません")
  }
  data.selectedProjectId = id
  await saveProjectsFile(data)
}
