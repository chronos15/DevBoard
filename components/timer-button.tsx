"use client"

import * as React from "react"
import { LoaderCircle, LockKeyhole, Pause, Play } from "lucide-react"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

export function TimerButton({
  subId,
  size = "md",
}: {
  subId: string
  size?: "sm" | "md"
}) {
  const { runningSubIds, startTimer, stopTimer, findSub, canManageSubactivity } = useStore()
  const [loading, setLoading] = React.useState(false)
  const found = findSub(subId)
  const canManage = found ? canManageSubactivity(found.sub) : false
  const running = runningSubIds.includes(subId)

  async function toggleTimer() {
    if (!canManage || loading) return
    setLoading(true)
    try {
      await (running ? stopTimer(subId) : startTimer(subId))
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      disabled={!canManage || loading}
      aria-busy={loading || undefined}
      onClick={() => { void toggleTimer() }}
      aria-label={
        canManage
          ? running
            ? "Pausar cronômetro"
            : "Iniciar cronômetro"
          : "Somente o Desenvolvedor responsável ou um Administrador pode controlar esta subatividade"
      }
      title={
        canManage
          ? running
            ? "Pausar cronômetro"
            : "Iniciar cronômetro"
          : "Somente o Desenvolvedor responsável ou um Administrador pode alterar esta subatividade"
      }
      className={cn(
        "flex items-center justify-center rounded-full transition-all",
        size === "sm" ? "size-8" : "size-10",
        loading && "cursor-wait",
        !canManage
          ? "cursor-not-allowed bg-muted text-muted-foreground/45"
          : running
            ? "bg-primary text-primary-foreground shadow-sm shadow-primary/30"
            : "bg-muted text-foreground hover:bg-primary/12 hover:text-primary",
      )}
    >
      {loading ? (
        <LoaderCircle className={cn("animate-spin", size === "sm" ? "size-3.5" : "size-4")} />
      ) : !canManage ? (
        <LockKeyhole className={size === "sm" ? "size-3.5" : "size-4"} />
      ) : running ? (
        <Pause className={size === "sm" ? "size-3.5" : "size-4"} />
      ) : (
        <Play
          className={cn("translate-x-px", size === "sm" ? "size-3.5" : "size-4")}
        />
      )}
    </button>
  )
}
