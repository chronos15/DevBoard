"use client"

import * as React from "react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useAnalyticsScope } from "@/lib/use-analytics-scope"
import {
  formatHours,
  projectEstimated,
  projectProgress,
  projectSubactivities,
  projectTracked,
} from "@/lib/project-utils"
import { cn } from "@/lib/utils"
import { MemberAvatar, MemberName } from "@/components/member-avatar"

const projectColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-muted-foreground">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: p.color || p.fill }}
          />
          <span className="font-mono tabular-nums text-foreground">
            {p.value}h
          </span>
          {p.name}
        </p>
      ))}
    </div>
  )
}

export function ReportsView() {
  const { isAdmin, projects, members } = useAnalyticsScope()

  const byProject = projects.map((p) => ({
    name: p.name,
    registrado: +(projectTracked(p) / 3600).toFixed(1),
    estimado: +(projectEstimated(p) / 3600).toFixed(1),
  }))

  const byMember = members
    .map((m) => {
      let tracked = 0
      let count = 0
      for (const p of projects) {
        for (const s of projectSubactivities(p)) {
          if (s.assigneeId === m.id) {
            tracked += s.trackedSeconds
            count++
          }
        }
      }
      return { member: m, tracked, count }
    })
    .filter((r) => r.count > 0)
    .sort((a, b) => b.tracked - a.tracked)

  const maxMember = Math.max(1, ...byMember.map((r) => r.tracked))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8 lg:col-span-2">
          <div className="mb-5">
            <h2 className="text-base font-semibold">Horas por projeto</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Comparativo entre horas registradas e estimadas.
            </p>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byProject}
                margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                barGap={4}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  dy={8}
                  interval={0}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  width={40}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: "var(--muted)" }}
                />
                <Bar
                  dataKey="estimado"
                  name="estimado"
                  fill="var(--muted-foreground)"
                  radius={[4, 4, 0, 0]}
                  fillOpacity={0.35}
                />
                <Bar
                  dataKey="registrado"
                  name="registrado"
                  fill="var(--chart-1)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
          <div className="mb-5">
            <h2 className="text-base font-semibold">{isAdmin ? "Carga por pessoa" : "Sua carga"}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {isAdmin ? "Horas registradas por membro do time." : "Suas horas registradas no escopo dos seus projetos."}
            </p>
          </div>
          <ul className="flex flex-col gap-4">
            {byMember.map((r) => (
              <li key={r.member.id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium">
                    <MemberAvatar member={r.member} className="size-6 rounded-md text-[0.6rem] ring-0" />
                    <MemberName member={r.member} label={r.member.name.split(" ")[0]} />
                  </span>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {formatHours(r.tracked)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(r.tracked / maxMember) * 100}%`,
                      backgroundColor: r.member.color,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl bg-card ring-1 ring-foreground/8">
        <div className="border-b border-border p-4 md:p-5">
          <h2 className="text-base font-semibold">Desempenho por projeto</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Progresso, horas e esforço relativo de cada projeto.
          </p>
        </div>
        <div className="hidden grid-cols-[1.5fr_1fr_1fr_1.4fr] gap-4 px-5 py-3 font-mono text-[0.65rem] tracking-widest text-muted-foreground uppercase md:grid">
          <span>Projeto</span>
          <span className="text-right">Registrado</span>
          <span className="text-right">Estimado</span>
          <span>Progresso</span>
        </div>
        <ul>
          {projects.map((p, i) => {
            const progress = projectProgress(p)
            return (
              <li
                key={p.id}
                className="grid grid-cols-1 gap-3 border-t border-border px-5 py-4 md:grid-cols-[1.5fr_1fr_1fr_1.4fr] md:items-center md:gap-4"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: projectColors[i % projectColors.length] }}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {p.client}
                    </p>
                  </div>
                </div>
                <span className="font-mono text-sm tabular-nums text-foreground md:text-right">
                  <span className="text-muted-foreground md:hidden">Registrado: </span>
                  {formatHours(projectTracked(p))}
                </span>
                <span className="font-mono text-sm tabular-nums text-muted-foreground md:text-right">
                  <span className="md:hidden">Estimado: </span>
                  {formatHours(projectEstimated(p))}
                </span>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        progress === 100 ? "bg-success" : "bg-primary",
                      )}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">
                    {progress}%
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
