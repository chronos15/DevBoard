"use client"

import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  GripVertical,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
} from "lucide-react"
import { useStore } from "@/lib/store"
import type { AqsReview, AqsReviewStatus } from "@/lib/types"
import { PageHeading } from "@/components/page-heading"
import { MemberAvatar } from "@/components/member-avatar"
import { AttachmentDialog } from "@/components/attachments/attachment-dialog"
import { CommentDialog } from "@/components/comments/comment-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const columns: Array<{
  status: AqsReviewStatus
  label: string
  helper: string
  tone: string
}> = [
  { status: "awaiting", label: "Aguardando Análise", helper: "Fila enviada pelo desenvolvimento", tone: "bg-chart-2" },
  { status: "evaluating", label: "Avaliando", helper: "Em validação pelo AQS", tone: "bg-chart-3" },
  { status: "completed", label: "Concluída", helper: "Aprovada e concluída no projeto", tone: "bg-success" },
  { status: "revoked", label: "Revogada", helper: "Retornada ao desenvolvedor", tone: "bg-destructive" },
]

function elapsed(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime())
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return "há menos de 1h"
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.floor(hours / 24)}d`
}

export function AnalysisView() {
  const [focusSubId, setFocusSubId] = React.useState<string | null>(null)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setFocusSubId(params.get("sub"))
  }, [])
  const {
    aqsReviews,
    projects,
    members,
    currentUserId,
    currentUserRole,
    startAqsReview,
    completeAqsReview,
    revokeAqsReview,
    addSubactivityAttachments,
    setSubactivityAttachmentActive,
    addSubactivityComment,
  } = useStore()
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [over, setOver] = React.useState<AqsReviewStatus | null>(null)
  const [busy, setBusy] = React.useState<Set<string>>(() => new Set())
  const [revokeTarget, setRevokeTarget] = React.useState<AqsReview | null>(null)
  const [reason, setReason] = React.useState("")
  const canReview = currentUserRole === "admin" || currentUserRole === "aqs"

  const locate = React.useCallback((review: AqsReview) => {
    const project = projects.find((item) => item.id === review.projectId)
    const activity = project?.activities.find((item) => item.id === review.activityId)
    const sub = activity?.subactivities.find((item) => item.id === review.subactivityId)
    const developer = members.find((item) => item.id === sub?.assigneeId)
    const aqs = members.find((item) => item.id === review.assignedAqsId)
    return { project, activity, sub, developer, aqs }
  }, [members, projects])

  const active = aqsReviews.filter((item) => item.status === "awaiting" || item.status === "evaluating").length
  const evaluating = aqsReviews.filter((item) => item.status === "evaluating").length
  const completed = aqsReviews.filter((item) => item.status === "completed").length
  const revoked = aqsReviews.filter((item) => item.status === "revoked").length

  async function withBusy(id: string, action: () => Promise<boolean>) {
    setBusy((current) => new Set(current).add(id))
    try {
      return await action()
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  async function transition(review: AqsReview, target: AqsReviewStatus) {
    if (!canReview || review.status === target) return
    if (target === "evaluating" && review.status === "awaiting") {
      await withBusy(review.id, () => startAqsReview(review.id))
      return
    }
    if (target === "completed" && (review.status === "awaiting" || review.status === "evaluating")) {
      await withBusy(review.id, () => completeAqsReview(review.id))
      return
    }
    if (target === "revoked" && (review.status === "awaiting" || review.status === "evaluating")) {
      setReason("")
      setRevokeTarget(review)
    }
  }

  function drop(target: AqsReviewStatus, event: React.DragEvent) {
    event.preventDefault()
    const id = event.dataTransfer.getData("text/aqs-review") || dragging
    const review = aqsReviews.find((item) => item.id === id)
    setDragging(null)
    setOver(null)
    if (review) void transition(review, target)
  }

  async function confirmRevoke() {
    if (!revokeTarget || reason.trim().length < 3) return
    const ok = await withBusy(revokeTarget.id, () => revokeAqsReview(revokeTarget.id, reason.trim()))
    if (ok) {
      setRevokeTarget(null)
      setReason("")
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeading
        eyebrow="Qualidade"
        title="Análise AQS"
        subtitle="Fila única de validação. Aprovar conclui o trabalho do DEV; revogar devolve a tarefa com alerta e notificação."
      />

      {!canReview && (
        <div className="rounded-xl border border-border bg-muted/35 px-4 py-3 text-xs text-muted-foreground">
          Você pode acompanhar toda a fila AQS. Apenas AQS e Administradores podem iniciar, concluir ou revogar análises.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Na fila", value: active, Icon: ClipboardCheck },
          { label: "Avaliando", value: evaluating, Icon: ShieldCheck },
          { label: "Concluídas", value: completed, Icon: CheckCircle2 },
          { label: "Revogadas", value: revoked, Icon: RotateCcw },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl bg-card p-4 ring-1 ring-foreground/8">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">{label}</span>
              <Icon className="size-4 text-muted-foreground" />
            </div>
            <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-3">
        <div className="flex w-max min-w-full flex-nowrap items-stretch gap-3">
          {columns.map((column) => {
            const reviews = aqsReviews.filter((item) => item.status === column.status)
            return (
              <section
                key={column.status}
                onDragOver={(event) => {
                  if (!dragging) return
                  event.preventDefault()
                  setOver(column.status)
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(event) => drop(column.status, event)}
                className={cn(
                  "flex min-h-[520px] w-[300px] min-w-[300px] flex-col rounded-2xl border border-border bg-muted/25 p-2.5 transition-colors xl:w-[320px] xl:min-w-[320px]",
                  over === column.status && "border-primary/35 bg-primary/[0.04]",
                )}
              >
                <header className="px-1 py-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-2 rounded-full", column.tone)} />
                      <h2 className="text-xs font-semibold">{column.label}</h2>
                    </div>
                    <span className="rounded-full bg-card px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground ring-1 ring-foreground/8">{reviews.length}</span>
                  </div>
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">{column.helper}</p>
                </header>

                <div className="mt-2 flex flex-1 flex-col gap-2">
                  {reviews.map((review) => {
                    const { project, activity, sub, developer, aqs } = locate(review)
                    if (!project || !activity || !sub) return null
                    const isBusy = busy.has(review.id)
                    const lockedByOther = review.status === "evaluating" && Boolean(review.assignedAqsId && review.assignedAqsId !== currentUserId && currentUserRole !== "admin")
                    const canDrag = canReview && !isBusy && !lockedByOther && (review.status === "awaiting" || review.status === "evaluating")
                    const focused = focusSubId === sub.id
                    return (
                      <article
                        key={review.id}
                        draggable={canDrag}
                        onDragStart={(event) => {
                          setDragging(review.id)
                          event.dataTransfer.setData("text/aqs-review", review.id)
                          event.dataTransfer.effectAllowed = "move"
                        }}
                        onDragEnd={() => { setDragging(null); setOver(null) }}
                        className={cn(
                          "rounded-xl bg-card p-3 ring-1 ring-foreground/8 transition-all",
                          canDrag && "hover:-translate-y-0.5 hover:shadow-md",
                          focused && "ring-2 ring-primary/35",
                          dragging === review.id && "opacity-50",
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <GripVertical className={cn("mt-0.5 size-4 shrink-0", canDrag ? "cursor-grab text-muted-foreground/55" : "text-muted-foreground/20")} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[0.68rem] font-medium text-primary">{project.name}</p>
                            <h3 className="mt-1 text-sm font-semibold leading-snug">{sub.title}</h3>
                            <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{activity.title}</p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/45 p-2 text-[0.65rem]">
                          <div>
                            <p className="text-muted-foreground">Desenvolvedor</p>
                            <div className="mt-1 flex min-w-0 items-center gap-1.5">
                              <MemberAvatar member={developer} className="size-6" />
                              <span className="truncate font-medium">{developer?.name ?? "Sem responsável"}</span>
                            </div>
                          </div>
                          <div>
                            <p className="text-muted-foreground">AQS</p>
                            <div className="mt-1 flex min-w-0 items-center gap-1.5">
                              {aqs ? <MemberAvatar member={aqs} className="size-6" /> : <span className="size-6 rounded-full border border-dashed border-border" />}
                              <span className="truncate font-medium">{aqs?.name ?? "Não atribuído"}</span>
                            </div>
                          </div>
                        </div>

                        {review.revokedReason && (
                          <div className="mt-2 flex gap-2 rounded-lg bg-destructive/10 p-2 text-[0.68rem] leading-relaxed text-destructive">
                            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                            <span>{review.revokedReason}</span>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
                          <span className="flex items-center gap-1 text-[0.65rem] text-muted-foreground"><Clock3 className="size-3" /> {elapsed(review.createdAt)}</span>
                          <div className="flex items-center gap-0.5">
                            <CommentDialog
                              title={`Comentários · ${sub.title}`}
                              description="Observações da validação. O comentário também fica no histórico da subatividade."
                              comments={sub.comments ?? []}
                              onAdd={(content) => addSubactivityComment(sub.id, content)}
                              compact
                            />
                            <AttachmentDialog
                              title={`Evidências AQS · ${sub.title}`}
                              description="Anexe prints, vídeos, documentos, SQL e demais evidências da análise."
                              attachments={sub.attachments ?? []}
                              onAdd={(files) => addSubactivityAttachments(sub.id, files)}
                              onSetActive={(attachmentId, active) => setSubactivityAttachmentActive(sub.id, attachmentId, active)}
                              compact
                              buttonLabel="Evidências"
                            />
                          </div>
                        </div>

                        {canReview && (review.status === "awaiting" || review.status === "evaluating") && (
                          <div className="mt-2 flex gap-1.5">
                            {review.status === "awaiting" && (
                              <Button size="sm" className="flex-1" disabled={lockedByOther} loading={isBusy} onClick={() => void transition(review, "evaluating")}>Avaliar</Button>
                            )}
                            {review.status === "evaluating" && (
                              <>
                                <Button size="sm" variant="outline" className="flex-1" disabled={lockedByOther || isBusy} onClick={() => void transition(review, "revoked")}>Revogar</Button>
                                <Button size="sm" className="flex-1" disabled={lockedByOther} loading={isBusy} onClick={() => void transition(review, "completed")}>Concluir</Button>
                              </>
                            )}
                          </div>
                        )}
                        {lockedByOther && <p className="mt-2 text-[0.65rem] text-muted-foreground">Em análise por {aqs?.name ?? "outro AQS"}.</p>}
                      </article>
                    )
                  })}

                  {reviews.length === 0 && (
                    <div className="flex min-h-28 flex-1 items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
                      Nenhum item nesta etapa.
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open && !revokeTarget?.id) return; if (!open) setRevokeTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar análise AQS?</DialogTitle>
            <DialogDescription>
              A subatividade voltará para <strong>Aguardando</strong>, receberá um alerta visual e o desenvolvedor responsável será notificado.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Motivo / ajustes necessários</span>
            <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={5} placeholder="Descreva objetivamente o que precisa ser corrigido..." className="resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3} loading={Boolean(revokeTarget && busy.has(revokeTarget.id))} onClick={() => void confirmRevoke()}>Revogar e devolver ao DEV</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
