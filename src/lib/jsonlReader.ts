import { promises as fs } from "fs"

const CHUNK_BYTES = 4 * 1024 * 1024
/** 改行が現れないまま、これを超えて読み進めた行は壊れた巨大行とみなして捨てる */
const MAX_CARRY_BYTES = 64 * 1024 * 1024

/**
 * JSONLファイルの fromOffset から endSize までを読み、完結した行ごとに onLine を呼ぶ。戻り値は次回の読み取り位置。
 * 改行で終わっていない最後の行は書き込み途中とみなし、読み取り位置を進めない(次回に回す)。
 * ファイル全体をメモリに載せず、chunkBytes ずつ読む。
 */
export async function readJsonlFrom(
  filePath: string,
  fromOffset: number,
  endSize: number,
  onLine: (line: string) => void,
  chunkBytes: number = CHUNK_BYTES
): Promise<number> {
  const handle = await fs.open(filePath, "r")
  try {
    let position = fromOffset
    let committed = fromOffset
    let carry: Buffer = Buffer.alloc(0)
    while (position < endSize) {
      const length = Math.min(chunkBytes, endSize - position)
      const chunk = Buffer.alloc(length)
      const { bytesRead } = await handle.read(chunk, 0, length, position)
      if (bytesRead === 0) break
      position += bytesRead

      const data = carry.length > 0 ? Buffer.concat([carry, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead)
      const lastNewline = data.lastIndexOf(0x0a)
      if (lastNewline < 0) {
        if (data.length > MAX_CARRY_BYTES) {
          carry = Buffer.alloc(0)
          committed = position
        } else {
          carry = Buffer.from(data)
        }
        continue
      }
      const complete = data.subarray(0, lastNewline).toString("utf-8")
      for (const line of complete.split("\n")) {
        if (line) onLine(line)
      }
      carry = Buffer.from(data.subarray(lastNewline + 1))
      committed = position - carry.length
    }
    return committed
  } finally {
    await handle.close()
  }
}
