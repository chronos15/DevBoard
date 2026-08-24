"use client"

import * as React from "react"
import { ExternalLink, FolderOpen, Hammer, LoaderCircle, Play, RefreshCw, RotateCcw, Square, TerminalSquare, TestTube2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { DeveloperLocalProjectRecord } from "@/lib/developer/context"
import {
  DeveloperRuntimeError,
  getDeveloperRuntimeStatus,
  runDeveloperRuntimeAction,
  type DeveloperRuntimeStatus,
} from "@/lib/developer/runtime"
import { getDeveloperAgentHealth } from "@/lib/developer/windows-agent"

const RUNTIME_MIN_AGENT_VERSION = "0.5.0"

function compareVersions(a: string | null | undefined, b: string) {
  const parse = (value: string | null | undefined) => String(value ?? "")
    .replace(/^v/i, "")
    .split(".")
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) < (right[index] ?? 0)) return -1
    if ((left[index] ?? 0) > (right[index] ?? 0)) return 1
  }
  return 0
}

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
  const [error, setError] = React.useState<DeveloperRuntimeError | null>(null)
  const [agentVersion, setAgentVersion] = React.useState<string | null>(null)

  const refresh = React.useCallback(async (options?: { silent?: boolean; pickFolder?: boolean }) => {
    if (!project) return
    const silent = options?.silent === true
    if (!silent) setLoading(true)
    try {
      const health = await getDeveloperAgentHealth()
      const version = health?.version ?? null
      setAgentVersion(version)
      if (!health?.ok) {
        throw new DeveloperRuntimeError("O Devboard Agent não está respondendo neste computador.", { code: "agent_unavailable" })
      }
      if (version && compareVersions(version, RUNTIME_MIN_AGENT_VERSION) < 0) {
        throw new DeveloperRuntimeError(
          `O Agent v${version} está online, mas Executar/Build/Testes exige v${RUNTIME_MIN_AGENT_VERSION} ou superior. A atualização automática será aplicada pelo Agent.`,
          { code: "agent_outdated" },
        )
      }

      const next = await getDeveloperRuntimeStatus(project, options?.pickFolder === true)
      setStatus(next)
      setError(null)
    } catch (caught) {
      const nextError = caught instanceof DeveloperRuntimeError
        ? caught
        : new DeveloperRuntimeError(caught instanceof Error ? caught.message : "Não foi possível identificar o ambiente local.")
      setError(nextError)
      if (!silent && nextError.code !== "folder_not_found" && nextError.code !== "agent_outdated") {
        onNotice(nextError.message)
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [onNotice, project])

  React.useEffect(() => {
    if (!open || !project) return
    setStatus(null)
    setError(null)
    setAgentVersion(null)
    // Primeiro apenas consulta o vínculo existente. O seletor do Windows só aparece
    // quando o usuário clicar explicitamente em "Vincular pasta".
    void refresh({ silent: false, pickFolder: false })
  }, [open, project?.id, refresh])

  React.useEffect(() => {
    if (!open || !project || !status?.running) return
    const timer = window.setInterval(() => {
      void getDeveloperRuntimeStatus(project, false)
        .then((next) => { setStatus(next); setError(null) })
        .catch(() => undefined)
    }, 1800)
    return () => window.clearInterval(timer)
  }, [open, project, status?.running])

  async function action(value: "run" | "build" | "test" | "terminal" | "stop" | "restart") {
    if (!project || busy) return
    setBusy(value)
    try {
      // A pasta deve estar vinculada antes da execução. Isso evita abrir o picker no
      // meio de uma ação e deixa o fluxo previsível.
      const next = await runDeveloperRuntimeAction(project, value, false)
      setStatus(next)
      setError(null)
      if (value === "terminal") onNotice("Terminal aberto na pasta do projeto.")
      else if (value === "stop") onNotice("Processo local encerrado.")
      else onNotice(`${next.runningLabel || value} iniciado pelo Devboard Agent.`)
    } catch (caught) {
      const nextError = caught instanceof DeveloperRuntimeError
        ? caught
        : new DeveloperRuntimeError(caught instanceof Error ? caught.message : "Não foi possível executar esta ação.")
      setError(nextError)
      onNotice(nextError.message)
    } finally {
      setBusy(null)
    }
  }

  const caps = status?.capabilities
  const log = status?.logTail ?? []
  const folderMissing = error?.code === "folder_not_found"
  const outdated = error?.code === "agent_outdated"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(650px,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] max-w-xl overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-4 py-3.5 pr-11 text-left sm:px-5">
          <DialogTitle className="text-base">Executar projeto</DialogTitle>
          <DialogDescription className="truncate text-xs">
            {project?.name ?? "Projeto local"}{caps?.label ? ` · ${caps.label}` : agentVersion ? ` · Agent v${agentVersion}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto p-3.5 sm:p-4">
          {loading && !status ? (
            <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Detectando o ambiente do projeto...</div>
          ) : status ? (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                <span className={cn("size-2 shrink-0 rounded-full", status.running ? "bg-success animate-pulse" : status.exitCode && status.exitCode !== 0 ? "bg-destructive" : "bg-muted-foreground/35")} />
                <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{status.running ? status.runningLabel || "Processo em execução" : status.lastResult || "Nenhum processo em execução"}</p><p className="mt-0.5 truncate text-[0.62rem] text-muted-foreground" title={status.path}>{status.path}</p></div>
                {status.running && <div className="flex shrink-0 items-center gap-1.5"><button type="button" onClick={() => void action("restart")} disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[0.64rem] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><RotateCcw className={cn("size-3", busy === "restart" && "animate-spin")} />Reiniciar</button><button type="button" onClick={() => void action("stop")} disabled={busy !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/25 bg-destructive/5 px-2.5 text-[0.64rem] font-semibold text-destructive"><Square className="size-3" />Parar</button></div>}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <ActionButton icon={Play} label={caps?.runLabel || "Executar"} disabled={!caps?.canRun || status.running || busy !== null} loading={busy === "run"} onClick={() => void action("run")} />
                <ActionButton icon={Hammer} label={caps?.buildLabel || "Build"} disabled={!caps?.canBuild || status.running || busy !== null} loading={busy === "build"} onClick={() => void action("build")} />
                <ActionButton icon={TestTube2} label={caps?.testLabel || "Testes"} disabled={!caps?.canTest || status.running || busy !== null} loading={busy === "test"} onClick={() => void action("test")} />
                <ActionButton icon={TerminalSquare} label="Terminal" disabled={!caps?.canTerminal || busy !== null} loading={busy === "terminal"} onClick={() => void action("terminal")} />
              </div>

              {status.running && status.ports?.length > 0 && (
                <div className="rounded-xl border border-border bg-muted/15 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2"><p className="text-[0.62rem] font-semibold text-muted-foreground">Serviços locais detectados</p><span className="text-[0.58rem] text-muted-foreground">{status.ports.length} porta{status.ports.length === 1 ? "" : "s"}</span></div>
                  <div className="mt-2 flex flex-wrap gap-1.5">{status.ports.map((item) => <a key={`${item.pid}-${item.port}`} href={item.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[0.63rem] font-semibold hover:bg-muted" title={item.address}><span className="size-1.5 rounded-full bg-success" />:{item.port}<ExternalLink className="size-3 text-muted-foreground" /></a>)}</div>
                </div>
              )}

              <div className="rounded-xl border border-border bg-[#0d1117] p-3 text-[#c9d1d9] dark:bg-black/35">
                <div className="mb-2 flex items-center justify-between gap-2"><p className="font-mono text-[0.62rem] font-semibold">Saída local</p><button type="button" onClick={() => void refresh({ silent: true, pickFolder: false })} className="text-[0.6rem] text-[#8b949e] hover:text-white">Atualizar</button></div>
                <div className="max-h-56 overflow-y-auto overscroll-contain font-mono text-[0.62rem] leading-relaxed">
                  {log.length ? log.map((line, index) => <div key={`${index}-${line}`} className="whitespace-pre-wrap break-all">{line}</div>) : <p className="text-[#8b949e]">A saída de Build/Test/Run aparecerá aqui sem abrir outro console.</p>}
                </div>
              </div>

              <p className="text-[0.62rem] leading-relaxed text-muted-foreground">O frontend não envia comandos livres ao Windows. O Agent detecta o tipo do projeto e executa apenas ações conhecidas e permitidas.</p>
            </div>
          ) : error ? (
            <div className={cn("rounded-xl border p-3", outdated ? "border-primary/20 bg-primary/5" : "border-warning/20 bg-warning/5")}>
              <p className="text-xs font-semibold text-foreground">
                {folderMissing ? "Pasta do projeto não vinculada neste computador" : outdated ? "Agent aguardando atualização" : "Não foi possível preparar este projeto"}
              </p>
              <p className="mt-1 text-[0.67rem] leading-relaxed text-muted-foreground">{error.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {folderMissing && (
                  <button type="button" onClick={() => void refresh({ silent: false, pickFolder: true })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[0.67rem] font-semibold text-background">
                    <FolderOpen className="size-3.5" />Vincular pasta
                  </button>
                )}
                <button type="button" onClick={() => void refresh({ silent: false, pickFolder: false })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[0.67rem] font-semibold text-foreground hover:bg-muted">
                  <RefreshCw className="size-3.5" />Tentar novamente
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ActionButton({ icon: Icon, label, disabled, loading, onClick }: { icon: React.ElementType; label: string; disabled: boolean; loading: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-2 text-center text-[0.65rem] font-semibold transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}<span className="line-clamp-2">{label}</span></button>
}
