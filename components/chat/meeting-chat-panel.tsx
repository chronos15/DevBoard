"use client"

import * as React from "react"
import {
  AtSign,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Music2,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  RotateCcw,
  Send,
  SmilePlus,
  X,
} from "lucide-react"
import type { ChatMention, ChatMessage, ChatReplyReference, ChatMeeting } from "@/lib/types"
import { useStore } from "@/lib/store"
import { createClient } from "@/lib/supabase/client"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { AudioMessage } from "@/components/chat/audio-message"
import { ChatMediaMessage } from "@/components/chat/chat-media-message"
import { TimelineJumpToLatest } from "@/components/chat/use-anchored-timeline"
import { AudioRecordButton } from "@/components/chat/audio-record-button"
import { FileDropOverlay } from "@/components/attachments/file-drop-overlay"
import { ImageEditorDialog } from "@/components/media/image-editor-dialog"
import { InlineMessageEditor } from "@/components/comments/inline-message-editor"
import { RichMessageText } from "@/components/text/rich-message-text"
import { RichMessageComposer } from "@/components/text/rich-message-composer"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toUserFacingError } from "@/lib/user-facing-error"
import { inferAttachmentKind } from "@/lib/attachment-preview"
import { mentionCandidates as buildMentionCandidates, mentionTokenForCandidate, mentionsForCandidate, mergeMentions, isUserMentioned, type MentionCandidate } from "@/lib/mention-groups"

type MentionRange = { start: number; end: number; query: string }
type ReactionRow = { messageId: string; userId: string; emoji: string }

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "✅"] as const
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_BATCH_BYTES = 150 * 1024 * 1024

function fileIdentity(file: File) {
  return `${file.name}:${file.type}:${file.size}:${file.lastModified}`
}

