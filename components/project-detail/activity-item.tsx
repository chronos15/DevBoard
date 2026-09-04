"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, Check, ChevronDown, ClipboardCheck, ClipboardList, LoaderCircle, LockKeyhole, MessageSquareText, Paperclip, Trash2, X } from "lucide-react"
import type { Activity, ServiceRequest, Subactivity } from "@/lib/types"
import { useStore } from "@/lib/store"
import {
  activityTracked,
  formatHMS,
  formatHours,
  statusMeta,
  statusOrder,
} from "@/lib/project-utils"
import { TimerButton } from "@/components/timer-button"
import { MemberAvatar, MemberStack } from "@/components/member-avatar"
import { AddSubactivityDialog } from "@/components/project-detail/add-subactivity-dialog"
import { CommentDialog } from "@/components/comments/comment-dialog"
import { AttachmentDialog } from "@/components/attachments/attachment-dialog"
import { SubactivityStatusConfirmDialog } from "@/components/project-detail/subactivity-status-confirm-dialog"
import { Button } from "@/components/ui/button"
import { CopyEntityLinkButton } from "@/components/copy-entity-link-button"
import { WorkItemTypeBadge } from "@/components/project-detail/work-item-type-badge"
import { SubactivityInlineSummary } from "@/components/project-detail/subactivity-inline-summary"
import { openProjectFollowUp } from "@/lib/follow-up-launcher"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

