"use client"

import * as React from "react"
import {
  Activity as ActivityIcon,
  AtSign,
  Bookmark,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock3,
  Download,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FolderKanban,
  Hash,
  LoaderCircle,
  Menu,
  Mic,
  Paperclip,
  Reply,
  Pause,
  Play,
  Search,
  Send,
  Square,
  Trash2,
  UsersRound,
  X,
} from "lucide-react"
import type {
  AttachmentEntry,
  AttachmentKind,
  AttachmentUploadInput,
  ChatMention,
  CommentEntry,
  Project,
  Status,
  Subactivity,
} from "@/lib/types"
import { useStore } from "@/lib/store"
import {
  formatHMS,
  matchesActivityFilter,
  statusMeta,
} from "@/lib/project-utils"
import type { ActivityFilter } from "@/lib/types"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { ATTACHMENTS_BUCKET } from "@/lib/supabase/helpers"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { ProjectIcon } from "@/components/projects/project-icon"
import { FollowUpSearchDialog, type FollowUpSearchTarget } from "@/components/project-detail/follow-up-search-dialog"
import { ChatAttachmentPreviewDialog } from "@/components/chat/chat-attachment-preview-dialog"
import { FollowUpAddActivityDialog, FollowUpAddSubactivityDialog } from "@/components/project-detail/follow-up-structure-dialogs"

const textExtensions = new Set([
  "sql", "txt", "md", "json", "xml", "csv", "log", "yaml", "yml", "ini", "env",
  "js", "ts", "tsx", "jsx", "css", "html", "dart", "pas",
])
const documentExtensions = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp"])
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_BATCH_BYTES = 150 * 1024 * 1024

function extensionOf(name: string) {
  const index = name.lastIndexOf(".")
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ""
}

function detectKind(file: File): AttachmentKind {
  const extension = extensionOf(file.name)
  if (file.type.startsWith("image/")) return "image"
  if (file.type === "application/pdf" || extension === "pdf") return "pdf"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  if (file.type.startsWith("text/") || textExtensions.has(extension)) return "text"
  if (documentExtensions.has(extension)) return "document"
  return "other"
}

async function fileToUpload(file: File): Promise<AttachmentUploadInput> {
  const kind = detectKind(file)
  const base = { name: file.name, mimeType: file.type, size: file.size, kind }
  if (kind === "text") return { ...base, textContent: await file.text() }
  return { ...base, file }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function formatShortTime(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function statusIsTerminal(status: Status) {
  return status === "done" || status === "cancelled"
}

function mentionToken(mention: ChatMention) {
  return `@${mention.label}`
}

function normalizeFollowUpSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
}

function renderMentionedText(content: string, mentions: ChatMention[] = []) {
  if (!mentions.length) return content
  const unique = Array.from(new Map(mentions.map((mention) => [`${mention.kind}:${mention.id}`, mention])).values())
    .sort((a, b) => mentionToken(b).length - mentionToken(a).length)
  const nodes: React.ReactNode[] = []
  let cursor = 0
  let key = 0
  while (cursor < content.length) {
    let foundIndex = -1
    let found: ChatMention | null = null
    for (const mention of unique) {
      const index = content.indexOf(mentionToken(mention), cursor)
      if (index >= 0 && (foundIndex < 0 || index < foundIndex)) {
        foundIndex = index
        found = mention
      }
    }
    if (!found || foundIndex < 0) {
      nodes.push(content.slice(cursor))
      break
    }
    if (foundIndex > cursor) nodes.push(content.slice(cursor, foundIndex))
    const token = mentionToken(found)
    nodes.push(
      <span key={`mention-${key++}`} className="rounded bg-primary/12 px-1 py-0.5 font-medium text-primary">
        {token}
      </span>,
    )
    cursor = foundIndex + token.length
  }
  return nodes
}

function commentReplySummary(comment: CommentEntry) {
  const text = comment.content.trim()
  return text.length > 120 ? `${text.slice(0, 120)}…` : text
}

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon =
    kind === "image" ? FileImage :
      kind === "video" ? FileVideo :
        kind === "audio" ? FileAudio :
          kind === "text" ? FileCode2 : FileText
  return <Icon className={className} />
}

type TimelineItem =
  | { kind: "comment"; id: string; createdAt: string; authorId: string; comment: CommentEntry }
  | { kind: "attachment"; id: string; createdAt: string; authorId: string; attachment: AttachmentEntry }
  | { kind: "session"; id: string; createdAt: string; authorId: string; durationSeconds: number; endedAt?: string }
  | { kind: "log"; id: string; createdAt: string; authorId?: string; title: string; description?: string }

function MemberLine({
  memberId,
  selectedSub,
}: {
  memberId: string
  selectedSub?: Subactivity
}) {
  const { members, memberPresence } = useStore()
  const member = members.find((item) => item.id === memberId)
  if (!member) return null
  const presence = memberPresence[member.id]
  const online = Boolean(presence?.online)
  const isResponsible = selectedSub?.assigneeId === member.id

  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
      <div className="relative shrink-0">
        <MemberAvatar member={member} className="size-8 text-[0.65rem]" />
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card",
            online ? "bg-success" : "bg-muted-foreground/35",
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className={cn("truncate text-xs font-medium", !online && "text-muted-foreground")}>
          <MemberName member={member} />
        </p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[0.62rem] text-muted-foreground">
          <span className="truncate">{member.role === "admin" ? "Admin" : member.role === "developer" ? "Dev" : member.role?.toUpperCase() ?? "Membro"}</span>
          {isResponsible && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">responsável</span>
          )}
        </div>
      </div>
    </div>
  )
}

function AttachmentCard({
  attachment,
  resolvedUrl,
}: {
  attachment: AttachmentEntry
  resolvedUrl?: string
}) {
  const href = resolvedUrl ?? attachment.dataUrl

  if (attachment.kind === "image" && href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="mt-2 block w-fit max-w-full overflow-hidden rounded-xl border border-border bg-muted/25">
        <img src={href} alt={attachment.name} className="max-h-[360px] max-w-full object-contain" />
      </a>
    )
  }

  if (attachment.kind === "video" && href) {
    return (
      <video src={href} controls className="mt-2 max-h-[360px] max-w-full rounded-xl border border-border bg-black" />
    )
  }

  if (attachment.kind === "audio" && href) {
    return (
      <div className="mt-2 max-w-xl rounded-xl border border-border bg-muted/25 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium">
          <FileAudio className="size-4 text-primary" />
          <span className="truncate">{attachment.name}</span>
        </div>
        <audio src={href} controls className="w-full" />
      </div>
    )
  }

  return (
    <a
      href={href || undefined}
      download={attachment.name}
      target={href ? "_blank" : undefined}
      rel={href ? "noreferrer" : undefined}
      className={cn(
        "mt-2 flex max-w-xl items-center gap-3 rounded-xl border border-border bg-muted/25 p-3 transition-colors",
        href ? "hover:bg-muted/50" : "cursor-default opacity-75",
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-card ring-1 ring-foreground/8">
        <KindIcon kind={attachment.kind} className="size-4 text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">{attachment.name}</span>
        <span className="mt-0.5 block text-[0.65rem] text-muted-foreground">{formatBytes(attachment.size)}</span>
      </span>
      {href && <Download className="size-4 shrink-0 text-muted-foreground" />}
    </a>
  )
}

function MobilePanel({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] xl:hidden">
      <button type="button" aria-label="Fechar painel" className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <section className="absolute inset-y-0 left-0 flex w-[min(88vw,340px)] flex-col border-r border-border bg-card shadow-2xl">
        <header className="flex h-14 items-center justify-between border-b border-border px-4">
          <strong className="text-sm">{title}</strong>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fechar">
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  )
}

