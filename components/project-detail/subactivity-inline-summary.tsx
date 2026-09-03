"use client"

import * as React from "react"
import {
  Activity as ActivityIcon,
  Clock3,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  MessageSquareText,
  Paperclip,
} from "lucide-react"
import type { AttachmentEntry, Subactivity } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { formatHMS } from "@/lib/project-utils"
import { openProjectFollowUp } from "@/lib/follow-up-launcher"
import { cn } from "@/lib/utils"

function formatMoment(value: string) {
  const date = new Date(value)
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function AttachmentIcon({ attachment }: { attachment: AttachmentEntry }) {
  const Icon = attachment.kind === "image"
    ? FileImage
    : attachment.kind === "video"
      ? FileVideo
      : attachment.kind === "audio"
        ? FileAudio
        : attachment.kind === "text"
          ? FileCode2
          : attachment.kind === "pdf" || attachment.kind === "document"
            ? FileText
            : Paperclip
  return <Icon className="size-3.5 shrink-0" />
}

type InlineTimelineItem =
  | { kind: "comment"; id: string; createdAt: string; authorId: string; content: string }
  | { kind: "attachment"; id: string; createdAt: string; authorId: string; attachment: AttachmentEntry }
  | { kind: "session"; id: string; createdAt: string; authorId: string; durationSeconds: number }
  | { kind: "log"; id: string; createdAt: string; authorId?: string; title: string; description?: string }

export function SubactivityInlineSummary({
  projectId,
  sub,
}: {
  projectId: string
  sub: Subactivity
}) {
  const { members, projects, workSessions } = useStore()
  const project = projects.find((item) => item.id === projectId)

  const timeline = React.useMemo<InlineTimelineItem[]>(() => {
    const items: InlineTimelineItem[] = []

    for (const comment of sub.comments ?? []) {
      items.push({
        kind: "comment",
        id: `comment-${comment.id}`,
        createdAt: comment.createdAt,
        authorId: comment.authorId,
        content: comment.content,
      })
    }

    for (const attachment of (sub.attachments ?? []).filter((item) => item.active)) {
      items.push({
        kind: "attachment",
        id: `attachment-${attachment.id}`,
        createdAt: attachment.createdAt,
        authorId: attachment.uploadedBy,
        attachment,
      })
    }

    for (const session of workSessions.filter((item) => item.subactivityId === sub.id)) {
      items.push({
        kind: "session",
        id: `session-${session.id}`,
        createdAt: session.startedAt,
        authorId: session.userId,
        durationSeconds: session.durationSeconds,
      })
    }

    const needle = sub.title.trim().toLocaleLowerCase("pt-BR")
    if (needle && project) {
      for (const log of project.logs ?? []) {
        if (log.title === "Mensagem adicionada no acompanhamento" || log.type === "attachment-added" || log.type === "attachment-status") continue
        const haystack = `${log.title} ${log.description ?? ""}`.toLocaleLowerCase("pt-BR")
        if (!haystack.includes(needle)) continue
        items.push({
          kind: "log",
          id: `log-${log.id}`,
          createdAt: log.createdAt,
          authorId: log.actorId,
          title: log.title,
          description: log.description,
        })
      }
    }

    return items.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  }, [project, sub, workSessions])

  const visibleTimeline = timeline.slice(-20)
  const hiddenCount = Math.max(0, timeline.length - visibleTimeline.length)

  return (
    <div className="mx-2 mb-0 mt-2 overflow-hidden rounded-xl border border-border/75 bg-muted/[0.16] sm:mx-3">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/60 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-semibold">Resumo do acompanhamento</p>
          <p className="mt-0.5 truncate text-[0.66rem] text-muted-foreground">
            Mensagens, anexos, horas e alterações em ordem cronológica.
          </p>
        </div>
        <button
          type="button"
          onClick={() => openProjectFollowUp({ projectId, subactivityId: sub.id })}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-[0.65rem] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MessageSquareText className="size-3.5" />
          <span className="hidden sm:inline">Abrir acompanhamento</span>
          <span className="sm:hidden">Abrir</span>
        </button>
      </div>

      {visibleTimeline.length === 0 ? (
        <div className="px-3 py-5 text-center text-xs text-muted-foreground">
          Ainda não há mensagens, anexos ou registros nesta subatividade.
        </div>
      ) : (
        <div className="max-h-[360px] overflow-y-auto overscroll-contain px-2 py-2">
          {hiddenCount > 0 && (
            <div className="mb-2 rounded-lg bg-muted/45 px-2.5 py-1.5 text-center text-[0.62rem] text-muted-foreground">
              {hiddenCount} registro{hiddenCount === 1 ? "" : "s"} anterior{hiddenCount === 1 ? "" : "es"} oculto{hiddenCount === 1 ? "" : "s"} neste resumo.
            </div>
          )}
          <div className="space-y-1.5">
            {visibleTimeline.map((item) => {
              const author = item.authorId ? members.find((member) => member.id === item.authorId) : undefined
              return (
                <div key={item.id} className="flex min-w-0 gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted/35">
                  <div className="mt-0.5 shrink-0">
                    {item.kind === "log" ? (
                      <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ActivityIcon className="size-3.5" />
                      </span>
                    ) : (
                      <MemberAvatar member={author} className="size-6 text-[0.55rem]" profileEnabled={false} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5 text-[0.65rem]">
                      {item.kind !== "log" && <span className="truncate font-semibold"><MemberName member={author} /></span>}
                      {item.kind === "log" && <span className="truncate font-semibold">{item.title}</span>}
                      <span className="ml-auto shrink-0 font-mono text-[0.58rem] text-muted-foreground">{formatMoment(item.createdAt)}</span>
                    </div>

                    {item.kind === "comment" && (
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">{item.content}</p>
                    )}
                    {item.kind === "attachment" && (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2 py-1.5 text-xs">
                        <AttachmentIcon attachment={item.attachment} />
                        <span className="truncate font-medium">{item.attachment.name}</span>
                      </div>
                    )}
                    {item.kind === "session" && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock3 className="size-3.5" />
                        Registrou <span className="font-mono tabular-nums text-foreground">{formatHMS(item.durationSeconds)}</span> de trabalho.
                      </p>
                    )}
                    {item.kind === "log" && item.description && (
                      <p className={cn("mt-0.5 text-xs leading-relaxed text-muted-foreground", item.description.length > 260 && "line-clamp-3")}>{item.description}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
