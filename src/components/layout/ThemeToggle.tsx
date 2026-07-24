"use client"

import { Moon, Sun, SunMoon } from "lucide-react"
import { useTheme } from "next-themes"
import { useMounted } from "@/hooks/useMounted"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const OPTIONS = [
  { value: "light", label: "ライト", icon: Sun },
  { value: "dark", label: "ダーク", icon: Moon },
  { value: "system", label: "システムに合わせる", icon: SunMoon },
] as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const mounted = useMounted()

  // マウント完了までサーバーと同じsystemアイコンを描画し、Hydration Mismatchを避ける
  const current = mounted ? (OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2]) : OPTIONS[2]
  const Icon = current.icon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="テーマを切り替え" />}>
        <Icon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => (
          <DropdownMenuItem key={option.value} onClick={() => setTheme(option.value)}>
            <option.icon className="size-4" />
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
