/**
 * サーバーの起動の直後の暖機(⑫ ST-10)。一覧の要約と、利用上限の会話記録の台帳を裏で読み始め、
 * 最初の `/api/desktop-sessions`・`/api/usage` の答えを速くする。
 * 答えは待たない(`/api/health` と画面の要求を遅らせない)。失敗しても何もしない(本番の要求で、もう一度読む)。
 * 読み取り専用。読んだ中身は、それぞれのサービスのキャッシュに入るだけで、ほかへは出さない。
 */

export interface WarmUpTasks {
  list: () => Promise<unknown>
  usage: () => Promise<unknown>
}

async function defaultTasks(): Promise<WarmUpTasks> {
  const [{ getDesktopSessionService }, { getUsageService }] = await Promise.all([
    import("./desktopSessionService"),
    import("./usageService"),
  ])
  return {
    list: async () => (await getDesktopSessionService()).list(),
    usage: async () => (await getUsageService()).get(),
  }
}

/** 暖機を始める。終わり(成功・失敗)を待つ Promise を返すが、呼ぶ側は待たない */
export async function warmUp(tasks?: WarmUpTasks): Promise<{ list: boolean; usage: boolean }> {
  let resolved: WarmUpTasks
  try {
    resolved = tasks ?? (await defaultTasks())
  } catch {
    return { list: false, usage: false }
  }
  const [list, usage] = await Promise.allSettled([resolved.list(), resolved.usage()])
  return { list: list.status === "fulfilled", usage: usage.status === "fulfilled" }
}
