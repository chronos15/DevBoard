"use client"

import * as React from "react"
import Link from "next/link"
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  CalendarRange,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  FileText,
  Filter,
  FolderKanban,
  Gauge,
  LoaderCircle,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Users,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { loadHoursReport, type HoursReportSession } from "@/lib/supabase/hours-report"
import { useAnalyticsScope } from "@/lib/use-analytics-scope"
import { useStore } from "@/lib/store"
import { formatHMS, statusMeta } from "@/lib/project-utils"
import type { Priority, Status } from "@/lib/types"
import { cn } from "@/lib/utils"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type PeriodPreset =
  | "today"
  | "last7"
  | "last30"
  | "month"
  | "previousMonth"
  | "quarter"
  | "year"
  | "custom"

type ReportFilters = {
  startDate: string
  endDate: string
  projectId: string
  memberId: string
  typeId: string
  status: string
  priority: string
  search: string
  includeWithoutHours: boolean
}

type ReportItem = {
  projectId: string
  projectName: string
  client: string
  priority: Priority
  activityId: string
  activityTitle: string
  subactivityId: string
  subactivityTitle: string
  status: Status
  assigneeId: string
  assigneeName: string
  typeId: string
  typeName: string
  estimatedHours: number
  trackedSeconds: number
  periodSeconds: number
  sessions: number
  createdAt?: string
  participantIds: string[]
}

type RankingRow = {
  id: string
  label: string
  secondary?: string
  seconds: number
  estimatedSeconds?: number
  count?: number
}

type SortKey = "period" | "tracked" | "estimate" | "project" | "status"
type PageSize = "25" | "50" | "100" | "all"

const allStatuses = Object.keys(statusMeta) as Status[]

function dateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day, 0, 0, 0, 0)
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
    return {
      start: dateInputValue(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      end: dateInputValue(new Date(today.getFullYear(), today.getMonth(), 0)),
    }
  }
  if (preset === "quarter") {
    const quarterStartMonth = Math.floor(today.getMonth() / 3) * 3
    return {
      start: dateInputValue(new Date(today.getFullYear(), quarterStartMonth, 1)),
      end: dateInputValue(startOfToday),
    }
  }
  if (preset === "year") {
    return {
      start: dateInputValue(new Date(today.getFullYear(), 0, 1)),
      end: dateInputValue(startOfToday),
    }
  }
  return {
    start: dateInputValue(new Date(today.getFullYear(), today.getMonth(), 1)),
    end: dateInputValue(startOfToday),
  }
}

function periodLabel(start: string, end: string) {
  if (!start || !end) return "Período não definido"
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
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

function decimalHours(totalSeconds: number) {
  return Math.max(0, totalSeconds) / 3600
}

function formatDecimalHours(totalSeconds: number) {
  return decimalHours(totalSeconds).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function percentage(value: number, total: number) {
  if (total <= 0) return 0
  return Math.round((value / total) * 100)
}

function sessionSeconds(session: HoursReportSession, start: Date, endExclusive: Date, now: number) {
  if (session.endedAt) return session.reportedSeconds
  const started = Math.max(new Date(session.startedAt).getTime(), start.getTime())
  const stop = Math.min(now, endExclusive.getTime())
  return Math.max(0, Math.floor((stop - started) / 1000))
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
}

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function excelCell(value: string | number, type: "String" | "Number" = "String", style = "") {
  return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${type}">${xmlEscape(value)}</Data></Cell>`
}

function excelRow(cells: string[]) {
  return `<Row>${cells.join("")}</Row>`
}

function rankingWidth(seconds: number, maxSeconds: number) {
  if (maxSeconds <= 0) return 0
  return Math.max(4, Math.min(100, (seconds / maxSeconds) * 100))
}

function dayKey(date: Date) {
  return dateInputValue(date)
}

function splitSessionAcrossDays(
  session: HoursReportSession,
  start: Date,
  endExclusive: Date,
  now: number,
) {
  const result = new Map<string, number>()
  const sessionStart = new Date(session.startedAt).getTime()
  const sessionEnd = session.endedAt ? new Date(session.endedAt).getTime() : now
  const clippedStart = Math.max(sessionStart, start.getTime())
  const clippedEnd = Math.min(sessionEnd, endExclusive.getTime(), now)
  if (!Number.isFinite(clippedStart) || !Number.isFinite(clippedEnd) || clippedEnd <= clippedStart) return result

  const effectiveSeconds = sessionSeconds(session, start, endExclusive, now)
  const wallSeconds = Math.max(1, (clippedEnd - clippedStart) / 1000)
  const scale = effectiveSeconds / wallSeconds
  let cursor = clippedStart

  while (cursor < clippedEnd) {
    const current = new Date(cursor)
    const nextDay = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime()
    const segmentEnd = Math.min(clippedEnd, nextDay)
    const seconds = Math.max(0, ((segmentEnd - cursor) / 1000) * scale)
    const key = dayKey(current)
    result.set(key, (result.get(key) ?? 0) + seconds)
    cursor = segmentEnd
  }

  return result
}

function ReportChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const title = payload?.[0]?.payload?.name ?? label
  const client = payload?.[0]?.payload?.client
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="max-w-56 truncate font-semibold">{title}</p>
      {client ? <p className="mb-1.5 mt-0.5 max-w-56 truncate text-[0.65rem] text-muted-foreground">{client}</p> : <div className="mb-1" />}
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-5 py-0.5 text-muted-foreground">
          <span>{entry.name}</span>
          <strong className="font-mono font-medium tabular-nums text-foreground">
            {Number(entry.value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h
          </strong>
        </div>
      ))}
    </div>
  )
}

