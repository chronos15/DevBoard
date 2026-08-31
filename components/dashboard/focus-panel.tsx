"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { useStore } from "@/lib/store"
import { useAnalyticsScope } from "@/lib/use-analytics-scope"
import { formatHMS } from "@/lib/project-utils"
import { TimerButton } from "@/components/timer-button"
import { MemberAvatar } from "@/components/member-avatar"

export function FocusPanel() {
  const { activeSubId, runningSubIds } = useStore()
  const { projects, members } = useAnalyticsScope()

  const items = projects
    .flatMap((p) =>
      p.activities.flatMap((a) =>
        a.subactivities
          .filter((s) => s.status === "in-progress")
          .map((s) => ({ project: p, activity: a, sub: s })),
      ),
    )
    .sort((a, b) => {
      if (a.sub.id === activeSubId) return -1
      if (b.sub.id === activeSubId) return 1
      return b.sub.trackedSeconds - a.sub.trackedSeconds
    })
    .slice(0, 5)

  return (
    <div className="flex flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Foco de hoje</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Continue de onde parou
          </p>
        </div>
        <Link
          href="/projetos"
          className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Ver tudo <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="mt-4 flex flex-col divide-y divide-border">
        {items.map(({ project, sub }) => {
          const assignee = members.find((m) => m.id === sub.assigneeId)
          const running = runningSubIds.includes(sub.id)
          return (
            <div key={sub.id} className="flex items-center gap-3 py-3 first:pt-0">
              <TimerButton subId={sub.id} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{sub.title}</p>
                <Link
                  href={`/projetos/${project.id}`}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  {project.name}
                </Link>
              </div>
              <MemberAvatar member={assignee} className="hidden sm:inline-flex" />
              <span
                className={
                  "w-20 text-right font-mono text-sm tabular-nums " +
                  (running ? "text-primary" : "text-muted-foreground")
                }
              >
                {formatHMS(sub.trackedSeconds)}
              </span>
            </div>
          )
        })}
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma subatividade em andamento.
          </p>
        )}
      </div>
    </div>
  )
}
