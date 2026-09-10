"use client"

import * as React from "react"
import { Coffee, MoveRight, Pause, Sandwich, UserRound } from "lucide-react"
import { useStore } from "@/lib/store"
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

const PAUSE_PRESETS = [
  { label: "Almoço", icon: Coffee },
  { label: "Lanche", icon: Sandwich },
  { label: "Pausa particular", icon: UserRound },
  { label: "Transição de atividade", icon: MoveRight },
] as const

type PauseRequestContextValue = {
  requestPause: (subactivityId: string) => Promise<boolean>
}

const PauseRequestContext = React.createContext<PauseRequestContextValue | null>(null)

type PendingPause = {
  subactivityId: string
  resolve: (value: boolean) => void
}

export function PauseSubactivityProvider({ children }: { children: React.ReactNode }) {
  const { findSub, stopTimer } = useStore()
  const [pending, setPending] = React.useState<PendingPause | null>(null)
  const [reason, setReason] = React.useState("")
  const [pausing, setPausing] = React.useState(false)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)

  const close = React.useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result)
      return null
    })
    setReason("")
  }, [])

  const requestPause = React.useCallback((subactivityId: string) => {
    return new Promise<boolean>((resolve) => {
      setPending((current) => {
        current?.resolve(false)
        return { subactivityId, resolve }
      })
      setReason("")
      window.requestAnimationFrame(() => inputRef.current?.focus())
    })
  }, [])

  const found = pending ? findSub(pending.subactivityId) : null
  const cleanReason = reason.trim()

  const confirmPause = React.useCallback(async () => {
    if (!pending || pausing || cleanReason.length < 2) return
    setPausing(true)
    try {
      const ok = await stopTimer(pending.subactivityId, cleanReason)
      if (ok) close(true)
    } finally {
      setPausing(false)
    }
  }, [cleanReason, close, pausing, pending, stopTimer])

  return (
    <PauseRequestContext.Provider value={{ requestPause }}>
      {children}

      <Dialog
        open={Boolean(pending)}
        onOpenChange={(open) => {
          if (!open && !pausing) close(false)
        }}
      >
        <DialogContent className="w-[calc(100vw-1.5rem)] overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border px-4 pb-4 pt-5 sm:px-5">
            <div className="flex items-start gap-3 pr-7">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Pause className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle>Pausar subatividade</DialogTitle>
                <DialogDescription className="mt-1.5 leading-relaxed">
                  {found ? (
                    <>Informe o motivo da pausa em <strong className="font-medium text-foreground">“{found.sub.title}”</strong>. Ele ficará registrado no histórico.</>
                  ) : (
                    <>Informe o motivo da pausa. Ele ficará registrado no histórico.</>
                  )}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-4 px-4 py-4 sm:px-5">
            <div>
              <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Motivos rápidos</p>
              <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                {PAUSE_PRESETS.map(({ label, icon: Icon }) => {
                  const selected = cleanReason === label
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => {
                        setReason(label)
                        window.requestAnimationFrame(() => inputRef.current?.focus())
                      }}
                      className={cn(
                        "flex min-h-11 min-w-0 items-center gap-2 rounded-xl border px-3 text-left text-xs font-medium transition-colors",
                        selected
                          ? "border-primary/35 bg-primary/10 text-primary"
                          : "border-border bg-card text-foreground hover:bg-muted",
                      )}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span className="min-w-0 leading-snug">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <label className="block">
              <span className="mb-2 block text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ou descreva o motivo</span>
              <textarea
                ref={inputRef}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                    event.preventDefault()
                    void confirmPause()
                  }
                }}
                rows={3}
                maxLength={300}
                placeholder="Ex.: aguardando retorno do cliente..."
                className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
              />
              <span className="mt-1.5 flex justify-between gap-3 text-[0.62rem] text-muted-foreground">
                <span>Ctrl + Enter para confirmar</span>
                <span>{reason.length}/300</span>
              </span>
            </label>
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-none px-4 py-3 sm:px-5">
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={pausing}>
              Cancelar
            </Button>
            <Button type="button" loading={pausing} loadingText="Pausando..." disabled={cleanReason.length < 2} onClick={() => void confirmPause()}>
              <Pause className="size-3.5" />
              Pausar subatividade
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PauseRequestContext.Provider>
  )
}

export function usePauseSubactivity() {
  const context = React.useContext(PauseRequestContext)
  if (!context) throw new Error("usePauseSubactivity deve ser usado dentro de PauseSubactivityProvider")
  return context
}
