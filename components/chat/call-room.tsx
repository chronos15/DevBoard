"use client"

import * as React from "react"
import {
  Camera,
  CameraOff,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  FileText,
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
  UserMinus,
  UserPlus,
  Settings2,
  ShieldCheck,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"
import type { RealtimeChannel } from "@supabase/supabase-js"
import type { AqsReview, ChatMeeting, Member, Project, ServiceRequest, Subactivity } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { MeetingChatPanel } from "@/components/chat/meeting-chat-panel"
import { ProjectFollowUp } from "@/components/project-detail/project-follow-up"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { loadWebRtcIceConfig } from "@/lib/webrtc/ice-servers"
import { getCallAudioContext, primeCallAudio, resumeCallAudio } from "@/lib/webrtc/audio-playback"
import { toUserFacingError } from "@/lib/user-facing-error"
import { BrowserMeetingRecorder, clearMeetingRecordingSegments, countMeetingRecordingSegments, readMeetingRecordingSegment, type MeetingRecordingSource } from "@/lib/meeting-recorder"
import { prepareVideoAttachment } from "@/lib/video-attachment-processor"
import { createMeetingTranscriptPdf, type MeetingTranscriptMessage } from "@/lib/meeting-transcript-pdf"
import { ATTACHMENTS_BUCKET, SERVICE_REQUEST_MEDIA_BUCKET, attachmentStoragePath, safeFileName, serviceRequestMediaStoragePath } from "@/lib/supabase/helpers"
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

type MeetingMemberRemovedSignal = {
  meetingId: string
  userId: string
  removedBy: string
  sentAt: string
}

type MeetingEndedSignal = {
  meetingId: string
  endedBy: string
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
  signalKey?: string
}

type PeerSenders = {
  audio: RTCRtpSender
  video: RTCRtpSender
}

type PeerRoleState = {
  offerer: boolean
  initialOfferSent: boolean
  offerInFlight: boolean
}

type PanelMode = "participants" | "chat" | "settings" | null

type MeetingWallContext = Pick<MeetingRecordingContext, "projectId" | "activityId" | "subactivityId" | "requestId" | "aqsReviewId" | "hasContext">

// Mantém o processamento de gravação/PDF vivo mesmo quando CallRoom é desmontado.
// A Promise continua ativa enquanto a página do TaskBoard permanecer aberta.
const backgroundMeetingFinalizationTasks = new Map<string, Promise<void>>()

const SUBACTIVITY_STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  waiting: "Aguardando",
  "waiting-aqs": "Aguardando AQS",
  "in-progress": "Em execução",
  paused: "Pausada",
  done: "Concluída",
  cancelled: "Cancelada",
}

const REQUEST_STATUS_LABELS: Record<string, string> = {
  received: "Recebida",
  "aqs-analysis": "Em análise AQS",
  "waiting-info": "Aguardando informação",
  "waiting-dev": "Aguardando DEV",
  "waiting-executor": "Aguardando executor",
  "in-dev": "Em desenvolvimento",
  "waiting-aqs": "Aguardando AQS",
  rework: "Retrabalho",
  "waiting-build": "Aguardando build",
  completed: "Concluída",
  rejected: "Rejeitada",
  cancelled: "Cancelada",
}

const AQS_STATUS_LABELS: Record<string, string> = {
  awaiting: "Aguardando",
  evaluating: "Em análise",
  completed: "Concluída",
  revoked: "Revogada",
}

function shortDateTime(value?: string) {
  if (!value) return "—"
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
}

function badgeTone(value?: string) {
  switch (value) {
    case "in-progress":
    case "in-dev":
    case "evaluating":
      return "bg-sky-500/12 text-sky-700 dark:text-sky-300"
    case "done":
    case "completed":
      return "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    case "waiting-aqs":
      return "bg-amber-500/12 text-amber-700 dark:text-amber-300"
    case "paused":
    case "rework":
    case "waiting-info":
    case "waiting-dev":
    case "waiting-executor":
    case "waiting-build":
    case "aqs-analysis":
    case "awaiting":
      return "bg-orange-500/12 text-orange-700 dark:text-orange-300"
    case "cancelled":
    case "rejected":
    case "revoked":
      return "bg-rose-500/12 text-rose-700 dark:text-rose-300"
    default:
      return "bg-muted text-muted-foreground"
  }
}

function requestTypeLabel(value?: string) {
  switch (value) {
    case "internal": return "Interno"
    case "failure": return "Falha"
    case "development": return "Desenvolvimento"
    case "adjustment": return "Ajuste"
    case "improvement": return "Melhoria"
    case "structured-triage": return "Triagem estruturada"
    default: return value || "Solicitação"
  }
}

function describeMeetingWall(context: MeetingWallContext | null, request: ServiceRequest | null, review: AqsReview | null, subactivity: Subactivity | null) {
  if (request) return "Solicitação"
  if (review) return "Análise AQS"
  if (subactivity) return "Subatividade"
  if (context?.activityId) return "Atividade"
  return "Mural"
}

function findMeetingProject(projects: Project[], context: MeetingWallContext | null) {
  if (!context) return null
  return projects.find((project) => project.id === context.projectId || project.activities.some((activity) => activity.id === context.activityId || activity.subactivities.some((subactivity) => subactivity.id === context.subactivityId))) ?? null
}

class MeetingWallErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    console.error("TaskBoard: falha no mural completo da reunião; usando mural seguro", error, info)
  }

  render() {
    if (this.state.failed) return this.props.fallback
    return this.props.children
  }
}

