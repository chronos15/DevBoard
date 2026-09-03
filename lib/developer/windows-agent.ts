import type { DeveloperIdeRecord, DeveloperLocalProjectRecord } from "@/lib/developer/context"

const AGENT_ORIGIN = "http://127.0.0.1:43827"
const AGENT_HEADER = { "X-Devboard-Agent": "1" }

export type DeveloperAgentUpdateStatus = {
  state?: "idle" | "updating" | "completed" | "failed" | string
  current_version?: string
  target_version?: string
  message?: string
  started_at?: string
  finished_at?: string
}


export type DeveloperAgentActivity = {
  ok: boolean
  idleSeconds: number
  locked: boolean
  lastIdleSeconds: number
  lastIdleEndedAt?: string
  lastIdleEventId: number
}

export type DeveloperAgentSessionPayload = {
  active: boolean
  title?: string
  projectId?: string
  activityId?: string
  subactivityId?: string
  projectName?: string
  taskPath?: string
  timerStartedAt?: string
  localProject?: {
    projectId: string
    projectName: string
    folderName: string
    legacyPath: string
    allowFolderPicker: boolean
    ide: {
      id: string
      name: string
      kind: string
      customUriTemplate: string
    }
  } | null
}

type AgentHealth = {
  ok: boolean
  version?: string
  machine?: string
  update?: DeveloperAgentUpdateStatus
}

type AgentFolderResult = {
  ok: boolean
  path: string
  name: string
}

type AgentLaunchResult = {
  ok: boolean
  path?: string
  executable?: string
  target?: string
  error?: string
  code?: string
}

async function agentFetch<T>(path: string, init?: RequestInit, timeoutMs = 1800): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${AGENT_ORIGIN}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        ...AGENT_HEADER,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(String(body?.error || `Devboard Agent respondeu ${response.status}.`)) as Error & { code?: string }
      error.code = body?.code
      throw error
    }
    return body as T
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function getDeveloperAgentHealth(): Promise<AgentHealth | null> {
  if (typeof window === "undefined") return null
  try {
    return await agentFetch<AgentHealth>("/v1/health", { method: "GET" }, 700)
  } catch {
    return null
  }
}

export async function requestDeveloperAgentUpdateCheck(): Promise<boolean> {
  if (typeof window === "undefined") return false
  try {
    await agentFetch<{ ok: boolean }>("/v1/update/check", { method: "POST" }, 1200)
    return true
  } catch {
    // Agents 0.3.x/0.4.0/0.4.1 ainda não possuem este endpoint.
    // Eles continuam usando o loop interno de atualização normalmente.
    return false
  }
}

export async function pickDeveloperProjectFolder(input: {
  projectId?: string | null
  projectName?: string
  expectedFolderName?: string
}): Promise<AgentFolderResult> {
  return agentFetch<AgentFolderResult>(
    "/v1/pick-folder",
    { method: "POST", body: JSON.stringify(input) },
    120_000,
  )
}

export async function bindDeveloperProjectFolder(projectId: string, path: string): Promise<void> {
  if (!projectId || !path.trim()) return
  await agentFetch(
    "/v1/bind-project",
    { method: "POST", body: JSON.stringify({ projectId, path: path.trim() }) },
    2500,
  )
}

export async function openDeveloperProjectWithAgent(
  ide: DeveloperIdeRecord,
  project: DeveloperLocalProjectRecord,
  options?: { allowFolderPicker?: boolean },
): Promise<AgentLaunchResult> {
  return agentFetch<AgentLaunchResult>(
    "/v1/open-project",
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        projectName: project.name,
        folderName: project.folderName,
        legacyPath: project.legacyPath,
        allowFolderPicker: options?.allowFolderPicker !== false,
        ide: {
          id: ide.id,
          name: ide.name,
          kind: ide.kind,
          customUriTemplate: ide.customUriTemplate,
        },
      }),
    },
    options?.allowFolderPicker === false ? 5000 : 120_000,
  )
}

export async function openDeveloperProjectSmart(
  ide: DeveloperIdeRecord | null | undefined,
  project: DeveloperLocalProjectRecord | null | undefined,
  options?: { allowFolderPicker?: boolean },
): Promise<{ opened: boolean; via: "agent" | "browser" | "none"; error?: string }> {
  if (!ide || !project) return { opened: false, via: "none", error: "IDE ou projeto local não configurado." }

  try {
    await openDeveloperProjectWithAgent(ide, project, options)
    return { opened: true, via: "agent" }
  } catch (error) {
    // Se o Agent não estiver disponível, o chamador ainda pode usar o protocolo do navegador.
    const message = error instanceof Error ? error.message : "Não foi possível abrir a IDE pelo Devboard Agent."
    return { opened: false, via: "none", error: message }
  }
}


export async function getDeveloperAgentActivity(): Promise<DeveloperAgentActivity | null> {
  if (typeof window === "undefined") return null
  try {
    return await agentFetch<DeveloperAgentActivity>("/v1/activity", { method: "GET" }, 1200)
  } catch {
    return null
  }
}

export async function syncDeveloperAgentSession(payload: DeveloperAgentSessionPayload): Promise<boolean> {
  if (typeof window === "undefined") return false
  try {
    await agentFetch<{ ok: boolean }>("/v1/session", { method: "POST", body: JSON.stringify(payload) }, 1500)
    return true
  } catch {
    return false
  }
}
