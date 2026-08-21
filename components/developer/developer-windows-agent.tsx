"use client"

import * as React from "react"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Keyboard,
  Laptop,
  RefreshCw,
  ShieldCheck,
  WifiOff,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

const CURRENT_AGENT_VERSION = "0.2.0"
const ONLINE_WINDOW_MS = 35_000

type AgentStatus = {
  id: string
  machine_name: string | null
  agent_version: string | null
  os_name: string | null
  hotkey_ok: boolean | null
  installed_at: string | null
  last_seen_at: string | null
  created_at: string
}

function relativeHeartbeat(value: string | null, now: number) {
  if (!value) return "Aguardando primeira conexão"
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (seconds < 5) return "Sinal agora"
  if (seconds < 60) return `Último sinal há ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Último sinal há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `Último sinal há ${hours}h`
}

export function DeveloperWindowsAgent({ currentUserId, onNotice }: { currentUserId: string; onNotice?: (message: string) => void }) {
  const supabase = React.useMemo(() => createClient(), [])
  const [agents, setAgents] = React.useState<AgentStatus[]>([])
  const [loading, setLoading] = React.useState(true)
  const [downloading, setDownloading] = React.useState(false)
  const [backendMissing, setBackendMissing] = React.useState(false)
  const [now, setNow] = React.useState(() => Date.now())

  const loadStatus = React.useCallback(async (silent = false) => {
    if (!currentUserId) return
    if (!silent) setLoading(true)
    const { data, error } = await supabase.rpc("developer_agent_status")
    if (error) {
      const missing = /developer_agent_status|function .* does not exist|schema cache/i.test(error.message ?? "")
      setBackendMissing(missing)
      if (!silent && !missing) onNotice?.("Não foi possível verificar o Devboard Agent.")
      if (!silent) setLoading(false)
      return
    }
    setBackendMissing(false)
    setAgents((data ?? []) as AgentStatus[])
    if (!silent) setLoading(false)
  }, [currentUserId, onNotice, supabase])

  React.useEffect(() => {
    void loadStatus()
    const poll = window.setInterval(() => void loadStatus(true), 8_000)
    const clock = window.setInterval(() => setNow(Date.now()), 1_000)
    const onVisibility = () => {
      if (document.visibilityState === "visible") void loadStatus(true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(clock)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [loadStatus])

  const onlineAgent = agents.find((agent) => agent.last_seen_at && now - new Date(agent.last_seen_at).getTime() <= ONLINE_WINDOW_MS)
  const selected = onlineAgent ?? agents[0] ?? null
  const isOnline = Boolean(onlineAgent)
  const needsUpdate = Boolean(isOnline && selected?.agent_version && selected.agent_version !== CURRENT_AGENT_VERSION)
  const shortcutReady = Boolean(isOnline && selected?.hotkey_ok !== false)

  async function downloadInstaller() {
    if (downloading) return
    setDownloading(true)
    try {
      const response = await fetch("/api/dev-agent/installer", { method: "GET", cache: "no-store" })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error || "Não foi possível gerar o instalador.")
      }
      const blob = await response.blob()
      const href = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = href
      anchor.download = "DevboardAgentSetup.exe"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000)
      onNotice?.("Instalador baixado. Execute-o uma vez; o painel detecta o agente automaticamente.")
      window.setTimeout(() => void loadStatus(true), 2_000)
    } catch (error) {
      onNotice?.(error instanceof Error ? error.message : "Não foi possível baixar o Devboard Agent.")
    } finally {
      setDownloading(false)
    }
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card">
      <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-4">
        <span className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          shortcutReady
            ? "bg-success/10 text-success"
            : isOnline
              ? "bg-warning/10 text-warning"
              : "bg-muted text-muted-foreground",
        )}>
          <Laptop className="size-[1.1rem]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-semibold sm:text-base">Integração Windows</h2>
            {shortcutReady ? (
              <span className="size-2 shrink-0 rounded-full bg-success" aria-label="Agente e atalho funcionando" />
            ) : isOnline ? (
              <span className="size-2 shrink-0 rounded-full bg-warning" aria-label="Agente online, atalho indisponível" />
            ) : null}
          </div>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Atalho global e launcher local sem configuração manual.
          </p>
        </div>
      </div>

      <div className="p-4">
        {backendMissing ? (
          <div className="rounded-xl border border-warning/25 bg-warning/5 p-3">
            <p className="text-xs font-semibold">Integração ainda não preparada</p>
            <p className="mt-1 text-[0.67rem] leading-relaxed text-muted-foreground">
              Execute a migration 018 para habilitar instalação e monitoramento do agente.
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" />Verificando agente...
          </div>
        ) : selected ? (
          <div className={cn(
            "rounded-xl border p-3",
            shortcutReady
              ? "border-success/20 bg-success/[0.04]"
              : isOnline
                ? "border-warning/25 bg-warning/[0.04]"
                : "border-border bg-background/45",
          )}>
            <div className="flex min-w-0 items-start gap-3">
              <span className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                shortcutReady
                  ? "bg-success/10 text-success"
                  : isOnline
                    ? "bg-warning/10 text-warning"
                    : "bg-muted text-muted-foreground",
              )}>
                {shortcutReady ? (
                  <CheckCircle2 className="size-4" />
                ) : isOnline ? (
                  <AlertTriangle className="size-4" />
                ) : (
                  <WifiOff className="size-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">
                  {shortcutReady
                    ? `Funcionando${selected.machine_name ? ` em ${selected.machine_name}` : ""}`
                    : isOnline
                      ? `Agente online${selected.machine_name ? ` em ${selected.machine_name}` : ""}, atalho indisponível`
                      : "Agente não está respondendo"}
                </p>
                <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
                  {relativeHeartbeat(selected.last_seen_at, now)}
                  {selected.agent_version ? ` · v${selected.agent_version}` : ""}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/55 px-2.5 py-2">
                <Keyboard className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[0.61rem] text-muted-foreground">Atalho global</p>
                  <p className={cn("truncate text-[0.68rem] font-semibold", selected.hotkey_ok === false && "text-warning")}>Ctrl + Shift + 7</p>
                </div>
              </div>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/70 bg-background/55 px-2.5 py-2">
                <ShieldCheck className="size-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="text-[0.61rem] text-muted-foreground">Inicialização</p>
                  <p className="truncate text-[0.68rem] font-semibold">Automática com Windows</p>
                </div>
              </div>
            </div>

            {selected.hotkey_ok === false && (
              <p className="mt-2 text-[0.65rem] leading-relaxed text-warning">
                O agente está online, mas o atalho global não pôde ser ativado. Atualize o Agent para usar o fallback automático.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center">
            <Laptop className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-xs font-semibold">Devboard Agent não encontrado</p>
            <p className="mx-auto mt-1 max-w-[310px] text-[0.66rem] leading-relaxed text-muted-foreground">
              Instale uma vez. Ele inicia sozinho com o Windows e permite abrir o Painel Dev mesmo com o navegador fechado.
            </p>
          </div>
        )}

        <button
          type="button"
          disabled={downloading || backendMissing}
          onClick={() => void downloadInstaller()}
          className={cn(
            "mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            shortcutReady && !needsUpdate ? "border border-border bg-background hover:bg-muted" : "bg-primary text-primary-foreground",
          )}
        >
          {downloading ? <RefreshCw className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
          {downloading ? "Preparando instalador..." : needsUpdate ? "Atualizar agente" : isOnline ? "Baixar novamente" : "Baixar e instalar"}
        </button>

        <p className="mt-2 text-center text-[0.61rem] leading-relaxed text-muted-foreground">
          Sem formulário ou pareamento: o download já é vinculado à sua conta.
        </p>
      </div>
    </section>
  )
}
