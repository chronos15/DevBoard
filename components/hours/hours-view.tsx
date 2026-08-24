"use client"

import * as React from "react"
import {
  CalendarRange,
  Clock3,
  FolderKanban,
  Gauge,
  LoaderCircle,
  Play,
  RotateCcw,
  Square,
  Users,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { formatHMS, statusMeta } from "@/lib/project-utils"
import type { Member, Status, Subactivity } from "@/lib/types"
import { cn } from "@/lib/utils"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createClient } from "@/lib/supabase/client"
import {
  loadHoursReport,
  type HoursReportSession,
} from "@/lib/supabase/hours-report"

type PeriodPreset = "today" | "last7" | "month" | "previousMonth" | "last30" | "custom"

type AggregatedRow = {
  subactivityId: string
  userId: string
  projectId: string
  projectName: string
  activityTitle: string
  subactivityTitle: string
  status: Status
  estimatedHours: number
  trackedSeconds: number
  sessions: number
  latestStartedAt: string
}

function dateInputValue(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
}

function initialRange() {
  const today = new Date()
  return {
    start: dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: dateInputValue(today),
  }
}

function rangeForPreset(preset: Exclude<PeriodPreset, "custom">) {
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  if (preset === "today") {
    const value = dateInputValue(startOfToday)
    return { start: value, end: value }
  }
  if (preset === "last7") {
    const start = new Date(startOfToday)
    start.setDate(start.getDate() - 6)
    return { start: dateInputValue(start), end: dateInputValue(startOfToday) }
  }
  if (preset === "last30") {
    const start = new Date(startOfToday)
    start.setDate(start.getDate() - 29)
    return { start: dateInputValue(start), end: dateInputValue(startOfToday) }
  }
  if (preset === "previousMonth") {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const end = new Date(today.getFullYear(), today.getMonth(), 0)
    return { start: dateInputValue(start), end: dateInputValue(end) }
  }

  return {
    start: dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: dateInputValue(startOfToday),
  }
}

function periodLabel(start: string, end: string) {
  if (!start || !end) return "Período não definido"
  const formatter = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
  const startDate = parseLocalDate(start)
  const endDate = parseLocalDate(end)
  if (start === end) return formatter.format(startDate)
  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`
}

function formatServiceHours(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${String(minutes).padStart(2, "0")}min`
}

function sessionSeconds(session: HoursReportSession, endExclusive: Date, now: number) {
  if (session.endedAt) return session.reportedSeconds
  const started = new Date(session.startedAt).getTime()
  const stop = Math.min(now, endExclusive.getTime())
  return Math.max(0, Math.floor((stop - started) / 1000))
}

