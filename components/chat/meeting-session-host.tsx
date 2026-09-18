"use client"

import * as React from "react"
import { useStore } from "@/lib/store"
import { CallRoom } from "@/components/chat/call-room"
import { FINISH_MEETING_EVENT, OPEN_MEETING_EVENT, MINIMIZE_MEETING_EVENT, type MeetingFinishDetail, type MeetingOpenDetail } from "@/lib/meeting-launcher"

const STORAGE_KEY = "devboard.active-meeting.v1"

type StoredMeetingSession = {
  meetingId: string
  minimized: boolean
}

function readStoredSession(): StoredMeetingSession | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredMeetingSession>
    if (typeof parsed.meetingId !== "string" || !parsed.meetingId) return null
    return { meetingId: parsed.meetingId, minimized: Boolean(parsed.minimized) }
  } catch {
    return null
  }
}

function writeStoredSession(value: StoredMeetingSession | null) {
  if (typeof window === "undefined") return
  try {
    if (!value) window.sessionStorage.removeItem(STORAGE_KEY)
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // sessionStorage pode estar indisponível em navegação privada restrita.
  }
}

export function MeetingSessionHost() {
  const { chatMeetings, currentUserId, chatHydrated } = useStore()
  const [activeMeetingId, setActiveMeetingId] = React.useState<string | null>(null)
  const [minimized, setMinimized] = React.useState(false)
  const [finishRequestedMeetingId, setFinishRequestedMeetingId] = React.useState<string | null>(null)
  const restoredRef = React.useRef(false)

  const meeting = React.useMemo(
    () => chatMeetings.find((item) => item.id === activeMeetingId) ?? null,
    [activeMeetingId, chatMeetings],
  )
  const myState = meeting?.memberStates.find((member) => member.userId === currentUserId)

  React.useEffect(() => {
    function onOpenMeeting(event: Event) {
      const detail = (event as CustomEvent<MeetingOpenDetail>).detail
      if (!detail?.meetingId) return
      setActiveMeetingId(detail.meetingId)
      setMinimized(Boolean(detail.minimized))
      writeStoredSession({ meetingId: detail.meetingId, minimized: Boolean(detail.minimized) })
    }

    function onMinimizeMeeting() {
      setMinimized(true)
    }

    function onFinishMeeting(event: Event) {
      const detail = (event as CustomEvent<MeetingFinishDetail>).detail
      if (!detail?.meetingId) return
      setActiveMeetingId(detail.meetingId)
      setMinimized(false)
      setFinishRequestedMeetingId(detail.meetingId)
      writeStoredSession({ meetingId: detail.meetingId, minimized: false })
    }

    window.addEventListener(OPEN_MEETING_EVENT, onOpenMeeting)
    window.addEventListener(MINIMIZE_MEETING_EVENT, onMinimizeMeeting)
    window.addEventListener(FINISH_MEETING_EVENT, onFinishMeeting)
    return () => {
      window.removeEventListener(OPEN_MEETING_EVENT, onOpenMeeting)
      window.removeEventListener(MINIMIZE_MEETING_EVENT, onMinimizeMeeting)
      window.removeEventListener(FINISH_MEETING_EVENT, onFinishMeeting)
    }
  }, [])

  React.useEffect(() => {
    if (!chatHydrated || restoredRef.current) return
    restoredRef.current = true

    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get("meeting")
    const stored = readStoredSession()
    const meetingId = fromUrl || stored?.meetingId
    if (!meetingId) return

    const candidate = chatMeetings.find((item) => item.id === meetingId)
    const state = candidate?.memberStates.find((member) => member.userId === currentUserId)
    if (!candidate || candidate.endedAt || state?.status !== "joined") {
      if (stored?.meetingId === meetingId) writeStoredSession(null)
      return
    }

    setActiveMeetingId(meetingId)
    setMinimized(fromUrl ? false : Boolean(stored?.minimized))

    if (fromUrl) {
      const url = new URL(window.location.href)
      url.searchParams.delete("meeting")
      url.searchParams.delete("join")
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    }
  }, [chatHydrated, chatMeetings, currentUserId])

  React.useEffect(() => {
    if (!activeMeetingId) return
    if (!meeting) {
      if (chatHydrated) {
        setActiveMeetingId(null)
        writeStoredSession(null)
      }
      return
    }
    if (meeting.endedAt || myState?.status !== "joined") {
      setActiveMeetingId(null)
      writeStoredSession(null)
    }
  }, [activeMeetingId, chatHydrated, meeting, myState?.status])

  React.useEffect(() => {
    if (!activeMeetingId) return
    writeStoredSession({ meetingId: activeMeetingId, minimized })
  }, [activeMeetingId, minimized])

  React.useEffect(() => {
    if (!activeMeetingId || minimized) return

    // No Android/PWA o botão físico/gesto “Voltar” dispara popstate. A navegação
    // pode continuar normalmente, mas a chamada vira o popup persistente em vez
    // de permanecer cobrindo a nova tela. Escape faz o mesmo no desktop.
    const minimizeFromNavigation = () => {
      // O preview/editor de imagem cria entradas de histórico próprias para o
      // botão Voltar no Android. Não minimize a reunião enquanto essas camadas
      // estiverem abertas; o primeiro Voltar deve apenas fechar editor/preview.
      if (typeof document !== "undefined" && document.body.dataset.taskboardImageViewerOpen === "true") return
      setMinimized(true)
    }
    const minimizeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      setMinimized(true)
    }

    window.addEventListener("popstate", minimizeFromNavigation)
    window.addEventListener("keydown", minimizeFromKeyboard)
    return () => {
      window.removeEventListener("popstate", minimizeFromNavigation)
      window.removeEventListener("keydown", minimizeFromKeyboard)
    }
  }, [activeMeetingId, minimized])

  const minimizeMeeting = React.useCallback(() => setMinimized(true), [])
  const restoreMeeting = React.useCallback(() => setMinimized(false), [])
  const handleRoomOpenChange = React.useCallback((next: boolean) => {
    if (next) return
    setActiveMeetingId(null)
    setMinimized(false)
    writeStoredSession(null)
  }, [])

  if (!meeting || myState?.status !== "joined" || meeting.endedAt) return null

  return (
    <CallRoom
      meeting={meeting}
      open
      minimized={minimized}
      onMinimize={minimizeMeeting}
      onRestore={restoreMeeting}
      onOpenChange={handleRoomOpenChange}
      finishRequested={finishRequestedMeetingId === meeting.id}
      onFinishRequestHandled={() => setFinishRequestedMeetingId(null)}
    />
  )
}
