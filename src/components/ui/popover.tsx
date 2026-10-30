"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

/**
 * 上のバーの小窓(⑮ 利用上限の札・知らせの鐘)。Base UI の Popover：中身は role=dialog、Esc で閉じ、閉じると押した部品にフォーカスが戻る。
 * 出入りの動きは付けない(動きを減らす設定を気にせずに済むように)
 */
function Popover(props: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverContent({
  className,
  align = "end",
  sideOffset = 6,
  children,
  ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, "align" | "sideOffset">) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner className="isolate z-50 outline-none" align={align} sideOffset={sideOffset}>
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            "max-h-(--available-height) w-[min(26rem,calc(100vw-2rem))] overflow-y-auto rounded-xl bg-popover text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none",
            className
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={cn("text-sm font-semibold", className)} {...props} />
}

export { Popover, PopoverTrigger, PopoverContent, PopoverTitle }
