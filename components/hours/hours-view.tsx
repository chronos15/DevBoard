"use client"

import * as React from "react"
import { Play, Square, Clock3, Target, Gauge } from "lucide-react"
import { useStore } from "@/lib/store"
import {
  formatHMS,
  formatHours,
  projectSubactivities,
  statusMeta,
} from "@/lib/project-utils"
import type { Member, Project, Subactivity } from "@/lib/types"
import { cn } from "@/lib/utils"

type Row = {
  sub: Subactivity
  project: Project
  activityTitle: string
  member: Member | undefined
}

export function HoursView() {
  const { projects, members, runningSubIds, startTimer, stopTimer, canManageSubactivity } = useStore()
  const [memberFilter, setMemberFilter] = React.useState<string>("all")

  const rows: Row[] = React.useMemo(() => {
    const out: Row[] = []
    for (const project of projects) {
      for (const activity of project.activities) {
        for (const sub of activity.subactivities) {
          out.push({
            sub,
            project,
            activityTitle: activity.title,
            member: members.find((m) => m.id === sub.assigneeId),
          })
        }
      }
    }
    return out
  }, [projects, members])

  const filtered =
    memberFilter === "all"
      ? rows
      : rows.filter((r) => r.sub.assigneeId === memberFilter)

  const totalTracked = filtered.reduce((a, r) => a + r.sub.trackedSeconds, 0)
  const totalEstimated = filtered.reduce(
    (a, r) => a + r.sub.estimatedHours * 3600,
    0,
  )
  const utilization = totalEstimated
    ? Math.round((totalTracked / totalEstimated) * 100)
    : 0

  const summary = [
    {
      label: "Horas registradas",
      value: formatHours(totalTracked),
      hint: `${filtered.length} subatividades`,
      icon: Clock3,
      tone: "text-primary",
      bg: "bg-primary/12",
    },
    {
      label: "Horas estimadas",
      value: formatHours(totalEstimated),
      hint: "planejado para o escopo",
      icon: Target,
      tone: "text-chart-4",
      bg: "bg-chart-4/12",
    },
    {
      label: "Utilização",
      value: `${utilization}%`,
      hint: "registrado vs. estimado",
      icon: Gauge,
      tone: utilization > 100 ? "text-primary" : "text-success",
      bg: utilization > 100 ? "bg-primary/12" : "bg-success/15",
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {summary.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/8"
          >
            <span
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-xl",
                item.bg,
                item.tone,
              )}
            >
              <item.icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase">
                {item.label}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
                {item.value}
              </p>
              <p className="text-xs text-muted-foreground">{item.hint}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 md:p-5">
          <div>
            <h2 className="text-base font-semibold">Registro de horas</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Acompanhe o tempo por subatividade e responsável.
            </p>
          </div>
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            <FilterChip
              active={memberFilter === "all"}
              onClick={() => setMemberFilter("all")}
            >
              Todos
            </FilterChip>
            {members.map((m) => (
              <FilterChip
                key={m.id}
                active={memberFilter === m.id}
                onClick={() => setMemberFilter(m.id)}
              >
                {m.name.split(" ")[0]}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 px-5 py-3 font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase md:grid">
          <span>Subatividade</span>
          <span className="w-24 text-right">Estimado</span>
          <span className="w-28 text-right">Registrado</span>
          <span className="w-28 text-center">Status</span>
          <span className="w-16 text-center">Timer</span>
        </div>

        <ul>
          {filtered.map((r) => {
            const running = runningSubIds.includes(r.sub.id)
            const done = r.sub.status === "done" || r.sub.status === "cancelled"
            const canManage = canManageSubactivity(r.sub)
            const ratio = r.sub.estimatedHours
              ? r.sub.trackedSeconds / (r.sub.estimatedHours * 3600)
              : 0
            return (
              <li
                key={r.sub.id}
                className="grid grid-cols-1 items-center gap-3 border-t border-border px-5 py-4 md:grid-cols-[1fr_auto_auto_auto_auto] md:gap-4"
              >
                <div className="flex items-center gap-3">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[0.7rem] font-semibold text-white"
                    style={{ backgroundColor: r.member?.color }}
                    title={r.member?.name}
                  >
                    {r.member?.initials}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {r.sub.title}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.project.name} · {r.activityTitle}
                    </p>
                  </div>
                </div>

                <span className="text-right font-mono text-sm tabular-nums text-muted-foreground md:w-24">
                  <span className="md:hidden">Estimado: </span>
                  {r.sub.estimatedHours}h
                </span>

                <div className="md:w-28 md:text-right">
                  <p
                    className={cn(
                      "font-mono text-sm tabular-nums",
                      running ? "text-primary" : "text-foreground",
                    )}
                  >
                    {formatHMS(r.sub.trackedSeconds)}
                  </p>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted md:ml-auto md:w-20">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        ratio > 1 ? "bg-primary" : "bg-success",
                      )}
                      style={{ width: `${Math.min(100, ratio * 100)}%` }}
                    />
                  </div>
                </div>

                <div className="md:w-28 md:text-center">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                      statusMeta[r.sub.status].className,
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        statusMeta[r.sub.status].dot,
                      )}
                    />
                    {statusMeta[r.sub.status].label}
                  </span>
                </div>

                <div className="md:flex md:w-16 md:justify-center">
                  <button
                    disabled={done || !canManage}
                    onClick={() => (running ? stopTimer(r.sub.id) : startTimer(r.sub.id))}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-xl transition-colors",
                      done || !canManage
                        ? "cursor-not-allowed bg-muted text-muted-foreground/50"
                        : running
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground hover:bg-primary/12 hover:text-primary",
                    )}
                    aria-label={!canManage ? "Subatividade protegida" : running ? "Parar timer" : "Iniciar timer"}
                    title={!canManage ? "Somente o Desenvolvedor responsável ou um Administrador pode controlar esta subatividade" : undefined}
                  >
                    {running ? (
                      <Square className="size-4 fill-current" />
                    ) : (
                      <Play className="size-4 fill-current" />
                    )}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}
