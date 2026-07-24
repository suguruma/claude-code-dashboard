import { beforeEach, describe, expect, it, vi } from "vitest"
import * as fileIO from "./fileIO"
import { addProject, removeProject, selectProject, updateProject } from "./projects"
import { ProjectsFile } from "./types"

/**
 * config/projects.json のパスはモジュール読み込み時に process.cwd() で固定されるため、
 * テストごとに実ファイルを切り替えられない。fileIO の読み書きをモックしてメモリ上で完結させる。
 */
vi.mock("./fileIO", async (importOriginal) => {
  const actual = await importOriginal<typeof fileIO>()
  return {
    ...actual,
    readJsonFile: vi.fn(),
    writeJsonFile: vi.fn(),
  }
})

function makeStore(initial: ProjectsFile) {
  let data = structuredClone(initial)
  vi.mocked(fileIO.readJsonFile).mockImplementation(async () => structuredClone(data))
  vi.mocked(fileIO.writeJsonFile).mockImplementation(async (_path, next) => {
    data = structuredClone(next as ProjectsFile)
  })
  return () => data
}

beforeEach(() => {
  vi.mocked(fileIO.readJsonFile).mockReset()
  vi.mocked(fileIO.writeJsonFile).mockReset()
})

describe("updateProject", () => {
  it("name / path を更新する", async () => {
    const getData = makeStore({
      projects: [{ id: "p1", name: "旧名前", path: "C:/old" }],
      selectedProjectId: "p1",
    })
    const updated = await updateProject("p1", { name: "新名前", path: "C:/new" })
    expect(updated).toEqual({ id: "p1", name: "新名前", path: "C:/new" })
    expect(getData().projects[0]).toEqual({ id: "p1", name: "新名前", path: "C:/new" })
  })

  it("nameのみ指定した場合pathは変更しない", async () => {
    const getData = makeStore({
      projects: [{ id: "p1", name: "A", path: "C:/a" }],
      selectedProjectId: "p1",
    })
    await updateProject("p1", { name: "B" })
    expect(getData().projects[0]).toEqual({ id: "p1", name: "B", path: "C:/a" })
  })

  it("存在しないIDを指定するとエラーになる", async () => {
    makeStore({ projects: [], selectedProjectId: null })
    await expect(updateProject("unknown", { name: "x" })).rejects.toThrow()
  })
})

describe("removeProject", () => {
  it("選択中プロジェクトを削除すると残りの先頭が選択される", async () => {
    const getData = makeStore({
      projects: [
        { id: "p1", name: "A", path: "C:/a" },
        { id: "p2", name: "B", path: "C:/b" },
      ],
      selectedProjectId: "p1",
    })
    await removeProject("p1")
    expect(getData().projects).toHaveLength(1)
    expect(getData().selectedProjectId).toBe("p2")
  })

  it("最後の1件を削除するとselectedProjectIdはnullになる", async () => {
    const getData = makeStore({
      projects: [{ id: "p1", name: "A", path: "C:/a" }],
      selectedProjectId: "p1",
    })
    await removeProject("p1")
    expect(getData().projects).toHaveLength(0)
    expect(getData().selectedProjectId).toBeNull()
  })
})

describe("addProject / selectProject", () => {
  it("addProjectは新規プロジェクトを追加し、未選択なら自動選択する", async () => {
    const getData = makeStore({ projects: [], selectedProjectId: null })
    const project = await addProject("新規", "C:/new")
    expect(project.name).toBe("新規")
    expect(getData().projects).toHaveLength(1)
    expect(getData().selectedProjectId).toBe(project.id)
  })

  it("selectProjectは存在しないIDを指定するとエラーになる", async () => {
    makeStore({ projects: [{ id: "p1", name: "A", path: "C:/a" }], selectedProjectId: "p1" })
    await expect(selectProject("unknown")).rejects.toThrow()
  })
})