function filesFromClipboard(clipboard: DataTransfer | null) {
  if (!clipboard) return []
  const directFiles = Array.from(clipboard.files ?? [])
  const itemFiles = Array.from(clipboard.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
  const seen = new Set<string>()
  return [...directFiles, ...itemFiles].filter((file) => {
    if (!file.size) return false
    const key = fileIdentity(file)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
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

function messageReplyReference(message: ChatMessage): ChatReplyReference {
  return {
    messageId: message.id,
    senderId: message.senderId,
    content: message.content,
    type: message.type,
    mediaName: message.mediaName,
  }
}

function replySummary(reply: ChatReplyReference) {
  if (reply.unavailable) return "Mensagem original indisponível"
  if (reply.type === "audio") return "Mensagem de áudio"
  if (reply.type === "media") return reply.mediaName?.trim() || reply.content?.trim() || "Arquivo"
  return reply.content?.trim() || "Mensagem"
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function MeetingInlineFilePreview({
  file,
  onRemove,
  onReplace,
}: {
  file: File
  onRemove: () => void
  onReplace: (file: File) => void
}) {
  const kind = inferAttachmentKind({ name: file.name, mimeType: file.type })
  const [url, setUrl] = React.useState<string | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)

  React.useEffect(() => {
    if (kind !== "image" && kind !== "video") {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file, kind])

  const Icon = kind === "image" ? ImageIcon : kind === "video" ? Film : kind === "audio" ? Music2 : FileText

  return (
    <>
      <div className="group/preview relative h-24 w-36 shrink-0 overflow-hidden rounded-xl border border-border bg-muted/35 sm:h-28 sm:w-40">
        {kind === "image" && url ? (
          <img src={url} alt={file.name} className="h-full w-full object-cover" />
        ) : kind === "video" && url ? (
          <video src={url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center">
            <span className="flex size-9 items-center justify-center rounded-xl bg-background text-muted-foreground ring-1 ring-border">
              <Icon className="size-4.5" />
            </span>
            <span className="line-clamp-2 max-w-full break-all text-[0.58rem] font-medium text-foreground/80">{file.name}</span>
            <span className="text-[0.52rem] text-muted-foreground">{formatBytes(file.size)}</span>
          </div>
        )}
        <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
          {kind === "image" && url && (
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="flex size-7 items-center justify-center rounded-lg border border-border/80 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-primary hover:text-primary-foreground"
              title="Editar imagem antes de enviar"
              aria-label={`Editar ${file.name}`}
            >
              <Pencil className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onRemove}
            className="flex size-7 items-center justify-center rounded-lg border border-border/80 bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-destructive hover:text-destructive-foreground"
            title="Remover arquivo"
            aria-label={`Remover ${file.name}`}
          >
            <X className="size-3.5" />
          </button>
        </div>
        {(kind === "image" || kind === "video") && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-2 pt-7 text-[0.54rem] text-white">
            <p className="truncate font-medium">{file.name}</p>
            <p className="mt-0.5 opacity-75">{formatBytes(file.size)}</p>
          </div>
        )}
      </div>
      {kind === "image" && url && (
        <ImageEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          src={url}
          name={file.name}
          onComplete={onReplace}
        />
      )}
    </>
  )
}

function MessageText({ message, own }: { message: ChatMessage; own: boolean }) {
  return <RichMessageText content={message.content} mentions={message.mentions} own={own} />
}

export function MeetingChatPanel({ meeting }: { meeting: ChatMeeting }) {
  const {
    chatConversations,
    currentUserId,
    members,
    sendChatMessage,
    editChatMessage,
    retryChatMessage,
    sendChatMedia,
    sendChatAudio,
    loadChatHistory,
    inviteMeetingUser,
  } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const conversation = chatConversations.find((item) => item.id === meeting.conversationId) ?? null
  const [message, setMessage] = React.useState("")
  const [draftMentions, setDraftMentions] = React.useState<ChatMention[]>([])
  const [mentionRange, setMentionRange] = React.useState<MentionRange | null>(null)
  const [mentionIndex, setMentionIndex] = React.useState(0)
  const [replyingTo, setReplyingTo] = React.useState<ChatReplyReference | null>(null)
  const [editingMessageId, setEditingMessageId] = React.useState<string | null>(null)
  const [pickerMessageId, setPickerMessageId] = React.useState<string | null>(null)
  const [reactions, setReactions] = React.useState<ReactionRow[]>([])
  const [reactionBusy, setReactionBusy] = React.useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyHasMore, setHistoryHasMore] = React.useState(true)
  const [historyReady, setHistoryReady] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [localError, setLocalError] = React.useState("")
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([])
  const [sendingMedia, setSendingMedia] = React.useState(false)
  const [recordingAudio, setRecordingAudio] = React.useState(false)
  const [hasNewMessagesBelow, setHasNewMessagesBelow] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const messagesContentRef = React.useRef<HTMLDivElement | null>(null)
  const stickBottomRef = React.useRef(true)
  const panelRef = React.useRef<HTMLDivElement | null>(null)

  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (!mentionRange) return []
    const joinedIds = meeting.memberStates.filter((row) => row.status === "joined").map((row) => row.userId)
    return buildMentionCandidates({
      members,
      currentUserId,
      query: mentionRange.query,
      hereUserIds: joinedIds,
      todosUserIds: meeting.memberIds,
      priorityUserIds: meeting.memberIds,
      priorityUsersFirst: true,
      userLimit: 8,
    }).map((candidate) => {
      if (candidate.kind === "group") return candidate
      const state = meeting.memberStates.find((row) => row.userId === candidate.id)?.status
      return {
        ...candidate,
        description: state === "joined"
          ? "Já está na reunião"
          : state === "pending"
            ? "Convite pendente"
            : "Será associado ao contexto e chamado",
      }
    })
  }, [currentUserId, meeting.memberStates, members, mentionRange])

  const loadReactions = React.useCallback(async () => {
    const ids = (conversation?.messages ?? [])
      .map((item) => item.id)
      .filter((id) => id && !id.startsWith("local:"))
    if (!ids.length) {
      setReactions([])
      return
    }
    const { data, error } = await supabase
      .from("chat_message_reactions")
      .select("message_id,user_id,emoji")
      .in("message_id", ids)
    if (error) return
    setReactions((data ?? []).map((row: any) => ({
      messageId: row.message_id,
      userId: row.user_id,
      emoji: row.emoji,
    })))
  }, [conversation?.messages, supabase])

  React.useEffect(() => {
    if (!conversation?.id) return
    let cancelled = false
    setHistoryLoading(true)
    setHistoryReady(false)
    void loadChatHistory(conversation.id).then((result) => {
      if (cancelled) return
      setHistoryHasMore(result?.hasMore ?? false)
      setHistoryReady(true)
      requestAnimationFrame(() => {
        const viewport = viewportRef.current
        if (viewport) viewport.scrollTop = viewport.scrollHeight
        setHasNewMessagesBelow(false)
      })
    }).finally(() => {
      if (!cancelled) setHistoryLoading(false)
    })
    return () => { cancelled = true }
  }, [conversation?.id, loadChatHistory])

  React.useEffect(() => {
    void loadReactions()
  }, [loadReactions])

  React.useEffect(() => {
    const channel = supabase
      .channel(`devboard-meeting-chat-reactions:${meeting.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_message_reactions" }, () => void loadReactions())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [loadReactions, meeting.id, supabase])

  const lastMessageId = conversation?.messages.at(-1)?.id
  React.useEffect(() => {
    if (!historyReady || !lastMessageId) return
    if (!stickBottomRef.current) {
      setHasNewMessagesBelow(true)
      return
    }
    requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
      setHasNewMessagesBelow(false)
    })
  }, [historyReady, lastMessageId])

  const scrollMeetingChatToBottom = React.useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = viewportRef.current
    if (!viewport) return
    const top = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    if (behavior === "smooth" && typeof viewport.scrollTo === "function") viewport.scrollTo({ top, behavior })
    else viewport.scrollTop = top
    stickBottomRef.current = true
    setHasNewMessagesBelow(false)
  }, [])

  const handleMeetingMediaReady = React.useCallback(() => {
    if (!stickBottomRef.current) return
    requestAnimationFrame(() => scrollMeetingChatToBottom("auto"))
  }, [scrollMeetingChatToBottom])

  React.useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || typeof ResizeObserver === "undefined" || !historyReady) return
    const observer = new ResizeObserver(() => {
      if (!stickBottomRef.current) return
      window.requestAnimationFrame(() => scrollMeetingChatToBottom("auto"))
    })
    observer.observe(viewport)
    if (messagesContentRef.current) observer.observe(messagesContentRef.current)
    return () => observer.disconnect()
  }, [conversation?.id, historyReady, lastMessageId, scrollMeetingChatToBottom])

  function syncMention(value: string, caret: number | null) {
    if (caret == null) return setMentionRange(null)
    setMentionRange(findMentionRange(value, caret))
    setMentionIndex(0)
  }

  function selectMention(candidate: MentionCandidate) {
    if (!mentionRange) return
    const token = mentionTokenForCandidate(candidate)
    const next = `${message.slice(0, mentionRange.start)}${token} ${message.slice(mentionRange.end)}`
    const caret = mentionRange.start + token.length + 1
    setMessage(next)
    setDraftMentions((current) => mergeMentions(current, mentionsForCandidate(candidate)))
    setMentionRange(null)
    setMentionIndex(0)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(caret, caret)
    })
  }

  async function submitMessage() {
    if (!conversation || sending || sendingMedia) return
    const content = message
    const hasText = Boolean(content.trim())
    const hasFiles = stagedFiles.length > 0
    if (!hasText && !hasFiles) return

    const mentions = draftMentions.filter((mention) => content.includes(mentionToken(mention)))
    setLocalError("")

    // Menções individuais/de equipe continuam podendo convidar. @todos e @here
    // são apenas broadcasts para quem já está no contexto e nunca vinculam pessoas.
    for (const mention of mentions.filter((item) => item.kind === "user")) {
      if (mention.label === "todos" || mention.label === "here") continue
      const invited = await inviteMeetingUser(meeting.id, mention.id, false)
      if (!invited) {
        setLocalError(`Não foi possível adicionar @${mention.label} à reunião.`)
        return
      }
    }

    if (hasFiles) {
      setSendingMedia(true)
      try {
        stickBottomRef.current = true
        setHasNewMessagesBelow(false)
        const sent = await sendChatMedia(conversation.id, stagedFiles, content)
        if (!sent) return
        setStagedFiles([])
        setMessage("")
        setDraftMentions([])
        setMentionRange(null)
        setReplyingTo(null)
      } finally {
        setSendingMedia(false)
      }
      return
    }

    setSending(true)
    try {
      const sent = await sendChatMessage(conversation.id, content, mentions, replyingTo ?? undefined)
      if (!sent) return
      setMessage("")
      setDraftMentions([])
      setMentionRange(null)
      setReplyingTo(null)
      stickBottomRef.current = true
      setHasNewMessagesBelow(false)
    } finally {
      setSending(false)
    }
  }

  async function setReaction(messageId: string, emoji: string | null) {
    if (reactionBusy) return
    setReactionBusy(messageId)
    setLocalError("")
    try {
      const { error } = await supabase.rpc("set_chat_message_reaction", {
        p_message_id: messageId,
        p_emoji: emoji,
      })
      if (error) throw error
      setPickerMessageId(null)
      await loadReactions()
    } catch (error) {
      setLocalError(toUserFacingError(error, "Não foi possível salvar a reação"))
    } finally {
      setReactionBusy(null)
    }
  }

  async function loadOlder() {
    if (!conversation || historyLoading || !historyHasMore || !conversation.messages.length) return
    const oldest = conversation.messages[0]
    const viewport = viewportRef.current
    if (!oldest || !viewport) return
    const oldHeight = viewport.scrollHeight
    const oldTop = viewport.scrollTop
    setHistoryLoading(true)
    try {
      const result = await loadChatHistory(conversation.id, oldest.createdAt)
      if (!result) return
      setHistoryHasMore(result.hasMore)
      requestAnimationFrame(() => {
        const next = viewportRef.current
        if (next) next.scrollTop = oldTop + (next.scrollHeight - oldHeight)
      })
    } finally {
      setHistoryLoading(false)
    }
  }

  const queueMeetingFiles = React.useCallback((files: File[]) => {
    if (!files.length || sendingMedia || recordingAudio) return
    const incoming = files.filter((file) => file.size > 0)
    if (!incoming.length) return

    const merged = [...stagedFiles, ...incoming]
    const seen = new Set<string>()
    const unique = merged.filter((file) => {
      const key = fileIdentity(file)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const oversized = unique.find((file) => file.size > MAX_FILE_BYTES)
    if (oversized) {
      setLocalError(`“${oversized.name}” excede o limite de 50 MB.`)
      return
    }
    const totalBytes = unique.reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > MAX_BATCH_BYTES) {
      setLocalError("O envio pode ter no máximo 150 MB por vez.")
      return
    }

    setLocalError("")
    setReplyingTo(null)
    setStagedFiles(unique)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [recordingAudio, sendingMedia, stagedFiles])

  React.useEffect(() => {
    if (sendingMedia || recordingAudio) return

    const handleWindowPaste = (event: ClipboardEvent) => {
      const panel = panelRef.current
      if (!panel) return
      const rect = panel.getBoundingClientRect()
      const style = window.getComputedStyle(panel)
      const panelVisible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      if (!panelVisible) return

      const files = filesFromClipboard(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      event.stopPropagation()
      queueMeetingFiles(files)
    }

    // Captura no window para funcionar mesmo quando o foco está em um botão, mensagem
    // ou outra área do painel. Texto puro continua seguindo o comportamento normal.
    window.addEventListener("paste", handleWindowPaste, true)
    return () => window.removeEventListener("paste", handleWindowPaste, true)
  }, [queueMeetingFiles, recordingAudio, sendingMedia])

  function stageFiles(files: FileList | null) {
    if (!files?.length) return
    queueMeetingFiles(Array.from(files))
  }

  function updateStagedFiles(files: File[]) {
    const valid = files.filter((file) => file.size > 0)
    const oversized = valid.find((file) => file.size > MAX_FILE_BYTES)
    if (oversized) {
      setLocalError(`“${oversized.name}” excede o limite de 50 MB.`)
      return
    }
    if (valid.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
      setLocalError("O envio pode ter no máximo 150 MB por vez.")
      return
    }
    setLocalError("")
    setStagedFiles(valid)
  }


  if (!meeting.conversationId || !conversation) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center text-muted-foreground">
        <MessageSquareText className="mb-2 size-5" />
        <p className="text-xs font-medium text-foreground">Preparando o chat da reunião…</p>
        <p className="mt-1 text-[0.62rem] leading-relaxed">As mensagens ficam vinculadas ao mesmo contexto da chamada.</p>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-none bg-card"
      onDragEnter={(event) => {
        if (!Array.from(event.dataTransfer.types ?? []).includes("Files")) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types ?? []).includes("Files")) return
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files ?? []).filter((file) => file.size > 0)
        if (!files.length) return
        event.preventDefault()
        event.stopPropagation()
        queueMeetingFiles(files)
      }}
    >
      <FileDropOverlay
        enabled={!sendingMedia && !recordingAudio}
        title="Solte para anexar à reunião"
        description="Imagens, vídeos, documentos e outros arquivos serão adicionados ao compositor da reunião."
        onFiles={queueMeetingFiles}
        scopeRef={panelRef}
        exclusive
      />
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold"><MessageSquareText className="size-3.5 text-primary" /> Chat da reunião</p>
          <p className="mt-0.5 truncate text-[0.56rem] text-muted-foreground">@ menciona e chama quem ainda não está na sala</p>
        </div>
      </div>

      <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={viewportRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          if (stickBottomRef.current) setHasNewMessagesBelow(false)
        }}
        className="h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain px-2.5 py-2 [scrollbar-width:thin]"
      >
        {historyHasMore && (
          <div className="mb-2 text-center">
            <Button type="button" variant="ghost" size="sm" className="h-7 text-[0.6rem]" onClick={() => void loadOlder()} disabled={historyLoading}>
              {historyLoading ? <Loader2 className="size-3 animate-spin" /> : null}
              Mensagens anteriores
            </Button>
          </div>
        )}

        {!historyReady && historyLoading ? (
          <div className="flex h-full min-h-28 items-center justify-center text-muted-foreground"><Loader2 className="size-4 animate-spin" /></div>
        ) : conversation.messages.length === 0 ? (
          <div className="flex h-full min-h-28 flex-col items-center justify-center text-center text-muted-foreground">
            <MessageSquareText className="size-5" />
            <p className="mt-2 text-[0.65rem]">Nenhuma mensagem ainda.</p>
          </div>
        ) : (
          <div ref={messagesContentRef} className="min-w-0 space-y-2.5">
            {conversation.messages.map((item) => {
              const own = item.senderId === currentUserId
              const mentionedCurrentUser = !own && isUserMentioned(item.mentions, currentUserId)
              const sender = members.find((member) => member.id === item.senderId)
              const itemReactions = reactions.filter((reaction) => reaction.messageId === item.id)
              const grouped = new Map<string, ReactionRow[]>()
              itemReactions.forEach((reaction) => grouped.set(reaction.emoji, [...(grouped.get(reaction.emoji) ?? []), reaction]))
              const myReaction = itemReactions.find((reaction) => reaction.userId === currentUserId)
              const replySender = item.replyTo?.senderId === currentUserId
                ? "Você"
                : members.find((member) => member.id === item.replyTo?.senderId)?.name ?? "Usuário"

              return (
                <div key={item.id} id={`meeting-chat-message-${item.id}`} className={cn("group flex min-w-0 items-end gap-1.5", own ? "justify-end" : "justify-start")}>
                  {!own && <MemberAvatar member={sender} className="mb-1 size-6 shrink-0 ring-0" />}
                  <div className={cn("relative min-w-0 max-w-[88%]", own && "items-end")}>
                    {!own && <p className="mb-0.5 px-1 text-[0.55rem] font-medium text-muted-foreground"><MemberName member={sender} fallback="Usuário" /></p>}
                    <div className={cn(
                      "relative min-w-0 max-w-full overflow-hidden rounded-2xl px-2.5 py-2 text-[0.72rem] leading-relaxed shadow-sm",
                      own ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted text-foreground",
                      mentionedCurrentUser && "tb-mentioned-bubble rounded-bl-md",
                      item.deliveryStatus === "failed" && "ring-1 ring-destructive/40",
                    )}>
                      {item.replyTo && (
                        <button
                          type="button"
                          onClick={() => document.getElementById(`meeting-chat-message-${item.replyTo?.messageId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })}
                          className={cn("mb-1.5 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-[0.6rem]", own ? "border-primary-foreground/50 bg-primary-foreground/10" : "border-primary/50 bg-background/50")}
                        >
                          <span className="block truncate font-semibold">{replySender}</span>
                          <span className="block truncate opacity-75">{replySummary(item.replyTo)}</span>
                        </button>
                      )}

                      {editingMessageId === item.id ? (
                        <InlineMessageEditor
                          initialValue={item.content}
                          onCancel={() => setEditingMessageId(null)}
                          onSave={(value) => editChatMessage(conversation.id, item.id, value)}
                          className="text-foreground"
                        />
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
                          onMediaReady={handleMeetingMediaReady}
                          onSendEditedImage={conversation ? (file) => sendChatMedia(conversation.id, [file], "") : undefined}
                        />
                      ) : (
                        <MessageText message={item} own={own} />
                      )}

                      <div className={cn("mt-1 flex items-center justify-end gap-1 text-[0.5rem]", own ? "text-primary-foreground/65" : "text-muted-foreground")}>
                        {item.deliveryStatus === "sending" && <span>Enviando…</span>}
                        {item.deliveryStatus === "failed" && <span>Falha</span>}
                        {!item.deliveryStatus && item.editedAt && <span>(editada)</span>}
                        {!item.deliveryStatus && <span>{timeLabel(item.createdAt)}</span>}
                      </div>
                    </div>

                    {!item.deliveryStatus && (
                      <div className={cn("mt-1 flex flex-wrap items-center gap-1", own ? "justify-end" : "justify-start")}>
                        {Array.from(grouped.entries()).map(([emoji, rows]) => {
                          const mine = rows.some((row) => row.userId === currentUserId)
                          return (
                            <button
                              key={emoji}
                              type="button"
                              disabled={reactionBusy === item.id}
                              onClick={() => void setReaction(item.id, mine ? null : emoji)}
                              className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-1.5 text-[0.58rem] transition-colors", mine ? "border-primary/35 bg-primary/10" : "border-border bg-background hover:bg-muted")}
                            >
                              <span>{emoji}</span><span>{rows.length}</span>
                            </button>
                          )
                        })}

                        <button type="button" onClick={() => setReplyingTo(messageReplyReference(item))} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="Responder">
                          <Reply className="size-3" />
                        </button>
                        {own && item.type !== "audio" && item.type !== "media" && item.content.trim() && (
                          <button type="button" onClick={() => setEditingMessageId(item.id)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="Editar mensagem">
                            <Pencil className="size-3" />
                          </button>
                        )}
                        <button type="button" onClick={() => setPickerMessageId((current) => current === item.id ? null : item.id)} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="Reagir">
                          <SmilePlus className="size-3" />
                        </button>

                        {pickerMessageId === item.id && (
                          <div className={cn("absolute z-20 mt-8 flex max-w-[calc(100vw-2rem)] items-center gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-xl", own ? "right-0" : "left-0")}>
                            {REACTION_EMOJIS.map((emoji) => (
                              <button
                                key={emoji}
                                type="button"
                                disabled={reactionBusy === item.id}
                                onClick={() => void setReaction(item.id, myReaction?.emoji === emoji ? null : emoji)}
                                className={cn("flex size-7 items-center justify-center rounded-lg text-sm hover:bg-muted", myReaction?.emoji === emoji && "bg-primary/10")}
                              >{emoji}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {item.deliveryStatus === "failed" && (
                      <button type="button" onClick={() => void retryChatMessage(conversation.id, item.id)} className="mt-1 inline-flex items-center gap-1 text-[0.58rem] font-medium text-destructive hover:underline">
                        <RotateCcw className="size-3" /> Tentar novamente
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <TimelineJumpToLatest visible={hasNewMessagesBelow} onClick={() => scrollMeetingChatToBottom("smooth")} label="Novas mensagens" />
      </div>

      <div className="relative min-w-0 shrink-0 border-t border-border bg-card p-2.5">
        {localError && (
          <div className="mb-2 flex items-start gap-2 rounded-lg bg-destructive/8 px-2.5 py-2 text-[0.6rem] text-destructive">
            <span className="min-w-0 flex-1">{localError}</span>
            <button type="button" onClick={() => setLocalError("")}><X className="size-3" /></button>
          </div>
        )}

        {replyingTo && (
          <div className="mb-2 flex min-w-0 items-center gap-2 rounded-lg border border-primary/15 bg-primary/5 px-2 py-1.5">
            <Reply className="size-3 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.56rem] font-semibold text-primary">Respondendo</span>
              <span className="block truncate text-[0.58rem] text-muted-foreground">{replySummary(replyingTo)}</span>
            </span>
            <button type="button" onClick={() => setReplyingTo(null)} className="text-muted-foreground"><X className="size-3" /></button>
          </div>
        )}

        {mentionRange && mentionCandidates.length > 0 && (
          <div className="absolute bottom-[calc(100%-0.1rem)] left-2 right-2 z-30 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl">
            <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5 text-[0.58rem] font-medium text-muted-foreground"><AtSign className="size-3" /> Adicionar e mencionar</div>
            <div className="max-h-52 overflow-y-auto py-1">
              {mentionCandidates.map((candidate, index) => candidate.kind === "group" ? (
                <button
                  key={`group-${candidate.key}`}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMention(candidate)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left", index === mentionIndex ? "bg-primary/10" : "hover:bg-muted")}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><AtSign className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.65rem] font-semibold text-primary">{candidate.title}</span>
                    <span className="block truncate text-[0.54rem] text-muted-foreground">{candidate.description}</span>
                  </span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.5rem] text-muted-foreground">{candidate.userIds.length}</span>
                  {index === mentionIndex && <span className="text-[0.5rem] text-muted-foreground">Enter</span>}
                </button>
              ) : (
                <button
                  key={candidate.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectMention(candidate)}
                  className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left", index === mentionIndex ? "bg-primary/10" : "hover:bg-muted")}
                >
                  <MemberAvatar member={candidate.member} className="size-7 ring-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.65rem] font-semibold">@{candidate.label}</span>
                    <span className="block truncate text-[0.54rem] text-muted-foreground">{candidate.description}</span>
                  </span>
                  {index === mentionIndex && <span className="text-[0.5rem] text-muted-foreground">Enter</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm transition-colors focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/10">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              stageFiles(event.target.files)
              event.currentTarget.value = ""
            }}
          />

          {!recordingAudio && stagedFiles.length > 0 && (
            <div className="border-b border-border bg-muted/10 px-2.5 pb-2 pt-2.5">
              <div className="flex min-w-0 items-stretch gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {stagedFiles.map((file, index) => (
                  <MeetingInlineFilePreview
                    key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                    file={file}
                    onRemove={() => updateStagedFiles(stagedFiles.filter((_, itemIndex) => itemIndex !== index))}
                    onReplace={(editedFile) => updateStagedFiles(stagedFiles.map((current, itemIndex) => itemIndex === index ? editedFile : current))}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sendingMedia}
                  className="flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/20 text-[0.56rem] text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-50 sm:h-28"
                  title="Adicionar mais arquivos"
                  aria-label="Adicionar mais arquivos"
                >
                  <span className="flex size-8 items-center justify-center rounded-lg bg-background ring-1 ring-border"><Plus className="size-4" /></span>
                  <span>Adicionar</span>
                </button>
              </div>
              <div className="mt-1.5 flex items-center justify-between gap-3 px-0.5 text-[0.54rem] text-muted-foreground">
                <span>{stagedFiles.length} {stagedFiles.length === 1 ? "arquivo pronto" : "arquivos prontos"} para enviar</span>
                <button
                  type="button"
                  onClick={() => updateStagedFiles([])}
                  disabled={sendingMedia}
                  className="font-medium transition-colors hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                >
                  Remover todos
                </button>
              </div>
            </div>
          )}

          <div className="flex min-w-0 items-end gap-1.5 px-2 py-2">
            {!recordingAudio && (
              <>
                <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={sendingMedia} title="Anexar arquivo">
                  <Paperclip className="size-3.5" />
                </Button>
                <RichMessageComposer
                  ref={inputRef}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value)
                    setDraftMentions((current) => current.filter((mention) => event.target.value.includes(mentionToken(mention))))
                    syncMention(event.target.value, event.target.selectionStart)
                  }}
                  onClick={(event) => syncMention(message, event.currentTarget.selectionStart)}
                  onKeyDown={(event) => {
                    if (mentionRange && mentionCandidates.length) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault(); setMentionIndex((current) => (current + 1) % mentionCandidates.length); return
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault(); setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length); return
                      }
                      if (event.key === "Enter" || event.key === "Tab") {
                        event.preventDefault(); selectMention(mentionCandidates[mentionIndex] ?? mentionCandidates[0]); return
                      }
                      if (event.key === "Escape") {
                        event.preventDefault(); setMentionRange(null); return
                      }
                    }
                    if (event.key === "Escape" && replyingTo) {
                      event.preventDefault(); setReplyingTo(null); return
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault(); void submitMessage()
                    }
                  }}
                  onPaste={(event) => {
                    const files = filesFromClipboard(event.clipboardData)
                    if (!files.length) return
                    event.preventDefault()
                    event.stopPropagation()
                    queueMeetingFiles(files)
                  }}
                  rows={1}
                  maxLength={2500}
                  placeholder={stagedFiles.length ? "Adicionar uma legenda…" : "Mensagem… use @ para chamar pessoas ou equipes"}
                  className="max-h-28 min-h-8 min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-1.5 text-[0.7rem] leading-5 outline-none focus:ring-0"
                />
              </>
            )}
            <AudioRecordButton
              disabled={sendingMedia || stagedFiles.length > 0}
              onRecordingChange={(recording) => {
                setRecordingAudio(recording)
                if (recording) {
                  setMentionRange(null)
                  setReplyingTo(null)
                }
              }}
              onRecorded={(audio, durationMs) => conversation ? sendChatAudio(conversation.id, audio, durationMs) : Promise.resolve(false)}
            />
            {!recordingAudio && (
              <Button
                type="button"
                size="icon"
                className="size-8 shrink-0"
                onClick={() => void submitMessage()}
                disabled={(!message.trim() && stagedFiles.length === 0) || sending || sendingMedia}
                title="Enviar"
              >
                {sending || sendingMedia ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1.5 px-1 text-[0.54rem] leading-relaxed text-muted-foreground">Enter envia · Shift+Enter quebra linha · Ctrl+V cola anexos · arraste arquivos para o chat · @ menciona e chama</p>
      </div>

    </div>
  )
}
