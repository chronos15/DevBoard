"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import {
  DEFAULT_PREFERENCES,
  loadIdentity,
  loadChatConversations,
  loadMeetings,
  loadMembers,
  loadNotifications,
  loadProjects,
  loadPreferences,
  loadWorkSessions,
} from "@/lib/supabase/data"
import {
  ATTACHMENTS_BUCKET,
  AVATARS_BUCKET,
  CHAT_MEDIA_BUCKET,
  chatAudioStoragePath,
  attachmentStoragePath,
  dataUrlToBlob,
  safeFileName,
} from "@/lib/supabase/helpers"
import type {
  AccessRole,
  AttachmentUploadInput,
  ChatConversation,
  ChatMeeting,
  MeetingMode,
  Member,
  NotificationEntry,
  Project,
  ProjectInput,
  Status,
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

export type StoreContextValue = {
  projects: Project[]
  members: Member[]
  chatConversations: ChatConversation[]
  chatMeetings: ChatMeeting[]
  notifications: NotificationEntry[]
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
  updateMyProfile: (data: { name: string; avatarFile?: File | null }) => Promise<boolean>
  setMemberRole: (memberId: string, role: AccessRole) => Promise<boolean>
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
  addProject: (data: ProjectInput) => Promise<string | null>
  updateProject: (projectId: string, data: ProjectInput) => Promise<boolean>
  versionProject: (projectId: string, data: { version: string; build: string; allowPending?: boolean }) => Promise<boolean>
  addProjectComment: (projectId: string, content: string) => Promise<boolean>
  addSubactivityComment: (subId: string, content: string) => Promise<boolean>
  addProjectAttachments: (projectId: string, files: AttachmentUploadInput[]) => Promise<boolean>
  setProjectAttachmentActive: (projectId: string, attachmentId: string, active: boolean) => Promise<boolean>
  addSubactivityAttachments: (subId: string, files: AttachmentUploadInput[]) => Promise<boolean>
  setSubactivityAttachmentActive: (subId: string, attachmentId: string, active: boolean) => Promise<boolean>
  ensureDirectConversation: (memberId: string) => Promise<string | null>
  sendChatMessage: (conversationId: string, content: string) => Promise<boolean>
  sendChatAudio: (conversationId: string, audio: Blob, durationMs: number) => Promise<boolean>
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

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const supabase = React.useMemo(() => createClient(), [])
  const [workspaceId, setWorkspaceId] = React.useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = React.useState("")
  const [currentUserRole, setCurrentUserRole] = React.useState<AccessRole>("member")
  const [members, setMembers] = React.useState<Member[]>([])
  const [projects, setProjects] = React.useState<Project[]>([])
  const [chatConversations, setChatConversations] = React.useState<ChatConversation[]>([])
  const [chatMeetings, setChatMeetings] = React.useState<ChatMeeting[]>([])
  const [notifications, setNotifications] = React.useState<NotificationEntry[]>([])
  const [preferences, setPreferences] = React.useState<UserPreferences>(DEFAULT_PREFERENCES)
  const [workSessions, setWorkSessions] = React.useState<WorkSession[]>([])
  const [hydrated, setHydrated] = React.useState(false)
  const [chatHydrated, setChatHydrated] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [lastError, setLastError] = React.useState<string | null>(null)
  const refreshTimers = React.useRef<Record<string, number>>({})

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
      setChatConversations(await loadChatConversations(supabase, workspaceId))
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
      const [nextMembers, nextProjects, nextNotifications, nextPreferences, nextWorkSessions] = await Promise.all([
        loadMembers(supabase, identity.workspaceId),
        loadProjects(supabase, identity.workspaceId),
        loadNotifications(supabase, identity.user.id),
        loadPreferences(supabase, identity.user.id),
        loadWorkSessions(supabase),
      ])

      setMembers(nextMembers)
      setProjects(nextProjects)
      setNotifications(nextNotifications)
      setPreferences(nextPreferences)
      setWorkSessions(nextWorkSessions)
      setLastError(null)
      setHydrated(true)
      setRefreshing(false)

      void Promise.all([
        loadChatConversations(supabase, identity.workspaceId),
        loadMeetings(supabase, identity.workspaceId),
      ])
        .then(([nextChat, nextMeetings]) => {
          setChatConversations(nextChat)
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
  }, [currentUserId, refreshChat, refreshMeetings, refreshMembers, refreshNotifications, refreshPreferences, refreshProjects, refreshWorkSessions, schedule, supabase, workspaceId])

  React.useEffect(() => {
    if (typeof document === "undefined") return
    document.documentElement.dataset.density = preferences.density
    document.documentElement.dataset.reducedMotion = preferences.reducedMotion ? "true" : "false"
  }, [preferences.density, preferences.reducedMotion])

  const runningSubIds = React.useMemo(
    () => projects.flatMap((project) => project.activities.flatMap((activity) => activity.subactivities.filter((sub) => sub.status === "in-progress").map((sub) => sub.id))),
    [projects],
  )

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
    const interval = window.setInterval(() => {
      setProjects((prev) => prev.map((project) => ({
        ...project,
        activities: project.activities.map((activity) => ({
          ...activity,
          subactivities: activity.subactivities.map((sub) => sub.status === "in-progress" ? { ...sub, trackedSeconds: sub.trackedSeconds + 1 } : sub),
        })),
      })))
    }, 1000)
    return () => window.clearInterval(interval)
  }, [hydrated, runningSubIds.length])

  const canManageSubactivity = React.useCallback((sub: Subactivity) => {
    const terminal = sub.status === "done" || sub.status === "cancelled"
    if (terminal && currentUserRole !== "admin") return false
    return currentUserRole === "admin" || sub.assigneeId === currentUserId
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

  const startTimer = React.useCallback(async (subId: string) => {
    const target = findSubInProjects(projects, subId)?.sub
    if (!target || !canManageSubactivity(target)) return false

    const rollback = captureOptimisticSubs(projects, subId, "in-progress")
    setProjects((current) => optimisticSubStatus(current, subId, "in-progress"))
    const result = await callRpc<unknown>("start_subactivity", { p_subactivity_id: subId }, "Não foi possível iniciar a subatividade")
    if (result === undefined) {
      setProjects((current) => restoreOptimisticSubs(current, rollback))
      return false
    }

    schedule("sessions-after-start", refreshWorkSessions)
    return true
  }, [callRpc, canManageSubactivity, projects, refreshWorkSessions, schedule])

  const stopTimer = React.useCallback(async (subId?: string) => {
    const targetId = subId ?? activeSubId
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
    const rollback = captureOptimisticSubs(projects, subId, status)
    setProjects((current) => optimisticSubStatus(current, subId, status))

    const result = await callRpc<unknown>("set_subactivity_status", { p_subactivity_id: subId, p_status: status }, "Não foi possível alterar o status")
    if (result === undefined) {
      setProjects((current) => restoreOptimisticSubs(current, rollback))
      return false
    }

    schedule("sessions-after-status", refreshWorkSessions)
    return true
  }, [callRpc, projects, refreshWorkSessions, schedule])

  const addSubactivity = React.useCallback<StoreContextValue["addSubactivity"]>(async (projectId, activityId, data) => {
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
  }, [callRpc, refreshNotifications, refreshProjects, refreshWorkSessions])

  const addActivity = React.useCallback(async (projectId: string, title: string, assigneeIds: string[] = []) => {
    const result = await callRpc<string>("add_activity", { p_project_id: projectId, p_title: title, p_assignee_ids: assigneeIds }, "Não foi possível adicionar a atividade")
    if (!result) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const deleteActivity = React.useCallback(async (_projectId: string, activityId: string) => {
    const result = await callRpc<unknown>("delete_activity", { p_activity_id: activityId }, "Não foi possível excluir a atividade")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const addProject = React.useCallback(async (data: ProjectInput) => {
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
    await refreshProjects()
    return result
  }, [callRpc, refreshProjects])

  const updateProject = React.useCallback(async (projectId: string, data: ProjectInput) => {
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
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const versionProject = React.useCallback(async (projectId: string, data: { version: string; build: string; allowPending?: boolean }) => {
    const result = await callRpc<unknown>("version_project", { p_project_id: projectId, p_version: data.version, p_build: data.build, p_allow_pending: data.allowPending ?? false }, "Não foi possível versionar o projeto")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

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

  const uploadAttachments = React.useCallback(async (
    target: { projectId: string; subactivityId?: string },
    files: AttachmentUploadInput[],
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
      fail(error, "Não foi possível enviar o anexo")
      return false
    }
  }, [currentUserId, fail, refreshProjects, supabase, workspaceId])

  const addProjectAttachments = React.useCallback((projectId: string, files: AttachmentUploadInput[]) => uploadAttachments({ projectId }, files), [uploadAttachments])

  const addSubactivityAttachments = React.useCallback(async (subId: string, files: AttachmentUploadInput[]) => {
    const found = findSubInProjects(projects, subId)
    if (!found) return false
    return uploadAttachments({ projectId: found.project.id, subactivityId: subId }, files)
  }, [projects, uploadAttachments])

  const setAttachmentActive = React.useCallback(async (attachmentId: string, active: boolean) => {
    const result = await callRpc<unknown>("set_attachment_active", { p_attachment_id: attachmentId, p_active: active }, "Não foi possível alterar o anexo")
    if (result === undefined) return false
    await refreshProjects()
    return true
  }, [callRpc, refreshProjects])

  const setProjectAttachmentActive = React.useCallback(async (_projectId: string, attachmentId: string, active: boolean) => setAttachmentActive(attachmentId, active), [setAttachmentActive])
  const setSubactivityAttachmentActive = React.useCallback(async (_subId: string, attachmentId: string, active: boolean) => setAttachmentActive(attachmentId, active), [setAttachmentActive])

  const ensureDirectConversation = React.useCallback(async (memberId: string) => {
    const id = await callRpc<string>("ensure_direct_conversation", { p_member_id: memberId }, "Não foi possível iniciar a conversa")
    if (!id) return null
    await refreshChat()
    return id
  }, [callRpc, refreshChat])

  const sendChatMessage = React.useCallback(async (conversationId: string, content: string) => {
    const id = await callRpc<string>("send_chat_message", { p_conversation_id: conversationId, p_content: content }, "Não foi possível enviar a mensagem")
    if (!id) return false
    await refreshChat()
    return true
  }, [callRpc, refreshChat])

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
    const result = await callRpc<unknown>("delete_chat_group", { p_conversation_id: conversationId }, "Não foi possível excluir o grupo")
    if (result === undefined) return false
    await refreshChat()
    return true
  }, [callRpc, refreshChat])

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

  const updateMyProfile = React.useCallback(async ({ name, avatarFile }: { name: string; avatarFile?: File | null }) => {
    try {
      const { error: authError } = await supabase.auth.updateUser({ data: { full_name: name.trim() } })
      if (authError) throw authError
      let avatarPath: string | null = null
      if (avatarFile) {
        const path = `${currentUserId}/avatar-${Date.now()}-${safeFileName(avatarFile.name)}`
        const { error: uploadError } = await supabase.storage.from(AVATARS_BUCKET).upload(path, avatarFile, {
          contentType: avatarFile.type || "image/jpeg",
          cacheControl: "3600",
          upsert: false,
        })
        if (uploadError) throw uploadError
        avatarPath = path
      }
      const { error } = await supabase.rpc("update_my_profile", { p_name: name, p_avatar_path: avatarPath })
      if (error) throw error
      await refreshMembers()
      return true
    } catch (error) {
      fail(error, "Não foi possível atualizar seu perfil")
      return false
    }
  }, [currentUserId, fail, refreshMembers, supabase])

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

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut()
    window.location.assign("/login")
  }, [supabase])

  const value = React.useMemo<StoreContextValue>(() => ({
    projects,
    members,
    chatConversations,
    chatMeetings,
    notifications,
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
    addProjectAttachments,
    setProjectAttachmentActive,
    addSubactivityAttachments,
    setSubactivityAttachmentActive,
    ensureDirectConversation,
    sendChatMessage,
    sendChatAudio,
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
    addSubactivityAttachments, addSubactivityComment, canManageSubactivity, chatConversations, chatMeetings,
    answerMeetingInvite, createChatGroup, createMeeting, currentUserId, currentUserRole, deleteActivity, deleteChatGroup,
    endMeeting, ensureDirectConversation, heartbeatMeeting, hydrated, chatHydrated, joinMeeting, lastError, leaveMeeting,
    markAllNotificationsRead, markNotificationRead,
    members, notifications, preferences, projects, refreshAll, refreshing, runningSubIds, sendChatAudio, sendChatMessage, setMemberRole,
    setProjectAttachmentActive, setSubStatus, setSubactivityAttachmentActive, signOut, startTimer, stopTimer,
    updateChatGroup, updateMyProfile, updatePreferences, updateProject, versionProject, workSessions, workspaceId,
  ])

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const context = React.useContext(StoreContext)
  if (!context) throw new Error("useStore must be used inside StoreProvider")
  return context
}