function MeetingWallSurface({
  loading,
  error,
  context,
  projects,
  serviceRequests,
  aqsReviews,
  members,
}: {
  loading: boolean
  error: string
  context: MeetingWallContext | null
  projects: Project[]
  serviceRequests: ServiceRequest[]
  aqsReviews: AqsReview[]
  members: Member[]
}) {
  const request = React.useMemo(() => context?.requestId ? serviceRequests.find((item) => item.id === context.requestId) ?? null : null, [context?.requestId, serviceRequests])
  const review = React.useMemo(() => context?.aqsReviewId ? aqsReviews.find((item) => item.id === context.aqsReviewId) ?? null : null, [aqsReviews, context?.aqsReviewId])
  const project = React.useMemo(() => findMeetingProject(projects, context), [projects, context])
  const activity = React.useMemo(() => project?.activities.find((item) => item.id === context?.activityId || item.subactivities.some((subactivity) => subactivity.id === context?.subactivityId)) ?? null, [context?.activityId, context?.subactivityId, project])
  const subactivity = React.useMemo(() => {
    if (context?.subactivityId) return activity?.subactivities.find((item) => item.id === context.subactivityId) ?? null
    if (review?.subactivityId) return activity?.subactivities.find((item) => item.id === review.subactivityId) ?? null
    return null
  }, [activity, context?.subactivityId, review?.subactivityId])

  const subactivityTimeline = React.useMemo(() => {
    if (!project || !subactivity) return [] as Array<{ id: string; kind: "comment" | "log"; createdAt: string; title: string; body?: string; authorId?: string }>
    const comments = (subactivity.comments ?? []).map((comment) => ({
      id: `comment-${comment.id}`,
      kind: "comment" as const,
      createdAt: comment.createdAt,
      title: "Comentário",
      body: comment.content,
      authorId: comment.authorId,
    }))
    const logs = (project.logs ?? [])
      .filter((log) => log.subactivityId === subactivity.id)
      .map((log) => ({
        id: `log-${log.id}`,
        kind: "log" as const,
        createdAt: log.createdAt,
        title: log.title,
        body: log.description,
        authorId: log.actorId,
      }))
    return [...logs, ...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [project, subactivity])

  const requestTimeline = React.useMemo(() => {
    if (!request) return [] as Array<{ id: string; kind: "message" | "event"; createdAt: string; title: string; body?: string; authorId?: string }>
    const messages = request.messages.map((message) => ({
      id: `message-${message.id}`,
      kind: "message" as const,
      createdAt: message.createdAt,
      title: "Mensagem",
      body: message.content,
      authorId: message.authorId,
    }))
    const events = request.events.map((event) => ({
      id: `event-${event.id}`,
      kind: "event" as const,
      createdAt: event.createdAt,
      title: event.title,
      body: event.description,
      authorId: event.actorId,
    }))
    return [...events, ...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [request])

  const resolveMember = React.useCallback((userId?: string | null) => userId ? members.find((member) => member.id === userId) ?? null : null, [members])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Carregando mural da origem da reunião…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!context?.hasContext) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Esta reunião não possui contexto para exibir no mural.
      </div>
    )
  }

  const wallKind = describeMeetingWall(context, request, review, subactivity)
  const requestBadge = request ? REQUEST_STATUS_LABELS[request.status] ?? request.status : null
  const reviewBadge = review ? AQS_STATUS_LABELS[review.status] ?? review.status : null
  const subactivityBadge = subactivity ? SUBACTIVITY_STATUS_LABELS[subactivity.status] ?? subactivity.status : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-[0.64rem] font-semibold text-primary">
                <FileText className="size-3.5" />
                {wallKind}
              </span>
              {request && <span className={cn("rounded-lg px-2.5 py-1 text-[0.62rem] font-medium", badgeTone(request.status))}>{requestBadge}</span>}
              {review && <span className={cn("rounded-lg px-2.5 py-1 text-[0.62rem] font-medium", badgeTone(review.status))}>{reviewBadge}</span>}
              {subactivity && <span className={cn("rounded-lg px-2.5 py-1 text-[0.62rem] font-medium", badgeTone(subactivity.status))}>{subactivityBadge}</span>}
            </div>
            <h3 className="mt-2 line-clamp-2 text-base font-semibold sm:text-lg">
              {request?.title ?? subactivity?.title ?? activity?.title ?? "Mural da reunião"}
            </h3>
            <p className="mt-1 text-[0.68rem] text-muted-foreground">
              {[project?.name, activity?.title, subactivity?.title && !request ? "Subatividade" : null].filter(Boolean).join(" · ") || "Origem da reunião"}
            </p>
          </div>
          <div className="grid min-w-[200px] grid-cols-2 gap-2 text-[0.65rem] sm:min-w-[260px]">
            <div className="rounded-xl border border-border bg-muted/25 px-3 py-2">
              <p className="text-muted-foreground">Criado em</p>
              <p className="mt-1 font-medium text-foreground">{shortDateTime(request?.createdAt ?? review?.createdAt ?? subactivity?.createdAt)}</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/25 px-3 py-2">
              <p className="text-muted-foreground">Última atualização</p>
              <p className="mt-1 font-medium text-foreground">{shortDateTime(request?.updatedAt ?? subactivity?.updatedAt ?? review?.completedAt ?? review?.startedAt ?? review?.createdAt ?? subactivity?.createdAt)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {request ? (
          <div className="space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
              <div className="rounded-2xl border border-border bg-background/80 p-4">
                <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Resumo</p>
                <div className="mt-3 flex flex-wrap gap-2 text-[0.62rem]">
                  <span className="rounded-lg bg-muted px-2.5 py-1">{requestTypeLabel(request.requestType)}</span>
                  <span className="rounded-lg bg-muted px-2.5 py-1">OS {request.orderNumber || "—"}</span>
                  <span className="rounded-lg bg-muted px-2.5 py-1">Unidade {request.unit || "—"}</span>
                  {request.module && <span className="rounded-lg bg-muted px-2.5 py-1">Módulo {request.module}</span>}
                  {request.subject && <span className="rounded-lg bg-muted px-2.5 py-1">Assunto {request.subject}</span>}
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{request.description || "Sem descrição."}</p>
              </div>
              <div className="rounded-2xl border border-border bg-background/80 p-4">
                <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Arquivos</p>
                <div className="mt-3 space-y-2">
                  {request.attachments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum anexo enviado.</p>
                  ) : request.attachments.map((attachment) => (
                    <div key={attachment.id} className="rounded-xl border border-border bg-card px-3 py-2">
                      <p className="truncate text-xs font-medium">{attachment.name}</p>
                      <p className="mt-0.5 text-[0.6rem] text-muted-foreground">{attachment.category} · {shortDateTime(attachment.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-background/80 p-4">
              <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Timeline da solicitação</p>
              <div className="mt-4 space-y-3">
                {requestTimeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem movimentações registradas.</p>
                ) : requestTimeline.map((entry) => {
                  const author = resolveMember(entry.authorId)
                  return (
                    <div key={entry.id} className="rounded-2xl border border-border bg-card px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">{entry.title}</p>
                          <p className="mt-0.5 text-[0.62rem] text-muted-foreground">{entry.kind === "message" ? "Mensagem" : "Evento"} · {shortDateTime(entry.createdAt)}</p>
                        </div>
                        {author && (
                          <div className="flex items-center gap-2 text-[0.62rem] text-muted-foreground">
                            <MemberAvatar member={author} className="size-6 ring-0" />
                            <MemberName member={author} className="truncate" />
                          </div>
                        )}
                      </div>
                      {entry.body && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{entry.body}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {(review || subactivity || activity) && (
              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
                <div className="rounded-2xl border border-border bg-background/80 p-4">
                  <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Contexto</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[0.62rem]">
                    {activity && <span className="rounded-lg bg-muted px-2.5 py-1">Atividade</span>}
                    {subactivity && <span className="rounded-lg bg-muted px-2.5 py-1">Estimativa {formatDuration(subactivity.estimatedHours * 3600)}</span>}
                    {subactivity && <span className="rounded-lg bg-muted px-2.5 py-1">Registrado {formatDuration(subactivity.trackedSeconds)}</span>}
                    {subactivity?.linkedOs && <span className="rounded-lg bg-muted px-2.5 py-1">OS {subactivity.linkedOs}</span>}
                    {subactivity?.build && <span className="rounded-lg bg-muted px-2.5 py-1">Build {subactivity.build}</span>}
                    {review && <span className="rounded-lg bg-muted px-2.5 py-1">AQS {reviewBadge}</span>}
                  </div>
                  <div className="mt-4 space-y-2 text-sm leading-relaxed">
                    <p><span className="font-medium text-foreground">Projeto:</span> <span className="text-muted-foreground">{project?.name || "—"}</span></p>
                    <p><span className="font-medium text-foreground">Atividade:</span> <span className="text-muted-foreground">{activity?.title || "—"}</span></p>
                    {subactivity && <p><span className="font-medium text-foreground">Subatividade:</span> <span className="text-muted-foreground">{subactivity.title}</span></p>}
                    {review && <p><span className="font-medium text-foreground">Status AQS:</span> <span className="text-muted-foreground">{reviewBadge}</span></p>}
                  </div>
                </div>
                <div className="rounded-2xl border border-border bg-background/80 p-4">
                  <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Anexos da subatividade</p>
                  <div className="mt-3 space-y-2">
                    {subactivity?.attachments?.length ? subactivity.attachments.map((attachment) => (
                      <div key={attachment.id} className="rounded-xl border border-border bg-card px-3 py-2">
                        <p className="truncate text-xs font-medium">{attachment.name}</p>
                        <p className="mt-0.5 text-[0.6rem] text-muted-foreground">{attachment.kind} · {shortDateTime(attachment.createdAt)}</p>
                      </div>
                    )) : <p className="text-xs text-muted-foreground">Nenhum anexo nessa subatividade.</p>}
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-2xl border border-border bg-background/80 p-4">
              <p className="text-[0.64rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Timeline da subatividade</p>
              <div className="mt-4 space-y-3">
                {subactivityTimeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Sem comentários ou logs específicos desta subatividade.</p>
                ) : subactivityTimeline.map((entry) => {
                  const author = resolveMember(entry.authorId)
                  return (
                    <div key={entry.id} className="rounded-2xl border border-border bg-card px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">{entry.title}</p>
                          <p className="mt-0.5 text-[0.62rem] text-muted-foreground">{entry.kind === "comment" ? "Comentário" : "Log"} · {shortDateTime(entry.createdAt)}</p>
                        </div>
                        {author && (
                          <div className="flex items-center gap-2 text-[0.62rem] text-muted-foreground">
                            <MemberAvatar member={author} className="size-6 ring-0" />
                            <MemberName member={author} className="truncate" />
                          </div>
                        )}
                      </div>
                      {entry.body && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{entry.body}</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}


function makeSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `call-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function makeSignalKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `signal-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isMissingMeetingSignalFallback(error: unknown) {
  if (!error || typeof error !== "object") return false
  const value = error as { code?: string; message?: string; details?: string }
  const text = `${value.message ?? ""} ${value.details ?? ""}`
  return value.code === "PGRST202" || /meeting_webrtc_signal_(send|pull)|could not find the function/i.test(text)
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
  getLocalVideoStream,
  localVideoRevision,
  remoteStream,
  remoteScreenStream,
  nativeScreenShare,
  prioritized,
  compact,
  onPrioritize,
  deafened,
  playbackRevision,
}: {
  member: Member
  own?: boolean
  connected: boolean
  connectionState?: RTCPeerConnectionState
  presence?: Presence
  cameraEnabled?: boolean
  micEnabled?: boolean
  screenSharing?: boolean
  getLocalVideoStream?: () => MediaStream | null
  localVideoRevision?: number
  remoteStream?: MediaStream
  remoteScreenStream?: MediaStream
  nativeScreenShare?: boolean
  prioritized?: boolean
  compact?: boolean
  onPrioritize?: () => void
  deafened?: boolean
  playbackRevision?: number
}) {
  const tileRef = React.useRef<HTMLDivElement | null>(null)
  const ownVideoRef = React.useRef<HTMLVideoElement | null>(null)
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
  const remoteVideoHealthRef = React.useRef({
    lastCurrentTime: -1,
    stagnantChecks: 0,
    lastRecoveryAt: 0,
  })
  const micOn = own ? Boolean(micEnabled) : presence?.micEnabled ?? false
  const camOn = own
    ? Boolean(cameraEnabled || (screenSharing && !nativeScreenShare))
    : Boolean(presence?.cameraEnabled || presence?.screenSharing)
  const presentingScreen = own ? Boolean(screenSharing) : Boolean(presence?.screenSharing)
  const remoteVideoSource = !own && presence?.screenSharing && remoteScreenStream ? remoteScreenStream : remoteStream
  const remoteVideoTracks = remoteVideoSource?.getVideoTracks() ?? []
  // O estado "muted" da track remota pode ficar defasado em alguns Chrome/driver
  // depois de um toggle local. A decisão visual usa Presence + frame real do <video>;
  // aqui basta existir uma track de vídeo viva.
  const remoteHasVideo = remoteVideoTracks.some((track) => track.readyState === "live")
  const showVideo = own
    ? camOn
    : Boolean(connected && camOn && remoteHasVideo && videoPlaying && videoFrameReady)

  const attachOwnVideo = React.useCallback((element: HTMLVideoElement | null) => {
    ownVideoRef.current = element
    if (!element || !own) return

    const stream = getLocalVideoStream?.() ?? null
    if (element.srcObject !== stream) element.srcObject = stream
    element.muted = true

    if (!stream) return
    const replay = () => {
      if (!element.isConnected || element.srcObject !== stream) return
      void element.play().catch(() => undefined)
    }
    replay()
    window.requestAnimationFrame(replay)
    window.setTimeout(replay, 80)
  }, [getLocalVideoStream, localVideoRevision, own])

  React.useLayoutEffect(() => {
    if (!own || !camOn) return
    const element = ownVideoRef.current
    if (!element) return

    const stream = getLocalVideoStream?.() ?? null
    if (element.srcObject !== stream) element.srcObject = stream
    element.muted = true
    if (!stream) return

    const replay = () => {
      if (!element.isConnected || element.srcObject !== stream) return
      void element.play().catch(() => undefined)
    }
    const videoTrack = stream.getVideoTracks().find((track) => track.readyState === "live")
    videoTrack?.addEventListener("unmute", replay)
    videoTrack?.addEventListener("mute", replay)
    replay()
    const frame = window.requestAnimationFrame(replay)
    const retry = window.setTimeout(replay, 120)

    return () => {
      videoTrack?.removeEventListener("unmute", replay)
      videoTrack?.removeEventListener("mute", replay)
      window.cancelAnimationFrame(frame)
      window.clearTimeout(retry)
    }
  }, [camOn, getLocalVideoStream, localVideoRevision, own, screenSharing])

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
      console.warn("TaskBoard: Web Audio não conseguiu reproduzir a track remota", error)
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
      try {
        await video.play()
        // Em alguns Chromes onPlaying não é reenviado após uma pausa transitória do
        // decoder. A Promise resolvida de play() também é uma confirmação válida.
        setVideoPlaying(true)
      } catch {
        // O watchdog abaixo tenta recuperar somente o elemento <video>, sem tocar
        // em RTCPeerConnection, ICE, sender/receiver ou nas tracks recebidas.
      }
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
    remoteVideoHealthRef.current = { lastCurrentTime: -1, stagnantChecks: 0, lastRecoveryAt: 0 }
  }, [remoteVideoSource])

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

  const recoverRemoteVideoElement = React.useCallback((reason: string) => {
    if (own || !remoteVideoSource) return
    const video = remoteVideoRef.current
    if (!video) return

    const now = Date.now()
    const health = remoteVideoHealthRef.current
    // Evita loops de rebind caso o navegador esteja realmente sem frames da origem.
    if (now - health.lastRecoveryAt < 1200) return
    health.lastRecoveryAt = now
    health.stagnantChecks = 0
    health.lastCurrentTime = -1

    const source = remoteVideoSource
    setVideoPlaying(false)
    setVideoFrameReady(false)

    // Recuperação exclusivamente do renderer HTML. O MediaStream/track continua o
    // mesmo, portanto não existe renegociação, restart de ICE ou replaceTrack.
    try { video.pause() } catch {}
    if (video.srcObject === source) video.srcObject = null

    const reattach = () => {
      const current = remoteVideoRef.current
      if (!current || !current.isConnected) return
      current.srcObject = source
      current.muted = true
      void current.play().then(() => {
        setVideoPlaying(true)
      }).catch(() => undefined)
    }

    window.requestAnimationFrame(reattach)
    window.setTimeout(reattach, 120)
    window.setTimeout(() => {
      const current = remoteVideoRef.current
      if (!current || current.srcObject !== source) return
      if (current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && current.videoWidth > 0 && current.videoHeight > 0) {
        setVideoPlaying(true)
        setVideoFrameReady(true)
      }
    }, 420)

    console.debug("TaskBoard: renderer de vídeo remoto recuperado", { reason, memberId: member.id })
  }, [member.id, own, remoteVideoSource])

  // Alterar microfone/câmera local não deve reconstruir peers nem tocar em ICE.
  // Se o Chrome derrubar o renderer de vídeos remotos nesse instante, reanexamos
  // apenas o srcObject dos elementos <video> existentes.
  React.useEffect(() => {
    if (own || !playbackRevision || !camOn || !remoteVideoSource) return
    const frame = window.requestAnimationFrame(() => {
      const video = remoteVideoRef.current
      if (!video) return
      void playRemote()
      window.setTimeout(() => {
        const current = remoteVideoRef.current
        if (!current) return
        const hasFrame = current.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && current.videoWidth > 0 && current.videoHeight > 0 && !current.paused
        if (!hasFrame) recoverRemoteVideoElement("local-media-toggle")
      }, 260)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [camOn, own, playbackRevision, playRemote, recoverRemoteVideoElement, remoteVideoSource])

  // Watchdog visual: áudio pode continuar normal enquanto somente o decoder/render
  // de vídeo do Chrome fica preso. Detectamos o <video> sem avançar e recuperamos
  // SOMENTE o elemento DOM. Nenhuma estrutura WebRTC é alterada.
  React.useEffect(() => {
    if (own || !connected || !camOn || !remoteVideoSource) return
    const interval = window.setInterval(() => {
      const video = remoteVideoRef.current
      if (!video) return
      const track = remoteVideoSource.getVideoTracks().find((item) => item.readyState === "live")
      if (!track) return

      const health = remoteVideoHealthRef.current
      const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0
      const hasDimensions = video.videoWidth > 0 && video.videoHeight > 0
      const advanced = health.lastCurrentTime < 0 || currentTime > health.lastCurrentTime + 0.025
      const healthy = !video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && hasDimensions && advanced

      if (healthy) {
        health.stagnantChecks = 0
        health.lastCurrentTime = currentTime
        if (!videoPlaying) setVideoPlaying(true)
        if (!videoFrameReady) setVideoFrameReady(true)
        return
      }

      health.lastCurrentTime = currentTime
      health.stagnantChecks += 1
      if (health.stagnantChecks >= 2) recoverRemoteVideoElement("stalled-renderer")
    }, 1200)

    return () => window.clearInterval(interval)
  }, [camOn, connected, own, recoverRemoteVideoElement, remoteVideoSource, videoFrameReady, videoPlaying])

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
        setVideoPlaying(true)
        setVideoFrameReady(true)
        return
      }
      timeoutId = window.setTimeout(confirmFrame, 120)
    }

    setVideoFrameReady(false)
    // O polling roda SEMPRE como fallback. Chrome implementa requestVideoFrameCallback,
    // mas há combinações de driver/GPU em que o callback deixa de ser entregue após
    // toggle local de mic/câmera, mesmo com o vídeo remoto ainda reproduzindo.
    timeoutId = window.setTimeout(confirmFrame, 120)
    if (typeof element.requestVideoFrameCallback === "function") {
      frameId = element.requestVideoFrameCallback(() => {
        if (cancelled) return
        frameId = element.requestVideoFrameCallback(() => {
          if (!cancelled && element.videoWidth > 0 && element.videoHeight > 0) setVideoFrameReady(true)
        })
      })
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
      console.warn("TaskBoard: não foi possível alternar tela cheia", error)
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
            ref={attachOwnVideo}
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
  finishRequested = false,
  onFinishRequestHandled,
}: {
  meeting: ChatMeeting | null
  open: boolean
  minimized?: boolean
  onMinimize?: () => void
  onRestore?: () => void
  onOpenChange: (open: boolean) => void
  finishRequested?: boolean
  onFinishRequestHandled?: () => void
}) {
  const { members, currentUserId, currentUserRole, endMeeting, leaveMeeting, heartbeatMeeting, inviteMeetingUser, refreshAll, projects, serviceRequests, aqsReviews } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const [micEnabled, setMicEnabled] = React.useState(true)
  const [cameraEnabled, setCameraEnabled] = React.useState(meeting?.mode === "video")
  const [remotePlaybackRevision, setRemotePlaybackRevision] = React.useState(0)
  const [screenSharing, setScreenSharing] = React.useState(false)
  const [nativeScreenSharing, setNativeScreenSharing] = React.useState(false)
  const [deafened, setDeafened] = React.useState(false)
  const [panel, setPanel] = React.useState<PanelMode>(null)
  const [presentationMode, setPresentationMode] = React.useState(false)
  const [meetingWallContext, setMeetingWallContext] = React.useState<MeetingWallContext | null>(null)
  const [meetingWallLoading, setMeetingWallLoading] = React.useState(false)
  const [meetingWallError, setMeetingWallError] = React.useState("")
  const [participantsExpanded, setParticipantsExpanded] = React.useState(false)
  const [muralParticipantView, setMuralParticipantView] = React.useState<"tiles" | "list">("tiles")
  const [memberPickerOpen, setMemberPickerOpen] = React.useState(false)
  const [memberQuery, setMemberQuery] = React.useState("")
  const [invitingUserId, setInvitingUserId] = React.useState<string | null>(null)
  const [removingUserId, setRemovingUserId] = React.useState<string | null>(null)
  const [canManageMeetingMembers, setCanManageMeetingMembers] = React.useState(false)
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
  const [localVideoRevision, setLocalVideoRevision] = React.useState(0)
  const channelRef = React.useRef<RealtimeChannel | null>(null)
  const realtimeSubscribedRef = React.useRef(false)
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
  const processedSignalKeysRef = React.useRef<Set<string>>(new Set())
  const lastPersistedSignalIdRef = React.useRef(0)
  const signalFallbackStateRef = React.useRef<"unknown" | "available" | "unavailable">("unknown")
  const peerHealthRef = React.useRef<Map<string, { inboundBytes: number; outboundBytes: number; stalledChecks: number }>>(new Map())
  const lastIceRestartRef = React.useRef<Map<string, number>>(new Map())
  const peerConnectedOnceRef = React.useRef<Set<string>>(new Set())
  const presencePublishTimerRef = React.useRef<number | null>(null)
  const iceServersRef = React.useRef<RTCIceServer[]>([])
  const iceFallbackServersRef = React.useRef<RTCIceServer[]>([])
  const iceHasTurnRef = React.useRef(false)
  const offerRequestSentRef = React.useRef<Set<string>>(new Set())
  const iceErrorKeysRef = React.useRef<Set<string>>(new Set())
  const relayCandidateSeenRef = React.useRef<Set<string>>(new Set())
  const remoteRelayCandidateSeenRef = React.useRef<Set<string>>(new Set())
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
  const isMeetingOwner = Boolean(meeting && meeting.createdBy === currentUserId)
  const canEndMeeting = Boolean(
    meeting && (currentUserRole === "admin" || isMeetingOwner),
  )
  const meetingContextInfo = React.useMemo(() => {
    const project = findMeetingProject(projects, meetingWallContext)
    const activity = project?.activities.find((item) =>
      item.id === meetingWallContext?.activityId ||
      item.subactivities.some((subactivity) => subactivity.id === meetingWallContext?.subactivityId),
    ) ?? null
    const subactivity = meetingWallContext?.subactivityId
      ? activity?.subactivities.find((item) => item.id === meetingWallContext.subactivityId) ?? null
      : null
    const request = meetingWallContext?.requestId
      ? serviceRequests.find((item) => item.id === meetingWallContext.requestId) ?? null
      : null
    const primaryTitle = activity?.title?.trim() || meeting?.title?.trim() || "Reunião"
    const secondaryTitle = subactivity?.title?.trim() || request?.title?.trim() || ""
    const displayTitle = secondaryTitle && secondaryTitle.toLocaleLowerCase("pt-BR") !== primaryTitle.toLocaleLowerCase("pt-BR")
      ? `${primaryTitle} · ${secondaryTitle}`
      : primaryTitle
    return { project, activity, subactivity, request, displayTitle }
  }, [meeting?.title, meetingWallContext, projects, serviceRequests])
  React.useLayoutEffect(() => {
    if (!open || !meeting || minimized || typeof document === "undefined") return

    const body = document.body
    const html = document.documentElement
    const scrollX = window.scrollX
    const scrollY = window.scrollY
    const previousBody = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      overscrollBehavior: body.style.overscrollBehavior,
    }
    const previousHtml = {
      overflow: html.style.overflow,
      overscrollBehavior: html.style.overscrollBehavior,
    }

    // A reunião expandida é uma superfície modal. Fixar o documento impede que swipe/scroll
    // nas bordas do painel seja encadeado para a tela que está por trás no Chrome mobile.
    body.style.position = "fixed"
    body.style.top = `-${scrollY}px`
    body.style.left = `-${scrollX}px`
    body.style.right = "0"
    body.style.width = "100%"
    body.style.overflow = "hidden"
    body.style.overscrollBehavior = "none"
    html.style.overflow = "hidden"
    html.style.overscrollBehavior = "none"

    return () => {
      body.style.position = previousBody.position
      body.style.top = previousBody.top
      body.style.left = previousBody.left
      body.style.right = previousBody.right
      body.style.width = previousBody.width
      body.style.overflow = previousBody.overflow
      body.style.overscrollBehavior = previousBody.overscrollBehavior
      html.style.overflow = previousHtml.overflow
      html.style.overscrollBehavior = previousHtml.overscrollBehavior
      window.requestAnimationFrame(() => window.scrollTo(scrollX, scrollY))
    }
  }, [meeting?.id, minimized, open])

  React.useEffect(() => {
    if (!open || !meeting) {
      setCanManageMeetingMembers(false)
      return
    }
    if (currentUserRole === "admin" || meeting.createdBy === currentUserId) {
      setCanManageMeetingMembers(true)
      return
    }
    let cancelled = false
    void supabase.rpc("can_manage_meeting_members", { p_meeting_id: meeting.id }).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        console.warn("TaskBoard: não foi possível validar a moderação da reunião", error)
        setCanManageMeetingMembers(false)
        return
      }
      setCanManageMeetingMembers(data === true)
    })
    return () => { cancelled = true }
  }, [currentUserId, currentUserRole, meeting?.createdBy, meeting?.id, open, supabase])


  React.useEffect(() => {
    setPresentationMode(false)
    setPanel(null)
    setMuralParticipantView("tiles")
    setMeetingWallContext(null)
    setMeetingWallError("")
  }, [meeting?.id])

  React.useEffect(() => {
    if (!open || !meeting || currentMeetingState?.status !== "joined") {
      setMeetingWallContext(null)
      setMeetingWallLoading(false)
      setMeetingWallError("")
      return
    }
    let cancelled = false
    setMeetingWallLoading(true)
    setMeetingWallError("")
    void supabase.rpc("claim_meeting_recording", { p_meeting_id: meeting.id }).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        setMeetingWallContext(null)
        setMeetingWallError(toUserFacingError(error, "Não foi possível carregar o mural desta reunião"))
        setMeetingWallLoading(false)
        return
      }
      const payload = (data ?? null) as MeetingRecordingContext | null
      setMeetingWallContext(payload ? {
        hasContext: payload.hasContext,
        projectId: payload.projectId,
        activityId: payload.activityId,
        subactivityId: payload.subactivityId,
        requestId: payload.requestId,
        aqsReviewId: payload.aqsReviewId,
      } : null)
      setMeetingWallLoading(false)
    })
    return () => { cancelled = true }
  }, [currentMeetingState?.status, meeting?.id, open, supabase])

  const hasWallContext = Boolean(meetingWallContext?.hasContext && (meetingWallContext?.requestId || meetingWallContext?.aqsReviewId || meetingWallContext?.subactivityId || meetingWallContext?.activityId))

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

  const sendMeetingBroadcast = React.useCallback(async (event: string, payload: unknown) => {
    const channel = channelRef.current
    // A sinalização da reunião só sai quando o canal está realmente SUBSCRIBED.
    // Isso restaura o comportamento estável da V110 e evita o fallback automático
    // para REST que altera timing/ordem de offer/answer/ICE.
    if (!channel || !realtimeSubscribedRef.current) return false

    try {
      const result = await channel.send({
        type: "broadcast",
        event,
        payload,
      })
      return result === "ok"
    } catch (error) {
      console.warn("TaskBoard: falha ao enviar Broadcast WebSocket da reunião", { event, error })
      return false
    }
  }, [])


  const togglePresentationMode = React.useCallback(() => {
    setPresentationMode((current) => {
      const next = !current
      // Visualização local: cada participante abre/fecha o Mural sem alterar a tela dos demais.
      const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
      setPanel(next && desktop ? "participants" : null)
      return next
    })
  }, [])


  const publishPresence = React.useCallback(() => {
    if (!meeting || !channelRef.current || !realtimeSubscribedRef.current) return
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
    if (!meeting) return false
    const live = presenceStateRef.current
    return sendMeetingBroadcast("media-state", {
      meetingId: meeting.id,
      fromSession: sessionIdRef.current,
      fromUserId: live.userId,
      micEnabled: live.micEnabled,
      cameraEnabled: live.cameraEnabled,
      screenSharing: live.screenSharing,
      mediaRevision: live.mediaRevision,
      sentAt: new Date().toISOString(),
    } satisfies MediaStateSignal)
  }, [meeting?.id, sendMeetingBroadcast])

  const broadcastMediaStateBurst = React.useCallback(() => {
    void broadcastMediaState()
    // Broadcast é instantâneo e os eventos são idempotentes pela mediaRevision.
    // Pequenas repetições cobrem troca de rede/background no exato momento do clique.
    window.setTimeout(() => void broadcastMediaState(), 180)
    window.setTimeout(() => void broadcastMediaState(), 650)
  }, [broadcastMediaState])

  const broadcastRecordingState = React.useCallback(async (status: RecordingStateSignal["status"]) => {
    if (!meeting || meeting.createdBy !== currentUserId) return false
    return sendMeetingBroadcast("recording-state", {
      meetingId: meeting.id,
      recorderId: currentUserId,
      status,
      sentAt: new Date().toISOString(),
    } satisfies RecordingStateSignal)
  }, [currentUserId, meeting?.createdBy, meeting?.id, sendMeetingBroadcast])

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

  const postSignal = React.useCallback(async (signal: Omit<CallSignal, "meetingId" | "fromSession" | "fromUserId" | "signalKey">) => {
    if (!meeting) return false
    const sent = await sendMeetingBroadcast("webrtc-signal", {
      ...signal,
      meetingId: meeting.id,
      fromSession: sessionIdRef.current,
      fromUserId: currentUserId,
    } satisfies CallSignal)
    if (!sent) {
      setMediaError("A sinalização da reunião não pôde ser entregue. Tentando reconectar...")
    }
    return sent
  }, [currentUserId, meeting?.id, sendMeetingBroadcast])

  const postNativeScreenSignal = React.useCallback(async (signal: NativeScreenSignal) => {
    if (!meeting) return false
    return sendMeetingBroadcast("native-screen-signal", signal)
  }, [meeting?.id, sendMeetingBroadcast])

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
          console.warn("TaskBoard: não foi possível receber a tela nativa Android", error)
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
        console.warn("TaskBoard: não foi possível substituir a track de áudio", remoteSession, error)
        setMediaError("O navegador não conseguiu sincronizar o microfone com um participante.")
      })
      void senders.video.replaceTrack(videoTrack).catch((error) => {
        console.warn("TaskBoard: não foi possível substituir a track de vídeo", remoteSession, error)
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
        console.warn("TaskBoard: fila de sinalização WebRTC falhou", sessionId, error)
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
    peerConnectedOnceRef.current.delete(sessionId)
    relayCandidateSeenRef.current.delete(sessionId)
    for (const key of Array.from(iceErrorKeysRef.current)) {
      if (key.startsWith(`${sessionId}|`)) iceErrorKeysRef.current.delete(key)
    }
    relayCandidateSeenRef.current.delete(sessionId)
    remoteRelayCandidateSeenRef.current.delete(sessionId)
    const peer = peersRef.current.get(sessionId)
    if (peer) peer.close()
    peersRef.current.delete(sessionId)
    peerSendersRef.current.delete(sessionId)
    peerRoleRef.current.delete(sessionId)
    offerRequestSentRef.current.delete(sessionId)
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
    peerConnectedOnceRef.current.clear()
    iceErrorKeysRef.current.clear()
    relayCandidateSeenRef.current.clear()
    remoteRelayCandidateSeenRef.current.clear()
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
        console.warn("TaskBoard: ICE candidate rejeitado após remoteDescription", error)
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
      // UUIDs usam somente ASCII; a comparação simples cria exatamente um
      // offerer por par, sem depender do locale do dispositivo.
      offerer: sessionIdRef.current < remoteSession,
      initialOfferSent: false,
      offerInFlight: false,
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
      console.warn("TaskBoard: não foi possível vincular todas as tracks locais ao peer", remoteSession, results)
      setMediaError("Não foi possível sincronizar um dos dispositivos com a chamada. Tentando manter a conexão ativa.")
    }
    return true
  }, [])

  const sendOffer = React.useCallback(async (remoteSession: string, peer: RTCPeerConnection, iceRestart = false) => {
    const role = getPeerRole(remoteSession)
    if (!role.offerer || peer.connectionState === "closed" || peer.signalingState === "closed") return
    if (role.offerInFlight || peer.signalingState !== "stable") return

    role.offerInFlight = true
    try {
      await bindPeerSenders(remoteSession, peer)
      const offer = await peer.createOffer(iceRestart ? { iceRestart: true } : undefined)
      await peer.setLocalDescription(offer)
      if (!peer.localDescription) return
      console.log("TaskBoard: enviando offer WebRTC", {
        remoteSession,
        iceRestart,
        signalingState: peer.signalingState,
        iceGatheringState: peer.iceGatheringState,
      })
      const sent = await postSignal({ type: "offer", toSession: remoteSession, sdp: peer.localDescription })
      if (sent) role.initialOfferSent = true
    } catch (error) {
      console.warn("TaskBoard: falha ao criar oferta WebRTC", error)
      setMediaError("Não foi possível conectar o áudio e o vídeo com um participante. O TaskBoard tentará novamente.")
    } finally {
      role.offerInFlight = false
    }
  }, [bindPeerSenders, getPeerRole, postSignal])

  const requestIceRestart = React.useCallback((remoteSession: string, peer: RTCPeerConnection, force = false) => {
    if (peer.connectionState === "closed" || peer.signalingState === "closed") return

    // Não reinicia ICE durante o primeiro handshake. Antes da V111 a chamada
    // completava a negociação inicial sem watchdog/restart concorrente. Somente
    // um peer que já esteve conectado pode entrar na rotina automática de recovery.
    if (!peerConnectedOnceRef.current.has(remoteSession)) return
    if (peer.signalingState !== "stable" || !peer.localDescription || !peer.remoteDescription) return

    const transportFailed = peer.iceConnectionState === "failed" || peer.connectionState === "failed" || peer.connectionState === "disconnected"
    if (!force && !transportFailed) return

    const now = Date.now()
    const lastRestart = lastIceRestartRef.current.get(remoteSession) ?? 0
    if (now - lastRestart < 10_000) return
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

    // Base funcional pré-V111: um único offerer cria os m-lines sendrecv.
    if (role.offerer) {
      const audioTransceiver = peer.addTransceiver("audio", { direction: "sendrecv" })
      const videoTransceiver = peer.addTransceiver("video", { direction: "sendrecv" })
      peerSendersRef.current.set(remoteSession, {
        audio: audioTransceiver.sender,
        video: videoTransceiver.sender,
      })
      void bindPeerSenders(remoteSession, peer)
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
      setRemoteStreams((current) => ({ ...current, [remoteSession]: liveRemoteStream }))
      console.info("TaskBoard: track remota recebida", {
        remoteSession,
        kind: track.kind,
        readyState: track.readyState,
        muted: track.muted,
      })
    }

    peer.onicecandidate = (event) => {
      if (!event.candidate) return
      if (event.candidate.type === "relay" && !relayCandidateSeenRef.current.has(remoteSession)) {
        relayCandidateSeenRef.current.add(remoteSession)
        console.info("TaskBoard: candidato TURN relay disponível", {
          remoteSession,
          protocol: event.candidate.protocol,
          relayProtocol: (event.candidate as RTCIceCandidate & { relayProtocol?: string }).relayProtocol,
          url: event.url,
        })
      }
      void postSignal({
        type: "ice",
        toSession: remoteSession,
        candidate: event.candidate.toJSON(),
      })
    }

    peer.onicecandidateerror = (event) => {
      const detail = event as RTCPeerConnectionIceErrorEvent
      const code = Number(detail.errorCode ?? 0)
      const url = String(detail.url ?? "")
      // 701 em uma interface IPv6/TCP é uma tentativa individual; não derruba
      // a chamada se UDP/IPv4/relay conseguir formar um candidate pair.
      const logger = code === 701 ? console.debug : console.warn
      logger("TaskBoard: erro ICE", {
        remoteSession,
        errorCode: code,
        errorText: detail.errorText,
        url,
        address: detail.address,
        port: detail.port,
      })
    }

    peer.oniceconnectionstatechange = () => {
      console.info("TaskBoard: estado ICE", {
        remoteSession,
        iceConnectionState: peer.iceConnectionState,
        signalingState: peer.signalingState,
      })
      if (peer.iceConnectionState === "failed" && peerConnectedOnceRef.current.has(remoteSession)) {
        requestIceRestart(remoteSession, peer)
      }
    }

    peer.onconnectionstatechange = () => {
      const state = peer.connectionState
      setPeerStates((current) => ({ ...current, [remoteSession]: state }))
      console.info("TaskBoard: estado do peer", { remoteSession, state, ice: peer.iceConnectionState })
      if (state === "connected") {
        peerConnectedOnceRef.current.add(remoteSession)
        setMediaError((current) => current.includes("TURN") || current.includes("ICE") || current.includes("mídia") || current.includes("sinalização") ? "" : current)
        void inspectPeerRoute(remoteSession, peer)
        const timer = restartTimersRef.current.get(remoteSession)
        if (timer) window.clearTimeout(timer)
        restartTimersRef.current.delete(remoteSession)
      } else if (state === "disconnected" && peerConnectedOnceRef.current.has(remoteSession)) {
        const oldTimer = restartTimersRef.current.get(remoteSession)
        if (oldTimer) window.clearTimeout(oldTimer)
        const timer = window.setTimeout(() => {
          if (peer.connectionState === "disconnected" || peer.connectionState === "failed") {
            requestIceRestart(remoteSession, peer)
          }
        }, 8000)
        restartTimersRef.current.set(remoteSession, timer)
      } else if (state === "failed") {
        if (peerConnectedOnceRef.current.has(remoteSession)) {
          setMediaError("A conexão de áudio e vídeo foi interrompida. O TaskBoard está tentando restabelecer a reunião automaticamente.")
          requestIceRestart(remoteSession, peer)
        } else {
          // Não entra em loop durante o primeiro handshake. Os logs de ICE/SDP
          // permanecem disponíveis e o peer aguarda os candidatos já sinalizados.
          setMediaError("Não foi possível estabelecer a rota de mídia com este participante.")
        }
      } else if (state === "closed") {
        closePeer(remoteSession)
      }
    }

    if (role.offerer) {
      window.setTimeout(() => {
        if (!role.initialOfferSent && peer.connectionState !== "closed") void sendOffer(remoteSession, peer)
      }, 0)
    }

    void remoteUserId
    return peer
  }, [bindPeerSenders, closePeer, getPeerRole, inspectPeerRoute, postSignal, requestIceRestart, sendOffer])

  const getLocalVideoStream = React.useCallback(() => {
    const screenStream = screenStreamRef.current
    const liveScreenTrack = screenStream?.getVideoTracks().some((track) => track.readyState === "live")
    if (screenStream && liveScreenTrack) return screenStream
    return localStreamRef.current
  }, [])

  const updateLocalVideo = React.useCallback(() => {
    // O preview local não usa mais um único ref compartilhado entre a grade e o Mural.
    // Cada <video> local se conecta diretamente ao MediaStream no próprio mount; esta
    // revisão apenas força uma nova leitura quando câmera/tela/layout mudam.
    setLocalVideoRevision((current) => current + 1)
  }, [])

  React.useLayoutEffect(() => {
    if (!open || !meeting || minimized) return

    // Normal -> Mural (e o caminho inverso) desmonta um <video> local e monta outro
    // em uma região diferente da UI. O MediaStream permanece o mesmo e continua
    // sendo enviado aos peers; reanexamos somente o preview local ao novo elemento.
    const frame = window.requestAnimationFrame(() => updateLocalVideo())
    const retry = window.setTimeout(() => updateLocalVideo(), 120)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(retry)
    }
  }, [cameraEnabled, meeting?.id, minimized, muralParticipantView, open, presentationMode, screenSharing, updateLocalVideo])

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

  React.useEffect(() => {
    const mediaDevices = navigator.mediaDevices
    if (!mediaDevices?.addEventListener) return
    const handleDeviceChange = () => { void refreshDevices() }
    mediaDevices.addEventListener("devicechange", handleDeviceChange)
    return () => mediaDevices.removeEventListener("devicechange", handleDeviceChange)
  }, [refreshDevices])

  const stopAllMedia = React.useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop())
    screenStreamRef.current?.getTracks().forEach((track) => track.stop())
    localStreamRef.current = null
    screenStreamRef.current = null
  }, [])

  // V149: a moderação da V92 não pode participar da identidade do efeito WebRTC.
  // MeetingSessionHost pode renderizar novamente enquanto chatMeetings é atualizado e,
  // historicamente, onOpenChange era passado inline. Se o handler abaixo dependesse
  // diretamente daquela função, o useEffect da sala seria desmontado e fecharia todos
  // os PeerConnections mesmo sem o usuário sair da reunião.
  const onOpenChangeRef = React.useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange

  const handleMemberRemovedRef = React.useRef<(({ payload }: { payload: unknown }) => void) | null>(null)
  handleMemberRemovedRef.current = ({ payload }: { payload: unknown }) => {
    const signal = payload as MeetingMemberRemovedSignal
    if (!meeting || signal?.meetingId !== meeting.id || signal.userId !== currentUserId) return
    // Se este dispositivo era o gravador, inicia a publicação antes de fechar a sala.
    // O upload continua mesmo após o componente da chamada sair da tela.
    if (meetingRecorderRef.current) void finalizeRecordingRef.current?.()
    stopAllMedia()
    onOpenChangeRef.current(false)
  }

  const handleMeetingEndedRef = React.useRef<(({ payload }: { payload: unknown }) => void) | null>(null)
  handleMeetingEndedRef.current = ({ payload }: { payload: unknown }) => {
    const signal = payload as MeetingEndedSignal
    if (!meeting || signal?.meetingId !== meeting.id) return
    stopAllMedia()
    onOpenChangeRef.current(false)
  }

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

    // V111: somente o criador/owner da reunião grava e publica o vídeo final.
    // Participantes continuam recebendo o estado por Broadcast, mas não criam
    // MediaRecorder local nem tentam assumir a gravação em caso de atraso do owner.
    if (meeting.createdBy !== currentUserId) {
      recordingContextRef.current = null
      setRecordingState("waiting")
      setRecordingMessage("A gravação desta reunião é responsabilidade do criador da sala.")
      void supabase.rpc("meeting_recording_status", { p_meeting_id: meeting.id }).then(({ data }) => {
        if (disposed) return
        const status = data as { status?: string; recorderId?: string | null } | null
        if (status?.status === "published") {
          setRecordingState("published")
          setRemoteRecordingActive(false)
        } else {
          setRemoteRecordingActive(status?.status === "recording" || status?.status === "finalizing")
        }
      })
      return () => { disposed = true }
    }

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
          // Com a regra owner-only isto só deve acontecer durante uma transição
          // curta de banco/estado. Reconsulta sem permitir takeover por terceiros.
          setRecordingState("waiting")
          setRemoteRecordingActive(context.status === "recording" || context.status === "finalizing")
          recordingClaimTimerRef.current = window.setTimeout(() => void attemptClaim(), 4_000)
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
        setRecordingMessage(previousSegments > 0 ? "Gravação retomada pelo criador da reunião." : "Gravação automática pelo criador em andamento.")
        setRemoteRecordingActive(false)
        void broadcastRecordingState("recording")

        if (recordingHeartbeatRef.current !== null) window.clearInterval(recordingHeartbeatRef.current)
        recordingHeartbeatRef.current = window.setInterval(() => {
          void supabase.rpc("meeting_recording_heartbeat", { p_meeting_id: meeting.id })
          void broadcastRecordingState("recording")
        }, 15_000)
      } catch (error) {
        if (disposed) return
        console.warn("TaskBoard: gravação automática indisponível", error)
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
  }, [broadcastRecordingState, currentMeetingState?.status, currentUserId, mediaReadyMeetingId, meeting?.createdBy, meeting?.id, open, supabase])

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
      if (recorder && recordingContextRef.current?.hasContext) {
        void finalizeRecordingRef.current?.()
      } else if (recorder) {
        void recorder.stop()
      }
      meetingRecorderRef.current = null
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
    let realtimeFailureCount = 0
    let realtimeWarningTimer: number | null = null
    const realtimeReconnectMessage = "A sala em tempo real está reconectando. A mídia atual será preservada enquanto possível."
    const clearRealtimeWarningTimer = () => {
      if (realtimeWarningTimer !== null) {
        window.clearTimeout(realtimeWarningTimer)
        realtimeWarningTimer = null
      }
    }
    const lifecycleId = `${meeting.id}:${sessionIdRef.current}`
    console.info("TaskBoard: sessão WebRTC iniciada", { meetingId: meeting.id, sessionId: sessionIdRef.current })

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
      if (state.meetingId !== meeting.id || state.recorderId !== meeting.createdBy || state.recorderId === currentUserId) return
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
            // Base pré-V111: somente o answerer aceita a offer determinística.
            if (role.offerer) return
            console.info("TaskBoard: offer WebRTC recebida", { remoteSession: signal.fromSession })
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
            console.info("TaskBoard: answer WebRTC recebida", { remoteSession: signal.fromSession })
            await peer.setRemoteDescription(signal.sdp)
            await bindPeerSenders(signal.fromSession, peer)
            syncRemoteReceiverTracks(signal.fromSession, peer)
            await flushPendingIce(signal.fromSession, peer)
            return
          }

          if (signal.type === "ice" && signal.candidate) {
            const candidateText = String(signal.candidate.candidate ?? "")
            if (/\styp\s+relay\b/i.test(candidateText) && !remoteRelayCandidateSeenRef.current.has(signal.fromSession)) {
              remoteRelayCandidateSeenRef.current.add(signal.fromSession)
              console.info("TaskBoard: candidato TURN relay remoto recebido", { remoteSession: signal.fromSession })
            }
            if (!peer.remoteDescription) {
              const queue = pendingIceRef.current.get(signal.fromSession) ?? []
              queue.push(signal.candidate)
              pendingIceRef.current.set(signal.fromSession, queue)
              return
            }
            try {
              await peer.addIceCandidate(signal.candidate)
            } catch (error) {
              console.warn("TaskBoard: ICE candidate rejeitado", { remoteSession: signal.fromSession, error })
            }
            return
          }

          if (signal.type === "restart-request") {
            if (role.offerer && peerConnectedOnceRef.current.has(signal.fromSession)) {
              void sendOffer(signal.fromSession, peer, true)
            }
          }
        } catch (error) {
          console.warn("TaskBoard: falha ao processar sinal WebRTC", signal.type, error)
          if (peer.connectionState !== "connected") {
            setMediaError("A conexão de áudio e vídeo encontrou um problema durante a negociação.")
          }
        }
      })
    }



    // V148: a sinalização persistente da migration 090 fica desativada.
    // A reunião volta a usar um único transporte ordenado: Broadcast WebSocket.


    void (async () => {
      try {
        const iceConfig = await loadWebRtcIceConfig(supabase)
        if (disposed) return
        iceServersRef.current = iceConfig.iceServers
        iceFallbackServersRef.current = iceConfig.fallbackIceServers
        // A ponte nativa não sofre do mesmo bug/ruído de TCP/IPv6 do Chromium;
        // mantém a lista completa para ter UDP/TCP/TLS disponíveis.
        configureAndroidScreenShare(iceConfig.fallbackIceServers)
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
        realtimeSubscribedRef.current = false

        channel
          .on("presence", { event: "sync" }, syncPresence)
          .on("broadcast", { event: "webrtc-signal" }, ({ payload }) => handleSignal(payload as CallSignal))
          .on("broadcast", { event: "native-screen-signal" }, ({ payload }) => handleNativeScreenSignal(payload as NativeScreenSignal))
          .on("broadcast", { event: "media-state" }, ({ payload }) => handleMediaState(payload as MediaStateSignal))
          .on("broadcast", { event: "recording-state" }, ({ payload }) => handleRecordingState(payload as RecordingStateSignal))
          .on("broadcast", { event: "recording-stop-request" }, handleRecordingStopRequest)
          .on("broadcast", { event: "member-removed" }, (message) => handleMemberRemovedRef.current?.(message))
          .on("broadcast", { event: "meeting-ended" }, (message) => handleMeetingEndedRef.current?.(message))
          .subscribe((status, error) => {
            if (disposed) return
            if (status === "SUBSCRIBED") {
              realtimeFailureCount = 0
              clearRealtimeWarningTimer()
              realtimeSubscribedRef.current = true
              setMediaError((current) =>
                current.startsWith("Falha na sala") || current === realtimeReconnectMessage ? "" : current,
              )
              publishPresence()
              window.setTimeout(() => broadcastMediaStateBurst(), 120)
              if (meetingRecorderRef.current) window.setTimeout(() => void broadcastRecordingState("recording"), 180)
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
              realtimeSubscribedRef.current = false
              realtimeFailureCount += 1
              console.warn("TaskBoard: Realtime channel", status, error, { realtimeFailureCount })

              // O próprio Supabase Realtime tenta reentrar no canal. Mantemos as três
              // primeiras falhas silenciosas para evitar falsos alertas em redes móveis.
              if (realtimeFailureCount > 3 && realtimeWarningTimer === null) {
                realtimeWarningTimer = window.setTimeout(() => {
                  realtimeWarningTimer = null
                  if (!disposed && !realtimeSubscribedRef.current) setMediaError(realtimeReconnectMessage)
                }, 1000)
              }
            }
          })
      } catch (error) {
        console.error("TaskBoard: não foi possível preparar a sala WebRTC", error)
        if (!disposed) setMediaError("Não foi possível preparar a conexão em tempo real da chamada.")
      }
    })()

    return () => {
      console.info("TaskBoard: sessão WebRTC finalizada", { lifecycleId })
      disposed = true
      clearRealtimeWarningTimer()
      realtimeSubscribedRef.current = false
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
      // Não reenumera dispositivos ao apenas mutar/desmutar. Em alguns Chrome/drivers,
      // enumerateDevices() durante uma chamada pode coincidir com uma pausa transitória
      // dos decoders de vídeo remotos. Mantemos a lista por devicechange/setup e apenas
      // reaplicamos play() nos vídeos já existentes, sem recriar peer/track/ICE.
      setRemotePlaybackRevision((value) => value + 1)
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
      // Mesmo princípio do microfone: toggle de estado não precisa atualizar inventário
      // de hardware nem renegociar mídia. O refresh abaixo é somente de reprodução DOM.
      setRemotePlaybackRevision((value) => value + 1)
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
      configureAndroidScreenShare(iceFallbackServersRef.current.length ? iceFallbackServersRef.current : iceServersRef.current)
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
      console.warn("TaskBoard: falha ao iniciar compartilhamento de tela", error)
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
            requestIceRestart(sessionId, peer, forceIceRestart)
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
            requestIceRestart(sessionId, peer, true)
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

  const publishMeetingChatTranscript = React.useCallback(async (options?: {
    context?: MeetingRecordingContext | null
    endedAt?: string
    background?: boolean
  }) => {
    if (!meeting) return true
    if (meeting.createdBy !== currentUserId) return false

    try {
      const { data: existing, error: existingError } = await supabase.rpc("meeting_transcript_status", { p_meeting_id: meeting.id })
      if (!existingError && Boolean((existing as { published?: boolean } | null)?.published)) return true

      let context = options?.context ?? recordingContextRef.current
      if (!context?.hasContext) {
        // V214: depois que a reunião é encerrada visualmente, claim_meeting_recording
        // não pode mais ser usado porque a sala já possui ended_at. Esta RPC é apenas
        // leitura do contexto canônico e continua válida após o encerramento.
        const { data, error } = await supabase.rpc("meeting_artifact_context", { p_meeting_id: meeting.id })
        if (error) throw error
        const payload = (data ?? null) as MeetingRecordingContext | null
        context = payload ? {
          ...payload,
          canRecord: meeting.createdBy === currentUserId,
          status: payload.status ?? "finalizing",
        } : null
        if (!options?.background) recordingContextRef.current = context
      }

      // Reuniões comuns do Chat não possuem tópico/subatividade de origem. Nelas não
      // existe destino para o PDF e o encerramento segue sem artefato contextual.
      if (!context?.hasContext) return true
      if (!context.workspaceId || !context.projectId) throw new Error("O tópico de origem da reunião não pôde ser identificado para salvar o chat.")

      if (!options?.background) {
        setRecordingState("finalizing")
        setRecordingMessage("Gerando o PDF com o chat completo da reunião…")
      }
      const endedAt = options?.endedAt ?? new Date().toISOString()
      const rows: Array<Record<string, any>> = []

      if (meeting.conversationId) {
        const pageSize = 500
        let from = 0
        while (true) {
          const { data, error } = await supabase
            .from("chat_messages")
            .select("id,sender_id,content,message_type,media_name,media_mime_type,reply_to_message_id,created_at,edited_at")
            .eq("conversation_id", meeting.conversationId)
            .gte("created_at", meeting.createdAt)
            .lte("created_at", endedAt)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, from + pageSize - 1)
          if (error) throw error
          const page = (data ?? []) as Array<Record<string, any>>
          rows.push(...page)
          if (page.length < pageSize) break
          from += pageSize
        }
      }

      const hasTranscriptContent = rows.some((row) => {
        const content = typeof row.content === "string" ? row.content.trim() : ""
        const mediaName = typeof row.media_name === "string" ? row.media_name.trim() : ""
        const messageType = typeof row.message_type === "string" ? row.message_type : ""
        return Boolean(content || mediaName || messageType === "audio" || messageType === "media")
      })

      // V225: não publica um PDF vazio somente para registrar que a reunião não teve chat.
      // O artefato só existe quando houve conteúdo real: texto, áudio ou anexo.
      if (!hasTranscriptContent) {
        if (!options?.background) {
          setRecordingState("published")
          setRecordingMessage("Reunião sem conteúdo no chat; nenhum PDF foi gerado.")
        }
        return true
      }

      const memberNames = new Map<string, string>(members.map((member: Member) => [member.id, member.name]))
      const reactionLabels: Record<string, string> = {
        "👍": "Curtir",
        "❤️": "Coração",
        "😂": "Risos",
        "🎉": "Comemoração",
        "👀": "Olhos",
        "✅": "Confirmado",
      }
      const reactionsByMessage = new Map<string, string[]>()
      const messageIds = rows.map((row) => String(row.id)).filter(Boolean)
      for (let index = 0; index < messageIds.length; index += 200) {
        const batch = messageIds.slice(index, index + 200)
        const { data, error } = await supabase
          .from("chat_message_reactions")
          .select("message_id,user_id,emoji")
          .in("message_id", batch)
        if (error) throw error
        for (const reaction of data ?? []) {
          const messageId = String(reaction.message_id)
          const label = reactionLabels[String(reaction.emoji)] ?? String(reaction.emoji || "Reação")
          const author = memberNames.get(String(reaction.user_id)) ?? "Usuário"
          const current = reactionsByMessage.get(messageId) ?? []
          current.push(`${label} - ${author}`)
          reactionsByMessage.set(messageId, current)
        }
      }

      const rowsById = new Map(rows.map((row) => [String(row.id), row]))
      const messages: MeetingTranscriptMessage[] = rows.map((row) => {
        const replyId = row.reply_to_message_id ? String(row.reply_to_message_id) : ""
        const reply = replyId ? rowsById.get(replyId) : null
        const replyAuthor = reply?.sender_id ? memberNames.get(String(reply.sender_id)) : null
        const replyText = String(reply?.content ?? reply?.media_name ?? "").trim()
        const replyToLabel = reply
          ? `${replyAuthor ?? "Usuário"}${replyText ? `: ${replyText.slice(0, 90)}` : ""}`
          : replyId ? "mensagem anterior" : undefined
        const messageType: MeetingTranscriptMessage["messageType"] = row.message_type === "audio" || row.message_type === "media" ? row.message_type : "text"
        return {
          id: String(row.id),
          senderName: memberNames.get(String(row.sender_id)) ?? "Usuário",
          createdAt: String(row.created_at),
          content: typeof row.content === "string" ? row.content : "",
          messageType,
          mediaName: typeof row.media_name === "string" ? row.media_name : undefined,
          mediaMimeType: typeof row.media_mime_type === "string" ? row.media_mime_type : undefined,
          editedAt: typeof row.edited_at === "string" ? row.edited_at : undefined,
          replyToLabel,
          reactions: reactionsByMessage.get(String(row.id))?.join(" · "),
        }
      })

      const pdf = createMeetingTranscriptPdf({
        meetingTitle: meetingContextInfo.displayTitle,
        startedAt: meeting.createdAt,
        endedAt,
        messages,
      })
      if (!pdf.size) throw new Error("O PDF do chat não pôde ser gerado.")
      if (pdf.size > 50 * 1024 * 1024) throw new Error("O histórico do chat excedeu o limite de 50 MB.")

      const base = meetingRecordingBaseName(meetingContextInfo.displayTitle)
      const fileName = `Chat da reunião - ${base}.pdf`
      const path = context.requestId
        ? `${context.workspaceId}/${context.requestId}/${currentUserId}/meeting-${meeting.id}-${safeFileName(fileName)}`
        : `${context.workspaceId}/${context.projectId}/${currentUserId}/meeting-${meeting.id}-${safeFileName(fileName)}`
      const bucket = context.requestId ? SERVICE_REQUEST_MEDIA_BUCKET : ATTACHMENTS_BUCKET

      if (!options?.background) setRecordingMessage("Enviando o PDF do chat para o tópico de origem…")
      // O caminho é determinístico por reunião. Se uma tentativa anterior enviou o
      // arquivo mas falhou antes da publicação no banco, removemos somente esse
      // órfão e repetimos o upload sem depender de policy UPDATE do Storage.
      await supabase.storage.from(bucket).remove([path]).catch(() => undefined)
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, pdf, {
        contentType: "application/pdf",
        cacheControl: "3600",
        upsert: false,
      })
      if (uploadError) throw uploadError

      const { data, error } = await supabase.rpc("publish_meeting_transcript", {
        p_meeting_id: meeting.id,
        p_file_name: fileName,
        p_mime_type: "application/pdf",
        p_size_bytes: pdf.size,
        p_storage_path: path,
      })
      if (error) throw error
      if (data !== true) throw new Error("O servidor não confirmou a publicação do chat da reunião.")

      if (!options?.background) {
        setRecordingState("published")
        setRecordingMessage("Gravação e chat enviados ao tópico de origem.")
      }
      void refreshAll()
      return true
    } catch (error) {
      console.error("TaskBoard: falha ao publicar o chat da reunião", error)
      const message = toUserFacingError(error, "Não foi possível enviar o chat da reunião")
      if (!options?.background) {
        setRecordingState("error")
        setMediaError(message)
        setRecordingMessage(message)
      }
      return false
    }
  }, [currentUserId, meeting, meetingContextInfo.displayTitle, members, refreshAll, supabase])

  const finalizeAndPublishRecording = React.useCallback(async (options?: {
    context?: MeetingRecordingContext | null
    background?: boolean
  }) => {
    if (!meeting) return true
    if (meeting.createdBy !== currentUserId) {
      const { data } = await supabase.rpc("meeting_recording_status", { p_meeting_id: meeting.id })
      return String((data as { status?: string } | null)?.status ?? "") === "published"
    }
    if (recordingFinalizePromiseRef.current) return recordingFinalizePromiseRef.current

    const task = (async () => {
      const recorder = meetingRecorderRef.current
      let context = options?.context ?? recordingContextRef.current

      // Capture/stop acontece antes de qualquer operação longa. Assim o fechamento
      // da UI pode desligar câmera/microfone sem cortar o último trecho da gravação.
      const segmentPromise = recorder ? recorder.stop() : null

      if (!context?.hasContext) {
        const { data, error } = await supabase.rpc("meeting_artifact_context", { p_meeting_id: meeting.id })
        if (error) throw error
        const payload = (data ?? null) as MeetingRecordingContext | null
        context = payload ? {
          ...payload,
          canRecord: meeting.createdBy === currentUserId,
          status: payload.status ?? "finalizing",
        } : null
      }
      if (!context?.hasContext) return true

      if (!recorder || !context.canRecord) {
        const { data } = await supabase.rpc("meeting_recording_status", { p_meeting_id: meeting.id })
        return String((data as { status?: string } | null)?.status ?? "") === "published"
      }

      const uploaded: Array<{ bucket: string; path: string }> = []
      try {
        if (!options?.background) {
          setRecordingState("finalizing")
          setRecordingMessage("Finalizando a gravação da reunião…")
        }

        // O stop já foi disparado acima, antes de qualquer chamada de rede.
        if (recordingHeartbeatRef.current !== null) {
          window.clearInterval(recordingHeartbeatRef.current)
          recordingHeartbeatRef.current = null
        }
        void supabase.rpc("meeting_recording_mark_finalizing", { p_meeting_id: meeting.id })
        void broadcastRecordingState("finalizing")

        const segmentCount = await segmentPromise!
        if (segmentCount <= 0) throw new Error("A reunião terminou antes que o navegador conseguisse gerar a gravação.")
        if (!context.workspaceId || !context.projectId) throw new Error("O tópico de origem da reunião não pôde ser identificado.")

        const metadata: Array<{ name: string; mimeType: string; size: number; storagePath: string }> = []
        const base = meetingRecordingBaseName(meetingContextInfo.displayTitle)

        for (let index = 0; index < segmentCount; index += 1) {
          const stored = await readMeetingRecordingSegment(meeting.id, index)
          if (!stored?.blob?.size) continue
          const extension = stored.mimeType.includes("mp4") ? "mp4" : "webm"
          const sourceName = `Gravacao - ${base} - trecho ${String(index + 1).padStart(2, "0")} de ${String(segmentCount).padStart(2, "0")}.${extension}`
          const sourceFile = new File([stored.blob], sourceName, { type: stored.mimeType || "video/webm", lastModified: Date.now() })

          if (!options?.background) setRecordingMessage(`Preparando gravação ${index + 1} de ${segmentCount}…`)
          const prepared = await prepareVideoAttachment(sourceFile, (progress) => {
            if (!options?.background) setRecordingMessage(`${progress.message} ${Math.round(progress.progress * 100)}%`)
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
            if (!options?.background) setRecordingMessage(`Enviando ${metadata.length + 1}ª parte da gravação…`)
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
        if (!options?.background) setRecordingMessage("Publicando a gravação no tópico de origem…")
        const { data, error } = await supabase.rpc("publish_meeting_recording", {
          p_meeting_id: meeting.id,
          p_parts: metadata,
        })
        if (error) throw error
        if (data !== true) throw new Error("O servidor não confirmou a publicação da gravação.")

        await clearMeetingRecordingSegments(meeting.id).catch(() => undefined)
        if (!options?.background) {
          setRecordingState("published")
          setRecordingMessage("Gravação enviada ao tópico de origem.")
        }
        void broadcastRecordingState("published")
        void refreshAll()
        return true
      } catch (error) {
        console.error("TaskBoard: falha ao finalizar gravação da reunião", error)
        for (const item of uploaded) {
          await supabase.storage.from(item.bucket).remove([item.path]).catch(() => undefined)
        }
        const message = toUserFacingError(error, "Não foi possível enviar a gravação da reunião")
        try {
          await supabase.rpc("meeting_recording_mark_failed", { p_meeting_id: meeting.id, p_error: message })
        } catch {}
        if (!options?.background) {
          setRecordingState("error")
          setRecordingMessage(message)
        }
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
  }, [broadcastRecordingState, currentUserId, meeting?.createdBy, meeting?.id, meetingContextInfo.displayTitle, refreshAll, supabase])

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
      await sendMeetingBroadcast("recording-stop-request", {
        meetingId: meeting.id,
        requestedBy: currentUserId,
        sentAt: new Date().toISOString(),
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
  }, [currentUserId, finalizeAndPublishRecording, meeting?.id, sendMeetingBroadcast, supabase])

  const startBackgroundMeetingFinalization = React.useCallback((endedAt: string) => {
    if (!meeting || meeting.createdBy !== currentUserId) return
    if (backgroundMeetingFinalizationTasks.has(meeting.id)) return

    // Copia o contexto antes de desmontar CallRoom; se ainda não tiver sido carregado,
    // as rotinas possuem fallback para meeting_artifact_context após o encerramento.
    const contextSnapshot = recordingContextRef.current ? { ...recordingContextRef.current } : null

    const task = (async () => {
      const recordingPublished = await finalizeAndPublishRecording({
        context: contextSnapshot,
        background: true,
      }).catch((error) => {
        console.error("TaskBoard: gravação em segundo plano falhou", error)
        return false
      })

      if (!recordingPublished) {
        console.warn("TaskBoard: reunião encerrada, mas a gravação não pôde ser publicada em segundo plano.")
      }

      const transcriptPublished = await publishMeetingChatTranscript({
        context: contextSnapshot,
        endedAt,
        background: true,
      }).catch((error) => {
        console.error("TaskBoard: PDF do chat em segundo plano falhou", error)
        return false
      })

      if (!transcriptPublished) {
        console.warn("TaskBoard: reunião encerrada, mas o PDF do chat não pôde ser publicado em segundo plano.")
      }

      void refreshAll()
    })().finally(() => {
      backgroundMeetingFinalizationTasks.delete(meeting.id)
    })

    backgroundMeetingFinalizationTasks.set(meeting.id, task)
  }, [currentUserId, finalizeAndPublishRecording, meeting, publishMeetingChatTranscript, refreshAll])

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

  async function removeUserFromMeeting(userId: string) {
    if (!meeting || !canManageMeetingMembers || removingUserId || userId === currentUserId) return
    const target = members.find((member) => member.id === userId)
    if (!window.confirm(`Remover ${target?.name ?? "este usuário"} desta reunião?`)) return
    setRemovingUserId(userId)
    try {
      const { data, error } = await supabase.rpc("meeting_remove_user", {
        p_meeting_id: meeting.id,
        p_user_id: userId,
      })
      if (error) throw error
      if (data !== true) return
      try {
        await sendMeetingBroadcast("member-removed", {
          meetingId: meeting.id,
          userId,
          removedBy: currentUserId,
          sentAt: new Date().toISOString(),
        } satisfies MeetingMemberRemovedSignal)
      } catch {}
      await refreshAll()
    } catch (error) {
      setMediaError(toUserFacingError(error, "Não foi possível remover o participante da reunião"))
    } finally {
      setRemovingUserId(null)
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
    if (!window.confirm(`Finalizar a reunião “${meetingContextInfo.displayTitle}” para todos? A chamada será encerrada agora; gravação e PDF do chat continuarão sendo enviados em segundo plano.`)) return

    setEndingMeeting(true)
    setMediaError("")
    const endedAt = new Date().toISOString()

    try {
      // V214: inicia o stop do MediaRecorder e mantém todo o pipeline de artefatos
      // vivo em uma Promise global. Não aguardamos compressão/upload para fechar a sala.
      startBackgroundMeetingFinalization(endedAt)

      // end_meeting é propositalmente a única espera. É uma RPC curta que marca todos
      // como left/ended; assim todos os clientes saem da sala antes do upload pesado.
      if (await endMeeting(meeting.id)) {
        // O banco já encerrou a sala. O Broadcast só acelera o fechamento visual
        // dos demais clientes; a consistência continua garantida por ended_at.
        try {
          await Promise.race([
            sendMeetingBroadcast("meeting-ended", {
              meetingId: meeting.id,
              endedBy: currentUserId,
              sentAt: endedAt,
            } satisfies MeetingEndedSignal),
            sleep(180),
          ])
        } catch {}
        stopAllMedia()
        onOpenChange(false)
      }
    } finally {
      setEndingMeeting(false)
    }
  }

  React.useEffect(() => {
    if (!finishRequested) return
    if (!meeting || meeting.createdBy !== currentUserId) {
      onFinishRequestHandled?.()
      return
    }
    // Quando a finalização foi pedida pelo card do Acompanhamento, a sala pode
    // estar sendo restaurada naquele instante. Aguarda mídia/contexto do gravador
    // ficarem prontos antes de disparar o fluxo de encerramento.
    if (mediaReadyMeetingId !== meeting.id || recordingState === "idle" || endingMeeting) return
    void finishMeeting().finally(() => onFinishRequestHandled?.())
  }, [currentUserId, endingMeeting, finishRequested, mediaReadyMeetingId, meeting?.createdBy, meeting?.id, onFinishRequestHandled, recordingState])

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

  const wallProject = meetingContextInfo.project
  const wallActivity = meetingContextInfo.activity
  const wallSubactivity = meetingContextInfo.subactivity

  const participantsPanel = (
    <div className="flex h-full min-h-0 w-full flex-col">
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
              <span className="flex shrink-0 items-center gap-1">
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
                    className="size-7"
                    loading={invitingUserId === member.id}
                    disabled={Boolean(invitingUserId) || Boolean(removingUserId)}
                    onClick={() => void callUser(member.id)}
                    title="Chamar novamente"
                    aria-label={`Chamar ${member.name}`}
                  >
                    <PhoneCall className="size-3.5" />
                  </Button>
                ) : null}
                {canManageMeetingMembers && !own && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="size-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    loading={removingUserId === member.id}
                    disabled={Boolean(removingUserId) || Boolean(invitingUserId)}
                    onClick={() => void removeUserFromMeeting(member.id)}
                    title="Remover da reunião"
                    aria-label={`Remover ${member.name} da reunião`}
                  >
                    <UserMinus className="size-3.5" />
                  </Button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {isMeetingOwner && (
        <div className="shrink-0 border-t border-border p-2.5">
          <Button type="button" variant="destructive" size="sm" className="w-full gap-1.5" onClick={() => void finishMeeting()} loading={endingMeeting} loadingText="Encerrando…">
            <PhoneOff className="size-3.5" />
            Finalizar reunião
          </Button>
          <p className="mt-1.5 text-center text-[0.54rem] leading-relaxed text-muted-foreground">A sala fecha agora; gravação e PDF do chat continuam em segundo plano.</p>
        </div>
      )}
    </div>
  )

  const muralParticipantsPanel = (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex min-h-[58px] shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold">Participantes</p>
          <p className="mt-0.5 truncate text-[0.6rem] text-muted-foreground">{connectedCount} conectado{connectedCount === 1 ? "" : "s"} · {meetingMembers.length} convidado{meetingMembers.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="inline-flex items-center rounded-lg border border-border bg-muted/35 p-0.5" aria-label="Visualização dos participantes">
            <button
              type="button"
              onClick={() => setMuralParticipantView("tiles")}
              className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors",
                muralParticipantView === "tiles" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              title="Mostrar quadrinhos com câmera"
              aria-pressed={muralParticipantView === "tiles"}
            >
              <Camera className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setMuralParticipantView("list")}
              className={cn(
                "flex size-7 items-center justify-center rounded-md transition-colors",
                muralParticipantView === "list" ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
              title="Mostrar lista de participantes"
              aria-pressed={muralParticipantView === "list"}
            >
              <Users className="size-3.5" />
            </button>
          </div>
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
      </div>

      {muralParticipantView === "tiles" ? (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 [scrollbar-width:thin]">
          {orderedMeetingMembers.map((member) => {
            const own = member.id === currentUserId
            const presence = presenceByUser.get(member.id)
            return (
              <div key={member.id} className="h-[170px] min-h-[170px] overflow-hidden rounded-2xl">
                <ParticipantTile
                  member={member}
                  own={own}
                  connected={own || Boolean(presence)}
                  connectionState={presence ? peerStates[presence.sessionId] : undefined}
                  presence={presence}
                  cameraEnabled={own ? cameraEnabled : presence?.cameraEnabled}
                  micEnabled={own ? micEnabled : presence?.micEnabled}
                  screenSharing={own ? screenSharing : presence?.screenSharing}
                  getLocalVideoStream={own ? getLocalVideoStream : undefined}
                  localVideoRevision={own ? localVideoRevision : undefined}
                  remoteStream={presence ? remoteStreams[presence.sessionId] : undefined}
                  remoteScreenStream={presence ? nativeScreenStreams[presence.sessionId] : undefined}
                  nativeScreenShare={own ? nativeScreenSharing : false}
                  compact
                  deafened={deafened}
                  playbackRevision={remotePlaybackRevision}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 pt-1 [scrollbar-width:thin]">
          {meetingMembers.map((member) => {
            const own = member.id === currentUserId
            const presence = presenceByUser.get(member.id)
            const connected = own || Boolean(presence)
            const mic = own ? micEnabled : presence?.micEnabled
            const camera = own ? cameraEnabled : presence?.cameraEnabled
            const memberState = meeting.memberStates.find((state) => state.userId === member.id)?.status
            return (
              <div key={member.id} className="group/member flex items-center gap-2.5 rounded-xl px-2 py-2.5 hover:bg-muted/40">
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
                <span className="flex shrink-0 items-center gap-1">
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
                      className="size-7"
                      loading={invitingUserId === member.id}
                      disabled={Boolean(invitingUserId) || Boolean(removingUserId)}
                      onClick={() => void callUser(member.id)}
                      title="Chamar novamente"
                    >
                      <PhoneCall className="size-3.5" />
                    </Button>
                  ) : null}
                  {!own && canManageMeetingMembers && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      loading={removingUserId === member.id}
                      disabled={Boolean(invitingUserId) || Boolean(removingUserId)}
                      onClick={() => void removeUserFromMeeting(member.id)}
                      title="Remover da reunião"
                    >
                      <UserMinus className="size-3.5" />
                    </Button>
                  )}
                </span>
              </div>
            )
          })}
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
      aria-label={`Reunião ${meetingContextInfo.displayTitle}`}
      className={cn(
        "fixed z-[80] overscroll-none transition-[inset,width,height,background-color,padding] duration-200",
        minimized
          ? "bottom-3 right-3 h-[220px] w-[min(370px,calc(100vw-1rem))]"
          : "inset-0 flex items-center justify-center bg-black/35 p-2 sm:p-4",
      )}
      onPointerDownCapture={() => { void primeCallAudio() }}
    >
      <section className={cn(
        "flex min-h-0 min-w-0 flex-col overflow-hidden overscroll-none bg-background ring-1 ring-foreground/10 transition-[width,height,border-radius,box-shadow] duration-200",
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
              <h2 className={cn("line-clamp-2 min-w-0 font-semibold leading-tight", minimized ? "text-xs" : "text-sm sm:text-base")} title={meetingContextInfo.displayTitle}>{meetingContextInfo.displayTitle}</h2>
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
            {hasWallContext && (
              <Button
                type="button"
                variant={presentationMode ? "secondary" : "ghost"}
                size="sm"
                className="h-9 gap-1.5 px-2.5"
                onClick={togglePresentationMode}
                title={presentationMode ? "Voltar para a chamada" : "Mostrar mural da origem da reunião"}
              >
                <FileText className="size-4" />
                <span className="hidden md:inline">Mural</span>
              </Button>
            )}
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
              className={cn(!presentationMode && "lg:hidden")}
              onClick={() => setPanel((current) => {
                if (current !== "chat") return "chat"
                const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
                return presentationMode && desktop ? "participants" : null
              })}
              title="Chat da reunião"
            >
              <MessageSquareText className="size-4" />
            </Button>
            <Button
              type="button"
              variant={panel === "settings" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setPanel((current) => {
                if (current !== "settings") return "settings"
                const desktop = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches
                return presentationMode && desktop ? "participants" : null
              })}
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
          <main className={cn(
            "min-w-0 flex-1 overflow-hidden bg-muted/10",
            minimized ? "p-1" : presentationMode && hasWallContext ? "p-0" : "overflow-y-auto overscroll-contain p-2 sm:p-3 lg:p-4",
          )}>
            {presentationMode && hasWallContext && !minimized ? (
              <div className="h-full min-h-0 w-full overflow-hidden bg-background">
                {wallProject && wallActivity && wallSubactivity ? (
                  <MeetingWallErrorBoundary
                    fallback={
                      <MeetingWallSurface
                        loading={meetingWallLoading}
                        error={meetingWallError}
                        context={meetingWallContext}
                        projects={projects}
                        serviceRequests={serviceRequests}
                        aqsReviews={aqsReviews}
                        members={members}
                      />
                    }
                  >
                    <ProjectFollowUp
                      project={wallProject}
                      availableProjects={[wallProject]}
                      initialActivityId={wallActivity.id}
                      initialSubactivityId={wallSubactivity.id}
                      discordEmbedded
                      meetingEmbedded
                    />
                  </MeetingWallErrorBoundary>
                ) : (
                  <MeetingWallSurface
                    loading={meetingWallLoading}
                    error={meetingWallError}
                    context={meetingWallContext}
                    projects={projects}
                    serviceRequests={serviceRequests}
                    aqsReviews={aqsReviews}
                    members={members}
                  />
                )}
              </div>
            ) : (
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
                      getLocalVideoStream={own ? getLocalVideoStream : undefined}
                      localVideoRevision={own ? localVideoRevision : undefined}
                      remoteStream={presence ? remoteStreams[presence.sessionId] : undefined}
                      remoteScreenStream={presence ? nativeScreenStreams[presence.sessionId] : undefined}
                      nativeScreenShare={own ? nativeScreenSharing : false}
                      prioritized={prioritized}
                      compact={compact}
                      onPrioritize={minimized ? undefined : () => setFocusedMemberId((current) => current === member.id ? null : member.id)}
                      deafened={deafened}
                      playbackRevision={remotePlaybackRevision}
                    />
                  </div>
                )
              })}
            </div>
            )}
          </main>

          {!minimized && (
            <aside className="hidden w-[360px] shrink-0 min-h-0 flex-col border-l border-border bg-card lg:flex">
              <div className={cn("min-h-0 flex-1", panel === "settings" ? "flex" : "hidden")}>
                {settingsPanel}
              </div>

              <div
                className={cn(
                  "min-h-0 w-full overflow-hidden",
                  panel === "settings" || (presentationMode && panel === "chat") ? "hidden" : "flex",
                  presentationMode
                    ? "flex-1"
                    : cn(
                        "shrink-0 border-b border-border transition-[height] duration-200 ease-out",
                        participantsExpanded ? "h-[min(40%,360px)] min-h-[190px]" : "h-[58px]",
                      ),
                )}
              >
                {presentationMode ? muralParticipantsPanel : participantsPanel}
              </div>

              <div
                className={cn(
                  "min-h-0 w-full",
                  panel === "settings" || (presentationMode && panel !== "chat") ? "hidden" : "flex flex-1",
                )}
              >
                <MeetingChatPanel meeting={meeting} active={!presentationMode || panel === "chat"} />
              </div>
            </aside>
          )}

          {!minimized && panel && (
            <aside className="absolute inset-x-2 bottom-2 top-2 z-20 flex min-h-0 flex-col overflow-hidden overscroll-none rounded-2xl border border-border bg-card shadow-xl lg:hidden">
              <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
                <span className="text-xs font-semibold">{panel === "participants" ? "Participantes" : panel === "chat" ? "Chat da reunião" : "Dispositivos"}</span>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setPanel(null)} aria-label="Fechar painel"><Minimize2 className="size-3.5" /></Button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                {panel === "participants" ? (presentationMode ? muralParticipantsPanel : participantsPanel) : panel === "chat" ? <MeetingChatPanel meeting={meeting} /> : settingsPanel}
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
            <Button
              type="button"
              variant="destructive"
              size={minimized ? "icon-sm" : "default"}
              className={cn(!minimized && "h-9 gap-1.5 px-4")}
              onClick={() => { void (isMeetingOwner ? finishMeeting() : leaveRoom()) }}
              loading={isMeetingOwner ? endingMeeting : leavingMeeting}
              title={isMeetingOwner ? "Finalizar reunião para todos" : "Sair da reunião"}
            >
              <PhoneOff className="size-4" />
              {!minimized && <span className="hidden sm:inline">{isMeetingOwner ? "Finalizar reunião" : "Sair"}</span>}
            </Button>
          </div>
          {!minimized && (
            <div className="mt-1.5 text-center text-[0.56rem] text-muted-foreground">
              <p>
                {deafened ? "Áudio recebido silenciado" : "Áudio recebido ativo"} · Voltar minimiza a reunião; {isMeetingOwner ? "“Finalizar reunião” salva gravação + chat antes de encerrar para todos" : "somente “Sair” encerra sua participação"}
              </p>
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
