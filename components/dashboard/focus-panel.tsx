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

  return (
    <div className="flex h-[390px] min-h-0 flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Foco de hoje</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Continue de onde parou
          </p>
        </div>
        <Link
          href="/acompanhamento"
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Ver tudo <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable] [scrollbar-width:thin]">
        <div className="flex flex-col divide-y divide-border">
          {items.map(({ project, sub }) => {
            const assignee = members.find((m) => m.id === sub.assigneeId)
            const running = runningSubIds.includes(sub.id)
            return (
              <div key={sub.id} className="flex items-center gap-3 py-3 first:pt-1">
                <TimerButton subId={sub.id} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{sub.title}</p>
                  <Link
                    href={`/projetos/${project.id}#sub-${sub.id}`}
                    className="block truncate text-xs text-muted-foreground hover:text-primary"
                  >
                    {project.name}
                  </Link>
                </div>
                <MemberAvatar member={assignee} className="hidden sm:inline-flex" />
                <span
                  className={
                    "w-20 shrink-0 text-right font-mono text-sm tabular-nums " +
                    (running ? "text-primary" : "text-muted-foreground")
                  }
                >
                  {formatHMS(sub.trackedSeconds)}
                </span>
              </div>
            )
          })}
          {items.length === 0 && (
            <div className="flex min-h-48 items-center justify-center px-4 text-center text-sm text-muted-foreground">
              Nenhuma subatividade em andamento.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
