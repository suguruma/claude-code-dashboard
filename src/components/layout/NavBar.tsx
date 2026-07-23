"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { ProjectSwitcher } from "./ProjectSwitcher"

const NAV_ITEMS = [
  { href: "/", label: "ホーム" },
  { href: "/rules", label: "ルール & スキル" },
  { href: "/trace", label: "実行ログ" },
  { href: "/refactor", label: "GPUモード", disabled: true },
]

export function NavBar() {
  const pathname = usePathname()

  return (
    <header className="border-b bg-background sticky top-0 z-10">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold tracking-tight">
            Claude Code Dashboard
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) =>
              item.disabled ? (
                <span
                  key={item.href}
                  className="rounded-md px-3 py-1.5 text-sm text-muted-foreground/50 cursor-not-allowed"
                  title="GPUモード（機能3）は次回実装予定です"
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    pathname === item.href
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  {item.label}
                </Link>
              )
            )}
          </nav>
        </div>
        <ProjectSwitcher />
      </div>
    </header>
  )
}
