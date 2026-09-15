"use client"

import Link from "next/link"
import { ArrowUpRight, FolderKanban, Timer, CheckCircle2, TrendingUp } from "lucide-react"
import { useAnalyticsScope } from "@/lib/use-analytics-scope"
import {
  projectSubactivities,
  projectTracked,
} from "@/lib/project-utils"
import { cn } from "@/lib/utils"

export function KpiCards() {
  const { isAdmin, projects } = useAnalyticsScope()

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
      trend: isAdmin ? "workspace" : "seu escopo",
      tone: "text-chart-4",
      bg: "bg-chart-4/12",
      href: "/projetos",
      ariaLabel: "Abrir projetos ativos",
    },
    {
      label: "Horas registradas",
      value: (totalSeconds / 3600).toFixed(1),
      suffix: "h",
      hint: "acumulado no período",
      icon: Timer,
      trend: isAdmin ? "equipe" : "suas horas",
      tone: "text-primary",
      bg: "bg-primary/12",
      href: "/horas",
      ariaLabel: "Abrir controle de horas",
    },
    {
      label: "Em andamento",
      value: String(inProgress),
      hint: "subatividades abertas",
      icon: TrendingUp,
      trend: "foco atual",
      tone: "text-chart-3",
      bg: "bg-chart-3/15",
      href: "/acompanhamento",
      ariaLabel: "Abrir acompanhamento das subatividades em andamento",
    },
    {
      label: "Taxa de conclusão",
      value: String(completion),
      suffix: "%",
      hint: `${done} concluídas`,
      icon: CheckCircle2,
      trend: "do escopo",
      tone: "text-success",
      bg: "bg-success/15",
      href: "/projetos",
      ariaLabel: "Abrir projetos e atividades concluídas",
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:gap-4 xl:grid-cols-4">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-label={item.ariaLabel}
          className="group flex min-h-[132px] min-w-0 flex-col gap-2.5 rounded-2xl bg-card p-3 ring-1 ring-foreground/8 transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted/25 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 sm:min-h-0 sm:gap-4 sm:p-5"
        >
          <div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
            <span className="min-w-0 text-balance font-mono text-[0.58rem] leading-4 tracking-[0.16em] text-muted-foreground uppercase transition-colors group-hover:text-foreground sm:text-[0.7rem] sm:tracking-widest">
              {item.label}
            </span>
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">
              <ArrowUpRight className="hidden size-3.5 text-muted-foreground/50 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary sm:block" />
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-xl sm:size-9",
                  item.bg,
                  item.tone,
                )}
              >
                <item.icon className="size-4 sm:size-[1.1rem]" />
              </span>
            </div>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tabular-nums tracking-tight sm:text-3xl">
              {item.value}
            </span>
            {item.suffix && (
              <span className="text-sm font-semibold text-muted-foreground sm:text-lg">
                {item.suffix}
              </span>
            )}
          </div>
          <div className="mt-auto flex min-w-0 items-center justify-between gap-2 text-[0.62rem] sm:mt-0 sm:gap-3 sm:text-xs">
            <span className="truncate text-muted-foreground">{item.hint}</span>
            <span className={cn("hidden shrink-0 font-medium sm:inline", item.tone)}>{item.trend}</span>
          </div>
        </Link>
      ))}
    </div>
  )
}
