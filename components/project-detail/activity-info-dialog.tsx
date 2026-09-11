"use client"

import * as React from "react"
import {
  Activity as ActivityIcon,
  Boxes,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Flag,
  Gauge,
  GitBranch,
  Info,
  ListChecks,
  Tags,
  Timer,
  UsersRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MemberAvatar } from "@/components/member-avatar"
import { useStore } from "@/lib/store"
import { activityEstimated, activityTracked, formatHours, priorityMeta, statusMeta } from "@/lib/project-utils"
import type { Activity, Project, Status } from "@/lib/types"
import { cn } from "@/lib/utils"

const visibleStatuses: Status[] = ["backlog", "waiting", "in-progress", "paused", "waiting-aqs", "done", "cancelled"]

export function ActivityInfoDialog({
  activity,
  project,
  triggerClassName,
  compact = false,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  activity: Activity
  project?: Project
  triggerClassName?: string
  compact?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const { members, workItemTypes } = useStore()
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = React.useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [controlledOpen, onOpenChange])

  const total = activity.subactivities.length
  const done = activity.subactivities.filter((sub) => sub.status === "done").length
  const completion = total ? Math.round((done / total) * 100) : 0
  const tracked = activityTracked(activity)
  const estimated = activityEstimated(activity)
  const remaining = Math.max(estimated - tracked, 0)
  const type = workItemTypes.find((item) => item.id === activity.typeId)
  const assignees = (activity.assigneeIds ?? [])
    .map((id) => members.find((member) => member.id === id))
    .filter(Boolean)
  const statusCounts = visibleStatuses
    .map((status) => ({ status, count: activity.subactivities.filter((sub) => sub.status === status).length }))
    .filter((entry) => entry.count > 0)
  const activityPriority = activity.priority ? priorityMeta[activity.priority] : undefined

  const contextItems = [
    { icon: GitBranch, label: "Build", value: activity.build },
    { icon: ClipboardList, label: "O.S. vinculada", value: activity.linkedOs },
    { icon: Boxes, label: "Módulo relacionado", value: activity.relatedModule },
    { icon: Tags, label: "Assunto", value: activity.subject },
    { icon: Building2, label: "Departamento responsável", value: activity.responsibleDepartment },
  ]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon-xs" : "icon-sm"}
          onClick={() => setOpen(true)}
          className={triggerClassName}
          title="Informações da atividade"
          aria-label={`Informações da atividade ${activity.title}`}
        >
          <Info className="size-3.5" />
        </Button>
      )}

      <DialogContent
        className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] flex-col overflow-hidden p-0 sm:h-auto sm:max-h-[92dvh] sm:max-w-[1180px]"
        showCloseButton
      >
        <DialogHeader className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/[0.07] via-background to-background px-5 py-5 pr-14 sm:px-7 sm:py-6">
          <div className="absolute -right-14 -top-16 size-44 rounded-full bg-primary/[0.06] blur-2xl" aria-hidden="true" />
          <div className="relative flex min-w-0 items-start gap-3.5">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <ActivityIcon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[0.67rem] font-medium text-muted-foreground">
                <span>{project?.name ?? "Projeto"}</span>
                {project?.client && <><span>•</span><span>{project.client}</span></>}
              </div>
              <DialogTitle className="mt-1 max-w-4xl text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                {activity.title}
              </DialogTitle>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {type && (
                  <span className="rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[0.65rem] font-semibold text-primary">
                    {type.name}
                  </span>
                )}
                {activityPriority ? (
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold", activityPriority.className)}>
                    <Flag className="size-3" />
                    Prioridade {activityPriority.label.toLowerCase()}
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[0.65rem] font-medium text-muted-foreground">Sem prioridade definida</span>
                )}
                <span className="rounded-full border border-border bg-background/80 px-2.5 py-1 text-[0.65rem] font-medium text-muted-foreground">
                  {done}/{total} concluída{total === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain bg-muted/[0.18] px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-7 sm:py-6">
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              icon={Gauge}
              label="Progresso"
              value={`${completion}%`}
              hint={total ? `${total - done} pendente${total - done === 1 ? "" : "s"}` : "sem subatividades"}
              progress={completion}
            />
            <MetricCard icon={Timer} label="Tempo registrado" value={formatHours(tracked)} hint="tempo acumulado" />
            <MetricCard icon={Clock3} label="Estimativa" value={formatHours(estimated)} hint={estimated ? "planejamento total" : "sem estimativa"} />
            <MetricCard icon={ListChecks} label="Subatividades" value={`${done}/${total}`} hint={remaining > 0 ? `${formatHours(remaining)} restantes pela estimativa` : "visão consolidada"} />
          </section>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-4">
              <DashboardSection
                icon={ClipboardList}
                title="Contexto da abertura"
                description="Informações registradas quando a atividade foi criada."
              >
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {contextItems.map((item) => (
                    <ContextItem key={item.label} icon={item.icon} label={item.label} value={item.value} />
                  ))}
                  <ContextItem
                    icon={Flag}
                    label="Prioridade"
                    value={activityPriority?.label}
                    valueClassName={activityPriority?.className}
                  />
                </div>
              </DashboardSection>

              <DashboardSection
                icon={ListChecks}
                title="Execução da atividade"
                description={total ? `${total} subatividade${total === 1 ? "" : "s"} vinculada${total === 1 ? "" : "s"} a esta atividade.` : "Ainda não existem subatividades nesta atividade."}
                trailing={<span className="rounded-full bg-muted px-2 py-1 font-mono text-[0.62rem] text-muted-foreground">{done}/{total}</span>}
              >
                {activity.subactivities.length ? (
                  <div className="space-y-2.5">
                    {activity.subactivities.map((sub) => {
                      const meta = statusMeta[sub.status]
                      const assignee = members.find((member) => member.id === sub.assigneeId)
                      const subEstimatedSeconds = Math.max((sub.estimatedHours ?? 0) * 3600, 0)
                      const subProgress = sub.status === "done"
                        ? 100
                        : subEstimatedSeconds > 0
                          ? Math.min(100, Math.round((sub.trackedSeconds / subEstimatedSeconds) * 100))
                          : 0

                      return (
                        <div key={sub.id} className="group rounded-2xl border border-border/80 bg-background p-3.5 transition-colors hover:border-primary/20 hover:bg-card">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-background", meta.dot)} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="text-sm font-semibold leading-snug text-foreground">{sub.title}</p>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.65rem] text-muted-foreground">
                                    <span className={cn("rounded-full px-2 py-0.5 font-medium", meta.className)}>{meta.label}</span>
                                    <span>{formatHours(sub.trackedSeconds)} registrados</span>
                                    {subEstimatedSeconds > 0 && <span>de {formatHours(subEstimatedSeconds)}</span>}
                                  </div>
                                </div>
                                {assignee && (
                                  <div className="flex shrink-0 items-center gap-2 rounded-xl bg-muted/60 px-2.5 py-1.5">
                                    <MemberAvatar member={assignee} className="size-6" />
                                    <span className="max-w-32 truncate text-[0.65rem] font-medium">{assignee.name}</span>
                                  </div>
                                )}
                              </div>
                              <div className="mt-3 flex items-center gap-2">
                                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${subProgress}%` }} />
                                </div>
                                <span className="w-9 text-right font-mono text-[0.6rem] text-muted-foreground">{subProgress}%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border bg-background/60 px-4 py-10 text-center">
                    <ListChecks className="mx-auto size-6 text-muted-foreground/50" />
                    <p className="mt-2 text-xs font-medium">Nenhuma subatividade criada</p>
                    <p className="mt-1 text-[0.65rem] text-muted-foreground">A execução aparecerá aqui assim que houver itens vinculados.</p>
                  </div>
                )}
              </DashboardSection>
            </div>

            <aside className="space-y-4">
              <DashboardSection icon={UsersRound} title="Responsáveis" compact>
                <div className="space-y-2">
                  {assignees.length ? assignees.map((member) => member && (
                    <div key={member.id} className="flex items-center gap-2.5 rounded-xl border border-border/70 bg-background p-2.5">
                      <MemberAvatar member={member} className="size-9" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{member.name}</p>
                        <p className="mt-0.5 text-[0.62rem] text-muted-foreground">{member.role === "admin" ? "Administrador" : "Desenvolvedor"}</p>
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-xl border border-dashed border-border bg-background/60 px-3 py-5 text-center">
                      <p className="text-xs font-medium">Sem responsável específico</p>
                      <p className="mt-1 text-[0.62rem] leading-relaxed text-muted-foreground">Desenvolvedores podem criar subatividades normalmente.</p>
                    </div>
                  )}
                </div>
              </DashboardSection>

              <DashboardSection icon={CheckCircle2} title="Distribuição por status" compact>
                {statusCounts.length ? (
                  <div className="space-y-3">
                    {statusCounts.map(({ status, count }) => {
                      const percentage = total ? Math.round((count / total) * 100) : 0
                      return (
                        <div key={status}>
                          <div className="flex items-center gap-2 text-xs">
                            <span className={cn("size-2 rounded-full", statusMeta[status].dot)} />
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">{statusMeta[status].label}</span>
                            <strong className="font-mono text-foreground">{count}</strong>
                          </div>
                          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                            <div className={cn("h-full rounded-full", statusMeta[status].columnClassName)} style={{ width: `${percentage}%` }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Sem status para exibir.</p>
                )}
              </DashboardSection>

              <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/[0.08] to-background p-4 shadow-sm">
                <div className="flex items-center gap-2 text-primary">
                  <Gauge className="size-4" />
                  <h3 className="text-xs font-semibold">Resumo da execução</h3>
                </div>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <div>
                    <p className="font-mono text-3xl font-semibold tracking-tight">{completion}%</p>
                    <p className="mt-0.5 text-[0.62rem] text-muted-foreground">conclusão geral</p>
                  </div>
                  <p className="text-right text-[0.65rem] leading-relaxed text-muted-foreground">{done} concluída{done === 1 ? "" : "s"}<br />{Math.max(total - done, 0)} pendente{total - done === 1 ? "" : "s"}</p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${completion}%` }} />
                </div>
              </section>
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  progress,
}: {
  icon: typeof ActivityIcon
  label: string
  value: string
  hint: string
  progress?: number
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-background p-4 shadow-sm">
      <div className="absolute -right-8 -top-8 size-20 rounded-full bg-primary/[0.04]" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <p className="text-[0.65rem] font-medium text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
      </div>
      {typeof progress === "number" ? (
        <div className="relative mt-3">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 text-[0.62rem] text-muted-foreground">{hint}</p>
        </div>
      ) : (
        <p className="relative mt-2 text-[0.62rem] text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}

function DashboardSection({
  icon: Icon,
  title,
  description,
  trailing,
  compact = false,
  children,
}: {
  icon: typeof ActivityIcon
  title: string
  description?: string
  trailing?: React.ReactNode
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card shadow-sm", compact ? "p-4" : "p-4 sm:p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && <p className="mt-0.5 text-[0.65rem] leading-relaxed text-muted-foreground">{description}</p>}
          </div>
        </div>
        {trailing}
      </div>
      <div className={cn(compact ? "mt-3" : "mt-4")}>{children}</div>
    </section>
  )
}

function ContextItem({
  icon: Icon,
  label,
  value,
  valueClassName,
}: {
  icon: typeof ActivityIcon
  label: string
  value?: string
  valueClassName?: string
}) {
  const hasValue = Boolean(value?.trim())
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background p-3.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-3.5" />
        </span>
        <span className="truncate text-[0.62rem] font-medium">{label}</span>
      </div>
      {valueClassName && hasValue ? (
        <span className={cn("mt-2 inline-flex max-w-full rounded-full px-2 py-1 text-[0.67rem] font-semibold", valueClassName)}>{value}</span>
      ) : (
        <p className={cn("mt-2 break-words text-xs font-semibold", hasValue ? "text-foreground" : "font-medium text-muted-foreground/70")} title={value}>
          {hasValue ? value : "Não informado"}
        </p>
      )}
    </div>
  )
}
