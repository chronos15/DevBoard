"use client"

import { AlertTriangle, X } from "lucide-react"
import { useStore } from "@/lib/store"

export function BackendErrorBanner() {
  const { lastError, clearError, refreshAll, refreshing } = useStore()
  if (!lastError) return null
  return (
    <div className="fixed right-3 bottom-3 z-[100] w-[min(420px,calc(100vw-24px))] rounded-2xl border border-destructive/25 bg-card p-3 shadow-xl">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><AlertTriangle className="size-4" /></span>
        <div className="min-w-0 flex-1"><p className="text-xs font-semibold">Falha de sincronização</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{lastError}</p><button type="button" disabled={refreshing} onClick={() => void refreshAll()} className="mt-2 text-xs font-semibold text-primary disabled:opacity-60">{refreshing ? "Atualizando..." : "Tentar novamente"}</button></div>
        <button type="button" onClick={clearError} className="rounded-lg p-1 text-muted-foreground hover:bg-muted" aria-label="Fechar"><X className="size-4" /></button>
      </div>
    </div>
  )
}
