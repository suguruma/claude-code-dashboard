import type os from "os"
import { describe, expect, it } from "vitest"
import { isPrivateIPv4, localPrivateIPv4s, normalizeIPv4 } from "./addresses"

describe("LAN の入り口のアドレス", () => {
  it("プライベートな IPv4 は 10/8・172.16/12・192.168/16 だけ（IPv4 の写しの形も見る）", () => {
    for (const a of ["10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.5", "::ffff:192.168.1.5"]) expect(isPrivateIPv4(a), a).toBe(true)
    for (const a of ["127.0.0.1", "172.15.0.1", "172.32.0.1", "192.169.0.1", "8.8.8.8", "169.254.1.1", "::1", "fe80::1", "", null, undefined, "999.168.1.1"]) {
      expect(isPrivateIPv4(a), String(a)).toBe(false)
    }
    expect(normalizeIPv4("::ffff:10.1.2.3")).toBe("10.1.2.3")
  })

  it("この PC のアドレスは、内部（ループバック）・IPv6・プライベートでないもの・仮想の網（WSL・Hyper-V など）を除き、192.168 → 10 → 172 の順", () => {
    const info = (address: string, family: string, internal = false) => ({ address, family, internal, netmask: "", mac: "", cidr: null }) as unknown as os.NetworkInterfaceInfo
    const ifaces = {
      lo: [info("127.0.0.1", "IPv4", true)],
      wifi: [info("192.168.10.5", "IPv4"), info("fe80::1", "IPv6")],
      vpn: [info("100.64.0.2", "IPv4")],
      eth: [info("10.0.0.7", "IPv4"), info("192.168.10.5", "IPv4")],
      "有線 LAN": [info("172.20.1.9", "IPv4")],
      "vEthernet (Default Switch)": [info("172.21.48.1", "IPv4")],
      "vEthernet (WSL (Hyper-V firewall))": [info("172.25.0.1", "IPv4")],
      "VirtualBox Host-Only Network": [info("192.168.56.1", "IPv4")],
      docker0: [info("172.17.0.1", "IPv4")],
    }
    expect(localPrivateIPv4s(ifaces)).toEqual(["192.168.10.5", "10.0.0.7", "172.20.1.9"])
  })
})
