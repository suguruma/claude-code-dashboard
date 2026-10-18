import path from "path"
import { describe, expect, it } from "vitest"
import { getPreviewBlockReason } from "./sensitivePaths"

// すべて架空のパス。実在のユーザー名・フォルダ名は使わない
const base = path.resolve("/sample-project")
const p = (...segments: string[]) => path.join(base, ...segments)

describe("getPreviewBlockReason", () => {
  it.each([
    ".env",
    ".env.local",
    ".env.production",
    ".envrc",
    "prod.env",
    "server.pem",
    "private.key",
    "store.p12",
    "cert.pfx",
    "release.keystore",
    "id_rsa",
    "id_ed25519",
    "id_rsa.pub",
    ".npmrc",
    ".netrc",
    "_netrc",
    ".git-credentials",
    "credentials",
    "credentials.json",
    ".credentials.json",
    "secrets.json",
    "client_secret.json",
    "service-account-prod.json",
    ".claude.json",
    "claude_desktop_config.json",
  ])("%s は拒否する", (name) => {
    expect(getPreviewBlockReason(p(name))).not.toBeNull()
  })

  it("大文字小文字を区別せず拒否する", () => {
    expect(getPreviewBlockReason(p(".ENV"))).not.toBeNull()
    expect(getPreviewBlockReason(p("Server.PEM"))).not.toBeNull()
  })

  it("Windowsの末尾ドット・ストリーム指定による回避を拒否する", () => {
    expect(getPreviewBlockReason(p(".env."))).not.toBeNull()
    expect(getPreviewBlockReason(p("server.pem::$DATA"))).not.toBeNull()
    expect(getPreviewBlockReason(p("id_rsa "))).not.toBeNull()
  })

  it("拒否対象フォルダ配下のファイルは拒否する", () => {
    for (const dir of [".ssh", ".gnupg", ".aws", ".azure", ".kube", ".docker", "Claude-Data", "claude-code-sessions"]) {
      expect(getPreviewBlockReason(p(dir, "anything.txt"))).not.toBeNull()
    }
    expect(getPreviewBlockReason(p("Claude-Data", "pkg", "claude-code-sessions", "acct", "org", "local_x.json"))).not.toBeNull()
  })

  it("Claude Desktop の config.json は拒否する", () => {
    expect(getPreviewBlockReason(p("Claude", "config.json"))).not.toBeNull()
    expect(getPreviewBlockReason(p("Claude_samplepackage", "LocalCache", "Roaming", "Claude", "config.json"))).not.toBeNull()
  })

  it("~/.claude 配下の会話ログ(.jsonl)は拒否し、それ以外の場所の .jsonl は許可する", () => {
    expect(getPreviewBlockReason(p(".claude", "projects", "-sample", "session.jsonl"))).not.toBeNull()
    expect(getPreviewBlockReason(p("notes", "data.jsonl"))).toBeNull()
  })

  it(".git/config は拒否する", () => {
    expect(getPreviewBlockReason(p(".git", "config"))).not.toBeNull()
  })

  it.each([
    ["CLAUDE.md"],
    ["settings.json"],
    ["README.md"],
    ["package.json"],
    ["execution_log.json"],
    ["environment.md"],
    [".gitignore"],
    ["keyboard.md"],
  ])("通常のファイル %s は許可する", (name) => {
    expect(getPreviewBlockReason(p(name))).toBeNull()
  })

  it("無関係なフォルダの config.json は許可する", () => {
    expect(getPreviewBlockReason(p("sample-app", "config.json"))).toBeNull()
    expect(getPreviewBlockReason(p(".claude", "skills", "x", "SKILL.md"))).toBeNull()
  })
})
