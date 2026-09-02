"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import {
  DEFAULT_PREFERENCES,
  loadIdentity,
  loadAqsReviews,
  loadChatConversations,
  loadChatMessagesPage,
  loadMeetings,
  loadMembers,
  loadNotifications,
  loadProjects,
  loadPreferences,
  loadSupportTopics,
  loadWorkSessions,
} from "@/lib/supabase/data"
import {
  ATTACHMENTS_BUCKET,
  AVATARS_BUCKET,
  CHAT_MEDIA_BUCKET,
  TOPIC_MEDIA_BUCKET,
  PROJECT_ICONS_BUCKET,
  chatAudioStoragePath,
  chatMediaKind,
  chatMediaStoragePath,
  attachmentStoragePath,
  dataUrlToBlob,
  safeFileName,
  topicMediaStoragePath,
  projectIconStoragePath,
} from "@/lib/supabase/helpers"
import { DEVELOPER_TIMER_STARTED_EVENT } from "@/lib/developer/panel"
import { TimerStartConflictDialog, type TimerStartConflict } from "@/components/timer-start-conflict-dialog"
import type {
  AccessRole,
  AqsReview,
  AttachmentUploadInput,
  ChatConversation,
  ChatMeeting,
  ChatMention,
  ChatMessage,
  ChatReplyReference,
  MeetingMode,
  Member,
  MemberPresence,
  NotificationEntry,
  Project,
  ProjectInput,
  Status,
  SupportTopic,
  SupportTopicInput,
  Subactivity,
  UserPreferences,
  WorkSession,
} from "@/lib/types"

const PROJECT_TABLES = new Set([
  "projects",
  "project_members",
  "activities",
  "activity_assignees",
  "subactivities",
  "subactivity_members",
  "project_comments",
  "subactivity_comments",
  "attachments",
  "project_logs",
  "project_versions",
])
const MEMBER_TABLES = new Set(["profiles", "workspace_members"])
const PREFERENCE_TABLES = new Set(["user_preferences"])
const TIME_TABLES = new Set(["work_sessions"])
const CHAT_TABLES = new Set(["chat_conversations", "chat_members", "chat_messages"])
const MEETING_TABLES = new Set(["meetings", "meeting_members"])
const AQS_TABLES = new Set(["aqs_reviews"])
const TOPIC_TABLES = new Set(["support_topics", "topic_attachments"])

export type StoreContextValue = {
  projects: Project[]
  members: Member[]
  memberPresence: Record<string, MemberPresence>
  presenceReady: boolean
  chatConversations: ChatConversation[]
  chatMeetings: ChatMeeting[]
  notifications: NotificationEntry[]
  aqsReviews: AqsReview[]
  supportTopics: SupportTopic[]
  preferences: UserPreferences
  workSessions: WorkSession[]
  workspaceId: string | null
  currentUserId: string
  currentUserRole: AccessRole
  runningSubIds: string[]
  activeSubId: string | null
  hydrated: boolean
  chatHydrated: boolean
  refreshing: boolean
  lastError: string | null
  clearError: () => void
  refreshAll: () => Promise<void>
  signOut: () => Promise<void>
  updateMyProfile: (data: { name: string; avatarFile?: File | null; avatarColor?: string; removeAvatar?: boolean }) => Promise<boolean>
  setMemberRole: (memberId: string, role: AccessRole) => Promise<boolean>
  startAqsReview: (reviewId: string) => Promise<boolean>
  completeAqsReview: (reviewId: string) => Promise<boolean>
  revokeAqsReview: (reviewId: string, reason: string) => Promise<boolean>
  createSupportTopic: (data: SupportTopicInput) => Promise<string | null>
  addSupportTopicAttachments: (topicId: string, files: File[]) => Promise<boolean>
  startSupportTopicAnalysis: (topicId: string) => Promise<boolean>
  revokeSupportTopic: (topicId: string, reason: string) => Promise<boolean>
  sendSupportTopicToActivity: (topicId: string, projectId: string, developerId?: string) => Promise<string | null>
  updatePreferences: (preferences: UserPreferences) => Promise<boolean>
  canManageSubactivity: (sub: Subactivity) => boolean
  startTimer: (subId: string) => Promise<boolean>
  stopTimer: (subId?: string) => Promise<boolean>
  setSubStatus: (subId: string, status: Status) => Promise<boolean>
  addSubactivity: (
    projectId: string,
    activityId: string,
    data: { title: string; estimatedHours: number; assigneeId: string; status?: Status },
  ) => Promise<boolean>
  addActivity: (projectId: string, title: string, assigneeIds?: string[]) => Promise<boolean>
  deleteActivity: (projectId: string, activityId: string) => Promise<boolean>
  addProject: (data: ProjectInput, visual?: { imageFile?: File | null; useCustomImage?: boolean }) => Promise<string | null>
  updateProject: (projectId: string, data: ProjectInput, visual?: { imageFile?: File | null; useCustomImage?: boolean }) => Promise<boolean>
  versionProject: (projectId: string, data: { version: string; build: string; allowPending?: boolean }) => Promise<boolean>
  addProjectComment: (projectId: string, content: string) => Promise<boolean>
  addSubactivityComment: (subId: string, content: string) => Promise<boolean>
  addFollowUpComment: (subId: string, content: string, mentions?: ChatMention[], replyToCommentId?: string) => Promise<boolean>
  addFollowUpAttachments: (subId: string, files: AttachmentUploadInput[]) => Promise<boolean>
  deleteFollowUpComment: (commentId: string) => Promise<boolean>
  deleteFollowUpAttachment: (attachmentId: string, storagePath?: string) => Promise<boolean>
  removeFollowUpMember: (subId: string, userId: string) => Promise<boolean>
  addProjectAttachments: (projectId: string, files: AttachmentUploadInput[]) => Promise<boolean>
  setProjectAttachmentActive: (projectId: string, attachmentId: string, active: boolean) => Promise<boolean>
  addSubactivityAttachments: (subId: string, files: AttachmentUploadInput[]) => Promise<boolean>
  setSubactivityAttachmentActive: (subId: string, attachmentId: string, active: boolean) => Promise<boolean>
  ensureDirectConversation: (memberId: string) => Promise<string | null>
  sendChatMessage: (conversationId: string, content: string, mentions?: ChatMention[], replyTo?: ChatReplyReference) => Promise<boolean>
  retryChatMessage: (conversationId: string, messageId: string) => Promise<boolean>
  sendChatAudio: (conversationId: string, audio: Blob, durationMs: number) => Promise<boolean>
  sendChatMedia: (conversationId: string, files: File[], caption?: string) => Promise<boolean>
  loadChatHistory: (conversationId: string, beforeCreatedAt?: string) => Promise<{ count: number; hasMore: boolean } | null>
  deleteDirectConversation: (conversationId: string) => Promise<boolean>
  leaveChatGroup: (conversationId: string) => Promise<boolean>
  createChatGroup: (name: string, memberIds: string[]) => Promise<string | null>
  updateChatGroup: (conversationId: string, data: { name: string; memberIds: string[] }) => Promise<boolean>
  deleteChatGroup: (conversationId: string) => Promise<boolean>
  createMeeting: (data: { title: string; memberIds: string[]; mode: MeetingMode; conversationId?: string }) => Promise<string | null>
  endMeeting: (meetingId: string) => Promise<boolean>
  answerMeetingInvite: (meetingId: string, accept: boolean) => Promise<boolean>
  joinMeeting: (meetingId: string) => Promise<boolean>
  leaveMeeting: (meetingId: string) => Promise<boolean>
  heartbeatMeeting: (meetingId: string) => Promise<boolean>
  markNotificationRead: (notificationId: string) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  findSub: (subId: string) => { project: Project; activityId: string; sub: Subactivity } | null
}

const StoreContext = React.createContext<StoreContextValue | null>(null)

function findSubInProjects(projects: Project[], subId: string) {
  for (const project of projects) {
    for (const activity of project.activities) {
      const sub = activity.subactivities.find((item) => item.id === subId)
      if (sub) return { project, activityId: activity.id, sub }
    }
  }
  return null
}

function findRunningSubForAssignee(projects: Project[], assigneeId: string, exceptSubId: string) {
  for (const project of projects) {
    for (const activity of project.activities) {
      const sub = activity.subactivities.find((item) =>
        item.id !== exceptSubId && item.assigneeId === assigneeId && item.status === "in-progress",
      )
      if (sub) return { project, activityId: activity.id, sub }
    }
  }
  return null
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "object" && error && "message" in error) return String((error as any).message)
  return fallback
}

function optimisticSubStatus(projects: Project[], subId: string, status: Status) {
  const found = findSubInProjects(projects, subId)
  if (!found) return projects
  const assigneeId = found.sub.assigneeId
  const now = new Date().toISOString()

  return projects.map((project) => ({
    ...project,
    activities: project.activities.map((activity) => ({
      ...activity,
      subactivities: activity.subactivities.map((sub) => {
        if (status === "in-progress" && sub.id !== subId && sub.assigneeId === assigneeId && sub.status === "in-progress") {
          return { ...sub, status: "paused" as Status, timerStartedAt: undefined }
        }
        if (sub.id !== subId) return sub
        return {
          ...sub,
          status,
          timerStartedAt: status === "in-progress" ? now : undefined,
        }
      }),
    })),
  }))
}

