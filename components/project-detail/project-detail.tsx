"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowLeft,
  ChevronDown,
  Columns3,
  List,
  ListTree,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  UserRound,
} from "lucide-react"
import { useStore } from "@/lib/store"
import {
  activityFilters,
  formatHours,
  matchesActivityFilter,
  projectEstimated,
  projectProgress,
  projectSubactivities,
  projectTracked,
  priorityMeta,
} from "@/lib/project-utils"
import type { ActivityFilter } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { MemberAvatar, MemberStack } from "@/components/member-avatar"
import { CommentDialog } from "@/components/comments/comment-dialog"
import { AttachmentDialog } from "@/components/attachments/attachment-dialog"
import { ActivityItem } from "./activity-item"
import { ActiveTimerHero } from "./active-timer-hero"
import { ProjectLogDialog } from "./project-log"
import { SubactivityKanban } from "./subactivity-kanban"
import { VersionProjectDialog } from "./version-project-dialog"

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [focusTarget, setFocusTarget] = React.useState<{ activityId: string | null; subactivityId: string | null }>({
    activityId: null,
    subactivityId: null,
  })
  const {
    projects,
    members,
    addActivity,
    addProjectComment,
    addProjectAttachments,
    setProjectAttachmentActive,
    currentUserId,
    hydrated,
  } = useStore()
  const project = projects.find((p) => p.id === projectId)
  const [newActivity, setNewActivity] = React.useState("")
  const [newActivityAssignee, setNewActivityAssignee] = React.useState(currentUserId)
  const [viewMode, setViewMode] = React.useState<"list" | "kanban">("list")
  const [activityFilter, setActivityFilter] = React.useState<ActivityFilter>("all")
  const [assigneeFilter, setAssigneeFilter] = React.useState("all")
  const [sidePanelExpanded, setSidePanelExpanded] = React.useState(true)
  const [addingActivity, setAddingActivity] = React.useState(false)

  React.useEffect(() => {
    function readFocusFromHash() {
      const hash = window.location.hash.replace(/^#/, "")
      if (hash.startsWith("sub-")) {
        setFocusTarget({ activityId: null, subactivityId: hash.slice(4) })
        return
      }
      if (hash.startsWith("activity-")) {
        setFocusTarget({ activityId: hash.slice(9), subactivityId: null })
        return
      }
      setFocusTarget({ activityId: null, subactivityId: null })
    }
    readFocusFromHash()
    window.addEventListener("hashchange", readFocusFromHash)
    return () => window.removeEventListener("hashchange", readFocusFromHash)
  }, [])

  React.useEffect(() => {
    if (currentUserId) setNewActivityAssignee(currentUserId)
  }, [currentUserId])

  if (!hydrated) {
    return (
      <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-foreground/8">
        <p className="text-sm text-muted-foreground">Carregando projeto...</p>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex flex-col items-center gap-4 py-24 text-center">
        <p className="text-muted-foreground">Projeto não encontrado.</p>
        <Link href="/projetos" className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted">
          Voltar aos projetos
        </Link>
      </div>
    )
  }

  const subs = projectSubactivities(project)
  const done = subs.filter((s) => s.status === "done").length
  const progress = projectProgress(project)
  const tracked = projectTracked(project)
  const estimated = projectEstimated(project)

  const currentMember = members.find((member) => member.id === currentUserId)
  const executionMembers = members.filter((member) => member.role === "developer" || member.role === "admin")
  const personalSubs = subs.filter((sub) => sub.assigneeId === currentUserId)
  const personalDone = personalSubs.filter((sub) => sub.status === "done").length
  const personalCancelled = personalSubs.filter((sub) => sub.status === "cancelled").length
  const personalInProgress = personalSubs.filter((sub) => sub.status === "in-progress").length
  const personalPending = personalSubs.filter(
    (sub) => sub.status !== "done" && sub.status !== "cancelled" && sub.status !== "in-progress",
  ).length
  const personalTracked = personalSubs.reduce((total, sub) => total + sub.trackedSeconds, 0)
  const personalEstimated = personalSubs.reduce(
    (total, sub) => total + sub.estimatedHours * 3600,
    0,
  )
  const personalProgress = personalSubs.length
    ? Math.round((personalDone / personalSubs.length) * 100)
    : 0

  const filterMembers = members.filter(
    (member) =>
      project.memberIds.includes(member.id) ||
      project.activities.some((activity) => activity.assigneeIds?.includes(member.id)) ||
      subs.some((sub) => sub.assigneeId === member.id),
  )

  const matchesCurrentFilters = (status: (typeof subs)[number]["status"], assigneeId: string) =>
    matchesActivityFilter(status, activityFilter) &&
    (assigneeFilter === "all" || assigneeId === assigneeFilter)

  const visibleActivities = project.activities.filter((activity) => {
    const activityMatchesAssignee =
      assigneeFilter === "all" || activity.assigneeIds?.includes(assigneeFilter)
    if (activity.subactivities.length === 0) {
      return Boolean(
        activityMatchesAssignee && (activityFilter === "all" || activityFilter === "open"),
      )
    }
    return (
      activity.subactivities.some((sub) => matchesCurrentFilters(sub.status, sub.assigneeId)) ||
      Boolean(activityMatchesAssignee && assigneeFilter !== "all" && activityFilter === "all")
    )
  })

  const handleAddActivity = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newActivity.trim()
    if (!title || addingActivity) return
    setAddingActivity(true)
    try {
      const ok = await addActivity(project.id, title, newActivityAssignee ? [newActivityAssignee] : [])
      if (ok) setNewActivity("")
    } finally {
      setAddingActivity(false)
    }
  }

  function changeView(mode: "list" | "kanban") {
    setViewMode(mode)
    setSidePanelExpanded(mode === "list")
  }

  const progressCard = (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <p className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">Progresso</p>
      <div className="mt-3 flex items-end justify-between">
        <span className="font-mono text-3xl font-semibold tabular-nums">{progress}%</span>
        <span className="text-sm text-muted-foreground">{done}/{subs.length} tarefas</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>

      <dl className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Horas registradas</dt>
          <dd className="font-mono font-semibold tabular-nums">{formatHours(tracked)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Horas estimadas</dt>
          <dd className="font-mono font-semibold tabular-nums">{formatHours(estimated)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Entrega</dt>
          <dd className="font-semibold">{new Date(project.dueDate + "T00:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}</dd>
        </div>
      </dl>
    </div>
  )

  const personalProgressCard = (
    <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
            Progresso pessoal
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {currentMember?.name ?? "Usuário atual"}
          </p>
        </div>
        <MemberAvatar member={currentMember} className="size-8 text-[0.65rem]" />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <span className="font-mono text-3xl font-semibold tabular-nums">{personalProgress}%</span>
        <span className="text-right text-sm text-muted-foreground">
          {personalDone}/{personalSubs.length} tarefas
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${personalProgress}%` }}
        />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Horas investidas</dt>
          <dd className="mt-0.5 font-mono font-semibold tabular-nums">{formatHours(personalTracked)}</dd>
        </div>
        <div className="min-w-0 text-right">
          <dt className="text-xs text-muted-foreground">Horas estimadas</dt>
          <dd className="mt-0.5 font-mono font-semibold tabular-nums">{formatHours(personalEstimated)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Finalizadas</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{personalDone}</dd>
        </div>
        <div className="min-w-0 text-right">
          <dt className="text-xs text-muted-foreground">Em execução</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{personalInProgress}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Pendentes</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{personalPending}</dd>
        </div>
        <div className="min-w-0 text-right">
          <dt className="text-xs text-muted-foreground">Canceladas</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{personalCancelled}</dd>
        </div>
      </dl>
    </div>
  )

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 overflow-x-clip">
      <Link
        href="/projetos"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Projetos
      </Link>

      <div className="flex min-w-0 flex-col gap-4 rounded-2xl bg-card p-3 ring-1 ring-foreground/8 sm:p-4 md:flex-row md:items-center md:justify-between md:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-base font-semibold text-primary" aria-hidden>
            {project.name.charAt(0)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-xl font-semibold tracking-tight text-balance md:text-2xl">{project.name}</h1>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", priorityMeta[project.priority].className)}>
                {priorityMeta[project.priority].label}
              </span>
              {project.version && (
                <span className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-[0.68rem] text-muted-foreground">
                  v{project.version}{project.build ? ` · build ${project.build}` : ""}
                </span>
              )}
            </div>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground text-pretty">{project.description}</p>
            {project.repository && (
              <p className="mt-2 max-w-xl truncate font-mono text-[0.68rem] text-muted-foreground/80" title={project.repository}>
                {project.repository}
              </p>
            )}
          </div>
        </div>
        <div className="flex min-w-0 w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto md:justify-end">
          <MemberStack ids={project.memberIds} />
          <div className="grid min-w-0 w-full grid-cols-2 gap-2 max-[359px]:grid-cols-1 sm:w-auto sm:grid-cols-3 xl:grid-cols-5">
            <CommentDialog
              title={`Comentários · ${project.name}`}
              description="Conversa geral do projeto. Qualquer usuário pode comentar."
              comments={project.comments ?? []}
              onAdd={(content) => addProjectComment(project.id, content)}
            />
            <AttachmentDialog
              title={`Arquivos · ${project.name}`}
              description="Mídias, documentação, SQL e arquivos gerais do projeto. Todos os usuários podem adicionar e visualizar anexos."
              attachments={project.attachments ?? []}
              onAdd={(files) => addProjectAttachments(project.id, files)}
              onSetActive={(attachmentId, active) =>
                void setProjectAttachmentActive(project.id, attachmentId, active)
              }
            />
            <VersionProjectDialog project={project} />
            <ProjectLogDialog project={project} />
            <Link
              href={`/projetos/${project.id}/editar`}
              className="flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Pencil className="size-3.5" />
              Editar
            </Link>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "grid gap-4 transition-[grid-template-columns] duration-200",
          sidePanelExpanded
            ? "lg:grid-cols-[minmax(0,1fr)_320px]"
            : "lg:grid-cols-[minmax(0,1fr)_88px]",
        )}
      >
        <div className="min-w-0 space-y-3 lg:order-1">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <div className="mr-1 flex shrink-0 items-center gap-2 text-sm font-semibold">
                <ListTree className="size-4 text-primary" />
                Atividades
                <span className="font-mono text-xs font-normal text-muted-foreground">{project.activities.length}</span>
              </div>

              <div className="flex flex-wrap gap-1">
                {activityFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setActivityFilter(filter.key)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[0.68rem] font-medium transition-colors",
                      activityFilter === filter.key
                        ? "border-primary/25 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <label className="relative flex h-8 w-full min-w-0 items-center sm:w-auto sm:min-w-[178px]">
                <UserRound className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
                <select
                  value={assigneeFilter}
                  onChange={(event) => setAssigneeFilter(event.target.value)}
                  aria-label="Filtrar atividades por usuário"
                  className="h-8 w-full appearance-none rounded-full border border-border bg-card pl-8 pr-7 text-[0.68rem] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted focus:border-primary/40 focus:text-foreground sm:w-auto"
                >
                  <option value="all">Todos os usuários</option>
                  {filterMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 size-3 text-muted-foreground" />
              </label>
            </div>

            <div className="inline-flex w-full min-w-0 shrink-0 rounded-xl bg-muted p-1 sm:w-fit lg:ml-auto">
              <button
                type="button"
                onClick={() => changeView("list")}
                className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors sm:flex-none", viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                <List className="size-3.5" />
                Lista
              </button>
              <button
                type="button"
                onClick={() => changeView("kanban")}
                className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors sm:flex-none", viewMode === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                <Columns3 className="size-3.5" />
                Kanban
              </button>
            </div>
          </div>

          {viewMode === "list" ? (
            <>
              <div className="space-y-3">
                {visibleActivities.map((activity, i) => {
                  const hasActiveFilter = activityFilter !== "all" || assigneeFilter !== "all"
                  const filteredSubs = hasActiveFilter
                    ? activity.subactivities.filter((sub) =>
                        matchesCurrentFilters(sub.status, sub.assigneeId),
                      )
                    : undefined
                  return (
                    <ActivityItem
                      key={activity.id}
                      projectId={project.id}
                      activity={activity}
                      visibleSubactivities={filteredSubs}
                      defaultOpen={i === 0}
                      focusActivityId={focusTarget.activityId}
                      focusSubactivityId={focusTarget.subactivityId}
                    />
                  )
                })}

                {visibleActivities.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-border bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
                    Nenhuma atividade ou subatividade corresponde ao filtro selecionado.
                  </div>
                )}
              </div>

              <form onSubmit={handleAddActivity} className="grid min-w-0 gap-2 rounded-xl border border-dashed border-border bg-card/50 p-2 sm:grid-cols-[minmax(0,1fr)_190px_auto] sm:items-center">
                <Input value={newActivity} onChange={(e) => setNewActivity(e.target.value)} placeholder="Nova atividade..." className="min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0" />
                <label className="relative min-w-0">
                  <span className="sr-only">Responsável pela atividade</span>
                  <UserRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <select
                    value={newActivityAssignee}
                    onChange={(event) => setNewActivityAssignee(event.target.value)}
                    className="h-8 w-full min-w-0 rounded-lg border border-border bg-card pl-8 pr-2 text-xs outline-none focus:border-ring"
                    aria-label="Responsável pela nova atividade"
                  >
                    {executionMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </label>
                <Button type="submit" size="sm" className="gap-1.5" loading={addingActivity} loadingText="Adicionando...">
                  <Plus className="size-4" />
                  Adicionar
                </Button>
              </form>
            </>
          ) : (
            <SubactivityKanban
              project={project}
              filter={activityFilter}
              assigneeId={assigneeFilter}
            />
          )}
        </div>

        <aside className="space-y-2.5 lg:order-2">
          <div className="hidden lg:flex lg:justify-end">
            <button
              type="button"
              onClick={() => setSidePanelExpanded((value) => !value)}
              className={cn(
                "flex h-9 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                sidePanelExpanded ? "w-9" : "w-full",
              )}
              title={sidePanelExpanded ? "Contrair painel lateral" : "Expandir painel lateral"}
              aria-label={sidePanelExpanded ? "Contrair painel lateral" : "Expandir painel lateral"}
            >
              {sidePanelExpanded ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>
          </div>

          {sidePanelExpanded ? (
            <>
              <ActiveTimerHero project={project} />
              {progressCard}
              {personalProgressCard}
            </>
          ) : (
            <>
              <div className="hidden lg:block">
                <ActiveTimerHero project={project} compact />
                <div className="mt-3 flex min-h-36 flex-col items-center justify-center rounded-2xl bg-card px-2 py-4 text-center ring-1 ring-foreground/8" title={`Progresso do projeto: ${progress}%`}>
                  <span className="font-mono text-[0.58rem] tracking-widest text-muted-foreground uppercase">Progresso</span>
                  <span className="mt-2 font-mono text-xl font-semibold tabular-nums">{progress}%</span>
                  <div className="mt-3 flex h-16 w-1.5 flex-col justify-end overflow-hidden rounded-full bg-muted">
                    <div
                      className="mt-auto w-full rounded-full bg-primary transition-all"
                      style={{ height: `${progress}%` }}
                    />
                  </div>
                  <span className="mt-2 text-[0.6rem] text-muted-foreground">{done}/{subs.length}</span>
                </div>
              </div>
              <div className="space-y-4 lg:hidden">
                <ActiveTimerHero project={project} />
                {progressCard}
                {personalProgressCard}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
