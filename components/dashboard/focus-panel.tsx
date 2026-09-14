"use client"

import Link from "next/link"
import { ArrowUpRight, Star } from "lucide-react"
import { useStore } from "@/lib/store"
import { formatHMS, statusMeta } from "@/lib/project-utils"
import { TimerButton } from "@/components/timer-button"
import { MemberAvatar } from "@/components/member-avatar"
import { cn } from "@/lib/utils"

export function FocusPanel() {
  const { activeSubId, runningSubIds, projects, members } = useStore()

  const items = projects
    .flatMap((project) =>
      project.activities.flatMap((activity) =>
        activity.subactivities
          .filter((sub) => sub.isFocus)
          .map((sub) => ({ project, activity, sub })),
      ),
    )
    .sort((a, b) => {
      if (a.sub.id === activeSubId) return -1
      if (b.sub.id === activeSubId) return 1
      const aMarkedAt = a.sub.focusMarkedAt ? new Date(a.sub.focusMarkedAt).getTime() : 0
      const bMarkedAt = b.sub.focusMarkedAt ? new Date(b.sub.focusMarkedAt).getTime() : 0
      return bMarkedAt - aMarkedAt
    })

  return (
    <div className="flex h-[390px] min-h-0 flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-amber-500/12 text-amber-600 dark:text-amber-400">
              <Star className="size-3.5 fill-current" />
            </span>
            <h2 className="text-base font-semibold">Foco de hoje</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Prioridades definidas pela administração
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
          {items.map(({ project, activity, sub }) => {
            const assignee = members.find((member) => member.id === sub.assigneeId)
            const running = runningSubIds.includes(sub.id)
            const meta = statusMeta[sub.status]
            return (
              <div key={sub.id} className="flex items-center gap-3 py-3 first:pt-1">
                <TimerButton subId={sub.id} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className={cn("truncate text-sm font-medium", (sub.status === "done" || sub.status === "cancelled") && "text-muted-foreground line-through")}>{sub.title}</p>
                    <span className={cn("hidden shrink-0 rounded-full px-1.5 py-0.5 text-[0.58rem] font-semibold sm:inline-flex", meta.className)}>{meta.label}</span>
                  </div>
                  <Link
                    href={`/projetos/${project.id}#sub-${sub.id}`}
                    className="block truncate text-xs text-muted-foreground hover:text-primary"
                    title={`${project.name} · ${activity.title}`}
                  >
                    {project.name} · {activity.title}
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
            <div className="flex min-h-48 items-center justify-center px-5 text-center text-sm text-muted-foreground">
              Nenhuma subatividade foi marcada como foco pela administração.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