export function ProjectFollowUp({
  project,
  filter = "all",
  assigneeId = "all",
  initialSubactivityId,
  onProjectChange,
}: {
  project: Project
  filter?: ActivityFilter
  assigneeId?: string
  initialSubactivityId?: string | null
  onProjectChange?: (projectId: string, subactivityId?: string | null) => void
}) {
  const {
    projects,
    members,
    memberPresence,
    workspaceId,
    workSessions,
    runningSubIds,
    currentUserId,
    currentUserRole,
    canManageSubactivity,
    addFollowUpComment,
    deleteFollowUpComment,
    addSubactivityAttachments,
    deleteActivity,
    startTimer,
    stopTimer,
  } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const messageRef = React.useRef<HTMLTextAreaElement>(null)
  const localSearchInputRef = React.useRef<HTMLInputElement>(null)
  const timelineEndRef = React.useRef<HTMLDivElement>(null)
  const pendingTimelineFocusRef = React.useRef<string | null>(null)
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const mediaStreamRef = React.useRef<MediaStream | null>(null)
  const audioChunksRef = React.useRef<Blob[]>([])
  const recordingStartedAtRef = React.useRef<number>(0)
  const unmountedRef = React.useRef(false)

  const [selectedSubId, setSelectedSubId] = React.useState<string | null>(initialSubactivityId ?? null)
  const [expandedActivities, setExpandedActivities] = React.useState<Set<string>>(() => new Set(project.activities.map((activity) => activity.id)))
  const [message, setMessage] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [uploading, setUploading] = React.useState(false)
  const [recording, setRecording] = React.useState(false)
  const [pendingFiles, setPendingFiles] = React.useState<File[]>([])
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = React.useState(false)
  const [deletingActivityId, setDeletingActivityId] = React.useState<string | null>(null)
  const [recordingSeconds, setRecordingSeconds] = React.useState(0)
  const [resolvedUrls, setResolvedUrls] = React.useState<Record<string, string>>({})
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = React.useState(false)
  const [mobileMembersOpen, setMobileMembersOpen] = React.useState(false)
  const [watchingIds, setWatchingIds] = React.useState<string[]>([])
  const [composerError, setComposerError] = React.useState("")
  const [draftMentions, setDraftMentions] = React.useState<ChatMention[]>([])
  const [mentionRange, setMentionRange] = React.useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = React.useState(0)
  const [replyingTo, setReplyingTo] = React.useState<CommentEntry | null>(null)
  const [markedCommentIds, setMarkedCommentIds] = React.useState<Set<string>>(() => new Set())
  const [focusedCommentId, setFocusedCommentId] = React.useState<string | null>(null)
  const [focusedTimelineId, setFocusedTimelineId] = React.useState<string | null>(null)
  const [localSearchOpen, setLocalSearchOpen] = React.useState(false)
  const [localSearchQuery, setLocalSearchQuery] = React.useState("")
  const [localSearchIndex, setLocalSearchIndex] = React.useState(0)
  const [globalSearchOpen, setGlobalSearchOpen] = React.useState(false)
  const [deletingCommentId, setDeletingCommentId] = React.useState<string | null>(null)
  const [clockNow, setClockNow] = React.useState(() => Date.now())

  const visibleActivities = React.useMemo(
    () => project.activities.map((activity) => ({
      ...activity,
      visibleSubs: activity.subactivities.filter((sub) =>
        matchesActivityFilter(sub.status, filter) && (assigneeId === "all" || sub.assigneeId === assigneeId),
      ),
    })).filter((activity) => activity.visibleSubs.length > 0 || (filter === "all" && assigneeId === "all")),
    [assigneeId, filter, project.activities],
  )

  const visibleSubs = React.useMemo(
    () => visibleActivities.flatMap((activity) => activity.visibleSubs),
    [visibleActivities],
  )

  React.useEffect(() => {
    if (initialSubactivityId && project.activities.some((activity) => activity.subactivities.some((sub) => sub.id === initialSubactivityId))) {
      setSelectedSubId(initialSubactivityId)
    }
  }, [initialSubactivityId, project.activities])

  React.useEffect(() => {
    if (selectedSubId && visibleSubs.some((sub) => sub.id === selectedSubId)) return
    const running = visibleSubs.find((sub) => runningSubIds.includes(sub.id))
    setSelectedSubId(running?.id ?? visibleSubs[0]?.id ?? null)
  }, [runningSubIds, selectedSubId, visibleSubs])

  const selectedContext = React.useMemo(() => {
    for (const activity of project.activities) {
      const sub = activity.subactivities.find((item) => item.id === selectedSubId)
      if (sub) return { activity, sub }
    }
    return null
  }, [project.activities, selectedSubId])

  const selectedSub = selectedContext?.sub
  const selectedActivity = selectedContext?.activity
  const selectedRunning = Boolean(selectedSub && runningSubIds.includes(selectedSub.id))
  const selectedCanManage = Boolean(selectedSub && canManageSubactivity(selectedSub))
  const canManageStructure = currentUserRole === "admin" || project.memberIds.includes(currentUserId)

  const projectMemberIds = React.useMemo(() => {
    const ids = new Set(project.memberIds)
    for (const activity of project.activities) {
      for (const memberId of activity.assigneeIds ?? []) ids.add(memberId)
      for (const sub of activity.subactivities) ids.add(sub.assigneeId)
    }
    return Array.from(ids).filter((id) => members.some((member) => member.id === id))
  }, [members, project.activities, project.memberIds])

  const mentionCandidates = React.useMemo(() => {
    if (!mentionRange) return []
    const query = mentionRange.query.trim().toLocaleLowerCase("pt-BR")
    return members
      .filter((member) => member.id !== currentUserId)
      .filter((member) => !query || member.name.toLocaleLowerCase("pt-BR").includes(query) || member.email?.toLocaleLowerCase("pt-BR").includes(query))
      .sort((a, b) => {
        const aMember = projectMemberIds.includes(a.id) ? 0 : 1
        const bMember = projectMemberIds.includes(b.id) ? 0 : 1
        return aMember - bMember || a.name.localeCompare(b.name, "pt-BR")
      })
      .slice(0, 8)
  }, [currentUserId, members, mentionRange, projectMemberIds])

  const onlineMemberIds = projectMemberIds.filter((id) => memberPresence[id]?.online)
  const offlineMemberIds = projectMemberIds.filter((id) => !memberPresence[id]?.online)

  const accessibleProjects = projects

  const timeline = React.useMemo<TimelineItem[]>(() => {
    if (!selectedSub) return []
    const items: TimelineItem[] = []

    for (const comment of selectedSub.comments ?? []) {
      items.push({ kind: "comment", id: `comment-${comment.id}`, createdAt: comment.createdAt, authorId: comment.authorId, comment })
    }
    for (const attachment of selectedSub.attachments ?? []) {
      items.push({ kind: "attachment", id: `attachment-${attachment.id}`, createdAt: attachment.createdAt, authorId: attachment.uploadedBy, attachment })
    }
    for (const session of workSessions.filter((item) => item.subactivityId === selectedSub.id)) {
      items.push({ kind: "session", id: `session-${session.id}`, createdAt: session.startedAt, authorId: session.userId, durationSeconds: session.durationSeconds, endedAt: session.endedAt })
    }

    const needle = selectedSub.title.trim().toLocaleLowerCase("pt-BR")
    if (needle) {
      for (const log of project.logs ?? []) {
        if (log.title === "Mensagem adicionada no acompanhamento") continue
        const haystack = `${log.title} ${log.description ?? ""}`.toLocaleLowerCase("pt-BR")
        if (!haystack.includes(needle)) continue
        items.push({ kind: "log", id: `log-${log.id}`, createdAt: log.createdAt, authorId: log.actorId, title: log.title, description: log.description })
      }
    }

    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [project.logs, selectedSub, workSessions])

  const localSearchMatches = React.useMemo(() => {
    const needle = normalizeFollowUpSearch(localSearchQuery)
    if (!needle) return []
    const tokens = needle.split(/\s+/).filter(Boolean)

    return timeline.filter((item) => {
      const author = item.authorId ? members.find((member) => member.id === item.authorId) : undefined
      let searchable = `${author?.name ?? ""} ${author?.email ?? ""}`
      if (item.kind === "comment") {
        searchable += ` ${item.comment.content} ${(item.comment.mentions ?? []).map((mention) => mention.label).join(" ")} ${item.comment.replyTo?.content ?? ""}`
      } else if (item.kind === "attachment") {
        searchable += ` ${item.attachment.name} ${item.attachment.mimeType} ${item.attachment.textContent ?? ""}`
      } else if (item.kind === "session") {
        searchable += ` trabalho sessão cronômetro ${formatHMS(item.durationSeconds)}`
      } else {
        searchable += ` ${item.title} ${item.description ?? ""}`
      }
      const haystack = normalizeFollowUpSearch(searchable)
      return tokens.every((token) => haystack.includes(token))
    }).map((item) => item.id)
  }, [localSearchQuery, members, timeline])

  const currentLocalMatchId = localSearchMatches[localSearchIndex] ?? null
  const localSearchMatchSet = React.useMemo(() => new Set(localSearchMatches), [localSearchMatches])

  React.useEffect(() => {
    const commentIds = (selectedSub?.comments ?? []).map((comment) => comment.id)
    setMarkedCommentIds(new Set())
    if (!currentUserId || !commentIds.length) return
    let cancelled = false
    void supabase
      .from("followup_comment_marks")
      .select("comment_id")
      .eq("user_id", currentUserId)
      .in("comment_id", commentIds)
      .then(({ data, error }) => {
        if (cancelled || error) return
        setMarkedCommentIds(new Set((data ?? []).map((row: any) => row.comment_id)))
      })
    return () => { cancelled = true }
  }, [currentUserId, selectedSub?.comments, supabase])

  React.useEffect(() => {
    if (!workspaceId || !currentUserId || !selectedSubId) {
      setWatchingIds([])
      return
    }

    const channel = supabase.channel(`devboard-followup:${workspaceId}:${project.id}:${selectedSubId}`, {
      config: { presence: { key: currentUserId } },
    })

    const sync = () => {
      const state = channel.presenceState() as Record<string, Array<{ user_id?: string }>>
      const ids = new Set<string>()
      for (const [key, presences] of Object.entries(state)) {
        if (key) ids.add(key.split(":")[0])
        for (const presence of presences ?? []) {
          if (presence?.user_id) ids.add(presence.user_id)
        }
      }
      setWatchingIds(Array.from(ids).filter((id) => projectMemberIds.includes(id)))
    }

    channel
      .on("presence", { event: "sync" }, sync)
      .on("presence", { event: "join" }, sync)
      .on("presence", { event: "leave" }, sync)
      .subscribe(async (status) => {
        if (status !== "SUBSCRIBED") return
        await channel.track({
          user_id: currentUserId,
          project_id: project.id,
          subactivity_id: selectedSubId,
          opened_at: new Date().toISOString(),
        })
      })

    return () => {
      void channel.untrack()
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, project.id, projectMemberIds, selectedSubId, supabase, workspaceId])

  React.useEffect(() => {
    const attachments = selectedSub?.attachments ?? []
    const pending = attachments.filter((attachment) => attachment.storagePath && !attachment.dataUrl && !resolvedUrls[attachment.id])
    if (!pending.length) return
    let cancelled = false

    void Promise.all(pending.map(async (attachment) => {
      const { data, error } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(attachment.storagePath!, 3600)
      if (error || !data?.signedUrl || cancelled) return
      setResolvedUrls((current) => ({ ...current, [attachment.id]: data.signedUrl }))
    }))

    return () => { cancelled = true }
  }, [resolvedUrls, selectedSub?.attachments, supabase])

  React.useEffect(() => {
    const timer = window.setTimeout(() => timelineEndRef.current?.scrollIntoView({ block: "end" }), 60)
    return () => window.clearTimeout(timer)
  }, [selectedSubId, timeline.length])

  React.useEffect(() => {
    setMentionIndex(0)
  }, [mentionRange?.query])

  React.useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    if (!recording) {
      setRecordingSeconds(0)
      return
    }
    const id = window.setInterval(() => {
      setRecordingSeconds(Math.max(0, Math.round((Date.now() - recordingStartedAtRef.current) / 1000)))
    }, 500)
    return () => window.clearInterval(id)
  }, [recording])

  React.useEffect(() => () => {
    unmountedRef.current = true
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== "inactive") recorder.stop()
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  React.useEffect(() => {
    setLocalSearchIndex(0)
  }, [localSearchQuery, selectedSubId])

  React.useEffect(() => {
    const pending = pendingTimelineFocusRef.current
    if (!pending || !timeline.some((item) => item.id === pending)) return
    const timer = window.setTimeout(() => {
      focusTimelineItem(pending)
      pendingTimelineFocusRef.current = null
    }, 80)
    return () => window.clearTimeout(timer)
  }, [selectedSubId, timeline])

  React.useEffect(() => {
    function handleSearchShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      const key = event.key.toLocaleLowerCase("pt-BR")
      if (key === "f") {
        event.preventDefault()
        setLocalSearchOpen(true)
        window.requestAnimationFrame(() => {
          localSearchInputRef.current?.focus()
          localSearchInputRef.current?.select()
        })
        return
      }
      if (key === "k") {
        event.preventDefault()
        setGlobalSearchOpen(true)
      }
    }
    window.addEventListener("keydown", handleSearchShortcut, { capture: true })
    return () => window.removeEventListener("keydown", handleSearchShortcut, { capture: true })
  }, [])

  React.useEffect(() => {
    resizeComposer()
  }, [message, selectedSubId])

  React.useEffect(() => {
    function onResize() { resizeComposer() }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  function resizeComposer(textarea = messageRef.current) {
    if (!textarea) return
    textarea.style.height = "auto"
    const maxHeight = Math.max(132, Math.min(440, Math.round(window.innerHeight * 0.48)))
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight)
    textarea.style.height = `${Math.max(28, nextHeight)}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden"
  }

  function focusTimelineItem(itemId: string) {
    const element = document.getElementById(`followup-timeline-${itemId}`)
    if (!element) return
    element.scrollIntoView({ behavior: "smooth", block: "center" })
    setFocusedTimelineId(itemId)
    window.setTimeout(() => setFocusedTimelineId((current) => current === itemId ? null : current), 1600)
  }

  function moveLocalSearch(direction: 1 | -1) {
    if (!localSearchMatches.length) return
    const focusedIndex = focusedTimelineId ? localSearchMatches.indexOf(focusedTimelineId) : -1
    const base = focusedIndex >= 0 ? focusedIndex : (direction > 0 ? -1 : 0)
    const next = (base + direction + localSearchMatches.length) % localSearchMatches.length
    setLocalSearchIndex(next)
    focusTimelineItem(localSearchMatches[next])
  }

  function openGlobalSearchResult(target: FollowUpSearchTarget) {
    if (target.projectId !== project.id) {
      onProjectChange?.(target.projectId, target.subactivityId ?? null)
      return
    }

    if (target.subactivityId && target.subactivityId !== selectedSubId) {
      if (target.timelineId) pendingTimelineFocusRef.current = target.timelineId
      selectSubactivity(target.subactivityId)
      return
    }

    if (target.timelineId) focusTimelineItem(target.timelineId)
  }

  function toggleActivity(activityId: string) {
    setExpandedActivities((current) => {
      const next = new Set(current)
      if (next.has(activityId)) next.delete(activityId)
      else next.add(activityId)
      return next
    })
  }

  function selectSubactivity(subId: string) {
    setSelectedSubId(subId)
    setReplyingTo(null)
    setDraftMentions([])
    setMentionRange(null)
    setMobileNavigatorOpen(false)
    const url = new URL(window.location.href)
    if (window.location.pathname.startsWith("/acompanhamento")) {
      url.searchParams.set("project", project.id)
      url.searchParams.set("sub", subId)
      url.hash = ""
      window.history.replaceState({}, "", url)
    } else if (window.location.pathname === `/projetos/${project.id}`) {
      url.hash = `sub-${subId}`
      window.history.replaceState({}, "", url)
    }
  }

  function detectMention(value: string, caret: number | null) {
    const position = caret ?? value.length
    const before = value.slice(0, position)
    const match = before.match(/(?:^|\s)@([^\s@]*)$/)
    if (!match) {
      setMentionRange(null)
      return
    }
    const query = match[1] ?? ""
    setMentionRange({ start: position - query.length - 1, end: position, query })
  }

  function selectMention(memberId: string) {
    if (!mentionRange) return
    const member = members.find((item) => item.id === memberId)
    if (!member) return
    const mention: ChatMention = { kind: "user", id: member.id, label: member.name }
    const token = mentionToken(mention)
    const next = `${message.slice(0, mentionRange.start)}${token} ${message.slice(mentionRange.end)}`
    const caret = mentionRange.start + token.length + 1
    setMessage(next)
    setDraftMentions((current) => current.some((item) => item.kind === "user" && item.id === member.id) ? current : [...current, mention])
    setMentionRange(null)
    window.requestAnimationFrame(() => {
      messageRef.current?.focus()
      messageRef.current?.setSelectionRange(caret, caret)
    })
  }

  function beginMention() {
    const textarea = messageRef.current
    const caret = textarea?.selectionStart ?? message.length
    const needsSpace = caret > 0 && !/\s/.test(message.charAt(caret - 1))
    const insertion = `${needsSpace ? " " : ""}@`
    const next = `${message.slice(0, caret)}${insertion}${message.slice(caret)}`
    const nextCaret = caret + insertion.length
    setMessage(next)
    setMentionRange({ start: nextCaret - 1, end: nextCaret, query: "" })
    window.requestAnimationFrame(() => {
      textarea?.focus()
      textarea?.setSelectionRange(nextCaret, nextCaret)
    })
  }

  function focusComment(commentId: string) {
    focusTimelineItem(`comment-${commentId}`)
    setFocusedCommentId(commentId)
    window.setTimeout(() => setFocusedCommentId((current) => current === commentId ? null : current), 1500)
  }

  async function toggleCommentMark(commentId: string) {
    const nextMarked = !markedCommentIds.has(commentId)
    const { error } = await supabase.rpc("toggle_followup_comment_mark", {
      p_comment_id: commentId,
      p_marked: nextMarked,
    })
    if (error) {
      setComposerError(error.message || "Não foi possível marcar a mensagem.")
      return
    }
    setMarkedCommentIds((current) => {
      const next = new Set(current)
      if (nextMarked) next.add(commentId)
      else next.delete(commentId)
      return next
    })
  }

  async function deleteComment(comment: CommentEntry) {
    if (deletingCommentId) return
    if (!window.confirm("Excluir esta mensagem do acompanhamento?")) return
    setDeletingCommentId(comment.id)
    try {
      const ok = await deleteFollowUpComment(comment.id)
      if (ok && replyingTo?.id === comment.id) setReplyingTo(null)
    } finally {
      setDeletingCommentId(null)
    }
  }

  function canDeleteComment(comment: CommentEntry) {
    if (currentUserRole === "admin") return true
    if (comment.authorId !== currentUserId) return false
    return clockNow - new Date(comment.createdAt).getTime() <= 30 * 60 * 1000
  }

  async function sendMessage() {
    if (!selectedSub || sending) return
    const content = message.trim()
    if (!content) return
    const validMentions = draftMentions.filter((mention) => content.includes(mentionToken(mention)))
    setSending(true)
    try {
      const ok = await addFollowUpComment(selectedSub.id, content, validMentions, replyingTo?.id)
      if (ok) {
        setMessage("")
        setDraftMentions([])
        setMentionRange(null)
        setReplyingTo(null)
        messageRef.current?.focus()
      }
    } finally {
      setSending(false)
    }
  }

  function validateFiles(files: File[]) {
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
    if (files.some((file) => file.size > MAX_FILE_BYTES)) return "Cada arquivo pode ter no máximo 50 MB."
    if (totalBytes > MAX_BATCH_BYTES) return "O envio pode ter no máximo 150 MB por vez."
    return ""
  }

  function queueFilesForPreview(files: File[]) {
    if (!selectedSub || !files.length || uploading) return
    const error = validateFiles(files)
    if (error) {
      setComposerError(error)
      return
    }
    setComposerError("")
    setPendingFiles(files)
    setAttachmentPreviewOpen(true)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function uploadFiles(files: File[], caption = "") {
    if (!selectedSub || !files.length || uploading) return false
    const error = validateFiles(files)
    if (error) {
      setComposerError(error)
      return false
    }
    setComposerError("")
    setUploading(true)
    try {
      const prepared = await Promise.all(files.map(fileToUpload))
      const ok = await addSubactivityAttachments(selectedSub.id, prepared)
      if (!ok) {
        setComposerError("Não foi possível enviar os arquivos.")
        return false
      }
      const cleanCaption = caption.trim()
      if (cleanCaption) {
        const captionOk = await addFollowUpComment(selectedSub.id, cleanCaption, [], undefined)
        if (!captionOk) setComposerError("Os arquivos foram enviados, mas não foi possível salvar a legenda.")
      }
      return true
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function sendPendingFiles(caption: string) {
    const ok = await uploadFiles(pendingFiles, caption)
    if (!ok) return
    setPendingFiles([])
    setAttachmentPreviewOpen(false)
  }

  async function startRecording() {
    if (!selectedSub || recording || uploading) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setComposerError("A gravação de áudio não está disponível neste navegador.")
      return
    }
    setComposerError("")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []
      recordingStartedAtRef.current = Date.now()

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      })
      recorder.addEventListener("stop", async () => {
        const durationSeconds = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1000))
        const mimeType = recorder.mimeType || "audio/webm"
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm"
        const file = new File([blob], `audio-${Date.now()}.${extension}`, { type: mimeType })
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        audioChunksRef.current = []
        setRecording(false)
        setRecordingSeconds(durationSeconds)
        if (!unmountedRef.current) await uploadFiles([file])
      })

      recorder.start(250)
      setRecording(true)
    } catch (error) {
      console.error("[Devboard/Acompanhamento] Não foi possível iniciar o microfone:", error)
      setComposerError("Não foi possível acessar o microfone. Verifique a permissão do navegador.")
    }
  }

  function stopRecording() {
    if (!recording) return
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== "inactive") recorder.stop()
  }

  async function removeEmptyActivity(activityId: string, title: string) {
    if (!canManageStructure || deletingActivityId) return
    const activity = project.activities.find((item) => item.id === activityId)
    if (!activity || activity.subactivities.length > 0) return
    if (!window.confirm(`Excluir a atividade “${title}”? Esta ação só está disponível porque ela ainda não possui subatividades.`)) return
    setDeletingActivityId(activityId)
    try {
      const ok = await deleteActivity(project.id, activityId)
      if (ok && selectedActivity?.id === activityId) setSelectedSubId(null)
    } finally {
      setDeletingActivityId(null)
    }
  }

  const navigatorContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary"><ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-4" imageClassName="size-full rounded-none object-cover" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{project.name}</p>
            <p className="truncate text-[0.65rem] text-muted-foreground">Atividades e subatividades</p>
          </div>
          {canManageStructure && <FollowUpAddActivityDialog projectId={project.id} />}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin]">
        {visibleActivities.map((activity, index) => {
          const expanded = expandedActivities.has(activity.id)
          const runningCount = activity.subactivities.filter((sub) => runningSubIds.includes(sub.id)).length
          return (
            <div key={activity.id} className="mb-1">
              <div className="group/activity flex min-w-0 items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => toggleActivity(activity.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {expanded ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                  <Hash className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{index + 1}. {activity.title}</span>
                  {runningCount > 0 && <span className="size-1.5 shrink-0 rounded-full bg-success" title="Possui execução ativa" />}
                </button>
                {canManageStructure && (
                  <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover/activity:opacity-100 sm:group-focus-within/activity:opacity-100">
                    <FollowUpAddSubactivityDialog projectId={project.id} activityId={activity.id} />
                    {activity.subactivities.length === 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={deletingActivityId === activity.id}
                        onClick={() => void removeEmptyActivity(activity.id, activity.title)}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Excluir atividade vazia"
                        aria-label={`Excluir atividade ${activity.title}`}
                      >
                        {deletingActivityId === activity.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {expanded && (
                <div className="ml-2 border-l border-border pl-1.5">
                  {activity.visibleSubs.length ? activity.visibleSubs.map((sub) => {
                    const meta = statusMeta[sub.status]
                    const selected = sub.id === selectedSubId
                    const running = runningSubIds.includes(sub.id)
                    const assignee = members.find((member) => member.id === sub.assigneeId)
                    return (
                      <button
                        type="button"
                        key={sub.id}
                        onClick={() => selectSubactivity(sub.id)}
                        className={cn(
                          "group my-0.5 flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                          selected ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted/65 hover:text-foreground",
                        )}
                      >
                        <span className={cn("size-1.5 shrink-0 rounded-full", running ? "bg-success" : meta.columnClassName)} />
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-[0.72rem]", selected && "font-medium")}>{sub.title}</p>
                          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.58rem] text-muted-foreground">
                            <span className="truncate">{meta.label}</span>
                            <span>·</span>
                            <span className="font-mono tabular-nums">{formatHMS(sub.trackedSeconds)}</span>
                          </div>
                        </div>
                        <MemberAvatar member={assignee} profileEnabled={false} className="size-5 text-[0.48rem] ring-1 ring-card" />
                      </button>
                    )
                  }) : (
                    <p className="px-2 py-2 text-[0.65rem] text-muted-foreground/70">Sem subatividades neste filtro.</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {visibleActivities.length === 0 && (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">Nada corresponde aos filtros atuais.</div>
        )}
      </div>
    </div>
  )

  const membersContent = (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3 [scrollbar-width:thin]">
      <div className="mb-4">
        <p className="mb-1.5 px-2 text-[0.62rem] font-semibold tracking-wide text-muted-foreground uppercase">Nesta subatividade — {watchingIds.length}</p>
        {watchingIds.map((id) => <MemberLine key={`watching-${id}`} memberId={id} selectedSub={selectedSub} />)}
        {!watchingIds.length && <p className="px-2 py-2 text-[0.65rem] text-muted-foreground/60">Nenhum outro usuário acompanhando agora.</p>}
      </div>
      <div className="mb-4 border-t border-border pt-3">
        <p className="mb-1.5 px-2 text-[0.62rem] font-semibold tracking-wide text-muted-foreground uppercase">Online — {onlineMemberIds.length}</p>
        {onlineMemberIds.map((id) => <MemberLine key={id} memberId={id} selectedSub={selectedSub} />)}
        {!onlineMemberIds.length && <p className="px-2 py-2 text-[0.65rem] text-muted-foreground/60">Ninguém online agora.</p>}
      </div>
      <div>
        <p className="mb-1.5 px-2 text-[0.62rem] font-semibold tracking-wide text-muted-foreground uppercase">Offline — {offlineMemberIds.length}</p>
        {offlineMemberIds.map((id) => <MemberLine key={id} memberId={id} selectedSub={selectedSub} />)}
      </div>
    </div>
  )

  return (
    <>
      <div className="grid h-full min-h-0 w-full min-w-0 overflow-hidden bg-card md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[64px_290px_minmax(0,1fr)_245px]">
        <nav className="hidden min-h-0 flex-col border-r border-border bg-muted/30 xl:flex" aria-label="Projetos no acompanhamento">
          <div className="flex h-12 items-center justify-center border-b border-border">
            <FolderKanban className="size-4 text-muted-foreground" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex flex-col items-center gap-2">
              {accessibleProjects.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => item.id !== project.id && onProjectChange?.(item.id)}
                  title={`Abrir ${item.name}`}
                  className={cn(
                    "relative flex size-10 items-center justify-center overflow-hidden rounded-xl text-xs font-semibold transition-all",
                    item.id === project.id
                      ? "rounded-[14px] bg-primary text-primary-foreground shadow-sm"
                      : "bg-card text-muted-foreground ring-1 ring-foreground/8 hover:rounded-[14px] hover:bg-primary/10 hover:text-primary",
                  )}
                >
                  <ProjectIcon icon={item.icon} imageUrl={item.iconImageUrl} className="size-4" imageClassName="size-full rounded-[inherit] object-cover" />
                  {item.id === project.id && <span className="absolute -left-2.5 h-6 w-1 rounded-r-full bg-primary" />}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <aside className="hidden min-h-0 flex-col border-r border-border bg-muted/20 md:flex">
          {navigatorContent}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col bg-background/55">
          {selectedSub && selectedActivity ? (
            <>
              <header className="flex min-h-12 min-w-0 items-center gap-2 border-b border-border bg-card/90 px-2.5 py-2 backdrop-blur sm:px-3">
                <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileNavigatorOpen(true)} aria-label="Abrir atividades">
                  <Menu className="size-4" />
                </Button>
                <Hash className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="hidden truncate text-[0.67rem] text-muted-foreground lg:inline">{selectedActivity.title}</span>
                    <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/60 lg:block" />
                    <strong className="truncate text-xs sm:text-sm">{selectedSub.title}</strong>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[0.6rem] text-muted-foreground sm:hidden">
                    <span className={cn("size-1.5 rounded-full", selectedRunning ? "bg-success" : statusMeta[selectedSub.status].columnClassName)} />
                    <span>{statusMeta[selectedSub.status].label}</span>
                  </div>
                </div>
                <div className="hidden items-center gap-1.5 sm:flex">
                  <span className={cn("rounded-full px-2 py-1 text-[0.62rem] font-medium", statusMeta[selectedSub.status].className)}>
                    {statusMeta[selectedSub.status].label}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-1 font-mono text-[0.62rem] text-muted-foreground tabular-nums">{formatHMS(selectedSub.trackedSeconds)}</span>
                </div>
                <Button
                  type="button"
                  variant={localSearchOpen ? "secondary" : "ghost"}
                  size="icon-sm"
                  onClick={() => {
                    setLocalSearchOpen((current) => {
                      const next = !current
                      if (next) window.requestAnimationFrame(() => localSearchInputRef.current?.focus())
                      return next
                    })
                  }}
                  title="Pesquisar nesta subatividade (Ctrl + F)"
                  aria-label="Pesquisar nesta subatividade"
                >
                  <Search className="size-4" />
                </Button>
                {markedCommentIds.size > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="hidden h-8 gap-1.5 px-2 text-[0.62rem] text-primary lg:flex"
                    onClick={() => {
                      const first = (selectedSub.comments ?? []).find((comment) => markedCommentIds.has(comment.id))
                      if (first) focusComment(first.id)
                    }}
                    title="Ir para uma mensagem marcada"
                  >
                    <Bookmark className="size-3.5 fill-current" /> {markedCommentIds.size}
                  </Button>
                )}
                {selectedCanManage && !statusIsTerminal(selectedSub.status) && selectedSub.status !== "waiting-aqs" && (
                  <Button
                    type="button"
                    variant={selectedRunning ? "outline" : "default"}
                    size="icon-sm"
                    onClick={() => void (selectedRunning ? stopTimer(selectedSub.id) : startTimer(selectedSub.id))}
                    title={selectedRunning ? "Pausar cronômetro" : "Iniciar cronômetro"}
                    aria-label={selectedRunning ? "Pausar cronômetro" : "Iniciar cronômetro"}
                  >
                    {selectedRunning ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon-sm" className="xl:hidden" onClick={() => setMobileMembersOpen(true)} aria-label="Ver equipe">
                  <UsersRound className="size-4" />
                </Button>
              </header>

              {localSearchOpen && (
                <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-border bg-card/95 px-2.5 py-2 sm:px-3">
                  <Search className="size-3.5 shrink-0 text-muted-foreground" />
                  <input
                    ref={localSearchInputRef}
                    value={localSearchQuery}
                    onChange={(event) => setLocalSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault()
                        setLocalSearchOpen(false)
                        messageRef.current?.focus()
                        return
                      }
                      if (event.key === "Enter" && currentLocalMatchId) {
                        event.preventDefault()
                        moveLocalSearch(event.shiftKey ? -1 : 1)
                      }
                    }}
                    placeholder={`Pesquisar em “${selectedSub.title}”`}
                    className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/65"
                  />
                  <span className="shrink-0 font-mono text-[0.6rem] text-muted-foreground">
                    {localSearchQuery.trim() ? `${localSearchMatches.length ? localSearchIndex + 1 : 0}/${localSearchMatches.length}` : "Ctrl F"}
                  </span>
                  <button type="button" disabled={!localSearchMatches.length} onClick={() => moveLocalSearch(-1)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35" title="Resultado anterior" aria-label="Resultado anterior">
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button type="button" disabled={!localSearchMatches.length} onClick={() => moveLocalSearch(1)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35" title="Próximo resultado" aria-label="Próximo resultado">
                    <ChevronDown className="size-3.5" />
                  </button>
                  <button type="button" onClick={() => setLocalSearchOpen(false)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Fechar pesquisa" aria-label="Fechar pesquisa">
                    <X className="size-3.5" />
                  </button>
                </div>
              )}

              <div
                className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 lg:px-6 [scrollbar-width:thin]"
                onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }}
                onDrop={(event) => {
                  event.preventDefault()
                  const files = Array.from(event.dataTransfer.files ?? [])
                  if (files.length) queueFilesForPreview(files)
                }}
              >
                <div className="mx-auto w-full max-w-4xl">
                  <div className="mb-6 border-b border-border pb-5">
                    <div className="flex items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Hash className="size-5" /></span>
                      <div className="min-w-0">
                        <h2 className="break-words text-lg font-semibold">{selectedSub.title}</h2>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Acompanhamento central da subatividade. Comentários, evidências, áudios e registros de execução aparecem aqui em ordem cronológica.
                        </p>
                      </div>
                    </div>
                  </div>

                  {timeline.length === 0 ? (
                    <div className="flex min-h-72 flex-col items-center justify-center text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted"><ActivityIcon className="size-5 text-muted-foreground" /></span>
                      <p className="mt-4 text-sm font-medium">Nenhum acompanhamento registrado</p>
                      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">Envie a primeira mensagem, anexe uma evidência ou grave um áudio para iniciar o histórico desta subatividade.</p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {timeline.map((item) => {
                        const isLocalMatch = localSearchMatchSet.has(item.id)
                        const isCurrentLocalMatch = currentLocalMatchId === item.id
                        if (item.kind === "session") {
                          const member = members.find((entry) => entry.id === item.authorId)
                          return (
                            <div id={`followup-timeline-${item.id}`} key={item.id} className={cn("my-2 flex items-center gap-2 rounded-lg px-1 py-1 text-[0.68rem] text-muted-foreground transition-colors", isLocalMatch && "bg-warning/8", isCurrentLocalMatch && "bg-warning/15 ring-1 ring-warning/25", focusedTimelineId === item.id && "bg-primary/8 ring-2 ring-primary/15")}>
                              <Clock3 className="size-3.5 shrink-0" />
                              <span className="min-w-0 truncate"><MemberName member={member} fallback="Usuário" /> registrou {formatHMS(item.durationSeconds)} de trabalho</span>
                              <time className="ml-auto shrink-0 font-mono text-[0.6rem]">{formatShortTime(item.createdAt)}</time>
                            </div>
                          )
                        }

                        if (item.kind === "log") {
                          return (
                            <div id={`followup-timeline-${item.id}`} key={item.id} className={cn("my-2 flex items-start gap-2 rounded-lg bg-muted/35 px-3 py-2 text-[0.68rem] text-muted-foreground transition-all", isLocalMatch && "bg-warning/8", isCurrentLocalMatch && "bg-warning/15 ring-1 ring-warning/25", focusedTimelineId === item.id && "bg-primary/8 ring-2 ring-primary/15")}>
                              <ActivityIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-foreground/80">{item.title}</p>
                                {item.description && <p className="mt-0.5 break-words leading-relaxed">{item.description}</p>}
                              </div>
                              <time className="shrink-0 font-mono text-[0.6rem]">{formatShortTime(item.createdAt)}</time>
                            </div>
                          )
                        }

                        const author = members.find((entry) => entry.id === item.authorId)
                        if (item.kind === "comment") {
                          const comment = item.comment
                          const marked = markedCommentIds.has(comment.id)
                          const replyAuthor = comment.replyTo?.authorId ? members.find((entry) => entry.id === comment.replyTo?.authorId) : undefined
                          return (
                            <article
                              key={item.id}
                              id={`followup-timeline-${item.id}`}
                              onContextMenu={(event) => { event.preventDefault(); setReplyingTo(comment); messageRef.current?.focus() }}
                              className={cn(
                                "group/message relative flex min-w-0 gap-3 rounded-xl border border-transparent px-2 py-2.5 transition-all hover:bg-muted/25 sm:px-3",
                                marked && "border-primary/15 bg-primary/[0.035]",
                                focusedCommentId === comment.id && "border-primary/30 bg-primary/[0.07] ring-2 ring-primary/10",
                                isLocalMatch && "border-warning/20 bg-warning/[0.035]",
                                isCurrentLocalMatch && "border-warning/35 bg-warning/[0.07] ring-2 ring-warning/10",
                                focusedTimelineId === item.id && "border-primary/30 bg-primary/[0.07] ring-2 ring-primary/10",
                              )}
                            >
                              <MemberAvatar member={author} className="mt-0.5 size-9 text-[0.68rem]" />
                              <div className="min-w-0 flex-1 pr-1 sm:pr-20">
                                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                  <strong className="truncate text-xs"><MemberName member={author} fallback="Usuário" /></strong>
                                  <time className="shrink-0 text-[0.62rem] text-muted-foreground">{formatDate(item.createdAt)}</time>
                                  {marked && <span className="inline-flex items-center gap-1 text-[0.58rem] font-medium text-primary"><Bookmark className="size-3 fill-current" /> marcada</span>}
                                </div>
                                {comment.replyTo && (
                                  <button
                                    type="button"
                                    disabled={comment.replyTo.unavailable}
                                    onClick={() => !comment.replyTo?.unavailable && focusComment(comment.replyTo!.commentId)}
                                    className={cn(
                                      "mt-1.5 block max-w-full overflow-hidden rounded-lg border border-border bg-muted/35 px-2.5 py-2 text-left text-[0.68rem] transition-colors",
                                      comment.replyTo.unavailable ? "cursor-default opacity-60" : "hover:bg-muted/60",
                                    )}
                                  >
                                    <span className="block truncate font-medium text-foreground/75">
                                      {comment.replyTo.unavailable ? "Mensagem original indisponível" : <><MemberName member={replyAuthor} fallback="Usuário" /> · resposta</>}
                                    </span>
                                    {!comment.replyTo.unavailable && <span className="mt-0.5 block truncate text-muted-foreground">{comment.replyTo.content || "Mensagem"}</span>}
                                  </button>
                                )}
                                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
                                  {renderMentionedText(comment.content, comment.mentions)}
                                </p>
                              </div>
                              <div className="absolute right-2 top-2 flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5 opacity-100 shadow-sm transition-opacity sm:opacity-0 sm:group-hover/message:opacity-100 sm:group-focus-within/message:opacity-100">
                                <button type="button" onClick={() => setReplyingTo(comment)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary" title="Responder" aria-label="Responder mensagem"><Reply className="size-3.5" /></button>
                                <button type="button" onClick={() => void toggleCommentMark(comment.id)} className={cn("flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary", marked && "text-primary")} title={marked ? "Desmarcar mensagem" : "Marcar mensagem"} aria-label={marked ? "Desmarcar mensagem" : "Marcar mensagem"}><Bookmark className={cn("size-3.5", marked && "fill-current")} /></button>
                                {canDeleteComment(comment) && (
                                  <button type="button" disabled={deletingCommentId === comment.id} onClick={() => void deleteComment(comment)} className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50" title={currentUserRole === "admin" ? "Excluir mensagem" : "Excluir mensagem (até 30 min)"} aria-label="Excluir mensagem">
                                    {deletingCommentId === comment.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                                  </button>
                                )}
                              </div>
                            </article>
                          )
                        }

                        return (
                          <article id={`followup-timeline-${item.id}`} key={item.id} className={cn("group flex min-w-0 gap-3 rounded-lg px-1 py-2.5 transition-all hover:bg-muted/25 sm:px-2", isLocalMatch && "bg-warning/[0.035]", isCurrentLocalMatch && "bg-warning/[0.07] ring-1 ring-warning/25", focusedTimelineId === item.id && "bg-primary/[0.07] ring-2 ring-primary/10")}>
                            <MemberAvatar member={author} className="mt-0.5 size-9 text-[0.68rem]" />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-baseline gap-2">
                                <strong className="truncate text-xs"><MemberName member={author} fallback="Usuário" /></strong>
                                <time className="shrink-0 text-[0.62rem] text-muted-foreground">{formatDate(item.createdAt)}</time>
                              </div>
                              <p className="mt-1 text-sm leading-relaxed text-foreground/90">enviou um arquivo</p>
                              <AttachmentCard attachment={item.attachment} resolvedUrl={resolvedUrls[item.attachment.id]} />
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                  <div ref={timelineEndRef} />
                </div>
              </div>

              <footer className="relative border-t border-border bg-card/95 p-2.5 sm:p-3">
                <div className="mx-auto w-full max-w-4xl">
                  {replyingTo && (
                    <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.045] px-3 py-2">
                      <Reply className="size-3.5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.62rem] font-semibold text-primary">Respondendo a <MemberName member={members.find((member) => member.id === replyingTo.authorId)} fallback="Usuário" /></p>
                        <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">{commentReplySummary(replyingTo)}</p>
                      </div>
                      <button type="button" onClick={() => setReplyingTo(null)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Cancelar resposta"><X className="size-3.5" /></button>
                    </div>
                  )}

                  {mentionRange && mentionCandidates.length > 0 && (
                    <div className="absolute bottom-[calc(100%-0.25rem)] left-3 right-3 z-20 mx-auto max-h-72 max-w-4xl overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-xl sm:left-4 sm:right-4">
                      <div className="px-2 py-1 text-[0.6rem] font-semibold tracking-wide text-muted-foreground uppercase">Mencionar usuário</div>
                      {mentionCandidates.map((member, index) => {
                        const alreadyInProject = projectMemberIds.includes(member.id)
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectMention(member.id)}
                            className={cn(
                              "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                              index === mentionIndex ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                            )}
                          >
                            <MemberAvatar member={member} profileEnabled={false} className="size-7 text-[0.55rem]" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium">{member.name}</p>
                              <p className="truncate text-[0.6rem] text-muted-foreground">{member.email}</p>
                            </div>
                            {!alreadyInProject && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-[0.58rem] font-medium text-primary">adicionar ao projeto</span>}
                            {index === mentionIndex && <span className="hidden text-[0.58rem] text-muted-foreground sm:inline">Enter</span>}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex items-end gap-1.5 rounded-xl border border-border bg-background px-2 py-2 shadow-sm focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/10">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => queueFilesForPreview(Array.from(event.target.files ?? []))}
                    />
                    <Button type="button" variant="ghost" size="icon-sm" disabled={uploading || recording} onClick={() => fileInputRef.current?.click()} title="Anexar arquivos" aria-label="Anexar arquivos">
                      {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Paperclip className="size-4" />}
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={recording} onClick={beginMention} title="Mencionar usuário" aria-label="Mencionar usuário">
                      <AtSign className="size-4" />
                    </Button>
                    <textarea
                      ref={messageRef}
                      value={message}
                      onChange={(event) => {
                        const value = event.target.value
                        setMessage(value)
                        setDraftMentions((current) => current.filter((mention) => value.includes(mentionToken(mention))))
                        detectMention(value, event.target.selectionStart)
                        resizeComposer(event.currentTarget)
                      }}
                      onKeyDown={(event) => {
                        if (mentionRange && mentionCandidates.length > 0) {
                          if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((current) => (current + 1) % mentionCandidates.length); return }
                          if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length); return }
                          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); selectMention(mentionCandidates[mentionIndex]?.id ?? mentionCandidates[0].id); return }
                          if (event.key === "Escape") { event.preventDefault(); setMentionRange(null); return }
                        }
                        if (event.key === "Escape" && replyingTo) { event.preventDefault(); setReplyingTo(null); return }
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault()
                          void sendMessage()
                        }
                      }}
                      onPaste={(event) => {
                        const files = Array.from(event.clipboardData.files ?? [])
                        if (!files.length) return
                        event.preventDefault()
                        queueFilesForPreview(files)
                      }}
                      rows={1}
                      placeholder={`Conversar em “${selectedSub.title}” · use @ para mencionar`}
                      className="min-h-7 min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent px-1 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70"
                    />
                    {recording ? (
                      <div className="flex shrink-0 items-center gap-1.5 rounded-lg bg-destructive/10 px-2 py-1 text-[0.65rem] font-medium text-destructive">
                        <span className="size-1.5 animate-pulse rounded-full bg-destructive" />
                        {formatHMS(recordingSeconds)}
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant={recording ? "destructive" : "ghost"}
                      size="icon-sm"
                      disabled={uploading}
                      onClick={recording ? stopRecording : startRecording}
                      title={recording ? "Parar e enviar áudio" : "Gravar áudio"}
                      aria-label={recording ? "Parar e enviar áudio" : "Gravar áudio"}
                    >
                      {recording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
                    </Button>
                    <Button type="button" size="icon-sm" disabled={!message.trim() || sending || recording} onClick={() => void sendMessage()} title="Enviar mensagem" aria-label="Enviar mensagem">
                      {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                    </Button>
                  </div>
                  {composerError ? (
                    <p className="mt-1.5 px-1 text-[0.62rem] font-medium text-destructive">{composerError}</p>
                  ) : (
                    <p className="mt-1.5 px-1 text-[0.58rem] text-muted-foreground/70">Enter envia · Shift+Enter quebra linha · @ menciona · Ctrl+F pesquisa aqui · Ctrl+K pesquisa geral</p>
                  )}
                </div>
              </footer>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
              <Hash className="size-7 text-muted-foreground/45" />
              <p className="mt-3 text-sm font-medium">Selecione uma subatividade</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">Escolha uma subatividade no painel lateral para abrir o acompanhamento.</p>
              <Button type="button" variant="outline" size="sm" className="mt-4 md:hidden" onClick={() => setMobileNavigatorOpen(true)}>Abrir atividades</Button>
            </div>
          )}
        </main>

        <aside className="hidden min-h-0 flex-col border-l border-border bg-muted/20 xl:flex">
          <div className="flex h-12 items-center gap-2 border-b border-border px-3">
            <UsersRound className="size-4 text-muted-foreground" />
            <span className="text-xs font-semibold">Acompanhando</span>
            <span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.58rem] text-muted-foreground">{watchingIds.length}</span>
          </div>
          {membersContent}
        </aside>
      </div>

      <ChatAttachmentPreviewDialog
        files={pendingFiles}
        open={attachmentPreviewOpen}
        sending={uploading}
        onOpenChange={(open) => {
          setAttachmentPreviewOpen(open)
          if (!open && !uploading) setPendingFiles([])
        }}
        onFilesChange={(files) => {
          const error = validateFiles(files)
          if (error) {
            setComposerError(error)
            return
          }
          setComposerError("")
          setPendingFiles(files)
        }}
        onSend={sendPendingFiles}
      />

      <FollowUpSearchDialog
        open={globalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        projects={accessibleProjects}
        members={members}
        currentProjectId={project.id}
        onOpenResult={openGlobalSearchResult}
      />

      <MobilePanel open={mobileNavigatorOpen} title="Atividades" onClose={() => setMobileNavigatorOpen(false)}>
        {navigatorContent}
      </MobilePanel>
      <MobilePanel open={mobileMembersOpen} title="Acompanhando" onClose={() => setMobileMembersOpen(false)}>
        {membersContent}
      </MobilePanel>
    </>
  )
}
