"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Inbox,
  Layers3,
  Plus,
  Search,
} from "lucide-react"
import { useStore } from "@/lib/store"
import {
  SERVICE_REQUEST_FINAL_STATUSES,
  SERVICE_REQUEST_STATUS_LABELS,
  SERVICE_REQUEST_TYPE_LABELS,
  serviceRequestMatchesScope,
  serviceRequestReference,
  serviceRequestScopeTitle,
  serviceRequestStatusTone,
  type ServiceRequestScope,
} from "@/lib/service-requests"
import type { ServiceRequest, ServiceRequestStatus, ServiceRequestType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { RequestUnitIcon } from "@/components/requests/request-unit-icon"
import { RequestDetail } from "@/components/requests/request-detail"
import { NewServiceRequestDialog } from "@/components/requests/request-create-dialog"
import { cn } from "@/lib/utils"

const REQUEST_UNIT_SELECTION_KEY = "devboard-request-unit-selection-v1"

const STATUS_ORDER: ServiceRequestStatus[] = [
  "received",
  "aqs-analysis",
  "waiting-info",
  "waiting-dev",
  "waiting-executor",
  "in-dev",
  "waiting-aqs",
  "rework",
  "waiting-build",
  "completed",
  "rejected",
  "cancelled",
]

const SCOPE_META: Record<ServiceRequestScope, { label: string; href: string }> = {
  inbox: { label: "Caixa de entrada", href: "/solicitacoes" },
  mine: { label: "Minhas solicitações", href: "/solicitacoes/minhas" },
  aqs: { label: "AQS", href: "/solicitacoes/aqs" },
  dev: { label: "DEV", href: "/solicitacoes/dev" },
  completed: { label: "Concluídas", href: "/solicitacoes/concluidas" },
}

function formatCompactDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}

function requestLabel(request: ServiceRequest) {
  return `${serviceRequestReference(request)} · ${request.title}`
}

