"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { HELP_ITEM, NAV_GROUPS, type NavItem } from "./navConfig"

export function SideNav() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150",
        collapsed ? "w-16" : "w-60"
      )}
    >
      <div className={cn("flex items-center gap-2 px-3 py-4", collapsed && "justify-center px-0")}>
        <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
            CC
          </span>
          {!collapsed && <span className="truncate text-sm">Claude Code Dashboard</span>}
        </Link>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label ?? groupIndex} className="space-y-1">
            {group.label && !collapsed && (
              <p className="px-2.5 pt-2 text-[11px] font-medium tracking-wide text-sidebar-foreground/50 uppercase">
                {group.label}
              </p>
            )}
            {group.label && collapsed && <div className="mx-2 my-2 h-px bg-sidebar-border" />}
            {group.items.map((item) => (
              <NavRow key={item.href} item={item} active={pathname === item.href} collapsed={collapsed} />
            ))}
          </div>
        ))}
      </nav>

      <div className={cn("space-y-1 border-t border-sidebar-border p-2", collapsed && "flex flex-col items-center")}>
        <NavRow item={HELP_ITEM} active={pathname === HELP_ITEM.href} collapsed={collapsed} />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "サイドバーを開く" : "サイドバーを閉じる"}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>
    </aside>
  )
}

function NavRow({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  const Icon = item.icon

  const content = item.disabled ? (
    <span
      className={cn(
        "flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground/40",
        collapsed && "justify-center px-0"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </span>
  ) : (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground/80",
        collapsed && "justify-center px-0"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  )

  if (!collapsed && !item.disabled) {
    return content
  }

  const tooltipLabel = item.disabled ? `${item.label}（${item.disabledReason}）` : item.label

  return (
    <Tooltip>
      <TooltipTrigger render={<div />}>{content}</TooltipTrigger>
      <TooltipContent side="right">{tooltipLabel}</TooltipContent>
    </Tooltip>
  )
}
