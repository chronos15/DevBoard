"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { useAnalyticsScope } from "@/lib/use-analytics-scope"
import {
  formatHours,
  priorityMeta,
  projectProgress,
  projectTracked,
} from "@/lib/project-utils"
import { MemberStack } from "@/components/member-avatar"
import { cn } from "@/lib/utils"

export function ProjectsProgress() {
  const { projects } = useAnalyticsScope()

  return (
    <div className="flex flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Progresso dos projetos</h2>
        <Link
          href="/projetos"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Ver projetos <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {projects.map((p) => {
          const progress = projectProgress(p)
          const prio = priorityMeta[p.priority]
          return (
            <Link
              key={p.id}
              href={`/projetos/${p.id}`}
              className="group flex flex-col gap-2.5 rounded-xl border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/40"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {p.client}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                    prio.className,
                  )}
                >
                  {prio.label}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="w-9 text-right font-mono text-xs font-medium tabular-nums text-muted-foreground">
                  {progress}%
                </span>
              </div>

              <div className="flex items-center justify-between">
                <MemberStack ids={p.memberIds} max={3} />
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatHours(projectTracked(p))} registradas
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
