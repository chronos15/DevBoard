"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Inbox, Paperclip, Plus, Search, UserRound } from "lucide-react"
import { useStore } from "@/lib/store"
import {
  SERVICE_REQUEST_FINAL_STATUSES,
  SERVICE_REQUEST_STATUS_LABELS,
  SERVICE_REQUEST_TYPE_LABELS,
  serviceRequestMatchesScope,
  serviceRequestScopeTitle,
  serviceRequestStatusTone,
  serviceRequestTypeTone,
  type ServiceRequestScope,
} from "@/lib/service-requests"
import type { ServiceRequestStatus, ServiceRequestType } from "@/lib/types"
import { PageHeading } from "@/components/page-heading"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { NewServiceRequestDialog } from "@/components/requests/request-create-dialog"

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

function requestProgress(status: ServiceRequestStatus) {
  const order: ServiceRequestStatus[] = ["received", "aqs-analysis", "waiting-info", "waiting-dev", "waiting-executor", "in-dev", "waiting-aqs", "rework", "waiting-build", "completed"]
  if (status === "rejected" || status === "cancelled") return 100
  const index = order.indexOf(status)
  return index < 0 ? 0 : Math.max(8, Math.round((index / (order.length - 1)) * 100))
}

export function RequestsView({ scope }: { scope: ServiceRequestScope }) {
  const router = useRouter()
  const { serviceRequests, members, currentUserId, currentUserRole } = useStore()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState<ServiceRequestStatus | "all">("all")
  const [type, setType] = React.useState<ServiceRequestType | "all">("all")
  const heading = serviceRequestScopeTitle(scope)

  const scoped = React.useMemo(
    () => serviceRequests.filter((request) => serviceRequestMatchesScope(request, scope, currentUserId, currentUserRole)),
    [currentUserId, currentUserRole, scope, serviceRequests],
  )

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR")
    return scoped.filter((request) => {
      if (status !== "all" && request.status !== status) return false
      if (type !== "all" && request.requestType !== type) return false
      if (!normalized) return true
      const haystack = [request.orderNumber, request.title, request.unit, request.module, request.subject, request.description, SERVICE_REQUEST_TYPE_LABELS[request.requestType], SERVICE_REQUEST_STATUS_LABELS[request.status]].join(" ").toLocaleLowerCase("pt-BR")
      return haystack.includes(normalized)
    })
  }, [query, scoped, status, type])

  const pendingCount = scoped.filter((request) => !SERVICE_REQUEST_FINAL_STATUSES.has(request.status)).length
  const priorityCount = scoped.filter((request) => request.priorityRequested && !SERVICE_REQUEST_FINAL_STATUSES.has(request.status)).length
  const awaitingAction = scoped.filter((request) => ["received", "waiting-dev", "waiting-executor", "waiting-aqs"].includes(request.status)).length
  const completedCount = scoped.filter((request) => request.status === "completed").length

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow={heading.eyebrow}
        title={heading.title}
        subtitle={heading.subtitle}
        action={<Button type="button" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Nova solicitação</Button>}
      />

      <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" aria-label="Visões de solicitações">
        {[
          { scope: "inbox" as const, href: "/solicitacoes", label: "Caixa de entrada", show: true },
          { scope: "mine" as const, href: "/solicitacoes/minhas", label: "Minhas solicitações", show: true },
          { scope: "aqs" as const, href: "/solicitacoes/aqs", label: "AQS", show: currentUserRole === "admin" || currentUserRole === "aqs" },
          { scope: "dev" as const, href: "/solicitacoes/dev", label: "DEV", show: currentUserRole === "admin" || currentUserRole === "developer" },
          { scope: "completed" as const, href: "/solicitacoes/concluidas", label: "Concluídas", show: true },
        ].filter((item) => item.show).map((item) => (
          <Link key={item.scope} href={item.href} className={cn("shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition-colors", scope === item.scope ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{item.label}</Link>
        ))}
      </nav>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Em andamento", value: pendingCount, helper: "Protocolos ainda abertos", icon: Clock3 },
          { label: "Aguardando ação", value: awaitingAction, helper: "Fila que exige movimentação", icon: Inbox },
          { label: "Prioridade solicitada", value: priorityCount, helper: "Ainda em processo", icon: AlertTriangle },
          { label: "Concluídas", value: completedCount, helper: "Encerradas nesta visão", icon: CheckCircle2 },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"><item.icon className="size-4" /></span>
              <span className="font-mono text-2xl font-semibold tracking-tight">{item.value}</span>
            </div>
            <p className="mt-3 text-xs font-semibold">{item.label}</p>
            <p className="mt-1 text-[0.68rem] text-muted-foreground">{item.helper}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por OS, módulo, assunto, unidade ou descrição..." className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors focus:border-ring" />
          </label>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <Select value={status} onValueChange={(value) => value && setStatus(String(value) as ServiceRequestStatus | "all")}>
              <SelectTrigger className="h-10 w-full min-w-0 rounded-xl bg-background sm:w-48"><SelectValue>{status === "all" ? "Todos os status" : SERVICE_REQUEST_STATUS_LABELS[status]}</SelectValue></SelectTrigger>
              <SelectContent align="end"><SelectItem value="all">Todos os status</SelectItem>{(Object.entries(SERVICE_REQUEST_STATUS_LABELS) as Array<[ServiceRequestStatus, string]>).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={type} onValueChange={(value) => value && setType(String(value) as ServiceRequestType | "all")}>
              <SelectTrigger className="h-10 w-full min-w-0 rounded-xl bg-background sm:w-48"><SelectValue>{type === "all" ? "Todos os tipos" : SERVICE_REQUEST_TYPE_LABELS[type]}</SelectValue></SelectTrigger>
              <SelectContent align="end"><SelectItem value="all">Todos os tipos</SelectItem>{(Object.entries(SERVICE_REQUEST_TYPE_LABELS) as Array<[ServiceRequestType, string]>).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Inbox className="size-5" /></span>
            <p className="mt-4 text-sm font-semibold">Nenhuma solicitação nesta visão</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">Ajuste os filtros ou abra uma nova solicitação para iniciar o protocolo AQS → DEV.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((request) => {
              const creator = members.find((member) => member.id === request.createdBy)
              const aqs = members.find((member) => member.id === request.assignedAqsId)
              const dev = members.find((member) => member.id === request.executorId || member.id === request.responsibleDevId)
              return (
                <button key={request.id} type="button" onClick={() => router.push(`/solicitacoes/${request.id}`)} className="group grid w-full min-w-0 gap-4 px-4 py-4 text-left transition-colors hover:bg-muted/35 md:grid-cols-[minmax(0,1fr)_auto] md:px-5">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-[0.68rem] font-semibold text-primary">OS {request.orderNumber}</span>
                      <span className={cn("rounded-full border px-2 py-0.5 text-[0.62rem] font-medium", serviceRequestTypeTone(request.requestType))}>{SERVICE_REQUEST_TYPE_LABELS[request.requestType]}</span>
                      {request.priorityRequested && <span className="rounded-full border border-warning/25 bg-warning/10 px-2 py-0.5 text-[0.62rem] font-semibold text-warning">Prioridade</span>}
                    </div>
                    <h3 className="mt-2 truncate text-sm font-semibold text-foreground group-hover:text-primary">{request.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{request.module} · {request.subject} · {request.unit}</p>
                    <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[0.68rem] text-muted-foreground">
                      <span className="inline-flex min-w-0 items-center gap-1.5"><UserRound className="size-3.5 shrink-0" /><MemberName member={creator} className="max-w-44 truncate" fallback="Solicitante" /></span>
                      <span className="inline-flex items-center gap-1.5"><Paperclip className="size-3.5" />{request.attachments.length} documento{request.attachments.length === 1 ? "" : "s"}</span>
                      <span>Atualizada {formatDate(request.updatedAt)}</span>
                    </div>
                  </div>

                  <div className="flex min-w-0 items-center justify-between gap-4 md:w-[300px] md:justify-end">
                    <div className="min-w-0 flex-1 md:max-w-52">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-[0.66rem] font-semibold", serviceRequestStatusTone(request.status))}>{SERVICE_REQUEST_STATUS_LABELS[request.status]}</span>
                        <span className="font-mono text-[0.62rem] text-muted-foreground">{requestProgress(request.status)}%</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${requestProgress(request.status)}%` }} /></div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex -space-x-1.5">
                          {[aqs, dev].filter(Boolean).map((member) => <MemberAvatar key={member!.id} member={member} className="size-6 text-[0.55rem] ring-2 ring-card" />)}
                        </div>
                        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <NewServiceRequestDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}
