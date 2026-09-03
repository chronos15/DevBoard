"use client"

import Link from "next/link"
import {
  ArrowRight,
  CheckCircle2,
  Inbox,
  ClipboardCheck,
  Clock3,
  Plus,
  MessageSquareText,
  RotateCcw,
  SearchCheck,
} from "lucide-react"
import { PageHeading } from "@/components/page-heading"
import { KpiCards } from "@/components/dashboard/kpi-cards"
import { HoursAreaChart } from "@/components/dashboard/hours-area-chart"
import { StatusDonut } from "@/components/dashboard/status-donut"
import { ProjectsProgress } from "@/components/dashboard/projects-progress"
import { FocusPanel } from "@/components/dashboard/focus-panel"
import { HoursByProject } from "@/components/dashboard/hours-by-project"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { openProjectFollowUp } from "@/lib/follow-up-launcher"
import { SERVICE_REQUEST_STATUS_LABELS, serviceRequestStatusTone } from "@/lib/service-requests"


function FollowUpQuickButton() {
  return (
    <button
      type="button"
      onClick={() => openProjectFollowUp()}
      className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted"
      title="Abrir acompanhamento · Ctrl + P"
    >
      <MessageSquareText className="size-4 text-primary" />
      Acompanhamento
      <kbd className="ml-1 hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[0.58rem] font-normal text-muted-foreground sm:inline">Ctrl P</kbd>
    </button>
  )
}

function StatCard({ label, value, Icon }: { label: string; value: number; Icon: typeof ClipboardCheck }) {
  return (
    <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/8">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function AqsDashboard({ firstName }: { firstName: string }) {
  const { aqsReviews, currentUserId, projects } = useStore()
  const visibleReviews = aqsReviews.filter((item) => item.assignedAqsId === currentUserId)
  const awaiting = visibleReviews.filter((item) => item.status === "awaiting").length
  const evaluating = visibleReviews.filter((item) => item.status === "evaluating").length
  const completed = visibleReviews.filter((item) => item.status === "completed").length
  const revoked = visibleReviews.filter((item) => item.status === "revoked").length
  const active = visibleReviews.filter((item) => item.status === "awaiting" || item.status === "evaluating").slice(0, 6)

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Qualidade"
        title={firstName ? `Olá, ${firstName}` : "Painel AQS"}
        subtitle="Sua fila de validação e os itens que aguardam uma decisão de qualidade."
        action={
          <Link href="/analise" className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            <SearchCheck className="size-4" /> Abrir Análise
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Aguardando" value={awaiting} Icon={ClipboardCheck} />
        <StatCard label="Avaliando" value={evaluating} Icon={Clock3} />
        <StatCard label="Concluídas" value={completed} Icon={CheckCircle2} />
        <StatCard label="Revogadas" value={revoked} Icon={RotateCcw} />
      </div>
      <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/8 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-sm font-semibold">Próximas análises</h2><p className="mt-0.5 text-xs text-muted-foreground">Itens ativos atribuídos a você.</p></div>
          <Link href="/analise" className="flex items-center gap-1 text-xs font-medium text-primary">Ver Kanban <ArrowRight className="size-3.5" /></Link>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {active.map((review) => {
            const project = projects.find((item) => item.id === review.projectId)
            const activity = project?.activities.find((item) => item.id === review.activityId)
            const sub = activity?.subactivities.find((item) => item.id === review.subactivityId)
            return (
              <Link key={review.id} href={`/analise?sub=${review.subactivityId}`} className="rounded-xl border border-border bg-muted/20 p-3 transition-colors hover:bg-muted/45">
                <p className="truncate text-[0.68rem] font-medium text-primary">{project?.name ?? "Projeto"}</p>
                <p className="mt-1 line-clamp-2 text-sm font-semibold">{sub?.title ?? "Subatividade"}</p>
                <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{activity?.title ?? "Atividade"}</p>
              </Link>
            )
          })}
          {active.length === 0 && <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhuma análise pendente agora.</div>}
        </div>
      </section>
    </div>
  )
}

function RequestsDashboard({ firstName }: { firstName: string }) {
  const { serviceRequests, currentUserId, currentUserRole } = useStore()
  const visibleRequests = serviceRequests.filter((request) => request.createdBy === currentUserId || request.participantIds.includes(currentUserId))
  const open = visibleRequests.filter((request) => !["completed", "rejected", "cancelled"].includes(request.status)).length
  const aqs = visibleRequests.filter((request) => ["received", "aqs-analysis", "waiting-info", "waiting-aqs"].includes(request.status)).length
  const dev = visibleRequests.filter((request) => ["waiting-dev", "waiting-executor", "in-dev", "rework"].includes(request.status)).length
  const completed = visibleRequests.filter((request) => request.status === "completed").length

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow={currentUserRole === "support" ? "Suporte" : "Workspace"}
        title={firstName ? `Olá, ${firstName}` : "Painel"}
        subtitle="Abra e acompanhe solicitações com protocolo, evidências e histórico AQS → DEV em um único fluxo."
        action={
          <Link href="/solicitacoes" className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            <Inbox className="size-4" /> Abrir Solicitações
          </Link>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Em andamento" value={open} Icon={Clock3} />
        <StatCard label="Na fila AQS" value={aqs} Icon={SearchCheck} />
        <StatCard label="No DEV" value={dev} Icon={ArrowRight} />
        <StatCard label="Concluídas" value={completed} Icon={CheckCircle2} />
      </div>
      <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/8 sm:p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Solicitações recentes</h2><p className="mt-0.5 text-xs text-muted-foreground">Últimos protocolos relacionados ao seu usuário.</p></div><Link href="/solicitacoes/minhas" className="flex items-center gap-1 text-xs font-medium text-primary">Abrir fila <ArrowRight className="size-3.5" /></Link></div>
        <div className="mt-4 space-y-2">
          {visibleRequests.slice(0, 6).map((request) => (
            <Link key={request.id} href={`/solicitacoes/${request.id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/45">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{request.title}</p><p className="mt-0.5 truncate font-mono text-[0.66rem] text-muted-foreground">OS {request.orderNumber} · {request.unit}</p></div>
              <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[0.65rem] font-medium", serviceRequestStatusTone(request.status))}>{SERVICE_REQUEST_STATUS_LABELS[request.status]}</span>
            </Link>
          ))}
          {visibleRequests.length === 0 && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nenhuma solicitação relacionada a você no momento.</div>}
        </div>
      </section>
    </div>
  )
}

export default function DashboardPage() {
  const { currentUserId, currentUserRole, members } = useStore()
  const currentUser = members.find((member) => member.id === currentUserId)
  const firstName = currentUser?.name?.trim().split(/\s+/)[0] || ""

  if (currentUserRole === "aqs") return <AqsDashboard firstName={firstName} />
  if (currentUserRole === "support" || currentUserRole === "member") return <RequestsDashboard firstName={firstName} />

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Painel geral"
        title={firstName ? `Olá, ${firstName}` : "Painel"}
        subtitle="Aqui está o panorama dos seus projetos e do tempo investido."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FollowUpQuickButton />
            <Link href="/projetos/novo" className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
              <Plus className="size-4" /> Novo projeto
            </Link>
          </div>
        }
      />
      <KpiCards />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2"><HoursAreaChart /></div>
        <StatusDonut />
        <ProjectsProgress />
        <FocusPanel />
        <HoursByProject />
      </div>
    </div>
  )
}
