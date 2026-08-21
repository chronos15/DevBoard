import type { DeveloperLocalProjectRecord } from "@/lib/developer/context"

const AGENT_ORIGIN = "http://127.0.0.1:43827"
const AGENT_HEADER = { "X-Devboard-Agent": "1" }

export type DeveloperRuntimeCapabilities = {
  kind: string
  label: string
  canRun: boolean
  canBuild: boolean
  canTest: boolean
  canTerminal: boolean
  runLabel?: string
  buildLabel?: string
  testLabel?: string
}

export type DeveloperRuntimeStatus = {
  ok: boolean
  path: string
  capabilities: DeveloperRuntimeCapabilities
  running: boolean
  runningAction?: "run" | "build" | "test"
  runningLabel?: string
  startedAt?: string
  pid?: number
  exitCode?: number | null
  lastResult?: string
  logTail: string[]
}

function payload(project: DeveloperLocalProjectRecord, allowFolderPicker = false) {
  return { projectId: project.id, projectName: project.name, folderName: project.folderName, legacyPath: project.legacyPath, allowFolderPicker }
}

async function runtimeFetch(path: string, body: unknown, timeoutMs = 5000): Promise<DeveloperRuntimeStatus> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${AGENT_ORIGIN}${path}`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { ...AGENT_HEADER, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(String(data?.error || "Não foi possível executar esta ação pelo Devboard Agent."))
    return data as DeveloperRuntimeStatus
  } finally {
    window.clearTimeout(timeout)
  }
}

export function getDeveloperRuntimeStatus(project: DeveloperLocalProjectRecord, allowFolderPicker = false) {
  return runtimeFetch("/v1/runtime/status", payload(project, allowFolderPicker), allowFolderPicker ? 120_000 : 5000)
}

export function runDeveloperRuntimeAction(project: DeveloperLocalProjectRecord, action: "run" | "build" | "test" | "terminal" | "stop", allowFolderPicker = true) {
  return runtimeFetch("/v1/runtime/action", { ...payload(project, allowFolderPicker), action }, allowFolderPicker ? 120_000 : 7000)
}
