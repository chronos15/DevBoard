"use client"

import * as React from "react"
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Columns3,
  FolderKanban,
  GripVertical,
  List,
  RotateCcw,
  ShieldCheck,
  UserRound,
  X,
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

function dateKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function selectClassName() {
  return "h-10 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring"
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

  const [viewMode, setViewMode] = React.useState<"kanban" | "list">("kanban")
  const [dateFrom, setDateFrom] = React.useState("")
  const [dateTo, setDateTo] = React.useState("")
  const [projectFilter, setProjectFilter] = React.useState("all")
  const [developerFilter, setDeveloperFilter] = React.useState("all")
  const [responsibleFilter, setResponsibleFilter] = React.useState("all")
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

  const projectOptions = React.useMemo(() => {
    const ids = new Set(aqsReviews.map((review) => review.projectId))
    return projects.filter((project) => ids.has(project.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [aqsReviews, projects])

  const developerOptions = React.useMemo(() => {
    const ids = new Set<string>()
    for (const review of aqsReviews) {
      const { sub } = locate(review)
      if (sub?.assigneeId) ids.add(sub.assigneeId)
    }
    return members.filter((member) => ids.has(member.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [aqsReviews, locate, members])

  // "Responsável" mostra somente AQS que já assumiram alguma análise.
  const responsibleOptions = React.useMemo(() => {
    const ids = new Set(aqsReviews.map((review) => review.assignedAqsId).filter(Boolean) as string[])
    return members.filter((member) => ids.has(member.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [aqsReviews, members])

  const filteredReviews = React.useMemo(() => aqsReviews.filter((review) => {
    const { sub } = locate(review)
    if (!sub) return false
    if (projectFilter !== "all" && review.projectId !== projectFilter) return false
    if (developerFilter !== "all" && sub.assigneeId !== developerFilter) return false
    if (responsibleFilter !== "all" && review.assignedAqsId !== responsibleFilter) return false
    const created = dateKey(review.createdAt)
    if (dateFrom && created < dateFrom) return false
    if (dateTo && created > dateTo) return false
    return true
  }), [aqsReviews, dateFrom, dateTo, developerFilter, locate, projectFilter, responsibleFilter])

  const hasFilters = Boolean(dateFrom || dateTo || projectFilter !== "all" || developerFilter !== "all" || responsibleFilter !== "all")
  const active = filteredReviews.filter((item) => item.status === "awaiting" || item.status === "evaluating").length
  const evaluating = filteredReviews.filter((item) => item.status === "evaluating").length
  const completed = filteredReviews.filter((item) => item.status === "completed").length
  const revoked = filteredReviews.filter((item) => item.status === "revoked").length

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
    const review = filteredReviews.find((item) => item.id === id)
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

  function clearFilters() {
    setDateFrom("")
    setDateTo("")
    setProjectFilter("all")
    setDeveloperFilter("all")
    setResponsibleFilter("all")
  }

  function ReviewActions({ review, compact = false }: { review: AqsReview; compact?: boolean }) {
    const { sub, aqs } = locate(review)
    if (!sub) return null
    const isBusy = busy.has(review.id)
    const lockedByOther = review.status === "evaluating" && Boolean(review.assignedAqsId && review.assignedAqsId !== currentUserId && currentUserRole !== "admin")

    return (
      <div className={cn("flex items-center gap-1.5", compact && "flex-wrap justify-end")}>
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
        {canReview && review.status === "awaiting" && (
          <Button size="sm" disabled={lockedByOther} loading={isBusy} onClick={() => void transition(review, "evaluating")}>Avaliar</Button>
        )}
        {canReview && review.status === "evaluating" && (
          <>
            <Button size="sm" variant="outline" disabled={lockedByOther || isBusy} onClick={() => void transition(review, "revoked")}>Revogar</Button>
            <Button size="sm" disabled={lockedByOther} loading={isBusy} onClick={() => void transition(review, "completed")}>Concluir</Button>
          </>
        )}
        {lockedByOther && <span className="text-[0.65rem] text-muted-foreground">Com {aqs?.name ?? "outro AQS"}</span>}
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
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

      <section className="rounded-2xl border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground"><CalendarDays className="size-3.5" />Data</div>
              <div className="grid grid-cols-2 gap-1.5">
                <input aria-label="Data inicial" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-10 min-w-0 rounded-xl border border-border bg-card px-2 text-xs outline-none focus:border-ring" />
                <input aria-label="Data final" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-10 min-w-0 rounded-xl border border-border bg-card px-2 text-xs outline-none focus:border-ring" />
              </div>
            </div>
            <label className="min-w-0">
              <span className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground"><FolderKanban className="size-3.5" />Projeto</span>
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={selectClassName()}><option value="all">Todos os projetos</option>{projectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground"><UserRound className="size-3.5" />Desenvolvedor</span>
              <select value={developerFilter} onChange={(event) => setDeveloperFilter(event.target.value)} className={selectClassName()}><option value="all">Todos</option>{developerOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
            </label>
            <label className="min-w-0">
              <span className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground"><ShieldCheck className="size-3.5" />Responsável AQS</span>
              <select value={responsibleFilter} onChange={(event) => setResponsibleFilter(event.target.value)} className={selectClassName()}><option value="all">Todos os responsáveis</option>{responsibleOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select>
            </label>
            <div className="flex items-end">
              {hasFilters ? <Button variant="ghost" className="w-full" onClick={clearFilters}><X className="size-3.5" />Limpar filtros</Button> : <div className="hidden lg:block" />}
            </div>
          </div>

          <div className="flex shrink-0 items-center rounded-xl bg-muted p-1">
            <button type="button" onClick={() => setViewMode("kanban")} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors xl:flex-none", viewMode === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><Columns3 className="size-3.5" />Kanban</button>
            <button type="button" onClick={() => setViewMode("list")} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors xl:flex-none", viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><List className="size-3.5" />Lista</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/70 pt-3 text-[0.68rem] text-muted-foreground">
          <span><strong className="font-semibold text-foreground">{filteredReviews.length}</strong> análise(s) encontrada(s)</span>
          {responsibleFilter !== "all" && <span>Responsável já atribuído</span>}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {[
          { label: "Na fila", value: active, Icon: ClipboardCheck },
          { label: "Avaliando", value: evaluating, Icon: ShieldCheck },
          { label: "Concluídas", value: completed, Icon: CheckCircle2 },
          { label: "Revogadas", value: revoked, Icon: RotateCcw },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-2xl bg-card p-3 ring-1 ring-foreground/8 sm:p-4">
            <div className="flex items-center justify-between gap-3"><span className="text-xs font-medium text-muted-foreground">{label}</span><Icon className="size-4 text-muted-foreground" /></div>
            <p className="mt-2 font-mono text-xl font-semibold tabular-nums sm:mt-3 sm:text-2xl">{value}</p>
          </div>
        ))}
      </div>

      {viewMode === "kanban" ? (
        <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-3">
          <div className="flex w-max min-w-full flex-nowrap items-stretch gap-3">
            {columns.map((column) => {
              const reviews = filteredReviews.filter((item) => item.status === column.status)
              return (
                <section key={column.status} onDragOver={(event) => { if (!dragging) return; event.preventDefault(); setOver(column.status) }} onDragLeave={() => setOver(null)} onDrop={(event) => drop(column.status, event)} className={cn("flex min-h-[520px] w-[300px] min-w-[300px] flex-col rounded-2xl border border-border bg-muted/25 p-2.5 transition-colors xl:w-[320px] xl:min-w-[320px]", over === column.status && "border-primary/35 bg-primary/[0.04]")}>
                  <header className="px-1 py-1.5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className={cn("size-2 rounded-full", column.tone)} /><h2 className="text-xs font-semibold">{column.label}</h2></div><span className="rounded-full bg-card px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground ring-1 ring-foreground/8">{reviews.length}</span></div><p className="mt-1 text-[0.65rem] text-muted-foreground">{column.helper}</p></header>
                  <div className="mt-2 flex flex-1 flex-col gap-2">
                    {reviews.map((review) => {
                      const { project, activity, sub, developer, aqs } = locate(review)
                      if (!project || !activity || !sub) return null
                      const isBusy = busy.has(review.id)
                      const lockedByOther = review.status === "evaluating" && Boolean(review.assignedAqsId && review.assignedAqsId !== currentUserId && currentUserRole !== "admin")
                      const canDrag = canReview && !isBusy && !lockedByOther && (review.status === "awaiting" || review.status === "evaluating")
                      const focused = focusSubId === sub.id
                      return (
                        <article key={review.id} draggable={canDrag} onDragStart={(event) => { setDragging(review.id); event.dataTransfer.setData("text/aqs-review", review.id); event.dataTransfer.effectAllowed = "move" }} onDragEnd={() => { setDragging(null); setOver(null) }} className={cn("rounded-xl bg-card p-3 ring-1 ring-foreground/8 transition-all", canDrag && "hover:-translate-y-0.5 hover:shadow-md", focused && "ring-2 ring-primary/35", dragging === review.id && "opacity-50")}>
                          <div className="flex items-start gap-2"><GripVertical className={cn("mt-0.5 size-4 shrink-0", canDrag ? "cursor-grab text-muted-foreground/55" : "text-muted-foreground/20")} /><div className="min-w-0 flex-1"><p className="truncate text-[0.68rem] font-medium text-primary">{project.name}</p><h3 className="mt-1 text-sm font-semibold leading-snug">{sub.title}</h3><p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{activity.title}</p></div></div>
                          <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted/45 p-2 text-[0.65rem]"><div><p className="text-muted-foreground">Desenvolvedor</p><div className="mt-1 flex min-w-0 items-center gap-1.5"><MemberAvatar member={developer} className="size-6" /><span className="truncate font-medium">{developer?.name ?? "Sem responsável"}</span></div></div><div><p className="text-muted-foreground">AQS</p><div className="mt-1 flex min-w-0 items-center gap-1.5">{aqs ? <MemberAvatar member={aqs} className="size-6" /> : <span className="size-6 rounded-full border border-dashed border-border" />}<span className="truncate font-medium">{aqs?.name ?? "Não atribuído"}</span></div></div></div>
                          {review.revokedReason && <div className="mt-2 flex gap-2 rounded-lg bg-destructive/10 p-2 text-[0.68rem] leading-relaxed text-destructive"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /><span>{review.revokedReason}</span></div>}
                          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 pt-2.5"><span className="flex items-center gap-1 text-[0.65rem] text-muted-foreground"><Clock3 className="size-3" /> {elapsed(review.createdAt)}</span><ReviewActions review={review} compact /></div>
                        </article>
                      )
                    })}
                    {reviews.length === 0 && <div className="flex min-h-28 flex-1 items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-xs text-muted-foreground">Nenhum item nesta etapa.</div>}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden grid-cols-[minmax(180px,1.4fr)_minmax(140px,1fr)_minmax(140px,1fr)_120px_auto] gap-3 border-b border-border bg-muted/35 px-4 py-2.5 text-[0.68rem] font-medium text-muted-foreground lg:grid">
            <span>Projeto / tarefa</span><span>Desenvolvedor</span><span>Responsável AQS</span><span>Status</span><span className="text-right">Ações</span>
          </div>
          <div className="divide-y divide-border">
            {filteredReviews.map((review) => {
              const { project, activity, sub, developer, aqs } = locate(review)
              if (!project || !activity || !sub) return null
              const meta = columns.find((item) => item.status === review.status)
              return (
                <article key={review.id} className={cn("grid min-w-0 gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(180px,1.4fr)_minmax(140px,1fr)_minmax(140px,1fr)_120px_auto] lg:items-center", focusSubId === sub.id && "bg-primary/[0.035]")}>
                  <div className="min-w-0"><p className="truncate text-[0.68rem] font-medium text-primary">{project.name}</p><h3 className="mt-0.5 truncate text-sm font-semibold">{sub.title}</h3><p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">{activity.title} · {elapsed(review.createdAt)}</p></div>
                  <div className="flex min-w-0 items-center gap-2"><MemberAvatar member={developer} className="size-7" /><div className="min-w-0"><p className="text-[0.62rem] text-muted-foreground lg:hidden">Desenvolvedor</p><p className="truncate text-xs font-medium">{developer?.name ?? "Sem responsável"}</p></div></div>
                  <div className="flex min-w-0 items-center gap-2">{aqs ? <MemberAvatar member={aqs} className="size-7" /> : <span className="size-7 shrink-0 rounded-full border border-dashed border-border" />}<div className="min-w-0"><p className="text-[0.62rem] text-muted-foreground lg:hidden">Responsável AQS</p><p className="truncate text-xs font-medium">{aqs?.name ?? "Não atribuído"}</p></div></div>
                  <div><span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.65rem] font-medium", review.status === "completed" ? "bg-success/15 text-success" : review.status === "revoked" ? "bg-destructive/10 text-destructive" : review.status === "evaluating" ? "bg-chart-3/15 text-chart-3" : "bg-chart-2/15 text-chart-2")}><span className={cn("size-1.5 rounded-full", meta?.tone)} />{meta?.label}</span></div>
                  <ReviewActions review={review} compact />
                </article>
              )
            })}
            {filteredReviews.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhuma análise encontrada com os filtros atuais.</div>}
          </div>
        </section>
      )}

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revogar análise AQS?</DialogTitle><DialogDescription>A subatividade voltará para <strong>Aguardando</strong>, receberá um alerta visual e o desenvolvedor responsável será notificado.</DialogDescription></DialogHeader>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Motivo / ajustes necessários</span><textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={5} placeholder="Descreva objetivamente o que precisa ser corrigido..." className="resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" /></label>
          <DialogFooter><Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancelar</Button><Button variant="destructive" disabled={reason.trim().length < 3} loading={Boolean(revokeTarget && busy.has(revokeTarget.id))} onClick={() => void confirmRevoke()}>Revogar e devolver ao DEV</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
