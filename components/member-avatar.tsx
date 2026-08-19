"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { Member } from "@/lib/types"
import { useStore } from "@/lib/store"
import { useMemberProfile } from "@/components/member-profile-popover"

export function MemberAvatar({
  member,
  className,
  profileEnabled = true,
}: {
  member?: Member
  className?: string
  profileEnabled?: boolean
}) {
  const profile = useMemberProfile()
  if (!member) return null

  const content = (
    <span
      title={member.name}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[0.6rem] font-semibold text-white ring-2 ring-card",
        profileEnabled && profile && "cursor-pointer transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/45",
        className,
      )}
      style={{ backgroundColor: member.color }}
    >
      {member.avatarUrl ? (
        <img src={member.avatarUrl} alt="" className="size-full rounded-[inherit] object-cover" />
      ) : member.initials}
    </span>
  )

  if (!profileEnabled || !profile) return content

  return React.cloneElement(content, {
    role: "button",
    tabIndex: 0,
    "aria-label": `Abrir perfil de ${member.name}`,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      profile.openMemberProfile(member, event.currentTarget)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      event.stopPropagation()
      profile.openMemberProfile(member, event.currentTarget)
    },
  })
}

export function MemberName({
  member,
  className,
  fallback = "Usuário",
  label,
  suffix,
}: {
  member?: Member
  className?: string
  fallback?: string
  label?: React.ReactNode
  suffix?: React.ReactNode
}) {
  const profile = useMemberProfile()
  if (!member) return <span className={className}>{fallback}{suffix}</span>

  return (
    <span
      role={profile ? "button" : undefined}
      tabIndex={profile ? 0 : undefined}
      title={profile ? `Abrir perfil de ${member.name}` : undefined}
      className={cn(profile && "cursor-pointer hover:text-primary focus-visible:outline-none focus-visible:text-primary", className)}
      onClick={profile ? (event) => {
        event.preventDefault()
        event.stopPropagation()
        profile.openMemberProfile(member, event.currentTarget)
      } : undefined}
      onKeyDown={profile ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        event.stopPropagation()
        profile.openMemberProfile(member, event.currentTarget)
      } : undefined}
    >
      {label ?? member.name}{suffix}
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
