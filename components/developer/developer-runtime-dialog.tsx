"use client"

import * as React from "react"
import { Hammer, LoaderCircle, Play, Square, TerminalSquare, TestTube2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { DeveloperLocalProjectRecord } from "@/lib/developer/context"
import { getDeveloperRuntimeStatus, runDeveloperRuntimeAction, type DeveloperRuntimeStatus } from "@/lib/developer/runtime"

export function DeveloperRuntimeDialog({
  open,
  onOpenChange,
  project,
  onNotice,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: DeveloperLocalProjectRecord | null
  onNotice: (message: string | null) => void
}) {
  const [status, setStatus] = React.useState<DeveloperRuntimeStatus | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState<string | null>(null)

  const refresh = React.useCallback(async (silent = false) => {
    if (!project) return
    if (!silent) setLoading(true)
    try {
      setStatus(await getDeveloperRuntimeStatus(project, !status))
    } catch (error) {
      if (!silent) onNotice(error instanceof Error ? error.message : "Não foi possível identificar o ambiente local.")
    } finally {
      if (!silent) setLoading(false)
    }
  }, [onNotice, project, status])

  React.useEffect(() => {
    if (!open || !project) return
    setStatus(null)
    void refresh(false)
  // project.id precisa reinicializar o dialog; o status não deve reiniciar o próprio efeito.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project?.id])

  React.useEffect(() => {
    if (!open || !project || !status?.running) return
    const timer = window.setInterval(() => void getDeveloperRuntimeStatus(project, false).then(setStatus).catch(() => undefined), 1800)
    return () => window.clearInterval(timer)
  }, [open, project, status?.running])

  async function action(value: "run" | "build" | "test" | "terminal" | "stop") {
    if (!project || busy) return
    setBusy(value)
    try {
      const next = await runDeveloperRuntimeAction(project, value, true)
      setStatus(next)
      if (value === "terminal") onNotice("Terminal aberto na pasta do projeto.")
      else if (value === "stop") onNotice("Processo local encerrado.")
      else onNotice(`${next.runningLabel || value} iniciado pelo Devboard Agent.`)
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Não foi possível executar esta ação.")
    } finally {
      setBusy(null)
    }
  }

  const caps = status?.capabilities
  const log = status?.logTail ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(650px,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] max-w-xl overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-4 py-3.5 pr-11 text-left sm:px-5">
          <DialogTitle className="text-base">Executar projeto</DialogTitle>
          <DialogDescription className="truncate text-xs">{project?.name ?? "Projeto local"}{caps?.label ? ` · ${caps.label}` : ""}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto p-3.5 sm:p-4">
          {loading && !status ? (
            <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Detectando o ambiente do projeto...</div>
          ) : status ? (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                <span className={cn("size-2 shrink-0 rounded-full", status.running ? "bg-success animate-pulse" : status.exitCode && status.exitCode !== 0 ? "bg-destructive" : "bg-muted-foreground/35")} />
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{status.running ? status.runningLabel || "Processo em execução" : status.lastResult || "Nenhum processo em execução"}</p><p className="mt-0.5 truncate text-[0.62rem] text-muted-foreground" title={status.path}>{status.path}</p></div>
                {status.running && <button type="button" onClick={() => void action("stop")} disabled={busy !== null} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 text-[0.64rem] font-semibold text-destructive"><Square className="size-3" />Parar</button>}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ActionButton icon={Play} label={caps?.runLabel || "Executar"} disabled={!caps?.canRun || status.running || busy !== null} loading={busy === "run"} onClick={() => void action("run")} />
                <ActionButton icon={Hammer} label={caps?.buildLabel || "Build"} disabled={!caps?.canBuild || status.running || busy !== null} loading={busy === "build"} onClick={() => void action("build")} />
                <ActionButton icon={TestTube2} label={caps?.testLabel || "Testes"} disabled={!caps?.canTest || status.running || busy !== null} loading={busy === "test"} onClick={() => void action("test")} />
                <ActionButton icon={TerminalSquare} label="Terminal" disabled={!caps?.canTerminal || busy !== null} loading={busy === "terminal"} onClick={() => void action("terminal")} />
              </div>

              <div className="rounded-xl border border-border bg-[#0d1117] p-3 text-[#c9d1d9] dark:bg-black/35">
                <div className="mb-2 flex items-center justify-between gap-2"><p className="font-mono text-[0.62rem] font-semibold">Saída local</p><button type="button" onClick={() => void refresh(true)} className="text-[0.6rem] text-[#8b949e] hover:text-white">Atualizar</button></div>
                <div className="max-h-56 overflow-y-auto overscroll-contain font-mono text-[0.62rem] leading-relaxed">
                  {log.length ? log.map((line, index) => <div key={`${index}-${line}`} className="whitespace-pre-wrap break-all">{line}</div>) : <p className="text-[#8b949e]">A saída de Build/Test/Run aparecerá aqui sem abrir outro console.</p>}
                </div>
              </div>

              <p className="text-[0.62rem] leading-relaxed text-muted-foreground">O frontend não envia comandos livres ao Windows. O Agent detecta o tipo do projeto e executa apenas ações conhecidas e permitidas.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-warning/20 bg-warning/5 p-3 text-xs text-muted-foreground">Não foi possível identificar este projeto. Verifique o vínculo da pasta e a versão do Devboard Agent.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ActionButton({ icon: Icon, label, disabled, loading, onClick }: { icon: React.ElementType; label: string; disabled: boolean; loading: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-2 text-center text-[0.65rem] font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}<span className="line-clamp-2">{label}</span></button>
}
