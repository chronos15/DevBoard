"use client"

import { Play, Square, Timer } from "lucide-react"
import type { Project } from "@/lib/types"
import { useStore } from "@/lib/store"
import { formatHMS, projectSubactivities } from "@/lib/project-utils"
import { cn } from "@/lib/utils"

export function ActiveTimerHero({
  project,
  compact = false,
}: {
  project: Project
  compact?: boolean
}) {
  const {
    activeSubId,
    currentUserId,
    findSub,
    stopTimer,
    startTimer,
  } = useStore()

  const active = activeSubId ? findSub(activeSubId) : null
  const activeInProject = active && active.project.id === project.id ? active : null

  const suggestion = projectSubactivities(project).find(
    (sub) =>
      sub.assigneeId === currentUserId &&
      sub.status !== "done" &&
      sub.status !== "cancelled" &&
      sub.status !== "waiting-aqs",
  )

  const displaySeconds = activeInProject?.sub.trackedSeconds ?? 0
  const running = Boolean(activeInProject)

  if (compact) {
    return (
      <div
        className={cn(
          "flex min-h-44 flex-col items-center justify-between gap-3 rounded-2xl px-2 py-4 text-center ring-1 transition-colors",
          running
            ? "bg-sidebar text-sidebar-accent-foreground ring-foreground/10"
            : "bg-card ring-foreground/8",
        )}
        title={running ? activeInProject!.sub.title : suggestion?.title ?? "Nenhuma tarefa disponível"}
      >
        <div className="flex flex-col items-center gap-2">
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-xl",
              running ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <Timer className="size-4" />
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums">
            {formatHMS(displaySeconds).slice(0, 5)}
          </span>
          {running && <span className="size-2 rounded-full bg-primary" />}
        </div>

        <button
          type="button"
          disabled={!running && !suggestion}
          onClick={() =>
            running
              ? stopTimer(activeInProject!.sub.id)
              : suggestion && startTimer(suggestion.id)
          }
          className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-35"
          aria-label={running ? "Pausar cronômetro" : "Iniciar próxima tarefa"}
        >
          {running ? (
            <Square className="size-3.5 fill-current" />
          ) : (
            <Play className="size-3.5 fill-current" />
          )}
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative flex flex-col justify-between gap-6 overflow-hidden rounded-2xl p-6 ring-1 transition-colors",
        running
          ? "bg-sidebar text-sidebar-accent-foreground ring-foreground/10"
          : "bg-card ring-foreground/8",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex items-center gap-2 font-mono text-[0.7rem] tracking-widest uppercase",
            running ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Timer className="size-3.5" />
          {running ? "Cronômetro ativo" : "Cronômetro"}
        </span>
        {running && (
          <span className="relative flex size-2.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
          </span>
        )}
      </div>

      <div>
        <p
          className={cn(
            "font-mono text-5xl font-bold tabular-nums md:text-6xl",
            running ? "text-sidebar-accent-foreground" : "text-foreground",
          )}
        >
          {formatHMS(displaySeconds)}
        </p>
        <p
          className={cn(
            "mt-2 truncate text-sm",
            running ? "text-sidebar-foreground" : "text-muted-foreground",
          )}
        >
          {running
            ? activeInProject!.sub.title
            : suggestion
              ? `Pronto para iniciar: ${suggestion.title}`
              : "Nenhuma subatividade sua disponível neste projeto"}
        </p>
      </div>

      {running ? (
        <button
          type="button"
          onClick={() => stopTimer(activeInProject!.sub.id)}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Square className="size-4 fill-current" />
          Parar cronômetro
        </button>
      ) : (
        <button
          type="button"
          disabled={!suggestion}
          onClick={() => suggestion && startTimer(suggestion.id)}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Play className="size-4 fill-current" />
          Iniciar próxima tarefa
        </button>
      )}
    </div>
  )
}
