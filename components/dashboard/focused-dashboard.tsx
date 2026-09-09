"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowRight,
  AtSign,
  Bell,
  CheckCircle2,
  Clock3,
  FolderKanban,
  Inbox,
  MessageSquareText,
  Play,
  Sparkles,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { formatHMS } from "@/lib/project-utils"
import { followUpHref } from "@/lib/follow-up-launcher"
import { scopeFollowUpProjects, scopeMyWorkProjects } from "@/lib/follow-up-access"
import { ProjectIcon } from "@/components/projects/project-icon"
import { MemberAvatar } from "@/components/member-avatar"
import type { Project, Status, Subactivity } from "@/lib/types"

const OPEN_REQUEST_STATUSES = new Set([
  "received",
  "aqs-analysis",
  "waiting-info",
  "waiting-dev",
  "waiting-executor",
  "in-dev",
  "waiting-aqs",
  "rework",
  "waiting-build",
])

const MENTION_TYPES = new Set(["chat-mention", "followup-mention", "request-mention"])

function focusedStatus(status: Status) {
  if (status === "in-progress") return { label: "Em andamento", className: "bg-success/12 text-success" }
  if (status === "waiting-aqs") return { label: "Em análise", className: "bg-chart-5/15 text-chart-5" }
  if (status === "done") return { label: "Concluída", className: "bg-success/12 text-success" }
  if (status === "cancelled") return { label: "Cancelada", className: "bg-destructive/10 text-destructive" }
  return { label: "Pendente", className: "bg-muted text-muted-foreground" }
}

type WorkRow = {
  project: Project
  activityId: string
  activityTitle: string
  subactivity: Subactivity
}

function flattenMyWork(projects: Project[]): WorkRow[] {
  return projects.flatMap((project) =>
    project.activities.flatMap((activity) =>
      activity.subactivities.map((subactivity) => ({
        project,
        activityId: activity.id,
        activityTitle: activity.title,
        subactivity,
      })),
    ),
  )
}

function taskSort(a: WorkRow, b: WorkRow) {
  if (a.subactivity.status === "in-progress" && b.subactivity.status !== "in-progress") return -1
  if (b.subactivity.status === "in-progress" && a.subactivity.status !== "in-progress") return 1
  const aDone = a.subactivity.status === "done" || a.subactivity.status === "cancelled"
  const bDone = b.subactivity.status === "done" || b.subactivity.status === "cancelled"
  if (aDone !== bDone) return aDone ? 1 : -1
  return new Date(b.subactivity.createdAt ?? 0).getTime() - new Date(a.subactivity.createdAt ?? 0).getTime()
}

function AttentionCard({
  href,
  icon: Icon,
  value,
  label,
  detail,
  tone = "primary",
}: {
  href: string
  icon: typeof Bell
  value: number
  label: string
  detail: string
  tone?: "primary" | "mention" | "success" | "info"
}) {
  const toneClass =
    tone === "mention" ? "bg-rose-500/12 text-rose-500" :
      tone === "success" ? "bg-success/12 text-success" :
        tone === "info" ? "bg-sky-500/12 text-sky-500" :
          "bg-primary/10 text-primary"

  return (
    <Link href={href} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-3.5 transition-colors hover:bg-muted/35">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", toneClass)}>
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{value} {label}</span>
        <span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">{detail}</span>
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  )
}

