"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronUp, ExternalLink, Pause, TimerReset } from "lucide-react"
import { useStore } from "@/lib/store"
import { formatHMS, formatHours } from "@/lib/project-utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export function FocusedRunningTimer() {
  const router = useRouter()
  const { activeSubId, findSub, stopTimer, preferences, chatMeetings, currentUserId } = useStore()
  const [expanded, setExpanded] = React.useState(true)
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pausing, setPausing] = React.useState(false)

  React.useEffect(() => {
    if (activeSubId) setExpanded(true)
  }, [activeSubId])

  // Este componente é exclusivo do Modo Resumido. No modo Completo o timer
  // continua sendo renderizado pelo RunningTimerChip dentro do Topbar.
  if (preferences.interfaceMode !== "focused" || !preferences.timerSticky || !activeSubId) return null

  const found = findSub(activeSubId)
  if (!found) return null

  const activity = found.project.activities.find((item) => item.id === found.activityId)
  const hasJoinedMeeting = chatMeetings.some((meeting) =>
    !meeting.endedAt && meeting.memberStates.some((member) => member.userId === currentUserId && member.status === "joined"),
  )
  const estimatedSeconds = Math.max(0, found.sub.estimatedHours * 3600)
  const progress = estimatedSeconds > 0
    ? Math.max(0, Math.min(100, (found.sub.trackedSeconds / estimatedSeconds) * 100))
    : null

  const openTask = () => {
    const params = new URLSearchParams()
    params.set("space", "project")
    params.set("project", found.project.id)
    params.set("activity", found.activityId)
    params.set("sub", found.sub.id)
    router.push(`/?${params.toString()}`)
  }

  const pauseTimer = async () => {
    if (pausing) return
    setPausing(true)
    try {
      const paused = await stopTimer(found.sub.id)
      if (paused) setConfirmOpen(false)
    } finally {
      setPausing(false)
    }
  }

  return (
    <>
      <div
        className={cn(
          "fixed right-3 z-40 transition-[bottom] duration-200 sm:right-4",
          hasJoinedMeeting
            ? "bottom-[15rem]"
            : "bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:bottom-[max(1rem,env(safe-area-inset-bottom))]",
        )}
        aria-live="polite"
      >
        {expanded ? (
          <div className="w-[min(350px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-primary/25 bg-popover/96 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3.5 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="relative flex size-2 shrink-0">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-primary" />
                </span>
                <span className="truncate text-[0.68rem] font-bold uppercase tracking-[0.12em] text-primary">Em execução</span>
              </div>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Recolher cronômetro"
                aria-label="Recolher cronômetro"
              >
                <ChevronDown className="size-4" />
              </button>
            </div>

            <div className="p-3.5">
              <button type="button" onClick={openTask} className="block w-full min-w-0 text-left group">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
                  {found.sub.title}
                </p>
                <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">
                  {found.project.name}{activity?.title ? ` · ${activity.title}` : ""}
                </p>
              </button>

              <div className="mt-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-primary">
                    <TimerReset className="size-4 shrink-0" />
                    <span className="font-mono text-xl font-semibold tabular-nums tracking-tight">
                      {formatHMS(found.sub.trackedSeconds)}
                    </span>
                  </div>
                  {estimatedSeconds > 0 && (
                    <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                      {formatHours(found.sub.trackedSeconds)} trabalhadas / {found.sub.estimatedHours}h estimadas
                    </p>
                  )}
                </div>
                {progress !== null && (
                  <span className="shrink-0 font-mono text-[0.68rem] font-semibold text-muted-foreground">
                    {Math.round(progress)}%
                  </span>
                )}
              </div>

              {progress !== null && (
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress}%` }} />
                </div>
              )}

              <div className="mt-3 flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="min-w-0 flex-1" onClick={openTask}>
                  <ExternalLink className="size-3.5" />
                  Abrir
                </Button>
                <Button type="button" size="sm" className="flex-1" onClick={() => setConfirmOpen(true)}>
                  <Pause className="size-3.5" />
                  Pausar
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center overflow-hidden rounded-2xl border border-primary/30 bg-popover/96 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex h-11 items-center gap-2.5 px-3 transition-colors hover:bg-muted/70"
              title={found.sub.title}
            >
              <span className="relative flex size-2 shrink-0">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-primary">{formatHMS(found.sub.trackedSeconds)}</span>
              <ChevronUp className="size-3.5 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="flex size-11 items-center justify-center border-l border-border text-primary transition-colors hover:bg-primary/10"
              title="Pausar cronômetro"
              aria-label="Pausar cronômetro"
            >
              <Pause className="size-4" />
            </button>
          </div>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!pausing) setConfirmOpen(open) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pausar atividade?</DialogTitle>
            <DialogDescription>
              Deseja pausar <strong className="font-medium text-foreground">“{found.sub.title}”</strong>? O tempo registrado até agora será mantido e a subatividade ficará como pausada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)} disabled={pausing}>
              Cancelar
            </Button>
            <Button type="button" loading={pausing} loadingText="Pausando..." onClick={pauseTimer}>
              <Pause className="size-3.5" />
              Pausar atividade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
