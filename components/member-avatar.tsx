"use client"

import { cn } from "@/lib/utils"
import type { Member } from "@/lib/types"
import { useStore } from "@/lib/store"

export function MemberAvatar({
  member,
  className,
}: {
  member?: Member
  className?: string
}) {
  if (!member) return null
  return (
    <span
      title={member.name}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold text-white ring-2 ring-card",
        className,
      )}
      style={{ backgroundColor: member.color }}
    >
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt="" className="size-full rounded-[inherit] object-cover" />
      ) : member.initials}
    </span>
  )
}

export function MemberStack({
  ids,
  max = 4,
}: {
  ids: string[]
  max?: number
}) {
  const { members } = useStore()
  const resolved = ids
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m))
  const shown = resolved.slice(0, max)
  const rest = resolved.length - shown.length
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((m) => (
        <MemberAvatar key={m.id} member={m} />
      ))}
      {rest > 0 && (
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-muted text-[0.6rem] font-semibold text-muted-foreground ring-2 ring-card">
          +{rest}
        </span>
      )}
    </div>
  )
}
