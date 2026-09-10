"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeft,
  AtSign,
  CircleAlert,
  Clock3,
  Code2,
  Download,
  ExternalLink,
  FolderKanban,
  Headphones,
  Image as ImageIcon,
  LoaderCircle,
  LogOut,
  MessageCircleMore,
  Paperclip,
  Phone,
  Radio,
  Reply,
  Search,
  Send,
  Terminal,
  Trash2,
  UserRound,
  UsersRound,
  Video,
  X,
} from "lucide-react"
import type { ChatCommandSnapshot, ChatConversation, ChatMeeting, ChatMention, ChatMessage, ChatReplyReference, MeetingMemberStatus, MeetingMode, Member, MemberPresence } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { GroupDialog } from "@/components/chat/group-dialog"
import { MeetingDialog } from "@/components/chat/meeting-dialog"
import { AudioMessage } from "@/components/chat/audio-message"
import { AudioRecordButton } from "@/components/chat/audio-record-button"
import { ChatAttachmentPreviewDialog } from "@/components/chat/chat-attachment-preview-dialog"
import { ChatMediaMessage } from "@/components/chat/chat-media-message"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AppLoadingSkeleton } from "@/components/app-loading-skeleton"
import { cn } from "@/lib/utils"
import { primeCallAudio } from "@/lib/webrtc/audio-playback"
import { openMeetingRoom } from "@/lib/meeting-launcher"
import { createClient } from "@/lib/supabase/client"
import { WORKSPACE_COMMAND_FILES_BUCKET } from "@/lib/supabase/helpers"
import { TypingIndicator, useTypingIndicator } from "@/components/typing/typing-indicator"
import { buildMentionGroups, mentionsForCandidate, mergeMentions, isUserMentioned, type MentionGroupCandidate } from "@/lib/mention-groups"

type ChatTab = "conversations" | "groups" | "users" | "meetings"

function timeLabel(value: string) {
  const date = new Date(value)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

function onlineDurationLabel(onlineSince: string | undefined, now: number) {
  if (!onlineSince) return "agora"
  const started = new Date(onlineSince).getTime()
  if (!Number.isFinite(started)) return "agora"
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  if (seconds < 5) return "agora"
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}min` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`
}

function LivePresenceLabel({
  presence,
  ready,
  showOffline = true,
  className,
}: {
  presence?: MemberPresence
  ready: boolean
  showOffline?: boolean
  className?: string
}) {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!presence?.online || !presence.onlineSince) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [presence?.online, presence?.onlineSince])

  if (!ready) return <span className={cn("text-muted-foreground", className)}>Verificando status...</span>
  if (!presence?.online) return showOffline ? <span className={cn("text-muted-foreground", className)}>Offline</span> : null

  const duration = onlineDurationLabel(presence.onlineSince, now)
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-success", className)}>
      <span className="size-1.5 shrink-0 rounded-full bg-success" />
      <span className="truncate">{duration === "agora" ? "Online agora" : `Online há ${duration}`}</span>
    </span>
  )
}

function PresenceDot({ online, ready }: { online: boolean; ready: boolean }) {
  if (!ready || !online) return null
  return <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-card bg-success" aria-label="Online" />
}

function conversationTitle(
  conversation: ChatConversation,
  currentUserId: string,
  members: Member[],
) {
  if (conversation.kind === "group") return conversation.name || "Grupo"
  const otherId = conversation.memberIds.find((id) => id !== currentUserId)
  return members.find((member) => member.id === otherId)?.name ?? "Conversa"
}

type ChatMentionCandidate = ChatMention & {
  subtitle: string
}

type MentionCandidate = ChatMentionCandidate | MentionGroupCandidate

type MentionRange = {
  start: number
  end: number
  query: string
}

function mentionToken(mention: ChatMention) {
  return `@${mention.label}`
}

function findMentionRange(value: string, caret: number): MentionRange | null {
  const before = value.slice(0, caret)
  const match = before.match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null
  const start = before.lastIndexOf("@")
  if (start < 0) return null
  return { start, end: caret, query: match[1] ?? "" }
}

function MessageText({ message, own }: { message: ChatMessage; own: boolean }) {
  const mentions = React.useMemo(() => {
    const unique = new Map<string, ChatMention>()
    for (const mention of message.mentions ?? []) {
      unique.set(`${mention.kind}:${mention.id}`, mention)
    }
    return Array.from(unique.values()).sort((a, b) => mentionToken(b).length - mentionToken(a).length)
  }, [message.mentions])

  if (!mentions.length) {
    return <p className="tb-chat-text whitespace-pre-wrap break-words">{message.content}</p>
  }

  const parts: React.ReactNode[] = []
  let cursor = 0
  let key = 0

  while (cursor < message.content.length) {
    let nextIndex = -1
    let nextMention: ChatMention | null = null

    for (const mention of mentions) {
      const token = mentionToken(mention)
      const index = message.content.indexOf(token, cursor)
      if (index >= 0 && (nextIndex < 0 || index < nextIndex)) {
        nextIndex = index
        nextMention = mention
      }
    }

    if (!nextMention || nextIndex < 0) {
      parts.push(message.content.slice(cursor))
      break
    }

    if (nextIndex > cursor) parts.push(message.content.slice(cursor, nextIndex))
    const token = mentionToken(nextMention)
    const classes = cn(
      "inline-flex max-w-full items-center rounded-md px-1 py-0.5 font-medium no-underline",
      own
        ? "bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/20"
        : "bg-primary/12 text-primary hover:bg-primary/18",
    )

    parts.push(
      nextMention.kind === "project" ? (
        <Link key={`mention-${key++}`} href={`/projetos/${nextMention.id}`} className={classes} title={`Abrir projeto ${nextMention.label}`}>
          {token}
        </Link>
      ) : (
        <span key={`mention-${key++}`} className={classes} title={`Usuário mencionado: ${nextMention.label}`}>
          {token}
        </span>
      ),
    )
    cursor = nextIndex + token.length
  }

  return <p className="tb-chat-text whitespace-pre-wrap break-words">{parts}</p>
}

function replySummary(reply: ChatReplyReference) {
  if (reply.unavailable) return "Mensagem original indisponível"
  if (reply.type === "audio") return "Mensagem de áudio"
  if (reply.type === "media") return reply.mediaName?.trim() || reply.content?.trim() || "Mídia"
  return reply.content?.trim() || "Mensagem"
}

function replySenderLabel(reply: ChatReplyReference, currentUserId: string, members: Member[]) {
  if (!reply.senderId) return "Mensagem"
  if (reply.senderId === currentUserId) return "Você"
  return members.find((member) => member.id === reply.senderId)?.name ?? "Usuário"
}

function messageReplyReference(message: ChatMessage): ChatReplyReference {
  return {
    messageId: message.id,
    senderId: message.senderId,
    content: message.content,
    type: message.type,
    mediaName: message.mediaName,
  }
}

function safeHttpUrl(value: string | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
}

function commandFileSize(size?: number) {
  const value = Number(size || 0)
  if (!Number.isFinite(value) || value <= 0) return "Arquivo"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function CommandFileBlock({ block }: { block: Extract<ChatCommandSnapshot["body"][number], { type: "file" }> }) {
  const supabase = React.useMemo(() => createClient(), [])
  const [href, setHref] = React.useState<string | null>(null)

  React.useEffect(() => {
    let active = true
    setHref(null)
    if (!block.storagePath) return
    void supabase.storage.from(WORKSPACE_COMMAND_FILES_BUCKET).createSignedUrl(block.storagePath, 60 * 60 * 6).then(({ data }) => {
      if (active) setHref(data?.signedUrl ?? null)
    })
    return () => { active = false }
  }, [block.storagePath, supabase])

  const content = (
    <>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Paperclip className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="tb-chat-title block truncate font-semibold text-foreground">{block.name || "Arquivo"}</span>
        <span className="tb-chat-meta mt-0.5 block truncate text-muted-foreground">{block.mimeType || "Arquivo"} · {commandFileSize(block.size)}</span>
        {block.caption && <span className="tb-chat-meta mt-1 block break-words text-muted-foreground">{block.caption}</span>}
      </span>
      {href && <Download className="size-4 shrink-0 text-muted-foreground" />}
    </>
  )

  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" download={block.name || undefined} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/25 px-3 py-2.5 transition-colors hover:bg-muted/50">{content}</a>
  ) : (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5 opacity-75">{content}</div>
  )
}

