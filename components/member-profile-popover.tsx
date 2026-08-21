"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { useRouter } from "next/navigation"
import { FolderKanban, Mail, MessageCircleMore, Send, ShieldCheck, X } from "lucide-react"
import type { Member, MemberPresence } from "@/lib/types"
import { ACCESS_ROLE_LABELS } from "@/lib/types"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type AnchorRect = Pick<DOMRect, "left" | "right" | "top" | "bottom" | "width" | "height">

type MemberProfileContextValue = {
  openMemberProfile: (member: Member, anchor: HTMLElement) => void
  closeMemberProfile: () => void
}

const MemberProfileContext = React.createContext<MemberProfileContextValue | null>(null)

function MemberAvatarVisual({ member, className }: { member: Member; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white",
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


function onlineDurationLabel(onlineSince: string | undefined, now: number) {
  if (!onlineSince) return "agora"
  const started = new Date(onlineSince).getTime()
  if (!Number.isFinite(started)) return "agora"
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  if (seconds < 5) return "agora"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`
}

function ProfilePresenceStatus({ presence, ready }: { presence?: MemberPresence; ready: boolean }) {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!presence?.online || !presence.onlineSince) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [presence?.online, presence?.onlineSince])

  if (!ready) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/45" />
        Verificando status...
      </span>
    )
  }

  if (!presence?.online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/45" />
        Offline
      </span>
    )
  }

  const duration = onlineDurationLabel(presence.onlineSince, now)
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-success">
      <span className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="truncate">{duration === "agora" ? "Online agora" : `Online há ${duration}`}</span>
    </span>
  )
}

function popupPosition(anchor: AnchorRect) {
  const margin = 12
  const gap = 8
  const width = Math.min(360, Math.max(280, window.innerWidth - margin * 2))
  const estimatedHeight = 415
  const left = Math.min(
    Math.max(margin, anchor.left),
    Math.max(margin, window.innerWidth - width - margin),
  )
  const roomBelow = window.innerHeight - anchor.bottom - margin
  const top = roomBelow >= Math.min(estimatedHeight, window.innerHeight - margin * 2)
    ? anchor.bottom + gap
    : Math.max(margin, anchor.top - estimatedHeight - gap)

  return { left, top, width }
}

export function MemberProfileProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { currentUserId, projects, ensureDirectConversation, sendChatMessage, memberPresence, presenceReady } = useStore()
  const [member, setMember] = React.useState<Member | null>(null)
  const [anchorRect, setAnchorRect] = React.useState<AnchorRect | null>(null)
  const [position, setPosition] = React.useState<{ left: number; top: number; width: number } | null>(null)
  const [message, setMessage] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const popupRef = React.useRef<HTMLDivElement | null>(null)
  const anchorElementRef = React.useRef<HTMLElement | null>(null)

  const closeMemberProfile = React.useCallback(() => {
    anchorElementRef.current = null
    setMember(null)
    setAnchorRect(null)
    setPosition(null)
    setMessage("")
    setSending(false)
  }, [])

  const openMemberProfile = React.useCallback((nextMember: Member, anchor: HTMLElement) => {
    anchorElementRef.current = anchor
    const rect = anchor.getBoundingClientRect()
    setMember(nextMember)
    setAnchorRect({
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    })
    setMessage("")
  }, [])

  React.useLayoutEffect(() => {
    if (!member || !anchorRect || typeof window === "undefined") return
    setPosition(popupPosition(anchorRect))
  }, [anchorRect, member])

  React.useEffect(() => {
    if (!member) return

    function onPointerDown(event: PointerEvent) {
      if (popupRef.current?.contains(event.target as Node)) return
      closeMemberProfile()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMemberProfile()
    }
    function onViewportChange() {
      const anchor = anchorElementRef.current
      if (!anchor || !document.documentElement.contains(anchor)) {
        closeMemberProfile()
        return
      }
      const rect = anchor.getBoundingClientRect()
      const nextRect: AnchorRect = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      }
      setAnchorRect(nextRect)
      setPosition(popupPosition(nextRect))
    }

    const timer = window.setTimeout(() => document.addEventListener("pointerdown", onPointerDown), 0)
    window.addEventListener("resize", onViewportChange)
    window.addEventListener("scroll", onViewportChange, true)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("resize", onViewportChange)
      window.removeEventListener("scroll", onViewportChange, true)
    }
  }, [closeMemberProfile, member])

  const sharedProjects = React.useMemo(() => {
    if (!member) return []
    return projects.filter((project) => {
      if (!project.memberIds.includes(member.id)) return false
      return member.id === currentUserId || project.memberIds.includes(currentUserId)
    })
  }, [currentUserId, member, projects])

  async function openConversation(sendMessage: boolean) {
    if (!member || member.id === currentUserId || sending) return
    if (sendMessage && !message.trim()) return

    setSending(true)
    try {
      const conversationId = await ensureDirectConversation(member.id)
      if (!conversationId) return
      if (sendMessage) {
        const sent = await sendChatMessage(conversationId, message.trim())
        if (!sent) return
      }
      closeMemberProfile()
      router.push(`/chat?conversation=${conversationId}`)
    } finally {
      setSending(false)
    }
  }

  const value = React.useMemo<MemberProfileContextValue>(
    () => ({ openMemberProfile, closeMemberProfile }),
    [closeMemberProfile, openMemberProfile],
  )

  return (
    <MemberProfileContext.Provider value={value}>
      {children}
      {member && position && typeof document !== "undefined" && createPortal(
        <div
          ref={popupRef}
          role="dialog"
          aria-label={`Perfil de ${member.name}`}
          className="fixed z-[90] max-h-[calc(100vh-24px)] overflow-y-auto rounded-2xl border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-black/5"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          <div className="h-20 bg-muted/80" />
          <div className="relative px-4 pb-4">
            <div className="relative -mt-9 inline-flex align-top">
              <MemberAvatarVisual member={member} className="size-[74px] border-[5px] border-popover text-lg shadow-sm" />
              {presenceReady && memberPresence[member.id]?.online ? (
                <span
                  className="absolute bottom-1 right-1 size-4 rounded-full border-[3px] border-popover bg-success shadow-sm"
                  aria-label="Online"
                  title="Online"
                />
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeMemberProfile}
              className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-background/85 text-muted-foreground shadow-sm transition-colors hover:bg-background hover:text-foreground"
              aria-label="Fechar perfil"
            >
              <X className="size-4" />
            </button>

            <div className="mt-2 min-w-0">
              <p className="truncate text-lg font-semibold leading-tight">{member.name}</p>
              <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="size-3.5 shrink-0" />
                <span className="truncate">{member.email ?? "Usuário do workspace"}</span>
              </div>
              <div className="mt-1.5 min-w-0">
                <ProfilePresenceStatus presence={memberPresence[member.id]} ready={presenceReady} />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/55 px-2.5 py-1 text-[0.68rem] font-medium">
                <ShieldCheck className="size-3.5 text-primary" />
                {ACCESS_ROLE_LABELS[member.role ?? "member"]}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/55 px-2.5 py-1 text-[0.68rem] font-medium">
                <FolderKanban className="size-3.5 text-primary" />
                {sharedProjects.length} {sharedProjects.length === 1 ? "projeto em comum" : "projetos em comum"}
              </span>
            </div>

            {member.id === currentUserId ? (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/25 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
                Este é o seu perfil. Use Configurações para alterar nome, foto e preferências.
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-border bg-background/55 p-2.5">
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault()
                      void openConversation(true)
                    }
                  }}
                  rows={2}
                  maxLength={2500}
                  placeholder={`Conversar com ${member.name}...`}
                  className="min-h-12 w-full resize-none bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
                />
                <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    disabled={sending}
                    onClick={() => void openConversation(false)}
                  >
                    <MessageCircleMore className="size-3.5" />
                    Abrir conversa
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    disabled={!message.trim()}
                    loading={sending}
                    onClick={() => void openConversation(true)}
                  >
                    <Send className="size-3.5" />
                    Enviar
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </MemberProfileContext.Provider>
  )
}

export function useMemberProfile() {
  return React.useContext(MemberProfileContext)
}
