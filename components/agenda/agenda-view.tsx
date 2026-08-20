"use client"

import * as React from "react"
import Link from "next/link"
import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { priorityMeta } from "@/lib/project-utils"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"

const monthNames = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
]

const weekdays = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]

type CalendarMode = "day" | "week" | "month"

const priorityDot: Record<string, string> = {
  high: "bg-primary",
  medium: "bg-chart-3",
  low: "bg-muted-foreground/50",
}

const brazilNationalHolidays: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência do Brasil",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Dia Nacional de Zumbi e da Consciência Negra",
  "12-25": "Natal",
}

function getBrazilNationalHoliday(date: Date) {
  const monthDay = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

  // 20 de novembro passou a ser feriado nacional a partir de 2024.
  if (monthDay === "11-20" && date.getFullYear() < 2024) return null

  return brazilNationalHolidays[monthDay] ?? null
}

function HolidayMarker({ name, compact = false }: { name: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive",
        compact ? "size-5" : "h-6 gap-1 px-1.5 text-[0.58rem] font-medium",
      )}
      title={`Feriado nacional: ${name}`}
      aria-label={`Feriado nacional: ${name}`}
    >
      <Flag className={compact ? "size-2.5" : "size-3"} aria-hidden="true" />
      {!compact && <span className="hidden xl:inline">Feriado</span>}
    </span>
  )
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

function startOfWeek(date: Date) {
  const current = startOfDay(date)
  const weekday = current.getDay()
  const offset = weekday === 0 ? -6 : 1 - weekday
  return addDays(current, offset)
}

function toKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`
}

function fromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year, month - 1, day)
}

function sameDay(a: Date, b: Date) {
  return toKey(a) === toKey(b)
}

function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  })
    .format(date)
    .replace(".", "")
}

function ProjectDeadline({ project, compact = false }: { project: Project; compact?: boolean }) {
  return (
    <Link
      href={`/projetos/${project.id}`}
      className={cn(
        "group flex min-w-0 items-center gap-1 rounded-md bg-card font-medium ring-1 ring-foreground/8 transition-colors hover:bg-muted",
        compact ? "px-1 py-0.5 text-[0.6rem]" : "px-2 py-1.5 text-xs",
      )}
      title={`Abrir projeto ${project.name}`}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", priorityDot[project.priority])} />
      <span className="truncate">{project.name}</span>
    </Link>
  )
}

export function AgendaView() {
  const { projects } = useStore()
  const today = React.useMemo(() => startOfDay(new Date()), [])

  const initialDate = React.useMemo(() => {
    const nextDeadline = [...projects]
      .filter((project) => project.dueDate >= toKey(today))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]?.dueDate

    return nextDeadline ? fromKey(nextDeadline) : today
  }, [projects, today])

  const [cursor, setCursor] = React.useState(initialDate)
  const [mode, setMode] = React.useState<CalendarMode>("month")

  const byDate = React.useMemo(() => {
    const map = new Map<string, Project[]>()
    for (const project of projects) {
      const list = map.get(project.dueDate) ?? []
      list.push(project)
      list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
      map.set(project.dueDate, list)
    }
    return map
  }, [projects])

  const upcoming = React.useMemo(
    () =>
      [...projects]
        .filter((project) => project.dueDate >= toKey(today))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .slice(0, 8),
    [projects, today],
  )

  const nextSevenDays = React.useMemo(() => {
    const end = toKey(addDays(today, 6))
    return projects.filter((project) => project.dueDate >= toKey(today) && project.dueDate <= end).length
  }, [projects, today])

  const thisMonth = React.useMemo(() => {
    const prefix = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-`
    return projects.filter((project) => project.dueDate.startsWith(prefix)).length
  }, [projects, today])

  const todayCount = byDate.get(toKey(today))?.length ?? 0

  const shift = (direction: -1 | 1) => {
    setCursor((current) => {
      if (mode === "day") return addDays(current, direction)
      if (mode === "week") return addDays(current, direction * 7)
      return new Date(current.getFullYear(), current.getMonth() + direction, 1)
    })
  }

  const periodLabel = React.useMemo(() => {
    if (mode === "day") {
      return new Intl.DateTimeFormat("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(cursor)
    }

    if (mode === "week") {
      const start = startOfWeek(cursor)
      const end = addDays(start, 6)
      if (start.getMonth() === end.getMonth()) {
        return `${start.getDate()}–${end.getDate()} de ${monthNames[end.getMonth()]} ${end.getFullYear()}`
      }
      return `${formatShortDate(start)} – ${formatShortDate(end)} ${end.getFullYear()}`
    }

    return `${monthNames[cursor.getMonth()]} ${cursor.getFullYear()}`
  }, [cursor, mode])

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">Hoje</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{todayCount}</p>
          <p className="truncate text-[0.7rem] text-muted-foreground">prazo{todayCount === 1 ? "" : "s"}</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">7 dias</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{nextSevenDays}</p>
          <p className="truncate text-[0.7rem] text-muted-foreground">próximos prazos</p>
        </div>
        <div className="rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4 sm:py-3">
          <p className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">Este mês</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{thisMonth}</p>
          <p className="truncate text-[0.7rem] text-muted-foreground">projetos com prazo</p>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 rounded-2xl bg-card p-3 ring-1 ring-foreground/8 sm:p-4">
          <div className="mb-3 flex flex-col gap-3 border-b border-border pb-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CalendarDays className="size-4 shrink-0 text-primary" />
                <h2 className="truncate text-sm font-semibold capitalize sm:text-base">{periodLabel}</h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">Clique em um prazo para abrir o projeto.</p>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-muted p-1" aria-label="Modo de visualização da agenda">
                {(
                  [
                    ["day", "Dia"],
                    ["week", "Semana"],
                    ["month", "Mês"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMode(value)}
                    className={cn(
                      "h-8 rounded-lg px-3 text-xs font-medium transition-colors",
                      mode === value
                        ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/8"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={mode === value}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setCursor(today)}
                className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Hoje
              </button>

              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => shift(-1)}
                  className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Período anterior"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => shift(1)}
                  className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Próximo período"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {mode === "month" && <MonthView cursor={cursor} today={today} byDate={byDate} />}
          {mode === "week" && <WeekView cursor={cursor} today={today} byDate={byDate} />}
          {mode === "day" && <DayView cursor={cursor} today={today} projects={byDate.get(toKey(cursor)) ?? []} />}
        </section>

        <aside className="min-w-0 rounded-2xl bg-card p-4 ring-1 ring-foreground/8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <CalendarClock className="size-4 shrink-0 text-primary" />
              <h2 className="truncate text-base font-semibold">Próximos prazos</h2>
            </div>
            <span className="shrink-0 text-[0.65rem] text-muted-foreground">{upcoming.length}</span>
          </div>

          {upcoming.length ? (
            <ul className="flex max-h-[430px] flex-col gap-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {upcoming.map((project) => {
                const date = fromKey(project.dueDate)
                return (
                  <li key={project.id}>
                    <Link
                      href={`/projetos/${project.id}`}
                      className="group flex min-w-0 items-center gap-3 rounded-xl border border-transparent p-2.5 transition-colors hover:border-border hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      title={`Abrir projeto ${project.name}`}
                    >
                      <div className="flex size-10 shrink-0 flex-col items-center justify-center rounded-lg bg-muted">
                        <span className="font-mono text-sm font-bold tabular-nums leading-none">{date.getDate()}</span>
                        <span className="mt-0.5 font-mono text-[0.58rem] tracking-wide text-muted-foreground uppercase">
                          {monthNames[date.getMonth()].slice(0, 3)}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium group-hover:text-primary">{project.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{project.client}</p>
                      </div>
                      <span
                        className={cn(
                          "hidden shrink-0 rounded-full px-2 py-0.5 text-[0.62rem] font-medium sm:inline-flex xl:hidden 2xl:inline-flex",
                          priorityMeta[project.priority].className,
                        )}
                      >
                        {priorityMeta[project.priority].label}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 text-center">
              <Clock3 className="mb-2 size-5 text-muted-foreground" />
              <p className="text-sm font-medium">Nenhum prazo futuro</p>
              <p className="mt-1 text-xs text-muted-foreground">Novos projetos com prazo aparecerão aqui.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function MonthView({
  cursor,
  today,
  byDate,
}: {
  cursor: Date
  today: Date
  byDate: Map<string, Project[]>
}) {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const first = new Date(year, month, 1)
  const offset = (first.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ]

  return (
    <div className="min-w-0">
      <div className="grid grid-cols-7 gap-1">
        {weekdays.map((weekday) => (
          <div
            key={weekday}
            className="pb-1.5 text-center font-mono text-[0.56rem] tracking-wider text-muted-foreground uppercase sm:text-[0.6rem]"
          >
            {weekday}
          </div>
        ))}

        {cells.map((day, index) => {
          if (day === null) return <div key={`empty-${index}`} className="min-h-14 sm:min-h-[72px]" />

          const date = new Date(year, month, day)
          const key = toKey(date)
          const events = byDate.get(key) ?? []
          const isToday = sameDay(date, today)
          const holiday = getBrazilNationalHoliday(date)

          return (
            <div
              key={key}
              className={cn(
                "relative min-w-0 rounded-lg border p-1 sm:min-h-[72px] sm:p-1.5",
                events.length
                  ? "border-primary/25 bg-primary/[0.035]"
                  : holiday
                    ? "border-destructive/15 bg-destructive/[0.025]"
                    : "border-transparent hover:bg-muted/60",
                isToday && "ring-1 ring-primary/50",
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <span
                  className={cn(
                    "flex size-5 items-center justify-center rounded-md text-[0.65rem] font-medium tabular-nums sm:size-6 sm:text-xs",
                    isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {day}
                </span>
                {events.length > 0 && !holiday && (
                  <span className="text-[0.55rem] tabular-nums text-muted-foreground sm:hidden">{events.length}</span>
                )}
              </div>

              {holiday && (
                <span className="absolute right-1 top-1 sm:right-1.5 sm:top-1.5">
                  <HolidayMarker name={holiday} compact />
                </span>
              )}

              <div className="mt-1 hidden min-w-0 flex-col gap-0.5 sm:flex">
                {events.slice(0, 2).map((project) => (
                  <ProjectDeadline key={project.id} project={project} compact />
                ))}
                {events.length > 2 && (
                  <span className="px-1 text-[0.55rem] text-muted-foreground">+{events.length - 2}</span>
                )}
              </div>

              <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                {events.slice(0, 3).map((project) => (
                  <Link
                    key={project.id}
                    href={`/projetos/${project.id}`}
                    className={cn("size-1.5 rounded-full", priorityDot[project.priority])}
                    aria-label={`Abrir projeto ${project.name}`}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({
  cursor,
  today,
  byDate,
}: {
  cursor: Date
  today: Date
  byDate: Map<string, Project[]>
}) {
  const start = startOfWeek(cursor)
  const days = Array.from({ length: 7 }, (_, index) => addDays(start, index))

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((date, index) => {
        const projects = byDate.get(toKey(date)) ?? []
        const isToday = sameDay(date, today)
        const holiday = getBrazilNationalHoliday(date)
        return (
          <div
            key={toKey(date)}
            className={cn(
              "min-w-0 rounded-xl border border-border p-2.5 lg:min-h-36",
              holiday && !isToday && "border-destructive/20 bg-destructive/[0.025]",
              isToday && "border-primary/40 bg-primary/[0.035]",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[0.6rem] font-medium tracking-wide text-muted-foreground uppercase">{weekdays[index]}</p>
                <p className="text-sm font-semibold tabular-nums">{date.getDate()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {holiday && <HolidayMarker name={holiday} compact />}
                {projects.length > 0 && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[0.6rem] tabular-nums text-muted-foreground">
                    {projects.length}
                  </span>
                )}
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              {holiday && (
                <p className="truncate text-[0.6rem] font-medium text-destructive" title={holiday}>
                  {holiday}
                </p>
              )}
              {projects.slice(0, 4).map((project) => (
                <ProjectDeadline key={project.id} project={project} compact />
              ))}
              {projects.length > 4 && (
                <span className="px-1 text-[0.6rem] text-muted-foreground">+{projects.length - 4} prazo(s)</span>
              )}
              {!projects.length && <span className="text-[0.65rem] text-muted-foreground/70">Sem prazos</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DayView({ cursor, today, projects }: { cursor: Date; today: Date; projects: Project[] }) {
  const isToday = sameDay(cursor, today)
  const holiday = getBrazilNationalHoliday(cursor)

  return (
    <div className="min-h-40 rounded-xl border border-border p-3 sm:p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{isToday ? "Hoje" : "Prazos do dia"}</p>
          <p className="mt-0.5 text-sm font-semibold capitalize">
            {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(cursor)}
          </p>
          {holiday && (
            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-[0.65rem] font-medium text-destructive">
              <Flag className="size-3" aria-hidden="true" />
              <span className="truncate">{holiday}</span>
            </div>
          )}
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
          {projects.length} {projects.length === 1 ? "projeto" : "projetos"}
        </span>
      </div>

      {projects.length ? (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {projects.map((project) => (
            <Link
              key={project.id}
              href={`/projetos/${project.id}`}
              className="group flex min-w-0 items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/60"
            >
              <span className={cn("size-2.5 shrink-0 rounded-full", priorityDot[project.priority])} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium group-hover:text-primary">{project.name}</p>
                <p className="truncate text-xs text-muted-foreground">{project.client}</p>
              </div>
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.62rem] font-medium", priorityMeta[project.priority].className)}>
                {priorityMeta[project.priority].label}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
          Nenhum projeto com prazo neste dia.
        </div>
      )}
    </div>
  )
}