function ChatCommandCard({ command, executor }: { command: ChatCommandSnapshot; executor?: Member }) {
  return (
    <div className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="border-l-[3px] border-primary px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Terminal className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="tb-chat-title min-w-0 truncate font-semibold text-foreground">{command.title}</p>
              <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[0.58rem] font-medium text-primary">/{command.command}</span>
            </div>
            {command.description && <p className="tb-chat-text mt-1 whitespace-pre-wrap break-words text-muted-foreground">{command.description}</p>}
            {executor && <p className="tb-chat-meta mt-1.5 text-muted-foreground">Executado por {executor.name}</p>}
          </div>
        </div>

        {command.body.length > 0 && (
          <div className="mt-3 space-y-3">
            {command.body.map((block, index) => {
              if (block.type === "text") {
                return <p key={index} className="tb-chat-text whitespace-pre-wrap break-words text-foreground/90">{block.content}</p>
              }
              if (block.type === "code") {
                return (
                  <div key={index} className="overflow-hidden rounded-lg border border-border bg-muted/35">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[0.58rem] text-muted-foreground">
                      <Code2 className="size-3" /><span>{block.language?.trim() || "Código / script"}</span>
                    </div>
                    <pre className="max-h-80 overflow-auto p-3 text-left font-mono text-[0.72rem] leading-5 text-foreground"><code>{block.content}</code></pre>
                  </div>
                )
              }
              if (block.type === "html") {
                return (
                  <div key={index} className="overflow-hidden rounded-lg border border-border bg-background">
                    <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-[0.58rem] text-muted-foreground">
                      <Code2 className="size-3" /><span>HTML seguro</span>
                    </div>
                    <iframe
                      title={`Conteúdo HTML de /${command.command}`}
                      sandbox=""
                      srcDoc={block.content}
                      className="h-56 w-full border-0 bg-white"
                    />
                  </div>
                )
              }
              if (block.type === "image") {
                const url = safeHttpUrl(block.url)
                if (!url) return null
                return (
                  <figure key={index} className="overflow-hidden rounded-lg border border-border bg-muted/20">
                    <img src={url} alt={block.caption || command.title} loading="lazy" className="max-h-[420px] w-full object-contain" />
                    {block.caption && <figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{block.caption}</figcaption>}
                  </figure>
                )
              }
              if (block.type === "video") {
                const url = safeHttpUrl(block.url)
                if (!url) return null
                return (
                  <figure key={index} className="overflow-hidden rounded-lg border border-border bg-black/90">
                    <video src={url} controls preload="metadata" className="max-h-[420px] w-full" />
                    {block.caption && <figcaption className="border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">{block.caption}</figcaption>}
                  </figure>
                )
              }
              if (block.type === "file") {
                return <CommandFileBlock key={index} block={block} />
              }
              const url = safeHttpUrl(block.url)
              if (!url) return null
              return (
                <a key={index} href={url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2.5 text-sm text-primary transition-colors hover:bg-muted/50">
                  <ExternalLink className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{block.label?.trim() || url}</span>
                </a>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ConversationAvatar({
  conversation,
  currentUserId,
  members,
  className,
  profileEnabled = true,
}: {
  conversation: ChatConversation
  currentUserId: string
  members: Member[]
  className?: string
  profileEnabled?: boolean
}) {
  if (conversation.kind === "group") {
    return (
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary", className)}>
        <UsersRound className="size-4" />
      </span>
    )
  }
  const otherId = conversation.memberIds.find((id) => id !== currentUserId)
  const member = members.find((item) => item.id === otherId)
  return <MemberAvatar member={member} profileEnabled={profileEnabled} className={cn("size-10 text-xs ring-0", className)} />
}

function meetingStatusFor(meeting: ChatMeeting, userId: string): MeetingMemberStatus | undefined {
  return meeting.memberStates.find((member) => member.userId === userId)?.status
}

function MeetingListItem({
  meeting,
  status,
  onOpen,
  loading = false,
}: {
  meeting: ChatMeeting
  status?: MeetingMemberStatus
  onOpen: () => void
  loading?: boolean
}) {
  const ended = Boolean(meeting.endedAt)
  const declined = status === "declined"
  const disabled = ended || declined || loading
  const subtitle = ended
    ? `Encerrada · ${timeLabel(meeting.endedAt!)}`
    : status === "pending"
      ? "Chamada recebida · Clique para atender"
      : status === "left"
        ? "Você saiu · Entrar novamente"
        : declined
          ? "Chamada recusada"
          : `${meeting.memberIds.length} convidados · Entrar na sala`

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
        disabled ? "opacity-60" : "hover:bg-muted",
      )}
    >
      <span className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl",
        ended || declined ? "bg-muted text-muted-foreground" : status === "pending" ? "bg-primary/10 text-primary" : "bg-success/12 text-success",
      )}>
        {meeting.mode === "video" ? <Video className="size-4" /> : <Headphones className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-semibold">{meeting.title}</span>
          {!ended && !declined && <span className={cn("size-2 shrink-0 rounded-full", status === "pending" ? "bg-primary" : "bg-success")} />}
        </span>
        <span className="mt-0.5 block truncate text-[0.63rem] text-muted-foreground">
          {loading ? "Entrando..." : subtitle}
        </span>
      </span>
    </button>
  )
}

export type ChatSlashCommand = {
  id: string
  command: string
  title: string
  description?: string
}

type ChatViewProps = {
  /** Remove o cartão externo e ocupa toda a altura/largura do contêiner pai. */
  embedded?: boolean
  /** Abre uma conversa específica; usado pelos canais globais do Modo Resumido. */
  conversationId?: string | null
  /** Esconde a lista de conversas e transforma o chat em um único canal. */
  conversationOnly?: boolean
  /** Mantém o histórico visível, mas bloqueia novas mensagens/anexos/chamadas. */
  readOnly?: boolean
  /** Conversas técnicas (ex.: canais globais) que não devem aparecer na Central de Chat. */
  excludeConversationIds?: string[]
  /** Comandos / disponíveis no canal atual. */
  slashCommands?: ChatSlashCommand[]
  /** Executa um comando do canal e publica a resposta rica no histórico. */
  onExecuteSlashCommand?: (command: ChatSlashCommand) => Promise<boolean>
}

export function ChatView({
  embedded = false,
  conversationId = null,
  conversationOnly = false,
  readOnly = false,
  excludeConversationIds = [],
  slashCommands = [],
  onExecuteSlashCommand,
}: ChatViewProps = {}) {
  const {
    members,
    memberPresence,
    presenceReady,
    projects,
    chatConversations,
    chatMeetings,
    currentUserId,
    currentUserRole,
    workspaceId,
    chatHydrated,
    ensureDirectConversation,
    sendChatMessage,
    retryChatMessage,
    sendChatAudio,
    sendChatMedia,
    loadChatHistory,
    deleteDirectConversation,
    leaveChatGroup,
    deleteChatGroup,
    createMeeting,
    answerMeetingInvite,
    joinMeeting,
  } = useStore()
  const [tab, setTab] = React.useState<ChatTab>("conversations")
  const [query, setQuery] = React.useState("")
  const [recordingAudio, setRecordingAudio] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(() => conversationId)
  const [message, setMessage] = React.useState("")
  const [openingUserId, setOpeningUserId] = React.useState<string | null>(null)
  const [startingMeetingMode, setStartingMeetingMode] = React.useState<MeetingMode | null>(null)
  const [openingMeetingId, setOpeningMeetingId] = React.useState<string | null>(null)
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([])
  const [attachmentPreviewOpen, setAttachmentPreviewOpen] = React.useState(false)
  const [sendingMedia, setSendingMedia] = React.useState(false)
  const [mentionRange, setMentionRange] = React.useState<MentionRange | null>(null)
  const [mentionIndex, setMentionIndex] = React.useState(0)
  const [draftMentions, setDraftMentions] = React.useState<ChatMention[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyHasMore, setHistoryHasMore] = React.useState(true)
  const [historyReady, setHistoryReady] = React.useState(false)
  const [conversationActionOpen, setConversationActionOpen] = React.useState(false)
  const [conversationActionBusy, setConversationActionBusy] = React.useState(false)
  const [replyingTo, setReplyingTo] = React.useState<ChatReplyReference | null>(null)
  const [focusedReplyMessageId, setFocusedReplyMessageId] = React.useState<string | null>(null)
  const [slashCommandIndex, setSlashCommandIndex] = React.useState(0)
  const [executingSlashCommandId, setExecutingSlashCommandId] = React.useState<string | null>(null)
  const messagesViewportRef = React.useRef<HTMLDivElement | null>(null)
  const historyRequestRef = React.useRef(0)
  const historyLoadingRef = React.useRef(false)
  const stickToBottomRef = React.useRef(true)
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null)
  const messageInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const messageHoldTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const messageHoldStartRef = React.useRef<{ x: number; y: number; messageId: string } | null>(null)
  const replyFocusTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedMessagesRef = React.useRef<ChatMessage[]>([])
  const navigationUserRef = React.useRef<string | null>(null)
  const supabase = React.useMemo(() => createClient(), [])
  const [workspaceChannelConversationIds, setWorkspaceChannelConversationIds] = React.useState<string[]>([])

  React.useEffect(() => {
    if (!workspaceId || conversationOnly) {
      setWorkspaceChannelConversationIds([])
      return
    }
    let cancelled = false
    void supabase
      .from("workspace_channels")
      .select("conversation_id")
      .eq("workspace_id", workspaceId)
      .then(({ data, error }) => {
        // Compatibilidade: antes da migration 057 a tabela ainda não existe. Nesse caso
        // o Chat tradicional continua funcionando e a V51 passa a ocultá-los assim que
        // a migration for aplicada. Nenhum erro técnico é exibido ao usuário.
        if (cancelled || error) return
        setWorkspaceChannelConversationIds((data ?? []).map((row: any) => String(row.conversation_id)).filter(Boolean))
      })
    return () => { cancelled = true }
  }, [conversationOnly, supabase, workspaceId])

  const excludedConversationIds = React.useMemo(
    () => new Set([...excludeConversationIds, ...workspaceChannelConversationIds]),
    [excludeConversationIds, workspaceChannelConversationIds],
  )
  const myConversations = React.useMemo(
    () =>
      chatConversations
        .filter((conversation) => conversation.memberIds.includes(currentUserId))
        .filter((conversation) => conversationOnly || !excludedConversationIds.has(conversation.id))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chatConversations, conversationOnly, currentUserId, excludedConversationIds],
  )

  const myMeetings = React.useMemo(
    () =>
      chatMeetings
        .filter((meeting) => meeting.memberIds.includes(currentUserId))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [chatMeetings, currentUserId],
  )

  const selected = myConversations.find((conversation) => conversation.id === selectedId) ?? null
  const { typingMembers, reportTyping, stopTyping } = useTypingIndicator(
    selected ? `chat:${selected.id}` : null,
    Boolean(selected) && !readOnly,
  )
  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (!selected || selected.kind !== "group" || !mentionRange) return []
    const queryText = mentionRange.query.trim().toLocaleLowerCase("pt-BR")
    const conversationMembers = selected.memberIds
      .map((id) => members.find((member) => member.id === id))
      .filter((member): member is Member => Boolean(member))
    const hereUserIds = selected.memberIds.filter((id) => memberPresence[id]?.online)
    const groupCandidates = buildMentionGroups({
      members: conversationMembers,
      currentUserId,
      memberPresence,
      hereUserIds,
      todosUserIds: selected.memberIds,
    }).filter((candidate) => candidate.userIds.length > 0)
      .filter((candidate) => !queryText || candidate.label.includes(queryText) || candidate.title.toLocaleLowerCase("pt-BR").includes(queryText))

    const userCandidates: ChatMentionCandidate[] = selected.memberIds
      .filter((id) => id !== currentUserId)
      .map((id) => members.find((member) => member.id === id))
      .filter((member): member is Member => Boolean(member))
      .map((member) => ({ kind: "user" as const, id: member.id, label: member.name, subtitle: "Usuário do grupo" }))
    const projectCandidates: ChatMentionCandidate[] = projects.map((project) => ({
      kind: "project" as const,
      id: project.id,
      label: project.name,
      subtitle: "Projeto",
    }))

    const regularCandidates = [...userCandidates, ...projectCandidates]
      .filter((candidate) => !queryText || candidate.label.toLocaleLowerCase("pt-BR").includes(queryText))
      .sort((a, b) => {
        const aStarts = a.label.toLocaleLowerCase("pt-BR").startsWith(queryText) ? 0 : 1
        const bStarts = b.label.toLocaleLowerCase("pt-BR").startsWith(queryText) ? 0 : 1
        const aKind = a.kind === "user" ? 0 : 1
        const bKind = b.kind === "user" ? 0 : 1
        return aStarts - bStarts || aKind - bKind || a.label.localeCompare(b.label, "pt-BR")
      })
      .slice(0, 8)

    return [...groupCandidates, ...regularCandidates].slice(0, 12)
  }, [currentUserId, memberPresence, members, mentionRange, projects, selected])
  const slashCommandQuery = React.useMemo(() => {
    const match = message.match(/^\/([^\s/]*)$/)
    return match ? match[1].toLocaleLowerCase("pt-BR") : null
  }, [message])
  const slashCommandCandidates = React.useMemo(() => {
    if (slashCommandQuery === null || !onExecuteSlashCommand) return []
    return slashCommands
      .filter((item) => !slashCommandQuery || item.command.toLocaleLowerCase("pt-BR").includes(slashCommandQuery) || item.title.toLocaleLowerCase("pt-BR").includes(slashCommandQuery))
      .sort((a, b) => {
        const aStarts = a.command.toLocaleLowerCase("pt-BR").startsWith(slashCommandQuery) ? 0 : 1
        const bStarts = b.command.toLocaleLowerCase("pt-BR").startsWith(slashCommandQuery) ? 0 : 1
        return aStarts - bStarts || a.command.localeCompare(b.command, "pt-BR")
      })
      .slice(0, 8)
  }, [onExecuteSlashCommand, slashCommandQuery, slashCommands])

  const q = query.trim().toLowerCase()
  const visibleConversations = myConversations.filter((conversation) =>
    conversationTitle(conversation, currentUserId, members).toLowerCase().includes(q),
  )
  const visibleGroups = visibleConversations.filter((conversation) => conversation.kind === "group")
  const visibleUsers = members.filter(
    (member) => member.id !== currentUserId && member.name.toLowerCase().includes(q),
  )
  const visibleMeetings = myMeetings.filter((meeting) => meeting.title.toLowerCase().includes(q))

  React.useEffect(() => {
    setSlashCommandIndex(0)
  }, [slashCommandQuery])

  React.useEffect(() => {
    selectedMessagesRef.current = selected?.messages ?? []
  }, [selected?.messages])

  React.useEffect(() => {
    if (!conversationId) return
    if (myConversations.some((conversation) => conversation.id === conversationId)) {
      setSelectedId(conversationId)
    }
  }, [conversationId, myConversations])

  React.useEffect(() => {
    if (selectedId && !myConversations.some((conversation) => conversation.id === selectedId)) {
      setSelectedId(conversationId && myConversations.some((conversation) => conversation.id === conversationId) ? conversationId : null)
    }
  }, [conversationId, myConversations, selectedId])

  React.useEffect(() => {
    const requestId = ++historyRequestRef.current
    setConversationActionOpen(false)
    setHistoryHasMore(true)
    setHistoryReady(false)
    stickToBottomRef.current = true

    if (!selectedId) {
      historyLoadingRef.current = false
      setHistoryLoading(false)
      return
    }

    historyLoadingRef.current = true
    setHistoryLoading(true)
    void loadChatHistory(selectedId).then((result) => {
      if (historyRequestRef.current !== requestId) return
      setHistoryHasMore(result?.hasMore ?? false)
      setHistoryReady(true)
    }).finally(() => {
      if (historyRequestRef.current !== requestId) return
      historyLoadingRef.current = false
      setHistoryLoading(false)
    })
  }, [loadChatHistory, selectedId])

  React.useLayoutEffect(() => {
    if (!historyReady || !selectedId) return
    const viewport = messagesViewportRef.current
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
    stickToBottomRef.current = true
  }, [historyReady, selectedId])

  const selectedLastMessageId = selected?.messages.at(-1)?.id

  React.useEffect(() => {
    if (!historyReady || !stickToBottomRef.current) return
    requestAnimationFrame(() => {
      const viewport = messagesViewportRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }, [historyReady, selectedLastMessageId])

  React.useEffect(() => {
    setStagedFiles([])
    setAttachmentPreviewOpen(false)
    setMentionRange(null)
    setMentionIndex(0)
    setDraftMentions([])
    setReplyingTo(null)
    setFocusedReplyMessageId(null)
  }, [selectedId])

  React.useEffect(() => () => {
    if (messageHoldTimerRef.current) clearTimeout(messageHoldTimerRef.current)
    if (replyFocusTimerRef.current) clearTimeout(replyFocusTimerRef.current)
  }, [])

  React.useEffect(() => {
    if (!selected) return
    function handlePaste(event: ClipboardEvent) {
      const clipboard = event.clipboardData
      if (!clipboard) return
      const directFiles = Array.from(clipboard.files ?? [])
      const itemFiles = Array.from(clipboard.items ?? [])
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))
      const seen = new Set<string>()
      const files = [...directFiles, ...itemFiles].filter((file) => {
        if (!file.size) return false
        const key = `${file.name}:${file.type}:${file.size}:${file.lastModified}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      if (!files.length) return
      event.preventDefault()
      setStagedFiles((current) => attachmentPreviewOpen ? [...current, ...files] : files)
      setAttachmentPreviewOpen(true)
    }
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [attachmentPreviewOpen, selected])

  React.useEffect(() => {
    if (typeof window === "undefined" || !currentUserId) return
    let active = true

    async function openMemberFromGlobalSearch(memberId: string) {
      if (!memberId || memberId === currentUserId || navigationUserRef.current === memberId) return
      if (!members.some((member) => member.id === memberId)) return

      navigationUserRef.current = memberId
      setOpeningUserId(memberId)
      try {
        const conversationId = await ensureDirectConversation(memberId)
        if (!active) return
        if (conversationId) {
          setSelectedId(conversationId)
          setTab("conversations")
        }
      } finally {
        if (active) {
          setOpeningUserId((current) => current === memberId ? null : current)
          const url = new URL(window.location.href)
          if (url.searchParams.get("user") === memberId) {
            url.searchParams.delete("user")
            window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
          }
        }
        if (navigationUserRef.current === memberId) navigationUserRef.current = null
      }
    }

    const memberIdFromUrl = new URLSearchParams(window.location.search).get("user")
    if (memberIdFromUrl) void openMemberFromGlobalSearch(memberIdFromUrl)

    function handleOpenChatUser(event: Event) {
      const memberId = (event as CustomEvent<{ memberId?: string }>).detail?.memberId
      if (memberId) void openMemberFromGlobalSearch(memberId)
    }

    window.addEventListener("devboard:open-chat-user", handleOpenChatUser)
    return () => {
      active = false
      window.removeEventListener("devboard:open-chat-user", handleOpenChatUser)
    }
  }, [currentUserId, ensureDirectConversation, members])

  React.useEffect(() => {
    if (typeof window === "undefined" || myConversations.length === 0) return
    const url = new URL(window.location.href)
    const conversationId = url.searchParams.get("conversation")
    if (!conversationId) return
    const conversation = myConversations.find((item) => item.id === conversationId)
    if (!conversation) return
    setSelectedId(conversation.id)
    setTab(conversation.kind === "group" ? "groups" : "conversations")
    url.searchParams.delete("conversation")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }, [myConversations])

  async function openUser(memberId: string) {
    if (openingUserId) return
    setOpeningUserId(memberId)
    try {
      const id = await ensureDirectConversation(memberId)
      if (id) setSelectedId(id)
    } finally {
      setOpeningUserId(null)
    }
  }

  async function loadOlderMessages() {
    if (!selected || !historyReady || historyLoadingRef.current || !historyHasMore || selected.messages.length === 0) return
    const viewport = messagesViewportRef.current
    const oldest = selected.messages[0]
    if (!viewport || !oldest) return

    const requestId = historyRequestRef.current
    const conversationId = selected.id
    const previousHeight = viewport.scrollHeight
    const previousTop = viewport.scrollTop
    historyLoadingRef.current = true
    setHistoryLoading(true)
    try {
      const result = await loadChatHistory(conversationId, oldest.createdAt)
      if (!result || historyRequestRef.current !== requestId) return
      setHistoryHasMore(result.hasMore)
      requestAnimationFrame(() => {
        if (historyRequestRef.current !== requestId) return
        const currentViewport = messagesViewportRef.current
        if (!currentViewport) return
        currentViewport.scrollTop = previousTop + (currentViewport.scrollHeight - previousHeight)
      })
    } finally {
      if (historyRequestRef.current === requestId) {
        historyLoadingRef.current = false
        setHistoryLoading(false)
      }
    }
  }

  async function confirmConversationAction() {
    if (!selected || conversationActionBusy) return
    setConversationActionBusy(true)
    try {
      const success = selected.kind === "group"
        ? selectedIsLastGroupMember
          ? await deleteChatGroup(selected.id)
          : await leaveChatGroup(selected.id)
        : await deleteDirectConversation(selected.id)
      if (!success) return
      setConversationActionOpen(false)
      setSelectedId(null)
    } finally {
      setConversationActionBusy(false)
    }
  }

  function syncMentionRange(value: string, caret: number | null) {
    if (!selected || selected.kind !== "group" || caret == null) {
      setMentionRange(null)
      return
    }
    const range = findMentionRange(value, caret)
    setMentionRange(range)
    setMentionIndex(0)
  }

  function selectMention(candidate: MentionCandidate) {
    if (!mentionRange) return
    const token = `@${candidate.label}`
    const next = `${message.slice(0, mentionRange.start)}${token} ${message.slice(mentionRange.end)}`
    const caret = mentionRange.start + token.length + 1
    setMessage(next)
    setDraftMentions((current) => {
      if (candidate.kind === "group") return mergeMentions(current, mentionsForCandidate(candidate))
      const exists = current.some((mention) => mention.kind === candidate.kind && mention.id === candidate.id)
      return exists ? current : [...current, { kind: candidate.kind, id: candidate.id, label: candidate.label }]
    })
    setMentionRange(null)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      messageInputRef.current?.focus()
      messageInputRef.current?.setSelectionRange(caret, caret)
    })
  }

  function selectMessageForReply(item: ChatMessage) {
    if (item.deliveryStatus) return
    setReplyingTo(messageReplyReference(item))
    setMentionRange(null)
    setMentionIndex(0)
    window.getSelection?.()?.removeAllRanges()
    requestAnimationFrame(() => messageInputRef.current?.focus())
  }

  function cancelMessageHold() {
    if (messageHoldTimerRef.current) clearTimeout(messageHoldTimerRef.current)
    messageHoldTimerRef.current = null
    messageHoldStartRef.current = null
  }

  function beginMessageHold(event: React.PointerEvent<HTMLDivElement>, item: ChatMessage) {
    if (item.deliveryStatus) return
    if (event.pointerType === "mouse" && event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest("button,a,input,textarea,video,audio")) return
    cancelMessageHold()
    messageHoldStartRef.current = { x: event.clientX, y: event.clientY, messageId: item.id }
    messageHoldTimerRef.current = setTimeout(() => {
      if (messageHoldStartRef.current?.messageId !== item.id) return
      selectMessageForReply(item)
      cancelMessageHold()
    }, 430)
  }

  function moveMessageHold(event: React.PointerEvent<HTMLDivElement>) {
    const start = messageHoldStartRef.current
    if (!start) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancelMessageHold()
  }

  async function focusRepliedMessage(messageId: string) {
    let element = document.getElementById(`chat-message-${messageId}`)

    // Se a referência apontar para uma página anterior do histórico, carrega as
    // páginas de 20 sob demanda até localizar a mensagem ou chegar ao início.
    if (!element && selected && historyReady && historyHasMore && !historyLoadingRef.current) {
      historyLoadingRef.current = true
      setHistoryLoading(true)
      try {
        let before = selectedMessagesRef.current[0]?.createdAt
        let hasMore = historyHasMore
        let pages = 0
        while (!element && before && hasMore && pages < 30) {
          const result = await loadChatHistory(selected.id, before)
          if (!result) break
          hasMore = result.hasMore
          setHistoryHasMore(hasMore)
          pages += 1
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          element = document.getElementById(`chat-message-${messageId}`)
          const nextBefore = selectedMessagesRef.current[0]?.createdAt
          if (!nextBefore || nextBefore === before) break
          before = nextBefore
        }
      } finally {
        historyLoadingRef.current = false
        setHistoryLoading(false)
      }
    }

    if (!element) return
    element.scrollIntoView({ behavior: "smooth", block: "center" })
    setFocusedReplyMessageId(messageId)
    if (replyFocusTimerRef.current) clearTimeout(replyFocusTimerRef.current)
    replyFocusTimerRef.current = setTimeout(() => setFocusedReplyMessageId(null), 1400)
  }

  async function executeSlashCommand(command: ChatSlashCommand) {
    if (readOnly || !onExecuteSlashCommand || executingSlashCommandId) return
    setExecutingSlashCommandId(command.id)
    stopTyping()
    setMessage("")
    setDraftMentions([])
    setMentionRange(null)
    setReplyingTo(null)
    stickToBottomRef.current = true
    try {
      const ok = await onExecuteSlashCommand(command)
      if (!ok) setMessage(`/${command.command}`)
    } finally {
      setExecutingSlashCommandId(null)
      window.requestAnimationFrame(() => messageInputRef.current?.focus())
    }
  }

  function submitMessage() {
    if (readOnly || !selected || !message.trim()) return
    const trimmed = message.trim()
    if (onExecuteSlashCommand && /^\/[^\s/]+$/.test(trimmed)) {
      const name = trimmed.slice(1).toLocaleLowerCase("pt-BR")
      const exact = slashCommands.find((item) => item.command.toLocaleLowerCase("pt-BR") === name)
      if (exact) { void executeSlashCommand(exact); return }
    }
    const content = message
    const validMentions = draftMentions.filter((mention) => content.includes(mentionToken(mention)))

    stopTyping()

    // UX otimista: a mensagem entra no histórico no mesmo frame do clique/Enter.
    // A confirmação do Supabase acontece em paralelo; em caso de falha, a própria
    // mensagem ganha a ação de tentar novamente sem devolver o texto ao composer.
    setMessage("")
    setDraftMentions([])
    setMentionRange(null)
    const reply = replyingTo
    setReplyingTo(null)
    stickToBottomRef.current = true
    void sendChatMessage(selected.id, content, validMentions, reply ?? undefined)
  }

  function stageChatFiles(files: FileList | File[]) {
    const next = Array.from(files).filter((file) => file.size > 0)
    if (!next.length) return
    setReplyingTo(null)
    setStagedFiles(next)
    setAttachmentPreviewOpen(true)
  }

  async function submitMedia(caption: string) {
    if (readOnly || !selected || !stagedFiles.length || sendingMedia) return
    setSendingMedia(true)
    try {
      const sent = await sendChatMedia(selected.id, stagedFiles, caption)
      if (sent) {
        setStagedFiles([])
        setAttachmentPreviewOpen(false)
      }
    } finally {
      setSendingMedia(false)
    }
  }

  async function openMeeting(meeting: ChatMeeting) {
    if (openingMeetingId || meeting.endedAt) return
    void primeCallAudio()
    const status = meetingStatusFor(meeting, currentUserId)
    if (status === "declined") return

    setOpeningMeetingId(meeting.id)
    try {
      let allowed = true
      if (status === "pending") {
        allowed = await answerMeetingInvite(meeting.id, true)
      } else if (status === "left") {
        allowed = await joinMeeting(meeting.id)
      }
      if (allowed) openMeetingRoom(meeting.id)
    } finally {
      setOpeningMeetingId(null)
    }
  }

  async function startQuickMeeting(mode: MeetingMode) {
    if (readOnly) return
    if (!selected || startingMeetingMode) return
    void primeCallAudio()
    setStartingMeetingMode(mode)
    try {
      const title = conversationTitle(selected, currentUserId, members)
      const id = await createMeeting({
        title: selected.kind === "group" ? title : `Chamada com ${title}`,
        mode,
        memberIds: selected.memberIds,
        conversationId: selected.id,
      })
      if (id) openMeetingRoom(id)
    } finally {
      setStartingMeetingMode(null)
    }
  }

  const selectedTitle = selected ? conversationTitle(selected, currentUserId, members) : ""
  const selectedDirectMember = selected?.kind === "direct"
    ? members.find((member) => selected.memberIds.includes(member.id) && member.id !== currentUserId)
    : undefined
  const selectedMembers = selected
    ? selected.memberIds
        .map((id) => members.find((member) => member.id === id))
        .filter((member): member is Member => Boolean(member))
    : []
  const selectedDirectPresence = selectedDirectMember ? memberPresence[selectedDirectMember.id] : undefined
  const selectedOnlineMembers = selectedMembers.filter((member) => memberPresence[member.id]?.online)
  const canManageGroup = Boolean(
    selected?.kind === "group" &&
      (currentUserRole === "admin" || selected.createdBy === currentUserId),
  )
  const selectedIsLastGroupMember = Boolean(selected?.kind === "group" && selected.memberIds.length <= 1)
  const conversationMeeting = selected
    ? myMeetings.find((meeting) => meeting.conversationId === selected.id && !meeting.endedAt)
    : null

  if (!chatHydrated) {
    return <AppLoadingSkeleton />
  }

  const listItems = tab === "groups" ? visibleGroups : visibleConversations

  return (
    <>
      <div className={cn(
        "overflow-hidden bg-card",
        embedded || conversationOnly
          ? "h-full min-h-0 w-full rounded-none ring-0"
          : "rounded-2xl ring-1 ring-foreground/8 lg:h-[calc(100dvh-7.4rem)] lg:min-h-[580px]",
      )}>
        <div className={cn(
          "grid h-full grid-cols-1",
          embedded || conversationOnly ? "min-h-0" : "min-h-[640px] lg:min-h-0",
          conversationOnly
            ? "xl:grid-cols-[minmax(0,1fr)_250px]"
            : "lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_250px]",
        )}>
          {!conversationOnly && <aside className={cn("min-h-0 flex-col border-r border-border bg-muted/15", selected ? "hidden lg:flex" : "flex")}>
            <div className="border-b border-border px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">Chat</p>
                  <p className="mt-0.5 text-[0.65rem] text-muted-foreground">Mensagens, grupos e reuniões</p>
                </div>
                <div className="flex items-center gap-1">
                  <MeetingDialog compact onCreated={(id) => openMeetingRoom(id)} />
                  <GroupDialog onSaved={(id) => id && setSelectedId(id)} compact />
                </div>
              </div>

              <label className="relative mt-3 block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar conversa, reunião..."
                  className="h-9 w-full rounded-xl border border-border bg-background pr-3 pl-8 text-xs outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                />
              </label>

              <div className="mt-3 grid grid-cols-4 rounded-xl bg-muted p-1">
                {([
                  ["conversations", "Chats"],
                  ["groups", "Grupos"],
                  ["users", "Usuários"],
                  ["meetings", "Reuniões"],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTab(key)}
                    className={cn(
                      "h-7 min-w-0 rounded-lg px-1 text-[0.58rem] font-medium transition-colors sm:text-[0.62rem]",
                      tab === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="block truncate">{label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {tab === "users" ? (
                visibleUsers.length ? (
                  <div className="space-y-1">
                    {visibleUsers.map((member) => {
                      const existing = myConversations.find(
                        (conversation) =>
                          conversation.kind === "direct" && conversation.memberIds.includes(member.id),
                      )
                      return (
                        <button
                          key={member.id}
                          type="button"
                          disabled={Boolean(openingUserId)}
                          onClick={() => void openUser(member.id)}
                          className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                        >
                          <span className="relative shrink-0">
                            <MemberAvatar member={member} profileEnabled={false} className="size-9 text-[0.65rem] ring-0" />
                            <PresenceDot ready={presenceReady} online={Boolean(memberPresence[member.id]?.online)} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <MemberName member={member} className="block truncate text-xs font-medium" />
                            <LivePresenceLabel
                              presence={memberPresence[member.id]}
                              ready={presenceReady}
                              className="mt-0.5 max-w-full text-[0.62rem]"
                            />
                          </span>
                          <MessageCircleMore className="size-3.5 text-muted-foreground" aria-label={existing ? "Abrir conversa" : "Iniciar conversa"} />
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="px-3 py-10 text-center text-xs text-muted-foreground">Nenhum usuário encontrado.</p>
                )
              ) : tab === "meetings" ? (
                visibleMeetings.length ? (
                  <div className="space-y-1">
                    {visibleMeetings.map((meeting) => (
                      <MeetingListItem
                        key={meeting.id}
                        meeting={meeting}
                        status={meetingStatusFor(meeting, currentUserId)}
                        loading={openingMeetingId === meeting.id}
                        onOpen={() => void openMeeting(meeting)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-10 text-center">
                    <Radio className="mx-auto size-5 text-muted-foreground/40" />
                    <p className="mt-2 text-xs text-muted-foreground">Nenhuma reunião criada.</p>
                    <div className="mt-3 flex justify-center">
                      <MeetingDialog onCreated={(id) => openMeetingRoom(id)} />
                    </div>
                  </div>
                )
              ) : listItems.length ? (
                <div className="space-y-1">
                  {listItems.map((conversation) => {
                    const title = conversationTitle(conversation, currentUserId, members)
                    const last = conversation.messages.at(-1)
                    const active = conversation.id === selectedId
                    const liveMeeting = myMeetings.some((meeting) => meeting.conversationId === conversation.id && !meeting.endedAt)
                    const directMemberId = conversation.kind === "direct"
                      ? conversation.memberIds.find((id) => id !== currentUserId)
                      : undefined
                    const directOnline = directMemberId ? Boolean(memberPresence[directMemberId]?.online) : false
                    return (
                      <button
                        key={conversation.id}
                        type="button"
                        onClick={() => setSelectedId(conversation.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                          active ? "bg-primary/10" : "hover:bg-muted",
                        )}
                      >
                        <div className="relative shrink-0">
                          <ConversationAvatar conversation={conversation} currentUserId={currentUserId} members={members} profileEnabled={false} />
                          {conversation.kind === "direct" && <PresenceDot ready={presenceReady} online={directOnline} />}
                          {liveMeeting && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-card bg-primary" title="Reunião em andamento" />}
                        </div>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold">{title}</span>
                            {last && (
                              <time className="shrink-0 font-mono text-[0.56rem] text-muted-foreground">
                                {timeLabel(last.createdAt)}
                              </time>
                            )}
                          </span>
                          <span className="mt-0.5 block truncate text-[0.65rem] text-muted-foreground">
                            {liveMeeting ? "Reunião em andamento" : last?.type === "audio" ? "🎤 Áudio" : last?.content ?? (conversation.kind === "group" ? `${conversation.memberIds.length} participantes` : "Sem mensagens")}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="px-4 py-10 text-center">
                  <MessageCircleMore className="mx-auto size-5 text-muted-foreground/40" />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {tab === "groups" ? "Nenhum grupo encontrado." : "Nenhuma conversa encontrada."}
                  </p>
                </div>
              )}
            </div>
          </aside>}

          <section className={cn("min-h-0 flex-col", selected ? "flex" : conversationOnly ? "flex" : "hidden lg:flex")}>
            {selected ? (
              <>
                <header className="flex min-h-16 items-center gap-2 border-b border-border px-3 py-2.5 sm:gap-3 sm:px-4">
                  {!conversationOnly && (
                    <button
                      type="button"
                      onClick={() => setSelectedId(null)}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted lg:hidden"
                      aria-label="Voltar às conversas"
                    >
                      <ArrowLeft className="size-4" />
                    </button>
                  )}
                  <span className="relative shrink-0">
                    <ConversationAvatar conversation={selected} currentUserId={currentUserId} members={members} className="size-9" />
                    {selected.kind === "direct" && (
                      <PresenceDot ready={presenceReady} online={Boolean(selectedDirectPresence?.online)} />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h1 className="truncate text-sm font-semibold">{selected.kind === "direct" ? <MemberName member={selectedDirectMember} fallback={selectedTitle} /> : selectedTitle}</h1>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                      {conversationMeeting && <span className="shrink-0 text-success">Reunião em andamento</span>}
                      {conversationMeeting && <span aria-hidden="true">·</span>}
                      {selected.kind === "group" ? (
                        <span className="truncate">
                          {presenceReady ? `${selectedOnlineMembers.length} online · ` : ""}{selected.memberIds.length} participantes
                        </span>
                      ) : (
                        <LivePresenceLabel presence={selectedDirectPresence} ready={presenceReady} className="max-w-full text-[0.65rem]" />
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {!readOnly && (conversationMeeting ? (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 gap-1.5 px-2 sm:px-3"
                        onClick={() => void openMeeting(conversationMeeting)}
                        title="Entrar na reunião"
                      >
                        <Radio className="size-3.5" />
                        <span className="hidden sm:inline">Entrar</span>
                      </Button>
                    ) : (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void startQuickMeeting("audio")}
                          loading={startingMeetingMode === "audio"}
                          title="Iniciar chamada de áudio"
                        >
                          <Phone className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void startQuickMeeting("video")}
                          loading={startingMeetingMode === "video"}
                          title="Iniciar chamada de vídeo"
                        >
                          <Video className="size-4" />
                        </Button>
                      </>
                    ))}
                    {!readOnly && !conversationOnly && selected.kind === "group" && (
                      <GroupDialog group={selected} compact onSaved={(id) => setSelectedId(id)} />
                    )}
                    {!conversationOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setConversationActionOpen(true)}
                        title={selected.kind === "group" ? (selectedIsLastGroupMember ? "Excluir grupo" : "Sair do grupo") : "Remover conversa"}
                      >
                        {selected.kind === "group" && !selectedIsLastGroupMember ? <LogOut className="size-4" /> : <Trash2 className="size-4" />}
                      </Button>
                    )}
                  </div>
                </header>

                {conversationMeeting && !readOnly && (
                  <button
                    type="button"
                    onClick={() => void openMeeting(conversationMeeting)}
                    className="flex items-center gap-3 border-b border-success/20 bg-success/8 px-3 py-2 text-left transition-colors hover:bg-success/12 sm:px-4"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success/15 text-success">
                      {conversationMeeting.mode === "video" ? <Video className="size-3.5" /> : <Headphones className="size-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{conversationMeeting.title}</span>
                      <span className="block text-[0.6rem] text-muted-foreground">Sala aberta · clique para entrar</span>
                    </span>
                    <Radio className="size-3.5 shrink-0 text-success" />
                  </button>
                )}

                <div
                  ref={messagesViewportRef}
                  onScroll={(event) => {
                    const viewport = event.currentTarget
                    stickToBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 96
                    if (!stickToBottomRef.current && viewport.scrollTop <= 72) void loadOlderMessages()
                  }}
                  onWheel={(event) => {
                    if (event.deltaY < 0 && event.currentTarget.scrollTop <= 72) void loadOlderMessages()
                  }}
                  className="min-h-0 flex-1 overflow-y-auto bg-muted/10 px-3 py-4 [overflow-anchor:none] sm:px-5"
                >
                  {!historyReady ? (
                    <div className="flex h-full min-h-80 items-center justify-center text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 ring-1 ring-foreground/8">
                        <LoaderCircle className="size-3.5 animate-spin" /> Carregando conversa...
                      </span>
                    </div>
                  ) : selected.messages.length === 0 ? (
                    <div className="flex h-full min-h-80 flex-col items-center justify-center text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                        {selected.kind === "group" ? <UsersRound className="size-5" /> : <MessageCircleMore className="size-5" />}
                      </span>
                      <p className="mt-3 text-sm font-medium">Comece a conversa</p>
                      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                        Troque mensagens ou inicie uma chamada de áudio/vídeo pelo cabeçalho.
                      </p>
                    </div>
                  ) : (
                    <div className="mx-auto flex max-w-3xl flex-col gap-3">
                      <div className="flex min-h-5 items-center justify-center">
                        {historyLoading && historyReady ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-[0.6rem] text-muted-foreground ring-1 ring-foreground/8">
                            <LoaderCircle className="size-3 animate-spin" /> Carregando mensagens anteriores...
                          </span>
                        ) : historyReady && !historyHasMore ? (
                          <span className="text-[0.58rem] text-muted-foreground/70">Início da conversa</span>
                        ) : null}
                      </div>
                      {selected.messages.map((item) => {
                        const sender = members.find((member) => member.id === item.senderId)
                        const own = item.senderId === currentUserId
                        const mentionedCurrentUser = !own && isUserMentioned(item.mentions, currentUserId)
                        const commandMessage = Boolean(item.command)
                        const alignOwn = own && !commandMessage
                        return (
                          <div
                            key={item.id}
                            id={`chat-message-${item.id}`}
                            data-chat-message-id={item.id}
                            onPointerDown={(event) => beginMessageHold(event, item)}
                            onPointerMove={moveMessageHold}
                            onPointerUp={cancelMessageHold}
                            onPointerCancel={cancelMessageHold}
                            onPointerLeave={(event) => {
                              if (event.pointerType === "mouse") cancelMessageHold()
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              cancelMessageHold()
                              selectMessageForReply(item)
                            }}
                            className={cn(
                              "group/message flex items-end gap-2 rounded-xl transition-[background-color,box-shadow] duration-200",
                              alignOwn && "flex-row-reverse",
                              (focusedReplyMessageId === item.id || replyingTo?.messageId === item.id) && "bg-primary/5 ring-1 ring-primary/15",
                            )}
                            title="Segure a mensagem para responder"
                          >
                            {commandMessage ? (
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Terminal className="size-3.5" /></span>
                            ) : !own ? <MemberAvatar member={sender} className="size-7 ring-0" /> : null}
                            <div className={cn("relative", commandMessage ? "w-full max-w-[92%] sm:max-w-[86%]" : "max-w-[78%]", alignOwn && "text-right")}>
                              {!item.deliveryStatus && (
                                <button
                                  type="button"
                                  onPointerDown={(event) => event.stopPropagation()}
                                  onClick={() => selectMessageForReply(item)}
                                  className={cn(
                                    "absolute top-1/2 z-10 hidden size-7 -translate-y-1/2 items-center justify-center rounded-full bg-card text-muted-foreground opacity-0 shadow-sm ring-1 ring-foreground/10 transition-all hover:text-primary group-hover/message:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:flex",
                                    alignOwn ? "-left-9" : "-right-9",
                                  )}
                                  title="Responder mensagem"
                                  aria-label="Responder mensagem"
                                >
                                  <Reply className="size-3.5" />
                                </button>
                              )}
                              {commandMessage ? (
                                <p className="tb-chat-meta mb-1 px-1 font-medium text-muted-foreground">TaskBoard · /{item.command?.command}</p>
                              ) : !own && selected.kind === "group" ? (
                                <p className="tb-chat-meta mb-1 px-1 font-medium text-muted-foreground"><MemberName member={sender} fallback="Usuário" /></p>
                              ) : null}
                              <div
                                className={cn(
                                  commandMessage ? "text-left" : "rounded-2xl px-3 py-2 text-left text-sm leading-relaxed",
                                  !commandMessage && (own
                                    ? "rounded-br-md bg-primary text-primary-foreground"
                                    : "rounded-bl-md bg-card ring-1 ring-foreground/8"),
                                  !commandMessage && mentionedCurrentUser && "tb-mentioned-bubble rounded-bl-md",
                                )}
                              >
                                {item.replyTo && (
                                  <button
                                    type="button"
                                    onPointerDown={(event) => event.stopPropagation()}
                                    onClick={() => void focusRepliedMessage(item.replyTo!.messageId)}
                                    disabled={item.replyTo.unavailable}
                                    className={cn(
                                      "mb-2 block w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition-colors",
                                      own
                                        ? "border-primary-foreground/15 bg-primary-foreground/10 hover:bg-primary-foreground/15"
                                        : "border-foreground/8 bg-muted/70 hover:bg-muted",
                                    )}
                                    title={item.replyTo.unavailable ? "Mensagem original indisponível" : "Ir para a mensagem respondida"}
                                  >
                                    <span className={cn("tb-chat-meta flex items-center gap-1.5 font-semibold", own ? "text-primary-foreground/85" : "text-primary")}>
                                      <Reply className="size-3 shrink-0" />
                                      <span className="truncate">{replySenderLabel(item.replyTo, currentUserId, members)}</span>
                                    </span>
                                    <span className={cn("tb-chat-meta mt-0.5 block truncate", own ? "text-primary-foreground/70" : "text-muted-foreground")}>
                                      {replySummary(item.replyTo)}
                                    </span>
                                  </button>
                                )}
                                {item.command ? (
                                  <ChatCommandCard command={item.command} executor={sender} />
                                ) : item.type === "audio" ? (
                                  <AudioMessage storagePath={item.mediaPath} durationMs={item.mediaDurationMs} own={own} />
                                ) : item.type === "media" ? (
                                  <ChatMediaMessage
                                    storagePath={item.mediaPath}
                                    name={item.mediaName}
                                    mimeType={item.mediaMimeType}
                                    sizeBytes={item.mediaSizeBytes}
                                    kind={item.mediaKind}
                                    caption={item.content}
                                  />
                                ) : (
                                  <MessageText message={item} own={own} />
                                )}
                              </div>
                              <time className="tb-chat-meta mt-1 block px-1 font-mono text-muted-foreground">
                                {new Date(item.createdAt).toLocaleString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                              {own && item.deliveryStatus === "failed" && (
                                <button
                                  type="button"
                                  onClick={() => void retryChatMessage(selected.id, item.id)}
                                  className="mt-0.5 flex max-w-full items-center justify-end gap-1 px-1 text-right text-[0.56rem] font-medium text-destructive transition-opacity hover:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30"
                                  title="Tentar enviar novamente"
                                >
                                  <CircleAlert className="size-2.5 shrink-0" />
                                  <span>Falha ao entregar mensagem. Clique para tentar novamente.</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <footer className="border-t border-border bg-card px-3 py-3 sm:px-4">
                  {readOnly ? (
                    <div className="mx-auto flex min-h-10 max-w-3xl items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 px-4 text-center text-xs text-muted-foreground">
                      Este canal está fechado. O histórico permanece disponível somente para consulta.
                    </div>
                  ) : (
                    <>
                  <div className="mx-auto max-w-3xl">
                    {!recordingAudio && replyingTo && (
                      <div className="mb-2 flex min-w-0 items-center gap-2 rounded-xl border border-primary/15 bg-primary/5 px-3 py-2">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Reply className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="tb-chat-meta block truncate font-semibold text-primary">
                            Respondendo a {replySenderLabel(replyingTo, currentUserId, members)}
                          </span>
                          <span className="tb-chat-meta mt-0.5 block truncate text-muted-foreground">{replySummary(replyingTo)}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setReplyingTo(null)}
                          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                          title="Cancelar resposta"
                          aria-label="Cancelar resposta"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    )}
                    <div className="relative flex items-center gap-2">
                    {!recordingAudio && (
                      <>
                        {slashCommandCandidates.length > 0 && (
                          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-50 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-xl">
                            <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-2 text-[0.68rem] font-medium text-muted-foreground">
                              <Terminal className="size-3.5" /> Comandos deste canal
                            </div>
                            <div className="max-h-64 overflow-y-auto py-1">
                              {slashCommandCandidates.map((command, index) => (
                                <button
                                  key={command.id}
                                  type="button"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => void executeSlashCommand(command)}
                                  className={cn("flex w-full min-w-0 items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors", index === slashCommandIndex ? "bg-primary/10 text-foreground" : "hover:bg-muted")}
                                >
                                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Terminal className="size-3.5" /></span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate font-mono text-xs font-semibold">/{command.command}</span>
                                    <span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">{command.title}{command.description ? ` · ${command.description}` : ""}</span>
                                  </span>
                                  {executingSlashCommandId === command.id ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" /> : index === slashCommandIndex ? <span className="text-[0.58rem] text-muted-foreground">Enter</span> : null}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {slashCommandCandidates.length === 0 && selected.kind === "group" && mentionRange && mentionCandidates.length > 0 && (
                          <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-40 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-popover p-1.5 shadow-xl">
                            <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-2 text-[0.68rem] font-medium text-muted-foreground">
                              <AtSign className="size-3.5" />
                              Mencionar usuário, equipe ou projeto
                            </div>
                            <div className="max-h-64 overflow-y-auto py-1">
                              {mentionCandidates.map((candidate, index) => {
                                const member = candidate.kind === "user" ? members.find((item) => item.id === candidate.id) : undefined
                                const key = candidate.kind === "group" ? `group-${candidate.key}` : `${candidate.kind}-${candidate.id}`
                                const subtitle = candidate.kind === "group" ? candidate.description : candidate.subtitle
                                return (
                                  <button
                                    key={key}
                                    type="button"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => selectMention(candidate)}
                                    className={cn(
                                      "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors",
                                      index === mentionIndex ? "bg-primary/10 text-foreground" : "hover:bg-muted",
                                    )}
                                  >
                                    {candidate.kind === "user" ? (
                                      <MemberAvatar member={member} className="size-8 ring-0" />
                                    ) : candidate.kind === "project" ? (
                                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FolderKanban className="size-3.5" /></span>
                                    ) : (
                                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><AtSign className="size-3.5" /></span>
                                    )}
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs font-semibold">@{candidate.label}</span>
                                      <span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">{subtitle}</span>
                                    </span>
                                    {candidate.kind === "group" && <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.55rem] text-muted-foreground">{candidate.userIds.length}</span>}
                                    <span className="text-[0.6rem] text-muted-foreground">{index === mentionIndex ? "Enter" : ""}</span>
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                        <textarea
                          ref={messageInputRef}
                          value={message}
                          onChange={(event) => {
                            const value = event.target.value
                            setMessage(value)
                            reportTyping(value)
                            setDraftMentions((current) => current.filter((mention) => value.includes(mentionToken(mention))))
                            syncMentionRange(value, event.target.selectionStart)
                          }}
                          onClick={(event) => syncMentionRange(message, event.currentTarget.selectionStart)}
                          onKeyUp={(event) => {
                            if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return
                            syncMentionRange(message, event.currentTarget.selectionStart)
                          }}
                          onKeyDown={(event) => {
                            if (slashCommandCandidates.length > 0) {
                              if (event.key === "ArrowDown") {
                                event.preventDefault()
                                setSlashCommandIndex((current) => (current + 1) % slashCommandCandidates.length)
                                return
                              }
                              if (event.key === "ArrowUp") {
                                event.preventDefault()
                                setSlashCommandIndex((current) => (current - 1 + slashCommandCandidates.length) % slashCommandCandidates.length)
                                return
                              }
                              if (event.key === "Enter" || event.key === "Tab") {
                                event.preventDefault()
                                void executeSlashCommand(slashCommandCandidates[slashCommandIndex] ?? slashCommandCandidates[0])
                                return
                              }
                            }
                            if (mentionRange && mentionCandidates.length > 0) {
                              if (event.key === "ArrowDown") {
                                event.preventDefault()
                                setMentionIndex((current) => (current + 1) % mentionCandidates.length)
                                return
                              }
                              if (event.key === "ArrowUp") {
                                event.preventDefault()
                                setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length)
                                return
                              }
                              if (event.key === "Enter" || event.key === "Tab") {
                                event.preventDefault()
                                selectMention(mentionCandidates[mentionIndex] ?? mentionCandidates[0])
                                return
                              }
                              if (event.key === "Escape") {
                                event.preventDefault()
                                setMentionRange(null)
                                return
                              }
                            }
                            if (event.key === "Escape" && replyingTo) {
                              event.preventDefault()
                              setReplyingTo(null)
                              return
                            }
                            if (event.key === "Enter" && !event.shiftKey) {
                              event.preventDefault()
                              void submitMessage()
                            }
                          }}
                          rows={2}
                          maxLength={2500}
                          placeholder={slashCommands.length ? `Mensagem para ${selectedTitle}... Use / para comandos${selected.kind === "group" ? " ou @ para mencionar" : ""}` : selected.kind === "group" ? `Mensagem para ${selectedTitle}... Use @ para mencionar` : `Mensagem para ${selectedTitle}...`}
                          className="tb-chat-text min-h-14 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
                        />
                        <input
                          ref={attachmentInputRef}
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(event) => {
                            if (event.target.files?.length) stageChatFiles(event.target.files)
                            event.currentTarget.value = ""
                          }}
                        />
                        <Button
                          type="button"
                          size="icon-lg"
                          variant="outline"
                          onClick={() => attachmentInputRef.current?.click()}
                          disabled={sendingMedia}
                          className="self-center"
                        >
                          <Paperclip className="size-4" />
                          <span className="sr-only">Anexar arquivos</span>
                        </Button>
                      </>
                    )}
                    <AudioRecordButton
                      disabled={sendingMedia}
                      onRecordingChange={(recording) => {
                        setRecordingAudio(recording)
                        if (recording) setReplyingTo(null)
                      }}
                      onRecorded={(audio, durationMs) => selected ? sendChatAudio(selected.id, audio, durationMs) : Promise.resolve(false)}
                    />
                    {!recordingAudio && (
                      <Button
                        type="button"
                        size="icon-lg"
                        onClick={submitMessage}
                        disabled={!message.trim() || Boolean(executingSlashCommandId)}
                        loading={false}
                        className="self-center"
                      >
                        <Send className="size-4" />
                        <span className="sr-only">Enviar mensagem</span>
                      </Button>
                    )}
                    </div>
                    <TypingIndicator members={typingMembers} className="mt-1.5 px-1" />
                  </div>
                  <p className="mx-auto mt-1.5 max-w-3xl text-[0.58rem] text-muted-foreground">Enter envia · Shift + Enter quebra linha · Ctrl+V cola mídia · @ menciona no grupo{slashCommands.length ? " · / usa comandos" : ""} · Segure uma mensagem para responder</p>
                    </>
                  )}
                </footer>
              </>
            ) : (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center px-8 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <MessageCircleMore className="size-6" />
                </span>
                <h1 className="mt-4 text-lg font-semibold">Central de conversas</h1>
                <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  Escolha uma conversa ou crie uma reunião para falar com a equipe por áudio, vídeo ou compartilhamento de tela.
                </p>
                <div className="mt-4">
                  <MeetingDialog onCreated={(id) => openMeetingRoom(id)} />
                </div>
              </div>
            )}
          </section>

          <aside className="hidden min-h-0 border-l border-border bg-muted/10 xl:flex xl:flex-col">
            {selected ? (
              <>
                <div className="border-b border-border px-4 py-4 text-center">
                  <span className="relative mx-auto inline-flex">
                    <ConversationAvatar conversation={selected} currentUserId={currentUserId} members={members} className="size-12" />
                    {selected.kind === "direct" && (
                      <PresenceDot ready={presenceReady} online={Boolean(selectedDirectPresence?.online)} />
                    )}
                  </span>
                  <p className="mt-2 truncate text-sm font-semibold">{selected.kind === "direct" ? <MemberName member={selectedDirectMember} fallback={selectedTitle} /> : selectedTitle}</p>
                  <div className="mt-0.5 flex min-h-4 justify-center text-[0.65rem] text-muted-foreground">
                    {selected.kind === "group" ? (
                      <span>{presenceReady ? `${selectedOnlineMembers.length} online · ` : ""}{selectedMembers.length} membros</span>
                    ) : (
                      <LivePresenceLabel presence={selectedDirectPresence} ready={presenceReady} className="max-w-full text-[0.65rem]" />
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void startQuickMeeting("audio")} loading={startingMeetingMode === "audio"}>
                      <Phone className="size-3.5" /> Áudio
                    </Button>
                    <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void startQuickMeeting("video")} loading={startingMeetingMode === "video"}>
                      <Video className="size-3.5" /> Vídeo
                    </Button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {conversationMeeting && (
                    <button
                      type="button"
                      onClick={() => void openMeeting(conversationMeeting)}
                      className="mb-3 flex w-full items-center gap-2 rounded-xl border border-success/20 bg-success/8 px-3 py-2.5 text-left"
                    >
                      <Radio className="size-4 shrink-0 text-success" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">Reunião ativa</span>
                        <span className="block text-[0.58rem] text-muted-foreground">
                          {meetingStatusFor(conversationMeeting, currentUserId) === "pending" ? "Atender chamada" : "Entrar agora"}
                        </span>
                      </span>
                    </button>
                  )}

                  {selected.kind === "group" ? (
                    <>
                      <div className="mb-2 flex items-center justify-between">
                        <p className="font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">Participantes</p>
                        {canManageGroup && <GroupDialog group={selected} compact onSaved={(id) => setSelectedId(id)} />}
                      </div>
                      <div className="space-y-1">
                        {selectedMembers.map((member) => (
                          <div key={member.id} className="flex items-center gap-2.5 rounded-xl px-2 py-2">
                            <span className="relative shrink-0">
                              <MemberAvatar member={member} className="size-8 ring-0" />
                              <PresenceDot ready={presenceReady} online={Boolean(memberPresence[member.id]?.online)} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <MemberName member={member} className="block truncate text-xs font-medium" />
                              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.6rem] text-muted-foreground">
                                <span className="shrink-0">{member.id === selected.createdBy ? "Criador" : member.id === currentUserId ? "Você" : "Membro"}</span>
                                <span aria-hidden="true">·</span>
                                <LivePresenceLabel
                                  presence={memberPresence[member.id]}
                                  ready={presenceReady}
                                  className="max-w-full text-[0.6rem]"
                                />
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center">
                      <UserRound className="mx-auto size-4 text-muted-foreground" />
                      <p className="mt-2 text-xs text-muted-foreground">Conversa direta entre dois usuários.</p>
                    </div>
                  )}

                  <div className="mt-4 border-t border-border pt-3">
                    <div className="mb-2 flex items-center gap-1.5 text-[0.62rem] font-medium text-muted-foreground">
                      <Clock3 className="size-3.5" /> Reuniões recentes
                    </div>
                    <div className="space-y-1">
                      {myMeetings.filter((meeting) => meeting.conversationId === selected.id).slice(0, 4).map((meeting) => (
                        <div key={meeting.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[0.62rem]">
                          {meeting.mode === "video" ? <Video className="size-3 text-muted-foreground" /> : <Headphones className="size-3 text-muted-foreground" />}
                          <span className="min-w-0 flex-1 truncate">{meeting.title}</span>
                          <span className={cn("size-1.5 rounded-full", meeting.endedAt ? "bg-muted-foreground/40" : "bg-success")} />
                        </div>
                      ))}
                      {!myMeetings.some((meeting) => meeting.conversationId === selected.id) && (
                        <p className="px-2 py-2 text-[0.6rem] text-muted-foreground">Nenhuma reunião ainda.</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
                Detalhes da conversa aparecem aqui.
              </div>
            )}
          </aside>
        </div>
      </div>

      <ChatAttachmentPreviewDialog
        files={stagedFiles}
        open={attachmentPreviewOpen}
        sending={sendingMedia}
        onOpenChange={(open) => {
          setAttachmentPreviewOpen(open)
          if (!open && !sendingMedia) setStagedFiles([])
        }}
        onFilesChange={setStagedFiles}
        onSend={submitMedia}
      />

      <Dialog open={conversationActionOpen} onOpenChange={(open) => !conversationActionBusy && setConversationActionOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.kind === "group"
                ? selectedIsLastGroupMember ? "Excluir este grupo permanentemente?" : "Sair deste grupo?"
                : "Remover esta conversa da sua lista?"}
            </DialogTitle>
            <DialogDescription>
              {selected?.kind === "group"
                ? selectedIsLastGroupMember
                  ? "Você é o último participante. O grupo, as mensagens e as mídias serão removidos permanentemente. Esta ação não pode ser desfeita."
                  : "Você deixará de receber mensagens e reuniões deste grupo. O histórico continua disponível para os demais participantes."
                : "A conversa e o histórico atual desaparecerão somente para você. O outro participante continuará vendo tudo normalmente. Se vocês conversarem novamente, o chat reaparecerá para você somente com as mensagens novas."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={conversationActionBusy} onClick={() => setConversationActionOpen(false)}>Cancelar</Button>
            <Button type="button" variant="destructive" loading={conversationActionBusy} onClick={() => void confirmConversationAction()}>
              {selected?.kind === "group" && !selectedIsLastGroupMember
                ? <><LogOut className="size-3.5" /> Sair do grupo</>
                : selected?.kind === "group"
                  ? <><Trash2 className="size-3.5" /> Excluir permanentemente</>
                  : <><Trash2 className="size-3.5" /> Remover da minha lista</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  )
}
