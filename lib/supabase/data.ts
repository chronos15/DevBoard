import type { SupabaseClient, User } from '@supabase/supabase-js'
import type {
  AccessRole,
  AqsReview,
  AttachmentEntry,
  ChatConversation,
  ChatMeeting,
  ChatMessage,
  NotificationEntry,
  Project,
  Status,
  SupportTopic,
  UserPreferences,
  WorkSession,
} from '@/lib/types'
import { AVATARS_BUCKET, isAttachmentKind, mapMember } from './helpers'

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

  const { data: memberships, error: membershipError } = await supabase
    .from('workspace_members')
    .select('workspace_id, user_id, role')
    .eq('user_id', userData.user.id)
    .eq('active', true)
    .limit(1)
  assertNoError(membershipError, 'Não foi possível carregar o workspace')

  const membership = memberships?.[0]
  if (!membership?.workspace_id) {
    throw new Error('Seu usuário ainda não pertence a um workspace. Execute a migration do Supabase.')
  }

  return {
    user: userData.user,
    workspaceId: membership.workspace_id as string,
    role: (['admin','developer','aqs','support','member'].includes(String(membership.role)) ? membership.role : 'member') as AccessRole,
  }
}

export async function loadMembers(supabase: SupabaseClient, workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_members')
    .select('user_id, role, profiles!workspace_members_user_id_fkey(id,email,name,initials,color,avatar_path)')
    .eq('workspace_id', workspaceId)
    .eq('active', true)
    .order('joined_at', { ascending: true })
  assertNoError(error, 'Não foi possível carregar a equipe')

  return (data ?? []).map((entry: any) => {
    const profile = Array.isArray(entry.profiles) ? entry.profiles[0] : entry.profiles
    if (profile?.avatar_path) {
      const { data: publicData } = supabase.storage.from(AVATARS_BUCKET).getPublicUrl(profile.avatar_path)
      profile.avatar_url = publicData.publicUrl
    }
    return mapMember(profile ?? { id: entry.user_id, name: 'Usuário' }, entry.role)
  })
}

export async function loadProjects(supabase: SupabaseClient, workspaceId: string): Promise<Project[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(`
      id,name,icon,client,description,tag,priority,due_date,version,build,repository,created_at,updated_at,
      project_members(user_id),
      project_comments(id,author_id,content,created_at),
      attachments!attachments_project_id_fkey(id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active,status_changed_at,status_changed_by,created_at),
      project_logs(id,actor_id,type,title,description,created_at),
      project_versions(id,version,build,created_at),
      activities(
        id,title,created_at,
        activity_assignees(user_id),
        subactivities(
          id,title,status,estimated_hours,tracked_seconds,timer_started_at,assignee_id,needs_attention,attention_message,created_at,
          subactivity_comments(id,author_id,content,mentions,reply_to_comment_id,created_at),
          attachments!attachments_subactivity_id_fkey(id,name,mime_type,size_bytes,kind,storage_path,uploaded_by,active,status_changed_at,status_changed_by,created_at)
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
        assigneeIds: (activity.activity_assignees ?? []).map((item: any) => item.user_id),
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
            assigneeId: sub.assignee_id,
            needsAttention: sub.needs_attention === true,
            attentionMessage: sub.attention_message ?? undefined,
            comments: (() => {
              const rows = [...(sub.subactivity_comments ?? [])]
                .sort((a: any, b: any) => a.created_at.localeCompare(b.created_at))
              const byId = new Map(rows.map((comment: any) => [comment.id, comment]))
              return rows.map((comment: any) => {
                const replyId = typeof comment.reply_to_comment_id === "string" && comment.reply_to_comment_id
                  ? comment.reply_to_comment_id
                  : undefined
                const reply = replyId ? byId.get(replyId) : undefined
                return {
                  id: comment.id,
                  authorId: comment.author_id,
                  content: comment.content,
                  createdAt: comment.created_at,
                  mentions: Array.isArray(comment.mentions)
                    ? comment.mentions
                        .filter((mention: any) => mention && mention.kind === "user" && typeof mention.id === "string" && typeof mention.label === "string")
                        .map((mention: any) => ({ kind: "user" as const, id: mention.id, label: mention.label }))
                    : [],
                  replyTo: replyId ? (reply ? {
                    commentId: replyId,
                    authorId: reply.author_id,
                    content: reply.content,
                  } : { commentId: replyId, unavailable: true }) : undefined,
                }
              })
            })(),
            attachments: await Promise.all((sub.attachments ?? []).map((item: any) => mapAttachment(supabase, item))),
          }))),
      })))

    return {
      id: row.id,
      name: row.name,
      icon: row.icon ?? "folder-kanban",
      client: row.client,
      description: row.description,
      tag: row.tag,
      priority: row.priority,
      dueDate: row.due_date,
      memberIds: (row.project_members ?? []).map((item: any) => item.user_id),
      version: row.version ?? undefined,
      build: row.build ?? undefined,
      repository: row.repository ?? '',
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
const CHAT_MESSAGE_COLUMNS = `${CHAT_MESSAGE_BASE_COLUMNS},reply_to_message_id`

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
    .select('id,recipient_id,actor_id,type,title,description,created_at,read_at,project_id,activity_id,subactivity_id,meeting_id,conversation_id')
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
    .select('notify_assignments,notify_comments,notify_team_activity,notify_deadlines,timer_sticky,reduced_motion,density')
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
      storagePath: item.storage_path,
      uploadedBy: item.uploaded_by,
      createdAt: item.created_at,
    })),
  })) as SupportTopic[]
}
