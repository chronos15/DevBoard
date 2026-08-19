export type Status =
  | "backlog"
  | "waiting"
  | "in-progress"
  | "paused"
  | "done"
  | "cancelled"

export type Priority = "low" | "medium" | "high"
export type AccessRole = "member" | "admin"

export type UserPreferences = {
  notifyAssignments: boolean
  notifyComments: boolean
  notifyTeamActivity: boolean
  notifyDeadlines: boolean
  timerSticky: boolean
  reducedMotion: boolean
  density: "comfortable" | "compact"
}
export type ActivityFilter = "all" | "open" | "waiting" | "in-progress" | "done"

export type Member = {
  id: string
  name: string
  initials: string
  color: string
  email?: string
  avatarUrl?: string
  role?: AccessRole
}

export type CommentEntry = {
  id: string
  authorId: string
  content: string
  createdAt: string
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
  assigneeId: string
  comments?: CommentEntry[]
  attachments?: AttachmentEntry[]
}

export type Activity = {
  id: string
  title: string
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

export type ChatMessage = {
  id: string
  senderId: string
  content: string
  type?: "text" | "audio"
  mediaPath?: string
  mediaMimeType?: string
  mediaDurationMs?: number
  mediaSizeBytes?: number
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
