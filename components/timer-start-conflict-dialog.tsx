"use client"

import { ArrowDown, Clock3, Pause, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type TimerStartConflict = {
  currentSubId: string
  currentSubTitle: string
  currentProjectName: string
  targetSubId: string
  targetSubTitle: string
  targetProjectName: string
}

function TaskCard({
  eyebrow,
  title,
  project,
  active = false,
}: {
  eyebrow: string
  title: string
  project: string
  active?: boolean
}) {
  return (
    <div
      className={[
        "w-full min-w-0 max-w-full overflow-hidden rounded-2xl border p-3.5 sm:p-4",
        active
          ? "border-primary/25 bg-primary/[0.055] ring-1 ring-inset ring-primary/5"
          : "border-border/80 bg-muted/25",
      ].join(" ")}
    >
      <div className="flex min-w-0 max-w-full items-start gap-3">
        <span
          className={[
            "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
            active ? "bg-primary/12 text-primary" : "bg-background text-foreground ring-1 ring-border/70",
          ].join(" ")}
        >
          {active ? <Clock3 className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </span>

        <div className="min-w-0 flex-1 overflow-hidden">
          <p
            className={[
              "text-[0.65rem] font-semibold tracking-[0.08em] uppercase",
              active ? "text-primary" : "text-muted-foreground",
            ].join(" ")}
          >
            {eyebrow}
          </p>

          <p
            className="mt-1 line-clamp-2 max-w-full break-words text-sm leading-5 font-semibold text-foreground sm:text-[0.95rem]"
            title={title}
          >
            {title}
          </p>

          <p className="mt-1 max-w-full truncate text-xs text-muted-foreground sm:text-sm" title={project}>
            {project}
          </p>
        </div>
      </div>
    </div>
  )
}

export function TimerStartConflictDialog({
  conflict,
  loading,
  onCancel,
  onConfirm,
}: {
  conflict: TimerStartConflict | null
  loading: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={Boolean(conflict)} onOpenChange={(open) => !open && !loading && onCancel()}>
      <DialogContent className="w-[calc(100vw-1rem)] min-w-0 max-w-xl gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="min-w-0 gap-1.5 border-b border-border/70 px-4 py-4 pr-12 sm:px-5 sm:py-5 sm:pr-12">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 hidden size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary sm:flex">
              <Clock3 className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base leading-6 font-semibold sm:text-lg">
                Já existe uma subatividade em execução
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-[48rem] text-xs leading-5 sm:text-sm">
                Você só pode manter um cronômetro ativo por vez. Para iniciar a nova subatividade, pause a atual.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {conflict && (
          <div className="min-w-0 space-y-0 px-3 py-4 sm:px-5 sm:py-5">
            <TaskCard
              eyebrow="Em execução agora"
              title={conflict.currentSubTitle}
              project={conflict.currentProjectName}
              active
            />

            <div className="relative flex h-9 items-center justify-center" aria-hidden>
              <span className="absolute h-full w-px bg-border" />
              <span className="relative flex size-6 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground shadow-sm">
                <ArrowDown className="size-3.5" />
              </span>
            </div>

            <TaskCard
              eyebrow="Iniciar agora"
              title={conflict.targetSubTitle}
              project={conflict.targetProjectName}
            />
          </div>
        )}

        <DialogFooter className="mx-0 mb-0 min-w-0 rounded-none border-t border-border/70 bg-muted/35 px-3 py-3 sm:px-5 sm:py-4">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={loading}
            onClick={onCancel}
          >
            Continuar na atual
          </Button>
          <Button
            type="button"
            className="w-full sm:w-auto"
            loading={loading}
            loadingText="Trocando..."
            onClick={onConfirm}
          >
            <Pause className="size-3.5" />
            Pausar e iniciar esta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
