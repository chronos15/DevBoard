import type { DeveloperMusicProvider } from "@/lib/developer/panel"

export type DeveloperIdeRecord = {
  id: string
  name: string
  kind: string
  icon: string
  customUriTemplate: string
}

export type DeveloperLocalProjectRecord = {
  id: string
  name: string
  folderName: string
  ideId: string | null
  legacyPath: string
}

export type DeveloperContextRecord = {
  id: string
  name: string
  devboardProjectId: string | null
  localProjectId: string | null
  ideId: string | null
  musicProvider: DeveloperMusicProvider
  musicUrl: string
  autoFocus: boolean
  autoOpenIde: boolean
  autoOpenMusic: boolean
  sortOrder: number
}

export function normalizeDeveloperIde(row: any): DeveloperIdeRecord {
  return {
    id: String(row.id),
    name: String(row.name || "IDE"),
    kind: String(row.kind || "custom"),
    icon: String(row.icon || "code"),
    customUriTemplate: String(row.custom_uri_template ?? ""),
  }
}

export function normalizeDeveloperLocalProject(row: any): DeveloperLocalProjectRecord {
  return {
    id: String(row.id),
    name: String(row.name || row.folder_name || "Projeto local"),
    folderName: String(row.folder_name ?? ""),
    ideId: row.ide_id ? String(row.ide_id) : null,
    legacyPath: String(row.legacy_path ?? ""),
  }
}

export function normalizeDeveloperContext(row: any): DeveloperContextRecord {
  return {
    id: String(row.id),
    name: String(row.name || "Contexto"),
    devboardProjectId: row.devboard_project_id ? String(row.devboard_project_id) : null,
    localProjectId: row.local_project_id ? String(row.local_project_id) : null,
    ideId: row.ide_id ? String(row.ide_id) : null,
    musicProvider: row.music_provider === "youtube-music" ? "youtube-music" : "spotify",
    musicUrl: String(row.music_url ?? ""),
    autoFocus: row.auto_focus !== false,
    autoOpenIde: row.auto_open_ide !== false,
    autoOpenMusic: row.auto_open_music === true,
    sortOrder: Number(row.sort_order || 0),
  }
}

function encodedLocalPath(path: string) {
  return path
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((part, index) => (index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)))
    .join("/")
}

export function developerLaunchUri(ide: DeveloperIdeRecord | null | undefined, project: DeveloperLocalProjectRecord | null | undefined) {
  if (!ide) return ""
  const launchPath = project?.legacyPath?.trim() ?? ""
  if (launchPath && ide.kind === "vscode") return `vscode://file/${encodedLocalPath(launchPath)}`
  if (launchPath && ide.kind === "cursor") return `cursor://file/${encodedLocalPath(launchPath)}`

  const custom = ide.customUriTemplate.trim()
  if (custom) {
    return custom
      .replaceAll("{project}", encodeURIComponent(project?.name ?? ""))
      .replaceAll("{folder}", encodeURIComponent(project?.folderName ?? ""))
      .replaceAll("{path}", encodeURIComponent(launchPath))
      .replaceAll("{projectId}", encodeURIComponent(project?.id ?? ""))
  }

  if (ide.kind === "vscode") return "vscode://"
  if (ide.kind === "cursor") return "cursor://"
  return ""
}

export function activeDeveloperContextKey(userId: string, projectId: string) {
  return `devboard-developer-active-context:${userId}:${projectId}`
}

export function rememberDeveloperContext(userId: string, context: DeveloperContextRecord) {
  if (typeof window === "undefined" || !context.devboardProjectId) return
  try { window.localStorage.setItem(activeDeveloperContextKey(userId, context.devboardProjectId), context.id) } catch { /* opcional */ }
}

export function contextForProject(contexts: DeveloperContextRecord[], projectId?: string | null, userId?: string | null) {
  if (!projectId) return null
  if (typeof window !== "undefined" && userId) {
    try {
      const rememberedId = window.localStorage.getItem(activeDeveloperContextKey(userId, projectId))
      const remembered = contexts.find((context) => context.id === rememberedId && context.devboardProjectId === projectId)
      if (remembered) return remembered
    } catch { /* fallback para o primeiro contexto */ }
  }
  return contexts.find((context) => context.devboardProjectId === projectId) ?? null
}
