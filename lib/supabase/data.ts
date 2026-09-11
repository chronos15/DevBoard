import type { SupabaseClient, User } from '@supabase/supabase-js'
import type {
  AccessRole,
  MemberAccessPolicy,
  AqsReview,
  AttachmentEntry,
  ChatConversation,
  ChatMeeting,
  ChatMessage,
  FollowUpReplyTargetKind,
  NotificationEntry,
  Project,
  ServiceRequest,
  ServiceRequestStatus,
  ServiceRequestUnit,
  Status,
  SupportTopic,
  UserPreferences,
  WorkSession,
  WorkItemType,
} from '@/lib/types'
import { AVATARS_BUCKET, PROJECT_ICONS_BUCKET, SERVICE_REQUEST_UNIT_ICONS_BUCKET, isAttachmentKind, mapMember } from './helpers'

export type BackendSnapshot = {
  user: User
  workspaceId: string
  role: AccessRole
  members: ReturnType<typeof mapMember>[]
  projects: Project[]
  chatConversations: ChatConversation[]
  chatMeetings: ChatMeeting[]
  notifications: NotificationEntry[]
  preferences: UserPreferences
  workSessions: WorkSession[]
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  notifyAssignments: true,
  notifyComments: true,
  notifyTeamActivity: true,
  notifyDeadlines: true,
  timerSticky: true,
  reducedMotion: false,
  density: "comfortable",
  primaryColor: null,
  interfaceMode: "complete",
  fontFamily: "jakarta",
  chatTextSize: "medium",
  chatLineSpacing: "comfortable",
}

function assertNoError(error: any, fallback: string) {
  if (error) throw new Error(error.message || fallback)
}

async function mapAttachment(_supabase: SupabaseClient, row: any): Promise<AttachmentEntry> {
  // URLs assinadas são resolvidas somente quando o usuário abre o anexo.
  // Isso evita dezenas de chamadas ao Storage durante a abertura de Dashboard/Projetos.
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type || 'application/octet-stream',
    size: Number(row.size_bytes || 0),
    kind: isAttachmentKind(row.kind) ? row.kind : 'other',
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    active: row.active !== false,
    storagePath: row.storage_path || undefined,
    dataUrl: undefined,
    textContent: row.text_content ?? undefined,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedBy: row.status_changed_by ?? undefined,
    messageGroupId: row.message_group_id ?? undefined,
  }
}

function liveTrackedSeconds(row: any) {
  const persisted = Number(row.tracked_seconds || 0)
  if (row.status !== 'in-progress' || !row.timer_started_at) return persisted
  const elapsed = Math.max(0, Math.floor((Date.now() - new Date(row.timer_started_at).getTime()) / 1000))
  return persisted + elapsed
}

