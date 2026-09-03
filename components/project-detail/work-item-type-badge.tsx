"use client"

import { Tag } from "lucide-react"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export function WorkItemTypeBadge({
  typeId,
  compact = false,
  className,
}: {
  typeId?: string | null
  compact?: boolean
  className?: string
}) {
  const { workItemTypes } = useStore()
  const type = workItemTypes.find((item) => item.id === typeId)
  if (!type) return null

  const color = /^#[0-9a-f]{6}$/i.test(type.color) ? type.color : "#64748B"

  return (
    <span
      className={cn(
        "inline-flex min-w-0 shrink-0 items-center gap-1 rounded-full border font-semibold leading-none",
        compact ? "h-5 max-w-28 px-1.5 text-[0.58rem]" : "h-6 max-w-36 px-2 text-[0.64rem]",
        !type.active && "opacity-65",
        className,
      )}
      style={{
        color,
        borderColor: `${color}45`,
        backgroundColor: `${color}14`,
      }}
      title={`${type.name}${type.active ? "" : " · inativo"}`}
    >
      <Tag className={compact ? "size-2.5 shrink-0" : "size-3 shrink-0"} />
      <span className="truncate">{type.name}</span>
    </span>
  )
}
