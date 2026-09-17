"use client"

import * as React from "react"
import Link from "next/link"
import { AlertTriangle, BrainCircuit, Check, ChevronDown, ClipboardCheck, ClipboardList, EllipsisVertical, Info, Link2, LoaderCircle, LockKeyhole, MessageSquareText, NotebookPen, Paperclip, Star, Trash2, X } from "lucide-react"
import type { Activity, ServiceRequest, Subactivity, SubactivityReleaseDraft } from "@/lib/types"
import { useStore } from "@/lib/store"
import {
  activityTracked,
  formatHMS,
  formatHM,
  statusMeta,
  statusOrder,
} from "@/lib/project-utils"
import { TimerButton } from "@/components/timer-button"
import { MemberAvatar, MemberStack } from "@/components/member-avatar"
import { AddSubactivityDialog } from "@/components/project-detail/add-subactivity-dialog"
import { CommentDialog } from "@/components/comments/comment-dialog"
import { AttachmentDialog } from "@/components/attachments/attachment-dialog"
import { FileDropOverlay } from "@/components/attachments/file-drop-overlay"
import { SubactivityStatusConfirmDialog } from "@/components/project-detail/subactivity-status-confirm-dialog"
import { SubactivityApprovalDialog } from "@/components/project-detail/subactivity-approval-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ActivityInfoDialog } from "@/components/project-detail/activity-info-dialog"
import { ActivityNotesDialog } from "@/components/project-detail/activity-notes-dialog"
import { WorkItemTypeBadge } from "@/components/project-detail/work-item-type-badge"
import { SubactivityInlineSummary } from "@/components/project-detail/subactivity-inline-summary"
import { EditSubactivityDialog } from "@/components/project-detail/edit-subactivity-dialog"
import { openProjectFollowUp } from "@/lib/follow-up-launcher"
import { serviceRequestReference } from "@/lib/service-requests"
import { chatMediaKind } from "@/lib/supabase/helpers"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { formatDecimalHoursAsHHMM } from "@/lib/duration-input"
import { usePauseSubactivity } from "@/components/pause-subactivity-provider"