export async function loadIdentity(supabase: SupabaseClient) {
  const { data: userData, error: userError } = await supabase.auth.getUser()
  assertNoError(userError, 'Não foi possível validar a sessão')
  if (!userData.user) throw new Error('Sessão não encontrada')
  if (!userData.user.email_confirmed_at) {
    throw new Error('Confirme seu e-mail antes de acessar o TaskBoard.')
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('workspace_members')
    .select('workspace_id, user_id, role')
    .eq('user_id', userData.user.id)
    .eq('active', true)
    .limit(1)
  assertNoError(membershipError, 'Não foi possível carregar o workspace')

  const membership = memberships?.[0]
  if (!membership?.workspace_id) {
    throw new Error('Seu usuário ainda não está vinculado a um ambiente de trabalho. Entre em contato com um administrador.')
  }

  return {
    user: userData.user,
    workspaceId: membership.workspace_id as string,
    role: (['admin','developer','aqs','support','member'].includes(String(membership.role)) ? membership.role : 'member') as AccessRole,
  }
}


export async function loadMyWorkspaceAccess(supabase: SupabaseClient, role: AccessRole): Promise<MemberAccessPolicy> {
  let { data, error } = await supabase.rpc('get_my_workspace_access_profile_v2')
  if (error) {
    const legacy = await supabase.rpc('get_my_workspace_access_profile')
    if (!legacy.error) { data = legacy.data; error = null }
  }
  if (error) {
    // A migration 077 adiciona esta RPC. Até ela ser aplicada, o comportamento
    // permanece exatamente o padrão da role atual.
    return {
      enabled: false,
      screenPermissions: {
        dashboard: true,
        developer: role === 'developer',
        projects: role === 'admin' || role === 'developer',
        followup: true,
        requests: true,
        requestsAqs: role === 'admin' || role === 'aqs',
        requestsDev: role === 'admin' || role === 'developer',
        analysis: role === 'admin' || role === 'aqs' || role === 'developer',
        hours: role === 'admin' || role === 'developer',
        agenda: role === 'admin' || role === 'developer',
        chat: true,
        reports: role === 'admin',
      },
      actionPermissions: {
        createProjects: role === 'admin' || role === 'developer',
        editProjects: role === 'admin' || role === 'developer',
        createActivities: role === 'admin' || role === 'developer',
        createSubactivities: role === 'admin' || role === 'developer',
      },
      restrictProjects: false,
      restrictActivities: false,
      restrictSubactivities: false,
    }
  }
  const row = Array.isArray(data) ? data[0] : data
  const raw = row?.screen_permissions && typeof row.screen_permissions === 'object' ? row.screen_permissions : {}
  const rawActions = row?.action_permissions && typeof row.action_permissions === 'object' ? row.action_permissions : {}
  const defaults = {
    dashboard: true, developer: role === 'developer', projects: role === 'admin' || role === 'developer',
    followup: true, requests: true, requestsAqs: role === 'admin' || role === 'aqs', requestsDev: role === 'admin' || role === 'developer',
    analysis: role === 'admin' || role === 'aqs' || role === 'developer', hours: role === 'admin' || role === 'developer',
    agenda: role === 'admin' || role === 'developer', chat: true, reports: role === 'admin',
  }
  const defaultActions = {
    createProjects: role === 'admin' || role === 'developer',
    editProjects: role === 'admin' || role === 'developer',
    createActivities: role === 'admin' || role === 'developer',
    createSubactivities: role === 'admin' || role === 'developer',
  }
  return {
    enabled: role === 'admin' ? false : row?.enabled === true,
    screenPermissions: { ...defaults, ...raw },
    actionPermissions: { ...defaultActions, ...rawActions },
    restrictProjects: row?.restrict_projects === true,
    restrictActivities: row?.restrict_activities === true,
    restrictSubactivities: row?.restrict_subactivities === true,
  }
}

export async function loadMembers(supabase: SupabaseClient, workspaceId: string) {
  const [{ data, error }, scheduleResult] = await Promise.all([
    supabase
      .from('workspace_members')
      .select('user_id, role, active, work_days, daily_hours, profiles!workspace_members_user_id_fkey(id,email,name,initials,color,avatar_path)')
      .eq('workspace_id', workspaceId)
      .eq('active', true)
      .order('joined_at', { ascending: true }),
    supabase
      .from('workspace_member_work_schedule')
      .select('user_id,weekday,target_minutes')
      .eq('workspace_id', workspaceId),
  ])
  assertNoError(error, 'Não foi possível carregar a equipe')

  const scheduleByUser = new Map<string, Record<number, number>>()
  if (!scheduleResult.error) {
    for (const row of scheduleResult.data ?? []) {
      const userId = String((row as any).user_id)
      const schedule = scheduleByUser.get(userId) ?? {}
      schedule[Number((row as any).weekday)] = Number((row as any).target_minutes || 0)
      scheduleByUser.set(userId, schedule)
    }
  }

  return (data ?? []).map((entry: any) => {
    const profile = Array.isArray(entry.profiles) ? entry.profiles[0] : entry.profiles
    if (profile?.avatar_path) {
      const { data: publicData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(profile.avatar_path)
      profile.avatar_url = publicData.publicUrl
    }
    const legacyDays = Array.isArray(entry.work_days) ? entry.work_days.map((value: unknown) => Number(value)).filter((value: number) => Number.isInteger(value) && value >= 0 && value <= 6) : [1, 2, 3, 4, 5]
    const legacyHours = Number(entry.daily_hours || 8)
    const schedule = scheduleByUser.get(String(entry.user_id)) ?? Object.fromEntries(legacyDays.map((day: number) => [day, Math.round(legacyHours * 60)]))
    return {
      ...mapMember(profile ?? { id: entry.user_id, name: 'Usuário' }, entry.role),
      workDays: Object.entries(schedule).filter(([, minutes]) => Number(minutes) > 0).map(([day]) => Number(day)),
      dailyHours: legacyHours,
      workSchedule: schedule,
    }
  })
}

export async function loadWorkItemTypes(supabase: SupabaseClient, workspaceId: string): Promise<WorkItemType[]> {
  const { data, error } = await supabase
    .from('work_item_types')
    .select('id,name,color,active,intermittent,created_at')
    .eq('workspace_id', workspaceId)
    .order('name', { ascending: true })
  assertNoError(error, 'Não foi possível carregar os tipos de atividade')

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    color: row.color || '#64748B',
    active: row.active !== false,
    intermittent: row.intermittent === true,
    createdAt: row.created_at,
  }))
}

