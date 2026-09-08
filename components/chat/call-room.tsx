"use client"

import * as React from "react"
import {
  Camera,
  CameraOff,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  Maximize2,
  Minimize2,
  MessageSquareText,
  PhoneCall,
  PhoneOff,
  Search,
  UserPlus,
  Settings2,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import type { ChatMeeting, Member } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { MeetingChatPanel } from "@/components/chat/meeting-chat-panel"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { loadWebRtcIceConfig } from "@/lib/webrtc/ice-servers"
import { getCallAudioContext, primeCallAudio, resumeCallAudio } from "@/lib/webrtc/audio-playback"
import { toUserFacingError } from "@/lib/user-facing-error"
import { BrowserMeetingRecorder, clearMeetingRecordingSegments, countMeetingRecordingSegments, readMeetingRecordingSegment, type MeetingRecordingSource } from "@/lib/meeting-recorder"
import { prepareVideoAttachment } from "@/lib/video-attachment-processor"
import { ATTACHMENTS_BUCKET, SERVICE_REQUEST_MEDIA_BUCKET, attachmentStoragePath, serviceRequestMediaStoragePath } from "@/lib/supabase/helpers"
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

type MeetingRecordingContext = {
  canRecord: boolean
  hasContext: boolean
  status: string
  recorderId?: string | null
  workspaceId?: string | null
  projectId?: string | null
  activityId?: string | null
  subactivityId?: string | null
  requestId?: string | null
  aqsReviewId?: string | null
}

type MeetingRecordingState = "idle" | "waiting" | "recording" | "finalizing" | "published" | "error" | "unavailable"

type RecordingStateSignal = {
  meetingId: string
  recorderId: string
  status: "recording" | "finalizing" | "published" | "failed"
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

type PanelMode = "participants" | "chat" | "settings" | null

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

function meetingRecordingBaseName(title: string) {
  const safe = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72)
  return safe || "Reuniao"
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}

function deviceLabel(device: MediaDeviceInfo, index: number, kind: "microfone" | "câmera") {
  return device.label || `${kind === "microfone" ? "Microfone" : "Câmera"} ${index + 1}`
}

function peerConnectionLabel(state?: RTCPeerConnectionState, route?: string) {
  if (state === "failed" || state === "disconnected") return "Conexão instável"
  if (state === "connected") return route || "Conectado"
  if (state === "connecting") return "Conectando"
  if (state === "closed") return "Encerrado"
  return "Aguardando"
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
              <p className="text-sm font-medium"><MemberName member={member} suffix=" · Você" /></p>
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
                <p className="text-sm font-medium"><MemberName member={member} /></p>
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
        <MemberName member={member} className="min-w-0 truncate text-xs font-medium" suffix={own ? " · Você" : ""} />
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
  minimized = false,
  onMinimize,
  onRestore,
  onOpenChange,
}: {
  meeting: ChatMeeting | null
  open: boolean
  minimized?: boolean
  onMinimize?: () => void
  onRestore?: () => void
  onOpenChange: (open: boolean) => void
}) {
  const { members, currentUserId, currentUserRole, endMeeting, leaveMeeting, heartbeatMeeting, inviteMeetingUser, refreshAll } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const [micEnabled, setMicEnabled] = React.useState(true)
  const [cameraEnabled, setCameraEnabled] = React.useState(meeting?.mode === "video")
  const [screenSharing, setScreenSharing] = React.useState(false)
  const [nativeScreenSharing, setNativeScreenSharing] = React.useState(false)
  const [deafened, setDeafened] = React.useState(false)
  const [panel, setPanel] = React.useState<PanelMode>(null)
  const [participantsExpanded, setParticipantsExpanded] = React.useState(false)
  const [memberPickerOpen, setMemberPickerOpen] = React.useState(false)
  const [memberQuery, setMemberQuery] = React.useState("")
  const [invitingUserId, setInvitingUserId] = React.useState<string | null>(null)
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
  const [recordingState, setRecordingState] = React.useState<MeetingRecordingState>("idle")
  const [recordingMessage, setRecordingMessage] = React.useState("")
  const [remoteRecordingActive, setRemoteRecordingActive] = React.useState(false)
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

  const meetingRecorderRef = React.useRef<BrowserMeetingRecorder | null>(null)
  const recordingContextRef = React.useRef<MeetingRecordingContext | null>(null)
  const recordingHeartbeatRef = React.useRef<number | null>(null)
  const recordingClaimTimerRef = React.useRef<number | null>(null)
  const recordingFinalizePromiseRef = React.useRef<Promise<boolean> | null>(null)
  const finalizeRecordingRef = React.useRef<(() => Promise<boolean>) | null>(null)

  const currentMember = members.find((member) => member.id === currentUserId)
  const currentMeetingState = meeting?.memberStates.find((member) => member.userId === currentUserId)
  const meetingMembers = React.useMemo(() => (
    meeting?.memberIds
      .map((id) => members.find((member) => member.id === id))
      .filter((member): member is Member => Boolean(member)) ?? []
  ), [meeting?.memberIds, members])
  const canEndMeeting = Boolean(
    meeting && (currentUserRole === "admin" || meeting.createdBy === currentUserId),
  )
  const inviteCandidates = members
    .filter((member) => member.id !== currentUserId)
    .filter((member) => !memberQuery.trim() || member.name.toLocaleLowerCase("pt-BR").includes(memberQuery.trim().toLocaleLowerCase("pt-BR")))
    .sort((a, b) => {
      const aInMeeting = meeting?.memberIds.includes(a.id) ? 1 : 0
      const bInMeeting = meeting?.memberIds.includes(b.id) ? 1 : 0
      return aInMeeting - bInMeeting || a.name.localeCompare(b.name, "pt-BR")
    })
    .slice(0, 40)

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

  const broadcastRecordingState = React.useCallback(async (status: RecordingStateSignal["status"]) => {
    if (!meeting || !channelRef.current) return false
    try {
      const result = await channelRef.current.send({
        type: "broadcast",
        event: "recording-state",
        payload: {
          meetingId: meeting.id,
          recorderId: currentUserId,
          status,
          sentAt: new Date().toISOString(),
        } satisfies RecordingStateSignal,
      })
      return result === "ok"
    } catch {
      return false
    }
  }, [currentUserId, meeting?.id])

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
        setMediaError("A conexão da chamada demorou mais que o esperado. Tentando reconectar...")
        return false
      }
      return true
    } catch {
      setMediaError("Não foi possível manter a conexão da reunião. Tentando reconectar...")
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
        ? "Conexão alternativa"
        : types.includes("host")
          ? "Rede local"
          : "Conexão direta"
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
      setMediaError("Não foi possível sincronizar um dos dispositivos com a chamada. Tentando manter a conexão ativa.")
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
      setMediaError("Não foi possível conectar o áudio e o vídeo com um participante. O Devboard tentará novamente.")
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
          "A conexão de áudio e vídeo foi interrompida. O Devboard está tentando restabelecer a reunião automaticamente.",
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
      setMediaError("O navegador não liberou a câmera ou o microfone nesta página. Verifique as permissões e tente novamente.")
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
      setMediaError(toUserFacingError(
        error,
        "Não foi possível acessar a câmera ou o microfone. Verifique as permissões do navegador",
      ))
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
    setPanel(null)
    setParticipantsExpanded(false)
    setMemberPickerOpen(false)
    setRecordingState("idle")
    setRecordingMessage("")
    setRemoteRecordingActive(false)
    setMemberQuery("")
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
    if (!open || !meeting || currentMeetingState?.status !== "joined" || mediaReadyMeetingId !== meeting.id) return
    let disposed = false

    async function attemptClaim() {
      if (disposed || !meeting) return
      try {
        const { data, error } = await supabase.rpc("claim_meeting_recording", { p_meeting_id: meeting.id })
        if (error) throw error
        if (disposed) return
        const context = (data ?? {}) as MeetingRecordingContext
        recordingContextRef.current = context

        if (!context.hasContext) {
          setRecordingState("unavailable")
          setRecordingMessage("Esta reunião não possui um tópico de origem para receber a gravação.")
          return
        }

        if (context.status === "published") {
          setRecordingState("published")
          setRemoteRecordingActive(false)
          return
        }

        if (!context.canRecord) {
          setRecordingState("waiting")
          setRemoteRecordingActive(context.status === "recording" || context.status === "finalizing")
          recordingClaimTimerRef.current = window.setTimeout(() => void attemptClaim(), 12_000)
          return
        }

        if (meetingRecorderRef.current) return
        const previousSegments = await countMeetingRecordingSegments(meeting.id).catch(() => 0)
        if (disposed) return
        const recorder = new BrowserMeetingRecorder(meeting.id, previousSegments)
        meetingRecorderRef.current = recorder
        await recorder.start()
        if (disposed) {
          void recorder.stop()
          return
        }
        setRecordingState("recording")
        setRecordingMessage(previousSegments > 0 ? "Gravação retomada neste dispositivo." : "Gravação automática em andamento.")
        setRemoteRecordingActive(false)
        void broadcastRecordingState("recording")

        if (recordingHeartbeatRef.current !== null) window.clearInterval(recordingHeartbeatRef.current)
        recordingHeartbeatRef.current = window.setInterval(() => {
          void supabase.rpc("meeting_recording_heartbeat", { p_meeting_id: meeting.id })
          void broadcastRecordingState("recording")
        }, 15_000)
      } catch (error) {
        if (disposed) return
        console.warn("Devboard: gravação automática indisponível", error)
        const message = toUserFacingError(error, "Não foi possível iniciar a gravação automática desta reunião")
        if (recordingContextRef.current?.canRecord && meeting) {
          try { await supabase.rpc("meeting_recording_mark_failed", { p_meeting_id: meeting.id, p_error: message }) } catch {}
          void broadcastRecordingState("failed")
        }
        setRecordingState("error")
        setRecordingMessage(message)
      }
    }

    void attemptClaim()
    return () => {
      disposed = true
      if (recordingClaimTimerRef.current !== null) {
        window.clearTimeout(recordingClaimTimerRef.current)
        recordingClaimTimerRef.current = null
      }
    }
  }, [broadcastRecordingState, currentMeetingState?.status, mediaReadyMeetingId, meeting?.id, open, supabase])

  React.useEffect(() => {
    const recorder = meetingRecorderRef.current
    if (!recorder || !meeting) return

    const sources: MeetingRecordingSource[] = []
    for (const member of meetingMembers) {
      const own = member.id === currentUserId
      const presence = own ? undefined : Object.values(presences).find((item) => item.userId === member.id)
      if (!own && !presence) continue

      if (own) {
        const audioTrack = localStreamRef.current?.getAudioTracks().find((track) => track.readyState === "live")
        const visualStream = screenStreamRef.current ?? localStreamRef.current
        const videoTrack = visualStream?.getVideoTracks().find((track) => track.readyState === "live")
        const tracks: MediaStreamTrack[] = []
        if (audioTrack) tracks.push(audioTrack)
        if (videoTrack) tracks.push(videoTrack)
        sources.push({
          id: member.id,
          name: member.name,
          stream: new MediaStream(tracks),
          videoEnabled: Boolean(videoTrack && (screenSharing || cameraEnabled)),
          screenSharing: Boolean(screenSharing),
        })
        continue
      }

      const remote = presence ? remoteStreams[presence.sessionId] : undefined
      const nativeScreen = presence ? nativeScreenStreams[presence.sessionId] : undefined
      const audioTrack = remote?.getAudioTracks().find((track) => track.readyState === "live")
      const visual = presence?.screenSharing && nativeScreen ? nativeScreen : remote
      const videoTrack = visual?.getVideoTracks().find((track) => track.readyState === "live")
      const tracks: MediaStreamTrack[] = []
      if (audioTrack) tracks.push(audioTrack)
      if (videoTrack) tracks.push(videoTrack)
      sources.push({
        id: member.id,
        name: member.name,
        stream: new MediaStream(tracks),
        videoEnabled: Boolean(videoTrack && (presence?.cameraEnabled || presence?.screenSharing)),
        screenSharing: Boolean(presence?.screenSharing),
      })
    }
    recorder.updateSources(sources)
  }, [cameraEnabled, currentUserId, meeting?.id, meetingMembers, nativeScreenStreams, presences, remoteStreams, screenSharing, selectedCamera, selectedMic])

  React.useEffect(() => {
    return () => {
      if (recordingHeartbeatRef.current !== null) {
        window.clearInterval(recordingHeartbeatRef.current)
        recordingHeartbeatRef.current = null
      }
      if (recordingClaimTimerRef.current !== null) {
        window.clearTimeout(recordingClaimTimerRef.current)
        recordingClaimTimerRef.current = null
      }
      const recorder = meetingRecorderRef.current
      meetingRecorderRef.current = null
      if (recorder) void recorder.stop()
      recordingContextRef.current = null
      recordingFinalizePromiseRef.current = null
    }
  }, [meeting?.id])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") return
    return subscribeAndroidScreenState(({ active, error }) => {
      setNativeScreenSharing(active)
      commitMediaState({ screenSharing: active })
      if (error) setMediaError(toUserFacingError(error, "Não foi possível compartilhar a tela"))
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

    const handleRecordingState = (state: RecordingStateSignal) => {
      if (state.meetingId !== meeting.id || state.recorderId === currentUserId) return
      setRemoteRecordingActive(state.status === "recording" || state.status === "finalizing")
      if (state.status === "published") setRecordingState((current) => current === "recording" ? current : "published")
    }

    const handleRecordingStopRequest = () => {
      if (!meetingRecorderRef.current) return
      void finalizeRecordingRef.current?.()
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
            setMediaError("A conexão de áudio e vídeo encontrou um problema. O Devboard tentará restabelecê-la.")
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
          .on("broadcast", { event: "recording-state" }, ({ payload }) => handleRecordingState(payload as RecordingStateSignal))
          .on("broadcast", { event: "recording-stop-request" }, handleRecordingStopRequest)
          .subscribe((status, error) => {
            if (disposed) return
            if (status === "SUBSCRIBED") {
              setMediaError((current) => current.startsWith("Falha na sala") ? "" : current)
              publishPresence()
              window.setTimeout(() => broadcastMediaStateBurst(), 120)
              if (meetingRecorderRef.current) window.setTimeout(() => void broadcastRecordingState("recording"), 180)
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
    broadcastRecordingState,
    currentUserId,
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
      setMediaError("Não foi possível ativar o microfone. Verifique a permissão do navegador.")
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
      setMediaError("Não foi possível ativar a câmera. Verifique a permissão do navegador.")
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
          ? "Este navegador no Android não permite compartilhar a tela inteira. A chamada pode continuar normalmente."
          : "Este navegador não permite compartilhar a tela. Tente novamente em um navegador compatível.",
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
        setMediaError("Não foi possível capturar a tela selecionada. Tente novamente.")
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

  const finalizeAndPublishRecording = React.useCallback(async () => {
    if (!meeting) return true
    if (recordingFinalizePromiseRef.current) return recordingFinalizePromiseRef.current

    const task = (async () => {
      const recorder = meetingRecorderRef.current
      const context = recordingContextRef.current
      if (!context?.hasContext) return true

      if (!recorder || !context.canRecord) {
        const { data } = await supabase.rpc("meeting_recording_status", { p_meeting_id: meeting.id })
        return String((data as { status?: string } | null)?.status ?? "") === "published"
      }

      const uploaded: Array<{ bucket: string; path: string }> = []
      try {
        setRecordingState("finalizing")
        setRecordingMessage("Finalizando a gravação da reunião…")
        await supabase.rpc("meeting_recording_mark_finalizing", { p_meeting_id: meeting.id })
        void broadcastRecordingState("finalizing")

        const segmentCount = await recorder.stop()
        if (recordingHeartbeatRef.current !== null) {
          window.clearInterval(recordingHeartbeatRef.current)
          recordingHeartbeatRef.current = null
        }
        if (segmentCount <= 0) throw new Error("A reunião terminou antes que o navegador conseguisse gerar a gravação.")
        if (!context.workspaceId || !context.projectId) throw new Error("O tópico de origem da reunião não pôde ser identificado.")

        const metadata: Array<{ name: string; mimeType: string; size: number; storagePath: string }> = []
        const base = meetingRecordingBaseName(meeting.title)

        for (let index = 0; index < segmentCount; index += 1) {
          const stored = await readMeetingRecordingSegment(meeting.id, index)
          if (!stored?.blob?.size) continue
          const extension = stored.mimeType.includes("mp4") ? "mp4" : "webm"
          const sourceName = `Gravacao - ${base} - trecho ${String(index + 1).padStart(2, "0")} de ${String(segmentCount).padStart(2, "0")}.${extension}`
          const sourceFile = new File([stored.blob], sourceName, { type: stored.mimeType || "video/webm", lastModified: Date.now() })

          setRecordingMessage(`Preparando gravação ${index + 1} de ${segmentCount}…`)
          const prepared = await prepareVideoAttachment(sourceFile, (progress) => {
            setRecordingMessage(`${progress.message} ${Math.round(progress.progress * 100)}%`)
          })

          for (const part of prepared) {
            const path = context.requestId
              ? serviceRequestMediaStoragePath(context.workspaceId, context.requestId, currentUserId, part.name)
              : attachmentStoragePath(context.workspaceId, context.projectId, currentUserId, {
                  name: part.name,
                  mimeType: part.type || "video/webm",
                  size: part.size,
                  kind: "video",
                })
            const bucket = context.requestId ? SERVICE_REQUEST_MEDIA_BUCKET : ATTACHMENTS_BUCKET
            setRecordingMessage(`Enviando ${metadata.length + 1}ª parte da gravação…`)
            const { error: uploadError } = await supabase.storage.from(bucket).upload(path, part, {
              contentType: part.type || "video/webm",
              cacheControl: "3600",
              upsert: false,
            })
            if (uploadError) throw uploadError
            uploaded.push({ bucket, path })
            metadata.push({
              name: part.name,
              mimeType: part.type || "video/webm",
              size: part.size,
              storagePath: path,
            })
          }
        }

        if (metadata.length === 0) throw new Error("Nenhuma parte válida da gravação foi gerada.")
        setRecordingMessage("Publicando a gravação no tópico de origem…")
        const { data, error } = await supabase.rpc("publish_meeting_recording", {
          p_meeting_id: meeting.id,
          p_parts: metadata,
        })
        if (error) throw error
        if (data !== true) throw new Error("O servidor não confirmou a publicação da gravação.")

        await clearMeetingRecordingSegments(meeting.id).catch(() => undefined)
        setRecordingState("published")
        setRecordingMessage("Gravação enviada ao tópico de origem.")
        void broadcastRecordingState("published")
        void refreshAll()
        return true
      } catch (error) {
        console.error("Devboard: falha ao finalizar gravação da reunião", error)
        for (const item of uploaded) {
          await supabase.storage.from(item.bucket).remove([item.path]).catch(() => undefined)
        }
        const message = toUserFacingError(error, "Não foi possível enviar a gravação da reunião")
        try {
          await supabase.rpc("meeting_recording_mark_failed", { p_meeting_id: meeting.id, p_error: message })
        } catch {}
        setRecordingState("error")
        setRecordingMessage(message)
        void broadcastRecordingState("failed")
        return false
      }
    })()

    recordingFinalizePromiseRef.current = task
    try {
      return await task
    } finally {
      recordingFinalizePromiseRef.current = null
    }
  }, [broadcastRecordingState, currentUserId, meeting?.id, meeting?.title, refreshAll, supabase])

  finalizeRecordingRef.current = finalizeAndPublishRecording

  const ensureRecordingPublishedBeforeEnd = React.useCallback(async () => {
    if (!meeting) return true
    if (recordingContextRef.current?.hasContext === false) return true
    if (meetingRecorderRef.current) return finalizeAndPublishRecording()

    const { data: initial, error: initialError } = await supabase.rpc("meeting_recording_status", { p_meeting_id: meeting.id })
    if (initialError) {
      setMediaError("Não foi possível confirmar o estado da gravação. Tente encerrar novamente.")
      return false
    }
    const initialStatus = initial as { status?: string; recorderId?: string | null; error?: string | null } | null
    if (initialStatus?.status === "published") return true
    if (initialStatus?.status === "failed") {
      setMediaError(initialStatus.error || "A gravação encontrou um problema no dispositivo responsável. Tente encerrar novamente.")
      return false
    }
    if (!initialStatus?.recorderId) {
      setMediaError("A gravação automática ainda não foi iniciada. Aguarde alguns segundos e tente encerrar novamente.")
      return false
    }

    setRecordingState("finalizing")
    setRecordingMessage("Aguardando o dispositivo responsável salvar a gravação…")
    try {
      await channelRef.current?.send({
        type: "broadcast",
        event: "recording-stop-request",
        payload: { meetingId: meeting.id, requestedBy: currentUserId, sentAt: new Date().toISOString() },
      })
    } catch {}

    const deadline = Date.now() + 45_000
    while (Date.now() < deadline) {
      await sleep(1400)
      const { data } = await supabase.rpc("meeting_recording_status", { p_meeting_id: meeting.id })
      const status = data as { status?: string; error?: string | null } | null
      if (status?.status === "published") {
        setRecordingState("published")
        setRecordingMessage("Gravação enviada ao tópico de origem.")
        return true
      }
      if (status?.status === "failed") {
        setRecordingState("error")
        setRecordingMessage(status.error || "A gravação não pôde ser enviada.")
        return false
      }
    }

    setRecordingState("error")
    setRecordingMessage("O dispositivo responsável pela gravação não respondeu a tempo.")
    return false
  }, [currentUserId, finalizeAndPublishRecording, meeting?.id, supabase])

  React.useEffect(() => {
    if (!memberPickerOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      // O modal de participantes deve fechar antes que o Escape chegue ao host
      // global da reunião e minimize a chamada.
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setMemberPickerOpen(false)
      setMemberQuery("")
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [memberPickerOpen])

  async function callUser(userId: string) {
    if (!meeting || invitingUserId) return
    setInvitingUserId(userId)
    try {
      const ok = await inviteMeetingUser(meeting.id, userId, true)
      if (ok) {
        setMemberPickerOpen(false)
        setMemberQuery("")
      }
    } finally {
      setInvitingUserId(null)
    }
  }

  async function leaveRoom() {
    if (!meeting || leavingMeeting) return
    setLeavingMeeting(true)
    try {
      if (meetingRecorderRef.current) {
        const saved = await finalizeAndPublishRecording()
        if (!saved) {
          const leaveAnyway = window.confirm(
            "A gravação automática ainda não foi enviada. Se você sair agora, a reunião continuará para os demais sem este dispositivo gravando. Deseja sair mesmo assim?",
          )
          if (!leaveAnyway) return
        }
      }
      await leaveMeeting(meeting.id)
      onOpenChange(false)
    } finally {
      setLeavingMeeting(false)
    }
  }

  async function finishMeeting() {
    if (!meeting || !canEndMeeting || endingMeeting) return
    if (!window.confirm(`Encerrar a reunião “${meeting.title}” para todos os participantes? A gravação será salva automaticamente no tópico de origem.`)) return
    setEndingMeeting(true)
    try {
      const recordingSaved = await ensureRecordingPublishedBeforeEnd()
      if (!recordingSaved) {
        setMediaError("A reunião não foi encerrada porque a gravação ainda não pôde ser salva. Tente novamente após corrigir o problema indicado.")
        return
      }
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
  const recordingActive = recordingState === "recording" || recordingState === "finalizing" || remoteRecordingActive
  const recordingFinalizing = recordingState === "finalizing"
  const hasFocusedMember = Boolean(focusedMemberId && meetingMembers.some((member) => member.id === focusedMemberId))
  const orderedMeetingMembers = hasFocusedMember
    ? [...meetingMembers].sort((a, b) => Number(b.id === focusedMemberId) - Number(a.id === focusedMemberId))
    : meetingMembers

  const participantsPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-[58px] shrink-0 items-center justify-between gap-3 px-3 py-2.5">
        <button
          type="button"
          className="min-w-0 flex-1 rounded-lg text-left outline-none transition-colors lg:hover:bg-muted/35 lg:focus-visible:ring-2 lg:focus-visible:ring-primary/30"
          onClick={() => setParticipantsExpanded((current) => !current)}
          title={participantsExpanded ? "Recolher participantes" : "Expandir participantes"}
        >
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold">Participantes</span>
              <span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">{connectedCount} conectado{connectedCount === 1 ? "" : "s"} · {meetingMembers.length} convidado{meetingMembers.length === 1 ? "" : "s"}</span>
            </span>
            <span className="hidden size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground lg:flex">
              {participantsExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </span>
          </span>
        </button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => { setMemberQuery(""); setMemberPickerOpen(true) }}
          title="Adicionar ou chamar participante"
          aria-label="Adicionar ou chamar participante"
        >
          <UserPlus className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 [scrollbar-width:thin]">
        {meetingMembers.map((member) => {
          const own = member.id === currentUserId
          const presence = presenceByUser.get(member.id)
          const connected = own || Boolean(presence)
          const mic = own ? micEnabled : presence?.micEnabled
          const camera = own ? cameraEnabled : presence?.cameraEnabled
          const memberState = meeting.memberStates.find((state) => state.userId === member.id)?.status
          return (
            <div key={member.id} className="group/member flex items-center gap-2.5 rounded-xl px-2 py-2 hover:bg-muted/40">
              <div className="relative">
                <MemberAvatar member={member} className="size-8 ring-0" />
                <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card", connected ? "bg-success" : "bg-muted-foreground/40")} />
              </div>
              <span className="min-w-0 flex-1">
                <MemberName member={member} className="block truncate text-xs font-medium" suffix={own ? " · Você" : ""} />
                <span className="block truncate text-[0.56rem] text-muted-foreground">
                  {connected
                    ? own
                      ? "Na reunião"
                      : `${peerStates[presence?.sessionId ?? ""] === "connected" ? "Mídia conectada" : "Conectando mídia"}${peerRoutes[presence?.sessionId ?? ""] ? ` · ${peerRoutes[presence?.sessionId ?? ""]}` : ""}`
                    : memberState === "declined"
                      ? "Recusou · pode chamar novamente"
                      : memberState === "left"
                        ? "Saiu · pode chamar novamente"
                        : "Convidado · aguardando"}
                </span>
              </span>
              {connected ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  {mic ? <Mic className="size-3" /> : <MicOff className="size-3 text-destructive" />}
                  {camera && <Camera className="size-3" />}
                </span>
              ) : !own ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className="size-7 shrink-0 opacity-100 sm:opacity-0 sm:group-hover/member:opacity-100"
                  loading={invitingUserId === member.id}
                  disabled={Boolean(invitingUserId)}
                  onClick={() => void callUser(member.id)}
                  title="Chamar novamente"
                  aria-label={`Chamar ${member.name}`}
                >
                  <PhoneCall className="size-3.5" />
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>

      {canEndMeeting && (
        <div className="shrink-0 border-t border-border p-2.5">
          <Button type="button" variant="destructive" size="sm" className="w-full gap-1.5" onClick={() => void finishMeeting()} loading={endingMeeting} loadingText={recordingFinalizing ? "Salvando gravação…" : "Encerrando…"}>
            <PhoneOff className="size-3.5" />
            Encerrar reunião para todos
          </Button>
        </div>
      )}
    </div>
  )

  const settingsPanel = (
    <div className="min-h-0 overflow-y-auto p-3 [scrollbar-width:thin]">
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
            <span className="font-medium text-foreground">Qualidade da conexão</span>
            <span className={cn("rounded-md px-2 py-0.5 text-[0.58rem] font-medium", iceTransport.hasTurn ? "bg-success/12 text-success" : "bg-amber-500/12 text-amber-700 dark:text-amber-300")}>
              {iceTransport.hasTurn ? "Rota alternativa disponível" : "Conexão direta"}
            </span>
          </div>
          <div className="space-y-1 text-muted-foreground">
            {meetingMembers.filter((member) => member.id !== currentUserId).map((member) => {
              const presence = presenceByUser.get(member.id)
              const state = presence ? peerStates[presence.sessionId] : undefined
              const route = presence ? peerRoutes[presence.sessionId] : undefined
              return (
                <div key={member.id} className="flex items-center justify-between gap-2">
                  <MemberName member={member} className="truncate" />
                  <span className="shrink-0 text-[0.58rem] font-medium">{peerConnectionLabel(state, route)}</span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-muted/25 px-3 py-3 text-[0.65rem] leading-relaxed text-muted-foreground">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck className="size-3.5" /> Permissões do navegador</div>
          O Chrome pode pedir autorização para microfone, câmera e compartilhamento de tela.
        </div>
      </div>
    </div>
  )

  return (
    <div
      role="dialog"
      aria-label={`Reunião ${meeting.title}`}
      className={cn(
        "fixed z-[80] transition-[inset,width,height,background-color,padding] duration-200",
        minimized
          ? "bottom-3 right-3 h-[220px] w-[min(370px,calc(100vw-1rem))]"
          : "inset-0 flex items-center justify-center bg-black/35 p-2 sm:p-4",
      )}
      onPointerDownCapture={() => { void primeCallAudio() }}
    >
      <section className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden bg-background ring-1 ring-foreground/10 transition-[width,height,border-radius,box-shadow] duration-200",
        minimized
          ? "size-full rounded-2xl shadow-2xl"
          : "h-[min(94dvh,940px)] w-full max-w-[1500px] rounded-2xl shadow-2xl",
      )}>
        <header className={cn("flex shrink-0 items-center gap-2 border-b border-border bg-card", minimized ? "min-h-10 px-2 py-1.5" : "min-h-16 px-3 py-2.5 sm:px-4") }>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(minimized && "size-8")}
            onClick={() => minimized ? onRestore?.() : onMinimize?.()}
            title={minimized ? "Restaurar reunião" : "Minimizar reunião"}
          >
            {minimized ? <Maximize2 className="size-4" /> : <ChevronLeft className="size-4" />}
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className={cn("truncate font-semibold", minimized ? "text-xs" : "text-sm sm:text-base")}>{meeting.title}</h2>
              {!minimized && <span className="hidden shrink-0 rounded-md bg-success/12 px-2 py-1 text-[0.58rem] font-medium text-success sm:inline">EM ANDAMENTO</span>}
              {recordingActive && (
                <span
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[0.56rem] font-semibold",
                    recordingFinalizing ? "bg-amber-500/12 text-amber-700 dark:text-amber-300" : "bg-destructive/12 text-destructive",
                    minimized && "px-1.5 py-0.5 text-[0.48rem]",
                  )}
                  title={recordingFinalizing ? "Salvando gravação" : "Esta reunião está sendo gravada automaticamente"}
                >
                  <span className={cn("size-1.5 rounded-full", recordingFinalizing ? "bg-amber-500" : "bg-destructive animate-pulse")} />
                  {recordingFinalizing ? "SALVANDO" : "REC"}
                </span>
              )}
            </div>
            <p className={cn("truncate font-mono text-muted-foreground", minimized ? "text-[0.5rem]" : "mt-0.5 text-[0.62rem]")}>
              {formatDuration(secondsRunning)} · {connectedCount}/{meetingMembers.length} na sala{!minimized ? ` · ${meeting.mode === "video" ? "Vídeo" : "Áudio"}` : ""}
            </p>
          </div>
          <div className={cn("flex shrink-0 items-center gap-1", minimized && "hidden")}>
            <Button
              type="button"
              variant={panel === "participants" ? "secondary" : "ghost"}
              size="icon"
              className="lg:hidden"
              onClick={() => setPanel((current) => current === "participants" ? null : "participants")}
              title="Participantes"
            >
              <Users className="size-4" />
            </Button>
            <Button
              type="button"
              variant={panel === "chat" ? "secondary" : "ghost"}
              size="icon"
              className="lg:hidden"
              onClick={() => setPanel((current) => current === "chat" ? null : "chat")}
              title="Chat da reunião"
            >
              <MessageSquareText className="size-4" />
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

        {!minimized && mediaError && (
          <div className="shrink-0 border-b border-destructive/20 bg-destructive/8 px-4 py-2 text-xs text-destructive">{mediaError}</div>
        )}
        {!minimized && iceTransport.warning && (
          <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/8 px-4 py-2 text-[0.68rem] text-amber-700 dark:text-amber-300">{iceTransport.warning}</div>
        )}

        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <main className={cn("min-w-0 flex-1 overflow-hidden bg-muted/10", minimized ? "p-1" : "overflow-y-auto p-2 sm:p-3 lg:p-4")}>
            <div className={cn(
              "grid h-full min-h-0 items-stretch",
              minimized
                ? "grid-cols-2 gap-1"
                : hasFocusedMember
                  ? "auto-rows-auto grid-cols-2 content-start gap-2 sm:gap-3 lg:grid-cols-12"
                  : cn(
                      "auto-rows-fr gap-2 sm:gap-3",
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
                const prioritized = !minimized && hasFocusedMember && member.id === focusedMemberId
                const compact = minimized || (hasFocusedMember && !prioritized)
                return (
                  <div
                    key={member.id}
                    className={cn(
                      "min-h-0 min-w-0 overflow-hidden",
                      !minimized && !hasFocusedMember && "h-full",
                      !minimized && hasFocusedMember && (prioritized ? "col-span-2 lg:col-span-9 lg:row-span-2" : "col-span-1 lg:col-span-3"),
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
                      onPrioritize={minimized ? undefined : () => setFocusedMemberId((current) => current === member.id ? null : member.id)}
                      deafened={deafened}
                    />
                  </div>
                )
              })}
            </div>
          </main>

          {!minimized && (
            <aside className="hidden w-[360px] shrink-0 min-h-0 flex-col border-l border-border bg-card lg:flex">
              {panel === "settings" ? settingsPanel : (
                <>
                  <div
                    className={cn(
                      "shrink-0 overflow-hidden border-b border-border transition-[height] duration-200 ease-out",
                      participantsExpanded ? "h-[min(40%,360px)] min-h-[190px]" : "h-[58px]",
                    )}
                  >
                    {participantsPanel}
                  </div>
                  <MeetingChatPanel meeting={meeting} />
                </>
              )}
            </aside>
          )}

          {!minimized && panel && (
            <aside className="absolute inset-x-2 bottom-2 top-2 z-20 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl lg:hidden">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
                <span className="text-xs font-semibold">{panel === "participants" ? "Participantes" : panel === "chat" ? "Chat da reunião" : "Dispositivos"}</span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setPanel(null)} aria-label="Fechar painel"><Minimize2 className="size-3.5" /></Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {panel === "participants" ? participantsPanel : panel === "chat" ? <MeetingChatPanel meeting={meeting} /> : settingsPanel}
              </div>
            </aside>
          )}
        </div>

        <footer className={cn("shrink-0 border-t border-border bg-card", minimized ? "px-1.5 py-1.5" : "px-2 py-2.5 sm:px-4 sm:py-3")}>
          <div className={cn("mx-auto flex flex-wrap items-center justify-center", minimized ? "gap-1" : "max-w-4xl gap-1.5 sm:gap-2")}>
            <Button
              type="button"
              variant={micEnabled ? "secondary" : "destructive"}
              size={minimized ? "icon-sm" : "icon-lg"}
              onClick={() => void toggleMic()}
              title={micEnabled ? "Mutar microfone" : "Ativar microfone"}
            >
              {micEnabled ? <Mic className="size-4" /> : <MicOff className="size-4" />}
            </Button>
            <Button
              type="button"
              variant={cameraEnabled ? "secondary" : "outline"}
              size={minimized ? "icon-sm" : "icon-lg"}
              onClick={() => void toggleCamera()}
              title={cameraEnabled ? "Desligar câmera" : "Ligar câmera"}
            >
              {cameraEnabled ? <Camera className="size-4" /> : <CameraOff className="size-4" />}
            </Button>
            {!minimized && (
              <>
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
              </>
            )}
            <Button type="button" variant="destructive" size={minimized ? "icon-sm" : "default"} className={cn(!minimized && "h-9 gap-1.5 px-4")} onClick={leaveRoom} loading={leavingMeeting} title="Sair da reunião">
              <PhoneOff className="size-4" />
              {!minimized && <span className="hidden sm:inline">Sair</span>}
            </Button>
          </div>
          {!minimized && (
            <div className="mt-1.5 text-center text-[0.56rem] text-muted-foreground">
              <p>{deafened ? "Áudio recebido silenciado" : "Áudio recebido ativo"} · Voltar minimiza a reunião; somente “Sair” encerra sua participação</p>
              {(recordingState === "finalizing" || recordingState === "error") && recordingMessage && (
                <p className={cn("mt-1 font-medium", recordingState === "error" ? "text-destructive" : "text-amber-700 dark:text-amber-300")}>{recordingMessage}</p>
              )}
            </div>
          )}
        </footer>
      </section>

      {memberPickerOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="meeting-participant-picker-title"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return
            setMemberPickerOpen(false)
            setMemberQuery("")
          }}
        >
          <div className="flex max-h-[min(78dvh,620px)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl ring-1 ring-foreground/10">
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-4 py-3.5">
              <div className="min-w-0">
                <h3 id="meeting-participant-picker-title" className="text-sm font-semibold">Adicionar participante</h3>
                <p className="mt-1 text-[0.65rem] leading-relaxed text-muted-foreground">Busque um usuário do workspace para adicionar ao contexto e chamar para esta reunião.</p>
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => { setMemberPickerOpen(false); setMemberQuery("") }}
                aria-label="Fechar"
              >
                <X className="size-3.5" />
              </Button>
            </div>

            <div className="shrink-0 px-4 pb-2 pt-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={memberQuery}
                  onChange={(event) => setMemberQuery(event.target.value)}
                  placeholder="Buscar por nome…"
                  className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-xs outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                  autoFocus
                />
              </label>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:thin]">
              {inviteCandidates.length === 0 ? (
                <div className="flex min-h-32 flex-col items-center justify-center px-4 text-center">
                  <Users className="size-5 text-muted-foreground" />
                  <p className="mt-2 text-xs font-medium">Nenhum usuário encontrado</p>
                  <p className="mt-1 text-[0.62rem] text-muted-foreground">Tente outro nome.</p>
                </div>
              ) : inviteCandidates.map((member) => {
                const state = meeting.memberStates.find((row) => row.userId === member.id)?.status
                const connected = state === "joined" && Boolean(presenceByUser.get(member.id))
                return (
                  <div key={member.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/55">
                    <MemberAvatar member={member} className="size-9 ring-0" />
                    <span className="min-w-0 flex-1">
                      <MemberName member={member} className="block truncate text-xs font-medium" />
                      <span className="mt-0.5 block truncate text-[0.58rem] text-muted-foreground">
                        {connected ? "Já está na sala" : state === "pending" ? "Convite pendente" : meeting.memberIds.includes(member.id) ? "Pode ser chamado novamente" : "Será adicionado ao contexto"}
                      </span>
                    </span>
                    {connected ? (
                      <span className="shrink-0 rounded-lg bg-success/10 px-2 py-1 text-[0.56rem] font-medium text-success">Na sala</span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-8 shrink-0 gap-1.5 px-2.5 text-[0.62rem]"
                        loading={invitingUserId === member.id}
                        disabled={Boolean(invitingUserId)}
                        onClick={() => void callUser(member.id)}
                      >
                        <PhoneCall className="size-3.5" />
                        {state === "pending" ? "Chamar novamente" : "Chamar"}
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-2.5">
              <p className="text-[0.58rem] leading-relaxed text-muted-foreground">Ao chamar, o usuário passa a acompanhar a subatividade, solicitação ou análise AQS vinculada à reunião.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
