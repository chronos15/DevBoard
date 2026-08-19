"use client"

import * as React from "react"
import {
  Camera,
  CameraOff,
  ChevronLeft,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  Maximize2,
  Minimize2,
  PhoneOff,
  Settings2,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
} from "lucide-react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import type { ChatMeeting, Member } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { loadWebRtcIceConfig } from "@/lib/webrtc/ice-servers"
import { getCallAudioContext, primeCallAudio, resumeCallAudio } from "@/lib/webrtc/audio-playback"
import {
  configureAndroidScreenShare,
  forwardAndroidScreenSignal,
  hasAndroidNativeScreenShare,
  requestAndroidScreenShare,
  stopAndroidScreenShare,
  subscribeAndroidScreenSignal,
  subscribeAndroidScreenState,
  syncAndroidScreenRecipients,
  type NativeScreenSignal,
} from "@/lib/webrtc/android-screen-share"

type Presence = {
  sessionId: string
  userId: string
  micEnabled: boolean
  cameraEnabled: boolean
  screenSharing: boolean
  mediaRevision: number
  joinedAt: string
}

type MediaStateSignal = {
  meetingId: string
  fromSession: string
  fromUserId: string
  micEnabled: boolean
  cameraEnabled: boolean
  screenSharing: boolean
  mediaRevision: number
  sentAt: string
}

type CallSignal = {
  type: "offer" | "answer" | "ice" | "restart-request"
  meetingId: string
  fromSession: string
  fromUserId: string
  toSession: string
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

type PeerSenders = {
  audio: RTCRtpSender
  video: RTCRtpSender
}

type PeerRoleState = {
  offerer: boolean
  initialOfferSent: boolean
  offerInFlight: boolean
  restartPending: boolean
}

type PanelMode = "participants" | "settings" | null

function makeSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours, minutes, rest].map((value) => String(value).padStart(2, "0")).join(":")
}

function deviceLabel(device: MediaDeviceInfo, index: number, kind: "microfone" | "câmera") {
  return device.label || `${kind === "microfone" ? "Microfone" : "Câmera"} ${index + 1}`
}

