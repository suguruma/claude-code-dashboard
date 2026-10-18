import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  InvalidNotifySettingsError,
  getDesktopNotifySettings,
  setDesktopNotifySettings,
} from "./desktopNotifySettings"

let dir: string
let previous: string | undefined

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-notify-settings-test-"))
  previous = process.env.CCD_DATA_DIR
  process.env.CCD_DATA_DIR = dir
})

afterEach(async () => {
  if (previous === undefined) delete process.env.CCD_DATA_DIR
  else process.env.CCD_DATA_DIR = previous
  await fs.rm(dir, { recursive: true, force: true })
})

describe("desktopNotifySettings", () => {
  it("初期値はオフ(ファイルが無い)", async () => {
    expect(await getDesktopNotifySettings()).toEqual({ notifications: false })
  })

  it("保存した値を読み戻せる", async () => {
    await setDesktopNotifySettings({ notifications: true })
    expect(await getDesktopNotifySettings()).toEqual({ notifications: true })
    await setDesktopNotifySettings({ notifications: false })
    expect(await getDesktopNotifySettings()).toEqual({ notifications: false })
  })

  it("保存されるのは真偽値1つだけで、ほかの項目は受け付けない", async () => {
    await setDesktopNotifySettings({ notifications: true, extra: "x", path: "C:/secret" })
    const raw = JSON.parse(await fs.readFile(path.join(dir, "config", "desktop-notify.json"), "utf-8"))
    expect(raw).toEqual({ notifications: true })
  })

  it("真偽値以外は拒否する", async () => {
    for (const bad of [{ notifications: "true" }, { notifications: 1 }, {}, null, "on"]) {
      await expect(setDesktopNotifySettings(bad)).rejects.toBeInstanceOf(InvalidNotifySettingsError)
    }
  })

  it("ファイルが壊れていても、通知を出さない側(オフ)に倒す", async () => {
    await fs.mkdir(path.join(dir, "config"), { recursive: true })
    await fs.writeFile(path.join(dir, "config", "desktop-notify.json"), "{ broken")
    expect(await getDesktopNotifySettings()).toEqual({ notifications: false })
  })
})
