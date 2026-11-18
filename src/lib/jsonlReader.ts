import { promises as fs } from "fs"

const CHUNK_BYTES = 4 * 1024 * 1024
/** 改行が現れないまま、これを超えて読み進めた行は壊れた巨大行とみなして捨てる */
const MAX_CARRY_BYTES = 64 * 1024 * 1024

/**
 * JSONLファイルの fromOffset から endSize までを読み、完結した行ごとに onLine を呼ぶ。戻り値は次回の読み取り位置。
 * 改行で終わっていない最後の行は書き込み途中とみなし、読み取り位置を進めない(次回に回す)。
 * ファイル全体をメモリに載せず、chunkBytes ずつ読む。
 * needle を渡すと、その文字列(UTF-8 のバイト列)を含む行だけを文字列にして onLine に渡す(含まない行は文字列にしない。
 * 巨大なツールの出力の行を、文字に直さずに飛ばすため。⑯ A11)
 * accept を渡すと、行のバイト列でそれが true の行だけを文字列にして onLine に渡す(⑲:複数の印のどれかを含む行だけを拾う)
 */
export async function readJsonlFrom(
  filePath: string,
  fromOffset: number,
  endSize: number,
  onLine: (line: string) => void,
  chunkBytes: number = CHUNK_BYTES,
  needle?: string,
  accept?: (line: Buffer) => boolean
): Promise<number> {
  const needleBytes = needle ? Buffer.from(needle, "utf-8") : null
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
      if (needleBytes) {
        emitMatching(data.subarray(0, lastNewline), needleBytes, onLine)
      } else if (accept) {
        emitAccepted(data.subarray(0, lastNewline), accept, onLine)
      } else {
        const complete = data.subarray(0, lastNewline).toString("utf-8")
        for (const line of complete.split("\n")) {
          if (line) onLine(line)
        }
      }
      carry = Buffer.from(data.subarray(lastNewline + 1))
      committed = position - carry.length
    }
    return committed
  } finally {
    await handle.close()
  }
}

/** buf(改行で区切られた完結した行の並び)のうち、accept が true の行だけを文字列にして onLine に渡す */
function emitAccepted(buf: Buffer, accept: (line: Buffer) => boolean, onLine: (line: string) => void): void {
  let from = 0
  while (from < buf.length) {
    const nl = buf.indexOf(0x0a, from)
    const end = nl < 0 ? buf.length : nl
    if (end > from) {
      const line = buf.subarray(from, end)
      if (accept(line)) onLine(line.toString("utf-8"))
    }
    from = end + 1
  }
}

/** buf(改行で区切られた完結した行の並び)のうち、needle を含む行だけを文字列にして onLine に渡す */
function emitMatching(buf: Buffer, needle: Buffer, onLine: (line: string) => void): void {
  let from = 0
  while (from < buf.length) {
    const hit = buf.indexOf(needle, from)
    if (hit < 0) return
    const start = hit === 0 ? 0 : buf.lastIndexOf(0x0a, hit - 1) + 1
    const nextNewline = buf.indexOf(0x0a, hit)
    const end = nextNewline < 0 ? buf.length : nextNewline
    if (end > start) onLine(buf.subarray(start, end).toString("utf-8"))
    from = end + 1
  }
}
