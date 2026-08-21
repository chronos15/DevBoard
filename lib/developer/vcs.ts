import type { DeveloperLocalProjectRecord } from "@/lib/developer/context"

const AGENT_ORIGIN = "http://127.0.0.1:43827"
const AGENT_HEADER = { "X-Devboard-Agent": "1" }

export const DEVELOPER_VCS_STATUS_EVENT = "devboard:developer-vcs-status"
export const DEVELOPER_VCS_CHANGED_EVENT = "devboard:developer-vcs-changed"

export type DeveloperVcsProvider = "git" | "svn" | "none"
export type DeveloperVcsClient = "git" | "svn-cli" | "tortoise" | "none"

export type DeveloperVcsFile = {
  path: string
  status: string
  label: string
  staged?: boolean
  conflicted?: boolean
}

export type DeveloperVcsStatus = {
  ok: boolean
  provider: DeveloperVcsProvider
  client: DeveloperVcsClient
  path: string
  repoRoot: string
  repository: string
  revision: string
  branch: string
  upstream: string
  ahead: number
  behind: number
  changedCount: number
  added: number
  modified: number
  removed: number
  untracked: number
  conflicted: number
  clean: boolean
  directStatus: boolean
  directCommit: boolean
  directUpdate: boolean
  directLog: boolean
  canPush: boolean
  nativeAvailable: boolean
  nativeName: string
  files: DeveloperVcsFile[]
  error?: string
  code?: string
}

export type DeveloperVcsLogEntry = {
  id: string
  shortId: string
  author: string
  date: string
  message: string
  filesChanged?: number
}

export type DeveloperVcsLogResult = {
  ok: boolean
  provider: DeveloperVcsProvider
  entries: DeveloperVcsLogEntry[]
  directLog: boolean
  nativeAvailable: boolean
  error?: string
  code?: string
}

export type DeveloperVcsActionResult = {
  ok: boolean
  provider: DeveloperVcsProvider
  action: "commit" | "update" | "push" | "native"
  mode: "direct" | "native"
  message: string
  revision: string
  branch: string
  repository: string
  output: string
  nativeOpened: boolean
  error?: string
  code?: string
}

type AgentError = Error & { code?: string }

function projectPayload(project: DeveloperLocalProjectRecord, allowFolderPicker = false) {
  return {
    projectId: project.id,
    projectName: project.name,
    folderName: project.folderName,
    legacyPath: project.legacyPath,
    allowFolderPicker,
  }
}

async function vcsFetch<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
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
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = new Error(String(payload?.error || `Devboard Agent respondeu ${response.status}.`)) as AgentError
      error.code = payload?.code
      throw error
    }
    return payload as T
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function getDeveloperVcsStatus(
  project: DeveloperLocalProjectRecord,
  options?: { allowFolderPicker?: boolean },
): Promise<DeveloperVcsStatus> {
  return vcsFetch<DeveloperVcsStatus>(
    "/v1/vcs/status",
    projectPayload(project, options?.allowFolderPicker === true),
    options?.allowFolderPicker ? 120_000 : 8_000,
  )
}

export async function getDeveloperVcsLog(
  project: DeveloperLocalProjectRecord,
  options?: { limit?: number; allowFolderPicker?: boolean },
): Promise<DeveloperVcsLogResult> {
  return vcsFetch<DeveloperVcsLogResult>(
    "/v1/vcs/log",
    { ...projectPayload(project, options?.allowFolderPicker === true), limit: Math.max(1, Math.min(100, options?.limit ?? 20)) },
    options?.allowFolderPicker ? 120_000 : 20_000,
  )
}

export async function commitDeveloperVcs(
  project: DeveloperLocalProjectRecord,
  input: { message: string; includeUnversioned?: boolean; allowFolderPicker?: boolean },
): Promise<DeveloperVcsActionResult> {
  return vcsFetch<DeveloperVcsActionResult>(
    "/v1/vcs/commit",
    {
      ...projectPayload(project, input.allowFolderPicker !== false),
      message: input.message,
      includeUnversioned: input.includeUnversioned !== false,
    },
    180_000,
  )
}

export async function updateDeveloperVcs(
  project: DeveloperLocalProjectRecord,
  options?: { allowFolderPicker?: boolean },
): Promise<DeveloperVcsActionResult> {
  return vcsFetch<DeveloperVcsActionResult>(
    "/v1/vcs/update",
    projectPayload(project, options?.allowFolderPicker !== false),
    180_000,
  )
}

export async function pushDeveloperVcs(project: DeveloperLocalProjectRecord): Promise<DeveloperVcsActionResult> {
  return vcsFetch<DeveloperVcsActionResult>(
    "/v1/vcs/push",
    projectPayload(project, false),
    180_000,
  )
}

export async function openDeveloperVcsNative(
  project: DeveloperLocalProjectRecord,
  command: "status" | "log" | "commit" | "update",
  message = "",
): Promise<DeveloperVcsActionResult> {
  return vcsFetch<DeveloperVcsActionResult>(
    "/v1/vcs/native",
    { ...projectPayload(project, true), command, message },
    120_000,
  )
}

export function developerVcsProviderLabel(provider: DeveloperVcsProvider) {
  if (provider === "git") return "Git"
  if (provider === "svn") return "SVN"
  return "Código"
}

export function developerVcsRemoteUrl(remote: string) {
  const value = remote.trim()
  if (!value) return ""
  const sshGitHub = value.match(/^git@github\.com:([^/]+\/.+?)(?:\.git)?$/i)
  if (sshGitHub) return `https://github.com/${sshGitHub[1].replace(/\.git$/i, "")}`
  if (/^https?:\/\//i.test(value)) return value.replace(/\.git$/i, "")
  return ""
}
