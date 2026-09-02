"use client"

import * as React from "react"
import { useStore } from "@/lib/store"
import { followUpUnreadCount, followUpUnreadLevel } from "@/lib/follow-up-unread"

const BADGED_ICON_ID = "devboard-followup-badged-favicon"
const BASE_ICON = "/devboard-icon-64.png"

export function FollowUpAppBadge() {
  const { hydrated, notifications, currentUserId } = useStore()
  const unread = React.useMemo(
    () => notifications.filter((notification) => notification.recipientId === currentUserId && !notification.readAt),
    [currentUserId, notifications],
  )
  const count = React.useMemo(() => followUpUnreadCount(unread, currentUserId), [currentUserId, unread])
  const level = React.useMemo(() => followUpUnreadLevel(unread), [unread])

  React.useEffect(() => {
    if (!hydrated || typeof document === "undefined") return

    const cleanTitle = document.title.replace(/^[●@]\s+/, "")
    document.title = count > 0 ? `${level === "mention" ? "@" : "●"} ${cleanTitle}` : cleanTitle

    const nav = navigator as Navigator & {
      setAppBadge?: (contents?: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined)
    else void nav.clearAppBadge?.().catch(() => undefined)

    const existing = document.getElementById(BADGED_ICON_ID) as HTMLLinkElement | null
    if (count === 0) {
      existing?.remove()
      return
    }

    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const canvas = document.createElement("canvas")
      canvas.width = 64
      canvas.height = 64
      const context = canvas.getContext("2d")
      if (!context) return
      context.drawImage(image, 0, 0, 64, 64)

      const badgeColor = level === "mention" ? "#f43f5e" : "#38bdf8"
      context.beginPath()
      context.arc(50, 14, 11, 0, Math.PI * 2)
      context.fillStyle = "#ffffff"
      context.fill()
      context.beginPath()
      context.arc(50, 14, 8, 0, Math.PI * 2)
      context.fillStyle = badgeColor
      context.fill()

      const href = canvas.toDataURL("image/png")
      const link = existing ?? document.createElement("link")
      link.id = BADGED_ICON_ID
      link.rel = "icon"
      link.type = "image/png"
      link.href = href
      if (!existing) document.head.appendChild(link)
    }
    image.src = BASE_ICON

    return () => {
      cancelled = true
    }
  }, [count, hydrated, level])

  React.useEffect(() => () => {
    if (typeof document === "undefined") return
    document.title = document.title.replace(/^[●@]\s+/, "")
    document.getElementById(BADGED_ICON_ID)?.remove()
    const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> }
    void nav.clearAppBadge?.().catch(() => undefined)
  }, [])

  return null
}
