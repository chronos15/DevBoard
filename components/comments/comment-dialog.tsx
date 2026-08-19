"use client"

import * as React from "react"
import { MessageSquare, Send } from "lucide-react"
import type { CommentEntry } from "@/lib/types"
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
}: {
  title: string
  description: string
  comments: CommentEntry[]
  onAdd: (content: string) => Promise<boolean> | boolean | void
  compact?: boolean
  className?: string
}) {
  const { members, currentUserId } = useStore()
  const [open, setOpen] = React.useState(false)
  const [text, setText] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const currentUser = members.find((member) => member.id === currentUserId)
  const sortedComments = React.useMemo(
    () => [...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [comments],
  )

  async function submit() {
    const clean = text.trim()
    if (!clean || sending) return
    setSending(true)
    try {
      const result = await onAdd(clean)
      if (result !== false) setText("")
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
        <DialogContent className="grid max-h-[88dvh] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-4 py-4 pr-12 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquare className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="truncate">{title}</DialogTitle>
                <DialogDescription className="mt-1">{description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto bg-muted/15 px-4 py-4 sm:px-5">
            {sortedComments.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
                <MessageSquare className="size-5 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium">Nenhum comentário ainda</p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Qualquer usuário pode participar desta conversa. O comentário fica identificado pelo autor e horário.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sortedComments.map((comment) => {
                  const author = members.find((member) => member.id === comment.authorId)
                  const own = comment.authorId === currentUserId
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

          <div className="border-t border-border bg-card px-4 py-3 sm:px-5">
            <div className="flex items-end gap-2">
              <MemberAvatar member={currentUser} className="mb-1 size-8 ring-0" />
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault()
                    void submit()
                  }
                }}
                rows={2}
                maxLength={1200}
                placeholder="Escreva um comentário..."
                className="min-h-10 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              />
              <Button type="button" size="icon-lg" onClick={() => { void submit() }} disabled={!text.trim()} loading={sending} title="Enviar comentário">
                <Send className="size-4" />
                <span className="sr-only">Enviar comentário</span>
              </Button>
            </div>
            <p className="mt-1.5 pl-10 text-[0.6rem] text-muted-foreground">Enter envia · Shift + Enter quebra a linha</p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
