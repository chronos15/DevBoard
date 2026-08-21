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

export class DeveloperRuntimeError extends Error {
  code?: string
  status?: number

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message)
    this.name = "DeveloperRuntimeError"
    this.code = options?.code
    this.status = options?.status
  }
}

function payload(project: DeveloperLocalProjectRecord, allowFolderPicker = false) {
  return {
    projectId: project.id,
    projectName: project.name,
    folderName: project.folderName,
    legacyPath: project.legacyPath,
    allowFolderPicker,
  }
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
    if (!response.ok) {
      throw new DeveloperRuntimeError(
        String(data?.error || `Devboard Agent respondeu ${response.status}.`),
        { code: data?.code, status: response.status },
      )
    }
    return data as DeveloperRuntimeStatus
  } catch (error) {
    if (error instanceof DeveloperRuntimeError) throw error
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new DeveloperRuntimeError("O Devboard Agent demorou mais que o esperado para responder.", { code: "timeout" })
    }
    throw new DeveloperRuntimeError("Não foi possível comunicar com o Devboard Agent.", { code: "agent_unavailable" })
  } finally {
    window.clearTimeout(timeout)
  }
}

export function getDeveloperRuntimeStatus(project: DeveloperLocalProjectRecord, allowFolderPicker = false) {
  return runtimeFetch("/v1/runtime/status", payload(project, allowFolderPicker), allowFolderPicker ? 120_000 : 7000)
}

export function runDeveloperRuntimeAction(project: DeveloperLocalProjectRecord, action: "run" | "build" | "test" | "terminal" | "stop", allowFolderPicker = false) {
  return runtimeFetch("/v1/runtime/action", { ...payload(project, allowFolderPicker), action }, allowFolderPicker ? 120_000 : 15_000)
}
