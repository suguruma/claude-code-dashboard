"use client"

import { usePathname } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProjectSwitcher } from "./ProjectSwitcher"
import { ThemeToggle } from "./ThemeToggle"
import { findNavItem, showsProjectSwitcher } from "./navConfig"

interface TopBarProps {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const pathname = usePathname()
  const current = findNavItem(pathname)

  return (
    // 上のバーの幅(サイドバーの開閉でも変わる)で並べ方を決めるため、画面の幅ではなくコンテナクエリ(@container)を使う。
    // 幅が 42rem 未満のときは、プロジェクトの切り替えを2段目に回して、ページ名とボタンが重ならないようにする
    <header className="@container sticky top-0 z-10 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b bg-background px-4 py-3 sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
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
      {/* プロジェクトの切り替えは、選んでいるプロジェクトを使うページだけに出す(ホーム・Claude Desktop には出さない) */}
      {showsProjectSwitcher(pathname) && (
        <div className="order-last flex w-full min-w-0 @2xl:order-none @2xl:w-auto">
          <ProjectSwitcher />
        </div>
      )}
      <ThemeToggle />
    </header>
  )
}
