import net from "net"
import { createRequire } from "module"
import { afterEach, describe, expect, it } from "vitest"

// electron/port.js はElectronのmainプロセス(CommonJS)が読むファイルなので、Nodeのrequireでそのまま読む
const { PREFERRED_PORT, pickPort } = createRequire(import.meta.url)("../../electron/port.js") as {
  PREFERRED_PORT: number
  pickPort: (preferred?: number) => Promise<{ port: number; isPreferred: boolean }>
}

const holders: net.Server[] = []

/** 127.0.0.1 の指定ポート(0なら任意の空きポート)を占有して、そのポート番号を返す */
function occupy(port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => {
      holders.push(server)
      resolve((server.address() as net.AddressInfo).port)
    })
  })
}

/** 現在空いているポートを1つ見つけて、閉じた状態で返す(そのポートを「優先ポート」に見立てて使う) */
async function findFreePort(): Promise<number> {
  const port = await occupy()
  const server = holders.pop() as net.Server
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

afterEach(async () => {
  await Promise.all(holders.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))))
})

describe("pickPort (exeの起動ポート)", () => {
  it("優先ポートは49152未満(OSが一時的な接続に割り当てる範囲の外)", () => {
    expect(PREFERRED_PORT).toBeGreaterThan(1024)
    expect(PREFERRED_PORT).toBeLessThan(49152)
  })

  it("優先ポートが空いていれば、それを使う(起動のたびに同じポートになる)", async () => {
    const preferred = await findFreePort()
    const first = await pickPort(preferred)
    const second = await pickPort(preferred)
    expect(first).toEqual({ port: preferred, isPreferred: true })
    expect(second).toEqual({ port: preferred, isPreferred: true })
  })

  it("優先ポートが使用中なら、空いている別のポートにする", async () => {
    const busy = await occupy()
    const result = await pickPort(busy)
    expect(result.isPreferred).toBe(false)
    expect(result.port).not.toBe(busy)
    expect(result.port).toBeGreaterThan(0)
    // 選んだポートは、実際に待ち受けられる
    await expect(occupy(result.port)).resolves.toBe(result.port)
  })

  it("使用中の優先ポートの占有を、選ぶ処理が奪ったり壊したりしない", async () => {
    const busy = await occupy()
    await pickPort(busy)
    // 占有していたサーバーは、そのまま接続を受け付けられる
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(busy, "127.0.0.1", () => {
        socket.destroy()
        resolve()
      })
      socket.on("error", reject)
    })
  })

  it("優先ポートが解放されれば、次の起動では再び優先ポートを使う", async () => {
    const preferred = await occupy()
    expect((await pickPort(preferred)).isPreferred).toBe(false)
    const server = holders.pop() as net.Server
    await new Promise<void>((resolve) => server.close(() => resolve()))
    expect(await pickPort(preferred)).toEqual({ port: preferred, isPreferred: true })
  })
})
