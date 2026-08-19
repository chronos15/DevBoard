"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, CalendarClock } from "lucide-react"
import { useStore } from "@/lib/store"
import { priorityMeta } from "@/lib/project-utils"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"

const monthNames = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]
const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

const priorityDot: Record<string, string> = {
  high: "bg-primary",
  medium: "bg-chart-3",
  low: "bg-muted-foreground/50",
}

function toKey(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

export function AgendaView() {
  const { projects } = useStore()

  // Anchor the initial view on the earliest upcoming deadline.
  const initial = React.useMemo(() => {
    const sorted = [...projects].sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate),
    )
    const first = sorted[0]?.dueDate
    if (first) {
      const [y, m] = first.split("-").map(Number)
      return { year: y, month: m - 1 }
    }
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  }, [projects])

  const [view, setView] = React.useState(initial)

  const byDate = React.useMemo(() => {
    const map = new Map<string, Project[]>()
    for (const p of projects) {
      const list = map.get(p.dueDate) ?? []
      list.push(p)
      map.set(p.dueDate, list)
    }
    return map
  }, [projects])

  const upcoming = React.useMemo(
    () =>
      [...projects].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [projects],
  )

  const firstDay = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const shift = (delta: number) => {
    setView((v) => {
      const m = v.month + delta
      return {
        year: v.year + Math.floor(m / 12),
        month: ((m % 12) + 12) % 12,
      }
    })
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-2xl bg-card p-4 ring-1 ring-foreground/8 md:p-5 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">
            {monthNames[view.month]}{" "}
            <span className="text-muted-foreground">{view.year}</span>
          </h2>
          <div className="flex gap-1">
            <button
              onClick={() => shift(-1)}
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Mês anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => shift(1)}
              className="flex size-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Próximo mês"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {weekdays.map((w) => (
            <div
              key={w}
              className="pb-2 text-center font-mono text-[0.6rem] tracking-widest text-muted-foreground uppercase"
            >
              {w}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null)
              return <div key={`e${i}`} className="aspect-square" />
            const key = toKey(view.year, view.month, day)
            const events = byDate.get(key) ?? []
            return (
              <div
                key={key}
                className={cn(
                  "flex aspect-square flex-col rounded-lg border p-1.5 text-left",
                  events.length
                    ? "border-primary/30 bg-primary/5"
                    : "border-transparent hover:bg-muted",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    events.length ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {day}
                </span>
                <div className="mt-auto flex flex-col gap-0.5">
                  {events.slice(0, 2).map((p) => (
                    <span
                      key={p.id}
                      className="flex items-center gap-1 truncate rounded bg-card px-1 py-0.5 text-[0.6rem] font-medium ring-1 ring-foreground/8"
                      title={p.name}
                    >
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          priorityDot[p.priority],
                        )}
                      />
                      <span className="truncate">{p.name}</span>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
        <div className="mb-4 flex items-center gap-2">
          <CalendarClock className="size-4 text-primary" />
          <h2 className="text-base font-semibold">Próximos prazos</h2>
        </div>
        <ul className="flex flex-col gap-2">
          {upcoming.map((p) => {
            const d = new Date(p.dueDate + "T00:00:00")
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-xl border border-border p-3 transition-colors hover:bg-muted/60"
              >
                <div className="flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-muted">
                  <span className="font-mono text-sm font-bold tabular-nums leading-none">
                    {d.getDate()}
                  </span>
                  <span className="mt-0.5 font-mono text-[0.6rem] tracking-wide text-muted-foreground uppercase">
                    {monthNames[d.getMonth()].slice(0, 3)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.client}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                    priorityMeta[p.priority].className,
                  )}
                >
                  {priorityMeta[p.priority].label}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
