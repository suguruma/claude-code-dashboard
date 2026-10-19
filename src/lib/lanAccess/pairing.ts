import { randomInt, timingSafeEqual } from "crypto"
import { readJsonFile, writeJsonFile } from "../fileIO"
import { withFileLock } from "./config"
import { hashSecret } from "./devices"

/** 登録コードの有効時間(5分) */
export const CODE_TTL_MS = 5 * 60 * 1000
/** 登録コードの長さ。読み違えやすい文字(0・O・1・I・L)を除いた31文字から8文字(約40ビット) */
export const CODE_LENGTH = 8
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
/** 1つのコードに、これだけまちがえたら、そのコードを無効にする */
export const MAX_CODE_FAILURES = 5
/** LAN 全体で、この時間内にこれだけまちがえたら、PC で新しいコードを出すまで登録を受け付けない */
export const LAN_FAILURE_LIMIT = 20
export const LAN_FAILURE_WINDOW_MS = 10 * 60 * 1000

interface PairingState {
  /** 有効なコードの SHA-256。無い(使った・期限切れ・無効にした)ときは null */
  codeHash: string | null
  expiresAt: number
  failures: number
  /** LAN 全体のまちがいの時刻(直近の窓の中だけ) */
  lanFailures: number[]
  locked: boolean
}

const EMPTY: PairingState = { codeHash: null, expiresAt: 0, failures: 0, lanFailures: [], locked: false }

async function loadState(file: string): Promise<PairingState> {
  try {
    const raw = await readJsonFile<Partial<PairingState> | null>(file, null)
    if (!raw || typeof raw !== "object") return { ...EMPTY, lanFailures: [] }
    return {
      codeHash: typeof raw.codeHash === "string" && /^[0-9a-f]{64}$/.test(raw.codeHash) ? raw.codeHash : null,
      expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : 0,
      failures: typeof raw.failures === "number" ? raw.failures : 0,
      lanFailures: Array.isArray(raw.lanFailures) ? raw.lanFailures.filter((t): t is number => typeof t === "number") : [],
      locked: raw.locked === true,
    }
  } catch {
    return { ...EMPTY, lanFailures: [] }
  }
}

export function newPairingCode(): string {
  let code = ""
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  return code
}

/** 打ち込まれたコードを比べられる形にする(大文字・空白とハイフンを除く) */
export function normalizeCode(input: string | null | undefined): string {
  return (input ?? "").toUpperCase().replace(/[\s-]/g, "")
}

/** 新しいコードを出す。前のコードは無効になり、LAN 全体の止めも解ける。コードの平文は、この戻り値でだけ返す */
export async function issuePairingCode(file: string, now: number): Promise<{ code: string; expiresAt: number }> {
  return withFileLock(file, async () => {
    const code = newPairingCode()
    const expiresAt = now + CODE_TTL_MS
    const state: PairingState = { codeHash: hashSecret(code), expiresAt, failures: 0, lanFailures: [], locked: false }
    await writeJsonFile(file, state)
    return { code, expiresAt }
  })
}

export type RedeemResult = "ok" | "expired" | "invalid" | "locked"

/** コードを使う。正しければ、そのコードは2回目から使えない */
export async function redeemPairingCode(file: string, input: string | null | undefined, now: number): Promise<RedeemResult> {
  return withFileLock(file, async () => {
    const state = await loadState(file)
    if (state.locked) return "locked"
    const code = normalizeCode(input)
    if (state.codeHash && state.expiresAt <= now) {
      await writeJsonFile(file, { ...state, codeHash: null })
      return "expired"
    }
    if (state.codeHash && code.length === CODE_LENGTH) {
      const want = Buffer.from(state.codeHash, "hex")
      const got = Buffer.from(hashSecret(code), "hex")
      if (timingSafeEqual(want, got)) {
        await writeJsonFile(file, { ...state, codeHash: null, failures: 0 })
        return "ok"
      }
    }
    // まちがい(使い終わった・無いコードも含む)を数える
    const lanFailures = [...state.lanFailures.filter((t) => now - t < LAN_FAILURE_WINDOW_MS), now]
    const failures = state.codeHash ? state.failures + 1 : state.failures
    const next: PairingState = {
      codeHash: failures >= MAX_CODE_FAILURES ? null : state.codeHash,
      expiresAt: state.expiresAt,
      failures,
      lanFailures,
      locked: lanFailures.length >= LAN_FAILURE_LIMIT,
    }
    await writeJsonFile(file, next)
    return next.locked ? "locked" : "invalid"
  })
}

export interface PairingInfo {
  /** 有効なコードがあるか */
  active: boolean
  expiresAt: number | null
  /** まちがいが多く、登録を止めているか */
  locked: boolean
}

export async function pairingInfo(file: string, now: number): Promise<PairingInfo> {
  const state = await loadState(file)
  const active = state.codeHash !== null && state.expiresAt > now && !state.locked
  return { active, expiresAt: active ? state.expiresAt : null, locked: state.locked }
}
