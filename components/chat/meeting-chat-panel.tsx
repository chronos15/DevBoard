"use client"

import * as React from "react"
import {
  AtSign,
  Loader2,
  MessageSquareText,
  Paperclip,
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
import { ChatAttachmentPreviewDialog } from "@/components/chat/chat-attachment-preview-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { toUserFacingError } from "@/lib/user-facing-error"
import { mentionCandidates as buildMentionCandidates, mentionTokenForCandidate, mentionsForCandidate, mergeMentions, isUserMentioned, type MentionCandidate } from "@/lib/mention-groups"

type MentionRange = { start: number; end: number; query: string }
type ReactionRow = { messageId: string; userId: string; emoji: string }

const REACTION_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀", "✅"] as const

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

function MessageText({ message, own }: { message: ChatMessage; own: boolean }) {
  const mentions = React.useMemo(() => {
    const unique = new Map<string, ChatMention>()
    for (const mention of message.mentions ?? []) unique.set(`${mention.kind}:${mention.id}`, mention)
    return Array.from(unique.values()).sort((a, b) => mentionToken(b).length - mentionToken(a).length)
  }, [message.mentions])

  if (!mentions.length) return <p className="whitespace-pre-wrap break-words">{message.content}</p>

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
    parts.push(
      <span
        key={`mention-${key++}`}
        className={cn(
          "inline-flex max-w-full items-center rounded-md px-1 py-0.5 font-medium",
          own ? "bg-primary-foreground/15 text-primary-foreground" : "bg-primary/12 text-primary",
        )}
      >
        {token}
      </span>,
    )
    cursor = nextIndex + token.length
  }
  return <p className="whitespace-pre-wrap break-words">{parts}</p>
}

export function MeetingChatPanel({ meeting }: { meeting: ChatMeeting }) {
  const {
    chatConversations,
    currentUserId,
    members,
    sendChatMessage,
    retryChatMessage,
    sendChatMedia,
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
  const [pickerMessageId, setPickerMessageId] = React.useState<string | null>(null)
  const [reactions, setReactions] = React.useState<ReactionRow[]>([])
  const [reactionBusy, setReactionBusy] = React.useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [historyHasMore, setHistoryHasMore] = React.useState(true)
  const [historyReady, setHistoryReady] = React.useState(false)
  const [sending, setSending] = React.useState(false)
  const [localError, setLocalError] = React.useState("")
  const [stagedFiles, setStagedFiles] = React.useState<File[]>([])
  const [attachmentOpen, setAttachmentOpen] = React.useState(false)
  const [sendingMedia, setSendingMedia] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const stickBottomRef = React.useRef(true)

  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (!mentionRange) return []
    const joinedIds = meeting.memberStates.filter((row) => row.status === "joined").map((row) => row.userId)
    return buildMentionCandidates({
      members,
      currentUserId,
      query: mentionRange.query,
      hereUserIds: joinedIds,
      todosUserIds: meeting.memberIds,
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
    if (!historyReady || !stickBottomRef.current) return
    requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }, [historyReady, lastMessageId])

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
    if (!conversation || sending || !message.trim()) return
    const content = message
    const mentions = draftMentions.filter((mention) => content.includes(mentionToken(mention)))
    setSending(true)
    setLocalError("")
    try {
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

      const sent = await sendChatMessage(conversation.id, content, mentions, replyingTo ?? undefined)
      if (!sent) return
      setMessage("")
      setDraftMentions([])
      setMentionRange(null)
      setReplyingTo(null)
      stickBottomRef.current = true
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

  function stageFiles(files: FileList | null) {
    if (!files?.length) return
    setStagedFiles(Array.from(files).filter((file) => file.size > 0))
    setAttachmentOpen(true)
  }

  async function submitMedia(caption: string) {
    if (!conversation || !stagedFiles.length || sendingMedia) return
    setSendingMedia(true)
    try {
      const ok = await sendChatMedia(conversation.id, stagedFiles, caption)
      if (ok) {
        setStagedFiles([])
        setAttachmentOpen(false)
        stickBottomRef.current = true
      }
    } finally {
      setSendingMedia(false)
    }
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-card">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold"><MessageSquareText className="size-3.5 text-primary" /> Chat da reunião</p>
          <p className="mt-0.5 truncate text-[0.56rem] text-muted-foreground">@ menciona e chama quem ainda não está na sala</p>
        </div>
      </div>

      <div
        ref={viewportRef}
        onScroll={(event) => {
          const el = event.currentTarget
          stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-2.5 py-2 [scrollbar-width:thin]"
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
          <div className="min-w-0 space-y-2.5">
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

                      {item.type === "audio" ? (
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

                      <div className={cn("mt-1 flex items-center justify-end gap-1 text-[0.5rem]", own ? "text-primary-foreground/65" : "text-muted-foreground")}>
                        {item.deliveryStatus === "sending" && <span>Enviando…</span>}
                        {item.deliveryStatus === "failed" && <span>Falha</span>}
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

        <div className="flex min-w-0 items-end gap-1.5">
          <textarea
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
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault(); void submitMessage()
              }
            }}
            rows={1}
            maxLength={2500}
            placeholder="Mensagem… use @ para chamar pessoas ou equipes"
            className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-border bg-background px-2.5 py-2 text-[0.7rem] leading-5 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
          />
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => { stageFiles(event.target.files); event.currentTarget.value = "" }} />
          <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={sendingMedia} title="Anexar arquivo">
            <Paperclip className="size-3.5" />
          </Button>
          <Button type="button" size="icon" className="size-9 shrink-0" onClick={() => void submitMessage()} disabled={!message.trim() || sending} title="Enviar">
            {sending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          </Button>
        </div>
      </div>

      <ChatAttachmentPreviewDialog
        files={stagedFiles}
        open={attachmentOpen}
        sending={sendingMedia}
        onOpenChange={(next) => {
          setAttachmentOpen(next)
          if (!next && !sendingMedia) setStagedFiles([])
        }}
        onFilesChange={setStagedFiles}
        onSend={submitMedia}
      />
    </div>
  )
}
