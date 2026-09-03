export type Status =
  | "backlog"
  | "waiting"
  | "waiting-aqs"
  | "in-progress"
  | "paused"
  | "done"
  | "cancelled"

export type Priority = "low" | "medium" | "high"
export type AccessRole = "admin" | "developer" | "aqs" | "support" | "member"

export type WorkItemType = {
  id: string
  name: string
  color: string
  active: boolean
  intermittent: boolean
  createdAt: string
}

export type UserPreferences = {
  notifyAssignments: boolean
  notifyComments: boolean
  notifyTeamActivity: boolean
  notifyDeadlines: boolean
  timerSticky: boolean
  reducedMotion: boolean
  density: "comfortable" | "compact"
  primaryColor: string | null
}
export type ActivityFilter = "all" | "open" | "waiting" | "waiting-aqs" | "in-progress" | "done"

export type Member = {
  id: string
  name: string
  initials: string
  color: string
  email?: string
  avatarUrl?: string
  avatarPath?: string
  role?: AccessRole
}

export type MemberPresence = {
  online: boolean
  onlineSince?: string
  connections: number
}

export type FollowUpReplyReference = {
  commentId: string
  authorId?: string
  content?: string
  unavailable?: boolean
}

export type CommentEntry = {
  id: string
  authorId: string
  content: string
  createdAt: string
  mentions?: ChatMention[]
  replyTo?: FollowUpReplyReference
}

export type AttachmentKind =
  | "image"
  | "pdf"
  | "text"
  | "document"
  | "video"
  | "audio"
  | "other"

export type AttachmentEntry = {
  id: string
  name: string
  mimeType: string
  size: number
  kind: AttachmentKind
  uploadedBy: string
  createdAt: string
  active: boolean
  storagePath?: string
  dataUrl?: string
  textContent?: string
  statusChangedAt?: string
  statusChangedBy?: string
}

export type AttachmentUploadInput = Pick<
  AttachmentEntry,
  "name" | "mimeType" | "size" | "kind" | "dataUrl" | "textContent"
> & {
  file?: File
}

export type WorkSession = {
  id: string
  subactivityId: string
  userId: string
  startedAt: string
  endedAt?: string
  durationSeconds: number
}

export type Subactivity = {
  id: string
  title: string
  status: Status
  estimatedHours: number
  trackedSeconds: number
  timerStartedAt?: string
  createdAt?: string
  assigneeId: string
  typeId?: string
  memberIds?: string[]
  needsAttention?: boolean
  attentionMessage?: string
  comments?: CommentEntry[]
  attachments?: AttachmentEntry[]
}

export type Activity = {
  id: string
  title: string
  typeId?: string
  assigneeIds?: string[]
  subactivities: Subactivity[]
}

export type ProjectLogType =
  | "created"
  | "updated"
  | "versioned"
  | "activity-added"
  | "activity-deleted"
  | "subactivity-added"
  | "subactivity-status"
  | "comment-added"
  | "attachment-added"
  | "attachment-status"
  | "aqs-submitted"
  | "aqs-started"
  | "aqs-completed"
  | "aqs-revoked"
  | "topic-to-activity"

export type ProjectLogEntry = {
  id: string
  createdAt: string
  type: ProjectLogType
  title: string
  description?: string
  actorId?: string
}

export type ProjectVersionEntry = {
  id: string
  version: string
  build: string
  createdAt: string
}

export type Project = {
  id: string
  name: string
  icon?: string
  iconImagePath?: string
  iconImageUrl?: string
  client: string
  description: string
  tag: string
  priority: Priority
  dueDate: string
  memberIds: string[]
  version?: string
  build?: string
  repository?: string
  activities: Activity[]
  comments?: CommentEntry[]
  attachments?: AttachmentEntry[]
  logs?: ProjectLogEntry[]
  versions?: ProjectVersionEntry[]
}

export type ProjectInput = Omit<
  Project,
  "id" | "activities" | "comments" | "attachments" | "logs" | "versions"
> & {
  activities?: Activity[]
}

export type NotificationType =
  | "project-assigned"
  | "activity-assigned"
  | "subactivity-assigned"
  | "subactivity-comment"
  | "meeting-invite"
  | "aqs-awaiting"
  | "aqs-approved"
  | "aqs-revoked"
  | "topic-created"
  | "topic-status"
  | "topic-sent"
  | "chat-mention"
  | "followup-mention"
  | "followup-update"
  | "followup-subactivity-opened"
  | "request-created"
  | "request-assigned"
  | "request-status"
  | "request-mention"

export type NotificationEntry = {
  id: string
  recipientId: string
  actorId?: string
  type: NotificationType
  title: string
  description?: string
  createdAt: string
  readAt?: string
  projectId?: string
  activityId?: string
  subactivityId?: string
  meetingId?: string
  conversationId?: string
  requestId?: string
}

export type MeetingMode = "audio" | "video"
export type MeetingMemberStatus = "pending" | "joined" | "declined" | "left"

export type MeetingMemberState = {
  userId: string
  status: MeetingMemberStatus
  invitedAt: string
  answeredAt?: string
  joinedAt?: string
  leftAt?: string
  lastSeenAt?: string
}

export type ChatMeeting = {
  id: string
  conversationId?: string
  title: string
  mode: MeetingMode
  memberIds: string[]
  memberStates: MeetingMemberState[]
  createdBy: string
  createdAt: string
  updatedAt: string
  endedAt?: string
}

