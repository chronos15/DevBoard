"use client"

import { AlertTriangle, RefreshCcw, WifiOff, X } from "lucide-react"
import { REALTIME_CONNECTION_ERROR, useStore } from "@/lib/store"

export function BackendErrorBanner() {
  const { lastError, clearError, refreshAll, refreshing } = useStore()
  if (!lastError) return null

  if (lastError === REALTIME_CONNECTION_ERROR) {
    return (
      <div className="fixed right-3 bottom-3 z-[100] flex w-[min(340px,calc(100vw-24px))] items-center gap-2 rounded-xl border border-border bg-card/95 px-2.5 py-2 shadow-lg backdrop-blur">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"><WifiOff className="size-3.5" /></span>
        <p className="min-w-0 flex-1 truncate text-[0.68rem] font-medium text-muted-foreground" title={lastError}>Realtime instável · reconectando…</p>
        <button type="button" disabled={refreshing} onClick={() => void refreshAll()} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50" title="Tentar atualizar agora" aria-label="Tentar atualizar agora"><RefreshCcw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /></button>
        <button type="button" onClick={clearError} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Fechar"><X className="size-3.5" /></button>
      </div>
    )
  }

  return (
    <div className="fixed right-3 bottom-3 z-[100] w-[min(420px,calc(100vw-24px))] rounded-2xl border border-destructive/25 bg-card p-3 shadow-xl">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><AlertTriangle className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold">Não foi possível concluir</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{lastError}</p><button type="button" disabled={refreshing} onClick={() => void refreshAll()} className="mt-2 text-xs font-semibold text-primary disabled:opacity-60">{refreshing ? "Atualizando..." : "Tentar novamente"}</button></div>
        <button type="button" onClick={clearError} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Fechar"><X className="size-4" /></button>
      </div>
    </div>
  )
}
