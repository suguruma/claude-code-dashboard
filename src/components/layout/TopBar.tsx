"use client"

import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProjectSwitcher } from "./ProjectSwitcher"
import { ThemeToggle } from "./ThemeToggle"
import { findNavItem } from "./navConfig"

interface TopBarProps {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const pathname = usePathname()
  const current = findNavItem(pathname)

  return (
    <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b bg-background px-4 py-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 md:hidden"
          onClick={onMenuClick}
          aria-label="メニューを開く"
        >
          <Menu className="size-4" />
        </Button>
        {current && (
          <>
            <current.icon className="size-4 shrink-0" />
            <span className="truncate font-medium text-foreground">{current.label}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ProjectSwitcher />
        <ThemeToggle />
      </div>
    </header>
  )
}
