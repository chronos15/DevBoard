"use client"

import * as React from "react"
import { AlertTriangle, Clock3, GripVertical, LoaderCircle, LockKeyhole, Play, Square } from "lucide-react"
import type { ActivityFilter, Project, Status, Subactivity } from "@/lib/types"
import { useStore } from "@/lib/store"
import {
  formatHMS,
  matchesActivityFilter,
  statusMeta,
  statusOrder,
} from "@/lib/project-utils"
import { MemberAvatar } from "@/components/member-avatar"
import { CommentDialog } from "@/components/comments/comment-dialog"
import { AttachmentDialog } from "@/components/attachments/attachment-dialog"
import { SubactivityStatusConfirmDialog } from "@/components/project-detail/subactivity-status-confirm-dialog"
import { CopyEntityLinkButton } from "@/components/copy-entity-link-button"
import { cn } from "@/lib/utils"

type KanbanItem = {
  activityId: string
  activityTitle: string
  sub: Subactivity
}

type PendingTransition = {
  subId: string
  subTitle: string
  fromStatus: Status
  toStatus: Status
}

export function SubactivityKanban({
  project,
  filter = "all",
  assigneeId = "all",
}: {
  project: Project
  filter?: ActivityFilter
  assigneeId?: string
}) {
  const {
    members,
    setSubStatus,
    runningSubIds,
    startTimer,
    stopTimer,
    canManageSubactivity,
    addSubactivityComment,
    addSubactivityAttachments,
    setSubactivityAttachmentActive,
    currentUserRole,
  } = useStore()
  const [draggingId, setDraggingId] = React.useState<string | null>(null)
  const [overStatus, setOverStatus] = React.useState<Status | null>(null)
  const [pendingTransition, setPendingTransition] = React.useState<PendingTransition | null>(null)
  const [pendingIds, setPendingIds] = React.useState<Set<string>>(() => new Set())

  const items: KanbanItem[] = project.activities.flatMap((activity) =>
    activity.subactivities
      .filter(
        (sub) =>
          matchesActivityFilter(sub.status, filter) &&
          (assigneeId === "all" || sub.assigneeId === assigneeId),
      )
      .map((sub) => ({
        activityId: activity.id,
        activityTitle: activity.title,
        sub,
      })),
  )

  async function commitStatus(subId: string, status: Status) {
    setPendingIds((current) => new Set(current).add(subId))
    try {
      return await setSubStatus(subId, status)
    } finally {
      setPendingIds((current) => {
        const next = new Set(current)
        next.delete(subId)
        return next
      })
    }
  }

  async function toggleTimer(subId: string, running: boolean) {
    setPendingIds((current) => new Set(current).add(subId))
    try {
      return await (running ? stopTimer(subId) : startTimer(subId))
    } finally {
      setPendingIds((current) => {
        const next = new Set(current)
        next.delete(subId)
        return next
      })
    }
  }

  function requestStatus(item: KanbanItem, nextStatus: Status) {
    if (item.sub.status === nextStatus) return
    const nextTerminal = nextStatus === "done" || nextStatus === "cancelled"
    const currentTerminal = item.sub.status === "done" || item.sub.status === "cancelled"

    if (nextTerminal || (currentTerminal && currentUserRole === "admin")) {
      setPendingTransition({
        subId: item.sub.id,
        subTitle: item.sub.title,
        fromStatus: item.sub.status,
        toStatus: nextStatus,
      })
      return
    }

    void commitStatus(item.sub.id, nextStatus)
  }

  function drop(status: Status, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const subId = event.dataTransfer.getData("text/subactivity-id") || draggingId
    const item = items.find((current) => current.sub.id === subId)
    if (item && canManageSubactivity(item.sub)) requestStatus(item, status)
    setDraggingId(null)
    setOverStatus(null)
  }

  async function confirmTransition() {
    if (!pendingTransition) return
    const ok = await commitStatus(pendingTransition.subId, pendingTransition.toStatus)
    if (ok) setPendingTransition(null)
  }

  return (
    <>
      <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-3">
        <div className="flex w-max min-w-full flex-nowrap items-stretch gap-3">
          {statusOrder.map((status) => {
            const columnItems = items.filter((item) => item.sub.status === status)
            const meta = statusMeta[status]
            const isOver = overStatus === status

            return (
              <div
                key={status}
                onDragOver={(event) => {
                  if (!draggingId) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = "move"
                  setOverStatus(status)
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setOverStatus(null)
                  }
                }}
                onDrop={(event) => drop(status, event)}
                className={cn(
                  "flex min-h-[430px] w-[255px] min-w-[255px] flex-col rounded-2xl border border-border bg-muted/25 p-2.5 transition-colors xl:w-[270px] xl:min-w-[270px]",
                  isOver && "border-primary/40 bg-primary/[0.045]",
                )}
              >
                <div className="flex items-center justify-between px-1 py-1.5">
                  <div className="flex items-center gap-2">
                    <span className={cn("size-2 rounded-full", meta.columnClassName)} />
                    <h3 className="text-xs font-semibold">{meta.label}</h3>
                  </div>
                  <span className="rounded-full bg-card px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground ring-1 ring-foreground/8">
                    {columnItems.length}
                  </span>
                </div>

                <div className="mt-2 flex flex-1 flex-col gap-2">
                  {columnItems.map((item) => {
                    const member = members.find((m) => m.id === item.sub.assigneeId)
                    const running = runningSubIds.includes(item.sub.id)
                    const terminal = item.sub.status === "done" || item.sub.status === "cancelled"
                    const canManage = canManageSubactivity(item.sub)
                    const pending = pendingIds.has(item.sub.id)

                    return (
                      <article
                        key={item.sub.id}
                        draggable={canManage && !pending}
                        onDragStart={(event) => {
                          if (!canManage || pending) {
                            event.preventDefault()
                            return
                          }
                          setDraggingId(item.sub.id)
                          event.dataTransfer.setData("text/subactivity-id", item.sub.id)
                          event.dataTransfer.effectAllowed = "move"
                        }}
                        onDragEnd={() => {
                          setDraggingId(null)
                          setOverStatus(null)
                        }}
                        title={
                          canManage
                            ? terminal && currentUserRole === "admin"
                              ? "Status final. Como administrador, você pode alterar mediante confirmação."
                              : undefined
                            : terminal
                              ? "Status final. Membros comuns não podem alterar uma subatividade concluída ou cancelada."
                              : "Somente o Desenvolvedor responsável ou um Administrador pode alterar status e cronômetro; comentários continuam liberados"
                        }
                        className={cn(
                          "group rounded-xl bg-card p-3 shadow-sm ring-1 ring-foreground/8 transition-all",
                          canManage && "hover:-translate-y-0.5 hover:shadow-md",
                          !canManage && "cursor-not-allowed",
                          draggingId === item.sub.id && "opacity-45",
                          running && "ring-primary/35",
                          item.sub.status === "cancelled" && "opacity-70",
                          pending && "ring-primary/25",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {canManage ? (
                            <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/55 group-active:cursor-grabbing" />
                          ) : (
                            <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground/45" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className={cn("text-sm font-medium leading-snug", terminal && "text-muted-foreground line-through")}>
                              {item.sub.title}
                            </p>
                            <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">
                              {item.activityTitle}
                            </p>
                            {item.sub.needsAttention && (
                              <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-chart-4/15 px-2 py-1 text-[0.65rem] font-medium text-chart-4">
                                <AlertTriangle className="size-3.5 shrink-0" />
                                <span className="line-clamp-2">Ajustes solicitados pelo AQS</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
                          <div className="flex min-w-0 items-center gap-2">
                            <MemberAvatar member={member} />
                            <span className={cn("flex items-center gap-1 font-mono text-[0.68rem] tabular-nums", running ? "text-primary" : "text-muted-foreground")}>
                              <Clock3 className="size-3" />
                              {formatHMS(item.sub.trackedSeconds)}
                            </span>
                          </div>
                          <div
                            className="flex items-center gap-0.5"
                            draggable={false}
                            onPointerDown={(event) => event.stopPropagation()}
                            onDragStart={(event) => event.preventDefault()}
                          >
                            <CopyEntityLinkButton
                              href={`/projetos/${project.id}#sub-${item.sub.id}`}
                              label={`Copiar link da subatividade ${item.sub.title}`}
                            />
                            <CommentDialog
                              title={`Comentários · ${item.sub.title}`}
                              description="Discussão da subatividade. Todos os usuários podem comentar."
                              comments={item.sub.comments ?? []}
                              onAdd={(content) => addSubactivityComment(item.sub.id, content)}
                              compact
                            />
                            <AttachmentDialog
                              title={`Arquivos · ${item.sub.title}`}
                              description="Mídias, documentação, SQL e arquivos da subatividade. Qualquer usuário pode adicionar e visualizar."
                              attachments={item.sub.attachments ?? []}
                              onAdd={(files) => addSubactivityAttachments(item.sub.id, files)}
                              onSetActive={(attachmentId, active) =>
                                void setSubactivityAttachmentActive(item.sub.id, attachmentId, active)
                              }
                              compact
                              buttonLabel="Arquivos"
                            />
                          </div>
                          {!terminal && item.sub.status !== "waiting-aqs" && (
                            <button
                              type="button"
                              disabled={!canManage || pending}
                              onClick={() => { void toggleTimer(item.sub.id, running) }}
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                                !canManage
                                  ? "cursor-not-allowed bg-muted text-muted-foreground/40"
                                  : running
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary",
                              )}
                              aria-label={
                                canManage
                                  ? running
                                    ? "Pausar subatividade"
                                    : "Executar subatividade"
                                  : "Subatividade protegida"
                              }
                            >
                              {pending ? (
                                <LoaderCircle className="size-3.5 animate-spin" />
                              ) : !canManage ? (
                                <LockKeyhole className="size-3.5" />
                              ) : running ? (
                                <Square className="size-3.5 fill-current" />
                              ) : (
                                <Play className="size-3.5 fill-current" />
                              )}
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })}

                  {columnItems.length === 0 && (
                    <div className="flex min-h-24 flex-1 items-center justify-center rounded-xl border border-dashed border-border px-3 text-center text-xs text-muted-foreground">
                      {filter === "all" && assigneeId === "all"
                        ? "Arraste uma subatividade para cá"
                        : "Nenhum item neste filtro"}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {pendingTransition && (
        <SubactivityStatusConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingTransition(null)
          }}
          subactivityTitle={pendingTransition.subTitle}
          fromStatus={pendingTransition.fromStatus}
          toStatus={pendingTransition.toStatus}
          isAdmin={currentUserRole === "admin"}
          onConfirm={confirmTransition}
          loading={pendingIds.has(pendingTransition.subId)}
        />
      )}
    </>
  )
}