type OptimisticSubSnapshot = Pick<Subactivity, "id" | "status" | "trackedSeconds" | "timerStartedAt" | "assigneeId">

function captureOptimisticSubs(projects: Project[], subId: string, nextStatus: Status): OptimisticSubSnapshot[] {
  const found = findSubInProjects(projects, subId)
  if (!found) return []
  const targetAssignee = found.sub.assigneeId
  const snapshots: OptimisticSubSnapshot[] = []
  for (const project of projects) {
    for (const activity of project.activities) {
      for (const sub of activity.subactivities) {
        if (sub.id === subId || (nextStatus === "in-progress" && sub.assigneeId === targetAssignee && sub.status === "in-progress")) {
          snapshots.push({
            id: sub.id,
            status: sub.status,
            trackedSeconds: sub.trackedSeconds,
            timerStartedAt: sub.timerStartedAt,
            assigneeId: sub.assigneeId,
          })
        }
      }
    }
  }
  return snapshots
}

function restoreOptimisticSubs(projects: Project[], snapshots: OptimisticSubSnapshot[]) {
  if (!snapshots.length) return projects
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
  return projects.map((project) => ({
    ...project,
    activities: project.activities.map((activity) => ({
      ...activity,
      subactivities: activity.subactivities.map((sub) => {
        const snapshot = byId.get(sub.id)
        return snapshot ? { ...sub, ...snapshot } : sub
      }),
    })),
  }))
}

function applyRealtimeSubactivity(projects: Project[], row: Record<string, any>) {
  if (!row?.id) return projects
  const persisted = Number(row.tracked_seconds ?? 0)
  const live = row.status === "in-progress" && row.timer_started_at
    ? persisted + Math.max(0, Math.floor((Date.now() - new Date(row.timer_started_at).getTime()) / 1000))
    : persisted

  return projects.map((project) => ({
    ...project,
    activities: project.activities.map((activity) => ({
      ...activity,
      subactivities: activity.subactivities.map((sub) => sub.id === row.id ? {
        ...sub,
        title: row.title ?? sub.title,
        status: (row.status ?? sub.status) as Status,
        estimatedHours: row.estimated_hours !== undefined ? Number(row.estimated_hours || 0) : sub.estimatedHours,
        trackedSeconds: live,
        timerStartedAt: row.timer_started_at ?? undefined,
        assigneeId: row.assignee_id ?? sub.assigneeId,
        needsAttention: row.needs_attention === true,
        attentionMessage: row.attention_message ?? undefined,
      } : sub),
    })),
  }))
}

function applyRealtimeProjectLog(projects: Project[], row: Record<string, any>) {
  if (!row?.id || !row?.project_id) return projects
  return projects.map((project) => {
    if (project.id !== row.project_id) return project
    if (project.logs.some((log) => log.id === row.id)) return project
    return {
      ...project,
      logs: [{
        id: row.id,
        actorId: row.actor_id ?? undefined,
        type: row.type,
        title: row.title,
        description: row.description ?? undefined,
        createdAt: row.created_at,
      }, ...project.logs],
    }
  })
}

function isOptimisticChatMessage(message: ChatMessage) {
  return message.deliveryStatus === "sending" || message.deliveryStatus === "failed" || message.id.startsWith("local:")
}

