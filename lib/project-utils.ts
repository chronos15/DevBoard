import type {
  Activity,
  ActivityFilter,
  Priority,
  Project,
  Status,
  Subactivity,
} from "./types"

export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`
}

export function formatHours(totalSeconds: number): string {
  const hours = totalSeconds / 3600
  if (hours >= 10) return `${Math.round(hours)}h`
  return `${hours.toFixed(1)}h`
}

export function activityTracked(activity: Activity): number {
  return activity.subactivities.reduce((acc, s) => acc + s.trackedSeconds, 0)
}

export function activityEstimated(activity: Activity): number {
  return activity.subactivities.reduce((acc, s) => acc + s.estimatedHours * 3600, 0)
}

export function projectSubactivities(project: Project): Subactivity[] {
  return project.activities.flatMap((a) => a.subactivities)
}

export function projectTracked(project: Project): number {
  return projectSubactivities(project).reduce((acc, s) => acc + s.trackedSeconds, 0)
}

export function projectEstimated(project: Project): number {
  return projectSubactivities(project).reduce((acc, s) => acc + s.estimatedHours * 3600, 0)
}

export function projectProgress(project: Project): number {
  const subs = projectSubactivities(project)
  if (subs.length === 0) return 0
  const done = subs.filter((s) => s.status === "done").length
  return Math.round((done / subs.length) * 100)
}

export function statusCounts(projects: Project[]) {
  const counts: Record<Status, number> = {
    backlog: 0,
    waiting: 0,
    "waiting-aqs": 0,
    "in-progress": 0,
    paused: 0,
    done: 0,
    cancelled: 0,
  }
  for (const p of projects) {
    for (const s of projectSubactivities(p)) counts[s.status]++
  }
  return counts
}

export const statusOrder: Status[] = [
  "backlog",
  "waiting",
  "waiting-aqs",
  "in-progress",
  "paused",
  "done",
  "cancelled",
]

export const statusMeta: Record<
  Status,
  { label: string; dot: string; className: string; columnClassName: string }
> = {
  backlog: {
    label: "Backlog",
    dot: "bg-muted-foreground/55",
    className: "bg-muted text-muted-foreground",
    columnClassName: "bg-muted-foreground/55",
  },
  waiting: {
    label: "Aguardando",
    dot: "bg-chart-2",
    className: "bg-chart-2/15 text-chart-2",
    columnClassName: "bg-chart-2",
  },
  "waiting-aqs": {
    label: "Aguardando AQS",
    dot: "bg-chart-5",
    className: "bg-chart-5/15 text-chart-5",
    columnClassName: "bg-chart-5",
  },
  "in-progress": {
    label: "Em execução",
    dot: "bg-chart-3",
    className: "bg-chart-3/15 text-chart-3",
    columnClassName: "bg-chart-3",
  },
  paused: {
    label: "Pausada",
    dot: "bg-chart-4",
    className: "bg-chart-4/15 text-chart-4",
    columnClassName: "bg-chart-4",
  },
  done: {
    label: "Concluída",
    dot: "bg-success",
    className: "bg-success/15 text-success",
    columnClassName: "bg-success",
  },
  cancelled: {
    label: "Cancelada",
    dot: "bg-destructive",
    className: "bg-destructive/10 text-destructive",
    columnClassName: "bg-destructive",
  },
}

export const activityFilters: { key: ActivityFilter; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "open", label: "Aberta" },
  { key: "waiting", label: "Aguardando" },
  { key: "waiting-aqs", label: "Aguardando AQS" },
  { key: "in-progress", label: "Executando" },
  { key: "done", label: "Finalizadas" },
]

export function matchesActivityFilter(status: Status, filter: ActivityFilter): boolean {
  if (filter === "all") return true
  if (filter === "open") return status === "backlog" || status === "paused"
  if (filter === "waiting") return status === "waiting"
  if (filter === "waiting-aqs") return status === "waiting-aqs"
  if (filter === "in-progress") return status === "in-progress"
  return status === "done" || status === "cancelled"
}

export function projectHasPendingWork(project: Project): boolean {
  if (project.activities.length === 0) return false
  return project.activities.some((activity) => {
    if (activity.subactivities.length === 0) return true
    return activity.subactivities.some(
      (sub) => sub.status !== "done" && sub.status !== "cancelled",
    )
  })
}

export const priorityMeta: Record<
  Priority,
  { label: string; className: string }
> = {
  low: { label: "Baixa", className: "bg-muted text-muted-foreground" },
  medium: { label: "Média", className: "bg-chart-3/15 text-chart-3" },
  high: { label: "Alta", className: "bg-primary/12 text-primary" },
}

export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00")
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
}