function SubactivityRow({ sub, projectId, linkedRequest, focused = false }: { sub: Subactivity; projectId: string; linkedRequest?: ServiceRequest; focused?: boolean }) {
  const {
    members,
    setSubStatus,
    runningSubIds,
    canManageSubactivity,
    addSubactivityComment,
    addSubactivityAttachments,
    setSubactivityAttachmentActive,
    currentUserRole,
  } = useStore()
  const rowRef = React.useRef<HTMLDivElement>(null)
  const assignee = members.find((m) => m.id === sub.assigneeId)
  const [pendingStatus, setPendingStatus] = React.useState<Subactivity["status"] | null>(null)
  const [pendingFromStatus, setPendingFromStatus] = React.useState<Subactivity["status"] | null>(null)
  const [statusSaving, setStatusSaving] = React.useState(false)
  const [inlineOpen, setInlineOpen] = React.useState(false)

  React.useEffect(() => {
    if (!focused) return
    const timer = window.setTimeout(() => {
      rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [focused])
  const done = sub.status === "done"
  const cancelled = sub.status === "cancelled"
  const terminal = done || cancelled
  const running = runningSubIds.includes(sub.id)
  const canManage = canManageSubactivity(sub)
  const meta = statusMeta[sub.status]
  const estimateSeconds = sub.estimatedHours * 3600
  const ratio = estimateSeconds
    ? Math.min(100, (sub.trackedSeconds / estimateSeconds) * 100)
    : 0
  const over = sub.trackedSeconds > estimateSeconds && estimateSeconds > 0
  const availableStatuses = statusOrder.filter((status) =>
    !linkedRequest || status === sub.status || (status !== "done" && status !== "cancelled"),
  )

  function requestStatus(nextStatus: Subactivity["status"]) {
    if (nextStatus === sub.status || statusSaving) return
    if (linkedRequest && !terminal && (nextStatus === "done" || nextStatus === "cancelled")) nextStatus = "waiting-aqs"
    const nextTerminal = nextStatus === "done" || nextStatus === "cancelled"
    const currentTerminal = sub.status === "done" || sub.status === "cancelled"
    if (nextTerminal || nextStatus === "waiting-aqs" || (currentTerminal && currentUserRole === "admin")) {
      setPendingFromStatus(sub.status)
      setPendingStatus(nextStatus)
      return
    }
    setStatusSaving(true)
    void setSubStatus(sub.id, nextStatus).finally(() => setStatusSaving(false))
  }

  async function confirmStatus() {
    if (!pendingStatus || statusSaving) return
    setStatusSaving(true)
    try {
      const ok = await setSubStatus(sub.id, pendingStatus)
      if (ok) {
        setPendingStatus(null)
        setPendingFromStatus(null)
      }
    } finally {
      setStatusSaving(false)
    }
  }

  return (
    <div className={cn("min-w-0", inlineOpen && "pb-2")}>
    <div
      id={`sub-${sub.id}`}
      ref={rowRef}
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-3 rounded-xl px-2.5 py-3 transition-colors sm:flex-nowrap sm:px-3",
        running ? "bg-primary/[0.06]" : "hover:bg-muted/50",
        cancelled && "opacity-70",
        focused && "bg-primary/[0.08] ring-2 ring-inset ring-primary/30",
      )}
    >
      <button
        type="button"
        disabled={!canManage}
        onClick={() => requestStatus(terminal ? "backlog" : linkedRequest ? "waiting-aqs" : "done")}
        aria-label={
          done
            ? "Reabrir subatividade"
            : cancelled
              ? "Reabrir subatividade cancelada"
              : linkedRequest
                ? `Enviar para AQS · OS ${linkedRequest.orderNumber}`
                : "Concluir subatividade"
        }
        title={canManage ? (linkedRequest && !terminal ? `OS ${linkedRequest.orderNumber} · conclusão obrigatoriamente via AQS` : undefined) : "Somente o Desenvolvedor responsável ou um Administrador pode alterar esta subatividade"}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          !canManage && "cursor-not-allowed opacity-45",
          done
            ? "border-success bg-success text-success-foreground"
            : cancelled
              ? "border-destructive bg-destructive/10 text-destructive"
              : linkedRequest
                ? "border-primary/35 text-primary hover:border-primary hover:bg-primary/10"
                : "border-border hover:border-success",
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
        {cancelled && <X className="size-3" strokeWidth={3} />}
        {linkedRequest && !terminal && <ClipboardCheck className="size-2.5" strokeWidth={2.4} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setInlineOpen((current) => !current)}
            className={cn(
              "min-w-0 truncate text-left text-sm font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:text-primary",
              terminal && "text-muted-foreground line-through",
            )}
            title={`${sub.title} · ${inlineOpen ? "recolher resumo" : "expandir resumo"}`}
            aria-expanded={inlineOpen}
          >
            {sub.title}
          </button>
          <WorkItemTypeBadge typeId={sub.typeId} compact />
          <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground/60 transition-transform", inlineOpen && "rotate-180")} />
        </div>
        {sub.needsAttention && (
          <div className="mt-1.5 flex min-w-0 items-center gap-1.5 rounded-lg bg-chart-4/15 px-2 py-1 text-[0.68rem] font-medium text-chart-4">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="truncate">AQS solicitou ajustes{sub.attentionMessage ? ` · ${sub.attentionMessage}` : ""}</span>
          </div>
        )}
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted sm:w-24">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                over ? "bg-destructive" : "bg-primary",
              )}
              style={{ width: `${ratio}%` }}
            />
          </div>
          <span
            className={cn(
              "font-mono text-[0.7rem] tabular-nums",
              running ? "text-primary" : "text-muted-foreground",
            )}
          >
            {formatHMS(sub.trackedSeconds)} / {sub.estimatedHours}h
          </span>
        </div>
      </div>

      <div className="flex min-w-0 w-full flex-wrap items-center justify-start gap-1.5 pl-7 sm:w-auto sm:flex-nowrap sm:justify-end sm:pl-0">
        <CopyEntityLinkButton
          href={`/projetos/${projectId}#sub-${sub.id}`}
          label={`Copiar link da subatividade ${sub.title}`}
        />
        <CommentDialog
          title={`Comentários · ${sub.title}`}
          description="Discussão da subatividade. Todos os usuários podem comentar, mesmo quando a tarefa pertence a outro responsável."
          comments={sub.comments ?? []}
          onAdd={(content) => addSubactivityComment(sub.id, content)}
          compact
        />
        <AttachmentDialog
          title={`Arquivos · ${sub.title}`}
          description="Mídias, documentação, SQL e arquivos da subatividade. Qualquer usuário pode adicionar e visualizar."
          attachments={sub.attachments ?? []}
          onAdd={(files) => addSubactivityAttachments(sub.id, files)}
          onSetActive={(attachmentId, active) =>
            void setSubactivityAttachmentActive(sub.id, attachmentId, active)
          }
          compact
          buttonLabel="Arquivos"
        />

        <div className="flex items-center gap-1">
          <select
            value={sub.status}
            disabled={!canManage || statusSaving}
            onChange={(e) => requestStatus(e.target.value as Subactivity["status"])}
            aria-label={`Status de ${sub.title}`}
            className={cn(
              "h-7 max-w-full min-w-0 rounded-full border-0 px-2 text-[0.65rem] font-medium outline-none ring-0 sm:max-w-32",
              canManage ? "cursor-pointer" : "cursor-not-allowed opacity-55",
              meta.className,
            )}
          >
            {availableStatuses.map((status) => (
              <option key={status} value={status} className="bg-background text-foreground">
                {statusMeta[status].label}
              </option>
            ))}
          </select>
          {statusSaving && <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary" aria-label="Salvando status" />}
        </div>

        <div className="flex items-center gap-1.5">
          {!canManage && (
            <LockKeyhole
              className="size-3.5 text-muted-foreground/55"
              aria-label="Subatividade protegida"
            />
          )}
          <MemberAvatar member={assignee} className="inline-flex" />
        </div>

        {!terminal && sub.status !== "waiting-aqs" && <TimerButton subId={sub.id} size="sm" />}
      </div>
    </div>

    {inlineOpen && <SubactivityInlineSummary projectId={projectId} sub={sub} />}

    {pendingStatus && (
      <SubactivityStatusConfirmDialog
        open
        onOpenChange={(open) => {
          if (!open && !statusSaving) {
            setPendingStatus(null)
            setPendingFromStatus(null)
          }
        }}
        subactivityTitle={sub.title}
        fromStatus={pendingFromStatus ?? sub.status}
        toStatus={pendingStatus}
        isAdmin={currentUserRole === "admin"}
        onConfirm={confirmStatus}
        loading={statusSaving}
        projectId={projectId}
      />
    )}
    </div>
  )
}