function mergeChatMessages(previous: ChatMessage[], incoming: ChatMessage[], preserveHistory: boolean) {
  // Mensagens locais de envio otimista nunca podem sumir por causa de um refresh/realtime.
  // Quando o histórico já foi carregado, preservamos também as páginas antigas já existentes.
  const seed = preserveHistory ? previous : previous.filter(isOptimisticChatMessage)
  const byId = new Map(seed.map((message) => [message.id, message]))
  for (const message of incoming) byId.set(message.id, message)
  return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function optimisticMessageId() {
  const value = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `local:${value}`
}

type PresencePayload = {
  user_id?: string
  online_since?: string
  session_id?: string
}

function presenceSessionId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function validPresenceDate(value: unknown) {
  if (typeof value !== "string" || !value) return null
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function mapPresenceState(state: Record<string, PresencePayload[]>): Record<string, MemberPresence> {
  const grouped = new Map<string, { connections: number; onlineSince?: string }>()

  for (const presences of Object.values(state)) {
    for (const presence of presences ?? []) {
      const userId = typeof presence?.user_id === "string" ? presence.user_id : ""
      if (!userId) continue
      const current = grouped.get(userId) ?? { connections: 0 }
      current.connections += 1
      const onlineSince = validPresenceDate(presence.online_since)
      if (onlineSince && (!current.onlineSince || onlineSince < current.onlineSince)) current.onlineSince = onlineSince
      grouped.set(userId, current)
    }
  }

  return Object.fromEntries(Array.from(grouped.entries()).map(([userId, value]) => [userId, {
    online: value.connections > 0,
    onlineSince: value.onlineSince,
    connections: value.connections,
  }]))
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const supabase = React.useMemo(() => createClient(), [])
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState("")
  const [currentUserRole, setCurrentUserRole] = React.useState<AccessRole>("member")
  const [members, setMembers] = React.useState<Member[]>([])
  const [memberPresence, setMemberPresence] = React.useState<Record<string, MemberPresence>>({})
  const [presenceReady, setPresenceReady] = React.useState(false)
  const [projects, setProjects] = React.useState<Project[]>([])
  const [chatConversations, setChatConversations] = React.useState<ChatConversation[]>([])
  const [chatMeetings, setChatMeetings] = React.useState<ChatMeeting[]>([])
  const [notifications, setNotifications] = React.useState<NotificationEntry[]>([])
  const [aqsReviews, setAqsReviews] = React.useState<AqsReview[]>([])
  const [supportTopics, setSupportTopics] = React.useState<SupportTopic[]>([])
  const [preferences, setPreferences] = React.useState<UserPreferences>(DEFAULT_PREFERENCES)
  const [workSessions, setWorkSessions] = React.useState<WorkSession[]>([])
  const [hydrated, setHydrated] = React.useState(false)
  const [chatHydrated, setChatHydrated] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [lastError, setLastError] = React.useState<string | null>(null)
  const [timerConflict, setTimerConflict] = React.useState<TimerStartConflict | null>(null)
  const [timerConflictLoading, setTimerConflictLoading] = React.useState(false)
  const timerConflictResolverRef = React.useRef<((value: boolean) => void) | null>(null)
  const refreshTimers = React.useRef<Record<string, number>>({})
  const loadedChatHistoryIdsRef = React.useRef<Set<string>>(new Set())
  const chatMessageDeliveriesRef = React.useRef<Set<string>>(new Set())

  const fail = React.useCallback((error: unknown, fallback: string) => {
    const message = errorMessage(error, fallback)
    console.error("[Devboard/Supabase]", error)
    setLastError(message)
    return message
  }, [])

  const refreshProjects = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      setProjects(await loadProjects(supabase, workspaceId))
    } catch (error) {
      fail(error, "Não foi possível atualizar os projetos")
    }
  }, [fail, supabase, workspaceId])

  const refreshMembers = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      const next = await loadMembers(supabase, workspaceId)
      setMembers(next)
      const me = next.find((member) => member.id === currentUserId)
      if (me?.role) setCurrentUserRole(me.role)
    } catch (error) {
      fail(error, "Não foi possível atualizar a equipe")
    }
  }, [currentUserId, fail, supabase, workspaceId])

  const refreshChat = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      const next = await loadChatConversations(supabase, workspaceId)
      setChatConversations((current) => next.map((conversation) => {
        const previous = current.find((item) => item.id === conversation.id)
        if (!previous) return conversation
        const merged = mergeChatMessages(
          previous.messages,
          conversation.messages,
          loadedChatHistoryIdsRef.current.has(conversation.id),
        )
        const hasLocalDelivery = merged.some(isOptimisticChatMessage)
        return {
          ...conversation,
          updatedAt: hasLocalDelivery && previous.updatedAt > conversation.updatedAt ? previous.updatedAt : conversation.updatedAt,
          messages: merged,
        }
      }))
    } catch (error) {
      fail(error, "Não foi possível atualizar o chat")
    }
  }, [fail, supabase, workspaceId])

  const refreshMeetings = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      setChatMeetings(await loadMeetings(supabase, workspaceId))
    } catch (error) {
      fail(error, "Não foi possível atualizar as reuniões")
    }
  }, [fail, supabase, workspaceId])

  const refreshNotifications = React.useCallback(async () => {
    if (!currentUserId) return
    try {
      setNotifications(await loadNotifications(supabase, currentUserId))
    } catch (error) {
      fail(error, "Não foi possível atualizar as notificações")
    }
  }, [currentUserId, fail, supabase])

  const refreshPreferences = React.useCallback(async () => {
    if (!currentUserId) return
    try {
      setPreferences(await loadPreferences(supabase, currentUserId))
    } catch (error) {
      fail(error, "Não foi possível atualizar suas preferências")
    }
  }, [currentUserId, fail, supabase])

  const refreshWorkSessions = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      setWorkSessions(await loadWorkSessions(supabase))
    } catch (error) {
      fail(error, "Não foi possível atualizar o histórico de horas")
    }
  }, [fail, supabase, workspaceId])

  const refreshAqsReviews = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      setAqsReviews(await loadAqsReviews(supabase, workspaceId))
    } catch (error) {
      fail(error, "Não foi possível atualizar a fila de AQS")
    }
  }, [fail, supabase, workspaceId])

  const refreshSupportTopics = React.useCallback(async () => {
    if (!workspaceId) return
    try {
      setSupportTopics(await loadSupportTopics(supabase, workspaceId))
    } catch (error) {
      fail(error, "Não foi possível atualizar os tópicos")
    }
  }, [fail, supabase, workspaceId])

  const refreshAll = React.useCallback(async () => {
    setRefreshing(true)
    setChatHydrated(false)
    try {
      const identity = await loadIdentity(supabase)
      setWorkspaceId(identity.workspaceId)
      setCurrentUserId(identity.user.id)
      setCurrentUserRole(identity.role)

      // Carrega primeiro apenas o que é necessário para Dashboard, Projetos,
      // Horas, Agenda e Configurações. Chat/reuniões não bloqueiam mais a
      // abertura do restante do sistema.
      const [nextMembers, nextProjects, nextNotifications, nextPreferences, nextWorkSessions, nextAqsReviews, nextSupportTopics] = await Promise.all([
        loadMembers(supabase, identity.workspaceId),
        loadProjects(supabase, identity.workspaceId),
        loadNotifications(supabase, identity.user.id),
        loadPreferences(supabase, identity.user.id),
        loadWorkSessions(supabase),
        loadAqsReviews(supabase, identity.workspaceId),
        loadSupportTopics(supabase, identity.workspaceId),
      ])

      setMembers(nextMembers)
      setProjects(nextProjects)
      setNotifications(nextNotifications)
      setPreferences(nextPreferences)
      setWorkSessions(nextWorkSessions)
      setAqsReviews(nextAqsReviews)
      setSupportTopics(nextSupportTopics)
      setLastError(null)
      setHydrated(true)
      setRefreshing(false)

      void Promise.all([
        loadChatConversations(supabase, identity.workspaceId),
        loadMeetings(supabase, identity.workspaceId),
      ])
        .then(([nextChat, nextMeetings]) => {
          setChatConversations((current) => nextChat.map((conversation) => {
            const previous = current.find((item) => item.id === conversation.id)
            if (!previous) return conversation
            const merged = mergeChatMessages(
              previous.messages,
              conversation.messages,
              loadedChatHistoryIdsRef.current.has(conversation.id),
            )
            const hasLocalDelivery = merged.some(isOptimisticChatMessage)
            return {
              ...conversation,
              updatedAt: hasLocalDelivery && previous.updatedAt > conversation.updatedAt ? previous.updatedAt : conversation.updatedAt,
              messages: merged,
            }
          }))
          setChatMeetings(nextMeetings)
        })
        .catch((error) => {
          fail(error, "Não foi possível carregar o chat e as reuniões")
        })
        .finally(() => setChatHydrated(true))
    } catch (error) {
      fail(error, "Não foi possível carregar os dados do Supabase")
      setRefreshing(false)
      setHydrated(true)
      setChatHydrated(true)
    }
  }, [fail, supabase])

  React.useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const schedule = React.useCallback((key: string, action: () => Promise<void>) => {
    const current = refreshTimers.current[key]
    if (current) window.clearTimeout(current)
    refreshTimers.current[key] = window.setTimeout(() => void action(), 180)
  }, [])

  React.useEffect(() => {
    if (!workspaceId || !currentUserId) return

    const channel = supabase.channel(`devboard-db-${workspaceId}-${currentUserId}`)
    const tables = [
      ...PROJECT_TABLES,
      ...MEMBER_TABLES,
      ...CHAT_TABLES,
      ...MEETING_TABLES,
      ...PREFERENCE_TABLES,
      ...TIME_TABLES,
      ...AQS_TABLES,
      ...TOPIC_TABLES,
      "notifications",
    ]

    for (const table of Array.from(new Set(tables))) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload: any) => {
          // Status/timer é a interação mais frequente do Kanban. Para UPDATEs,
          // aplica o payload do Realtime diretamente e evita uma nova leitura
          // pesada de todo o projeto apenas para mover um card.
          if (table === "subactivities" && payload?.eventType === "UPDATE" && payload?.new?.id) {
            setProjects((current) => applyRealtimeSubactivity(current, payload.new))
          } else if (table === "project_logs" && payload?.eventType === "INSERT" && payload?.new?.id) {
            setProjects((current) => applyRealtimeProjectLog(current, payload.new))
          } else if (PROJECT_TABLES.has(table)) {
            schedule("projects", refreshProjects)
          }
          if (MEMBER_TABLES.has(table)) schedule("members", refreshMembers)
          if (CHAT_TABLES.has(table)) schedule("chat", refreshChat)
          if (MEETING_TABLES.has(table)) schedule("meetings", refreshMeetings)
          if (table === "notifications") schedule("notifications", refreshNotifications)
          if (PREFERENCE_TABLES.has(table)) schedule("preferences", refreshPreferences)
          if (TIME_TABLES.has(table)) schedule("work-sessions", refreshWorkSessions)
          if (AQS_TABLES.has(table)) schedule("aqs-reviews", refreshAqsReviews)
          if (TOPIC_TABLES.has(table)) schedule("support-topics", refreshSupportTopics)
        },
      )
    }

    channel.subscribe((status) => {
      if (status === "CHANNEL_ERROR") setLastError("A conexão em tempo real com o Supabase foi interrompida. Tentando reconectar...")
    })

    return () => {
      Object.values(refreshTimers.current).forEach((timer) => window.clearTimeout(timer))
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, refreshChat, refreshMeetings, refreshMembers, refreshNotifications, refreshPreferences, refreshProjects, refreshWorkSessions, refreshAqsReviews, refreshSupportTopics, schedule, supabase, workspaceId])

  React.useEffect(() => {
    if (!workspaceId || !currentUserId) {
      setMemberPresence({})
      setPresenceReady(false)
      return
    }

    const sessionId = presenceSessionId()
    const topic = `devboard-presence:${workspaceId}`
    const channel = supabase.channel(topic, {
      config: {
        private: true,
        presence: { key: `${currentUserId}:${sessionId}` },
      },
    })

    let disposed = false
    let onlineSince = new Date().toISOString()
    let syncingOnlineSince = false

    const currentPayload = (): PresencePayload => ({
      user_id: currentUserId,
      online_since: onlineSince,
      session_id: sessionId,
    })

    const syncPresence = () => {
      if (disposed) return
      const state = channel.presenceState() as unknown as Record<string, PresencePayload[]>
      const next = mapPresenceState(state)
      setMemberPresence(next)
      setPresenceReady(true)

      // Mantém o início do período online estável entre várias abas/dispositivos.
      // Uma nova conexão herda o menor online_since já publicado pelo mesmo usuário.
      const mine = next[currentUserId]
      if (mine?.onlineSince && mine.onlineSince < onlineSince && !syncingOnlineSince) {
        onlineSince = mine.onlineSince
        syncingOnlineSince = true
        void channel.track(currentPayload()).finally(() => {
          syncingOnlineSince = false
        })
      }
    }

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe(async (status) => {
        if (disposed) return

        if (status === "SUBSCRIBED") {
          const existing = mapPresenceState(
            channel.presenceState() as unknown as Record<string, PresencePayload[]>,
          )[currentUserId]
          if (existing?.onlineSince && existing.onlineSince < onlineSince) onlineSince = existing.onlineSince

          const tracked = await channel.track(currentPayload())
          if (tracked !== "ok") {
            console.warn("[Devboard/Presence] Não foi possível publicar o status online:", tracked)
          }
          return
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setPresenceReady(false)
          setMemberPresence({})
        }
      })

    return () => {
      disposed = true
      setPresenceReady(false)
      setMemberPresence({})
      void channel.untrack().finally(() => {
        void supabase.removeChannel(channel)
      })
    }
  }, [currentUserId, supabase, workspaceId])

  React.useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.dataset.density = preferences.density
    document.documentElement.dataset.reducedMotion = preferences.reducedMotion ? "true" : "false"
  }, [preferences.density, preferences.reducedMotion])

  const runningSubIds = React.useMemo(
    () => projects.flatMap((project) => project.activities.flatMap((activity) => activity.subactivities.filter((sub) => sub.status === "in-progress").map((sub) => sub.id))),
    [projects],
  )
  const runningSubKey = runningSubIds.join("|")

  const activeSubId = React.useMemo(() => {
    for (const project of projects) {
      for (const activity of project.activities) {
        const sub = activity.subactivities.find((item) => item.assigneeId === currentUserId && item.status === "in-progress")
        if (sub) return sub.id
      }
    }
    return null
  }, [currentUserId, projects])

  React.useEffect(() => {
    if (!hydrated || runningSubIds.length === 0) return

    // Timers de navegador são reduzidos/suspensos quando a aba/PWA fica em
    // segundo plano. Incrementar apenas `+1` por callback fazia o relógio da
    // UI ficar atrasado até um refresh. Mantemos uma âncora de tempo real e
    // aplicamos o delta efetivamente transcorrido quando o callback voltar a
    // executar (inclusive após minimizar, trocar de aba ou suspender a máquina).
    let lastWallClock = Date.now()
    let remainderMs = 0

    const reconcileRunningTimers = (force = false) => {
      if (!force && typeof document !== "undefined" && document.visibilityState === "hidden") return

      const now = Date.now()
      const elapsedMs = Math.max(0, now - lastWallClock)
      lastWallClock = now
      remainderMs += elapsedMs

      const elapsedSeconds = Math.floor(remainderMs / 1000)
      if (elapsedSeconds <= 0) return
      remainderMs -= elapsedSeconds * 1000

      setProjects((prev) => prev.map((project) => ({
        ...project,
        activities: project.activities.map((activity) => ({
          ...activity,
          subactivities: activity.subactivities.map((sub) => sub.status === "in-progress"
            ? { ...sub, trackedSeconds: sub.trackedSeconds + elapsedSeconds }
            : sub),
        })),
      })))
    }

    const interval = window.setInterval(() => reconcileRunningTimers(), 1000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Fecha o último pedaço visível antes do navegador começar a throttlar.
        reconcileRunningTimers(true)
        return
      }
      // Ao voltar para a aplicação, atualiza imediatamente todo o período em
      // segundo plano, sem esperar o próximo tick do setInterval.
      reconcileRunningTimers(true)
    }
    const handleResume = () => reconcileRunningTimers(true)

    document.addEventListener("visibilitychange", handleVisibilityChange)
    window.addEventListener("focus", handleResume)
    window.addEventListener("pageshow", handleResume)

    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      window.removeEventListener("focus", handleResume)
      window.removeEventListener("pageshow", handleResume)
    }
  }, [hydrated, runningSubKey])

  const canManageSubactivity = React.useCallback((sub: Subactivity) => {
    if (currentUserRole === "admin") return true
    if (currentUserRole !== "developer") return false
    if (sub.assigneeId !== currentUserId) return false
    if (sub.status === "done" || sub.status === "cancelled" || sub.status === "waiting-aqs") return false
    return true
  }, [currentUserId, currentUserRole])

  const callRpc = React.useCallback(async <T,>(name: string, args: Record<string, unknown>, fallback: string): Promise<T | null | undefined> => {
    try {
      setLastError(null)
      const { data, error } = await supabase.rpc(name, args)
      if (error) throw error
      return data as T
    } catch (error) {
      fail(error, fallback)
      return undefined
    }
  }, [fail, supabase])

  const startTimerDirect = React.useCallback(async (subId: string) => {
    const found = findSubInProjects(projects, subId)
    const target = found?.sub
    if (!target || !found || !canManageSubactivity(target)) return false

    if (currentUserRole === "developer" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(DEVELOPER_TIMER_STARTED_EVENT, { detail: {
        subactivityId: subId,
        activityId: found.activityId,
        projectId: found.project.id,
      } }))
    }

    const rollback = captureOptimisticSubs(projects, subId, "in-progress")
    setProjects((current) => optimisticSubStatus(current, subId, "in-progress"))
    const result = await callRpc<unknown>("start_subactivity", { p_subactivity_id: subId }, "Não foi possível iniciar a subatividade")
    if (result === undefined) {
      setProjects((current) => restoreOptimisticSubs(current, rollback))
      return false
    }

    schedule("sessions-after-start", refreshWorkSessions)
    return true
  }, [callRpc, canManageSubactivity, currentUserRole, projects, refreshWorkSessions, schedule])

  const startTimer = React.useCallback(async (subId: string) => {
    const found = findSubInProjects(projects, subId)
    const target = found?.sub
    if (!found || !target || !canManageSubactivity(target)) return false
    if (target.status === "in-progress") return true

    const current = findRunningSubForAssignee(projects, target.assigneeId, subId)
    if (!current) return startTimerDirect(subId)

    return await new Promise<boolean>((resolve) => {
      timerConflictResolverRef.current?.(false)
      timerConflictResolverRef.current = resolve
      setTimerConflict({
        currentSubId: current.sub.id,
        currentSubTitle: current.sub.title,
        currentProjectName: current.project.name,
        targetSubId: target.id,
        targetSubTitle: target.title,
        targetProjectName: found.project.name,
      })
    })
  }, [canManageSubactivity, projects, startTimerDirect])

  const stopTimer = React.useCallback(async (subId?: string) => {
    // Proteção contra handlers React passados diretamente (ex.: onClick={stopTimer}).
    // Somente strings são tratadas como IDs; qualquer outro valor cai no timer ativo.
    const targetId = typeof subId === "string" && subId.length > 0 ? subId : activeSubId
    if (!targetId) return false

    const rollback = captureOptimisticSubs(projects, targetId, "paused")
    setProjects((current) => optimisticSubStatus(current, targetId, "paused"))
    const result = await callRpc<unknown>("pause_subactivity", { p_subactivity_id: targetId }, "Não foi possível pausar a subatividade")
    if (result === undefined) {
      setProjects((current) => restoreOptimisticSubs(current, rollback))
      return false
    }

    schedule("sessions-after-pause", refreshWorkSessions)
    return true
  }, [activeSubId, callRpc, projects, refreshWorkSessions, schedule])

  const setSubStatus = React.useCallback(async (subId: string, status: Status) => {
    if (status === "in-progress") return startTimer(subId)

    const rollback = captureOptimisticSubs(projects, subId, status)
    setProjects((current) => optimisticSubStatus(current, subId, status))

    const result = await callRpc<unknown>("set_subactivity_status", { p_subactivity_id: subId, p_status: status }, "Não foi possível alterar o status")
    if (result === undefined) {
      setProjects((current) => restoreOptimisticSubs(current, rollback))
      return false
    }

    schedule("sessions-after-status", refreshWorkSessions)
    return true
  }, [callRpc, projects, refreshWorkSessions, schedule, startTimer])

  const cancelTimerConflict = React.useCallback(() => {
    if (timerConflictLoading) return
    timerConflictResolverRef.current?.(false)
    timerConflictResolverRef.current = null
    setTimerConflict(null)
  }, [timerConflictLoading])

  const confirmTimerConflict = React.useCallback(async () => {
    if (!timerConflict || timerConflictLoading) return
    setTimerConflictLoading(true)
    let ok = false
    try {
      const paused = await stopTimer(timerConflict.currentSubId)
      if (paused) ok = await startTimerDirect(timerConflict.targetSubId)
    } finally {
      setTimerConflictLoading(false)
      timerConflictResolverRef.current?.(ok)
      timerConflictResolverRef.current = null
      setTimerConflict(null)
    }
  }, [startTimerDirect, stopTimer, timerConflict, timerConflictLoading])

  const addSubactivity = React.useCallback<StoreContextValue["addSubactivity"]>(async (projectId, activityId, data) => {
    const project = projects.find((item) => item.id === projectId)
    const canManageStructure = currentUserRole === "admin" || Boolean(project?.memberIds.includes(currentUserId))
    if (!canManageStructure) {
      fail(new Error("Você precisa estar integrado ao projeto para criar subatividades."), "Sem permissão para criar subatividades")
      return false
    }
    const result = await callRpc<string>("add_subactivity", {
      p_project_id: projectId,
      p_activity_id: activityId,
      p_title: data.title,
      p_estimated_hours: data.estimatedHours,
      p_assignee_id: data.assigneeId,
      p_status: data.status ?? "backlog",
    }, "Não foi possível adicionar a subatividade")
    if (!result) return false
    await Promise.all([refreshProjects(), refreshNotifications(), refreshWorkSessions()])
    return true
  }, [callRpc, currentUserId, currentUserRole, fail, projects, refreshNotifications, refreshProjects, refreshWorkSessions])

  const addActivity = React.useCallback(async (projectId: string, title: string, assigneeIds: string[] = []) => {
    const project = projects.find((item) => item.id === projectId)
    const canManageStructure = currentUserRole === "admin" || Boolean(project?.memberIds.includes(currentUserId))
    if (!canManageStructure) {
      fail(new Error("Você precisa estar integrado ao projeto para criar atividades."), "Sem permissão para criar atividades")
      return false
    }
    const result = await callRpc<string>("add_activity", { p_project_id: projectId, p_title: title, p_assignee_ids: assigneeIds }, "Não foi possível adicionar a atividade")
    if (!result) return false
    await refreshProjects()
    return true
  }, [callRpc, currentUserId, currentUserRole, fail, projects, refreshProjects])

  const deleteActivity = React.useCallback(async (projectId: string, activityId: string) => {
    const project = projects.find((item) => item.id === projectId)
    const canManageStructure = currentUserRole === "admin" || Boolean(project?.memberIds.includes(currentUserId))
    if (!canManageStructure) {
      fail(new Error("Você precisa estar integrado ao projeto para excluir atividades."), "Sem permissão para excluir atividades")
      return false
    }
    const result = await callRpc<unknown>("delete_activity", { p_activity_id: activityId }, "Não foi possível excluir a atividade")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, currentUserId, currentUserRole, fail, projects, refreshProjects])

  const uploadProjectIconImage = React.useCallback(async (projectId: string, file: File) => {
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
    if (!allowedTypes.has(file.type)) throw new Error("Use uma imagem JPG, PNG, WEBP ou GIF.")
    if (file.size > 3 * 1024 * 1024) throw new Error("A imagem do projeto deve ter no máximo 3 MB.")

    const path = projectIconStoragePath(currentUserId, projectId, file.name)
    const { error } = await supabase.storage.from(PROJECT_ICONS_BUCKET).upload(path, file, {
      contentType: file.type || "image/jpeg",
      cacheControl: "3600",
      upsert: false,
    })
    if (error) throw error
    return path
  }, [currentUserId, supabase])

  const removeProjectIconImage = React.useCallback(async (path?: string | null) => {
    if (!path) return
    const { error } = await supabase.storage.from(PROJECT_ICONS_BUCKET).remove([path])
    if (error) console.warn("[Devboard/ProjectIcon] Não foi possível remover a imagem anterior do projeto.", error)
  }, [supabase])

  const addProject = React.useCallback<StoreContextValue["addProject"]>(async (data, visual) => {
    const result = await callRpc<string>("create_project", {
      p_name: data.name,
      p_client: data.client,
      p_description: data.description,
      p_tag: data.tag,
      p_priority: data.priority,
      p_due_date: data.dueDate,
      p_repository: data.repository ?? "",
      p_member_ids: data.memberIds,
    }, "Não foi possível criar o projeto")
    if (!result) return null

    let uploadedPath: string | null = null
    try {
      if (visual?.useCustomImage && visual.imageFile) {
        uploadedPath = await uploadProjectIconImage(result, visual.imageFile)
      }

      const iconResult = await callRpc<unknown>("set_project_visual", {
        p_project_id: result,
        p_icon: data.icon ?? "folder-kanban",
        p_icon_image_path: visual?.useCustomImage ? uploadedPath : null,
      }, "Projeto criado, mas não foi possível salvar a identidade visual")

      if (iconResult === undefined) {
        if (uploadedPath) await removeProjectIconImage(uploadedPath)
        await refreshProjects()
        return result
      }

      await refreshProjects()
      return result
    } catch (error) {
      if (uploadedPath) await removeProjectIconImage(uploadedPath)
      fail(error, "Projeto criado, mas não foi possível enviar a imagem personalizada")
      await refreshProjects()
      return result
    }
  }, [callRpc, fail, refreshProjects, removeProjectIconImage, uploadProjectIconImage])

  const updateProject = React.useCallback<StoreContextValue["updateProject"]>(async (projectId, data, visual) => {
    const project = projects.find((item) => item.id === projectId)
    const canEdit = currentUserRole === "admin" || Boolean(
      project && currentUserRole === "developer" && project.memberIds.includes(currentUserId),
    )
    if (!canEdit) {
      fail(new Error("Você precisa estar integrado ao projeto para editá-lo."), "Sem permissão para editar este projeto")
      return false
    }

    let uploadedPath: string | null = null
    try {
      if (visual?.useCustomImage && visual.imageFile) {
        uploadedPath = await uploadProjectIconImage(projectId, visual.imageFile)
      }

      const result = await callRpc<unknown>("update_project", {
        p_project_id: projectId,
        p_name: data.name,
        p_client: data.client,
        p_description: data.description,
        p_tag: data.tag,
        p_priority: data.priority,
        p_due_date: data.dueDate,
        p_repository: data.repository ?? "",
        p_member_ids: data.memberIds,
      }, "Não foi possível atualizar o projeto")
      if (result === undefined) {
        if (uploadedPath) await removeProjectIconImage(uploadedPath)
        return false
      }

      const useCustomImage = visual?.useCustomImage ?? Boolean(project?.iconImagePath)
      const nextImagePath = useCustomImage
        ? (uploadedPath ?? project?.iconImagePath ?? null)
        : null
      const iconResult = await callRpc<unknown>("set_project_visual", {
        p_project_id: projectId,
        p_icon: data.icon ?? "folder-kanban",
        p_icon_image_path: nextImagePath,
      }, "Projeto atualizado, mas não foi possível salvar a identidade visual")
      if (iconResult === undefined) {
        if (uploadedPath) await removeProjectIconImage(uploadedPath)
        return false
      }

      if (project?.iconImagePath && project.iconImagePath !== nextImagePath) {
        await removeProjectIconImage(project.iconImagePath)
      }
      await refreshProjects()
      return true
    } catch (error) {
      if (uploadedPath) await removeProjectIconImage(uploadedPath)
      fail(error, "Não foi possível atualizar a imagem personalizada do projeto")
      return false
    }
  }, [callRpc, currentUserId, currentUserRole, fail, projects, refreshProjects, removeProjectIconImage, uploadProjectIconImage])

  const versionProject = React.useCallback(async (projectId: string, data: { version: string; build: string; allowPending?: boolean }) => {
    const project = projects.find((item) => item.id === projectId)
    const canEdit = currentUserRole === "admin" || Boolean(
      project && currentUserRole === "developer" && project.memberIds.includes(currentUserId),
    )
    if (!canEdit) {
      fail(new Error("Você precisa estar integrado ao projeto para versioná-lo."), "Sem permissão para versionar este projeto")
      return false
    }
    const result = await callRpc<unknown>("version_project", { p_project_id: projectId, p_version: data.version, p_build: data.build, p_allow_pending: data.allowPending ?? false }, "Não foi possível versionar o projeto")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, currentUserId, currentUserRole, fail, projects, refreshProjects])

  const addProjectComment = React.useCallback(async (projectId: string, content: string) => {
    const result = await callRpc<string>("add_project_comment", { p_project_id: projectId, p_content: content }, "Não foi possível salvar o comentário")
    if (!result) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const addSubactivityComment = React.useCallback(async (subId: string, content: string) => {
    const result = await callRpc<string>("add_subactivity_comment", { p_subactivity_id: subId, p_content: content }, "Não foi possível salvar o comentário")
    if (!result) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const addFollowUpComment = React.useCallback(async (subId: string, content: string, mentions: ChatMention[] = [], replyToCommentId?: string) => {
    try {
      const { data, error } = await supabase.rpc("add_followup_comment", {
        p_subactivity_id: subId,
        p_content: content,
        p_mentions: mentions,
        p_reply_to_comment_id: replyToCommentId ?? null,
      })
      if (error) throw error
      if (!data) throw new Error("O servidor não confirmou o envio da mensagem.")
      await refreshProjects()
      return true
    } catch (error) {
      // O acompanhamento usa entrega otimista. Falhas aparecem no próprio item
      // da timeline, então não devemos abrir o banner global de sincronização.
      console.error("[Devboard/Acompanhamento] Falha ao entregar mensagem", error)
      return false
    }
  }, [refreshProjects, supabase])

  const deleteFollowUpComment = React.useCallback(async (commentId: string) => {
    const result = await callRpc<boolean>("delete_followup_comment", { p_comment_id: commentId }, "Não foi possível excluir a mensagem")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const deleteFollowUpAttachment = React.useCallback(async (attachmentId: string, storagePath?: string) => {
    const result = await callRpc<boolean>("delete_followup_attachment", { p_attachment_id: attachmentId }, "Não foi possível excluir o anexo")
    if (result === undefined) return false
    if (storagePath) {
      const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).remove([storagePath])
      if (error) console.warn("Não foi possível remover o objeto do Storage após excluir o anexo:", error.message)
    }
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects, supabase])

  const removeFollowUpMember = React.useCallback(async (subId: string, userId: string) => {
    const result = await callRpc<boolean>("remove_followup_subactivity_member", {
      p_subactivity_id: subId,
      p_user_id: userId,
    }, "Não foi possível remover o usuário do acompanhamento")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const uploadAttachments = React.useCallback(async (
    target: { projectId: string; subactivityId?: string },
    files: AttachmentUploadInput[],
    options?: { silent?: boolean },
  ) => {
    if (!workspaceId || files.length === 0) return false
    try {
      setLastError(null)
      for (const file of files) {
        let storagePath: string | null = null
        if (file.file || file.dataUrl) {
          const blob = file.file ?? dataUrlToBlob(file.dataUrl!)
          storagePath = attachmentStoragePath(workspaceId, target.projectId, currentUserId, file)
          const { error: uploadError } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(storagePath, blob, {
            contentType: file.mimeType || blob.type || "application/octet-stream",
            cacheControl: "3600",
            upsert: false,
          })
          if (uploadError) throw uploadError
        }

        const { error: metadataError } = await supabase.rpc("add_attachment", {
          p_project_id: target.subactivityId ? null : target.projectId,
          p_subactivity_id: target.subactivityId ?? null,
          p_name: file.name,
          p_mime_type: file.mimeType,
          p_size_bytes: file.size,
          p_kind: file.kind,
          p_storage_path: storagePath,
          p_text_content: file.textContent ?? null,
        })
        if (metadataError) {
          if (storagePath) await supabase.storage.from(ATTACHMENTS_BUCKET).remove([storagePath])
          throw metadataError
        }
      }
      await refreshProjects()
      return true
    } catch (error) {
      if (options?.silent) {
        console.error("[Devboard/Acompanhamento] Falha ao entregar anexo", error)
      } else {
        fail(error, "Não foi possível enviar o anexo")
      }
      return false
    }
  }, [currentUserId, fail, refreshProjects, supabase, workspaceId])

  const addProjectAttachments = React.useCallback((projectId: string, files: AttachmentUploadInput[]) => uploadAttachments({ projectId }, files), [uploadAttachments])

  const addSubactivityAttachments = React.useCallback(async (subId: string, files: AttachmentUploadInput[]) => {
    const found = findSubInProjects(projects, subId)
    if (!found) return false
    return uploadAttachments({ projectId: found.project.id, subactivityId: subId }, files)
  }, [projects, uploadAttachments])

  const addFollowUpAttachments = React.useCallback(async (subId: string, files: AttachmentUploadInput[]) => {
    const found = findSubInProjects(projects, subId)
    if (!found) return false
    return uploadAttachments({ projectId: found.project.id, subactivityId: subId }, files, { silent: true })
  }, [projects, uploadAttachments])

  const setAttachmentActive = React.useCallback(async (attachmentId: string, active: boolean) => {
    const result = await callRpc<unknown>("set_attachment_active", { p_attachment_id: attachmentId, p_active: active }, "Não foi possível alterar o anexo")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const setProjectAttachmentActive = React.useCallback(async (_projectId: string, attachmentId: string, active: boolean) => setAttachmentActive(attachmentId, active), [setAttachmentActive])
  const setSubactivityAttachmentActive = React.useCallback(async (_subId: string, attachmentId: string, active: boolean) => setAttachmentActive(attachmentId, active), [setAttachmentActive])

  const removeConversationMedia = React.useCallback(async (conversationId: string) => {
    const paths = new Set<string>()
    const pageSize = 500
    let from = 0

    while (true) {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("media_path")
        .eq("conversation_id", conversationId)
        .not("media_path", "is", null)
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) throw error

      const rows = data ?? []
      for (const row of rows) {
        if (typeof row.media_path === "string" && row.media_path.trim()) paths.add(row.media_path)
      }
      if (rows.length < pageSize) break
      from += pageSize
    }

    const allPaths = Array.from(paths)
    for (let index = 0; index < allPaths.length; index += 100) {
      const { error } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .remove(allPaths.slice(index, index + 100))
      if (error) throw error
    }
  }, [supabase])

  const loadChatHistory = React.useCallback(async (conversationId: string, beforeCreatedAt?: string) => {
    try {
      setLastError(null)
      const page = await loadChatMessagesPage(supabase, conversationId, { beforeCreatedAt, limit: 20 })
      loadedChatHistoryIdsRef.current.add(conversationId)
      setChatConversations((current) => current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation
        const incoming = beforeCreatedAt ? [...page.messages, ...conversation.messages] : page.messages
        const unique = mergeChatMessages(conversation.messages, incoming, Boolean(beforeCreatedAt))
        return { ...conversation, messages: unique }
      }))
      return { count: page.messages.length, hasMore: page.hasMore }
    } catch (error) {
      fail(error, "Não foi possível carregar o histórico da conversa")
      return null
    }
  }, [fail, supabase])

  const deleteDirectConversation = React.useCallback(async (conversationId: string) => {
    try {
      setLastError(null)
      // Conversa individual é removida somente da lista do usuário atual.
      // O backend preserva mensagens/mídias e mantém o chat visível para o outro participante.
      const result = await callRpc<unknown>("delete_direct_conversation", { p_conversation_id: conversationId }, "Não foi possível remover a conversa")
      if (result === undefined) return false
      loadedChatHistoryIdsRef.current.delete(conversationId)
      await refreshChat()
      return true
    } catch (error) {
      fail(error, "Não foi possível remover a conversa da sua lista")
      return false
    }
  }, [callRpc, fail, refreshChat])

  const leaveChatGroup = React.useCallback(async (conversationId: string) => {
    const result = await callRpc<unknown>("leave_chat_group", { p_conversation_id: conversationId }, "Não foi possível sair do grupo")
    if (result === undefined) return false
    loadedChatHistoryIdsRef.current.delete(conversationId)
    await refreshChat()
    return true
  }, [callRpc, refreshChat])

  const ensureDirectConversation = React.useCallback(async (memberId: string) => {
    const id = await callRpc<string>("ensure_direct_conversation", { p_member_id: memberId }, "Não foi possível iniciar a conversa")
    if (!id) return null
    await refreshChat()
    return id
  }, [callRpc, refreshChat])

  const deliverChatMessage = React.useCallback(async (conversationId: string, localId: string, content: string, mentions: ChatMention[], replyTo?: ChatReplyReference) => {
    if (chatMessageDeliveriesRef.current.has(localId)) return false
    chatMessageDeliveriesRef.current.add(localId)

    try {
      const payload = replyTo?.messageId
        ? {
            p_conversation_id: conversationId,
            p_content: content,
            p_mentions: mentions,
            p_reply_to_message_id: replyTo.messageId,
          }
        : {
            p_conversation_id: conversationId,
            p_content: content,
            p_mentions: mentions,
          }
      const { data, error } = await supabase.rpc("send_chat_message", payload)
      if (error) throw error
      const serverId = typeof data === "string" && data ? data : null
      if (!serverId) throw new Error("O servidor não confirmou o envio da mensagem.")

      setChatConversations((current) => current.map((conversation) => {
        if (conversation.id !== conversationId) return conversation
        const localMessage = conversation.messages.find((message) => message.id === localId)
        if (!localMessage) return conversation

        // Se o Realtime já trouxe a mensagem definitiva, apenas remove a cópia local.
        if (conversation.messages.some((message) => message.id === serverId)) {
          return { ...conversation, messages: conversation.messages.filter((message) => message.id !== localId) }
        }

        return {
          ...conversation,
          messages: conversation.messages.map((message) => message.id === localId
            ? { ...message, id: serverId, deliveryStatus: undefined }
            : message),
        }
      }))
      return true
    } catch (error) {
      // Erro de envio de chat é mostrado na própria mensagem, evitando snackbar/global error
      // e permitindo retry sem perder o texto digitado.
      console.error("[Devboard/Chat] Falha ao entregar mensagem", error)
      setChatConversations((current) => current.map((conversation) => conversation.id === conversationId
        ? {
            ...conversation,
            messages: conversation.messages.map((message) => message.id === localId
              ? { ...message, deliveryStatus: "failed" as const }
              : message),
          }
        : conversation))
      return false
    } finally {
      chatMessageDeliveriesRef.current.delete(localId)
    }
  }, [supabase])

  const sendChatMessage = React.useCallback((conversationId: string, content: string, mentions: ChatMention[] = [], replyTo?: ChatReplyReference) => {
    const text = content.trim()
    if (!text || !currentUserId) return Promise.resolve(false)

    const createdAt = new Date().toISOString()
    const localId = optimisticMessageId()
    const optimistic: ChatMessage = {
      id: localId,
      senderId: currentUserId,
      content: text,
      type: "text",
      mentions,
      replyTo,
      deliveryStatus: "sending",
      createdAt,
    }

    // Primeiro injeta a mensagem localmente. O acesso ao Supabase começa somente
    // no próximo ciclo do event loop, deixando o React liberar o composer e
    // renderizar a mensagem otimista antes de qualquer latência de rede.
    setChatConversations((current) => current.map((conversation) => conversation.id === conversationId
      ? { ...conversation, updatedAt: createdAt, messages: [...conversation.messages, optimistic] }
      : conversation))

    return new Promise<boolean>((resolve) => {
      const startDelivery = () => {
        void deliverChatMessage(conversationId, localId, text, mentions, replyTo).then(resolve)
      }

      if (typeof window === "undefined") {
        startDelivery()
        return
      }

      window.setTimeout(startDelivery, 0)
    })
  }, [currentUserId, deliverChatMessage])

  const retryChatMessage = React.useCallback((conversationId: string, messageId: string) => {
    const conversation = chatConversations.find((item) => item.id === conversationId)
    const message = conversation?.messages.find((item) => item.id === messageId)
    if (!message || message.deliveryStatus !== "failed" || message.type === "audio" || message.type === "media") {
      return Promise.resolve(false)
    }

    setChatConversations((current) => current.map((item) => item.id === conversationId
      ? {
          ...item,
          messages: item.messages.map((entry) => entry.id === messageId
            ? { ...entry, deliveryStatus: "sending" as const }
            : entry),
        }
      : item))

    return deliverChatMessage(conversationId, messageId, message.content, message.mentions ?? [], message.replyTo)
  }, [chatConversations, deliverChatMessage])

  const sendChatAudio = React.useCallback(async (conversationId: string, audio: Blob, durationMs: number) => {
    if (!workspaceId || !currentUserId || !audio.size) return false
    const mimeType = (audio.type || "audio/webm").split(";", 1)[0] || "audio/webm"
    const storagePath = chatAudioStoragePath(workspaceId, conversationId, currentUserId, mimeType)
    try {
      setLastError(null)
      const { error: uploadError } = await supabase.storage
        .from(CHAT_MEDIA_BUCKET)
        .upload(storagePath, audio, { contentType: mimeType, upsert: false })
      if (uploadError) throw uploadError

      const id = await callRpc<string>("send_chat_audio_message", {
        p_conversation_id: conversationId,
        p_media_path: storagePath,
        p_mime_type: mimeType,
        p_duration_ms: Math.max(0, Math.round(durationMs)),
        p_size_bytes: audio.size,
      }, "Não foi possível enviar o áudio")

      if (!id) {
        await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([storagePath])
        return false
      }
      await refreshChat()
      return true
    } catch (error) {
      await supabase.storage.from(CHAT_MEDIA_BUCKET).remove([storagePath]).catch(() => undefined)
      fail(error, "Não foi possível enviar o áudio")
      return false
    }
  }, [callRpc, currentUserId, fail, refreshChat, supabase, workspaceId])

  const sendChatMedia = React.useCallback(async (conversationId: string, files: File[], caption = "") => {
    if (!workspaceId || !currentUserId || !files.length) return false
    const MAX_FILE_SIZE = 50 * 1024 * 1024
    const invalid = files.find((file) => !file.size || file.size > MAX_FILE_SIZE)
    if (invalid) {
      fail(new Error(`“${invalid.name}” excede o limite de 50 MB ou está vazio.`), "Arquivo inválido")
      return false
    }

    const uploaded: string[] = []
    const registered = new Set<string>()
    try {
      setLastError(null)
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]
        const mimeType = (file.type || "application/octet-stream").split(";", 1)[0] || "application/octet-stream"
        const storagePath = chatMediaStoragePath(workspaceId, conversationId, currentUserId, file.name)
        const { error: uploadError } = await supabase.storage
          .from(CHAT_MEDIA_BUCKET)
          .upload(storagePath, file, { contentType: mimeType, upsert: false })
        if (uploadError) throw uploadError
        uploaded.push(storagePath)

        const id = await callRpc<string>("send_chat_media_message", {
          p_conversation_id: conversationId,
          p_media_path: storagePath,
          p_file_name: file.name,
          p_mime_type: mimeType,
          p_size_bytes: file.size,
          p_media_kind: chatMediaKind(file),
          p_caption: index === 0 ? caption.trim() || null : null,
        }, "Não foi possível enviar o arquivo")
        if (!id) throw new Error(`Não foi possível registrar “${file.name}” no chat.`)
        registered.add(storagePath)
      }
      await refreshChat()
      return true
    } catch (error) {
      const rollback = uploaded.filter((path) => !registered.has(path))
      if (rollback.length) await supabase.storage.from(CHAT_MEDIA_BUCKET).remove(rollback).catch(() => undefined)
      fail(error, "Não foi possível enviar os arquivos")
      await refreshChat().catch(() => undefined)
      return false
    }
  }, [callRpc, currentUserId, fail, refreshChat, supabase, workspaceId])

  const createChatGroup = React.useCallback(async (name: string, memberIds: string[]) => {
    const id = await callRpc<string>("create_chat_group", { p_name: name, p_member_ids: memberIds }, "Não foi possível criar o grupo")
    if (!id) return null
    await refreshChat()
    return id
  }, [callRpc, refreshChat])

  const updateChatGroup = React.useCallback(async (conversationId: string, data: { name: string; memberIds: string[] }) => {
    const result = await callRpc<unknown>("update_chat_group", { p_conversation_id: conversationId, p_name: data.name, p_member_ids: data.memberIds }, "Não foi possível atualizar o grupo")
    if (result === undefined) return false
    await refreshChat()
    return true
  }, [callRpc, refreshChat])

  const deleteChatGroup = React.useCallback(async (conversationId: string) => {
    try {
      setLastError(null)
      await removeConversationMedia(conversationId)
      const result = await callRpc<unknown>("delete_chat_group", { p_conversation_id: conversationId }, "Não foi possível excluir o grupo")
      if (result === undefined) return false
      loadedChatHistoryIdsRef.current.delete(conversationId)
      await refreshChat()
      return true
    } catch (error) {
      fail(error, "Não foi possível remover as mídias do grupo")
      return false
    }
  }, [callRpc, fail, refreshChat, removeConversationMedia])

  const createMeeting = React.useCallback(async (data: { title: string; memberIds: string[]; mode: MeetingMode; conversationId?: string }) => {
    const id = await callRpc<string>("create_meeting", {
      p_title: data.title,
      p_member_ids: data.memberIds,
      p_mode: data.mode,
      p_conversation_id: data.conversationId ?? null,
    }, "Não foi possível criar a reunião")
    if (!id) return null
    await refreshMeetings()
    return id
  }, [callRpc, refreshMeetings])

  const endMeeting = React.useCallback(async (meetingId: string) => {
    const result = await callRpc<unknown>("end_meeting", { p_meeting_id: meetingId }, "Não foi possível encerrar a reunião")
    if (result === undefined) return false
    await refreshMeetings()
    return true
  }, [callRpc, refreshMeetings])

  const answerMeetingInvite = React.useCallback(async (meetingId: string, accept: boolean) => {
    const result = await callRpc<string>("answer_meeting_invite", {
      p_meeting_id: meetingId,
      p_accept: accept,
    }, accept ? "Não foi possível atender a chamada" : "Não foi possível recusar a chamada")
    if (!result) return false
    await Promise.all([refreshMeetings(), refreshNotifications()])
    return true
  }, [callRpc, refreshMeetings, refreshNotifications])

  const joinMeeting = React.useCallback(async (meetingId: string) => {
    const result = await callRpc<unknown>("join_meeting", { p_meeting_id: meetingId }, "Não foi possível entrar na reunião")
    if (result === undefined) return false
    await Promise.all([refreshMeetings(), refreshNotifications()])
    return true
  }, [callRpc, refreshMeetings, refreshNotifications])

  const leaveMeeting = React.useCallback(async (meetingId: string) => {
    const result = await callRpc<boolean>("leave_meeting", { p_meeting_id: meetingId }, "Não foi possível sair da reunião")
    if (result === undefined) return false
    await refreshMeetings()
    return true
  }, [callRpc, refreshMeetings])

  const heartbeatMeeting = React.useCallback(async (meetingId: string) => {
    const { error } = await supabase.rpc("heartbeat_meeting", { p_meeting_id: meetingId })
    if (error) {
      console.warn("[Devboard/Meeting] Falha no heartbeat da reunião", error)
      return false
    }
    return true
  }, [supabase])

  const markNotificationRead = React.useCallback(async (notificationId: string) => {
    const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId).eq("recipient_id", currentUserId)
    if (error) fail(error, "Não foi possível marcar a notificação como lida")
    else setNotifications((prev) => prev.map((item) => item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item))
  }, [currentUserId, fail, supabase])

  const markAllNotificationsRead = React.useCallback(async () => {
    const now = new Date().toISOString()
    const { error } = await supabase.from("notifications").update({ read_at: now }).eq("recipient_id", currentUserId).is("read_at", null)
    if (error) fail(error, "Não foi possível marcar as notificações como lidas")
    else setNotifications((prev) => prev.map((item) => item.recipientId === currentUserId && !item.readAt ? { ...item, readAt: now } : item))
  }, [currentUserId, fail, supabase])

  const updateMyProfile = React.useCallback(async ({
    name,
    avatarFile,
    avatarColor,
    removeAvatar = false,
  }: {
    name: string
    avatarFile?: File | null
    avatarColor?: string
    removeAvatar?: boolean
  }) => {
    let uploadedAvatarPath: string | null = null
    const previousAvatarPath = members.find((member) => member.id === currentUserId)?.avatarPath

    try {
      const trimmedName = name.trim()
      const normalizedColor = avatarColor?.trim().toUpperCase()
      const { error: authError } = await supabase.auth.updateUser({ data: { full_name: trimmedName } })
      if (authError) throw authError

      if (avatarFile) {
        const path = `${currentUserId}/avatar-${Date.now()}-${safeFileName(avatarFile.name)}`
        const { error: uploadError } = await supabase.storage.from(AVATARS_BUCKET).upload(path, avatarFile, {
          contentType: avatarFile.type || "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        })
        if (uploadError) throw uploadError
        uploadedAvatarPath = path
      }

      const { error } = await supabase.rpc("update_my_profile", {
        p_name: trimmedName,
        p_avatar_path: uploadedAvatarPath,
        p_color: normalizedColor || null,
        p_remove_avatar: Boolean(removeAvatar && !uploadedAvatarPath),
      })
      if (error) throw error

      const shouldDeletePreviousAvatar = Boolean(
        previousAvatarPath &&
        (removeAvatar || (uploadedAvatarPath && uploadedAvatarPath !== previousAvatarPath)),
      )
      if (shouldDeletePreviousAvatar && previousAvatarPath) {
        const { error: cleanupError } = await supabase.storage.from(AVATARS_BUCKET).remove([previousAvatarPath])
        if (cleanupError) {
          console.warn("[Devboard/Profile] Perfil atualizado, mas a foto anterior não pôde ser removida do Storage.", cleanupError)
        }
      }

      await refreshMembers()
      return true
    } catch (error) {
      // Se o upload novo ocorreu mas a atualização do perfil falhou, removemos o
      // arquivo recém-criado para não deixar mídia órfã no bucket de avatares.
      if (uploadedAvatarPath) {
        const { error: cleanupError } = await supabase.storage.from(AVATARS_BUCKET).remove([uploadedAvatarPath])
        if (cleanupError) {
          console.warn("[Devboard/Profile] Não foi possível limpar o avatar enviado após falha no perfil.", cleanupError)
        }
      }
      fail(error, "Não foi possível atualizar seu perfil")
      return false
    }
  }, [currentUserId, fail, members, refreshMembers, supabase])

  const updatePreferences = React.useCallback(async (next: UserPreferences) => {
    const result = await callRpc<unknown>("update_my_preferences", {
      p_notify_assignments: next.notifyAssignments,
      p_notify_comments: next.notifyComments,
      p_notify_team_activity: next.notifyTeamActivity,
      p_notify_deadlines: next.notifyDeadlines,
      p_timer_sticky: next.timerSticky,
      p_reduced_motion: next.reducedMotion,
      p_density: next.density,
    }, "Não foi possível salvar suas preferências")
    if (result === undefined) return false
    setPreferences(next)
    return true
  }, [callRpc])

  const setMemberRole = React.useCallback(async (memberId: string, role: AccessRole) => {
    const result = await callRpc<unknown>("set_workspace_member_role", { p_user_id: memberId, p_role: role }, "Não foi possível alterar a permissão")
    if (result === undefined) return false
    await refreshMembers()
    return true
  }, [callRpc, refreshMembers])

  const startAqsReview = React.useCallback(async (reviewId: string) => {
    const result = await callRpc<unknown>("start_aqs_review", { p_review_id: reviewId }, "Não foi possível iniciar a análise AQS")
    if (result === undefined) return false
    await Promise.all([refreshAqsReviews(), refreshProjects()])
    return true
  }, [callRpc, refreshAqsReviews, refreshProjects])

  const completeAqsReview = React.useCallback(async (reviewId: string) => {
    const result = await callRpc<unknown>("complete_aqs_review", { p_review_id: reviewId }, "Não foi possível concluir a análise AQS")
    if (result === undefined) return false
    await Promise.all([refreshAqsReviews(), refreshProjects(), refreshNotifications()])
    return true
  }, [callRpc, refreshAqsReviews, refreshNotifications, refreshProjects])

  const revokeAqsReview = React.useCallback(async (reviewId: string, reason: string) => {
    const result = await callRpc<unknown>("revoke_aqs_review", { p_review_id: reviewId, p_reason: reason }, "Não foi possível revogar a análise AQS")
    if (result === undefined) return false
    await Promise.all([refreshAqsReviews(), refreshProjects(), refreshNotifications()])
    return true
  }, [callRpc, refreshAqsReviews, refreshNotifications, refreshProjects])

  const addSupportTopicAttachments = React.useCallback(async (topicId: string, files: File[]) => {
    if (!workspaceId || files.length === 0) return false
    const uploaded: string[] = []
    const registered = new Set<string>()
    try {
      for (const file of files) {
        const path = topicMediaStoragePath(workspaceId, topicId, currentUserId, file.name)
        const mimeType = file.type || "application/octet-stream"
        const { error: uploadError } = await supabase.storage.from(TOPIC_MEDIA_BUCKET).upload(path, file, {
          contentType: mimeType,
          upsert: false,
        })
        if (uploadError) throw uploadError
        uploaded.push(path)

        const id = await callRpc<string>("add_topic_attachment", {
          p_topic_id: topicId,
          p_name: file.name,
          p_mime_type: mimeType,
          p_size_bytes: file.size,
          p_kind: chatMediaKind(file),
          p_storage_path: path,
        }, "Não foi possível registrar o anexo do tópico")
        if (!id) throw new Error(`Não foi possível registrar “${file.name}”.`)
        registered.add(path)
      }
      await refreshSupportTopics()
      return true
    } catch (error) {
      const rollback = uploaded.filter((path) => !registered.has(path))
      if (rollback.length) await supabase.storage.from(TOPIC_MEDIA_BUCKET).remove(rollback).catch(() => undefined)
      fail(error, "Não foi possível enviar as mídias do tópico")
      return false
    }
  }, [callRpc, currentUserId, fail, refreshSupportTopics, supabase, workspaceId])

  const createSupportTopic = React.useCallback(async (data: SupportTopicInput) => {
    const id = await callRpc<string>("create_support_topic", {
      p_order_number: data.orderNumber,
      p_title: data.title,
      p_description: data.description,
    }, "Não foi possível abrir o tópico")
    if (!id) return null
    if (data.files.length) await addSupportTopicAttachments(id, data.files)
    await Promise.all([refreshSupportTopics(), refreshNotifications()])
    return id
  }, [addSupportTopicAttachments, callRpc, refreshNotifications, refreshSupportTopics])

  const startSupportTopicAnalysis = React.useCallback(async (topicId: string) => {
    const result = await callRpc<unknown>("start_topic_analysis", { p_topic_id: topicId }, "Não foi possível iniciar a análise do tópico")
    if (result === undefined) return false
    await Promise.all([refreshSupportTopics(), refreshNotifications()])
    return true
  }, [callRpc, refreshNotifications, refreshSupportTopics])

  const revokeSupportTopic = React.useCallback(async (topicId: string, reason: string) => {
    const result = await callRpc<unknown>("revoke_support_topic", { p_topic_id: topicId, p_reason: reason }, "Não foi possível revogar o tópico")
    if (result === undefined) return false
    await Promise.all([refreshSupportTopics(), refreshNotifications()])
    return true
  }, [callRpc, refreshNotifications, refreshSupportTopics])

  const sendSupportTopicToActivity = React.useCallback(async (topicId: string, projectId: string, developerId?: string) => {
    const topic = supportTopics.find((item) => item.id === topicId)
    const canSend = currentUserRole === "admin" || (currentUserRole === "aqs" && topic?.status === "analyzing" && topic.assignedAnalystId === currentUserId)
    if (!canSend) {
      fail(new Error("Apenas o administrador ou o analista AQS responsável pela análise podem encaminhar tópicos para desenvolvimento."), "Sem permissão para encaminhar")
      return null
    }
    const activityId = await callRpc<string>("send_topic_to_activity", {
      p_topic_id: topicId,
      p_project_id: projectId,
      p_developer_id: developerId || null,
    }, "Não foi possível enviar o tópico para desenvolvimento")
    if (!activityId) return null
    await Promise.all([refreshSupportTopics(), refreshProjects(), refreshNotifications()])
    return activityId
  }, [callRpc, currentUserId, currentUserRole, fail, refreshNotifications, refreshProjects, refreshSupportTopics, supportTopics])

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut()
    window.location.assign("/login")
  }, [supabase])

  const value = React.useMemo<StoreContextValue>(() => ({
    projects,
    members,
    memberPresence,
    presenceReady,
    chatConversations,
    chatMeetings,
    notifications,
    aqsReviews,
    supportTopics,
    preferences,
    workSessions,
    workspaceId,
    currentUserId,
    currentUserRole,
    runningSubIds,
    activeSubId,
    hydrated,
    chatHydrated,
    refreshing,
    lastError,
    clearError: () => setLastError(null),
    refreshAll,
    signOut,
    updateMyProfile,
    setMemberRole,
    startAqsReview,
    completeAqsReview,
    revokeAqsReview,
    createSupportTopic,
    addSupportTopicAttachments,
    startSupportTopicAnalysis,
    revokeSupportTopic,
    sendSupportTopicToActivity,
    updatePreferences,
    canManageSubactivity,
    startTimer,
    stopTimer,
    setSubStatus,
    addSubactivity,
    addActivity,
    deleteActivity,
    addProject,
    updateProject,
    versionProject,
    addProjectComment,
    addSubactivityComment,
    addFollowUpComment,
    addFollowUpAttachments,
    deleteFollowUpComment,
    deleteFollowUpAttachment,
    removeFollowUpMember,
    addProjectAttachments,
    setProjectAttachmentActive,
    addSubactivityAttachments,
    setSubactivityAttachmentActive,
    ensureDirectConversation,
    sendChatMessage,
    retryChatMessage,
    sendChatAudio,
    sendChatMedia,
    loadChatHistory,
    deleteDirectConversation,
    leaveChatGroup,
    createChatGroup,
    updateChatGroup,
    deleteChatGroup,
    createMeeting,
    endMeeting,
    answerMeetingInvite,
    joinMeeting,
    leaveMeeting,
    heartbeatMeeting,
    markNotificationRead,
    markAllNotificationsRead,
    findSub: (subId: string) => findSubInProjects(projects, subId),
  }), [
    activeSubId, addActivity, addProject, addProjectAttachments, addProjectComment, addSubactivity,
    addSubactivityAttachments, addSubactivityComment, addFollowUpComment, addFollowUpAttachments, deleteFollowUpComment, deleteFollowUpAttachment, removeFollowUpMember, canManageSubactivity, chatConversations, chatMeetings,
    answerMeetingInvite, createChatGroup, createMeeting, currentUserId, currentUserRole, deleteActivity, deleteChatGroup,
    endMeeting, ensureDirectConversation, heartbeatMeeting, hydrated, chatHydrated, joinMeeting, lastError, leaveMeeting, loadChatHistory, deleteDirectConversation, leaveChatGroup,
    markAllNotificationsRead, markNotificationRead,
    memberPresence, presenceReady, members, notifications, aqsReviews, supportTopics, preferences, projects, refreshAll, refreshing, runningSubIds, retryChatMessage, sendChatAudio, sendChatMedia, sendChatMessage, setMemberRole,
    setProjectAttachmentActive, setSubStatus, setSubactivityAttachmentActive, signOut, startTimer, stopTimer, startAqsReview, completeAqsReview, revokeAqsReview, createSupportTopic, addSupportTopicAttachments, startSupportTopicAnalysis, revokeSupportTopic, sendSupportTopicToActivity,
    updateChatGroup, updateMyProfile, updatePreferences, updateProject, versionProject, workSessions, workspaceId,
  ])

  return (
    <StoreContext.Provider value={value}>
      {children}
      <TimerStartConflictDialog
        conflict={timerConflict}
        loading={timerConflictLoading}
        onCancel={cancelTimerConflict}
        onConfirm={() => { void confirmTimerConflict() }}
      />
    </StoreContext.Provider>
  )
}

export function useStore() {
  const context = React.useContext(StoreContext)
  if (!context) throw new Error("useStore must be used inside StoreProvider")
  return context
}
