"use client"

import * as React from "react"
import { BellRing, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"

const SW_PATH = "/devboard-sw.js"

export function BrowserNotifications() {
  const { hydrated, notifications, chatMeetings, members, currentUserId } = useStore()
  const [permission, setPermission] = React.useState<NotificationPermission | "unsupported">("unsupported")
  const [dismissed, setDismissed] = React.useState(false)
  const registrationRef = React.useRef<ServiceWorkerRegistration | null>(null)
  const shownRef = React.useRef(new Set<string>())

  React.useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported")
      return
    }
    setPermission(Notification.permission)
    void navigator.serviceWorker.register(SW_PATH).then((registration) => {
      registrationRef.current = registration
    }).catch(() => {
      // A notificação interna continua funcionando mesmo sem Service Worker.
    })
  }, [])

  React.useEffect(() => {
    if (!hydrated || permission !== "granted") return

    const pending = notifications
      .filter((notification) => notification.type === "meeting-invite" && notification.recipientId === currentUserId && notification.meetingId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    for (const notification of pending) {
      const meeting = chatMeetings.find((item) => item.id === notification.meetingId)
      const memberState = meeting?.memberStates.find((member) => member.userId === currentUserId)
      if (!meeting || meeting.endedAt || memberState?.status !== "pending") continue
      if (shownRef.current.has(notification.id)) continue
      shownRef.current.add(notification.id)

      const caller = members.find((member) => member.id === notification.actorId)
      const title = meeting.mode === "video" ? "Chamada de vídeo recebida" : "Chamada de áudio recebida"
      const body = `${caller?.name ?? "Um usuário"} está chamando você${meeting.title ? ` · ${meeting.title}` : ""}. Abra o Devboard para atender.`
      const options: NotificationOptions = {
        body,
        icon: "/devboard-icon-192.png",
        badge: "/devboard-icon-64.png",
        tag: `devboard-call-${meeting.id}`,
        requireInteraction: true,
        data: { url: `/chat?meeting=${encodeURIComponent(meeting.id)}` },
      }

      void (async () => {
        try {
          const registration = registrationRef.current ?? await navigator.serviceWorker.ready
          await registration.showNotification(title, options)
        } catch {
          try {
            new Notification(title, options)
          } catch {
            // Sem permissão/contexto seguro: o modal interno ainda será exibido.
          }
        }
      })()
    }
  }, [chatMeetings, currentUserId, hydrated, members, notifications, permission])

  React.useEffect(() => {
    if (!hydrated || permission !== "granted") return
    const pending = notifications
      .filter((notification) => {
        if (notification.recipientId !== currentUserId || notification.readAt || !notification.projectId) return false
        if (notification.type === "followup-mention") return true
        if (notification.type !== "followup-subactivity-opened") return false
        return Date.now() - new Date(notification.createdAt).getTime() <= 10 * 60 * 1000
      })
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

    for (const notification of pending) {
      if (shownRef.current.has(notification.id)) continue
      shownRef.current.add(notification.id)
      const actor = members.find((member) => member.id === notification.actorId)
      const params = new URLSearchParams({ project: notification.projectId! })
      if (notification.subactivityId) params.set("sub", notification.subactivityId)
      const target = `/acompanhamento?${params.toString()}`
      const isMention = notification.type === "followup-mention"
      const options: NotificationOptions = {
        body: notification.description || (isMention
          ? `${actor?.name ?? "Um usuário"} mencionou você no acompanhamento.`
          : `${actor?.name ?? "Um usuário"} abriu uma nova subatividade.`),
        icon: "/devboard-icon-192.png",
        badge: "/devboard-icon-64.png",
        tag: `devboard-followup-${notification.id}`,
        data: { url: target },
      }
      void (async () => {
        try {
          const registration = registrationRef.current ?? await navigator.serviceWorker.ready
          await registration.showNotification(notification.title || (isMention ? "Menção no acompanhamento" : "Nova subatividade"), options)
        } catch {
          try { new Notification(notification.title || (isMention ? "Menção no acompanhamento" : "Nova subatividade"), options) } catch {}
        }
      })()
    }
  }, [currentUserId, hydrated, members, notifications, permission])

  async function enable() {
    if (!("Notification" in window)) return
    const next = await Notification.requestPermission()
    setPermission(next)
    setDismissed(next !== "granted")
  }

  if (!hydrated || permission !== "default" || dismissed) return null

  return (
    <div className="fixed right-3 top-[4.6rem] z-40 w-[min(360px,calc(100vw-1.5rem))] rounded-2xl border border-border bg-card p-3 shadow-lg sm:right-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <BellRing className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold">Ativar notificações do navegador</p>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-muted-foreground">
            Permita notificações para receber chamadas, menções e alertas importantes do acompanhamento mesmo quando o Devboard estiver em segundo plano.
          </p>
          <Button type="button" size="sm" className="mt-2 h-8" onClick={() => void enable()}>
            Ativar notificações
          </Button>
        </div>
        <button
          type="button"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setDismissed(true)}
          aria-label="Agora não"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
