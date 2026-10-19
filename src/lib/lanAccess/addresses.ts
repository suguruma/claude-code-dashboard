import os from "os"

/** `::ffff:192.168.1.5` のような IPv4 の写しを、IPv4 の形にそろえる。IPv4 でなければ null */
export function normalizeIPv4(addr: string | null | undefined): string | null {
  if (!addr) return null
  const a = addr.startsWith("::ffff:") ? addr.slice("::ffff:".length) : addr
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return null
  return a.split(".").every((part) => Number(part) <= 255) ? a : null
}

/** プライベートな IPv4(10/8・172.16/12・192.168/16)か。家の LAN の中のアドレスだけを許すために使う */
export function isPrivateIPv4(addr: string | null | undefined): boolean {
  const a = normalizeIPv4(addr)
  if (!a) return false
  const [o1, o2] = a.split(".").map(Number)
  return o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168)
}

/**
 * 仮想の網(WSL・Hyper-V・Docker・VirtualBox・VMware など)のアダプター。スマホからは届かないので、待ち受けない。
 * これを除かないと、登録コードの QR に、スマホから開けない仮想の網のアドレスが入ることがある
 */
const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|vboxnet|docker|^br-|virbr|Loopback|Bluetooth/i

/** スマホから届きやすい順(家の Wi-Fi に多い 192.168 → 10 → 172.16/12) */
function preference(addr: string): number {
  return addr.startsWith("192.168.") ? 0 : addr.startsWith("10.") ? 1 : 2
}

/**
 * この PC のプライベートな IPv4 アドレス(重複なし)。LAN の入り口は、これらだけで待ち受ける。
 * 仮想の網のアダプターは除き、スマホから届きやすい順に並べる(先頭のアドレスを、登録コードの QR に使う)
 */
export function localPrivateIPv4s(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string[] {
  const found = new Set<string>()
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL_ADAPTER.test(name)) continue
    for (const info of list ?? []) {
      const isV4 = info.family === "IPv4" || (info.family as unknown) === 4
      if (isV4 && !info.internal && isPrivateIPv4(info.address)) found.add(info.address)
    }
  }
  return [...found].sort((a, b) => preference(a) - preference(b) || a.localeCompare(b, "en", { numeric: true }))
}
