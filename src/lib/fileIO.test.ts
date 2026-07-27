import path from "path"
import { afterEach, describe, expect, it } from "vitest"
import { getAppDataRoot, resolveProjectPath } from "./fileIO"

const originalCcdDataDir = process.env.CCD_DATA_DIR

afterEach(() => {
  if (originalCcdDataDir === undefined) delete process.env.CCD_DATA_DIR
  else process.env.CCD_DATA_DIR = originalCcdDataDir
})

describe("getAppDataRoot / resolveProjectPath", () => {
  it("CCD_DATA_DIRが未設定なら process.cwd() を基準にする", () => {
    delete process.env.CCD_DATA_DIR
    expect(getAppDataRoot()).toBe(process.cwd())
    expect(resolveProjectPath("./sample-data", "skills")).toBe(
      path.join(process.cwd(), "sample-data", "skills")
    )
  })

  /**
   * Electron配布版では、Next.jsのstandalone server.jsが起動時に無条件で
   * process.chdir(__dirname) を実行しcwdを自身のリソースディレクトリへ書き換えてしまうため、
   * spawn時のcwd指定だけではアプリの実データ配置場所（config/projects.json等）を制御できない。
   * CCD_DATA_DIR環境変数が設定されていれば、それをprocess.cwd()より優先する。
   */
  it("CCD_DATA_DIRが設定されていれば process.cwd() より優先する", () => {
    process.env.CCD_DATA_DIR = "C:\\fake\\user-data"
    expect(getAppDataRoot()).toBe("C:\\fake\\user-data")
    expect(resolveProjectPath("./sample-data", "skills")).toBe(
      path.join("C:\\fake\\user-data", "sample-data", "skills")
    )
  })

  it("絶対パスのprojectRootはCCD_DATA_DIRの影響を受けない", () => {
    process.env.CCD_DATA_DIR = "C:\\fake\\user-data"
    expect(resolveProjectPath("C:\\real\\project", "skills")).toBe(
      path.join("C:\\real\\project", "skills")
    )
  })
})
