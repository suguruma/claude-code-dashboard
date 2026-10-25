import { describe, expect, it } from "vitest"
import { cutAfterMask, maskSecrets, SECRET_MARK } from "./secretMask"

// 値はどれも合成(本物の秘密ではない)
describe("[ND-5] 秘密らしい文字列を伏せる(ゲート2 の M1 で見つかった漏れの形)", () => {
  const leaks: Array<[string, string]> = [
    ["DB_PASSWORD=Sup3rS3cret! ./migrate.sh --env prod", "Sup3rS3cret"],
    ["API_TOKEN=abc123def ./run.sh", "abc123def"],
    ["mysql -u root --password hunter2hunter2 -e \"select 1\"", "hunter2"],
    ["deploy --token tok123abc --env prod", "tok123abc"],
    ["mysql -uroot -phunter2 shop", "hunter2"],
    ["curl -u user:pass1234 https://example.invalid/api", "pass1234"],
    ["curl --user=alice:s3cr3tpw https://example.invalid/", "s3cr3tpw"],
    ["git clone https://user:Pa55w0rd@example.invalid/r.git", "Pa55w0rd"],
    ["SECRET_KEY=django-insecure-abc python manage.py runserver", "django-insecure-abc"],
    ["MYSQL_PWD=hunter2 mysql -u root", "hunter2"],
    ["AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY aws s3 ls", "wJalrXUtnFEMI"],
    ['curl -d \'{"password":"hunter2","user":"alice"}\' https://example.invalid/login', "hunter2"],
    ["パスワードは hunter2 です", "hunter2"],
    ["CLIENT_SECRET=abc123 node app.js", "abc123"],
    ["export GITHUB_TOKEN=ghp_0123456789abcdefXYZ", "0123456789abcdef"],
  ]

  it.each(leaks)("伏せる：%s", (input, secret) => {
    const masked = maskSecrets(input)
    expect(masked).not.toContain(secret)
    expect(masked).toContain(SECRET_MARK)
  })

  it("伏せてから切る：先頭40字にも値が残らない", () => {
    expect(cutAfterMask("MYSQL_PWD=hunter2 mysql", 40)).toBe(`MYSQL_PWD=${SECRET_MARK} mysql`)
    expect(cutAfterMask("DB_PASSWORD=Sup3rS3cret! ./migrate.sh --env prod", 40)).not.toContain("Sup3r")
  })

  it("名前と、秘密でない部分は残す(何を伏せたかが分かるように)", () => {
    expect(maskSecrets("git clone https://user:Pa55w0rd@example.invalid/r.git")).toBe(`git clone https://user:${SECRET_MARK}@example.invalid/r.git`)
    expect(maskSecrets('{"password":"hunter2","user":"alice"}')).toBe(`{"password":"${SECRET_MARK}","user":"alice"}`)
    expect(maskSecrets("token=abc123&x=1")).toBe(`token=${SECRET_MARK}&x=1`)
  })

  it("秘密でない普通のコマンドは変えない(ポートの -p・パス・メッセージ)", () => {
    for (const plain of [
      "npx next dev -p 3964",
      "docker run -p 8080:80 nginx",
      "ls -la src/components/desktopSessions",
      'git commit -m "fix: 画面の直し"',
      "npm run build",
      "cd ~/work && pwd",
    ]) {
      expect(maskSecrets(plain), plain).toBe(plain)
    }
  })
})
