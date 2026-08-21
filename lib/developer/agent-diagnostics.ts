const AGENT_ORIGIN = "http://127.0.0.1:43827"
const AGENT_HEADER = { "X-Devboard-Agent": "1" }

export type DeveloperAgentToolDiagnostic = {
  id: string
  label: string
  found: boolean
  path?: string
  detail?: string
  group: string
}

export type DeveloperAgentDiagnostics = {
  ok: boolean
  version: string
  machine: string
  hotkeyOk: boolean
  trayOk: boolean
  autoUpdate: boolean
  pwaInstalled: boolean
  pwaBrowser?: string
  pwaShortcut?: string
  tools: DeveloperAgentToolDiagnostic[]
}

export class DeveloperAgentDiagnosticsError extends Error {
  code?: string
  status?: number

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message)
    this.name = "DeveloperAgentDiagnosticsError"
    this.code = options?.code
    this.status = options?.status
  }
}

export async function getDeveloperAgentDiagnostics(): Promise<DeveloperAgentDiagnostics> {
  if (typeof window === "undefined") throw new DeveloperAgentDiagnosticsError("Diagnóstico local disponível apenas no navegador.")

  // A primeira coleta pode consultar atalhos de PWA, IDEs e ferramentas instaladas.
  // Em máquinas com discos/antivírus mais lentos, 2,5s era pouco e fazia a UI concluir
  // incorretamente que o Agent não suportava diagnóstico.
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`${AGENT_ORIGIN}/v1/diagnostics`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: AGENT_HEADER,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new DeveloperAgentDiagnosticsError(
        String(payload?.error || `Devboard Agent respondeu ${response.status}.`),
        { code: payload?.code, status: response.status },
      )
    }
    return payload as DeveloperAgentDiagnostics
  } catch (error) {
    if (error instanceof DeveloperAgentDiagnosticsError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DeveloperAgentDiagnosticsError("O diagnóstico local demorou mais que o esperado. Tente novamente.", { code: "timeout" })
    }
    throw new DeveloperAgentDiagnosticsError("Não foi possível consultar o diagnóstico local do Agent.", { code: "unavailable" })
  } finally {
    window.clearTimeout(timeout)
  }
}
