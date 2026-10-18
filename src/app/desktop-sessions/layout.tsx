import type { ReactNode } from "react"
import { DesktopSessionsFrame } from "@/components/desktopSessions/DesktopSessionsFrame"

export default function DesktopSessionsLayout({ children }: { children: ReactNode }) {
  return <DesktopSessionsFrame>{children}</DesktopSessionsFrame>
}
