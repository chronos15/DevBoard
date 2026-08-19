"use client"

import Link from "next/link"
import { Pause } from "lucide-react"
import { useStore } from "@/lib/store"
import { formatHMS } from "@/lib/project-utils"

export function RunningTimerChip() {
  const { activeSubId, findSub, stopTimer, preferences } = useStore()
  if (!preferences.timerSticky || !activeSubId) return null
  const found = findSub(activeSubId)
  if (!found) return null

  return (
    <div className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 py-1.5 pr-1.5 pl-3">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-primary" />
      </span>
      <Link
        href={`/projetos/${found.project.id}`}
        className="hidden max-w-40 flex-col leading-tight sm:flex"
      >
        <span className="truncate text-xs font-medium text-foreground">
          {found.sub.title}
        </span>
        <span className="font-mono text-[0.7rem] tabular-nums text-primary">
          {formatHMS(found.sub.trackedSeconds)}
        </span>
      </Link>
      <span className="font-mono text-xs tabular-nums text-primary sm:hidden">
        {formatHMS(found.sub.trackedSeconds)}
      </span>
      <button
        type="button"
        onClick={() => { void stopTimer() }}
        className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90"
        aria-label="Pausar cronômetro"
      >
        <Pause className="size-3.5" />
      </button>
    </div>
  )
}
