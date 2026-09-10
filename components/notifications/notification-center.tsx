"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AtSign,
  Bell,
  CheckCheck,
  ClipboardCheck,
  ClipboardList,
  FolderKanban,
  ListTodo,
  Inbox,
  LoaderCircle,
  MessageSquareText,
  PhoneIncoming,
  UserPlus,
  TriangleAlert,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import type { NotificationEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { MemberName } from "@/components/member-avatar"
import { openProjectFollowUp } from "@/lib/follow-up-launcher"
import { AnchoredPopoverPortal } from "@/components/ui/anchored-popover-portal"

const iconByType = {
  "project-assigned": FolderKanban,
  "activity-assigned": ListTodo,
  "subactivity-assigned": UserPlus,
  "subactivity-comment": MessageSquareText,
  "meeting-invite": PhoneIncoming,
  "aqs-awaiting": ClipboardCheck,
  "aqs-approved": ClipboardCheck,
  "aqs-revoked": TriangleAlert,
  "topic-created": ClipboardList,
  "topic-status": ClipboardList,
  "topic-sent": ClipboardList,
  "chat-mention": AtSign,
  "followup-mention": AtSign,
  "followup-update": MessageSquareText,
  "followup-subactivity-opened": UserPlus,
  "request-created": Inbox,
  "request-assigned": UserPlus,
  "request-status": ClipboardCheck,
  "request-mention": AtSign,
} satisfies Record<NotificationEntry["type"], React.ComponentType<{ className?: string }>>

function formatNotificationDate(value: string) {
  const date = new Date(value)
  const now = new Date()
  const diffSeconds = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000))
  if (diffSeconds < 60) return "agora"
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} min`
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} h`
  if (diffSeconds < 604800) return `${Math.floor(diffSeconds / 86400)} d`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

export function NotificationCenter({ compact = false, popoverSide = "bottom" }: { compact?: boolean; popoverSide?: "bottom" | "right" }) {
  const router = useRouter()
  const {
    notifications,
    members,
    currentUserId,
    markNotificationRead,
    markAllNotificationsRead,
  } = useStore()
  const [open, setOpen] = React.useState(false)
  const [markingAll, setMarkingAll] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const closePopover = React.useCallback(() => setOpen(false), [])

  const myNotifications = React.useMemo(
    () =>
      notifications
        .filter((notification) => notification.recipientId === currentUserId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notifications, currentUserId],
  )
  const unreadCount = myNotifications.filter((notification) => !notification.readAt).length

  function openNotification(notification: NotificationEntry) {
    setOpen(false)
    if (notification.type === "meeting-invite" && notification.meetingId) {
      router.push(`/chat?meeting=${encodeURIComponent(notification.meetingId)}`)
      return
    }

    void markNotificationRead(notification.id)
    if (notification.type === "chat-mention" && notification.conversationId) {
      router.push(`/chat?conversation=${encodeURIComponent(notification.conversationId)}`)
      return
    }
    if (notification.requestId && notification.type.startsWith("request-")) {
      router.push(`/solicitacoes/${encodeURIComponent(notification.requestId)}`)
      return
    }
    if ((notification.type === "followup-mention" || notification.type === "followup-update" || notification.type === "followup-subactivity-opened" || notification.type === "subactivity-comment") && notification.projectId) {
      openProjectFollowUp({
        projectId: notification.projectId,
        activityId: notification.activityId,
        subactivityId: notification.subactivityId,
      })
      return
    }
    if (notification.type === "aqs-awaiting") {
      const suffix = notification.subactivityId ? `?sub=${encodeURIComponent(notification.subactivityId)}` : ""
      router.push(`/analise${suffix}`)
      return
    }
    if (notification.type === "topic-created" || notification.type === "topic-status") {
      router.push("/solicitacoes")
      return
    }
    if (!notification.projectId) return
    const hash = notification.subactivityId
      ? `#sub-${notification.subactivityId}`
      : notification.activityId
        ? `#activity-${notification.activityId}`
        : ""
    router.push(`/projetos/${notification.projectId}${hash}`)
  }

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative flex size-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          compact ? "rounded-full" : "rounded-xl border border-border bg-card",
          open && (compact ? "bg-primary/10 text-primary" : "border-primary/25 bg-primary/[0.06] text-foreground"),
        )}
        aria-label={unreadCount ? `Notificações, ${unreadCount} não lidas` : "Notificações"}
        aria-expanded={open}
      >
        <Bell className="size-[1.1rem]" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4.5 items-center justify-center rounded-full bg-primary px-1 font-mono text-[0.58rem] font-semibold leading-[18px] text-primary-foreground ring-2 ring-background">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <AnchoredPopoverPortal
        open={open}
        anchorRef={wrapperRef}
        onClose={closePopover}
        side={popoverSide}
        desktopWidth={380}
        ariaLabel="Notificações"
      >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Notificações</p>
              <p className="text-[0.68rem] text-muted-foreground">
                {unreadCount ? `${unreadCount} não ${unreadCount === 1 ? "lida" : "lidas"}` : "Tudo em dia"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    if (markingAll) return
                    setMarkingAll(true)
                    void markAllNotificationsRead().finally(() => setMarkingAll(false))
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[0.68rem] font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  {markingAll ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                  <span className="hidden min-[380px]:inline">{markingAll ? "Marcando..." : "Marcar lidas"}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
                aria-label="Fechar notificações"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 md:max-h-[min(430px,65vh)] md:flex-none">
            {myNotifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <Bell className="mx-auto size-5 text-muted-foreground/60" />
                <p className="mt-2 text-sm font-medium">Nenhuma notificação</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mensagens, anexos, mudanças de status, marcações e chamadas aparecerão aqui.
                </p>
              </div>
            ) : (
              myNotifications.map((notification) => {
                const Icon = iconByType[notification.type]
                const actor = members.find((member) => member.id === notification.actorId)
                return (
                  <button
                    key={notification.id}
                    type="button"
                    onClick={() => openNotification(notification)}
                    className={cn(
                      "group flex w-full min-w-0 gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted",
                      !notification.readAt && "bg-primary/[0.055]",
                    )}
                  >
                    <span className="relative mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:text-foreground">
                      <Icon className="size-4" />
                      {!notification.readAt && (
                        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-card" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold leading-snug">{notification.title}</span>
                      {notification.description && (
                        <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                          {notification.description}
                        </span>
                      )}
                      <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                        <MemberName member={actor} className="truncate" fallback="Usuário" />
                        <span>·</span>
                        <span className="shrink-0">{formatNotificationDate(notification.createdAt)}</span>
                      </span>
                    </span>
                  </button>
                )
              })
            )}
          </div>
      </AnchoredPopoverPortal>
    </div>
  )
}
