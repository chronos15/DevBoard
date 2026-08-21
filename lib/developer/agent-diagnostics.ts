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

export async function getDeveloperAgentDiagnostics(): Promise<DeveloperAgentDiagnostics | null> {
  if (typeof window === "undefined") return null
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 2500)
  try {
    const response = await fetch(`${AGENT_ORIGIN}/v1/diagnostics`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: AGENT_HEADER,
    })
    if (!response.ok) return null
    return await response.json() as DeveloperAgentDiagnostics
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}