export function HoursView() {
  const {
    projects,
    members,
    currentUserId,
    currentUserRole,
    runningSubIds,
    startTimer,
    stopTimer,
    canManageSubactivity,
  } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const isAdmin = currentUserRole === "admin"
  const defaultRange = React.useMemo(initialRange, [])

  const [preset, setPreset] = React.useState<PeriodPreset>("month")
  const [startDate, setStartDate] = React.useState(defaultRange.start)
  const [endDate, setEndDate] = React.useState(defaultRange.end)
  const [projectFilter, setProjectFilter] = React.useState("all")
  const [memberFilter, setMemberFilter] = React.useState("all")
  const [sessions, setSessions] = React.useState<HoursReportSession[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const requestRef = React.useRef(0)

  const hasRunning = sessions.some((session) => !session.endedAt)
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!hasRunning) return
    const tick = () => setNow(Date.now())
    tick()
    const id = window.setInterval(tick, 1000)
    const sync = () => tick()
    window.addEventListener("focus", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      window.clearInterval(id)
      window.removeEventListener("focus", sync)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [hasRunning])

  React.useEffect(() => {
    if (!isAdmin && memberFilter !== "all") setMemberFilter("all")
  }, [isAdmin, memberFilter])

  const rangeValid = Boolean(startDate && endDate && parseLocalDate(startDate) <= parseLocalDate(endDate))
  const start = React.useMemo(() => (startDate ? parseLocalDate(startDate) : null), [startDate])
  const endExclusive = React.useMemo(() => {
    if (!endDate) return null
    const date = parseLocalDate(endDate)
    date.setDate(date.getDate() + 1)
    return date
  }, [endDate])

  const load = React.useCallback(async () => {
    if (!rangeValid || !start || !endExclusive || !currentUserId) return
    const requestId = ++requestRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await loadHoursReport(supabase, {
        start: start.toISOString(),
        endExclusive: endExclusive.toISOString(),
        projectId: projectFilter === "all" ? undefined : projectFilter,
        userId: isAdmin && memberFilter !== "all" ? memberFilter : undefined,
      })
      if (requestId === requestRef.current) setSessions(next)
    } catch (cause: any) {
      if (requestId !== requestRef.current) return
      const message = String(cause?.message || "Não foi possível carregar a apuração de horas.")
      setError(
        /hours_report|schema cache|does not exist/i.test(message)
          ? "Execute a migration 023 para habilitar os filtros de apuração e a privacidade dos registros."
          : message,
      )
      setSessions([])
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [currentUserId, endExclusive, isAdmin, memberFilter, projectFilter, rangeValid, start, supabase])

  React.useEffect(() => {
    void load()
  }, [load])

  const subactivityMap = React.useMemo(() => {
    const map = new Map<string, Subactivity>()
    for (const project of projects) {
      for (const activity of project.activities) {
        for (const sub of activity.subactivities) map.set(sub.id, sub)
      }
    }
    return map
  }, [projects])

  const memberMap = React.useMemo(() => new Map(members.map((member) => [member.id, member])), [members])

  const rows = React.useMemo(() => {
    if (!endExclusive) return []
    const grouped = new Map<string, AggregatedRow>()
    for (const session of sessions) {
      const seconds = sessionSeconds(session, endExclusive, now)
      const existing = grouped.get(session.subactivityId)
      if (existing) {
        existing.trackedSeconds += seconds
        existing.sessions += 1
        if (new Date(session.startedAt) > new Date(existing.latestStartedAt)) existing.latestStartedAt = session.startedAt
        continue
      }
      grouped.set(session.subactivityId, {
        subactivityId: session.subactivityId,
        userId: session.userId,
        projectId: session.projectId,
        projectName: session.projectName,
        activityTitle: session.activityTitle,
        subactivityTitle: session.subactivityTitle,
        status: session.subactivityStatus as Status,
        estimatedHours: session.estimatedHours,
        trackedSeconds: seconds,
        sessions: 1,
        latestStartedAt: session.startedAt,
      })
    }
    return [...grouped.values()].sort((a, b) => b.trackedSeconds - a.trackedSeconds)
  }, [endExclusive, now, sessions])

  const totalTracked = rows.reduce((sum, row) => sum + row.trackedSeconds, 0)
  const projectCount = new Set(rows.map((row) => row.projectId)).size
  const peopleCount = new Set(rows.map((row) => row.userId)).size
  const totalSessions = sessions.length

  const summary = [
    {
      label: "Horas registradas",
      value: formatServiceHours(totalTracked),
      hint: periodLabel(startDate, endDate),
      icon: Clock3,
      tone: "text-primary",
      bg: "bg-primary/12",
    },
    {
      label: "Sessões",
      value: String(totalSessions),
      hint: `${rows.length} subatividades trabalhadas`,
      icon: Gauge,
      tone: "text-chart-4",
      bg: "bg-chart-4/12",
    },
    {
      label: "Projetos",
      value: String(projectCount),
      hint: projectFilter === "all" ? "com registro no período" : "projeto selecionado",
      icon: FolderKanban,
      tone: "text-success",
      bg: "bg-success/15",
    },
    {
      label: isAdmin ? "Colaboradores" : "Escopo",
      value: isAdmin ? String(peopleCount) : "Pessoal",
      hint: isAdmin ? "com horas no período" : "somente seus registros",
      icon: Users,
      tone: "text-foreground",
      bg: "bg-muted",
    },
  ]

  const selectableMembers = React.useMemo(
    () => members.filter((member) => member.role === "developer" || member.role === "admin"),
    [members],
  )

  const applyPreset = (next: PeriodPreset) => {
    setPreset(next)
    if (next === "custom") return
    const range = rangeForPreset(next)
    setStartDate(range.start)
    setEndDate(range.end)
  }

  const resetFilters = () => {
    const range = rangeForPreset("month")
    setPreset("month")
    setStartDate(range.start)
    setEndDate(range.end)
    setProjectFilter("all")
    setMemberFilter("all")
  }

  const handleTimer = async (row: AggregatedRow) => {
    const sub = subactivityMap.get(row.subactivityId)
    if (!sub) return
    const running = runningSubIds.includes(sub.id)
    if (running) await stopTimer(sub.id)
    else await startTimer(sub.id)
    await load()
  }

  const desktopGrid = isAdmin
    ? "md:grid-cols-[minmax(0,1fr)_minmax(8rem,10rem)_5rem_7rem_7rem_4rem]"
    : "md:grid-cols-[minmax(0,1fr)_5rem_7rem_7rem_4rem]"

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="flex flex-col gap-1 border-b border-border px-4 py-4 md:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CalendarRange className="size-4 text-primary" />
                <h2 className="text-sm font-semibold">Filtros de apuração</h2>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {isAdmin
                  ? "Consolide as horas da equipe por período, projeto e responsável."
                  : "Consulte seus próprios apontamentos por período e projeto."}
              </p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[0.68rem] font-medium text-muted-foreground">
              {isAdmin ? "Visão administrativa" : "Meus registros"}
            </span>
          </div>
        </div>

        <div className="grid min-w-0 gap-3 p-4 md:grid-cols-2 md:p-5 xl:grid-cols-[0.9fr_1fr_1fr_1.2fr_1.2fr_auto] xl:items-end">
          <FilterField label="Período rápido">
            <select
              value={preset}
              onChange={(event) => applyPreset(event.target.value as PeriodPreset)}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30"
            >
              <option value="today">Hoje</option>
              <option value="last7">Últimos 7 dias</option>
              <option value="month">Este mês</option>
              <option value="previousMonth">Mês anterior</option>
              <option value="last30">Últimos 30 dias</option>
              <option value="custom">Personalizado</option>
            </select>
          </FilterField>

          <FilterField label="De">
            <Input
              type="date"
              value={startDate}
              onChange={(event) => {
                setPreset("custom")
                setStartDate(event.target.value)
              }}
            />
          </FilterField>

          <FilterField label="Até">
            <Input
              type="date"
              value={endDate}
              onChange={(event) => {
                setPreset("custom")
                setEndDate(event.target.value)
              }}
            />
          </FilterField>

          <FilterField label="Projeto">
            <select
              value={projectFilter}
              onChange={(event) => setProjectFilter(event.target.value)}
              className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30"
            >
              <option value="all">Todos os projetos</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </FilterField>

          {isAdmin ? (
            <FilterField label="Responsável">
              <select
                value={memberFilter}
                onChange={(event) => setMemberFilter(event.target.value)}
                className="h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30"
              >
                <option value="all">Todos os responsáveis</option>
                {selectableMembers.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </FilterField>
          ) : (
            <div className="hidden xl:block" />
          )}

          <Button variant="outline" onClick={resetFilters} className="w-full md:w-auto">
            <RotateCcw className="size-3.5" />
            Limpar
          </Button>
        </div>

        {!rangeValid && (
          <div className="border-t border-border px-4 py-3 text-xs font-medium text-destructive md:px-5">
            A data inicial precisa ser anterior ou igual à data final.
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {summary.map((item) => (
          <div
            key={item.label}
            className="flex min-w-0 items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/8 md:gap-4 md:p-5"
          >
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl md:size-11", item.bg, item.tone)}>
              <item.icon className="size-4.5 md:size-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase md:text-[0.65rem]">
                {item.label}
              </p>
              <p className="mt-1 truncate text-xl font-bold tabular-nums tracking-tight md:text-2xl">
                {loading ? "—" : item.value}
              </p>
              <p className="mt-0.5 line-clamp-1 text-[0.68rem] text-muted-foreground md:text-xs">{item.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <section className="min-w-0 rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 md:p-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Registro de horas</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {periodLabel(startDate, endDate)}{projectFilter !== "all" ? " · projeto filtrado" : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {loading && <LoaderCircle className="size-3.5 animate-spin" />}
            {!loading && !error && <span>{rows.length} {rows.length === 1 ? "registro consolidado" : "registros consolidados"}</span>}
          </div>
        </div>

        {error ? (
          <div className="p-5">
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-14 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Calculando horas do período...
          </div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Clock3 className="mx-auto size-6 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Nenhuma hora registrada neste período</p>
            <p className="mt-1 text-xs text-muted-foreground">Ajuste o período ou os filtros para consultar outros apontamentos.</p>
          </div>
        ) : (
          <>
            <div className={cn("hidden items-center gap-4 px-5 py-3 font-mono text-[0.62rem] tracking-widest text-muted-foreground uppercase md:grid", desktopGrid)}>
              <span>Subatividade</span>
              {isAdmin && <span>Responsável</span>}
              <span className="text-right">Sessões</span>
              <span className="text-right">No período</span>
              <span className="text-center">Status</span>
              <span className="text-center">Timer</span>
            </div>

            <ul>
              {rows.map((row) => {
                const sub = subactivityMap.get(row.subactivityId)
                const member = memberMap.get(row.userId)
                const running = runningSubIds.includes(row.subactivityId)
                const done = row.status === "done" || row.status === "cancelled"
                const canManage = sub ? canManageSubactivity(sub) : false
                const meta = statusMeta[row.status]

                return (
                  <li
                    key={row.subactivityId}
                    className={cn("grid min-w-0 grid-cols-1 items-center gap-3 border-t border-border px-4 py-4 md:gap-4 md:px-5", desktopGrid)}
                  >
                    <div className="flex min-w-0 items-center gap-3 overflow-hidden">
                      <MemberAvatar member={member} className="size-8 shrink-0 rounded-lg text-[0.7rem] ring-0" />
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <p className="truncate text-sm font-medium" title={row.subactivityTitle}>{row.subactivityTitle}</p>
                        <p className="truncate text-xs text-muted-foreground" title={`${row.projectName} · ${row.activityTitle}`}>
                          {row.projectName} · {row.activityTitle} · Est. {row.estimatedHours}h
                        </p>
                        {isAdmin && member && (
                          <p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground md:hidden">{member.name}</p>
                        )}
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="hidden min-w-0 items-center gap-2 md:flex">
                        <MemberAvatar member={member} className="size-6 shrink-0 rounded-md text-[0.58rem] ring-0" />
                        <span className="truncate text-xs font-medium" title={member?.name}>{member?.name ?? "Sem responsável"}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between md:block md:text-right">
                      <span className="text-xs text-muted-foreground md:hidden">Sessões</span>
                      <span className="font-mono text-sm tabular-nums">{row.sessions}</span>
                    </div>

                    <div className="flex items-center justify-between md:block md:text-right">
                      <span className="text-xs text-muted-foreground md:hidden">Registrado no período</span>
                      <p className={cn("font-mono text-sm font-medium tabular-nums", running && "text-primary")}>{formatHMS(row.trackedSeconds)}</p>
                    </div>

                    <div className="flex items-center justify-between md:block md:text-center">
                      <span className="text-xs text-muted-foreground md:hidden">Status</span>
                      <span className={cn("inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium", meta.className)}>
                        <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} />
                        <span className="truncate">{meta.label}</span>
                      </span>
                    </div>

                    <div className="flex items-center justify-between md:justify-center">
                      <span className="text-xs text-muted-foreground md:hidden">Timer</span>
                      <button
                        disabled={done || !canManage || !sub}
                        onClick={() => void handleTimer(row)}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-xl transition-colors",
                          done || !canManage || !sub
                            ? "cursor-not-allowed bg-muted text-muted-foreground/50"
                            : running
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground hover:bg-primary/12 hover:text-primary",
                        )}
                        aria-label={!canManage ? "Subatividade protegida" : running ? "Parar timer" : "Iniciar timer"}
                        title={!canManage ? "Somente o Desenvolvedor responsável ou um Administrador pode controlar esta subatividade" : undefined}
                      >
                        {running ? <Square className="size-4 fill-current" /> : <Play className="size-4 fill-current" />}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-[0.68rem] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}
