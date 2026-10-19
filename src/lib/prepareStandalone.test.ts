import { promises as fs } from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { afterEach, describe, expect, it } from "vitest"

interface PrepareModule {
  prepareStandalone: (root: string) => Promise<string[]>
}

const cleanup: string[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })))
})

async function load(): Promise<PrepareModule> {
  const file = path.join(process.cwd(), "scripts", "prepare-standalone.mjs")
  return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as PrepareModule
}

/** next build の後の形（standalone の server.js と、.next/static）を合成する */
async function fakeBuild(withPublic: boolean): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-standalone-test-"))
  cleanup.push(root)
  await fs.mkdir(path.join(root, ".next", "standalone"), { recursive: true })
  await fs.writeFile(path.join(root, ".next", "standalone", "server.js"), "// server", "utf-8")
  await fs.mkdir(path.join(root, ".next", "static", "chunks"), { recursive: true })
  await fs.writeFile(path.join(root, ".next", "static", "chunks", "app.js"), "// chunk", "utf-8")
  if (withPublic) {
    await fs.mkdir(path.join(root, "public"), { recursive: true })
    await fs.writeFile(path.join(root, "public", "icon.txt"), "icon", "utf-8")
  }
  return root
}

describe("prepareStandalone（electron:dev と dist:win で共通の写し方）", () => {
  it(".next/static と public/ を .next/standalone の下へ写す。前回の古いファイルは残さない", async () => {
    const { prepareStandalone } = await load()
    const root = await fakeBuild(true)
    const stale = path.join(root, ".next", "standalone", ".next", "static", "old.js")
    await fs.mkdir(path.dirname(stale), { recursive: true })
    await fs.writeFile(stale, "// old", "utf-8")

    const done = await prepareStandalone(root)
    expect(done.map((p) => p.replace(/\\/g, "/"))).toEqual([".next/standalone/.next/static", ".next/standalone/public"])
    expect(await fs.readFile(path.join(root, ".next", "standalone", ".next", "static", "chunks", "app.js"), "utf-8")).toBe("// chunk")
    expect(await fs.readFile(path.join(root, ".next", "standalone", "public", "icon.txt"), "utf-8")).toBe("icon")
    await expect(fs.stat(stale)).rejects.toThrow()
  })

  it("public/ が無ければ、static だけを写す", async () => {
    const { prepareStandalone } = await load()
    const root = await fakeBuild(false)
    const done = await prepareStandalone(root)
    expect(done.map((p) => p.replace(/\\/g, "/"))).toEqual([".next/standalone/.next/static"])
  })

  it("next build の前（server.js が無い）なら、何も写さずにエラーにする", async () => {
    const { prepareStandalone } = await load()
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ccd-standalone-test-"))
    cleanup.push(root)
    await expect(prepareStandalone(root)).rejects.toThrow(/next build/)
  })
})