export function RequestsWorkspace({ scope, requestId }: { scope: ServiceRequestScope; requestId?: string }) {
  const router = useRouter()
  const { serviceRequests, serviceRequestUnits, currentUserId, currentUserRole } = useStore()
  const [createOpen, setCreateOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [type, setType] = React.useState<ServiceRequestType | "all">("all")
  const [selectedUnitId, setSelectedUnitId] = React.useState<string>("all")
  const selectedRequest = serviceRequests.find((request) => request.id === requestId)
  const heading = serviceRequestScopeTitle(scope)

  const visibleScopes = React.useMemo(() => ([
    "inbox",
    "mine",
    ...(currentUserRole === "admin" || currentUserRole === "aqs" ? ["aqs"] : []),
    ...(currentUserRole === "admin" || currentUserRole === "developer" ? ["dev"] : []),
    "completed",
  ] as ServiceRequestScope[]), [currentUserRole])

  const scoped = React.useMemo(() => {
    const base = serviceRequests.filter((request) => serviceRequestMatchesScope(request, scope, currentUserId, currentUserRole))
    if (selectedRequest && !base.some((request) => request.id === selectedRequest.id)) return [selectedRequest, ...base]
    return base
  }, [currentUserId, currentUserRole, scope, selectedRequest, serviceRequests])

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(REQUEST_UNIT_SELECTION_KEY)
      if (saved && (saved === "all" || serviceRequestUnits.some((unit) => unit.id === saved))) setSelectedUnitId(saved)
    } catch {
      // A navegação continua funcional sem persistência local.
    }
  }, [serviceRequestUnits])

  React.useEffect(() => {
    if (!selectedRequest?.unitId) return
    setSelectedUnitId(selectedRequest.unitId)
  }, [selectedRequest?.id, selectedRequest?.unitId])

  const unitsForRail = React.useMemo(() => {
    const usedIds = new Set(scoped.map((request) => request.unitId).filter(Boolean))
    return serviceRequestUnits.filter((unit) => unit.active || usedIds.has(unit.id))
  }, [scoped, serviceRequestUnits])

  const filtered = React.useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR")
    const selectedUnit = serviceRequestUnits.find((unit) => unit.id === selectedUnitId)
    return scoped.filter((request) => {
      if (selectedUnitId !== "all" && request.unitId !== selectedUnitId && request.unit !== selectedUnit?.name) return false
      if (type !== "all" && request.requestType !== type) return false
      if (!normalized) return true
      const haystack = [
        request.orderNumber,
        request.title,
        request.unit,
        request.module,
        request.subject,
        request.description,
        SERVICE_REQUEST_TYPE_LABELS[request.requestType],
        SERVICE_REQUEST_STATUS_LABELS[request.status],
      ].join(" ").toLocaleLowerCase("pt-BR")
      return haystack.includes(normalized)
    })
  }, [query, scoped, selectedUnitId, serviceRequestUnits, type])

  const grouped = React.useMemo(() => STATUS_ORDER.map((status) => ({
    status,
    requests: filtered.filter((request) => request.status === status),
  })).filter((group) => group.requests.length > 0), [filtered])

  const selectedUnit = selectedUnitId === "all" ? null : serviceRequestUnits.find((unit) => unit.id === selectedUnitId) ?? null
  const pendingCount = filtered.filter((request) => !SERVICE_REQUEST_FINAL_STATUSES.has(request.status)).length
  const priorityCount = filtered.filter((request) => request.priorityRequested && !SERVICE_REQUEST_FINAL_STATUSES.has(request.status)).length

  function selectUnit(unitId: string) {
    setSelectedUnitId(unitId)
    try { window.localStorage.setItem(REQUEST_UNIT_SELECTION_KEY, unitId) } catch { /* noop */ }
    if (requestId) router.push(SCOPE_META[scope].href)
  }

  function openRequest(id: string) {
    router.push(`/solicitacoes/${id}?scope=${scope}`)
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-background" aria-label="Central de solicitações">
      <header className="flex min-h-[58px] shrink-0 items-center gap-3 border-b border-border bg-card px-3 sm:px-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Inbox className="size-4" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">Solicitações</h1>
          <p className="hidden truncate text-[0.66rem] text-muted-foreground sm:block">Protocolo, análise, DEV e acompanhamento em uma única visão.</p>
        </div>
        <Button type="button" size="sm" onClick={() => setCreateOpen(true)}><Plus className="size-4" /> <span className="hidden sm:inline">Nova solicitação</span></Button>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
        <aside className="flex h-[64px] shrink-0 items-center gap-2 overflow-x-auto border-b border-border bg-muted/20 px-2 md:h-full md:w-[68px] md:flex-col md:overflow-x-hidden md:overflow-y-auto md:border-b-0 md:border-r md:px-0 md:py-2" aria-label="Unidades">
          <button
            type="button"
            onClick={() => selectUnit("all")}
            className={cn(
              "relative flex size-11 shrink-0 items-center justify-center rounded-2xl border transition-all md:size-10",
              selectedUnitId === "all" ? "rounded-xl border-primary/35 bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:rounded-xl hover:bg-muted hover:text-foreground",
            )}
            title="Todas as unidades"
            aria-label="Todas as unidades"
          >
            <Layers3 className="size-4" />
          </button>

          <span className="hidden h-px w-8 shrink-0 bg-border md:block" />

          {unitsForRail.map((unit) => {
            const active = selectedUnitId === unit.id
            const count = scoped.filter((request) => request.unitId === unit.id || (!request.unitId && request.unit === unit.name)).length
            return (
              <button
                key={unit.id}
                type="button"
                onClick={() => selectUnit(unit.id)}
                className={cn(
                  "group relative flex size-11 shrink-0 items-center justify-center overflow-visible rounded-2xl border transition-all md:size-10",
                  active ? "rounded-xl border-primary/35 bg-primary/10 text-primary ring-1 ring-primary/15" : "border-border bg-card text-muted-foreground hover:rounded-xl hover:bg-muted hover:text-foreground",
                )}
                title={`${unit.name}${!unit.active ? " · inativa" : ""}`}
                aria-label={`Filtrar pela unidade ${unit.name}`}
              >
                <span className="flex size-full items-center justify-center overflow-hidden rounded-[inherit]"><RequestUnitIcon icon={unit.icon} imageUrl={unit.iconImageUrl} className="size-[1.05rem]" /></span>
                {count > 0 && <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[0.52rem] font-bold leading-4 text-background ring-2 ring-background">{count > 99 ? "99+" : count}</span>}
              </button>
            )
          })}

          {currentUserRole === "admin" && (
            <button type="button" onClick={() => router.push("/config?section=unidades")} className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:rounded-xl hover:border-primary/30 hover:bg-primary/8 hover:text-primary" title="Adicionar / configurar unidades" aria-label="Adicionar ou configurar unidades"><Plus className="size-4" /></button>
          )}
        </aside>

        <aside className={cn("min-h-0 w-full flex-1 flex-col border-border bg-card md:w-[310px] md:flex-none md:border-r", requestId ? "hidden md:flex" : "flex")} aria-label="Solicitações e status">
          <div className="shrink-0 border-b border-border p-3">
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{selectedUnit?.name ?? "Todas as unidades"}</p>
                <p className="mt-0.5 truncate text-[0.62rem] text-muted-foreground">{heading.title} · {filtered.length} registro{filtered.length === 1 ? "" : "s"}</p>
              </div>
              <Select value={scope} onValueChange={(value) => value && router.push(SCOPE_META[String(value) as ServiceRequestScope].href)}>
                <SelectTrigger className="h-8 w-[112px] rounded-lg bg-background px-2 text-[0.65rem]"><SelectValue>{SCOPE_META[scope].label}</SelectValue></SelectTrigger>
                <SelectContent align="end">{visibleScopes.map((item) => <SelectItem key={item} value={item}>{SCOPE_META[item].label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <label className="relative mt-3 block">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar solicitação..." className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none transition-colors focus:border-ring" />
            </label>

            <div className="mt-2 flex items-center gap-2">
              <Select value={type} onValueChange={(value) => value && setType(String(value) as ServiceRequestType | "all")}>
                <SelectTrigger className="h-8 min-w-0 flex-1 rounded-lg bg-background text-[0.65rem]"><SelectValue>{type === "all" ? "Todos os tipos" : SERVICE_REQUEST_TYPE_LABELS[type]}</SelectValue></SelectTrigger>
                <SelectContent><SelectItem value="all">Todos os tipos</SelectItem>{(Object.entries(SERVICE_REQUEST_TYPE_LABELS) as Array<[ServiceRequestType, string]>).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
              </Select>
              {priorityCount > 0 && <span className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-warning/20 bg-warning/8 px-2 text-[0.62rem] font-semibold text-warning"><AlertTriangle className="size-3" /> {priorityCount}</span>}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin]">
            {grouped.length === 0 ? (
              <div className="px-4 py-12 text-center"><Inbox className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-xs font-semibold">Nenhuma solicitação</p><p className="mt-1 text-[0.66rem] leading-relaxed text-muted-foreground">Ajuste a unidade, o tipo ou a pesquisa.</p></div>
            ) : grouped.map((group) => (
              <section key={group.status} className="mb-3">
                <div className="flex h-7 items-center gap-1.5 px-1 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  <ChevronDown className="size-3" />
                  <span className="truncate">{SERVICE_REQUEST_STATUS_LABELS[group.status]}</span>
                  <span className="ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[0.55rem]">{group.requests.length}</span>
                </div>
                <div className="space-y-0.5">
                  {group.requests.map((request) => {
                    const active = request.id === requestId
                    return (
                      <button
                        key={request.id}
                        type="button"
                        onClick={() => openRequest(request.id)}
                        className={cn(
                          "group flex w-full min-w-0 items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                          active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", request.priorityRequested ? "bg-warning" : SERVICE_REQUEST_FINAL_STATUSES.has(request.status) ? "bg-success" : "bg-muted-foreground/45")} />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate text-xs", active ? "font-semibold" : "font-medium")}>{requestLabel(request)}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[0.6rem]">
                            <span className="truncate">{SERVICE_REQUEST_TYPE_LABELS[request.requestType]}</span>
                            <span>·</span>
                            <span className="shrink-0">{formatCompactDate(request.updatedAt)}</span>
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        </aside>

        <main className={cn("min-h-0 min-w-0 flex-1 bg-background", requestId ? "flex" : "hidden md:flex")}>
          {requestId ? (
            <RequestDetail requestId={requestId} embedded backHref={SCOPE_META[scope].href} />
          ) : (
            <div className="flex h-full w-full items-center justify-center p-6 text-center">
              <div className="max-w-md">
                <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Inbox className="size-6" /></span>
                <h2 className="mt-4 text-base font-semibold">{heading.title}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Selecione uma solicitação na lista para abrir o protocolo, histórico, documentos e responsáveis sem sair desta visão.</p>
                <div className="mt-5 flex items-center justify-center gap-2 text-[0.68rem] text-muted-foreground"><CircleDot className="size-3.5" /><span>{pendingCount} em andamento nesta seleção</span>{filtered.some((request) => request.status === "completed") && <><span>·</span><CheckCircle2 className="size-3.5" /></>}</div>
              </div>
            </div>
          )}
        </main>
      </div>

      <NewServiceRequestDialog open={createOpen} onOpenChange={setCreateOpen} />
    </section>
  )
}

export function RequestsView({ scope }: { scope: ServiceRequestScope }) {
  return <RequestsWorkspace scope={scope} />
}