export async function loadProjects(supabase: SupabaseClient, workspaceId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      id,name,icon,icon_image_path,client,description,tag,priority,due_date,version,build,repository,modules,subjects,responsible_departments,created_at,updated_at,
      project_members(user_id),
      project_comments(id,author_id,content,created_at),
      attachments!attachments_project_id_fkey(id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active,status_changed_at,status_changed_by,message_group_id,created_at),
      project_logs(id,actor_id,type,title,description,created_at),
      project_versions(id,version,build,created_at),
      activities(
        id,title,type_id,created_at,
        activity_assignees(user_id),
        attachments!attachments_activity_id_fkey(id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active,status_changed_at,status_changed_by,message_group_id,created_at),
        subactivities(
          id,title,type_id,status,estimated_hours,tracked_seconds,timer_started_at,assignee_id,needs_attention,attention_message,brainstorm_mode,created_at,updated_at,
          subactivity_members(user_id),
          subactivity_comments(id,author_id,content,mentions,reply_to_comment_id,reply_target_kind,reply_target_id,reply_snapshot,message_group_id,created_at),
          attachments!attachments_subactivity_id_fkey(id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active,status_changed_at,status_changed_by,message_group_id,created_at)
        )
      )
    `)
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  assertNoError(error, 'Não foi possível carregar os projetos')

  return Promise.all((data ?? []).map(async (row: any) => {
    const projectAttachments = await Promise.all((row.attachments ?? []).map((item: any) => mapAttachment(supabase, item)))
    const activities = await Promise.all((row.activities ?? [])
      .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
      .map(async (activity: any) => ({
        id: activity.id,
        title: activity.title,
        typeId: activity.type_id ?? undefined,
        assigneeIds: (activity.activity_assignees ?? []).map((item: any) => item.user_id),
        attachments: await Promise.all((activity.attachments ?? []).map((item: any) => mapAttachment(supabase, item))),
        subactivities: await Promise.all((activity.subactivities ?? [])
          .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
          .map(async (sub: any) => ({
            id: sub.id,
            title: sub.title,
            status: sub.status as Status,
            estimatedHours: Number(sub.estimated_hours || 0),
            trackedSeconds: liveTrackedSeconds(sub),
            timerStartedAt: sub.timer_started_at ?? undefined,
            createdAt: sub.created_at ?? undefined,
            updatedAt: sub.updated_at ?? sub.created_at ?? undefined,
            assigneeId: sub.assignee_id,
            typeId: sub.type_id ?? undefined,
            memberIds: Array.from(new Set([sub.assignee_id, ...(sub.subactivity_members ?? []).map((item: any) => item.user_id)].filter(Boolean))),
            needsAttention: sub.needs_attention === true,
            attentionMessage: sub.attention_message ?? undefined,
            brainstormMode: sub.brainstorm_mode === true,
            comments: (() => {
              const rows = [...(sub.subactivity_comments ?? [])]
                .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
              const byId = new Map(rows.map((comment: any) => [comment.id, comment]))
              return rows.map((comment: any) => {
                const legacyReplyId = typeof comment.reply_to_comment_id === "string" && comment.reply_to_comment_id
                  ? comment.reply_to_comment_id
                  : undefined
                const replyTargetKind = typeof comment.reply_target_kind === "string"
                  && ["comment", "attachment", "log", "session"].includes(comment.reply_target_kind)
                  ? comment.reply_target_kind as FollowUpReplyTargetKind
                  : undefined
                const replyTargetId = typeof comment.reply_target_id === "string" && comment.reply_target_id
                  ? comment.reply_target_id
                  : undefined
                const snapshot = comment.reply_snapshot && typeof comment.reply_snapshot === "object"
                  ? comment.reply_snapshot
                  : undefined
                const legacyReply = legacyReplyId ? byId.get(legacyReplyId) : undefined
                const genericReplyTo = replyTargetKind && replyTargetId ? {
                  targetKind: replyTargetKind,
                  targetId: replyTargetId,
                  commentId: replyTargetKind === "comment" ? replyTargetId : undefined,
                  authorId: typeof snapshot?.authorId === "string" ? snapshot.authorId : undefined,
                  label: typeof snapshot?.label === "string" ? snapshot.label : undefined,
                  content: typeof snapshot?.content === "string" ? snapshot.content : undefined,
                } : undefined
                return {
                  id: comment.id,
                  authorId: comment.author_id,
                  content: comment.content,
                  createdAt: comment.created_at,
                  messageGroupId: comment.message_group_id ?? undefined,
                  mentions: Array.isArray(comment.mentions)
                    ? comment.mentions
                        .filter((mention: any) => mention && mention.kind === "user" && typeof mention.id === "string" && typeof mention.label === "string")
                        .map((mention: any) => ({ kind: "user" as const, id: mention.id, label: mention.label }))
                    : [],
                  replyTo: genericReplyTo ?? (legacyReplyId ? (legacyReply ? {
                    commentId: legacyReplyId,
                    targetKind: "comment" as const,
                    targetId: legacyReplyId,
                    authorId: legacyReply.author_id,
                    label: "Mensagem",
                    content: legacyReply.content,
                  } : { commentId: legacyReplyId, targetKind: "comment" as const, targetId: legacyReplyId, unavailable: true }) : undefined),
                }
              })
            })(),
            attachments: await Promise.all((sub.attachments ?? []).map((item: any) => mapAttachment(supabase, item))),
          }))),
      })))

    const iconImagePath = row.icon_image_path || undefined
    const iconImageUrl = iconImagePath
      ? supabase.storage.from(PROJECT_ICONS_BUCKET).getPublicUrl(iconImagePath).data.publicUrl
      : undefined

    return {
      id: row.id,
      name: row.name,
      icon: row.icon ?? "folder-kanban",
      iconImagePath,
      iconImageUrl,
      client: row.client,
      description: row.description,
      tag: row.tag,
      priority: row.priority,
      dueDate: row.due_date ?? "",
      memberIds: (row.project_members ?? []).map((item: any) => item.user_id),
      version: row.version ?? undefined,
      build: row.build ?? undefined,
      repository: row.repository ?? '',
      modules: Array.isArray(row.modules) ? row.modules.filter((item: unknown): item is string => typeof item === "string") : [],
      subjects: Array.isArray(row.subjects) ? row.subjects.filter((item: unknown): item is string => typeof item === "string") : [],
      responsibleDepartments: Array.isArray(row.responsible_departments) ? row.responsible_departments.filter((item: unknown): item is string => typeof item === "string") : [],
      activities,
      comments: (row.project_comments ?? [])
        .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
        .map((comment: any) => ({ id: comment.id, authorId: comment.author_id, content: comment.content, createdAt: comment.created_at })),
      attachments: projectAttachments,
      logs: (row.project_logs ?? [])
        .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
        .map((log: any) => ({
          id: log.id,
          actorId: log.actor_id ?? undefined,
          type: log.type,
          title: log.title,
          description: log.description ?? undefined,
          createdAt: log.created_at,
        })),
      versions: (row.project_versions ?? [])
        .sort((a: any, b: any) => b.created_at.localeCompare(a.created_at))
        .map((version: any) => ({ id: version.id, version: version.version, build: version.build, createdAt: version.created_at })),
    } satisfies Project
  }))
}

function chatMessageType(value: unknown): ChatMessage['type'] {
  return value === 'audio' ? 'audio' : value === 'media' ? 'media' : 'text'
}


function mapChatCommandSnapshot(value: unknown): ChatMessage['command'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  if (typeof source.command !== 'string' || typeof source.title !== 'string' || !Array.isArray(source.body)) return undefined
  const body = source.body.flatMap((raw): any[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
    const block = raw as Record<string, unknown>
    const type = block.type
    if (type === 'text' && typeof block.content === 'string') return [{ type, content: block.content }]
    if (type === 'code' && typeof block.content === 'string') return [{ type, content: block.content, language: typeof block.language === 'string' ? block.language : undefined }]
    if (type === 'html' && typeof block.content === 'string') return [{ type, content: block.content }]
    if ((type === 'image' || type === 'video') && typeof block.url === 'string') return [{ type, url: block.url, caption: typeof block.caption === 'string' ? block.caption : undefined }]
    if (type === 'link' && typeof block.url === 'string') return [{ type, url: block.url, label: typeof block.label === 'string' ? block.label : undefined }]
    return []
  })
  return {
    commandId: typeof source.commandId === 'string' ? source.commandId : undefined,
    command: source.command,
    title: source.title,
    description: typeof source.description === 'string' ? source.description : undefined,
    body,
  }
}

function mapChatMessageRow(message: any): ChatMessage {
  const replyMessageId = typeof message.reply_to_message_id === 'string' && message.reply_to_message_id
    ? message.reply_to_message_id
    : undefined

  return {
    id: message.id,
    senderId: message.sender_id,
    content: message.content,
    type: chatMessageType(message.message_type),
    mediaPath: message.media_path ?? undefined,
    mediaMimeType: message.media_mime_type ?? undefined,
    mediaDurationMs: message.media_duration_ms == null ? undefined : Number(message.media_duration_ms),
    mediaSizeBytes: message.media_size_bytes == null ? undefined : Number(message.media_size_bytes),
    mediaName: message.media_name ?? undefined,
    mediaKind: isAttachmentKind(message.media_kind) ? message.media_kind : undefined,
    mentions: Array.isArray(message.mentions)
      ? message.mentions
          .filter((mention: any) => mention && (mention.kind === 'user' || mention.kind === 'project') && typeof mention.id === 'string' && typeof mention.label === 'string')
          .map((mention: any) => ({ kind: mention.kind, id: mention.id, label: mention.label }))
      : [],
    replyTo: replyMessageId ? { messageId: replyMessageId, unavailable: true } : undefined,
    command: mapChatCommandSnapshot(message.command_payload),
    createdAt: message.created_at,
  }
}

async function hydrateChatReplyReferences(supabase: SupabaseClient, messages: ChatMessage[]): Promise<ChatMessage[]> {
  const replyIds = Array.from(new Set(
    messages
      .map((message) => message.replyTo?.messageId)
      .filter((id): id is string => Boolean(id)),
  ))
  if (!replyIds.length) return messages

  const { data, error } = await supabase
    .from('chat_messages')
    .select('id,sender_id,content,message_type,media_name')
    .in('id', replyIds)

  // O reply continua renderizável mesmo quando a mensagem original ficou fora do
  // corte individual de histórico ou não pode mais ser lida pelo participante.
  if (error) return messages

  const references = new Map((data ?? []).map((row: any) => [row.id, row]))
  return messages.map((message) => {
    const replyMessageId = message.replyTo?.messageId
    if (!replyMessageId) return message
    const row: any = references.get(replyMessageId)
    if (!row) return message
    return {
      ...message,
      replyTo: {
        messageId: row.id,
        senderId: row.sender_id,
        content: row.content ?? '',
        type: chatMessageType(row.message_type),
        mediaName: row.media_name ?? undefined,
      },
    }
  })
}

const CHAT_MESSAGE_BASE_COLUMNS = 'id,sender_id,content,message_type,media_path,media_mime_type,media_duration_ms,media_size_bytes,media_name,media_kind,mentions,created_at'
const CHAT_MESSAGE_REPLY_COLUMNS = `${CHAT_MESSAGE_BASE_COLUMNS},reply_to_message_id`
const CHAT_MESSAGE_COLUMNS = `${CHAT_MESSAGE_REPLY_COLUMNS},command_name,command_payload`

export async function loadChatMessagesPage(
  supabase: SupabaseClient,
  conversationId: string,
  options: { beforeCreatedAt?: string; limit?: number } = {},
): Promise<{ messages: ChatMessage[]; hasMore: boolean }> {
  const pageSize = Math.max(1, Math.min(50, options.limit ?? 20))
  const buildQuery = (columns: string) => {
    let query = supabase
      .from('chat_messages')
      .select(columns)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(pageSize + 1)

    if (options.beforeCreatedAt) query = query.lt('created_at', options.beforeCreatedAt)
    return query
  }

  // Compatibilidade de rollout: o front novo pode entrar no ar antes da migration
  // de replies. Nesse intervalo o chat continua abrindo normalmente, apenas sem
  // referências de resposta até o banco receber a coluna nova.
  let result = await buildQuery(CHAT_MESSAGE_COLUMNS)
  if (result.error && /command_name|command_payload/i.test(String(result.error.message ?? ''))) {
    result = await buildQuery(CHAT_MESSAGE_REPLY_COLUMNS)
  }
  if (result.error && String(result.error.message ?? '').includes('reply_to_message_id')) {
    result = await buildQuery(CHAT_MESSAGE_BASE_COLUMNS)
  }
  assertNoError(result.error, 'Não foi possível carregar o histórico da conversa')

  const rows = result.data ?? []
  const hasMore = rows.length > pageSize
  const mapped = rows
    .slice(0, pageSize)
    .map(mapChatMessageRow)
    .reverse()
  const messages = await hydrateChatReplyReferences(supabase, mapped)

  return { messages, hasMore }
}

export async function loadChatConversations(supabase: SupabaseClient, workspaceId: string): Promise<ChatConversation[]> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id,kind,name,created_by,created_at,updated_at,chat_members(user_id)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
  assertNoError(error, 'Não foi possível carregar o chat')

  const conversations = (data ?? []).map((row: any) => ({
    id: row.id,
    kind: row.kind,
    name: row.name ?? undefined,
    memberIds: (row.chat_members ?? []).map((item: any) => item.user_id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: [],
  } satisfies ChatConversation))

  // A lista precisa apenas da última mensagem para preview. O histórico completo
  // é buscado somente quando a conversa é aberta, em páginas de 20 mensagens.
  const previews = await Promise.all(
    conversations.map(async (conversation) => {
      try {
        const page = await loadChatMessagesPage(supabase, conversation.id, { limit: 1 })
        return page.messages[0] ?? null
      } catch {
        return null
      }
    }),
  )

  return conversations.map((conversation, index) => ({
    ...conversation,
    messages: previews[index] ? [previews[index]!] : [],
  }))
}

export async function loadMeetings(supabase: SupabaseClient, workspaceId: string): Promise<ChatMeeting[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id,conversation_id,title,mode,created_by,created_at,updated_at,ended_at,meeting_members(user_id,status,invited_at,answered_at,joined_at,left_at,last_seen_at)')
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
  assertNoError(error, 'Não foi possível carregar as reuniões')

  return (data ?? []).map((row: any) => ({
    id: row.id,
    conversationId: row.conversation_id ?? undefined,
    title: row.title,
    mode: row.mode,
    memberIds: (row.meeting_members ?? []).map((item: any) => item.user_id),
    memberStates: (row.meeting_members ?? []).map((item: any) => ({
      userId: item.user_id,
      status: item.status ?? 'pending',
      invitedAt: item.invited_at ?? row.created_at,
      answeredAt: item.answered_at ?? undefined,
      joinedAt: item.joined_at ?? undefined,
      leftAt: item.left_at ?? undefined,
      lastSeenAt: item.last_seen_at ?? undefined,
    })),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at ?? undefined,
  })) as ChatMeeting[]
}

export async function loadNotifications(supabase: SupabaseClient, userId: string): Promise<NotificationEntry[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('id,recipient_id,actor_id,type,title,description,created_at,read_at,project_id,activity_id,subactivity_id,meeting_id,conversation_id,request_id')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(200)
  assertNoError(error, 'Não foi possível carregar as notificações')

  return (data ?? []).map((row: any) => ({
    id: row.id,
    recipientId: row.recipient_id,
    actorId: row.actor_id ?? undefined,
    type: row.type,
    title: row.title,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    readAt: row.read_at ?? undefined,
    projectId: row.project_id ?? undefined,
    activityId: row.activity_id ?? undefined,
    subactivityId: row.subactivity_id ?? undefined,
    meetingId: row.meeting_id ?? undefined,
    conversationId: row.conversation_id ?? undefined,
    requestId: row.request_id ?? undefined,
  })) as NotificationEntry[]
}

export async function loadWorkSessions(supabase: SupabaseClient): Promise<WorkSession[]> {
  const since = new Date()
  since.setDate(since.getDate() - 31)
  const { data, error } = await supabase
    .from('work_sessions')
    .select('id,subactivity_id,user_id,started_at,ended_at,duration_seconds')
    .gte('started_at', since.toISOString())
    .order('started_at', { ascending: false })
  assertNoError(error, 'Não foi possível carregar o histórico de horas')
  return (data ?? []).map((row: any) => ({
    id: row.id,
    subactivityId: row.subactivity_id,
    userId: row.user_id,
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    durationSeconds: Number(row.duration_seconds || 0),
  }))
}

export async function loadPreferences(supabase: SupabaseClient, userId: string): Promise<UserPreferences> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('notify_assignments,notify_comments,notify_team_activity,notify_deadlines,timer_sticky,reduced_motion,density,primary_color,interface_mode,font_family,chat_text_size,chat_line_spacing')
    .eq('user_id', userId)
    .maybeSingle()
  assertNoError(error, 'Não foi possível carregar suas preferências')
  if (!data) return DEFAULT_PREFERENCES
  return {
    notifyAssignments: data.notify_assignments !== false,
    notifyComments: data.notify_comments !== false,
    notifyTeamActivity: data.notify_team_activity !== false,
    notifyDeadlines: data.notify_deadlines !== false,
    timerSticky: data.timer_sticky !== false,
    reducedMotion: data.reduced_motion === true,
    density: data.density === 'compact' ? 'compact' : 'comfortable',
    primaryColor: /^#[0-9a-f]{6}$/i.test(data.primary_color ?? '') ? String(data.primary_color).toUpperCase() : null,
    interfaceMode: data.interface_mode === 'focused' ? 'focused' : 'complete',
    fontFamily: ['system','arial','verdana','tahoma'].includes(String(data.font_family)) ? data.font_family : 'jakarta',
    chatTextSize: ['small','large','xlarge'].includes(String(data.chat_text_size)) ? data.chat_text_size : 'medium',
    chatLineSpacing: ['compact','relaxed'].includes(String(data.chat_line_spacing)) ? data.chat_line_spacing : 'comfortable',
  }
}

export async function loadBackendSnapshot(supabase: SupabaseClient): Promise<BackendSnapshot> {
  const identity = await loadIdentity(supabase)
  const [members, projects, chatConversations, chatMeetings, notifications, preferences, workSessions] = await Promise.all([
    loadMembers(supabase, identity.workspaceId),
    loadProjects(supabase, identity.workspaceId),
    loadChatConversations(supabase, identity.workspaceId),
    loadMeetings(supabase, identity.workspaceId),
    loadNotifications(supabase, identity.user.id),
    loadPreferences(supabase, identity.user.id),
    loadWorkSessions(supabase),
  ])
  return { ...identity, members, projects, chatConversations, chatMeetings, notifications, preferences, workSessions }
}


export async function loadAqsReviews(supabase: SupabaseClient, workspaceId: string): Promise<AqsReview[]> {
  const { data, error } = await supabase
    .from('aqs_reviews')
    .select('id,workspace_id,project_id,activity_id,subactivity_id,status,assigned_aqs_id,created_by,created_at,started_at,completed_at,revoked_at,revoked_reason')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
  assertNoError(error, 'Não foi possível carregar a fila de AQS')

  return (data ?? []).map((row: any) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    activityId: row.activity_id,
    subactivityId: row.subactivity_id,
    status: row.status,
    assignedAqsId: row.assigned_aqs_id ?? undefined,
    createdBy: row.created_by,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    revokedReason: row.revoked_reason ?? undefined,
  })) as AqsReview[]
}



export async function loadServiceRequestUnits(supabase: SupabaseClient, workspaceId: string): Promise<ServiceRequestUnit[]> {
  const { data, error } = await supabase
    .from('service_request_units')
    .select('id,workspace_id,name,active,icon,icon_image_path,created_at,updated_at')
    .eq('workspace_id', workspaceId)
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  assertNoError(error, 'Não foi possível carregar as unidades de solicitação')

  return (data ?? []).map((row: any) => {
    const iconImagePath = row.icon_image_path ?? undefined
    const iconImageUrl = iconImagePath
      ? supabase.storage.from(SERVICE_REQUEST_UNIT_ICONS_BUCKET).getPublicUrl(iconImagePath).data.publicUrl
      : undefined
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      active: row.active !== false,
      icon: row.icon || 'building',
      iconImagePath,
      iconImageUrl,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  })
}

export async function loadServiceRequests(supabase: SupabaseClient, workspaceId: string): Promise<ServiceRequest[]> {
  const { data, error } = await supabase
    .from('service_requests')
    .select(`
      id,workspace_id,order_number,request_type,unit,unit_id,module,subject,title,description,status,
      priority_requested,priority_reason,priority_approved,created_by,assigned_aqs_id,responsible_dev_id,executor_id,
      project_id,activity_id,aqs_summary,dev_summary,final_build,created_at,updated_at,closed_at,
      service_request_participants(user_id),
      service_request_messages(id,request_id,author_id,content,mentions,created_at),
      service_request_events(id,request_id,actor_id,event_type,title,description,from_status,to_status,created_at),
      service_request_attachments(id,request_id,message_id,category,name,mime_type,size_bytes,kind,storage_path,source_type,external_url,uploaded_by,created_at)
    `)
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
  assertNoError(error, 'Não foi possível carregar as solicitações')

  return (data ?? []).map((row: any) => {
    const attachments = (row.service_request_attachments ?? []).map((item: any) => ({
      id: item.id,
      requestId: item.request_id,
      messageId: item.message_id ?? undefined,
      category: item.category,
      name: item.name,
      mimeType: item.mime_type || 'application/octet-stream',
      size: Number(item.size_bytes || 0),
      kind: isAttachmentKind(item.kind) ? item.kind : 'other',
      storagePath: item.storage_path ?? undefined,
      sourceType: item.source_type === 'external-url' ? 'external-url' : 'upload',
      externalUrl: item.external_url ?? undefined,
      uploadedBy: item.uploaded_by,
      createdAt: item.created_at,
    }))
    return {
      id: row.id,
      workspaceId: row.workspace_id,
      orderNumber: row.order_number,
      requestType: row.request_type,
      unit: row.unit,
      unitId: row.unit_id ?? undefined,
      module: row.module,
      subject: row.subject,
      title: row.title,
      description: row.description,
      status: row.status as ServiceRequestStatus,
      priorityRequested: row.priority_requested === true,
      priorityReason: row.priority_reason ?? undefined,
      priorityApproved: row.priority_approved === true,
      createdBy: row.created_by,
      assignedAqsId: row.assigned_aqs_id ?? undefined,
      responsibleDevId: row.responsible_dev_id ?? undefined,
      executorId: row.executor_id ?? undefined,
      projectId: row.project_id ?? undefined,
      activityId: row.activity_id ?? undefined,
      aqsSummary: row.aqs_summary ?? undefined,
      devSummary: row.dev_summary ?? undefined,
      finalBuild: row.final_build ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      closedAt: row.closed_at ?? undefined,
      participantIds: Array.from(new Set((row.service_request_participants ?? []).map((item: any) => String(item.user_id)))),
      attachments,
      messages: (row.service_request_messages ?? []).map((item: any) => ({
        id: item.id,
        requestId: item.request_id,
        authorId: item.author_id,
        content: item.content || '',
        mentions: Array.isArray(item.mentions) ? item.mentions : [],
        createdAt: item.created_at,
        attachments: attachments.filter((attachment: any) => attachment.messageId === item.id),
      })).sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt)),
      events: (row.service_request_events ?? []).map((item: any) => ({
        id: item.id,
        requestId: item.request_id,
        actorId: item.actor_id ?? undefined,
        type: item.event_type,
        title: item.title,
        description: item.description ?? undefined,
        fromStatus: item.from_status ?? undefined,
        toStatus: item.to_status ?? undefined,
        createdAt: item.created_at,
      })).sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt)),
    } as ServiceRequest
  })
}

export async function loadSupportTopics(supabase: SupabaseClient, workspaceId: string): Promise<SupportTopic[]> {
  const { data, error } = await supabase
    .from('support_topics')
    .select(`
      id,workspace_id,order_number,title,description,status,created_by,assigned_analyst_id,
      project_id,activity_id,developer_id,revoked_reason,created_at,updated_at,
      topic_attachments(id,topic_id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,created_at)
    `)
    .eq('workspace_id', workspaceId)
    .order('updated_at', { ascending: false })
  assertNoError(error, 'Não foi possível carregar os tópicos')

  return (data ?? []).map((row: any) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    orderNumber: row.order_number,
    title: row.title,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    assignedAnalystId: row.assigned_analyst_id ?? undefined,
    projectId: row.project_id ?? undefined,
    activityId: row.activity_id ?? undefined,
    developerId: row.developer_id ?? undefined,
    revokedReason: row.revoked_reason ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attachments: (row.topic_attachments ?? []).map((item: any) => ({
      id: item.id,
      topicId: item.topic_id,
      name: item.name,
      mimeType: item.mime_type || 'application/octet-stream',
      size: Number(item.size_bytes || 0),
      kind: isAttachmentKind(item.kind) ? item.kind : 'other',
      storagePath: item.storage_path || undefined,
      uploadedBy: item.uploaded_by,
      createdAt: item.created_at,
    })),
  })) as SupportTopic[]
}
