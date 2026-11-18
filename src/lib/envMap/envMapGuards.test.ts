import { execFileSync } from "child_process"
import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"
import { isAllowedLanPath } from "@/lib/lanAccess/gatewayPolicy"

const ROOT = path.resolve(__dirname, "../../..")

describe("[A9][A14] LAN(スマホ)には出さない", () => {
  it("ページと API は LAN の許可リストに無い", () => {
    for (const p of ["/org-rules", "/api/env-map", "/api/env-map/route"]) expect(isAllowedLanPath(p)).toBe(false)
  })
  it("スマホのセッションの画面に［地図で見る］が無く、PC のセッションの詳細には有る", () => {
    const phone = readFileSync(path.join(ROOT, "src/components/phone/PhoneSessionSheet.tsx"), "utf-8")
    const pc = readFileSync(path.join(ROOT, "src/components/desktopSessions/SessionDetailDialog.tsx"), "utf-8")
    expect(phone).not.toContain("地図で見る")
    expect(phone).not.toContain("tab=map")
    expect(pc).toContain("地図で見る")
  })
})

describe("[A13] 設定ファイルは git に入れない", () => {
  it("config/env-map.json は .gitignore に当たり、見本にパスが無い", () => {
    const out = execFileSync("git", ["check-ignore", "config/env-map.json"], { cwd: ROOT, encoding: "utf-8" })
    expect(out.trim()).toBe("config/env-map.json")
    const sample = JSON.parse(readFileSync(path.join(ROOT, "config/env-map.example.json"), "utf-8")) as Record<string, unknown>
    expect(Object.values(sample).every((v) => v === "")).toBe(true)
  })
})

describe("[EM-7] 部品の許諾文を同梱する", () => {
  it("THIRD_PARTY_NOTICES.md に cytoscape の MIT の許諾文があり、exe に入れる", () => {
    const notice = readFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.md"), "utf-8")
    expect(notice).toContain("cytoscape")
    expect(notice).toContain("Permission is hereby granted")
    expect(readFileSync(path.join(ROOT, "electron-builder.yml"), "utf-8")).toContain("THIRD_PARTY_NOTICES.md")
  })
})
