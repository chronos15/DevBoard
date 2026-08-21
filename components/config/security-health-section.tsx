"use client"

import * as React from "react"
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

type CheckStatus = "ok" | "warning" | "critical"

type SecurityCheck = {
  id: string
  category: string
  label: string
  status: CheckStatus
  detail: string
}

type SecurityHealth = {
  checked_at?: string
  summary?: { ok?: number; warning?: number; critical?: number }
  checks?: SecurityCheck[]
}

function StatusIcon({ status }: { status: CheckStatus }) {
  if (status === "ok") return <CheckCircle2 className="size-4" />
  if (status === "critical") return <ShieldAlert className="size-4" />
  return <AlertTriangle className="size-4" />
}

export function SecurityHealthSection() {
  const supabase = React.useMemo(() => createClient(), [])
  const [health, setHealth] = React.useState<SecurityHealth | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: rpcError } = await supabase.rpc("devboard_security_health")
    if (rpcError) {
      setError(/devboard_security_health|does not exist|schema cache/i.test(rpcError.message ?? "")
        ? "Execute a migration 020 para habilitar o diagnóstico administrativo de segurança."
        : rpcError.message)
      setLoading(false)
      return
    }
    setHealth((data ?? null) as SecurityHealth | null)
    setLoading(false)
  }, [supabase])

  React.useEffect(() => { void load() }, [load])

  const checks = health?.checks ?? []
  const critical = Number(health?.summary?.critical ?? 0)
  const warning = Number(health?.summary?.warning ?? 0)
  const ok = Number(health?.summary?.ok ?? 0)

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Segurança e diagnóstico</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">Verificação somente leitura das proteções do backend. Nenhuma chave, token ou dado sensível é exibido aqui.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-50">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />Verificar novamente
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-warning/25 bg-warning/5 p-4">
          <div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><div><p className="text-sm font-semibold">Diagnóstico indisponível</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{error}</p></div></div>
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />Auditando configurações do backend...</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:max-w-lg">
            <div className="rounded-xl border border-success/20 bg-success/5 px-3 py-3"><p className="text-[0.65rem] font-medium text-muted-foreground">Protegido</p><p className="mt-1 text-xl font-semibold text-success">{ok}</p></div>
            <div className="rounded-xl border border-warning/20 bg-warning/5 px-3 py-3"><p className="text-[0.65rem] font-medium text-muted-foreground">Revisar</p><p className="mt-1 text-xl font-semibold text-warning">{warning}</p></div>
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-3"><p className="text-[0.65rem] font-medium text-muted-foreground">Crítico</p><p className="mt-1 text-xl font-semibold text-destructive">{critical}</p></div>
          </div>

          <div className="mt-5 grid gap-2">
            {checks.map((check) => (
              <div key={check.id} className="flex min-w-0 items-start gap-3 rounded-xl border border-border bg-muted/20 p-3.5">
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg", check.status === "ok" ? "bg-success/10 text-success" : check.status === "critical" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}><StatusIcon status={check.status} /></span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><p className="text-sm font-semibold">{check.label}</p><span className="rounded-full bg-muted px-2 py-0.5 text-[0.6rem] font-semibold text-muted-foreground">{check.category}</span></div><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{check.detail}</p></div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-border bg-muted/25 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mr-2 inline size-3.5 text-success" />A publishable key do Supabase pode existir no navegador. A proteção real continua sendo RLS, policies, RPCs restritos e ausência de segredos administrativos no frontend.
          </div>
        </>
      )}
    </div>
  )
}