export function ActivityItem({
  activity,
  projectId,
  activityNumber,
  visibleSubactivities,
  focusActivityId,
  focusSubactivityId,
}: {
  activity: Activity
  projectId: string
  activityNumber: number
  visibleSubactivities?: Subactivity[]
  focusActivityId?: string | null
  focusSubactivityId?: string | null
}) {
  const { deleteActivity, supportTopics, serviceRequests, currentUserId, currentUserRole, projects } = useStore()
  const currentProject = projects.find((project) => project.id === projectId)
  const canManageStructure = currentUserRole === "admin" || Boolean(currentProject?.memberIds.includes(currentUserId))
  const activityRef = React.useRef<HTMLDivElement>(null)
  const hasFocusedSubactivity = Boolean(
    focusSubactivityId && activity.subactivities.some((sub) => sub.id === focusSubactivityId),
  )
  const focusedActivity = focusActivityId === activity.id
  const [open, setOpen] = React.useState(
    Boolean(focusedActivity || hasFocusedSubactivity),
  )

  React.useEffect(() => {
    if (!focusedActivity && !hasFocusedSubactivity) return
    setOpen(true)
    if (focusedActivity && !hasFocusedSubactivity) {
      const timer = window.setTimeout(() => {
        activityRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 80)
      return () => window.clearTimeout(timer)
    }
  }, [focusedActivity, hasFocusedSubactivity])
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const allSubs = activity.subactivities
  const visibleSubs = visibleSubactivities ?? allSubs
  const done = allSubs.filter((s) => s.status === "done").length
  const progress = allSubs.length ? Math.round((done / allSubs.length) * 100) : 0
  const tracked = activityTracked(activity)
  const linkedRequest = serviceRequests.find((request) => request.activityId === activity.id)
  const canDelete = allSubs.length === 0 && !linkedRequest
  const hasRunningSubactivity = allSubs.some((sub) => sub.status === "in-progress")
  const filtering = visibleSubactivities !== undefined
  const sourceTopic = supportTopics.find((topic) => topic.activityId === activity.id)

  async function confirmDelete() {
    if (!canDelete || deleting) return
    setDeleting(true)
    try {
      const ok = await deleteActivity(projectId, activity.id)
      if (ok) setDeleteOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <div
        id={`activity-${activity.id}`}
        ref={activityRef}
        className={cn(
          "overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/8 transition-shadow",
          focusedActivity && "ring-2 ring-inset ring-primary/35",
        )}
      >
        {hasRunningSubactivity && (
          <div className="flex items-center gap-2 border-b border-chart-3/15 bg-chart-3/[0.06] px-3 py-2 sm:px-4">
            <span className="relative flex size-2 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-chart-3 opacity-40" />
              <span className="relative inline-flex size-2 rounded-full bg-chart-3" />
            </span>
            <span className="text-xs font-semibold text-chart-3">Executando</span>
          </div>
        )}
        <div className="flex min-w-0 items-stretch">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-0 flex-1 items-center gap-2 px-3 py-3.5 text-left transition-colors hover:bg-muted/40 sm:gap-3 sm:px-4 sm:py-4"
          >
            <ChevronDown
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-muted-foreground sm:text-sm">
                  {activityNumber}-
                </span>
                <h3 className="min-w-0 truncate font-semibold" title={activity.title}>{activity.title}</h3>
                <WorkItemTypeBadge typeId={activity.typeId} compact />
                {linkedRequest && <span className="rounded-full border border-primary/15 bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-semibold text-primary">OS {linkedRequest.orderNumber}</span>}
                {(activity.assigneeIds?.length ?? 0) > 0 && (
                  <MemberStack ids={activity.assigneeIds ?? []} max={2} />
                )}
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground tabular-nums">
                  {done}/{allSubs.length}
                </span>
                {filtering && visibleSubs.length !== allSubs.length && (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.65rem] font-medium text-primary">
                    {visibleSubs.length} no filtro
                  </span>
                )}
              </div>
            </div>

            <div className="hidden items-center gap-2 sm:flex">
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="w-9 text-right font-mono text-xs font-medium tabular-nums text-muted-foreground">
                {progress}%
              </span>
            </div>

            <span className="ml-1 w-12 shrink-0 text-right font-mono text-[0.68rem] tabular-nums text-muted-foreground sm:w-14 sm:text-xs">
              {formatHours(tracked)}
            </span>
          </button>

          <div className="flex shrink-0 items-stretch border-l border-border">
            <CopyEntityLinkButton
              href={`/projetos/${projectId}#activity-${activity.id}`}
              label={`Copiar link da atividade ${activity.title}`}
              className="m-auto size-10 rounded-none sm:size-11"
            />
          </div>

          {canDelete && canManageStructure && (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="flex w-12 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Excluir atividade ${activity.title}`}
              title="Excluir atividade"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>

        {open && (
          <div className="border-t border-border px-2 pb-2">
            {linkedRequest && (
              <Link href={`/solicitacoes/${linkedRequest.id}`} className="mx-1 mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.045] px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.07]">
                <ClipboardCheck className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Vinculada à OS {linkedRequest.orderNumber} · conclusão protegida</span>
                  <span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">Subatividades devem ser enviadas para AQS; somente a aprovação AQS marca como concluída.</span>
                </span>
                <span className="shrink-0 text-[0.62rem] font-semibold text-primary">Abrir OS</span>
              </Link>
            )}
            {sourceTopic && (
              <div
                className="mx-1 mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-3 py-2.5 text-left"
              >
                <ClipboardList className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Originada do tópico · Ordem {sourceTopic.orderNumber}</span>
                  <span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">{sourceTopic.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[0.65rem] text-muted-foreground"><Paperclip className="size-3" />{sourceTopic.attachments.length}</span>
              </div>
            )}
            <div className="flex flex-col divide-y divide-border/60">
              {visibleSubs.map((sub) => (
                <SubactivityRow key={sub.id} sub={sub} projectId={projectId} linkedRequest={linkedRequest} focused={focusSubactivityId === sub.id} />
              ))}
              {visibleSubs.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  {allSubs.length === 0
                    ? "Nenhuma subatividade ainda."
                    : "Nenhuma subatividade corresponde ao filtro selecionado."}
                </p>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 px-1 pt-1">
              {canManageStructure && <AddSubactivityDialog projectId={projectId} activityId={activity.id} aqsRequired={Boolean(linkedRequest)} />}
              <button
                type="button"
                onClick={() => openProjectFollowUp({ projectId, activityId: activity.id })}
                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={`Abrir acompanhamento de ${activity.title}`}
              >
                <MessageSquareText className="size-3.5" />
                Acompanhamento
              </button>
            </div>
          </div>
        )}
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir atividade?</DialogTitle>
            <DialogDescription>
              A atividade “{activity.title}” não possui subatividades e pode ser excluída. Esta ação ficará registrada no log do projeto.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={() => { void confirmDelete() }} loading={deleting} loadingText="Excluindo...">
              Excluir atividade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
