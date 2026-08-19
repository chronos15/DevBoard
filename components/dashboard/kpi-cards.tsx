"use client"

import { FolderKanban, Timer, CheckCircle2, TrendingUp } from "lucide-react"
import { useStore } from "@/lib/store"
import {
  projectSubactivities,
  projectTracked,
} from "@/lib/project-utils"
import { cn } from "@/lib/utils"

export function KpiCards() {
  const { projects } = useStore()

  const allSubs = projects.flatMap(projectSubactivities)
  const totalSeconds = projects.reduce((acc, p) => acc + projectTracked(p), 0)
  const inProgress = allSubs.filter((s) => s.status === "in-progress").length
  const done = allSubs.filter((s) => s.status === "done").length
  const completion = allSubs.length
    ? Math.round((done / allSubs.length) * 100)
    : 0

  const items = [
    {
      label: "Projetos ativos",
      value: String(projects.length),
      hint: `${allSubs.length} subatividades`,
      icon: FolderKanban,
      trend: "+2 este mês",
      tone: "text-chart-4",
      bg: "bg-chart-4/12",
    },
    {
      label: "Horas registradas",
      value: (totalSeconds / 3600).toFixed(1),
      suffix: "h",
      hint: "acumulado no período",
      icon: Timer,
      trend: "+8.4% vs. semana",
      tone: "text-primary",
      bg: "bg-primary/12",
    },
    {
      label: "Em andamento",
      value: String(inProgress),
      hint: "subatividades abertas",
      icon: TrendingUp,
      trend: "foco da semana",
      tone: "text-chart-3",
      bg: "bg-chart-3/15",
    },
    {
      label: "Taxa de conclusão",
      value: String(completion),
      suffix: "%",
      hint: `${done} concluídas`,
      icon: CheckCircle2,
      trend: "+5% vs. mês",
      tone: "text-success",
      bg: "bg-success/15",
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/8"
        >
          <div className="flex items-start justify-between">
            <span className="font-mono text-[0.7rem] tracking-widest text-muted-foreground uppercase">
              {item.label}
            </span>
            <span
              className={cn(
                "flex size-9 items-center justify-center rounded-xl",
                item.bg,
                item.tone,
              )}
            >
              <item.icon className="size-[1.1rem]" />
            </span>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold tabular-nums tracking-tight">
              {item.value}
            </span>
            {item.suffix && (
              <span className="text-lg font-semibold text-muted-foreground">
                {item.suffix}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{item.hint}</span>
            <span className={cn("font-medium", item.tone)}>{item.trend}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