function SubactivityRow({ sub, projectId, linkedRequest, focused = false }: { sub: Subactivity; projectId: string; linkedRequest?: ServiceRequest; focused?: boolean }) {
  const {
    members,
    currentUserId,
    setSubStatus,
    requestSubactivityApproval,
    runningSubIds,
    canManageSubactivity,
    addSubactivityComment,
    addSubactivityAttachments,
    setSubactivityAttachmentActive,
    setSubactivityBrainstorm,
    setSubactivityFocus,
    currentUserRole,
  } = useStore()
  const { requestPause } = usePauseSubactivity()
  const rowRef = React.useRef<HTMLDivElement>(null)
  const assignee = members.find((m) => m.id === sub.assigneeId)
  const [pendingStatus, setPendingStatus] = React.useState<Subactivity["status"] | null>(null)
  const [pendingFromStatus, setPendingFromStatus] = React.useState<Subactivity["status"] | null>(null)
  const [statusSaving, setStatusSaving] = React.useState(false)
  const [approvalOpen, setApprovalOpen] = React.useState(false)
  const [approvalSaving, setApprovalSaving] = React.useState(false)
  const [inlineOpen, setInlineOpen] = React.useState(false)
  const [titleExpanded, setTitleExpanded] = React.useState(false)
  const [brainstormSaving, setBrainstormSaving] = React.useState(false)
  const [focusSaving, setFocusSaving] = React.useState(false)
  const [attachmentsOpen, setAttachmentsOpen] = React.useState(false)
  const [commentsOpen, setCommentsOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [actionsOpen, setActionsOpen] = React.useState(false)
  const [subLinkCopied, setSubLinkCopied] = React.useState(false)
  const [droppedAttachmentFiles, setDroppedAttachmentFiles] = React.useState<File[]>([])
  const [droppedAttachmentVersion, setDroppedAttachmentVersion] = React.useState(0)

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
  const inProgress = sub.status === "in-progress"
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
    if (sub.status === "in-progress" && nextStatus === "paused") {
      void requestPause(sub.id)
      return
    }
    if (linkedRequest && !terminal && (nextStatus === "done" || nextStatus === "cancelled")) nextStatus = "waiting-aqs"
    if (nextStatus === "waiting") {
      setApprovalOpen(true)
      return
    }
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

  async function requestApproval(approverId: string) {
    if (approvalSaving) return
    setApprovalSaving(true)
    try {
      const ok = await requestSubactivityApproval(sub.id, approverId)
      if (ok) setApprovalOpen(false)
    } finally {
      setApprovalSaving(false)
    }
  }

  async function confirmStatus(release: SubactivityReleaseDraft) {
    if (!pendingStatus || statusSaving) return
    setStatusSaving(true)
    try {
      if (release.zipFile) {
        const uploaded = await addSubactivityAttachments(sub.id, [{
          file: release.zipFile,
          name: release.zipFile.name,
          mimeType: release.zipFile.type || "application/zip",
          size: release.zipFile.size,
          kind: chatMediaKind(release.zipFile),
        }])
        if (!uploaded) return
      }

      const ok = await setSubStatus(sub.id, pendingStatus, {
        folderPath: release.folderPath,
        version: release.version,
        build: release.build,
        zipName: release.zipFile?.name ?? release.zipName,
      })
      if (ok) {
        setPendingStatus(null)
        setPendingFromStatus(null)
      }
    } finally {
      setStatusSaving(false)
    }
  }

  async function copySubactivityLink() {
    const href = new URL(`/projetos/${projectId}#sub-${sub.id}`, window.location.origin).toString()
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href)
      } else {
        const area = document.createElement("textarea")
        area.value = href
        area.setAttribute("readonly", "")
        area.style.position = "fixed"
        area.style.opacity = "0"
        document.body.appendChild(area)
        area.select()
        document.execCommand("copy")
        area.remove()
      }
      setSubLinkCopied(true)
      window.setTimeout(() => setSubLinkCopied(false), 1600)
    } catch {
      setSubLinkCopied(false)
    }
  }

  return (
    <div className={cn("min-w-0", inlineOpen && "pb-2")}>
    <FileDropOverlay
      enabled={canManage}
      scopeRef={rowRef}
      title={`Enviar para #${sub.title}`}
      description="Solte para adicionar aos anexos desta subatividade. Você poderá revisar o preview antes de salvar."
      onFiles={(files) => {
        setDroppedAttachmentFiles(files)
        setDroppedAttachmentVersion((current) => current + 1)
        setAttachmentsOpen(true)
      }}
    />
    <div
      id={`sub-${sub.id}`}
      ref={rowRef}
      onClick={(event) => {
        const target = event.target as HTMLElement | null
        if (target?.closest("button, a, input, select, textarea, [role='button'], [role='link'], [role='menuitem'], [data-subactivity-row-control='true']")) return
        setInlineOpen((current) => !current)
      }}
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-wrap items-center gap-3 rounded-xl px-2.5 py-3 transition-all sm:px-3",
        inProgress
          ? "rounded-2xl border border-orange-500/25 bg-orange-500/[0.08] shadow-sm dark:border-orange-400/25 dark:bg-orange-400/[0.10]"
          : "hover:bg-muted/50",
        cancelled && "opacity-70",
        focused && "bg-primary/[0.045] before:absolute before:bottom-3 before:left-0 before:top-3 before:w-0.5 before:rounded-full before:bg-primary before:content-['']",
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
                ? `Enviar para AQS · ${serviceRequestReference(linkedRequest)}`
                : "Concluir subatividade"
        }
        title={canManage ? (linkedRequest && !terminal ? `${serviceRequestReference(linkedRequest)} · conclusão obrigatoriamente via AQS` : undefined) : "Somente o Desenvolvedor responsável ou um Administrador pode alterar esta subatividade"}
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
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            onClick={() => setTitleExpanded((current) => !current)}
            className={cn(
              "min-w-0 flex-1 break-words text-left text-sm font-medium leading-snug transition-colors hover:text-primary focus-visible:outline-none focus-visible:text-primary",
              !titleExpanded && "line-clamp-3",
              terminal && "text-muted-foreground line-through",
            )}
            title={titleExpanded ? "Recolher título" : `Expandir título · ${sub.title}`}
            aria-expanded={titleExpanded}
          >
            {sub.title}
          </button>
          <button
            type="button"
            onClick={() => setTitleExpanded((current) => !current)}
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={titleExpanded ? "Recolher título" : "Expandir título"}
            aria-label={titleExpanded ? `Recolher título de ${sub.title}` : `Expandir título de ${sub.title}`}
            aria-expanded={titleExpanded}
          >
            <ChevronDown className={cn("size-3.5 transition-transform", titleExpanded && "rotate-180")} />
          </button>
        </div>
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <WorkItemTypeBadge typeId={sub.typeId} compact />
          {sub.brainstormMode && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.58rem] font-semibold text-primary"><BrainCircuit className="size-3" /> Brainstorm</span>}
          {sub.isFocus && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/12 px-1.5 py-0.5 text-[0.58rem] font-semibold text-amber-600 dark:text-amber-400"><Star className="size-3 fill-current" /> Foco</span>}
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
              running ? "text-orange-600 dark:text-orange-300" : "text-muted-foreground",
            )}
          >
            {formatHMS(sub.trackedSeconds)} / {formatDecimalHoursAsHHMM(sub.estimatedHours)}
          </span>
        </div>
      </div>

      <div data-subactivity-row-control="true" className="shrink-0 self-start">
        <DropdownMenu open={actionsOpen} onOpenChange={setActionsOpen}>
          <DropdownMenuTrigger
            className="flex size-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Ações da subatividade ${sub.title}`}
            title="Ações"
          >
            <EllipsisVertical className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" sideOffset={8} className="w-56 p-1.5">
            {currentUserRole === "admin" && (
              <>
                <DropdownMenuItem
                  className="h-10 cursor-pointer gap-2 px-2.5"
                  disabled={focusSaving}
                  onClick={() => {
                    setActionsOpen(false)
                    if (focusSaving) return
                    setFocusSaving(true)
                    void setSubactivityFocus(sub.id, !Boolean(sub.isFocus)).finally(() => setFocusSaving(false))
                  }}
                >
                  <Star className={cn("size-4", sub.isFocus && "fill-current text-amber-500")} />
                  <span>{sub.isFocus ? "Remover do foco" : "Marcar como foco"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="h-10 cursor-pointer gap-2 px-2.5"
                  onClick={() => { setActionsOpen(false); setEditOpen(true) }}
                >
                  <NotebookPen className="size-4" />
                  <span>Editar subatividade</span>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem
              className="h-10 cursor-pointer gap-2 px-2.5"
              onClick={() => {
                setActionsOpen(false)
                void copySubactivityLink()
              }}
            >
              {subLinkCopied ? <Check className="size-4 text-success" /> : <Link2 className="size-4" />}
              <span>{subLinkCopied ? "Link copiado" : "Copiar link"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-10 cursor-pointer gap-2 px-2.5"
              disabled={!canManage || brainstormSaving || (sub.status !== "in-progress" && !sub.brainstormMode)}
              onClick={() => {
                setActionsOpen(false)
                if (brainstormSaving) return
                setBrainstormSaving(true)
                void setSubactivityBrainstorm(sub.id, !Boolean(sub.brainstormMode)).finally(() => setBrainstormSaving(false))
              }}
            >
              <BrainCircuit className={cn("size-4", sub.brainstormMode && "text-primary")} />
              <span>{sub.brainstormMode ? "Encerrar brainstorm" : "Ativar brainstorm"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="h-10 cursor-pointer gap-2 px-2.5"
              onClick={() => { setActionsOpen(false); setCommentsOpen(true) }}
            >
              <MessageSquareText className="size-4" />
              <span className="min-w-0 flex-1">Comentários</span>
              {(sub.comments?.length ?? 0) > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] tabular-nums text-muted-foreground">{sub.comments?.length ?? 0}</span>}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="h-10 cursor-pointer gap-2 px-2.5"
              onClick={() => { setActionsOpen(false); setAttachmentsOpen(true) }}
            >
              <Paperclip className="size-4" />
              <span className="min-w-0 flex-1">Arquivos</span>
              {(sub.attachments?.length ?? 0) > 0 && <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] tabular-nums text-muted-foreground">{sub.attachments?.length ?? 0}</span>}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div data-subactivity-row-control="true" className="flex min-w-0 w-full flex-wrap items-center gap-2 pl-7 sm:gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
          <select
            value={sub.status}
            disabled={!canManage || statusSaving}
            onChange={(e) => requestStatus(e.target.value as Subactivity["status"])}
            aria-label={`Status de ${sub.title}`}
            className={cn(
              "h-8 max-w-full min-w-0 flex-1 rounded-full border-0 px-2.5 text-[0.65rem] font-medium outline-none ring-0 sm:max-w-36 sm:flex-none",
              canManage ? "cursor-pointer" : "cursor-not-allowed opacity-55",
              sub.status === "in-progress"
                ? "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300"
                : meta.className,
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

        <button
          type="button"
          onClick={() => setInlineOpen((current) => !current)}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            inlineOpen && "border-primary/25 bg-primary/10 text-primary",
          )}
          title={inlineOpen ? "Recolher resumo do acompanhamento" : "Expandir resumo do acompanhamento"}
          aria-label={inlineOpen ? `Recolher resumo do acompanhamento de ${sub.title}` : `Expandir resumo do acompanhamento de ${sub.title}`}
          aria-expanded={inlineOpen}
        >
          <MessageSquareText className="size-4" />
        </button>

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

      <CommentDialog
        title={`Comentários · ${sub.title}`}
        description="Discussão da subatividade. Todos os usuários podem comentar, mesmo quando a tarefa pertence a outro responsável."
        comments={sub.comments ?? []}
        onAdd={(content, mentions) => addSubactivityComment(sub.id, content, mentions)}
        enableMentions
        mentionAudienceUserIds={Array.from(new Set([sub.assigneeId, ...(sub.memberIds ?? [])].filter(Boolean)))}
        compact
        open={commentsOpen}
        onOpenChange={setCommentsOpen}
        hideTrigger
      />
      {currentUserRole === "admin" && (
        <EditSubactivityDialog
          subactivity={sub}
          compact
          open={editOpen}
          onOpenChange={setEditOpen}
          hideTrigger
        />
      )}
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
        open={attachmentsOpen}
        onOpenChange={(open) => {
          setAttachmentsOpen(open)
          if (!open) setDroppedAttachmentFiles([])
        }}
        incomingFiles={droppedAttachmentFiles}
        incomingVersion={droppedAttachmentVersion}
        hideTrigger
      />
    </div>

    {inlineOpen && <SubactivityInlineSummary projectId={projectId} sub={sub} />}

    <SubactivityApprovalDialog
      open={approvalOpen}
      onOpenChange={setApprovalOpen}
      members={members}
      currentUserId={currentUserId}
      subactivityTitle={sub.title}
      loading={approvalSaving}
      onConfirm={(userId) => { void requestApproval(userId) }}
    />

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
        onConfirm={(release) => { void confirmStatus(release) }}
        loading={statusSaving}
        projectId={projectId}
      />
    )}
    </div>
  )
}

function activityContextDescription(activity: Activity, linkedRequest?: ServiceRequest, sourceTopicTitle?: string) {
  const details = [
    activity.relatedModule ? `Módulo ${activity.relatedModule}` : undefined,
    activity.subject ? `Assunto ${activity.subject}` : undefined,
    activity.responsibleDepartment ? `Departamento ${activity.responsibleDepartment}` : undefined,
    activity.linkedOs ? `O.S. ${activity.linkedOs}` : undefined,
    activity.build ? `Versão / Build ${activity.build}` : undefined,
  ].filter(Boolean) as string[]

  if (details.length > 0) return details.join(" · ")
  if (linkedRequest?.title?.trim()) return linkedRequest.title.trim()
  if (sourceTopicTitle?.trim()) return sourceTopicTitle.trim()
  return null
}


export function ActivityItem({
  activity,
  projectId,
  activityNumber,
  visibleSubactivities,
  focusActivityId,
  focusSubactivityId,
  canCreateSubactivity: canCreateSubactivityOverride,
}: {
  activity: Activity
  projectId: string
  activityNumber: number
  visibleSubactivities?: Subactivity[]
  focusActivityId?: string | null
  focusSubactivityId?: string | null
  canCreateSubactivity?: boolean
}) {
  const {
    deleteActivity,
    supportTopics,
    serviceRequests,
    currentUserId,
    currentUserRole,
    projects,
    addActivityAttachments,
    setActivityAttachmentActive,
  } = useStore()
  const currentProject = projects.find((project) => project.id === projectId)
  const canManageStructure = currentUserRole === "admin" || Boolean(currentProject?.memberIds.includes(currentUserId))
  const canCreateSubactivity = canCreateSubactivityOverride ?? (currentUserRole === "admin" || currentUserRole === "developer" || Boolean(currentProject?.memberIds.includes(currentUserId)))
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
  const [infoOpen, setInfoOpen] = React.useState(false)
  const [attachmentsOpen, setAttachmentsOpen] = React.useState(false)
  const [notesOpen, setNotesOpen] = React.useState(false)
  const [linkCopied, setLinkCopied] = React.useState(false)
  const copyFeedbackTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => () => {
    if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current)
  }, [])
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
  const activityDescription = activityContextDescription(activity, linkedRequest, sourceTopic?.title)

  async function copyActivityLink() {
    const href = new URL(`/projetos/${projectId}#activity-${activity.id}`, window.location.origin).toString()
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(href)
      } else {
        const area = document.createElement("textarea")
        area.value = href
        area.setAttribute("readonly", "")
        area.style.position = "fixed"
        area.style.opacity = "0"
        document.body.appendChild(area)
        area.select()
        document.execCommand("copy")
        area.remove()
      }
      setLinkCopied(true)
      if (copyFeedbackTimerRef.current) window.clearTimeout(copyFeedbackTimerRef.current)
      copyFeedbackTimerRef.current = window.setTimeout(() => setLinkCopied(false), 1800)
    } catch {
      setLinkCopied(false)
    }
  }

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
          "overflow-hidden rounded-[1.35rem] border border-border/70 bg-card shadow-sm ring-1 ring-foreground/5 transition-shadow",
          focusedActivity && "ring-2 ring-inset ring-primary/35",
        )}
      >
        {hasRunningSubactivity && (
          <div className="flex items-center gap-2 border-b border-orange-500/20 bg-orange-100/80 px-3 py-2 text-orange-700 dark:border-orange-400/20 dark:bg-orange-400/12 dark:text-orange-300 sm:px-4">
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-orange-500 opacity-35 dark:bg-orange-300" />
              <span className="relative inline-flex size-2.5 rounded-full bg-orange-500 dark:bg-orange-300" />
            </span>
            <span className="text-xs font-semibold">Executando</span>
          </div>
        )}
        <div className="min-w-0 px-3 py-3 sm:px-4 sm:py-4">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex min-w-0 w-full items-start gap-2 text-left"
          >
            <ChevronDown
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                open && "rotate-180",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-start gap-2">
                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-muted-foreground sm:text-sm">
                  {activityNumber}-
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground sm:text-[0.98rem]" title={activity.title}>
                    {activity.title}
                  </h3>
                  {activityDescription && (
                    <p className="mt-1 break-words text-[0.72rem] leading-5 text-muted-foreground sm:text-[0.76rem]">
                      {activityDescription}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </button>

          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 pl-6 sm:pl-8 sm:gap-x-2.5">
            <div className="min-w-0 shrink-0"><WorkItemTypeBadge typeId={activity.typeId} compact /></div>
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[0.62rem] font-medium text-muted-foreground tabular-nums sm:text-[0.65rem]">
              {done}/{allSubs.length}
            </span>
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:w-24">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="w-8 text-right font-mono text-[0.7rem] font-medium tabular-nums text-muted-foreground">
                {progress}%
              </span>
              <span className="font-mono text-[0.7rem] tabular-nums text-muted-foreground">
                {formatHM(tracked)}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Informações da atividade ${activity.title}`}
                title="Informações"
              >
                <Info className="size-4" />
              </button>
              {currentProject && (
                <button
                  type="button"
                  onClick={() => setNotesOpen(true)}
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Anotações da atividade ${activity.title}`}
                  title="Anotações"
                >
                  <NotebookPen className="size-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setAttachmentsOpen(true)}
                className="relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Arquivos da atividade ${activity.title}`}
                title="Arquivos"
              >
                <Paperclip className="size-4" />
                {(activity.attachments?.length ?? 0) > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-primary px-1 text-[0.52rem] font-semibold leading-3.5 text-primary-foreground">
                    {activity.attachments?.length ?? 0}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => { void copyActivityLink() }}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Copiar link da atividade ${activity.title}`}
                title={linkCopied ? "Link copiado" : "Copiar link"}
              >
                {linkCopied ? <Check className="size-4 text-success" /> : <Link2 className="size-4" />}
              </button>
              {canDelete && canManageStructure && (
                <button
                  type="button"
                  onClick={() => setDeleteOpen(true)}
                  className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Excluir atividade ${activity.title}`}
                  title="Excluir atividade"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>

            {linkedRequest && <span className="max-w-full truncate rounded-full border border-primary/15 bg-primary/10 px-1.5 py-0.5 text-[0.58rem] font-semibold text-primary sm:text-[0.6rem]">{serviceRequestReference(linkedRequest)}</span>}
            {(activity.assigneeIds?.length ?? 0) > 0 && (
              <div className="shrink-0"><MemberStack ids={activity.assigneeIds ?? []} max={1} /></div>
            )}
            {filtering && visibleSubs.length !== allSubs.length && (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary sm:text-[0.65rem]">
                {visibleSubs.length} no filtro
              </span>
            )}

            {open && (
              <div className="ml-auto hidden shrink-0 items-center gap-1 2xl:flex">
                {canCreateSubactivity && <AddSubactivityDialog projectId={projectId} activityId={activity.id} aqsRequired={Boolean(linkedRequest)} />}
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
            )}
          </div>
        </div>

        <ActivityInfoDialog
          activity={activity}
          project={currentProject}
          open={infoOpen}
          onOpenChange={setInfoOpen}
          hideTrigger
        />

        {currentProject && (
          <ActivityNotesDialog
            activity={activity}
            project={currentProject}
            open={notesOpen}
            onOpenChange={setNotesOpen}
            hideTrigger
          />
        )}

        <AttachmentDialog
          title={`Arquivos · ${activity.title}`}
          description="Mídias, documentos e evidências vinculados diretamente a esta atividade."
          attachments={activity.attachments ?? []}
          onAdd={(files) => addActivityAttachments(activity.id, files)}
          onSetActive={(attachmentId, active) =>
            void setActivityAttachmentActive(activity.id, attachmentId, active)
          }
          compact
          buttonLabel="Arquivos"
          open={attachmentsOpen}
          onOpenChange={setAttachmentsOpen}
          hideTrigger
        />

        {open && (
          <div className="border-t border-border px-2 pb-2">
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1 border-b border-border/60 px-1 py-2 2xl:hidden">
              {canCreateSubactivity && <AddSubactivityDialog projectId={projectId} activityId={activity.id} aqsRequired={Boolean(linkedRequest)} />}
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
            {linkedRequest && (
              <Link href={`/solicitacoes/${linkedRequest.id}`} className="mx-1 mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-primary/20 bg-primary/[0.045] px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.07]">
                <ClipboardCheck className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Vinculada à {serviceRequestReference(linkedRequest)} · conclusão protegida</span>
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