function ParticipantTile({
  member,
  own,
  connected,
  connectionState,
  presence,
  cameraEnabled,
  micEnabled,
  screenSharing,
  localVideoRef,
  remoteStream,
  remoteScreenStream,
  nativeScreenShare,
  prioritized,
  compact,
  onPrioritize,
  deafened,
}: {
  member: Member
  own?: boolean
  connected: boolean
  connectionState?: RTCPeerConnectionState
  presence?: Presence
  cameraEnabled?: boolean
  micEnabled?: boolean
  screenSharing?: boolean
  localVideoRef?: React.RefObject<HTMLVideoElement | null>
  remoteStream?: MediaStream
  remoteScreenStream?: MediaStream
  nativeScreenShare?: boolean
  prioritized?: boolean
  compact?: boolean
  onPrioritize?: () => void
  deafened?: boolean
}) {
  const tileRef = React.useRef<HTMLDivElement | null>(null)
  const remoteVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const remoteAudioRef = React.useRef<HTMLAudioElement | null>(null)
  const webAudioRef = React.useRef<{
    source: MediaStreamAudioSourceNode
    gain: GainNode
    trackId: string
  } | null>(null)
  const [playbackBlocked, setPlaybackBlocked] = React.useState(false)
  const [mediaTick, setMediaTick] = React.useState(0)
  const [videoPlaying, setVideoPlaying] = React.useState(false)
  const [videoFrameReady, setVideoFrameReady] = React.useState(false)
  const [fullscreen, setFullscreen] = React.useState(false)
  const micOn = own ? Boolean(micEnabled) : presence?.micEnabled ?? false
  const camOn = own
    ? Boolean(cameraEnabled || (screenSharing && !nativeScreenShare))
    : Boolean(presence?.cameraEnabled || presence?.screenSharing)
  const presentingScreen = own ? Boolean(screenSharing) : Boolean(presence?.screenSharing)
  const remoteVideoSource = !own && presence?.screenSharing && remoteScreenStream ? remoteScreenStream : remoteStream
  const remoteVideoTracks = remoteVideoSource?.getVideoTracks() ?? []
  const remoteHasVideo = remoteVideoTracks.some((track) => track.readyState === "live" && !track.muted)
  const showVideo = own
    ? camOn
    : Boolean(connected && camOn && remoteHasVideo && videoPlaying && videoFrameReady)

  const disconnectWebAudio = React.useCallback(() => {
    const current = webAudioRef.current
    if (!current) return
    try { current.source.disconnect() } catch {}
    try { current.gain.disconnect() } catch {}
    webAudioRef.current = null
  }, [])

  const attachWebAudio = React.useCallback(async () => {
    if (own || !remoteStream) return false
    const audioTrack = remoteStream.getAudioTracks().find((track) => track.readyState === "live")
    if (!audioTrack) return false

    await resumeCallAudio()
    const context = getCallAudioContext()
    if (!context || context.state !== "running") return false

    const existing = webAudioRef.current
    if (existing?.trackId === audioTrack.id) {
      existing.gain.gain.value = deafened ? 0 : 1
      return true
    }

    disconnectWebAudio()
    try {
      const source = context.createMediaStreamSource(new MediaStream([audioTrack]))
      const gain = context.createGain()
      gain.gain.value = deafened ? 0 : 1
      source.connect(gain)
      gain.connect(context.destination)
      webAudioRef.current = { source, gain, trackId: audioTrack.id }
      return true
    } catch (error) {
      console.warn("Devboard: Web Audio não conseguiu reproduzir a track remota", error)
      return false
    }
  }, [deafened, disconnectWebAudio, own, remoteStream])

  const playRemote = React.useCallback(async () => {
    if (own || !remoteStream) return
    const video = remoteVideoRef.current
    const audio = remoteAudioRef.current

    if (video) {
      if (video.srcObject !== remoteVideoSource) video.srcObject = remoteVideoSource ?? null
      // O vídeo remoto nunca reproduz áudio; a saída de som é tratada separadamente.
      video.muted = true
      void video.play().catch(() => undefined)
    }

    if (deafened) {
      if (audio) audio.muted = true
      const node = webAudioRef.current
      if (node) node.gain.gain.value = 0
      setPlaybackBlocked(false)
      return
    }

    const webAudioReady = await attachWebAudio()
    if (webAudioReady) {
      if (audio) audio.muted = true
      setPlaybackBlocked(false)
      return
    }

    if (!audio) return
    const audioTracks = remoteStream.getAudioTracks().filter((track) => track.readyState === "live")
    const audioStream = new MediaStream(audioTracks)
    if (!(audio.srcObject instanceof MediaStream) || audio.srcObject.getAudioTracks()[0]?.id !== audioTracks[0]?.id) {
      audio.srcObject = audioStream
    }
    audio.muted = false
    try {
      await audio.play()
      setPlaybackBlocked(false)
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setPlaybackBlocked(true)
      }
    }
  }, [attachWebAudio, deafened, own, remoteScreenStream, remoteStream, remoteVideoSource])

  React.useEffect(() => {
    if (own || !remoteStream) return
    const video = remoteVideoRef.current
    if (video) {
      video.srcObject = remoteVideoSource ?? remoteStream
      video.muted = true
    }
    void playRemote()

    const refresh = () => {
      setMediaTick((value) => value + 1)
      void playRemote()
    }
    const tracks = remoteStream.getTracks()
    tracks.forEach((track) => {
      track.addEventListener("unmute", refresh)
      track.addEventListener("mute", refresh)
      track.addEventListener("ended", refresh)
    })
    remoteStream.addEventListener("addtrack", refresh)
    remoteStream.addEventListener("removetrack", refresh)

    return () => {
      tracks.forEach((track) => {
        track.removeEventListener("unmute", refresh)
        track.removeEventListener("mute", refresh)
        track.removeEventListener("ended", refresh)
      })
      remoteStream.removeEventListener("addtrack", refresh)
      remoteStream.removeEventListener("removetrack", refresh)
      disconnectWebAudio()
      if (video?.srcObject === remoteVideoSource || video?.srcObject === remoteStream) video.srcObject = null
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    }
  }, [disconnectWebAudio, own, playRemote, remoteScreenStream, remoteStream, remoteVideoSource])

  React.useEffect(() => {
    const node = webAudioRef.current
    if (node) node.gain.gain.value = deafened ? 0 : 1
    if (remoteAudioRef.current) remoteAudioRef.current.muted = Boolean(deafened || node)
    if (deafened) setPlaybackBlocked(false)
    else void playRemote()
  }, [deafened, playRemote])

  React.useEffect(() => {
    if (own || !camOn || !remoteVideoSource) {
      setVideoFrameReady(false)
      return
    }
    const element = remoteVideoRef.current
    if (!element) return
    let cancelled = false
    let frameId: number | null = null
    let timeoutId: number | null = null

    const confirmFrame = () => {
      if (cancelled) return
      if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && element.videoWidth > 0 && element.videoHeight > 0) {
        setVideoFrameReady(true)
        return
      }
      timeoutId = window.setTimeout(confirmFrame, 120)
    }

    setVideoFrameReady(false)
    if (typeof element.requestVideoFrameCallback === "function") {
      frameId = element.requestVideoFrameCallback(() => {
        if (cancelled) return
        // Aguarda um segundo frame para não exibir o último frame preto gerado
        // enquanto a track remota ainda estava desabilitada.
        frameId = element.requestVideoFrameCallback(() => {
          if (!cancelled && element.videoWidth > 0 && element.videoHeight > 0) setVideoFrameReady(true)
        })
      })
    } else {
      confirmFrame()
    }

    return () => {
      cancelled = true
      if (frameId !== null && typeof element.cancelVideoFrameCallback === "function") element.cancelVideoFrameCallback(frameId)
      if (timeoutId !== null) window.clearTimeout(timeoutId)
    }
  }, [camOn, mediaTick, own, remoteScreenStream, remoteStream, remoteVideoSource])

  // mediaTick é proposital: MediaStream/MediaStreamTrack mudam internamente sem trocar
  // a referência do objeto. A leitura abaixo precisa ser refeita em mute/unmute/addtrack.
  void mediaTick

  React.useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === tileRef.current)
    document.addEventListener("fullscreenchange", syncFullscreen)
    return () => document.removeEventListener("fullscreenchange", syncFullscreen)
  }, [])

  const toggleFullscreen = React.useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    const tile = tileRef.current
    if (!tile) return
    try {
      if (document.fullscreenElement === tile) await document.exitFullscreen()
      else if (tile.requestFullscreen) await tile.requestFullscreen()
    } catch (error) {
      console.warn("Devboard: não foi possível alternar tela cheia", error)
    }
  }, [])

  const connectionLabel = own
    ? "Você"
    : !connected
      ? "Aguardando entrada"
      : connectionState === "connected"
        ? showVideo
          ? "Vídeo ativo"
          : camOn ? "Câmera ativa · sincronizando vídeo" : "Na sala"
        : connectionState === "failed"
          ? "Falha na conexão de mídia"
          : connectionState === "disconnected"
            ? "Reconectando mídia"
            : "Conectando mídia"

  return (
    <div
      ref={tileRef}
      onClick={onPrioritize}
      className={cn(
        "group relative flex h-full min-h-0 overflow-hidden rounded-2xl bg-muted/45 ring-1 ring-foreground/8 transition-[min-height,box-shadow] duration-200",
        prioritized
          ? "min-h-[46dvh] ring-2 ring-primary/35 lg:min-h-[58dvh]"
          : compact
            ? "min-h-32 sm:min-h-36 lg:min-h-40"
            : "min-h-44 sm:min-h-52",
        onPrioritize && "cursor-pointer",
      )}
    >
      {own ? (
        nativeScreenShare && screenSharing && !cameraEnabled ? (
          <div className="flex size-full flex-col items-center justify-center gap-3">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:size-20">
              <MonitorUp className="size-8" />
            </span>
            <div className="text-center">
              <p className="text-sm font-medium">Sua tela está sendo compartilhada</p>
              <p className="mt-0.5 text-[0.65rem] text-muted-foreground">Captura nativa do Android</p>
            </div>
          </div>
        ) : camOn ? (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 size-full bg-black object-contain"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3">
            <MemberAvatar member={member} className="size-16 text-base ring-0 sm:size-20" />
            <div className="text-center">
              <p className="text-sm font-medium">{member.name} · Você</p>
              <p className="mt-0.5 text-[0.65rem] text-muted-foreground">Você</p>
            </div>
          </div>
        )
      ) : (
        <>
          {/* Vídeo e áudio remotos ficam montados separadamente. O vídeo é sempre mudo;
              a saída sonora usa Web Audio (desbloqueado no Atender) com <audio> de fallback. */}
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => void playRemote()}
            onCanPlay={() => void playRemote()}
            onPlaying={() => setVideoPlaying(true)}
            onPause={() => { setVideoPlaying(false); setVideoFrameReady(false) }}
            onEmptied={() => { setVideoPlaying(false); setVideoFrameReady(false) }}
            className={cn(
              "absolute inset-0 size-full bg-black transition-opacity duration-150",
              "object-contain",
              showVideo ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          />
          <audio
            ref={remoteAudioRef}
            autoPlay
            className="pointer-events-none absolute size-px opacity-0"
            onLoadedMetadata={() => void playRemote()}
            onCanPlay={() => void playRemote()}
          />
          {!showVideo && (
            <div className="relative z-10 flex size-full flex-col items-center justify-center gap-3">
              <MemberAvatar member={member} className="size-16 text-base ring-0 sm:size-20" />
              <div className="text-center">
                <p className="text-sm font-medium">{member.name}</p>
                <p className="mt-0.5 text-[0.65rem] text-muted-foreground">{connectionLabel}</p>
              </div>
            </div>
          )}
        </>
      )}

      <Button
        type="button"
        size="icon"
        variant="secondary"
        onClick={(event) => void toggleFullscreen(event)}
        title={fullscreen ? "Sair da tela cheia" : "Tela cheia"}
        className="absolute right-2 top-2 z-30 size-8 bg-black/55 text-white shadow-sm hover:bg-black/70 hover:text-white"
      >
        {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </Button>

      {playbackBlocked && !deafened && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/45 p-4">
          <Button type="button" size="sm" variant="secondary" onClick={() => { void primeCallAudio(); void playRemote() }} className="gap-2">
            <Volume2 className="size-4" /> Ativar áudio e vídeo
          </Button>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-t from-black/65 to-transparent px-3 pb-3 pt-8 text-white">
        <span className="min-w-0 truncate text-xs font-medium">{member.name}{own ? " · Você" : ""}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          {(screenSharing || presence?.screenSharing) && (
            <span className="rounded-md bg-black/45 px-1.5 py-1 text-[0.56rem]">Tela</span>
          )}
          <span className={cn("flex size-6 items-center justify-center rounded-md", micOn ? "bg-black/45" : "bg-destructive")}> 
            {micOn ? <Mic className="size-3" /> : <MicOff className="size-3" />}
          </span>
        </span>
      </div>
    </div>
  )
}

export function CallRoom({
  meeting,
  open,
  onOpenChange,
}: {
  meeting: ChatMeeting | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { members, currentUserId, currentUserRole, endMeeting, leaveMeeting, heartbeatMeeting } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const [micEnabled, setMicEnabled] = React.useState(true)
  const [cameraEnabled, setCameraEnabled] = React.useState(meeting?.mode === "video")
  const [screenSharing, setScreenSharing] = React.useState(false)
  const [nativeScreenSharing, setNativeScreenSharing] = React.useState(false)
  const [deafened, setDeafened] = React.useState(false)
  const [panel, setPanel] = React.useState<PanelMode>(null)
  const [focusedMemberId, setFocusedMemberId] = React.useState<string | null>(null)
  const [mediaError, setMediaError] = React.useState("")
  const [mediaReadyMeetingId, setMediaReadyMeetingId] = React.useState<string | null>(null)
  const [devices, setDevices] = React.useState<MediaDeviceInfo[]>([])
  const [selectedMic, setSelectedMic] = React.useState("")
  const [selectedCamera, setSelectedCamera] = React.useState("")
  const [presences, setPresences] = React.useState<Record<string, Presence>>({})
  const [remoteStreams, setRemoteStreams] = React.useState<Record<string, MediaStream>>({})
  const [nativeScreenStreams, setNativeScreenStreams] = React.useState<Record<string, MediaStream>>({})
  const [peerStates, setPeerStates] = React.useState<Record<string, RTCPeerConnectionState>>({})
  const [peerRoutes, setPeerRoutes] = React.useState<Record<string, string>>({})
  const [iceTransport, setIceTransport] = React.useState<{ hasTurn: boolean; source: string; warning?: string }>({
    hasTurn: false,
    source: "carregando",
  })
  const [now, setNow] = React.useState(Date.now())
  const [endingMeeting, setEndingMeeting] = React.useState(false)
  const [leavingMeeting, setLeavingMeeting] = React.useState(false)
  const localStreamRef = React.useRef<MediaStream | null>(null)
  const screenStreamRef = React.useRef<MediaStream | null>(null)
  const localVideoRef = React.useRef<HTMLVideoElement | null>(null)
  const channelRef = React.useRef<RealtimeChannel | null>(null)
  const peersRef = React.useRef<Map<string, RTCPeerConnection>>(new Map())
  const peerSendersRef = React.useRef<Map<string, PeerSenders>>(new Map())
  const peerRoleRef = React.useRef<Map<string, PeerRoleState>>(new Map())
  const pendingIceRef = React.useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const nativeScreenPeersRef = React.useRef<Map<string, RTCPeerConnection>>(new Map())
  const nativeScreenPendingIceRef = React.useRef<Map<string, RTCIceCandidateInit[]>>(new Map())
  const nativeScreenMediaStreamsRef = React.useRef<Map<string, MediaStream>>(new Map())
  const remoteMediaStreamsRef = React.useRef<Map<string, MediaStream>>(new Map())
  const remoteMediaStateRef = React.useRef<Map<string, MediaStateSignal>>(new Map())
  const restartTimersRef = React.useRef<Map<string, number>>(new Map())
  const peerPruneTimersRef = React.useRef<Map<string, number>>(new Map())
  const livePresenceSessionsRef = React.useRef<Set<string>>(new Set())
  const signalQueuesRef = React.useRef<Map<string, Promise<void>>>(new Map())
  const peerHealthRef = React.useRef<Map<string, { inboundBytes: number; outboundBytes: number; stalledChecks: number }>>(new Map())
  const lastIceRestartRef = React.useRef<Map<string, number>>(new Map())
  const presencePublishTimerRef = React.useRef<number | null>(null)
  const iceServersRef = React.useRef<RTCIceServer[]>([])
  const iceHasTurnRef = React.useRef(false)
  const sessionIdRef = React.useRef(makeSessionId())
  const authTokenRef = React.useRef<string | null>(null)
  const joinedAtRef = React.useRef(new Date().toISOString())
  const localMediaRevisionRef = React.useRef(0)
  const presenceStateRef = React.useRef({
    userId: currentUserId,
    micEnabled,
    cameraEnabled,
    screenSharing,
    mediaRevision: 0,
  })

  const currentMember = members.find((member) => member.id === currentUserId)
  const currentMeetingState = meeting?.memberStates.find((member) => member.userId === currentUserId)
  const meetingMembers = meeting?.memberIds
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is Member => Boolean(member)) ?? []
  const canEndMeeting = Boolean(
    meeting && (currentUserRole === "admin" || meeting.createdBy === currentUserId),
  )

  const microphoneDevices = devices.filter((device) => device.kind === "audioinput")
  const cameraDevices = devices.filter((device) => device.kind === "videoinput")

  React.useEffect(() => {
    presenceStateRef.current = {
      ...presenceStateRef.current,
      userId: currentUserId,
      micEnabled,
      cameraEnabled,
      screenSharing,
    }
  }, [currentUserId, micEnabled, cameraEnabled, screenSharing])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return
    let cancelled = false

    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) authTokenRef.current = data.session?.access_token ?? null
    })

    void heartbeatMeeting(meeting.id)
    const heartbeat = window.setInterval(() => {
      void heartbeatMeeting(meeting.id)
    }, 20_000)

    return () => {
      cancelled = true
      window.clearInterval(heartbeat)
    }
  }, [currentMeetingState?.status, heartbeatMeeting, meeting?.id, open, supabase])

  const keepaliveLeave = React.useCallback(() => {
    if (!meeting || currentMeetingState?.status !== "joined") return
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "")
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    const token = authTokenRef.current
    if (!url || !key || !token) return

    try {
      void fetch(`${url}/rest/v1/rpc/leave_meeting`, {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ p_meeting_id: meeting.id }),
      })
    } catch {
      // A rotina pg_cron da migration encerra salas abandonadas como fallback.
    }
  }, [currentMeetingState?.status, meeting?.id])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return
    const onPageHide = () => keepaliveLeave()
    window.addEventListener("pagehide", onPageHide)
    return () => window.removeEventListener("pagehide", onPageHide)
  }, [currentMeetingState?.status, keepaliveLeave, meeting?.id, open])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return
    return () => keepaliveLeave()
  }, [currentMeetingState?.status, keepaliveLeave, meeting?.id, open])

  const publishPresence = React.useCallback(() => {
    if (!meeting || !channelRef.current) return
    const live = presenceStateRef.current
    void channelRef.current.track({
      sessionId: sessionIdRef.current,
      userId: live.userId,
      micEnabled: live.micEnabled,
      cameraEnabled: live.cameraEnabled,
      screenSharing: live.screenSharing,
      mediaRevision: live.mediaRevision,
      joinedAt: joinedAtRef.current,
    } satisfies Presence)
  }, [meeting?.id])

  const broadcastMediaState = React.useCallback(async () => {
    if (!meeting || !channelRef.current) return false
    const live = presenceStateRef.current
    try {
      const result = await channelRef.current.send({
        type: "broadcast",
        event: "media-state",
        payload: {
          meetingId: meeting.id,
          fromSession: sessionIdRef.current,
          fromUserId: live.userId,
          micEnabled: live.micEnabled,
          cameraEnabled: live.cameraEnabled,
          screenSharing: live.screenSharing,
          mediaRevision: live.mediaRevision,
          sentAt: new Date().toISOString(),
        } satisfies MediaStateSignal,
      })
      return result === "ok"
    } catch {
      return false
    }
  }, [meeting?.id])

  const broadcastMediaStateBurst = React.useCallback(() => {
    void broadcastMediaState()
    // Broadcast é instantâneo e os eventos são idempotentes pela mediaRevision.
    // Pequenas repetições cobrem troca de rede/background no exato momento do clique.
    window.setTimeout(() => void broadcastMediaState(), 180)
    window.setTimeout(() => void broadcastMediaState(), 650)
  }, [broadcastMediaState])

  const schedulePresenceReconcile = React.useCallback(() => {
    if (presencePublishTimerRef.current !== null) window.clearTimeout(presencePublishTimerRef.current)
    // Presence tem limite de chamadas bem menor que Broadcast. O estado rápido
    // (mute/câmera/tela) vai por Broadcast; Presence reconcilia depois.
    presencePublishTimerRef.current = window.setTimeout(() => {
      presencePublishTimerRef.current = null
      publishPresence()
    }, 1200)
  }, [publishPresence])

  const commitMediaState = React.useCallback((next: Partial<Pick<Presence, "micEnabled" | "cameraEnabled" | "screenSharing">>) => {
    localMediaRevisionRef.current += 1
    presenceStateRef.current = {
      ...presenceStateRef.current,
      ...next,
      userId: currentUserId,
      mediaRevision: localMediaRevisionRef.current,
    }
    if (typeof next.micEnabled === "boolean") setMicEnabled(next.micEnabled)
    if (typeof next.cameraEnabled === "boolean") setCameraEnabled(next.cameraEnabled)
    if (typeof next.screenSharing === "boolean") setScreenSharing(next.screenSharing)
    broadcastMediaStateBurst()
    schedulePresenceReconcile()
  }, [broadcastMediaStateBurst, currentUserId, schedulePresenceReconcile])

  const postSignal = React.useCallback(async (signal: Omit<CallSignal, "meetingId" | "fromSession" | "fromUserId">) => {
    if (!meeting || !channelRef.current) return false
    try {
      const result = await channelRef.current.send({
        type: "broadcast",
        event: "webrtc-signal",
        payload: {
          ...signal,
          meetingId: meeting.id,
          fromSession: sessionIdRef.current,
          fromUserId: currentUserId,
        } satisfies CallSignal,
      })
      if (result !== "ok") {
        setMediaError("A sinalização da chamada atrasou ou falhou. Tentando reconectar...")
        return false
      }
      return true
    } catch {
      setMediaError("Não foi possível enviar a sinalização WebRTC pelo Supabase Realtime.")
      return false
    }
  }, [meeting?.id, currentUserId])

  const postNativeScreenSignal = React.useCallback(async (signal: NativeScreenSignal) => {
    if (!meeting || !channelRef.current) return false
    try {
      const result = await channelRef.current.send({
        type: "broadcast",
        event: "native-screen-signal",
        payload: signal,
      })
      return result === "ok"
    } catch (error) {
      console.warn("Devboard: falha ao enviar sinal do compartilhamento Android", error)
      return false
    }
  }, [meeting?.id])

  const closeNativeScreenPeer = React.useCallback((sessionId: string) => {
    nativeScreenPeersRef.current.get(sessionId)?.close()
    nativeScreenPeersRef.current.delete(sessionId)
    nativeScreenPendingIceRef.current.delete(sessionId)
    nativeScreenMediaStreamsRef.current.delete(sessionId)
    setNativeScreenStreams((current) => {
      if (!current[sessionId]) return current
      const copy = { ...current }
      delete copy[sessionId]
      return copy
    })
  }, [])

  const ensureNativeScreenReceiverPeer = React.useCallback((fromSession: string, fromUserId: string) => {
    const existing = nativeScreenPeersRef.current.get(fromSession)
    if (existing) return existing
    if (!meeting) return null

    const peer = new RTCPeerConnection({ iceServers: iceServersRef.current })
    nativeScreenPeersRef.current.set(fromSession, peer)

    peer.ontrack = (event) => {
      let stream = nativeScreenMediaStreamsRef.current.get(fromSession)
      if (!stream) {
        stream = new MediaStream()
        nativeScreenMediaStreamsRef.current.set(fromSession, stream)
      }
      if (!stream.getTracks().some((track) => track.id === event.track.id)) stream.addTrack(event.track)
      setNativeScreenStreams((current) => ({ ...current, [fromSession]: stream! }))
      event.track.addEventListener("ended", () => closeNativeScreenPeer(fromSession), { once: true })
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      void postNativeScreenSignal({
        type: "native-screen-ice",
        meetingId: meeting.id,
        fromSession: sessionIdRef.current,
        fromUserId: currentUserId,
        toSession: fromSession,
        candidate: event.candidate.toJSON(),
      })
    }

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        closeNativeScreenPeer(fromSession)
      }
    }

    // O receiver web não envia mídia neste peer; ele existe somente para a track
    // produzida pelo MediaProjection nativo do Android.
    void fromUserId
    return peer
  }, [closeNativeScreenPeer, currentUserId, meeting?.id, postNativeScreenSignal])

  const handleNativeScreenSignal = React.useCallback((signal: NativeScreenSignal) => {
    if (!meeting || signal.meetingId !== meeting.id) return
    if (signal.toSession !== sessionIdRef.current || signal.fromSession === sessionIdRef.current) return

    if (signal.type === "native-screen-answer") {
      if (nativeScreenSharing && hasAndroidNativeScreenShare()) forwardAndroidScreenSignal(signal)
      return
    }

    if (signal.type === "native-screen-stop") {
      closeNativeScreenPeer(signal.fromSession)
      return
    }

    if (signal.type === "native-screen-offer" && signal.sdp) {
      const peer = ensureNativeScreenReceiverPeer(signal.fromSession, signal.fromUserId)
      if (!peer) return
      void (async () => {
        try {
          await peer.setRemoteDescription(signal.sdp!)
          const pending = nativeScreenPendingIceRef.current.get(signal.fromSession) ?? []
          nativeScreenPendingIceRef.current.delete(signal.fromSession)
          for (const candidate of pending) await peer.addIceCandidate(candidate)
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          if (peer.localDescription) {
            await postNativeScreenSignal({
              type: "native-screen-answer",
              meetingId: meeting.id,
              fromSession: sessionIdRef.current,
              fromUserId: currentUserId,
              toSession: signal.fromSession,
              sdp: peer.localDescription,
            })
          }
        } catch (error) {
          console.warn("Devboard: não foi possível receber a tela nativa Android", error)
          closeNativeScreenPeer(signal.fromSession)
        }
      })()
      return
    }

    if (signal.type === "native-screen-ice" && signal.candidate) {
      const receiverPeer = nativeScreenPeersRef.current.get(signal.fromSession)
      if (receiverPeer) {
        if (!receiverPeer.remoteDescription) {
          const queue = nativeScreenPendingIceRef.current.get(signal.fromSession) ?? []
          queue.push(signal.candidate)
          nativeScreenPendingIceRef.current.set(signal.fromSession, queue)
        } else {
          void receiverPeer.addIceCandidate(signal.candidate).catch(() => {
            const queue = nativeScreenPendingIceRef.current.get(signal.fromSession) ?? []
            queue.push(signal.candidate!)
            nativeScreenPendingIceRef.current.set(signal.fromSession, queue)
          })
        }
        return
      }

      if (nativeScreenSharing && hasAndroidNativeScreenShare()) forwardAndroidScreenSignal(signal)
    }
  }, [closeNativeScreenPeer, currentUserId, ensureNativeScreenReceiverPeer, meeting?.id, nativeScreenSharing, postNativeScreenSignal])

  const syncPeerTracks = React.useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0] ?? null
    const videoTrack = screenStreamRef.current?.getVideoTracks()[0] ?? localStreamRef.current?.getVideoTracks()[0] ?? null
    peerSendersRef.current.forEach((senders, remoteSession) => {
      void senders.audio.replaceTrack(audioTrack).catch((error) => {
        console.warn("Devboard: não foi possível substituir a track de áudio", remoteSession, error)
        setMediaError("O navegador não conseguiu sincronizar o microfone com um participante.")
      })
      void senders.video.replaceTrack(videoTrack).catch((error) => {
        console.warn("Devboard: não foi possível substituir a track de vídeo", remoteSession, error)
        setMediaError("O navegador não conseguiu sincronizar a câmera com um participante.")
      })
    })
  }, [])

  const inspectPeerRoute = React.useCallback(async (remoteSession: string, peer: RTCPeerConnection) => {
    try {
      const stats = await peer.getStats()
      let selectedPair: any
      stats.forEach((report) => {
        if (report.type === "transport" && report.selectedCandidatePairId) {
          selectedPair = stats.get(report.selectedCandidatePairId)
        }
        if (!selectedPair && report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
          selectedPair = report
        }
      })
      if (!selectedPair) return
      const local = selectedPair.localCandidateId ? stats.get(selectedPair.localCandidateId) : undefined
      const remote = selectedPair.remoteCandidateId ? stats.get(selectedPair.remoteCandidateId) : undefined
      const types = [local?.candidateType, remote?.candidateType].filter(Boolean)
      const route = types.includes("relay")
        ? "TURN relay"
        : types.includes("srflx")
          ? "STUN / direta"
          : types.includes("host")
            ? "Rede local / direta"
            : "Conectada"
      setPeerRoutes((current) => ({ ...current, [remoteSession]: route }))
    } catch {
      // Diagnóstico não deve interferir na chamada.
    }
  }, [])

  const enqueuePeerSignal = React.useCallback((sessionId: string, task: () => Promise<void>) => {
    const previous = signalQueuesRef.current.get(sessionId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(task)
      .catch((error) => {
        console.warn("Devboard: fila de sinalização WebRTC falhou", sessionId, error)
      })
      .finally(() => {
        if (signalQueuesRef.current.get(sessionId) === next) signalQueuesRef.current.delete(sessionId)
      })
    signalQueuesRef.current.set(sessionId, next)
  }, [])

  const schedulePeerPrune = React.useCallback((sessionId: string) => {
    const existing = peerPruneTimersRef.current.get(sessionId)
    if (existing) return
    const timer = window.setTimeout(() => {
      peerPruneTimersRef.current.delete(sessionId)
      if (!livePresenceSessionsRef.current.has(sessionId)) {
        closePeerRef.current?.(sessionId)
      }
    }, 12_000)
    peerPruneTimersRef.current.set(sessionId, timer)
  }, [])

  const closePeerRef = React.useRef<((sessionId: string) => void) | null>(null)

  const closePeer = React.useCallback((sessionId: string) => {
    const timer = restartTimersRef.current.get(sessionId)
    if (timer) window.clearTimeout(timer)
    restartTimersRef.current.delete(sessionId)
    const pruneTimer = peerPruneTimersRef.current.get(sessionId)
    if (pruneTimer) window.clearTimeout(pruneTimer)
    peerPruneTimersRef.current.delete(sessionId)
    signalQueuesRef.current.delete(sessionId)
    peerHealthRef.current.delete(sessionId)
    lastIceRestartRef.current.delete(sessionId)
    const peer = peersRef.current.get(sessionId)
    if (peer) peer.close()
    peersRef.current.delete(sessionId)
    peerSendersRef.current.delete(sessionId)
    peerRoleRef.current.delete(sessionId)
    pendingIceRef.current.delete(sessionId)
    remoteMediaStreamsRef.current.delete(sessionId)
    remoteMediaStateRef.current.delete(sessionId)
    setPeerStates((current) => {
      if (!current[sessionId]) return current
      const copy = { ...current }
      delete copy[sessionId]
      return copy
    })
    setPeerRoutes((current) => {
      if (!current[sessionId]) return current
      const copy = { ...current }
      delete copy[sessionId]
      return copy
    })
    setRemoteStreams((current) => {
      if (!current[sessionId]) return current
      const copy = { ...current }
      delete copy[sessionId]
      return copy
    })
  }, [])

  closePeerRef.current = closePeer

  const closeAllPeers = React.useCallback(() => {
    if (presencePublishTimerRef.current !== null) {
      window.clearTimeout(presencePublishTimerRef.current)
      presencePublishTimerRef.current = null
    }
    restartTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    restartTimersRef.current.clear()
    peerPruneTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    peerPruneTimersRef.current.clear()
    livePresenceSessionsRef.current.clear()
    signalQueuesRef.current.clear()
    peerHealthRef.current.clear()
    lastIceRestartRef.current.clear()
    nativeScreenPeersRef.current.forEach((peer) => peer.close())
    nativeScreenPeersRef.current.clear()
    nativeScreenPendingIceRef.current.clear()
    nativeScreenMediaStreamsRef.current.clear()
    setNativeScreenStreams({})
    peersRef.current.forEach((peer) => peer.close())
    peersRef.current.clear()
    peerSendersRef.current.clear()
    peerRoleRef.current.clear()
    pendingIceRef.current.clear()
    remoteMediaStreamsRef.current.clear()
    remoteMediaStateRef.current.clear()
    setPeerStates({})
    setPeerRoutes({})
    setRemoteStreams({})
  }, [])

  const flushPendingIce = React.useCallback(async (remoteSession: string, peer: RTCPeerConnection) => {
    if (!peer.remoteDescription) return
    const queued = pendingIceRef.current.get(remoteSession) ?? []
    pendingIceRef.current.delete(remoteSession)
    for (const candidate of queued) {
      try {
        await peer.addIceCandidate(candidate)
      } catch (error) {
        console.warn("Devboard: ICE candidate rejeitado após remoteDescription", error)
      }
    }
  }, [])

  const syncRemoteReceiverTracks = React.useCallback((remoteSession: string, peer: RTCPeerConnection) => {
    const stream = remoteMediaStreamsRef.current.get(remoteSession)
    if (!stream) return
    let changed = false
    for (const receiver of peer.getReceivers()) {
      const track = receiver.track
      if (!track || track.readyState === "ended") continue
      if (!stream.getTracks().some((currentTrack) => currentTrack.id === track.id)) {
        stream.addTrack(track)
        changed = true
      }
    }
    if (changed || stream.getTracks().length > 0) {
      setRemoteStreams((current) => ({ ...current, [remoteSession]: stream }))
    }
  }, [])

  const getPeerRole = React.useCallback((remoteSession: string) => {
    const existing = peerRoleRef.current.get(remoteSession)
    if (existing) return existing
    const created: PeerRoleState = {
      // Um único offerer por par elimina glare/rollback e deixa o SDP idêntico nos dois lados.
      offerer: sessionIdRef.current.localeCompare(remoteSession) < 0,
      initialOfferSent: false,
      offerInFlight: false,
      restartPending: false,
    }
    peerRoleRef.current.set(remoteSession, created)
    return created
  }, [])

  const bindPeerSenders = React.useCallback(async (remoteSession: string, peer: RTCPeerConnection) => {
    const transceivers = peer.getTransceivers()
    const audioTransceiver = transceivers.find((item) => item.receiver.track.kind === "audio")
    const videoTransceiver = transceivers.find((item) => item.receiver.track.kind === "video")
    if (!audioTransceiver || !videoTransceiver) return false

    // O answerer recebe os transceivers ao aplicar o offer remoto. Antes de gerar
    // a resposta, força sendrecv e conecta suas tracks locais aos mesmos m-lines.
    audioTransceiver.direction = "sendrecv"
    videoTransceiver.direction = "sendrecv"
    peerSendersRef.current.set(remoteSession, {
      audio: audioTransceiver.sender,
      video: videoTransceiver.sender,
    })

    const audioTrack = localStreamRef.current?.getAudioTracks()[0] ?? null
    const videoTrack = screenStreamRef.current?.getVideoTracks()[0] ?? localStreamRef.current?.getVideoTracks()[0] ?? null
    const results = await Promise.allSettled([
      audioTransceiver.sender.replaceTrack(audioTrack),
      videoTransceiver.sender.replaceTrack(videoTrack),
    ])
    const failed = results.some((result) => result.status === "rejected")
    if (failed) {
      console.warn("Devboard: não foi possível vincular todas as tracks locais ao peer", remoteSession, results)
      setMediaError("Uma track local não pôde ser vinculada à chamada. Tentando manter a conexão ativa.")
    }
    return true
  }, [])

  const sendOffer = React.useCallback(async (remoteSession: string, peer: RTCPeerConnection, iceRestart = false) => {
    const role = getPeerRole(remoteSession)
    if (!role.offerer || peer.connectionState === "closed" || peer.signalingState === "closed") return
    if (role.offerInFlight || peer.signalingState !== "stable") {
      role.restartPending = role.restartPending || iceRestart
      return
    }

    role.offerInFlight = true
    try {
      await bindPeerSenders(remoteSession, peer)
      const offer = await peer.createOffer(iceRestart ? { iceRestart: true } : undefined)
      await peer.setLocalDescription(offer)
      if (!peer.localDescription) return
      const sent = await postSignal({ type: "offer", toSession: remoteSession, sdp: peer.localDescription })
      if (sent) role.initialOfferSent = true
    } catch (error) {
      console.warn("Devboard: falha ao criar oferta determinística WebRTC", error)
      setMediaError("Não foi possível negociar a mídia com um participante. O Devboard tentará novamente.")
      role.restartPending = true
    } finally {
      role.offerInFlight = false
    }
  }, [bindPeerSenders, getPeerRole, postSignal])

  const requestIceRestart = React.useCallback((remoteSession: string, peer: RTCPeerConnection) => {
    if (peer.connectionState === "closed") return
    const now = Date.now()
    const lastRestart = lastIceRestartRef.current.get(remoteSession) ?? 0
    if (now - lastRestart < 5000) return
    lastIceRestartRef.current.set(remoteSession, now)

    const role = getPeerRole(remoteSession)
    if (role.offerer) {
      void sendOffer(remoteSession, peer, true)
      return
    }
    void postSignal({ type: "restart-request", toSession: remoteSession })
  }, [getPeerRole, postSignal, sendOffer])

  const ensurePeer = React.useCallback((remoteSession: string, remoteUserId: string) => {
    const existing = peersRef.current.get(remoteSession)
    if (existing) return existing
    if (typeof RTCPeerConnection === "undefined") return null

    const peer = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 4,
      bundlePolicy: "max-bundle",
    })
    const role = getPeerRole(remoteSession)
    const remoteStream = new MediaStream()

    remoteMediaStreamsRef.current.set(remoteSession, remoteStream)
    peersRef.current.set(remoteSession, peer)
    setPeerStates((current) => ({ ...current, [remoteSession]: peer.connectionState }))
    setRemoteStreams((current) => ({ ...current, [remoteSession]: remoteStream }))

    // Somente o offerer cria os m-lines. O answerer os recebe via setRemoteDescription.
    // Ambos os m-lines existem desde o início mesmo que câmera/mic estejam desligados.
    if (role.offerer) {
      const audioTransceiver = peer.addTransceiver("audio", { direction: "sendrecv" })
      const videoTransceiver = peer.addTransceiver("video", { direction: "sendrecv" })
      peerSendersRef.current.set(remoteSession, {
        audio: audioTransceiver.sender,
        video: videoTransceiver.sender,
      })
      void bindPeerSenders(remoteSession, peer)
    }

    peer.onsignalingstatechange = () => {
      if (!role.offerer || peer.signalingState !== "stable" || role.offerInFlight || !role.restartPending) return
      role.restartPending = false
      window.setTimeout(() => void sendOffer(remoteSession, peer, true), 100)
    }

    peer.ontrack = (event) => {
      const liveRemoteStream = remoteMediaStreamsRef.current.get(remoteSession) ?? remoteStream
      const track = event.track
      if (!liveRemoteStream.getTracks().some((currentTrack) => currentTrack.id === track.id)) {
        liveRemoteStream.addTrack(track)
      }

      const refreshTrack = () => {
        setRemoteStreams((current) => ({ ...current, [remoteSession]: liveRemoteStream }))
      }
      track.addEventListener("unmute", refreshTrack)
      track.addEventListener("mute", refreshTrack)
      track.addEventListener("ended", refreshTrack, { once: true })

      // event.streams pode vir vazio com transceivers streamless. O MediaStream estável
      // acima garante que áudio e vídeo sempre terminem no mesmo tile remoto.
      setRemoteStreams((current) => ({ ...current, [remoteSession]: liveRemoteStream }))
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      void postSignal({
        type: "ice",
        toSession: remoteSession,
        candidate: event.candidate.toJSON(),
      })
    }

    peer.onicecandidateerror = (event) => {
      console.warn("Devboard: erro ICE", event)
    }

    peer.oniceconnectionstatechange = () => {
      if (peer.iceConnectionState === "failed") requestIceRestart(remoteSession, peer)
    }

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState
      setPeerStates((current) => ({ ...current, [remoteSession]: state }))
      if (state === "connected") {
        setMediaError((current) => current.includes("TURN") || current.includes("ICE") || current.includes("mídia") ? "" : current)
        void inspectPeerRoute(remoteSession, peer)
        const timer = restartTimersRef.current.get(remoteSession)
        if (timer) window.clearTimeout(timer)
        restartTimersRef.current.delete(remoteSession)
      } else if (state === "disconnected") {
        const oldTimer = restartTimersRef.current.get(remoteSession)
        if (oldTimer) window.clearTimeout(oldTimer)
        const timer = window.setTimeout(() => {
          if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
            requestIceRestart(remoteSession, peer)
          }
        }, 3000)
        restartTimersRef.current.set(remoteSession, timer)
      } else if (state === "failed") {
        setMediaError(
          iceHasTurnRef.current
            ? "A conexão de mídia falhou. O Devboard está reiniciando o ICE automaticamente."
            : "A conexão de mídia falhou sem TURN. Configure o TURN para funcionar de forma confiável entre redes móveis e desktops.",
        )
        requestIceRestart(remoteSession, peer)
      } else if (state === "closed") {
        closePeer(remoteSession)
      }
    }

    // A oferta inicial é criada uma única vez e somente pelo papel determinístico.
    if (role.offerer) {
      window.setTimeout(() => {
        if (!role.initialOfferSent && peer.connectionState !== "closed") void sendOffer(remoteSession, peer)
      }, 0)
    }

    return peer
  }, [bindPeerSenders, closePeer, getPeerRole, inspectPeerRoute, postSignal, requestIceRestart, sendOffer])

  const updateLocalVideo = React.useCallback(() => {
    if (!localVideoRef.current) return
    const stream = screenStreamRef.current ?? localStreamRef.current
    localVideoRef.current.srcObject = stream
  }, [])

  const refreshDevices = React.useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list)
      const activeAudio = localStreamRef.current?.getAudioTracks()[0]?.getSettings().deviceId
      const activeVideo = localStreamRef.current?.getVideoTracks()[0]?.getSettings().deviceId
      if (activeAudio) setSelectedMic(activeAudio)
      if (activeVideo) setSelectedCamera(activeVideo)
    } catch {
      // A lista de dispositivos é opcional; a chamada continua com o padrão do navegador.
    }
  }, [])

  const stopAllMedia = React.useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    screenStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
  }, [])

  const setupMedia = React.useCallback(async () => {
    if (!meeting) return
    setMediaReadyMeetingId(null)
    setMediaError("")
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Seu navegador não disponibilizou câmera/microfone. Use HTTPS ou localhost e verifique as permissões.")
      setMicEnabled(false)
      setCameraEnabled(false)
      setMediaReadyMeetingId(meeting.id)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: meeting.mode === "video"
          ? {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : false,
      })
      localStreamRef.current = stream
      const initialMicEnabled = stream.getAudioTracks().some((track) => track.enabled)
      const initialCameraEnabled = stream.getVideoTracks().some((track) => track.enabled)
      setMicEnabled(initialMicEnabled)
      setCameraEnabled(initialCameraEnabled)
      presenceStateRef.current = {
        ...presenceStateRef.current,
        userId: currentUserId,
        micEnabled: initialMicEnabled,
        cameraEnabled: initialCameraEnabled,
        screenSharing: false,
      }
      updateLocalVideo()
      syncPeerTracks()
      await refreshDevices()
    } catch (error) {
      setMediaError(
        error instanceof Error
          ? `Não foi possível acessar câmera/microfone: ${error.message}`
          : "Não foi possível acessar câmera/microfone. Verifique as permissões do navegador.",
      )
      setMicEnabled(false)
      setCameraEnabled(false)
      presenceStateRef.current = {
        ...presenceStateRef.current,
        userId: currentUserId,
        micEnabled: false,
        cameraEnabled: false,
        screenSharing: false,
      }
    } finally {
      setMediaReadyMeetingId(meeting.id)
    }
  }, [currentUserId, meeting, refreshDevices, syncPeerTracks, updateLocalVideo])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return
    setCameraEnabled(meeting.mode === "video")
    setMicEnabled(true)
    setDeafened(false)
    setFocusedMemberId(null)
    setPanel(window.matchMedia("(min-width: 1024px)").matches ? "participants" : null)
    setPresences({})
    remoteMediaStateRef.current.clear()
    localMediaRevisionRef.current = 0
    joinedAtRef.current = new Date().toISOString()
    presenceStateRef.current.mediaRevision = 0
    setNow(Date.now())
    void setupMedia()

    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [open, meeting?.id, currentMeetingState?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!open) return
    const desktop = window.matchMedia("(min-width: 1024px)")
    const handleViewport = (event: MediaQueryListEvent | MediaQueryList) => {
      if (!event.matches) setPanel(null)
    }
    handleViewport(desktop)
    desktop.addEventListener("change", handleViewport)
    return () => desktop.removeEventListener("change", handleViewport)
  }, [open])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return
    return subscribeAndroidScreenState(({ active, error }) => {
      setNativeScreenSharing(active)
      commitMediaState({ screenSharing: active })
      if (error) setMediaError(error)
      else if (active) setMediaError("")
    })
  }, [commitMediaState, currentMeetingState?.status, meeting?.id, open])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return
    return subscribeAndroidScreenSignal((signal) => {
      if (signal.meetingId !== meeting.id) return
      void postNativeScreenSignal(signal)
    })
  }, [currentMeetingState?.status, meeting?.id, open, postNativeScreenSignal])

  React.useEffect(() => {
    if (!open || !meeting || !nativeScreenSharing) return
    syncAndroidScreenRecipients(
      Object.values(presences)
        .filter((presence) => presence.sessionId !== sessionIdRef.current)
        .map((presence) => ({ sessionId: presence.sessionId, userId: presence.userId })),
    )
  }, [meeting?.id, nativeScreenSharing, open, presences])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined" || mediaReadyMeetingId !== meeting.id) return
    let disposed = false
    let channel: RealtimeChannel | null = null

    const syncPresence = () => {
      if (!channel) return
      const state = channel.presenceState() as Record<string, Array<Presence & { presence_ref?: string }>>
      const next: Record<string, Presence> = {}
      for (const entries of Object.values(state)) {
        for (const entry of entries) {
          if (!entry?.sessionId || entry.sessionId === sessionIdRef.current) continue
          const presenceRevision = Number(entry.mediaRevision ?? 0)
          const broadcastState = remoteMediaStateRef.current.get(entry.sessionId)
          const useBroadcast = Boolean(broadcastState && broadcastState.mediaRevision > presenceRevision)
          next[entry.sessionId] = {
            sessionId: entry.sessionId,
            userId: entry.userId,
            micEnabled: useBroadcast ? Boolean(broadcastState?.micEnabled) : Boolean(entry.micEnabled),
            cameraEnabled: useBroadcast ? Boolean(broadcastState?.cameraEnabled) : Boolean(entry.cameraEnabled),
            screenSharing: useBroadcast ? Boolean(broadcastState?.screenSharing) : Boolean(entry.screenSharing),
            mediaRevision: useBroadcast ? Number(broadcastState?.mediaRevision ?? 0) : presenceRevision,
            joinedAt: entry.joinedAt,
          }
        }
      }
      setPresences(next)
      livePresenceSessionsRef.current = new Set(Object.keys(next))
      for (const presence of Object.values(next)) {
        const pruneTimer = peerPruneTimersRef.current.get(presence.sessionId)
        if (pruneTimer) {
          window.clearTimeout(pruneTimer)
          peerPruneTimersRef.current.delete(presence.sessionId)
        }
        const peer = ensurePeer(presence.sessionId, presence.userId)
        if (!peer) continue
        const role = getPeerRole(presence.sessionId)
        if (role.offerer && !role.initialOfferSent && !role.offerInFlight && peer.signalingState === "stable") {
          void sendOffer(presence.sessionId, peer)
        }
      }
      // Presence pode ficar vazio por alguns segundos ao trocar de rede, voltar do
      // background ou durante a reconexão do Realtime. Não derruba um peer saudável
      // imediatamente; só remove se a sessão continuar ausente após a janela de graça.
      for (const sessionId of Array.from(peersRef.current.keys())) {
        if (!next[sessionId]) schedulePeerPrune(sessionId)
      }
      // Quem acabou de entrar recebe o estado atual imediatamente por Broadcast;
      // Presence continua sendo a fonte de reconciliação em caso de perda do evento.
      void broadcastMediaState()
    }

    const handleMediaState = (state: MediaStateSignal) => {
      if (state.meetingId !== meeting.id || state.fromSession === sessionIdRef.current) return
      const previous = remoteMediaStateRef.current.get(state.fromSession)
      if (previous && previous.mediaRevision > state.mediaRevision) return
      remoteMediaStateRef.current.set(state.fromSession, state)
      setPresences((current) => {
        const existing = current[state.fromSession]
        if (!existing || existing.mediaRevision > state.mediaRevision) return current
        return {
          ...current,
          [state.fromSession]: {
            ...existing,
            userId: state.fromUserId,
            micEnabled: state.micEnabled,
            cameraEnabled: state.cameraEnabled,
            screenSharing: state.screenSharing,
            mediaRevision: state.mediaRevision,
          },
        }
      })
    }

    const handleSignal = (signal: CallSignal) => {
      if (signal.meetingId !== meeting.id) return
      if (signal.toSession !== sessionIdRef.current || signal.fromSession === sessionIdRef.current) return
      const peer = ensurePeer(signal.fromSession, signal.fromUserId)
      if (!peer) return

      enqueuePeerSignal(signal.fromSession, async () => {
        try {
          const role = getPeerRole(signal.fromSession)

          if (signal.type === "offer" && signal.sdp) {
            // Apenas o lado não-offerer aceita offers. Se chegar um offer invertido/stale,
            // ele é ignorado em vez de disputar o signalingState com o peer determinístico.
            if (role.offerer) return
            await peer.setRemoteDescription(signal.sdp)
            await bindPeerSenders(signal.fromSession, peer)
            syncRemoteReceiverTracks(signal.fromSession, peer)
            await flushPendingIce(signal.fromSession, peer)

            const answer = await peer.createAnswer()
            await peer.setLocalDescription(answer)
            if (peer.localDescription) {
              await postSignal({ type: "answer", toSession: signal.fromSession, sdp: peer.localDescription })
            }
            return
          }

          if (signal.type === "answer" && signal.sdp) {
            if (!role.offerer || peer.signalingState !== "have-local-offer") return
            await peer.setRemoteDescription(signal.sdp)
            await bindPeerSenders(signal.fromSession, peer)
            syncRemoteReceiverTracks(signal.fromSession, peer)
            await flushPendingIce(signal.fromSession, peer)
            role.restartPending = false
            return
          }

          if (signal.type === "ice" && signal.candidate) {
            if (!peer.remoteDescription) {
              const queue = pendingIceRef.current.get(signal.fromSession) ?? []
              queue.push(signal.candidate)
              pendingIceRef.current.set(signal.fromSession, queue)
              return
            }
            try {
              await peer.addIceCandidate(signal.candidate)
            } catch (error) {
              // Em ICE restart o candidate novo pode chegar alguns ms antes do novo SDP.
              // Mantém na fila e tenta novamente assim que setRemoteDescription finalizar.
              console.warn("Devboard: ICE candidate aguardará a próxima remoteDescription", error)
              const queue = pendingIceRef.current.get(signal.fromSession) ?? []
              queue.push(signal.candidate)
              pendingIceRef.current.set(signal.fromSession, queue)
            }
            return
          }

          if (signal.type === "restart-request") {
            if (role.offerer) void sendOffer(signal.fromSession, peer, true)
          }
        } catch (error) {
          console.warn("Devboard: falha ao processar sinal WebRTC", signal.type, error)
          if (peer.connectionState !== "connected") {
            setMediaError("A negociação WebRTC encontrou um erro. O Devboard tentará restabelecer a mídia.")
          }
        }
      })
    }

    void (async () => {
      try {
        const iceConfig = await loadWebRtcIceConfig(supabase)
        if (disposed) return
        iceServersRef.current = iceConfig.iceServers
        configureAndroidScreenShare(iceConfig.iceServers)
        iceHasTurnRef.current = iceConfig.hasTurn
        setIceTransport({ hasTurn: iceConfig.hasTurn, source: iceConfig.source, warning: iceConfig.warning })

        // Realtime Authorization exige o JWT atual antes de entrar em canais privados.
        await supabase.realtime.setAuth()
        if (disposed) return

        channel = supabase.channel(`meeting:${meeting.id}`, {
          config: {
            private: true,
            broadcast: { self: false, ack: true },
            presence: { key: sessionIdRef.current },
          },
        })
        channelRef.current = channel

        channel
          .on("presence", { event: "sync" }, syncPresence)
          .on("broadcast", { event: "webrtc-signal" }, ({ payload }) => handleSignal(payload as CallSignal))
          .on("broadcast", { event: "native-screen-signal" }, ({ payload }) => handleNativeScreenSignal(payload as NativeScreenSignal))
          .on("broadcast", { event: "media-state" }, ({ payload }) => handleMediaState(payload as MediaStateSignal))
          .subscribe((status, error) => {
            if (disposed) return
            if (status === "SUBSCRIBED") {
              setMediaError((current) => current.startsWith("Falha na sala") ? "" : current)
              publishPresence()
              window.setTimeout(() => broadcastMediaStateBurst(), 120)
              // Depois de uma reconexão do Realtime, conserva peers conectados e
              // reinicia apenas os que realmente perderam a rota de mídia.
              window.setTimeout(() => {
                peersRef.current.forEach((peer, sessionId) => {
                  if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
                    requestIceRestart(sessionId, peer)
                  }
                })
              }, 900)
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              console.warn("Devboard: Realtime channel", status, error)
              setMediaError("A sala em tempo real está reconectando. A mídia atual será preservada enquanto possível.")
            }
          })
      } catch (error) {
        console.error("Devboard: não foi possível preparar a sala WebRTC", error)
        if (!disposed) setMediaError("Não foi possível preparar a conexão em tempo real da chamada.")
      }
    })()

    return () => {
      disposed = true
      if (channel) {
        void channel.untrack()
        if (channelRef.current === channel) channelRef.current = null
        void supabase.removeChannel(channel)
      }
      closeAllPeers()
    }
  }, [
    open,
    meeting?.id,
    currentMeetingState?.status,
    broadcastMediaState,
    broadcastMediaStateBurst,
    closeAllPeers,
    closePeer,
    enqueuePeerSignal,
    ensurePeer,
    flushPendingIce,
    getPeerRole,
    handleNativeScreenSignal,
    bindPeerSenders,
    postSignal,
    sendOffer,
    requestIceRestart,
    publishPresence,
    schedulePeerPrune,
    supabase,
    mediaReadyMeetingId,
    syncRemoteReceiverTracks,
  ])


  React.useEffect(() => {
    if (!open) {
      setMediaReadyMeetingId(null)
      closeAllPeers()
      stopAllMedia()
      if (nativeScreenSharing) stopAndroidScreenShare()
      setNativeScreenSharing(false)
      setScreenSharing(false)
    }
  }, [closeAllPeers, nativeScreenSharing, open, stopAllMedia])

  React.useEffect(() => () => stopAllMedia(), [stopAllMedia])

  React.useEffect(() => {
    updateLocalVideo()
  }, [cameraEnabled, screenSharing, updateLocalVideo])

  async function ensureAudioTrack() {
    if (localStreamRef.current?.getAudioTracks().length) return localStreamRef.current.getAudioTracks()[0]
    if (!navigator.mediaDevices?.getUserMedia) return null
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: selectedMic
        ? { deviceId: { exact: selectedMic }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    })
    const track = stream.getAudioTracks()[0]
    if (!localStreamRef.current) localStreamRef.current = new MediaStream()
    if (track) localStreamRef.current.addTrack(track)
    syncPeerTracks()
    // O transceiver de áudio já existe desde o início da chamada; replaceTrack()
    // passa a enviar a mídia sem reiniciar ICE nem criar uma segunda negociação.
    return track ?? null
  }

  async function ensureVideoTrack() {
    if (localStreamRef.current?.getVideoTracks().length) return localStreamRef.current.getVideoTracks()[0]
    if (!navigator.mediaDevices?.getUserMedia) return null
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: selectedCamera
        ? { deviceId: { exact: selectedCamera }, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    })
    const track = stream.getVideoTracks()[0]
    if (!localStreamRef.current) localStreamRef.current = new MediaStream()
    if (track) localStreamRef.current.addTrack(track)
    updateLocalVideo()
    syncPeerTracks()
    // O transceiver de vídeo já foi negociado desde o início; basta substituir
    // a track. Reiniciar ICE aqui criava colisões de negociação entre dispositivos.
    return track ?? null
  }

  async function toggleMic() {
    try {
      const track = await ensureAudioTrack()
      if (!track) return
      const nextEnabled = !track.enabled
      track.enabled = nextEnabled
      commitMediaState({ micEnabled: nextEnabled })
      setMediaError("")
      await refreshDevices()
    } catch {
      setMediaError("Não foi possível ativar o microfone. Verifique a permissão do Chrome.")
    }
  }

  async function toggleCamera() {
    try {
      const track = await ensureVideoTrack()
      if (!track) return
      const nextEnabled = !track.enabled
      track.enabled = nextEnabled
      commitMediaState({ cameraEnabled: nextEnabled })
      setMediaError("")
      await refreshDevices()
    } catch {
      setMediaError("Não foi possível ativar a câmera. Verifique a permissão do Chrome.")
    }
  }

  async function toggleScreenShare() {
    if (nativeScreenSharing) {
      stopAndroidScreenShare()
      return
    }

    if (screenSharing) {
      screenStreamRef.current?.getTracks().forEach((track) => track.stop())
      screenStreamRef.current = null
      commitMediaState({ screenSharing: false })
      updateLocalVideo()
      syncPeerTracks()
      return
    }

    if (hasAndroidNativeScreenShare() && meeting) {
      configureAndroidScreenShare(iceServersRef.current)
      syncAndroidScreenRecipients(
        Object.values(presences)
          .filter((presence) => presence.sessionId !== sessionIdRef.current)
          .map((presence) => ({ sessionId: presence.sessionId, userId: presence.userId })),
      )
      setMediaError("Selecione no Android a tela ou aplicativo que deseja compartilhar.")
      requestAndroidScreenShare(meeting.id, sessionIdRef.current, currentUserId)
      return
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      const isAndroid = /Android/i.test(navigator.userAgent)
      setMediaError(
        isAndroid
          ? "O Chrome Android não disponibiliza captura da tela do aparelho para páginas web. A chamada continua normalmente, mas compartilhar a tela inteira exige uma versão Android nativa do Devboard (MediaProjection)."
          : "Este navegador não disponibiliza a API de compartilhamento de tela. Tente um navegador desktop compatível em HTTPS.",
      )
      return
    }

    try {
      let stream: MediaStream
      try {
        // Áudio da tela é opcional e varia por navegador/SO. Primeiro tenta a
        // experiência completa; se o navegador rejeitar apenas o áudio, mantém vídeo.
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      } catch (firstError) {
        if (firstError instanceof DOMException && firstError.name === "NotAllowedError") return
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      }

      const videoTrack = stream.getVideoTracks()[0]
      if (!videoTrack) {
        stream.getTracks().forEach((track) => track.stop())
        setMediaError("O navegador não retornou uma faixa de vídeo para o compartilhamento de tela.")
        return
      }

      screenStreamRef.current = stream
      commitMediaState({ screenSharing: true })
      setMediaError("")
      updateLocalVideo()
      syncPeerTracks()

      videoTrack.onended = () => {
        screenStreamRef.current?.getTracks().forEach((track) => track.stop())
        screenStreamRef.current = null
        commitMediaState({ screenSharing: false })
        updateLocalVideo()
        syncPeerTracks()
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotAllowedError") return
      console.warn("Devboard: falha ao iniciar compartilhamento de tela", error)
      setMediaError("Não foi possível iniciar o compartilhamento de tela neste dispositivo.")
    }
  }

  async function switchMicrophone(deviceId: string) {
    setSelectedMic(deviceId)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
          : { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      })
      const next = stream.getAudioTracks()[0]
      const old = localStreamRef.current?.getAudioTracks()[0]
      if (!localStreamRef.current) localStreamRef.current = new MediaStream()
      if (old) {
        localStreamRef.current.removeTrack(old)
        old.stop()
      }
      if (next) {
        next.enabled = presenceStateRef.current.micEnabled
        localStreamRef.current.addTrack(next)
      }
      syncPeerTracks()
      await refreshDevices()
    } catch {
      setMediaError("Não foi possível trocar o microfone.")
    }
  }

  async function switchCamera(deviceId: string) {
    setSelectedCamera(deviceId)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      const next = stream.getVideoTracks()[0]
      const old = localStreamRef.current?.getVideoTracks()[0]
      if (!localStreamRef.current) localStreamRef.current = new MediaStream()
      if (old) {
        localStreamRef.current.removeTrack(old)
        old.stop()
      }
      if (next) {
        next.enabled = presenceStateRef.current.cameraEnabled
        localStreamRef.current.addTrack(next)
      }
      updateLocalVideo()
      syncPeerTracks()
      await refreshDevices()
    } catch {
      setMediaError("Não foi possível trocar a câmera.")
    }
  }

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return

    let recoveryRunning = false
    let lastRecoveryAt = 0

    const recoverCall = async (forceIceRestart = false) => {
      if (recoveryRunning || document.visibilityState === "hidden") return
      const now = Date.now()
      if (!forceIceRestart && now - lastRecoveryAt < 1200) return
      lastRecoveryAt = now
      recoveryRunning = true

      try {
        await resumeCallAudio()

        const expected = presenceStateRef.current
        const audioTrack = localStreamRef.current?.getAudioTracks()[0]
        const videoTrack = localStreamRef.current?.getVideoTracks()[0]

        if (expected.micEnabled && (!audioTrack || audioTrack.readyState === "ended")) {
          await ensureAudioTrack().catch(() => null)
        }
        if (
          expected.cameraEnabled &&
          !expected.screenSharing &&
          (!videoTrack || videoTrack.readyState === "ended")
        ) {
          await ensureVideoTrack().catch(() => null)
        }

        syncPeerTracks()
        publishPresence()
        broadcastMediaStateBurst()

        peersRef.current.forEach((peer, sessionId) => {
          syncRemoteReceiverTracks(sessionId, peer)
          if (
            forceIceRestart ||
            peer.connectionState === "failed" ||
            peer.connectionState === "disconnected"
          ) {
            requestIceRestart(sessionId, peer)
          }
        })
      } finally {
        recoveryRunning = false
      }
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        window.setTimeout(() => void recoverCall(false), 120)
      }
    }
    const onOnline = () => window.setTimeout(() => void recoverCall(true), 250)

    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("online", onOnline)

    const networkConnection = (navigator as Navigator & { connection?: EventTarget }).connection
    networkConnection?.addEventListener?.("change", onOnline)

    return () => {
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("online", onOnline)
      networkConnection?.removeEventListener?.("change", onOnline)
    }
  }, [
    open,
    meeting?.id,
    currentMeetingState?.status,
    broadcastMediaStateBurst,
    publishPresence,
    requestIceRestart,
    syncPeerTracks,
    syncRemoteReceiverTracks,
  ])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return

    const interval = window.setInterval(() => {
      peersRef.current.forEach((peer, sessionId) => {
        if (peer.connectionState !== "connected") return

        void peer.getStats().then((stats) => {
          let inboundBytes = 0
          let outboundBytes = 0

          stats.forEach((report) => {
            if (report.type === "inbound-rtp" && !report.isRemote) {
              inboundBytes += Number(report.bytesReceived ?? 0)
            } else if (report.type === "outbound-rtp" && !report.isRemote) {
              outboundBytes += Number(report.bytesSent ?? 0)
            }
          })

          const previous = peerHealthRef.current.get(sessionId)
          const remote = remoteMediaStateRef.current.get(sessionId)
          const inboundExpected = Boolean(
            remote?.micEnabled || remote?.cameraEnabled || remote?.screenSharing,
          )
          const local = presenceStateRef.current
          const outboundExpected = Boolean(
            local.micEnabled || local.cameraEnabled || local.screenSharing,
          )

          const inboundStalled = Boolean(
            previous && inboundExpected && inboundBytes <= previous.inboundBytes,
          )
          const outboundStalled = Boolean(
            previous && outboundExpected && outboundBytes <= previous.outboundBytes,
          )
          const stalledChecks = inboundStalled || outboundStalled
            ? (previous?.stalledChecks ?? 0) + 1
            : 0

          peerHealthRef.current.set(sessionId, {
            inboundBytes,
            outboundBytes,
            stalledChecks,
          })

          syncRemoteReceiverTracks(sessionId, peer)

          // Quatro verificações de 5 s evitam reiniciar por jitter momentâneo.
          // Quando RTP realmente para por ~20 s, recupera a rota ICE automaticamente.
          if (stalledChecks >= 4) {
            peerHealthRef.current.set(sessionId, {
              inboundBytes,
              outboundBytes,
              stalledChecks: 0,
            })
            requestIceRestart(sessionId, peer)
          }
        }).catch(() => undefined)
      })
    }, 5000)

    return () => window.clearInterval(interval)
  }, [
    open,
    meeting?.id,
    currentMeetingState?.status,
    requestIceRestart,
    syncRemoteReceiverTracks,
  ])

  async function leaveRoom() {
    if (!meeting || leavingMeeting) return
    setLeavingMeeting(true)
    try {
      await leaveMeeting(meeting.id)
      onOpenChange(false)
    } finally {
      setLeavingMeeting(false)
    }
  }

  async function finishMeeting() {
    if (!meeting || !canEndMeeting || endingMeeting) return
    if (!window.confirm(`Encerrar a reunião “${meeting.title}” para todos os participantes?`)) return
    setEndingMeeting(true)
    try {
      if (await endMeeting(meeting.id)) onOpenChange(false)
    } finally {
      setEndingMeeting(false)
    }
  }

  if (!meeting || !currentMember || currentMeetingState?.status !== "joined") return null

  const secondsRunning = (now - new Date(meeting.createdAt).getTime()) / 1000
  const presenceByUser = new Map<string, Presence>()
  Object.values(presences).forEach((presence) => {
    if (!presenceByUser.has(presence.userId)) presenceByUser.set(presence.userId, presence)
  })
  const connectedCount = 1 + meetingMembers.filter((member) => member.id !== currentUserId && presenceByUser.has(member.id)).length
  const hasFocusedMember = Boolean(focusedMemberId && meetingMembers.some((member) => member.id === focusedMemberId))
  const orderedMeetingMembers = hasFocusedMember
    ? [...meetingMembers].sort((a, b) => Number(b.id === focusedMemberId) - Number(a.id === focusedMemberId))
    : meetingMembers

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) void leaveRoom(); else onOpenChange(true) }}>
      <DialogContent
        showCloseButton={false}
        onPointerDownCapture={() => { void primeCallAudio() }}
        className="h-[min(94dvh,940px)] max-h-[94dvh] w-[calc(100vw-1rem)] max-w-[1500px] overflow-hidden rounded-2xl bg-background p-0 sm:w-[calc(100vw-2rem)] sm:max-w-[1500px]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <header className="flex min-h-16 items-center gap-3 border-b border-border bg-card px-3 py-2.5 sm:px-4">
            <Button type="button" variant="ghost" size="icon" onClick={() => void leaveRoom()} title="Sair da reunião" loading={leavingMeeting}>
              <ChevronLeft className="size-4" />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <h2 className="truncate text-sm font-semibold sm:text-base">{meeting.title}</h2>
                <span className="hidden shrink-0 rounded-md bg-success/12 px-2 py-1 text-[0.58rem] font-medium text-success sm:inline">
                  EM ANDAMENTO
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[0.62rem] text-muted-foreground">
                {formatDuration(secondsRunning)} · {connectedCount}/{meetingMembers.length} na sala · {meeting.mode === "video" ? "Vídeo" : "Áudio"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant={panel === "participants" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setPanel((current) => current === "participants" ? null : "participants")}
                title="Participantes"
              >
                <Users className="size-4" />
              </Button>
              <Button
                type="button"
                variant={panel === "settings" ? "secondary" : "ghost"}
                size="icon"
                onClick={() => setPanel((current) => current === "settings" ? null : "settings")}
                title="Dispositivos"
              >
                <Settings2 className="size-4" />
              </Button>
            </div>
          </header>

          {mediaError && (
            <div className="border-b border-destructive/20 bg-destructive/8 px-4 py-2 text-xs text-destructive">
              {mediaError}
            </div>
          )}
          {iceTransport.warning && (
            <div className="border-b border-amber-500/20 bg-amber-500/8 px-4 py-2 text-[0.68rem] text-amber-700 dark:text-amber-300">
              {iceTransport.warning}
            </div>
          )}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <main className="min-w-0 flex-1 overflow-y-auto bg-muted/10 p-2 sm:p-3 lg:p-4">
              <div className={cn(
                "grid min-h-full items-stretch gap-2 sm:gap-3",
                hasFocusedMember
                  ? "auto-rows-auto grid-cols-2 content-start lg:grid-cols-12"
                  : cn(
                      "h-full auto-rows-fr",
                      meetingMembers.length <= 1
                        ? "grid-cols-1"
                        : meetingMembers.length === 2
                          ? "grid-cols-1 md:grid-cols-2"
                          : "grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3",
                    ),
              )}>
                {orderedMeetingMembers.map((member) => {
                  const own = member.id === currentUserId
                  const presence = presenceByUser.get(member.id)
                  const prioritized = hasFocusedMember && member.id === focusedMemberId
                  const compact = hasFocusedMember && !prioritized
                  return (
                    <div
                      key={member.id}
                      className={cn(
                        "min-h-0 min-w-0",
                        !hasFocusedMember && "h-full",
                        hasFocusedMember && (prioritized
                          ? "col-span-2 lg:col-span-9 lg:row-span-2"
                          : "col-span-1 lg:col-span-3"),
                      )}
                    >
                      <ParticipantTile
                        member={member}
                        own={own}
                        connected={own || Boolean(presence)}
                        connectionState={presence ? peerStates[presence.sessionId] : undefined}
                        presence={presence}
                        cameraEnabled={own ? cameraEnabled : presence?.cameraEnabled}
                        micEnabled={own ? micEnabled : presence?.micEnabled}
                        screenSharing={own ? screenSharing : presence?.screenSharing}
                        localVideoRef={own ? localVideoRef : undefined}
                        remoteStream={presence ? remoteStreams[presence.sessionId] : undefined}
                        remoteScreenStream={presence ? nativeScreenStreams[presence.sessionId] : undefined}
                        nativeScreenShare={own ? nativeScreenSharing : false}
                        prioritized={prioritized}
                        compact={compact}
                        onPrioritize={() => setFocusedMemberId((current) => current === member.id ? null : member.id)}
                        deafened={deafened}
                      />
                    </div>
                  )
                })}
              </div>
            </main>

            {panel && (
              <aside className="absolute inset-x-2 bottom-20 z-20 max-h-[55dvh] overflow-y-auto rounded-2xl border border-border bg-card p-3 shadow-xl sm:inset-x-auto sm:right-3 sm:w-80 lg:static lg:max-h-none lg:w-80 lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l lg:shadow-none">
                {panel === "participants" ? (
                  <>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">Participantes</p>
                        <p className="mt-0.5 text-[0.62rem] text-muted-foreground">{connectedCount} conectado{connectedCount === 1 ? "" : "s"}</p>
                      </div>
                      <Users className="size-4 text-muted-foreground" />
                    </div>
                    <div className="space-y-1">
                      {meetingMembers.map((member) => {
                        const own = member.id === currentUserId
                        const presence = presenceByUser.get(member.id)
                        const connected = own || Boolean(presence)
                        const mic = own ? micEnabled : presence?.micEnabled
                        const camera = own ? cameraEnabled : presence?.cameraEnabled
                        return (
                          <div key={member.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-muted/40">
                            <div className="relative">
                              <MemberAvatar member={member} className="size-8 ring-0" />
                              <span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card", connected ? "bg-success" : "bg-muted-foreground/40")} />
                            </div>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{member.name}{own ? " · Você" : ""}</span>
                              <span className="block text-[0.58rem] text-muted-foreground">
                                {connected
                                  ? own
                                    ? "Na reunião"
                                    : `${peerStates[presence?.sessionId ?? ""] === "connected" ? "Mídia conectada" : "Conectando mídia"}${peerRoutes[presence?.sessionId ?? ""] ? ` · ${peerRoutes[presence?.sessionId ?? ""]}` : ""}`
                                  : meeting?.memberStates.find((state) => state.userId === member.id)?.status === "declined"
                                    ? "Recusou a chamada"
                                    : meeting?.memberStates.find((state) => state.userId === member.id)?.status === "left"
                                      ? "Saiu da reunião"
                                      : "Convidado · aguardando"}
                              </span>
                            </span>
                            {connected && (
                              <span className="flex items-center gap-1 text-muted-foreground">
                                {mic ? <Mic className="size-3" /> : <MicOff className="size-3 text-destructive" />}
                                {camera && <Camera className="size-3" />}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {canEndMeeting && (
                      <div className="mt-4 border-t border-border pt-3">
                        <Button type="button" variant="destructive" className="w-full gap-1.5" onClick={() => void finishMeeting()} loading={endingMeeting} loadingText="Encerrando...">
                          <PhoneOff className="size-3.5" />
                          Encerrar reunião para todos
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="mb-4 flex items-center gap-2">
                      <Settings2 className="size-4 text-muted-foreground" />
                      <div>
                        <p className="text-xs font-semibold">Áudio e vídeo</p>
                        <p className="text-[0.6rem] text-muted-foreground">Dispositivos desta aba</p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <label className="block">
                        <span className="mb-1.5 block text-[0.65rem] font-medium text-muted-foreground">Microfone</span>
                        <select
                          value={selectedMic}
                          onChange={(event) => void switchMicrophone(event.target.value)}
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-primary/40"
                        >
                          <option value="">Padrão do sistema</option>
                          {microphoneDevices.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index, "microfone")}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[0.65rem] font-medium text-muted-foreground">Câmera</span>
                        <select
                          value={selectedCamera}
                          onChange={(event) => void switchCamera(event.target.value)}
                          className="h-10 w-full rounded-xl border border-border bg-background px-3 text-xs outline-none focus:border-primary/40"
                        >
                          <option value="">Padrão do sistema</option>
                          {cameraDevices.map((device, index) => (
                            <option key={device.deviceId} value={device.deviceId}>{deviceLabel(device, index, "câmera")}</option>
                          ))}
                        </select>
                      </label>
                      <div className="rounded-xl border border-border bg-muted/20 px-3 py-3 text-[0.65rem] leading-relaxed">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">Conectividade WebRTC</span>
                          <span className={cn("rounded-md px-2 py-0.5 text-[0.58rem] font-medium", iceTransport.hasTurn ? "bg-success/12 text-success" : "bg-amber-500/12 text-amber-700 dark:text-amber-300")}>
                            {iceTransport.hasTurn ? "TURN disponível" : "Somente STUN"}
                          </span>
                        </div>
                        <div className="space-y-1 text-muted-foreground">
                          {meetingMembers.filter((member) => member.id !== currentUserId).map((member) => {
                            const presence = presenceByUser.get(member.id)
                            const state = presence ? peerStates[presence.sessionId] : undefined
                            const route = presence ? peerRoutes[presence.sessionId] : undefined
                            return (
                              <div key={member.id} className="flex items-center justify-between gap-2">
                                <span className="truncate">{member.name}</span>
                                <span className="shrink-0 font-mono text-[0.58rem]">{route ?? state ?? "aguardando"}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                      <div className="rounded-xl border border-dashed border-border bg-muted/25 px-3 py-3 text-[0.65rem] leading-relaxed text-muted-foreground">
                        <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                          <ShieldCheck className="size-3.5" /> Permissões do navegador
                        </div>
                        O Chrome pode pedir autorização para microfone, câmera e compartilhamento de tela. Em produção, use HTTPS.
                      </div>
                    </div>
                  </>
                )}
              </aside>
            )}
          </div>

          <footer className="border-t border-border bg-card px-2 py-2.5 sm:px-4 sm:py-3">
            <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                variant={micEnabled ? "secondary" : "destructive"}
                size="icon-lg"
                onClick={() => void toggleMic()}
                title={micEnabled ? "Mutar microfone" : "Ativar microfone"}
              >
                {micEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
              </Button>
              <Button
                type="button"
                variant={cameraEnabled ? "secondary" : "outline"}
                size="icon-lg"
                onClick={() => void toggleCamera()}
                title={cameraEnabled ? "Desligar câmera" : "Ligar câmera"}
              >
                {cameraEnabled ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
              </Button>
              <Button
                type="button"
                variant={screenSharing ? "default" : "outline"}
                size="icon-lg"
                onClick={() => void toggleScreenShare()}
                title={screenSharing ? "Parar compartilhamento" : "Compartilhar tela"}
              >
                <MonitorUp className="size-4" />
              </Button>
              <Button
                type="button"
                variant={deafened ? "destructive" : "outline"}
                size="icon-lg"
                onClick={() => { void primeCallAudio(); setDeafened((current) => !current) }}
                title={deafened ? "Ouvir áudio da sala" : "Silenciar áudio recebido"}
              >
                {deafened ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </Button>
              <div className="mx-1 hidden h-7 w-px bg-border sm:block" />
              <Button type="button" variant="destructive" className="h-9 gap-1.5 px-4" onClick={leaveRoom}>
                <PhoneOff className="size-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
            <p className="mt-1.5 text-center text-[0.56rem] text-muted-foreground">
              {deafened ? "Áudio recebido silenciado" : "Áudio recebido ativo"} · Compartilhamento usa a janela/tela escolhida no Chrome
            </p>
          </footer>
        </div>
      </DialogContent>
    </Dialog>
  )
}
