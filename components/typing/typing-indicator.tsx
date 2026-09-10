"use client"

import * as React from "react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

const TYPING_IDLE_MS = 1800
const TYPING_TTL_MS = 5200

type TypingPresence = {
  user_id?: string
  typing?: boolean
  updated_at?: string
  presence_ref?: string
}

function safeTypingTopicPart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .slice(0, 160)
}

function sameIds(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

export function useTypingIndicator(scopeKey: string | null | undefined, enabled = true) {
  const { workspaceId, currentUserId, members } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const channelRef = React.useRef<RealtimeChannel | null>(null)
  const subscribedRef = React.useRef(false)
  const desiredTypingRef = React.useRef(false)
  const idleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const [typingUserIds, setTypingUserIds] = React.useState<string[]>([])

  const currentMemberName = React.useMemo(
    () => members.find((member) => member.id === currentUserId)?.name ?? "Usuário",
    [currentUserId, members],
  )

  const publish = React.useCallback((typing: boolean) => {
    desiredTypingRef.current = typing
    const channel = channelRef.current
    if (!channel || !subscribedRef.current) return
    void channel.track({
      user_id: currentUserId,
      user_name: currentMemberName,
      typing,
      updated_at: new Date().toISOString(),
    })
  }, [currentMemberName, currentUserId])

  const stopTyping = React.useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
    publish(false)
  }, [publish])

  const reportTyping = React.useCallback((value: string | boolean) => {
    const typing = enabled && (typeof value === "boolean" ? value : value.trim().length > 0)
    if (!typing) {
      stopTyping()
      return
    }

    publish(true)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null
      publish(false)
    }, TYPING_IDLE_MS)
  }, [enabled, publish, stopTyping])

  React.useEffect(() => {
    if (!workspaceId || !currentUserId || !scopeKey) {
      subscribedRef.current = false
      channelRef.current = null
      setTypingUserIds([])
      return
    }

    const topicPart = safeTypingTopicPart(scopeKey)
    if (!topicPart) return

    let disposed = false
    const channel = supabase.channel(`taskboard-typing:${workspaceId}:${topicPart}`, {
      config: { presence: { key: currentUserId } },
    })
    channelRef.current = channel

    const syncPresence = () => {
      if (disposed) return
      const now = Date.now()
      const state = channel.presenceState() as Record<string, TypingPresence[]>
      const next = new Set<string>()

      for (const [presenceKey, presences] of Object.entries(state)) {
        for (const presence of presences ?? []) {
          const userId = presence.user_id || presenceKey
          if (!userId || userId === currentUserId || !presence.typing) continue
          const updatedAt = presence.updated_at ? new Date(presence.updated_at).getTime() : 0
          if (!updatedAt || Number.isNaN(updatedAt) || now - updatedAt > TYPING_TTL_MS) continue
          next.add(userId)
        }
      }

      const ids = Array.from(next).sort()
      setTypingUserIds((current) => sameIds(current, ids) ? current : ids)
    }

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status) => {
        if (disposed) return
        subscribedRef.current = status === "SUBSCRIBED"
        if (status === "SUBSCRIBED") {
          void channel.track({
            user_id: currentUserId,
            user_name: currentMemberName,
            typing: desiredTypingRef.current,
            updated_at: new Date().toISOString(),
          })
        }
      })

    const expiryTimer = setInterval(syncPresence, 1200)

    return () => {
      disposed = true
      clearInterval(expiryTimer)
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      subscribedRef.current = false
      desiredTypingRef.current = false
      if (channelRef.current === channel) channelRef.current = null
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel)
      })
      setTypingUserIds([])
    }
  }, [currentMemberName, currentUserId, scopeKey, supabase, workspaceId])

  React.useEffect(() => {
    if (!enabled) stopTyping()
  }, [enabled, stopTyping])

  const typingMembers = React.useMemo(
    () => typingUserIds
      .map((id) => members.find((member) => member.id === id))
      .filter((member): member is NonNullable<typeof member> => Boolean(member)),
    [members, typingUserIds],
  )

  return { typingMembers, reportTyping, stopTyping }
}

export function TypingIndicator({
  members,
  className,
}: {
  members: Array<{ id: string; name: string }>
  className?: string
}) {
  if (!members.length) return null

  const names = members.map((member) => member.name)
  const label = names.length === 1
    ? `${names[0]} está digitando...`
    : names.length === 2
      ? `${names[0]} e ${names[1]} estão digitando...`
      : `${names[0]}, ${names[1]} e mais ${names.length - 2} estão digitando...`

  return (
    <div aria-live="polite" className={cn("flex min-h-5 items-center gap-2 text-[0.62rem] font-medium text-muted-foreground", className)}>
      <span className="flex items-center gap-0.5" aria-hidden="true">
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:140ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/70 [animation-delay:280ms]" />
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}