export function ReportsView() {
  const { currentUserId, isAdmin, projects, members } = useAnalyticsScope()
  const { workItemTypes } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const initial = React.useMemo(() => rangeForPreset("month"), [])

  const initialFilters = React.useMemo<ReportFilters>(() => ({
    startDate: initial.start,
    endDate: initial.end,
    projectId: "all",
    memberId: "all",
    typeId: "all",
    status: "all",
    priority: "all",
    search: "",
    includeWithoutHours: false,
  }), [initial.end, initial.start])

  const [preset, setPreset] = React.useState<PeriodPreset>("month")
  const [draft, setDraft] = React.useState<ReportFilters>(initialFilters)
  const [applied, setApplied] = React.useState<ReportFilters>(initialFilters)
  const [sessions, setSessions] = React.useState<HoursReportSession[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [now, setNow] = React.useState(() => Date.now())
  const [sortBy, setSortBy] = React.useState<SortKey>("period")
  const [pageSize, setPageSize] = React.useState<PageSize>("50")
  const [page, setPage] = React.useState(1)
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const requestRef = React.useRef(0)

  const rangeValid = Boolean(
    draft.startDate
      && draft.endDate
      && parseLocalDate(draft.startDate) <= parseLocalDate(draft.endDate),
  )

  const hasPendingFilters = JSON.stringify(draft) !== JSON.stringify(applied)

  const start = React.useMemo(() => parseLocalDate(applied.startDate), [applied.startDate])
  const endExclusive = React.useMemo(() => {
    const date = parseLocalDate(applied.endDate)
    date.setDate(date.getDate() + 1)
    return date
  }, [applied.endDate])

  const load = React.useCallback(async () => {
    if (!currentUserId) return
    const requestId = ++requestRef.current
    setLoading(true)
    setError(null)
    try {
      const next = await loadHoursReport(supabase, {
        start: start.toISOString(),
        endExclusive: endExclusive.toISOString(),
        projectId: applied.projectId === "all" ? undefined : applied.projectId,
        userId: isAdmin && applied.memberId !== "all" ? applied.memberId : undefined,
      })
      if (requestId === requestRef.current) setSessions(next)
    } catch (cause: any) {
      if (requestId !== requestRef.current) return
      const message = String(cause?.message || "Não foi possível carregar o relatório administrativo.")
      setError(
        /hours_report|schema cache|does not exist/i.test(message)
          ? "Execute a migration 025 para habilitar a apuração segura por período, projeto e usuário."
          : message,
      )
      setSessions([])
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [applied.memberId, applied.projectId, currentUserId, endExclusive, isAdmin, start, supabase])

  React.useEffect(() => {
    void load()
  }, [load])

  const hasRunning = sessions.some((session) => !session.endedAt)
  React.useEffect(() => {
    if (!hasRunning) return
    const sync = () => setNow(Date.now())
    sync()
    const id = window.setInterval(sync, 1000)
    window.addEventListener("focus", sync)
    document.addEventListener("visibilitychange", sync)
    return () => {
      window.clearInterval(id)
      window.removeEventListener("focus", sync)
      document.removeEventListener("visibilitychange", sync)
    }
  }, [hasRunning])

  React.useEffect(() => {
    if (isAdmin) return
    setDraft((current) => current.memberId === "all" ? current : { ...current, memberId: "all" })
    setApplied((current) => current.memberId === "all" ? current : { ...current, memberId: "all" })
  }, [isAdmin])

  React.useEffect(() => {
    setPage(1)
  }, [applied, sortBy, pageSize])

  const memberMap = React.useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  )
  const typeMap = React.useMemo(
    () => new Map(workItemTypes.map((type) => [type.id, type])),
    [workItemTypes],
  )

  const sessionBySub = React.useMemo(() => {
    const map = new Map<string, HoursReportSession[]>()
    for (const session of sessions) {
      const bucket = map.get(session.subactivityId) ?? []
      bucket.push(session)
      map.set(session.subactivityId, bucket)
    }
    return map
  }, [sessions])

  const items = React.useMemo<ReportItem[]>(() => {
    const search = normalize(applied.search)
    const result: ReportItem[] = []

    for (const project of projects) {
      if (applied.projectId !== "all" && project.id !== applied.projectId) continue
      if (applied.priority !== "all" && project.priority !== applied.priority) continue

      for (const activity of project.activities) {
        for (const subactivity of activity.subactivities) {
          if (applied.status !== "all" && subactivity.status !== applied.status) continue
          const typeId = subactivity.typeId || activity.typeId || ""
          if (applied.typeId !== "all" && typeId !== applied.typeId) continue

          const matchingSessions = sessionBySub.get(subactivity.id) ?? []
          const periodSeconds = matchingSessions.reduce(
            (total, session) => total + sessionSeconds(session, start, endExclusive, now),
            0,
          )
          const participantIds = [...new Set(matchingSessions.map((session) => session.userId))]

          if (
            isAdmin
            && applied.memberId !== "all"
            && subactivity.assigneeId !== applied.memberId
            && !participantIds.includes(applied.memberId)
          ) continue

          if (!applied.includeWithoutHours && periodSeconds <= 0) continue

          const assignee = memberMap.get(subactivity.assigneeId)
          const typeName = typeMap.get(typeId)?.name ?? (typeId ? "Tipo não encontrado" : "Sem tipo")
          const assigneeName = assignee?.name ?? "Sem responsável"

          if (search) {
            const haystack = normalize([
              project.name,
              project.client,
              activity.title,
              subactivity.title,
              assigneeName,
              typeName,
              statusMeta[subactivity.status].label,
            ].join(" "))
            if (!haystack.includes(search)) continue
          }

          result.push({
            projectId: project.id,
            projectName: project.name,
            client: project.client,
            priority: project.priority,
            activityId: activity.id,
            activityTitle: activity.title,
            subactivityId: subactivity.id,
            subactivityTitle: subactivity.title,
            status: subactivity.status,
            assigneeId: subactivity.assigneeId,
            assigneeName,
            typeId,
            typeName,
            estimatedHours: Number(subactivity.estimatedHours || 0),
            trackedSeconds: Math.max(0, Number(subactivity.trackedSeconds || 0)),
            periodSeconds,
            sessions: matchingSessions.length,
            createdAt: subactivity.createdAt,
            participantIds,
          })
        }
      }
    }

    return result.sort((a, b) => {
      if (sortBy === "tracked") return b.trackedSeconds - a.trackedSeconds
      if (sortBy === "estimate") return b.estimatedHours - a.estimatedHours
      if (sortBy === "project") return a.projectName.localeCompare(b.projectName, "pt-BR")
      if (sortBy === "status") return statusMeta[a.status].label.localeCompare(statusMeta[b.status].label, "pt-BR")
      return b.periodSeconds - a.periodSeconds
    })
  }, [applied, endExclusive, isAdmin, memberMap, now, projects, sessionBySub, sortBy, start, typeMap])

  const filteredSubIds = React.useMemo(() => new Set(items.map((item) => item.subactivityId)), [items])

  const filteredSessions = React.useMemo(() => (
    sessions.filter((session) => filteredSubIds.has(session.subactivityId))
  ), [filteredSubIds, sessions])

  const totalPeriodSeconds = items.reduce((sum, item) => sum + item.periodSeconds, 0)
  const totalTrackedSeconds = items.reduce((sum, item) => sum + item.trackedSeconds, 0)
  const totalEstimatedSeconds = items.reduce((sum, item) => sum + item.estimatedHours * 3600, 0)
  const completed = items.filter((item) => item.status === "done").length
  const activeProjectCount = new Set(items.map((item) => item.projectId)).size
  const contributorCount = new Set(filteredSessions.map((session) => session.userId)).size
  const sessionCount = filteredSessions.length
  const averageSession = sessionCount > 0 ? Math.round(totalPeriodSeconds / sessionCount) : 0
  const completionRate = percentage(completed, items.length)
  const estimateConsumption = percentage(totalTrackedSeconds, totalEstimatedSeconds)

  const statusSummary = React.useMemo(() => (
    allStatuses.map((status) => {
      const rows = items.filter((item) => item.status === status)
      return {
        status,
        count: rows.length,
        seconds: rows.reduce((sum, row) => sum + row.periodSeconds, 0),
      }
    }).filter((row) => row.count > 0)
  ), [items])

  const projectRanking = React.useMemo<RankingRow[]>(() => {
    const grouped = new Map<string, RankingRow>()
    for (const item of items) {
      const current = grouped.get(item.projectId) ?? {
        id: item.projectId,
        label: item.projectName,
        secondary: item.client,
        seconds: 0,
        estimatedSeconds: 0,
        count: 0,
      }
      current.seconds += item.periodSeconds
      current.estimatedSeconds = (current.estimatedSeconds ?? 0) + item.estimatedHours * 3600
      current.count = (current.count ?? 0) + 1
      grouped.set(item.projectId, current)
    }
    return [...grouped.values()].sort((a, b) => b.seconds - a.seconds)
  }, [items])

  const userRanking = React.useMemo<RankingRow[]>(() => {
    const grouped = new Map<string, RankingRow>()
    for (const session of filteredSessions) {
      const seconds = sessionSeconds(session, start, endExclusive, now)
      const member = memberMap.get(session.userId)
      const current = grouped.get(session.userId) ?? {
        id: session.userId,
        label: member?.name ?? "Usuário não encontrado",
        secondary: member?.role ?? "membro",
        seconds: 0,
        count: 0,
      }
      current.seconds += seconds
      current.count = (current.count ?? 0) + 1
      grouped.set(session.userId, current)
    }
    return [...grouped.values()].sort((a, b) => b.seconds - a.seconds)
  }, [endExclusive, filteredSessions, memberMap, now, start])

  const chartData = projectRanking.slice(0, 8).map((row) => ({
    name: row.label,
    client: row.secondary ?? "",
    registrado: Number(decimalHours(row.seconds).toFixed(2)),
    estimado: Number(decimalHours(row.estimatedSeconds ?? 0).toFixed(2)),
    consumo: percentage(row.seconds, row.estimatedSeconds ?? 0),
  }))

  const ganttDays = React.useMemo(() => {
    const result: Date[] = []
    const cursor = new Date(start)
    while (cursor < endExclusive && result.length <= 366) {
      result.push(new Date(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    return result
  }, [endExclusive, start])

  const ganttTooWide = ganttDays.length > 366
  const visibleGanttDays = ganttTooWide ? ganttDays.slice(0, 366) : ganttDays

  const ganttRows = React.useMemo(() => {
    if (ganttTooWide) return []
    return items.map((item) => {
      const daily = new Map<string, number>()
      for (const session of sessionBySub.get(item.subactivityId) ?? []) {
        for (const [key, seconds] of splitSessionAcrossDays(session, start, endExclusive, now)) {
          daily.set(key, (daily.get(key) ?? 0) + seconds)
        }
      }
      const activeIndexes = visibleGanttDays
        .map((date, index) => daily.get(dayKey(date)) ? index : -1)
        .filter((index) => index >= 0)
      return {
        item,
        daily,
        firstIndex: activeIndexes.length ? activeIndexes[0] : -1,
        lastIndex: activeIndexes.length ? activeIndexes[activeIndexes.length - 1] : -1,
      }
    }).filter((row) => applied.includeWithoutHours || row.firstIndex >= 0)
  }, [applied.includeWithoutHours, endExclusive, ganttTooWide, items, now, sessionBySub, start, visibleGanttDays])

  const summaryCards = [
    {
      label: "Horas no período",
      value: formatServiceHours(totalPeriodSeconds),
      hint: `${sessionCount} ${sessionCount === 1 ? "sessão" : "sessões"}`,
      icon: Clock3,
      className: "bg-primary/12 text-primary",
    },
    {
      label: "Estimativa do escopo",
      value: formatServiceHours(totalEstimatedSeconds),
      hint: `${items.length} ${items.length === 1 ? "subatividade" : "subatividades"}`,
      icon: Gauge,
      className: "bg-chart-4/12 text-chart-4",
    },
    {
      label: "Consumo da estimativa",
      value: `${estimateConsumption}%`,
      hint: `${formatServiceHours(totalTrackedSeconds)} acumuladas`,
      icon: SlidersHorizontal,
      className: estimateConsumption > 100 ? "bg-destructive/10 text-destructive" : "bg-success/12 text-success",
    },
    {
      label: "Conclusão",
      value: `${completionRate}%`,
      hint: `${completed} concluídas no escopo`,
      icon: CheckCircle2,
      className: "bg-success/12 text-success",
    },
    {
      label: "Projetos",
      value: String(activeProjectCount),
      hint: `${contributorCount} ${contributorCount === 1 ? "colaborador" : "colaboradores"}`,
      icon: FolderKanban,
      className: "bg-chart-2/12 text-chart-2",
    },
    {
      label: "Média por sessão",
      value: formatServiceHours(averageSession),
      hint: isAdmin ? "média da equipe filtrada" : "média dos seus registros",
      icon: Users,
      className: "bg-muted text-foreground",
    },
  ]

  const pageCount = pageSize === "all" ? 1 : Math.max(1, Math.ceil(items.length / Number(pageSize)))
  const safePage = Math.min(page, pageCount)
  const pagedItems = pageSize === "all"
    ? items
    : items.slice((safePage - 1) * Number(pageSize), safePage * Number(pageSize))

  const selectableMembers = React.useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [members],
  )
  const selectableProjects = React.useMemo(
    () => [...projects].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [projects],
  )
  const selectableTypes = React.useMemo(
    () => [...workItemTypes].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [workItemTypes],
  )

  const activeFilterCount = React.useMemo(() => {
    let count = 0
    if (applied.startDate !== initialFilters.startDate || applied.endDate !== initialFilters.endDate) count += 1
    if (applied.projectId !== "all") count += 1
    if (isAdmin && applied.memberId !== "all") count += 1
    if (applied.typeId !== "all") count += 1
    if (applied.status !== "all") count += 1
    if (applied.priority !== "all") count += 1
    if (applied.search) count += 1
    if (applied.includeWithoutHours) count += 1
    return count
  }, [applied, initialFilters.endDate, initialFilters.startDate, isAdmin])

  const applyPreset = (next: PeriodPreset) => {
    setPreset(next)
    if (next === "custom") return
    const range = rangeForPreset(next)
    setDraft((current) => ({ ...current, startDate: range.start, endDate: range.end }))
  }

  const applyFilters = () => {
    if (!rangeValid) return
    setApplied({
      ...draft,
      memberId: isAdmin ? draft.memberId : "all",
      search: draft.search.trim(),
    })
    setFiltersOpen(false)
  }

  const resetDraftFilters = () => {
    setPreset("month")
    setDraft(initialFilters)
  }

  const openFilters = () => {
    setDraft(applied)
    setFiltersOpen(true)
  }

  const filterSummary = React.useMemo(() => {
    const labels = [periodLabel(applied.startDate, applied.endDate)]
    if (applied.projectId !== "all") labels.push(selectableProjects.find((p) => p.id === applied.projectId)?.name ?? "Projeto filtrado")
    if (isAdmin && applied.memberId !== "all") labels.push(selectableMembers.find((m) => m.id === applied.memberId)?.name ?? "Usuário filtrado")
    if (applied.typeId !== "all") labels.push(selectableTypes.find((t) => t.id === applied.typeId)?.name ?? "Tipo filtrado")
    if (applied.status !== "all") labels.push(statusMeta[applied.status as Status]?.label ?? "Status filtrado")
    if (applied.priority !== "all") labels.push(`Prioridade ${priorityLabel(applied.priority as Priority)}`)
    if (applied.search) labels.push(`Busca: ${applied.search}`)
    if (applied.includeWithoutHours) labels.push("Inclui itens sem horas")
    return labels
  }, [applied, isAdmin, selectableMembers, selectableProjects, selectableTypes])

  const exportExcel = () => {
    const summaryRows = [
      excelRow([excelCell("DEVBOARD — RELATÓRIO GERENCIAL", "String", "Title")]),
      excelRow([excelCell("Período"), excelCell(periodLabel(applied.startDate, applied.endDate))]),
      excelRow([excelCell("Filtros"), excelCell(filterSummary.join(" | "))]),
      excelRow([excelCell("Emitido em"), excelCell(new Date().toLocaleString("pt-BR"))]),
      excelRow([]),
      excelRow([excelCell("Indicador", "String", "Header"), excelCell("Valor", "String", "Header")]),
      excelRow([excelCell("Horas no período"), excelCell(decimalHours(totalPeriodSeconds), "Number", "Decimal")]),
      excelRow([excelCell("Horas estimadas"), excelCell(decimalHours(totalEstimatedSeconds), "Number", "Decimal")]),
      excelRow([excelCell("Horas acumuladas"), excelCell(decimalHours(totalTrackedSeconds), "Number", "Decimal")]),
      excelRow([excelCell("Consumo da estimativa (%)"), excelCell(estimateConsumption, "Number")]),
      excelRow([excelCell("Conclusão (%)"), excelCell(completionRate, "Number")]),
      excelRow([excelCell("Projetos"), excelCell(activeProjectCount, "Number")]),
      excelRow([excelCell("Colaboradores"), excelCell(contributorCount, "Number")]),
      excelRow([excelCell("Sessões"), excelCell(sessionCount, "Number")]),
      excelRow([excelCell("Média por sessão (h)"), excelCell(decimalHours(averageSession), "Number", "Decimal")]),
    ]

    const detailRows = [
      excelRow([
        "Projeto", "Cliente", "Prioridade", "Atividade", "Subatividade", "Tipo", "Responsável atual", "Status",
        "Estimativa (h)", "Horas período", "Horas acumuladas", "Consumo estimativa (%)", "Sessões",
      ].map((value) => excelCell(value, "String", "Header"))),
      ...items.map((item) => excelRow([
        excelCell(item.projectName),
        excelCell(item.client),
        excelCell(priorityLabel(item.priority)),
        excelCell(item.activityTitle),
        excelCell(item.subactivityTitle),
        excelCell(item.typeName),
        excelCell(item.assigneeName),
        excelCell(statusMeta[item.status].label),
        excelCell(item.estimatedHours, "Number", "Decimal"),
        excelCell(decimalHours(item.periodSeconds), "Number", "Decimal"),
        excelCell(decimalHours(item.trackedSeconds), "Number", "Decimal"),
        excelCell(percentage(item.trackedSeconds, item.estimatedHours * 3600), "Number"),
        excelCell(item.sessions, "Number"),
      ])),
    ]

    const projectRows = [
      excelRow(["Projeto", "Cliente", "Horas período", "Estimativa (h)", "Itens"].map((value) => excelCell(value, "String", "Header"))),
      ...projectRanking.map((row) => excelRow([
        excelCell(row.label),
        excelCell(row.secondary ?? ""),
        excelCell(decimalHours(row.seconds), "Number", "Decimal"),
        excelCell(decimalHours(row.estimatedSeconds ?? 0), "Number", "Decimal"),
        excelCell(row.count ?? 0, "Number"),
      ])),
    ]

    const userRows = [
      excelRow(["Usuário", "Perfil", "Horas período", "Sessões"].map((value) => excelCell(value, "String", "Header"))),
      ...userRanking.map((row) => excelRow([
        excelCell(row.label),
        excelCell(roleLabel(row.secondary ?? "")),
        excelCell(decimalHours(row.seconds), "Number", "Decimal"),
        excelCell(row.count ?? 0, "Number"),
      ])),
    ]

    const statusRows = [
      excelRow(["Status", "Itens", "Horas período"].map((value) => excelCell(value, "String", "Header"))),
      ...statusSummary.map((row) => excelRow([
        excelCell(statusMeta[row.status].label),
        excelCell(row.count, "Number"),
        excelCell(decimalHours(row.seconds), "Number", "Decimal"),
      ])),
    ]

    const ganttExcelSheets = (() => {
      if (ganttTooWide) {
        return `<Worksheet ss:Name="Gantt diário"><Table>${excelRow([excelCell("Gantt diário indisponível para períodos acima de 366 dias.")])}</Table></Worksheet>`
      }

      const groups = new Map<string, Date[]>()
      for (const date of visibleGanttDays) {
        const key = `${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`
        const bucket = groups.get(key) ?? []
        bucket.push(date)
        groups.set(key, bucket)
      }

      if (!groups.size) {
        return `<Worksheet ss:Name="Gantt diário"><Table>${excelRow([excelCell("Sem dados para o período selecionado.")])}</Table></Worksheet>`
      }

      return [...groups.entries()].map(([key, dates]) => {
        const rows = [
          excelRow([
            "Projeto", "Atividade", "Subatividade", "Responsável", "Status",
            ...dates.map((date) => date.toLocaleDateString("pt-BR")),
          ].map((value) => excelCell(value, "String", "Header"))),
          ...ganttRows.map(({ item, daily }) => excelRow([
            excelCell(item.projectName),
            excelCell(item.activityTitle),
            excelCell(item.subactivityTitle),
            excelCell(item.assigneeName),
            excelCell(statusMeta[item.status].label),
            ...dates.map((date) => excelCell(decimalHours(daily.get(dayKey(date)) ?? 0), "Number", "Decimal")),
          ])),
        ]
        return `<Worksheet ss:Name="Gantt ${xmlEscape(key)}"><Table>${rows.join("")}</Table></Worksheet>`
      }).join("")
    })()

    const workbook = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
      `<Styles>` +
      `<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11"/></Style>` +
      `<Style ss:ID="Title"><Font ss:Bold="1" ss:Size="16"/><Interior ss:Color="#EAF2FF" ss:Pattern="Solid"/></Style>` +
      `<Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#E9ECEF" ss:Pattern="Solid"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1"/></Borders></Style>` +
      `<Style ss:ID="Decimal"><NumberFormat ss:Format="0.00"/></Style>` +
      `</Styles>` +
      `<Worksheet ss:Name="Resumo"><Table>${summaryRows.join("")}</Table></Worksheet>` +
      `<Worksheet ss:Name="Detalhes"><Table>${detailRows.join("")}</Table></Worksheet>` +
      `<Worksheet ss:Name="Por projeto"><Table>${projectRows.join("")}</Table></Worksheet>` +
      `<Worksheet ss:Name="Por usuário"><Table>${userRows.join("")}</Table></Worksheet>` +
      `<Worksheet ss:Name="Por status"><Table>${statusRows.join("")}</Table></Worksheet>` +
      ganttExcelSheets +
      `</Workbook>`

    downloadBlob(
      new Blob(["\ufeff", workbook], { type: "application/vnd.ms-excel;charset=utf-8" }),
      `devboard-relatorio-${applied.startDate}-${applied.endDate}.xls`,
    )
  }

  const exportPdf = () => {
    const iframe = document.createElement("iframe")
    iframe.setAttribute("aria-hidden", "true")
    iframe.style.position = "fixed"
    iframe.style.right = "0"
    iframe.style.bottom = "0"
    iframe.style.width = "1px"
    iframe.style.height = "1px"
    iframe.style.border = "0"
    iframe.style.opacity = "0"
    document.body.appendChild(iframe)

    const doc = iframe.contentDocument
    if (!doc) {
      iframe.remove()
      return
    }

    const maxUserSeconds = Math.max(1, ...userRanking.map((row) => row.seconds))
    const detailRows = items.map((item) => `
      <tr>
        <td><strong>${htmlEscape(item.projectName)}</strong><small>${htmlEscape(item.client)}</small></td>
        <td>${htmlEscape(item.activityTitle)}<small>${htmlEscape(item.subactivityTitle)}</small></td>
        <td>${htmlEscape(item.typeName)}</td>
        <td>${htmlEscape(item.assigneeName)}</td>
        <td>${htmlEscape(statusMeta[item.status].label)}</td>
        <td class="num">${htmlEscape(item.estimatedHours.toLocaleString("pt-BR", { maximumFractionDigits: 2 }))}h</td>
        <td class="num">${htmlEscape(formatDecimalHours(item.periodSeconds))}h</td>
        <td class="num">${htmlEscape(formatDecimalHours(item.trackedSeconds))}h</td>
        <td class="num">${percentage(item.trackedSeconds, item.estimatedHours * 3600)}%</td>
      </tr>
    `).join("")

    const statusHtml = statusSummary.map((row) => `
      <div class="status-card">
        <span>${htmlEscape(statusMeta[row.status].label)}</span>
        <strong>${row.count}</strong>
        <small>${htmlEscape(formatServiceHours(row.seconds))}</small>
      </div>
    `).join("")

    const usersHtml = userRanking.slice(0, 10).map((row) => `
      <div class="rank-row">
        <div><strong>${htmlEscape(row.label)}</strong><small>${htmlEscape(roleLabel(row.secondary ?? ""))}</small></div>
        <div class="bar"><span style="width:${rankingWidth(row.seconds, maxUserSeconds)}%"></span></div>
        <strong class="rank-value">${htmlEscape(formatServiceHours(row.seconds))}</strong>
      </div>
    `).join("")

    const projectsHtml = projectRanking.slice(0, 10).map((row) => `
      <tr>
        <td><strong>${htmlEscape(row.label)}</strong><small>${htmlEscape(row.secondary ?? "")}</small></td>
        <td class="num">${htmlEscape(formatDecimalHours(row.seconds))}h</td>
        <td class="num">${htmlEscape(formatDecimalHours(row.estimatedSeconds ?? 0))}h</td>
        <td class="num">${row.count ?? 0}</td>
      </tr>
    `).join("")

    const ganttPrintHtml = (() => {
      if (ganttTooWide) {
        return '<div class="section panel"><h2 class="section-title">Gantt diário</h2><span class="muted">Não incluído porque o período selecionado ultrapassa 366 dias.</span></div>'
      }
      if (!ganttRows.length) return ""

      const groups = new Map<string, Date[]>()
      for (const date of visibleGanttDays) {
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        const bucket = groups.get(key) ?? []
        bucket.push(date)
        groups.set(key, bucket)
      }

      return [...groups.entries()].map(([key, dates], groupIndex) => {
        const label = dates[0]?.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }) ?? key
        const rows = ganttRows.filter(({ daily }) => dates.some((date) => (daily.get(dayKey(date)) ?? 0) > 0))
        if (!rows.length) return ""
        return `
          <div class="gantt-page ${groupIndex > 0 ? "page-break" : ""}">
            <h2 class="section-title">Gantt diário · ${htmlEscape(label)}</h2>
            <table class="gantt-table">
              <thead>
                <tr>
                  <th class="gantt-label">Projeto / atividade / subatividade</th>
                  ${dates.map((date) => `<th class="gantt-day">${String(date.getDate()).padStart(2, "0")}<small>${htmlEscape(date.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3))}</small></th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${rows.map(({ item, daily }) => `
                  <tr>
                    <td class="gantt-label"><strong>${htmlEscape(item.projectName)}</strong><small>${htmlEscape(item.activityTitle)} › ${htmlEscape(item.subactivityTitle)}</small></td>
                    ${dates.map((date) => {
                      const seconds = daily.get(dayKey(date)) ?? 0
                      return `<td class="gantt-cell ${seconds > 0 ? "active" : ""}">${seconds > 0 ? htmlEscape(decimalHours(seconds).toLocaleString("pt-BR", { maximumFractionDigits: 1 })) : ""}</td>`
                    }).join("")}
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
      }).join("")
    })()

    const printHtml = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Devboard — Relatório Gerencial</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #171717; font-family: Arial, Helvetica, sans-serif; font-size: 9px; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding-bottom: 8px; border-bottom: 2px solid #171717; }
  .brand { font-size: 10px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
  h1 { margin: 4px 0 2px; font-size: 20px; }
  .muted { color: #666; }
  .meta { text-align: right; line-height: 1.55; }
  .filter-line { margin-top: 7px; padding: 6px 8px; background: #f4f4f4; border: 1px solid #ddd; border-radius: 5px; }
  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 5px; margin: 8px 0; }
  .kpi { border: 1px solid #d9d9d9; border-radius: 6px; padding: 7px; min-height: 50px; }
  .kpi span { display: block; color: #666; font-size: 7px; text-transform: uppercase; letter-spacing: .08em; }
  .kpi strong { display: block; margin-top: 4px; font-size: 15px; }
  .kpi small { display: block; margin-top: 2px; color: #777; }
  .section { margin-top: 8px; break-inside: avoid; }
  .section-title { margin: 0 0 5px; font-size: 11px; }
  .two-col { display: grid; grid-template-columns: 1.1fr .9fr; gap: 8px; }
  .panel { border: 1px solid #ddd; border-radius: 6px; padding: 7px; }
  .status-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .status-card { border: 1px solid #e0e0e0; border-radius: 5px; padding: 5px; }
  .status-card span, .status-card small { display: block; color: #666; }
  .status-card strong { display: block; margin: 2px 0; font-size: 12px; }
  .rank-row { display: grid; grid-template-columns: 125px 1fr 60px; align-items: center; gap: 6px; margin: 4px 0; }
  .rank-row strong, .rank-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-row small { color: #777; font-size: 7px; }
  .bar { height: 6px; background: #eee; border-radius: 99px; overflow: hidden; }
  .bar span { display: block; height: 100%; background: #333; }
  .rank-value { text-align: right; font-size: 8px; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th { background: #efefef; color: #444; font-size: 7px; text-transform: uppercase; letter-spacing: .04em; text-align: left; border: 1px solid #d8d8d8; padding: 4px; }
  td { border: 1px solid #e0e0e0; padding: 4px; vertical-align: top; word-break: break-word; }
  td small { display: block; margin-top: 2px; color: #777; font-size: 7px; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr { break-inside: avoid; }
  .detail-table th:nth-child(1) { width: 12%; }
  .detail-table th:nth-child(2) { width: 20%; }
  .detail-table th:nth-child(3) { width: 9%; }
  .detail-table th:nth-child(4) { width: 11%; }
  .detail-table th:nth-child(5) { width: 9%; }
  .detail-table th:nth-child(6), .detail-table th:nth-child(7), .detail-table th:nth-child(8), .detail-table th:nth-child(9) { width: 9.75%; }
  .gantt-page { margin-top: 10px; break-before: page; page-break-before: always; }
  .gantt-page:first-of-type { break-before: auto; }
  .page-break { break-before: page; }
  .gantt-table { table-layout: fixed; font-size: 6px; }
  .gantt-table th, .gantt-table td { padding: 2px 1px; text-align: center; }
  .gantt-table .gantt-label { width: 28%; text-align: left; padding-left: 4px; }
  .gantt-table .gantt-label strong, .gantt-table .gantt-label small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gantt-table .gantt-day { font-size: 6px; }
  .gantt-table .gantt-day small { display: block; margin-top: 1px; color: #777; font-size: 5px; }
  .gantt-cell.active { background: #222; color: #fff; font-weight: 700; }
  footer { margin-top: 8px; padding-top: 5px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; color: #777; font-size: 7px; }
</style>
</head>
<body>
<header>
  <div>
    <div class="brand">Devboard</div>
    <h1>Relatório gerencial</h1>
    <div class="muted">Controle administrativo de projetos, atividades, subatividades e horas.</div>
  </div>
  <div class="meta">
    <strong>${htmlEscape(periodLabel(applied.startDate, applied.endDate))}</strong><br />
    Emitido em ${htmlEscape(new Date().toLocaleString("pt-BR"))}<br />
    ${isAdmin ? "Visão administrativa completa" : "Visão pessoal"}
  </div>
</header>
<div class="filter-line"><strong>Filtros:</strong> ${htmlEscape(filterSummary.join(" · "))}</div>
<div class="kpis">
  ${summaryCards.map((card) => `<div class="kpi"><span>${htmlEscape(card.label)}</span><strong>${htmlEscape(card.value)}</strong><small>${htmlEscape(card.hint)}</small></div>`).join("")}
</div>
<div class="two-col section">
  <div class="panel">
    <h2 class="section-title">Distribuição por status</h2>
    <div class="status-grid">${statusHtml || '<span class="muted">Sem dados no período.</span>'}</div>
  </div>
  <div class="panel">
    <h2 class="section-title">Horas por colaborador</h2>
    ${usersHtml || '<span class="muted">Sem apontamentos no período.</span>'}
  </div>
</div>
<div class="section">
  <h2 class="section-title">Resumo por projeto</h2>
  <table>
    <thead><tr><th>Projeto</th><th class="num">Horas período</th><th class="num">Estimativa</th><th class="num">Itens</th></tr></thead>
    <tbody>${projectsHtml || '<tr><td colspan="4">Sem dados no período.</td></tr>'}</tbody>
  </table>
</div>
${ganttPrintHtml}
<div class="section">
  <h2 class="section-title">Detalhamento do escopo filtrado (${items.length} itens)</h2>
  <table class="detail-table">
    <thead><tr><th>Projeto</th><th>Atividade / Subatividade</th><th>Tipo</th><th>Responsável</th><th>Status</th><th class="num">Estimativa</th><th class="num">Período</th><th class="num">Acumulado</th><th class="num">Consumo</th></tr></thead>
    <tbody>${detailRows || '<tr><td colspan="9">Sem dados para os filtros selecionados.</td></tr>'}</tbody>
  </table>
</div>
<footer><span>DEVBOARD · Relatório administrativo</span><span>Documento gerado conforme os filtros aplicados no sistema.</span></footer>
</body>
</html>`

    doc.open()
    doc.write(printHtml)
    doc.close()

    const doPrint = () => {
      const printWindow = iframe.contentWindow
      if (!printWindow) {
        iframe.remove()
        return
      }
      printWindow.focus()
      printWindow.addEventListener("afterprint", () => iframe.remove(), { once: true })
      printWindow.print()
      window.setTimeout(() => {
        if (document.body.contains(iframe)) iframe.remove()
      }, 60000)
    }
    window.setTimeout(doPrint, 250)
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center lg:justify-between lg:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
              <Filter className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold">Central de relatórios</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6rem] font-semibold text-muted-foreground">
                  ADMIN · CONTROLE TOTAL
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Visão gerencial de projetos, equipe, produtividade, estimativas e execução.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" onClick={openFilters}>
              <SlidersHorizontal className="size-4" />
              Filtros
              {activeFilterCount > 0 ? (
                <span className="ml-0.5 rounded-full bg-primary px-1.5 py-0.5 text-[0.6rem] font-bold leading-none text-primary-foreground">
                  {activeFilterCount}
                </span>
              ) : null}
            </Button>
            <Button variant="outline" onClick={exportExcel} disabled={loading || items.length === 0}>
              <FileSpreadsheet className="size-4" />
              Excel
            </Button>
            <Button onClick={exportPdf} disabled={loading || items.length === 0}>
              <FileText className="size-4" />
              PDF · A4
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 border-t border-border bg-muted/10 px-4 py-2 lg:px-5">
          <span className="shrink-0 text-[0.65rem] font-semibold text-muted-foreground">Recorte</span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filterSummary.map((label, index) => (
              <span
                key={label}
                className={cn(
                  "shrink-0 rounded-full px-2.5 py-1 text-[0.64rem] font-medium ring-1 ring-foreground/8",
                  index === 0 ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground",
                )}
              >
                {label}
              </span>
            ))}
          </div>
          {loading ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
        </div>
      </section>

      <Dialog
        open={filtersOpen}
        onOpenChange={(open) => {
          if (!open) setDraft(applied)
          setFiltersOpen(open)
        }}
      >
        <DialogContent className="max-h-[min(92vh,780px)] max-w-[calc(100%-1.5rem)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-border px-5 py-4 pr-14">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <SlidersHorizontal className="size-4" />
              </span>
              <div>
                <DialogTitle>Filtros do relatório</DialogTitle>
                <DialogDescription className="mt-1 text-xs">
                  Monte o recorte administrativo sem ocupar espaço na tela principal.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto px-5 py-4">
            <div className="grid gap-4">
              <section className="rounded-xl border border-border bg-muted/10 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-semibold">Período</h3>
                    <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Defina o intervalo usado em todos os indicadores e exportações.</p>
                  </div>
                  <CalendarRange className="size-4 text-muted-foreground" />
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <FilterField label="Período rápido">
                    <select
                      value={preset}
                      onChange={(event) => applyPreset(event.target.value as PeriodPreset)}
                      className={cn(selectClassName, "h-10")}
                    >
                      <option value="today">Hoje</option>
                      <option value="last7">Últimos 7 dias</option>
                      <option value="last30">Últimos 30 dias</option>
                      <option value="month">Este mês</option>
                      <option value="previousMonth">Mês anterior</option>
                      <option value="quarter">Este trimestre</option>
                      <option value="year">Este ano</option>
                      <option value="custom">Personalizado</option>
                    </select>
                  </FilterField>
                  <FilterField label="Data inicial">
                    <Input
                      type="date"
                      value={draft.startDate}
                      onChange={(event) => {
                        setPreset("custom")
                        setDraft((current) => ({ ...current, startDate: event.target.value }))
                      }}
                      className="h-10"
                    />
                  </FilterField>
                  <FilterField label="Data final">
                    <Input
                      type="date"
                      value={draft.endDate}
                      onChange={(event) => {
                        setPreset("custom")
                        setDraft((current) => ({ ...current, endDate: event.target.value }))
                      }}
                      className="h-10"
                    />
                  </FilterField>
                </div>
              </section>

              <section className="rounded-xl border border-border bg-muted/10 p-4">
                <div className="mb-3">
                  <h3 className="text-xs font-semibold">Escopo operacional</h3>
                  <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Cruze projeto, responsável, tipo, situação e prioridade.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <FilterField label="Projeto">
                    <select
                      value={draft.projectId}
                      onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}
                      className={cn(selectClassName, "h-10")}
                    >
                      <option value="all">Todos os projetos</option>
                      {selectableProjects.map((project) => (
                        <option key={project.id} value={project.id}>{project.name}</option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField label="Usuário">
                    <select
                      value={draft.memberId}
                      onChange={(event) => setDraft((current) => ({ ...current, memberId: event.target.value }))}
                      className={cn(selectClassName, "h-10")}
                    >
                      <option value="all">Todos os usuários</option>
                      {selectableMembers.map((member) => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField label="Tipo de atividade">
                    <select
                      value={draft.typeId}
                      onChange={(event) => setDraft((current) => ({ ...current, typeId: event.target.value }))}
                      className={cn(selectClassName, "h-10")}
                    >
                      <option value="all">Todos os tipos</option>
                      {selectableTypes.map((type) => (
                        <option key={type.id} value={type.id}>{type.name}{type.active ? "" : " (inativo)"}</option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField label="Status">
                    <select
                      value={draft.status}
                      onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}
                      className={cn(selectClassName, "h-10")}
                    >
                      <option value="all">Todos os status</option>
                      {allStatuses.map((status) => (
                        <option key={status} value={status}>{statusMeta[status].label}</option>
                      ))}
                    </select>
                  </FilterField>

                  <FilterField label="Prioridade do projeto">
                    <select
                      value={draft.priority}
                      onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}
                      className={cn(selectClassName, "h-10")}
                    >
                      <option value="all">Todas as prioridades</option>
                      <option value="high">Alta</option>
                      <option value="medium">Média</option>
                      <option value="low">Baixa</option>
                    </select>
                  </FilterField>

                  <FilterField label="Buscar">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={draft.search}
                        onChange={(event) => setDraft((current) => ({ ...current, search: event.target.value }))}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && rangeValid) applyFilters()
                        }}
                        placeholder="Projeto, atividade, responsável..."
                        className="h-10 pl-8"
                      />
                    </div>
                  </FilterField>
                </div>

                <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background px-3.5 py-3 transition-colors hover:bg-muted/30">
                  <input
                    type="checkbox"
                    checked={draft.includeWithoutHours}
                    onChange={(event) => setDraft((current) => ({ ...current, includeWithoutHours: event.target.checked }))}
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block text-xs font-semibold">Incluir itens sem horas registradas</span>
                    <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">Útil para auditoria de escopo, pendências e atividades ainda sem apontamento.</span>
                  </span>
                </label>
              </section>

              {!rangeValid ? (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3.5 py-3 text-xs font-medium text-destructive">
                  A data inicial precisa ser anterior ou igual à data final.
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={resetDraftFilters}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
              Restaurar padrão
            </button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFiltersOpen(false)}>Cancelar</Button>
              <Button onClick={applyFilters} disabled={!rangeValid || !hasPendingFilters}>
                <Filter className="size-4" />
                Aplicar filtros
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {error ? (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((card) => (
          <div key={card.label} className="flex min-w-0 items-center gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/8">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", card.className)}>
              <card.icon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <p className="truncate font-mono text-[0.58rem] tracking-widest text-muted-foreground uppercase">{card.label}</p>
              <p className="mt-1 truncate text-xl font-bold tabular-nums tracking-tight">{loading ? "—" : card.value}</p>
              <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">{card.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,.85fr)]">
        <section className="min-w-0 rounded-2xl bg-card ring-1 ring-foreground/8">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start sm:justify-between lg:p-5">
            <div>
              <h2 className="text-sm font-semibold">Horas por projeto</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Comparação clara entre horas registradas no período e estimativa do escopo.</p>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-[0.65rem] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />No período</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/30" />Estimado</span>
              {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            </div>
          </div>
          <div className="p-3 lg:p-4" style={{ height: chartData.length ? Math.max(300, chartData.length * 46 + 42) : 320 }}>
            {chartData.length === 0 ? (
              <EmptyReportState />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 4, bottom: 8 }}
                  barGap={3}
                >
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="4 4" />
                  <XAxis
                    type="number"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                    tickFormatter={(value) => `${value}h`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    width={138}
                    tick={{ fill: "var(--foreground)", fontSize: 10, fontWeight: 600 }}
                    tickFormatter={(value) => String(value).length > 20 ? `${String(value).slice(0, 19)}…` : String(value)}
                  />
                  <Tooltip content={<ReportChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.45 }} />
                  <Bar dataKey="estimado" name="Estimado" fill="var(--muted-foreground)" fillOpacity={0.2} radius={[0, 6, 6, 0]} barSize={8} />
                  <Bar dataKey="registrado" name="No período" fill="var(--primary)" radius={[0, 6, 6, 0]} barSize={8} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          {chartData.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/10 px-4 py-2.5 text-[0.65rem] text-muted-foreground lg:px-5">
              <span>Exibindo os {chartData.length} projetos com maior carga no período.</span>
              <strong className="font-mono font-medium tabular-nums text-foreground">{formatServiceHours(totalPeriodSeconds)} registradas</strong>
            </div>
          ) : null}
        </section>

        <section className="min-w-0 rounded-2xl bg-card ring-1 ring-foreground/8">
          <div className="border-b border-border p-4 lg:p-5">
            <h2 className="text-sm font-semibold">Carga por colaborador</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Horas efetivamente registradas no período filtrado.</p>
          </div>
          <div className="flex max-h-80 flex-col gap-4 overflow-y-auto p-4 lg:p-5">
            {userRanking.length === 0 ? (
              <EmptyReportState compact />
            ) : userRanking.slice(0, 12).map((row) => {
              const member = memberMap.get(row.id)
              const maxSeconds = Math.max(1, userRanking[0]?.seconds ?? 1)
              return (
                <div key={row.id} className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <MemberAvatar member={member} className="size-7 shrink-0 rounded-lg text-[0.62rem] ring-0" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{row.label}</p>
                        <p className="truncate text-[0.65rem] text-muted-foreground">{row.count} {row.count === 1 ? "sessão" : "sessões"}</p>
                      </div>
                    </div>
                    <strong className="shrink-0 font-mono text-xs tabular-nums">{formatServiceHours(row.seconds)}</strong>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${rankingWidth(row.seconds, maxSeconds)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-start md:justify-between lg:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CalendarRange className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Gantt diário de execução</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">Projeto → atividade → subatividade por dia, usando os apontamentos reais do período.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3 text-[0.65rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-6 rounded-full bg-primary/15" />Janela de execução</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded bg-primary/80" />Dia com horas</span>
          </div>
        </div>

        {ganttTooWide ? (
          <div className="flex min-h-40 flex-col items-center justify-center px-5 py-10 text-center">
            <CalendarRange className="size-5 text-muted-foreground/50" />
            <p className="mt-2 text-xs font-semibold">Período muito amplo para o Gantt diário</p>
            <p className="mt-1 max-w-md text-[0.68rem] text-muted-foreground">Use um recorte de até 366 dias. Os demais indicadores e exportações continuam funcionando normalmente.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={openFilters}>Ajustar período</Button>
          </div>
        ) : ganttRows.length === 0 ? (
          <div className="py-8"><EmptyReportState /></div>
        ) : (
          <div className="max-h-[36rem] overflow-auto">
            <div style={{ minWidth: `${320 + visibleGanttDays.length * 30}px` }}>
              <div className="sticky top-0 z-30 flex border-b border-border bg-card shadow-[0_1px_0_var(--border)]">
                <div className="sticky left-0 z-40 flex w-80 shrink-0 items-center border-r border-border bg-card px-4 py-2.5 lg:px-5">
                  <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-muted-foreground uppercase">Escopo</span>
                </div>
                <div className="flex">
                  {visibleGanttDays.map((date) => {
                    const weekend = date.getDay() === 0 || date.getDay() === 6
                    const today = dayKey(date) === dayKey(new Date())
                    return (
                      <div
                        key={dayKey(date)}
                        className={cn(
                          "flex w-[30px] shrink-0 flex-col items-center justify-center border-r border-border py-1.5 text-center",
                          weekend && "bg-muted/25",
                          today && "bg-primary/10",
                        )}
                        title={date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
                      >
                        <span className={cn("text-[0.58rem] font-semibold tabular-nums", today ? "text-primary" : "text-foreground")}>{String(date.getDate()).padStart(2, "0")}</span>
                        <span className="text-[0.5rem] uppercase text-muted-foreground">{date.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {ganttRows.map(({ item, daily, firstIndex, lastIndex }) => {
                const member = memberMap.get(item.assigneeId)
                const maxDaySeconds = Math.max(1, ...daily.values())
                return (
                  <div key={item.subactivityId} className="flex min-h-[58px] border-b border-border last:border-b-0 hover:bg-muted/10">
                    <div className="sticky left-0 z-20 flex w-80 shrink-0 items-center gap-2.5 border-r border-border bg-card px-4 py-2 lg:px-5">
                      <MemberAvatar member={member} className="size-7 shrink-0 rounded-lg text-[0.58rem] ring-0" />
                      <div className="min-w-0">
                        <p className="truncate text-[0.62rem] font-medium text-muted-foreground" title={item.projectName}>{item.projectName}</p>
                        <Link
                          href={`/projetos/${item.projectId}#activity-${item.activityId}`}
                          className="block truncate text-[0.68rem] font-semibold text-foreground hover:text-primary hover:underline"
                          title={`Abrir ${item.activityTitle}`}
                        >
                          {item.activityTitle}
                        </Link>
                        <p className="truncate text-[0.62rem] text-muted-foreground" title={item.subactivityTitle}>{item.subactivityTitle}</p>
                      </div>
                    </div>

                    <div
                      className="relative h-[58px] shrink-0"
                      style={{
                        width: `${visibleGanttDays.length * 30}px`,
                        backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent 29px, var(--border) 29px, var(--border) 30px)",
                      }}
                    >
                      {visibleGanttDays.map((date, index) => (date.getDay() === 0 || date.getDay() === 6) ? (
                        <span
                          key={`weekend-${dayKey(date)}`}
                          className="pointer-events-none absolute inset-y-0 bg-muted/15"
                          style={{ left: `${index * 30}px`, width: "30px" }}
                        />
                      ) : null)}

                      {firstIndex >= 0 ? (
                        <span
                          className="pointer-events-none absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary/12"
                          style={{
                            left: `${firstIndex * 30 + 4}px`,
                            width: `${Math.max(22, (lastIndex - firstIndex + 1) * 30 - 8)}px`,
                          }}
                        />
                      ) : null}

                      {visibleGanttDays.map((date, index) => {
                        const seconds = daily.get(dayKey(date)) ?? 0
                        if (seconds <= 0) return null
                        const strength = Math.max(0.45, Math.min(1, seconds / maxDaySeconds))
                        return (
                          <span
                            key={`work-${dayKey(date)}`}
                            className="absolute top-1/2 h-5 -translate-y-1/2 rounded-md bg-primary shadow-sm ring-1 ring-primary/20"
                            style={{ left: `${index * 30 + 4}px`, width: "22px", opacity: strength }}
                            title={`${date.toLocaleDateString("pt-BR")} · ${formatServiceHours(seconds)}`}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/10 px-4 py-2.5 text-[0.65rem] text-muted-foreground lg:px-5">
          <span>{ganttTooWide ? "Gantt diário limitado a recortes de até 366 dias." : `${ganttRows.length} ${ganttRows.length === 1 ? "subatividade" : "subatividades"} no recorte diário`}</span>
          <span>{ganttTooWide ? "Os demais dados não foram limitados." : "Quanto mais sólido o bloco, maior a carga daquele dia."}</span>
        </div>
      </section>

      <section className="rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
          <div>
            <h2 className="text-sm font-semibold">Distribuição operacional</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Quantidade de itens e horas registradas por situação atual.</p>
          </div>
          <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "item analisado" : "itens analisados"}</span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 lg:p-5">
          {statusSummary.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-4 xl:col-span-7"><EmptyReportState compact /></div>
          ) : statusSummary.map((row) => {
            const meta = statusMeta[row.status]
            return (
              <div key={row.status} className="rounded-xl border border-border bg-background/40 p-3">
                <div className="flex items-center gap-2">
                  <span className={cn("size-2 rounded-full", meta.dot)} />
                  <span className="truncate text-xs font-semibold">{meta.label}</span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <strong className="text-xl font-bold tabular-nums">{row.count}</strong>
                  <span className="font-mono text-[0.68rem] tabular-nums text-muted-foreground">{formatServiceHours(row.seconds)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between lg:p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Detalhamento administrativo</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Projeto → atividade → subatividade, com responsável, tipo, status, estimativa e consumo de horas.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-[0.68rem] text-muted-foreground">
              Ordenar
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none">
                <option value="period">Mais horas no período</option>
                <option value="tracked">Mais horas acumuladas</option>
                <option value="estimate">Maior estimativa</option>
                <option value="project">Projeto A–Z</option>
                <option value="status">Status</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-[0.68rem] text-muted-foreground">
              Linhas
              <select value={pageSize} onChange={(event) => setPageSize(event.target.value as PageSize)} className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none">
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="all">Todas</option>
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-5 py-16 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Consolidando relatório...
          </div>
        ) : items.length === 0 ? (
          <div className="py-12"><EmptyReportState /></div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/20 font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase">
                    <th className="px-4 py-3 font-medium lg:px-5">Projeto</th>
                    <th className="px-4 py-3 font-medium">Atividade / Subatividade</th>
                    <th className="px-4 py-3 font-medium">Tipo</th>
                    <th className="px-4 py-3 font-medium">Responsável</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 text-right font-medium">Estimativa</th>
                    <th className="px-4 py-3 text-right font-medium">No período</th>
                    <th className="px-4 py-3 text-right font-medium">Acumulado</th>
                    <th className="px-4 py-3 text-right font-medium">Consumo</th>
                    <th className="px-4 py-3 text-right font-medium lg:pr-5">Sessões</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedItems.map((item) => {
                    const consumption = percentage(item.trackedSeconds, item.estimatedHours * 3600)
                    const member = memberMap.get(item.assigneeId)
                    const meta = statusMeta[item.status]
                    return (
                      <tr key={item.subactivityId} className="border-b border-border last:border-b-0 hover:bg-muted/15">
                        <td className="max-w-52 px-4 py-3.5 lg:px-5">
                          <p className="truncate text-xs font-semibold" title={item.projectName}>{item.projectName}</p>
                          <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">{item.client} · {priorityLabel(item.priority)}</p>
                        </td>
                        <td className="max-w-80 px-4 py-3.5">
                          <Link
                            href={`/projetos/${item.projectId}#activity-${item.activityId}`}
                            className="block truncate rounded-sm text-[0.68rem] font-medium text-primary/85 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            title={`Abrir detalhes da atividade: ${item.activityTitle}`}
                          >
                            {item.activityTitle}
                          </Link>
                          <p className="mt-0.5 truncate text-xs font-medium" title={item.subactivityTitle}>{item.subactivityTitle}</p>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex max-w-40 truncate rounded-md bg-muted px-2 py-1 text-[0.68rem] font-medium text-muted-foreground" title={item.typeName}>{item.typeName}</span>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex max-w-44 items-center gap-2">
                            <MemberAvatar member={member} className="size-6 shrink-0 rounded-md text-[0.55rem] ring-0" />
                            <span className="truncate text-xs font-medium" title={item.assigneeName}>{item.assigneeName}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.68rem] font-medium", meta.className)}>
                            <span className={cn("size-1.5 rounded-full", meta.dot)} />
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-muted-foreground">{item.estimatedHours.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}h</td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs font-semibold tabular-nums">{formatHMS(item.periodSeconds)}</td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatHMS(item.trackedSeconds)}</td>
                        <td className="px-4 py-3.5 text-right">
                          <span className={cn(
                            "inline-flex min-w-12 justify-center rounded-md px-2 py-1 font-mono text-[0.68rem] font-semibold tabular-nums",
                            consumption > 100 ? "bg-destructive/10 text-destructive" : consumption >= 85 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
                          )}>
                            {consumption}%
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-xs tabular-nums text-muted-foreground lg:pr-5">{item.sessions}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-border bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-5">
              <div className="text-xs text-muted-foreground">
                <strong className="font-semibold text-foreground">{items.length}</strong> {items.length === 1 ? "item" : "itens"} · {formatServiceHours(totalPeriodSeconds)} no período · {formatServiceHours(totalTrackedSeconds)} acumuladas
              </div>
              {pageSize !== "all" && pageCount > 1 ? (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                    <ChevronLeft className="size-3.5" />
                    Anterior
                  </Button>
                  <span className="min-w-24 text-center text-xs text-muted-foreground">Página {safePage} de {pageCount}</span>
                  <Button variant="outline" size="sm" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
                    Próxima
                    <ChevronRight className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>
    </div>
  )
}

const selectClassName = "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-ring focus:ring-3 focus:ring-ring/50 dark:bg-input/30"

function FilterField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("grid min-w-0 gap-1.5", className)}>
      <span className="text-[0.68rem] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function EmptyReportState({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex h-full flex-col items-center justify-center text-center text-muted-foreground", compact ? "min-h-20" : "min-h-40")}>
      <CalendarRange className="size-5 opacity-40" />
      <p className="mt-2 text-xs font-medium text-foreground">Sem dados para este recorte</p>
      <p className="mt-0.5 max-w-64 text-[0.68rem]">Ajuste período ou filtros para ampliar a análise.</p>
    </div>
  )
}

function priorityLabel(priority: Priority) {
  if (priority === "high") return "Alta"
  if (priority === "medium") return "Média"
  return "Baixa"
}

function roleLabel(role: string) {
  if (role === "admin") return "Administrador"
  if (role === "developer") return "Desenvolvedor"
  if (role === "aqs") return "AQS"
  if (role === "support") return "Suporte"
  if (role === "member") return "Membro"
  return role || "Membro"
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