export type ChatMention = {
  kind: "user" | "project"
  id: string
  label: string
}

export type ChatReplyReference = {
  messageId: string
  senderId?: string
  content?: string
  type?: "text" | "audio" | "media"
  mediaName?: string
  unavailable?: boolean
}

export type ChatMessage = {
  id: string
  senderId: string
  content: string
  type?: "text" | "audio" | "media"
  mediaPath?: string
  mediaMimeType?: string
  mediaDurationMs?: number
  mediaSizeBytes?: number
  mediaName?: string
  mediaKind?: AttachmentKind
  mentions?: ChatMention[]
  replyTo?: ChatReplyReference
  /** Estado local de entrega usado para envio otimista no chat. Mensagens vindas do backend deixam este campo indefinido. */
  deliveryStatus?: "sending" | "failed"
  createdAt: string
}

export type ChatConversation = {
  id: string
  kind: "direct" | "group"
  name?: string
  memberIds: string[]
  createdBy: string
  createdAt: string
  updatedAt: string
  messages: ChatMessage[]
}



export type ServiceRequestType = "failure" | "development" | "adjustment" | "improvement" | "structured-triage"
export type ServiceRequestStatus =
  | "received"
  | "aqs-analysis"
  | "waiting-info"
  | "waiting-dev"
  | "waiting-executor"
  | "in-dev"
  | "waiting-aqs"
  | "rework"
  | "waiting-build"
  | "completed"
  | "rejected"
  | "cancelled"

export type ServiceRequestAttachmentCategory = "order-pdf" | "analysis-video" | "database" | "certificate" | "other"
export type ServiceRequestAttachmentSource = "upload" | "external-url"

export type ServiceRequestUnit = {
  id: string
  workspaceId: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export type ServiceRequestAttachment = {
  id: string
  requestId: string
  messageId?: string
  category: ServiceRequestAttachmentCategory
  name: string
  mimeType: string
  size: number
  kind: AttachmentKind
  storagePath?: string
  sourceType: ServiceRequestAttachmentSource
  externalUrl?: string
  uploadedBy: string
  createdAt: string
}

export type ServiceRequestMessage = {
  id: string
  requestId: string
  authorId: string
  content: string
  mentions: ChatMention[]
  createdAt: string
  attachments: ServiceRequestAttachment[]
}

export type ServiceRequestEvent = {
  id: string
  requestId: string
  actorId?: string
  type: string
  title: string
  description?: string
  fromStatus?: ServiceRequestStatus
  toStatus?: ServiceRequestStatus
  createdAt: string
}

export type ServiceRequest = {
  id: string
  workspaceId: string
  orderNumber: string
  requestType: ServiceRequestType
  unit: string
  unitId?: string
  module: string
  subject: string
  title: string
  description: string
  status: ServiceRequestStatus
  priorityRequested: boolean
  priorityReason?: string
  priorityApproved: boolean
  createdBy: string
  assignedAqsId?: string
  responsibleDevId?: string
  executorId?: string
  projectId?: string
  activityId?: string
  aqsSummary?: string
  devSummary?: string
  finalBuild?: string
  createdAt: string
  updatedAt: string
  closedAt?: string
  participantIds: string[]
  attachments: ServiceRequestAttachment[]
  messages: ServiceRequestMessage[]
  events: ServiceRequestEvent[]
}

export type ServiceRequestFileInput = {
  file: File
  category: ServiceRequestAttachmentCategory
}

export type ServiceRequestExternalResourceInput = {
  url: string
  category: ServiceRequestAttachmentCategory
  name: string
}

export type ServiceRequestInput = {
  orderNumber: string
  requestType: ServiceRequestType
  unitId: string
  module: string
  subject: string
  title: string
  description: string
  priorityRequested: boolean
  priorityReason?: string
  files: ServiceRequestFileInput[]
  externalResources: ServiceRequestExternalResourceInput[]
}

export type AqsReviewStatus = "awaiting" | "evaluating" | "completed" | "revoked"

export type AqsReview = {
  id: string
  workspaceId: string
  projectId: string
  activityId: string
  subactivityId: string
  status: AqsReviewStatus
  assignedAqsId?: string
  createdBy: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  revokedAt?: string
  revokedReason?: string
}

export type SupportTopicStatus = "open" | "analyzing" | "sent-to-dev" | "revoked"

export type TopicAttachment = {
  id: string
  topicId: string
  name: string
  mimeType: string
  size: number
  kind: AttachmentKind
  storagePath: string
  uploadedBy: string
  createdAt: string
}

export type SupportTopic = {
  id: string
  workspaceId: string
  orderNumber: string
  title: string
  description: string
  status: SupportTopicStatus
  createdBy: string
  assignedAnalystId?: string
  projectId?: string
  activityId?: string
  developerId?: string
  revokedReason?: string
  createdAt: string
  updatedAt: string
  attachments: TopicAttachment[]
}

export type SupportTopicInput = {
  orderNumber: string
  title: string
  description: string
  files: File[]
}

export const ACCESS_ROLE_LABELS: Record<AccessRole, string> = {
  admin: "Administrador",
  developer: "Desenvolvedor",
  aqs: "AQS",
  support: "Suporte",
  member: "Membro",
}
