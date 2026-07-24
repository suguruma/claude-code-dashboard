"use client"

import { usePathname } from "next/navigation"
import { ProjectSwitcher } from "./ProjectSwitcher"
import { ThemeToggle } from "./ThemeToggle"
import { findNavItem } from "./navConfig"

export function TopBar() {
  const pathname = usePathname()
  const current = findNavItem(pathname)

  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b bg-background px-6 py-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {current && (
          <>
            <current.icon className="size-4" />
            <span className="font-medium text-foreground">{current.label}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <ProjectSwitcher />
      </div>
    </header>
  )
}
