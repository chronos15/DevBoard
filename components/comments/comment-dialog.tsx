"use client"

import * as React from "react"
import { AtSign, MessageSquare, Send } from "lucide-react"
import type { ChatMention, CommentEntry } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { mentionCandidates as buildMentionCandidates, mentionTokenForCandidate, mentionsForCandidate, mergeMentions, isUserMentioned, type MentionCandidate } from "@/lib/mention-groups"

function formatCommentDate(value: string) {
  const date = new Date(value)
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function CommentDialog({
  title,
  description,
  comments,
  onAdd,
  compact = false,
  className,
  enableMentions = false,
  mentionAudienceUserIds,
}: {
  title: string
  description: string
  comments: CommentEntry[]
  onAdd: (content: string, mentions?: ChatMention[]) => Promise<boolean> | boolean | void
  compact?: boolean
  className?: string
  enableMentions?: boolean
  /** Destinatários já vinculados ao tópico usados exclusivamente pelo @todos. */
  mentionAudienceUserIds?: string[]
}) {
  const { members, memberPresence, currentUserId } = useStore()
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const [mentions, setMentions] = React.useState<ChatMention[]>([])
  const [mentionRange, setMentionRange] = React.useState<{ start: number; end: number; query: string } | null>(null)
  const [mentionIndex, setMentionIndex] = React.useState(0)
  const [sending, setSending] = React.useState(false)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const currentUser = members.find((member) => member.id === currentUserId)
  const sortedComments = React.useMemo(
    () => [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [comments],
  )
  const mentionCandidates = React.useMemo<MentionCandidate[]>(() => {
    if (!enableMentions || !mentionRange) return []
    return buildMentionCandidates({ members, currentUserId, query: mentionRange.query, memberPresence, todosUserIds: mentionAudienceUserIds, userLimit: 7 })
  }, [currentUserId, enableMentions, memberPresence, members, mentionAudienceUserIds, mentionRange])

  function detectMention(value: string, caret: number | null) {
    if (!enableMentions) return
    const position = caret ?? value.length
    const before = value.slice(0, position)
    const match = before.match(/(?:^|\s)@([^\s@]*)$/)
    if (!match) {
      setMentionRange(null)
      return
    }
    const query = match[1] ?? ""
    setMentionRange({ start: position - query.length - 1, end: position, query })
    setMentionIndex(0)
  }

  function selectMention(candidate: MentionCandidate) {
    if (!mentionRange) return
    const token = mentionTokenForCandidate(candidate)
    const next = `${text.slice(0, mentionRange.start)}${token} ${text.slice(mentionRange.end)}`
    const caret = mentionRange.start + token.length + 1
    setText(next)
    setMentions((current) => mergeMentions(current, mentionsForCandidate(candidate)))
    setMentionRange(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    })
  }

  async function submit() {
    const clean = text.trim()
    if (!clean || sending) return
    setSending(true)
    try {
      const validMentions = mentions.filter((mention) => clean.includes(`@${mention.label}`))
      const result = await onAdd(clean, validMentions)
      if (result !== false) {
        setText("")
        setMentions([])
        setMentionRange(null)
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          compact
            ? "inline-flex h-7 min-w-7 cursor-pointer items-center justify-center gap-1 rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            : "flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted",
          className,
        )}
        aria-label={`Comentários de ${title}`}
        title="Comentários"
      >
        <MessageSquare className={compact ? "size-3.5" : "size-3.5"} />
        {compact ? (
          comments.length > 0 && (
            <span className="font-mono text-[0.62rem] tabular-nums">{comments.length}</span>
          )
        ) : (
          <>
            <span>Comentários</span>
            {comments.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] tabular-nums text-muted-foreground">
                {comments.length}
              </span>
            )}
          </>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid min-w-0 max-h-[88dvh] w-[calc(100dvw-1.5rem)] max-w-[calc(100dvw-1.5rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-full sm:max-w-xl">
          <DialogHeader className="min-w-0 overflow-hidden border-b border-border px-4 py-4 pr-12 sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquare className="size-4" />
              </span>
              <div className="min-w-0 flex-1 overflow-hidden">
                <DialogTitle className="line-clamp-2 max-w-full break-words leading-snug sm:line-clamp-1" title={title}>{title}</DialogTitle>
                <DialogDescription className="mt-1 line-clamp-2 break-words">{description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto bg-muted/15 px-4 py-4 sm:px-5">
            {sortedComments.length === 0 ? (
              <div className="flex min-h-52 min-w-0 max-w-full flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-card px-4 text-center sm:px-6">
                <MessageSquare className="size-5 text-muted-foreground/50" />
                <p className="mt-3 max-w-full break-words text-sm font-medium">Nenhum comentário ainda</p>
                <p className="mt-1 max-w-sm break-words text-xs leading-relaxed text-muted-foreground">
                  Qualquer usuário pode participar desta conversa. O comentário fica identificado pelo autor e horário.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedComments.map((comment) => {
                  const author = members.find((member) => member.id === comment.authorId)
                  const own = comment.authorId === currentUserId
                  const mentionedCurrentUser = !own && isUserMentioned(comment.mentions, currentUserId)
                  return (
                    <article key={comment.id} className={cn("flex gap-2.5", own && "flex-row-reverse")}>
                      <MemberAvatar member={author} className="mt-0.5 size-8 ring-0" />
                      <div className={cn("min-w-0 max-w-[82%]", own && "text-right")}>
                        <div className={cn("mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5", own && "justify-end")}>
                          <MemberName member={author} className="text-[0.68rem] font-medium" fallback="Usuário" />
                          <time className="font-mono text-[0.6rem] text-muted-foreground">
                            {formatCommentDate(comment.createdAt)}
                          </time>
                        </div>
                        <p
                          className={cn(
                            "whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-left text-sm leading-relaxed",
                            own ? "rounded-tr-md bg-primary text-primary-foreground" : "rounded-tl-md bg-card ring-1 ring-foreground/8",
                            mentionedCurrentUser && "tb-mentioned-bubble rounded-tl-md",
                          )}
                        >
                          {comment.content}
                        </p>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>

          <div className="relative min-w-0 border-t border-border bg-card px-4 py-3 sm:px-5">
            {enableMentions && mentionRange && mentionCandidates.length > 0 && (
              <div className="absolute bottom-[calc(100%-0.25rem)] left-4 right-4 z-30 max-h-60 overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-xl sm:left-5 sm:right-5">
                <div className="px-2 py-1 text-[0.58rem] font-semibold uppercase tracking-wide text-muted-foreground">Mencionar pessoa ou equipe</div>
                {mentionCandidates.map((candidate, index) => candidate.kind === "group" ? (
                  <button key={`group-${candidate.key}`} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectMention(candidate)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left", index === mentionIndex ? "bg-primary/10" : "hover:bg-muted")}>
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><AtSign className="size-3.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-primary">{candidate.title}</span><span className="block truncate text-[0.58rem] text-muted-foreground">{candidate.description}</span></span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.55rem] text-muted-foreground">{candidate.userIds.length}</span>
                  </button>
                ) : (
                  <button key={candidate.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectMention(candidate)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left", index === mentionIndex ? "bg-primary/10" : "hover:bg-muted")}>
                    <MemberAvatar member={candidate.member} className="size-7 ring-0" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{candidate.member.name}</span><span className="block truncate text-[0.58rem] text-muted-foreground">{candidate.member.email ?? candidate.member.role}</span></span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex min-w-0 items-end gap-2">
              <MemberAvatar member={currentUser} className="mb-1 size-8 ring-0" />
              {enableMentions && (
                <button type="button" onClick={() => { const spacer = text && !text.endsWith(" ") ? " " : ""; const next = `${text}${spacer}@`; setText(next); detectMention(next, next.length); requestAnimationFrame(() => textareaRef.current?.focus()) }} className="mb-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Mencionar pessoa ou equipe"><AtSign className="size-3.5" /></button>
              )}
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(event) => {
                  const value = event.target.value
                  setText(value)
                  setMentions((current) => current.filter((mention) => value.includes(`@${mention.label}`)))
                  detectMention(value, event.target.selectionStart)
                }}
                onClick={(event) => detectMention(event.currentTarget.value, event.currentTarget.selectionStart)}
                onKeyDown={(event) => {
                  if (enableMentions && mentionRange && mentionCandidates.length > 0) {
                    if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((current) => (current + 1) % mentionCandidates.length); return }
                    if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((current) => (current - 1 + mentionCandidates.length) % mentionCandidates.length); return }
                    if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") { event.preventDefault(); selectMention(mentionCandidates[mentionIndex] ?? mentionCandidates[0]); return }
                    if (event.key === "Escape") { event.preventDefault(); setMentionRange(null); return }
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void submit()
                  }
                }}
                rows={2}
                maxLength={1200}
                placeholder="Escreva um comentário..."
                className="min-h-10 min-w-0 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              />
              <Button type="button" size="icon-lg" onClick={() => { void submit() }} disabled={!text.trim()} loading={sending} title="Enviar comentário">
                <Send className="size-4" />
                <span className="sr-only">Enviar comentário</span>
              </Button>
            </div>
            <p className={cn("mt-1.5 text-[0.6rem] text-muted-foreground", enableMentions ? "pl-20" : "pl-10")}>Enter envia · Shift + Enter quebra a linha{enableMentions ? " · @todos, @here, @desenvolvedores, @aqs e @admin" : ""}</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