export function FocusedDashboard() {
  const {
    projects,
    members,
    currentUserId,
    currentUserRole,
    notifications,
    serviceRequests,
    aqsReviews,
    activeSubId,
    markNotificationRead,
  } = useStore()

  const me = members.find((member) => member.id === currentUserId)
  const firstName = me?.name?.trim().split(/\s+/)[0] || ""

  const followedProjects = React.useMemo(
    () => scopeFollowUpProjects(projects, currentUserId, currentUserRole),
    [currentUserId, currentUserRole, projects],
  )
  const myProjects = React.useMemo(
    () => scopeMyWorkProjects(projects, currentUserId),
    [currentUserId, projects],
  )
  const myWork = React.useMemo(() => flattenMyWork(myProjects).sort(taskSort), [myProjects])
  const openWork = myWork.filter(({ subactivity }) => subactivity.status !== "done" && subactivity.status !== "cancelled")

  const primaryTask =
    (activeSubId ? myWork.find(({ subactivity }) => subactivity.id === activeSubId) : undefined) ??
    openWork[0]

  const unread = notifications.filter((notification) => notification.recipientId === currentUserId && !notification.readAt)
  const mentions = unread.filter((notification) => MENTION_TYPES.has(notification.type)).length
  const relatedOpenRequests = serviceRequests.filter((request) =>
    OPEN_REQUEST_STATUSES.has(request.status) && (
      request.createdBy === currentUserId ||
      request.participantIds.includes(currentUserId) ||
      request.assignedAqsId === currentUserId ||
      request.responsibleDevId === currentUserId ||
      request.executorId === currentUserId
    ),
  )
  const activeAqs = aqsReviews.filter((review) =>
    review.assignedAqsId === currentUserId && (review.status === "awaiting" || review.status === "evaluating"),
  )
  const running = openWork.filter(({ subactivity }) => subactivity.status === "in-progress").length

  const recentNotifications = [...unread]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)

  const primaryHref = primaryTask
    ? followUpHref({ projectId: primaryTask.project.id, activityId: primaryTask.activityId, subactivityId: primaryTask.subactivity.id })
    : "/minhas-tarefas"

  return (
    <div className="mx-auto w-full max-w-[1480px]">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary">
            <Sparkles className="size-3.5" />
            Modo Focado
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">
            {firstName ? `Olá, ${firstName}` : "Seu trabalho agora"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">O que precisa da sua atenção, sem mostrar o restante até você precisar.</p>
        </div>
        <Link href="/acompanhamento" className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-muted">
          <MessageSquareText className="size-4 text-primary" />
          Abrir acompanhamento
        </Link>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-3xl border border-primary/15 bg-card shadow-sm">
            <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  <Play className="size-3.5 text-primary" />
                  {primaryTask?.subactivity.status === "in-progress" ? "Continuar trabalhando" : "Próxima tarefa"}
                </div>
                {primaryTask ? (
                  <>
                    <h2 className="mt-2 line-clamp-2 text-xl font-semibold tracking-tight">{primaryTask.subactivity.title}</h2>
                    <p className="mt-1 truncate text-sm text-muted-foreground">{primaryTask.project.name} · {primaryTask.activityTitle}</p>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-full px-2.5 py-1 text-[0.68rem] font-semibold", focusedStatus(primaryTask.subactivity.status).className)}>
                        {focusedStatus(primaryTask.subactivity.status).label}
                      </span>
                      {primaryTask.subactivity.trackedSeconds > 0 && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-mono text-[0.68rem] text-muted-foreground">
                          <Clock3 className="size-3" />
                          {formatHMS(primaryTask.subactivity.trackedSeconds)}
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <h2 className="mt-2 text-xl font-semibold">Tudo em dia por aqui</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Quando uma atividade for atribuída a você, ela aparecerá neste espaço.</p>
                  </>
                )}
              </div>
              <Link href={primaryHref} className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
                {primaryTask?.subactivity.status === "in-progress" ? "Continuar" : "Ver minhas tarefas"}
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Meu trabalho</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Tarefas abertas relacionadas diretamente a você.</p>
              </div>
              <Link href="/minhas-tarefas" className="text-xs font-semibold text-primary hover:underline">Ver todas</Link>
            </div>

            <div className="mt-3 divide-y divide-border">
              {openWork.slice(0, 6).map(({ project, activityId, activityTitle, subactivity }) => {
                const status = focusedStatus(subactivity.status)
                return (
                  <Link
                    key={subactivity.id}
                    href={followUpHref({ projectId: project.id, activityId, subactivityId: subactivity.id })}
                    className="group flex min-w-0 items-center gap-3 py-3 first:pt-1 last:pb-1"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                      <ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-4" imageClassName="size-full rounded-none object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium group-hover:text-primary">{subactivity.title}</span>
                      <span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">{project.name} · {activityTitle}</span>
                    </span>
                    <span className={cn("hidden shrink-0 rounded-full px-2 py-1 text-[0.62rem] font-semibold sm:inline", status.className)}>{status.label}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-primary" />
                  </Link>
                )
              })}
              {openWork.length === 0 && (
                <div className="py-8 text-center">
                  <CheckCircle2 className="mx-auto size-5 text-success" />
                  <p className="mt-2 text-sm font-medium">Nenhuma tarefa pendente</p>
                  <p className="mt-1 text-xs text-muted-foreground">Você não tem atividades abertas relacionadas ao seu usuário.</p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Projetos acompanhados</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">Entre direto na conversa do projeto, sem passar por telas administrativas.</p>
              </div>
              <FolderKanban className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {followedProjects.slice(0, 6).map((project) => {
                const open = project.activities.reduce((total, activity) => total + activity.subactivities.filter((sub) => sub.status !== "done" && sub.status !== "cancelled").length, 0)
                return (
                  <Link key={project.id} href={`/acompanhamento?project=${encodeURIComponent(project.id)}`} className="group flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-background/50 p-3 transition-colors hover:border-primary/30 hover:bg-primary/5">
                    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                      <ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-4" imageClassName="size-full rounded-none object-cover" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{project.name}</span>
                      <span className="mt-0.5 block text-[0.66rem] text-muted-foreground">{open} {open === 1 ? "item aberto" : "itens abertos"}</span>
                    </span>
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground/60 group-hover:text-primary" />
                  </Link>
                )
              })}
              {followedProjects.length === 0 && (
                <div className="col-span-full rounded-2xl border border-dashed border-border p-7 text-center text-sm text-muted-foreground">Nenhum projeto acompanhado no momento.</div>
              )}
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-[5.5rem]">
          <section className="rounded-3xl border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Precisa da sua atenção</h2>
            </div>
            <div className="mt-3 space-y-2">
              <AttentionCard href="/acompanhamento" icon={AtSign} value={mentions} label={mentions === 1 ? "menção" : "menções"} detail="mensagens que citaram você" tone="mention" />
              <AttentionCard href="/solicitacoes" icon={Inbox} value={relatedOpenRequests.length} label={relatedOpenRequests.length === 1 ? "solicitação" : "solicitações"} detail="abertas e relacionadas a você" tone="info" />
              <AttentionCard href="/minhas-tarefas" icon={Play} value={running} label={running === 1 ? "atividade em execução" : "atividades em execução"} detail="do seu acompanhamento" tone="success" />
              {activeAqs.length > 0 && (
                <AttentionCard href="/analise" icon={CheckCircle2} value={activeAqs.length} label={activeAqs.length === 1 ? "análise AQS" : "análises AQS"} detail="aguardando sua validação" />
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Recentes</h2>
              <span className="text-[0.65rem] text-muted-foreground">{unread.length} não lida{unread.length === 1 ? "" : "s"}</span>
            </div>
            <div className="mt-2 divide-y divide-border">
              {recentNotifications.map((notification) => {
                const actor = members.find((member) => member.id === notification.actorId)
                const href = notification.requestId
                  ? `/solicitacoes/${notification.requestId}`
                  : notification.type === "chat-mention" && notification.conversationId
                    ? `/chat?conversation=${encodeURIComponent(notification.conversationId)}`
                    : notification.type === "aqs-awaiting"
                      ? `/analise${notification.subactivityId ? `?sub=${encodeURIComponent(notification.subactivityId)}` : ""}`
                  : notification.projectId
                    ? followUpHref({ projectId: notification.projectId, activityId: notification.activityId, subactivityId: notification.subactivityId })
                    : "/"
                return (
                  <Link key={notification.id} href={href} onClick={() => void markNotificationRead(notification.id)} className="flex min-w-0 items-center gap-2.5 py-3 first:pt-1 last:pb-1">
                    {actor ? (
                      <MemberAvatar member={actor} profileEnabled={false} className="size-8 shrink-0 rounded-lg ring-0" />
                    ) : (
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Bell className="size-3.5" /></span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{notification.title}</span>
                      <span className="mt-0.5 block truncate text-[0.64rem] text-muted-foreground">{notification.description || "Há uma atualização para você."}</span>
                    </span>
                  </Link>
                )
              })}
              {recentNotifications.length === 0 && (
                <div className="py-7 text-center">
                  <CheckCircle2 className="mx-auto size-5 text-success" />
                  <p className="mt-2 text-xs font-medium">Nada novo agora</p>
                  <p className="mt-1 text-[0.66rem] text-muted-foreground">Suas atualizações recentes aparecerão aqui.</p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  )
}
