"use client"

import { ArrowRight, Clock3, Pause, Play } from "lucide-react"
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Já existe uma subatividade em execução</DialogTitle>
          <DialogDescription>
            Para manter apenas um cronômetro ativo por responsável, pause a subatividade atual antes de iniciar a nova.
          </DialogDescription>
        </DialogHeader>

        {conflict && (
          <div className="space-y-2.5 py-1">
            <div className="rounded-xl border border-primary/20 bg-primary/[0.045] p-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Clock3 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.62rem] font-semibold tracking-wide text-primary uppercase">Em execução agora</p>
                  <p className="mt-0.5 truncate text-sm font-semibold" title={conflict.currentSubTitle}>{conflict.currentSubTitle}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={conflict.currentProjectName}>{conflict.currentProjectName}</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-center text-muted-foreground/70">
              <ArrowRight className="size-4 rotate-90 sm:rotate-0" />
            </div>

            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                  <Play className="size-3.5 translate-x-px" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.62rem] font-semibold tracking-wide text-muted-foreground uppercase">Iniciar agora</p>
                  <p className="mt-0.5 truncate text-sm font-semibold" title={conflict.targetSubTitle}>{conflict.targetSubTitle}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground" title={conflict.targetProjectName}>{conflict.targetProjectName}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={loading} onClick={onCancel}>
            Manter a atual
          </Button>
          <Button type="button" loading={loading} loadingText="Trocando..." onClick={onConfirm}>
            <Pause className="size-3.5" />
            Pausar e iniciar esta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
