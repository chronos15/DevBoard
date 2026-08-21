"use client"

import * as React from "react"
import {
  AppWindow,
  Blocks,
  Box,
  Braces,
  Code2,
  Cpu,
  ExternalLink,
  Folder,
  FolderCheck,
  FolderOpen,
  MonitorCog,
  Pencil,
  Plus,
  Rocket,
  Settings2,
  TerminalSquare,
  Trash2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ensureDirectoryPermission,
  getDirectoryHandle,
  localDirectoryKey,
  pickDirectory,
  removeDirectoryHandle,
  saveDirectoryHandle,
  supportsDirectoryPicker,
  type LocalDirectoryHandle,
} from "@/lib/developer/local-workspaces"
import {
  bindDeveloperProjectFolder,
  getDeveloperAgentHealth,
  openDeveloperProjectWithAgent,
  pickDeveloperProjectFolder,
} from "@/lib/developer/windows-agent"

export type DeveloperIdeKind = "vscode" | "cursor" | "visual-studio" | "delphi" | "jetbrains" | "custom"
export type DeveloperIdeIcon = "code" | "braces" | "terminal" | "blocks" | "box" | "monitor" | "cpu" | "rocket" | "app"

type DeveloperIde = {
  id: string
  name: string
  kind: DeveloperIdeKind
  icon: DeveloperIdeIcon
  customUriTemplate: string
  sortOrder: number
}

type DeveloperLocalProject = {
  id: string
  name: string
  folderName: string
  ideId: string | null
  legacyPath: string
  createdAt: string
}

type Props = {
  currentUserId: string | null
  onNotice: (message: string | null) => void
}

type IdeDraft = {
  id?: string
  name: string
  kind: DeveloperIdeKind
  icon: DeveloperIdeIcon
  customUriTemplate: string
}

type ProjectDraft = {
  id?: string
  name: string
  ideId: string
  handle: LocalDirectoryHandle | null
  currentFolderName: string
  legacyPath: string
}

const IDE_OPTIONS: Array<{ value: DeveloperIdeKind; label: string; icon: DeveloperIdeIcon }> = [
  { value: "vscode", label: "Visual Studio Code", icon: "code" },
  { value: "cursor", label: "Cursor", icon: "braces" },
  { value: "visual-studio", label: "Visual Studio", icon: "monitor" },
  { value: "delphi", label: "Delphi", icon: "app" },
  { value: "jetbrains", label: "JetBrains", icon: "blocks" },
  { value: "custom", label: "Personalizado", icon: "terminal" },
]

const ICON_OPTIONS: DeveloperIdeIcon[] = ["code", "braces", "terminal", "blocks", "box", "monitor", "cpu", "rocket", "app"]

const ICONS: Record<DeveloperIdeIcon, React.ElementType> = {
  code: Code2,
  braces: Braces,
  terminal: TerminalSquare,
  blocks: Blocks,
  box: Box,
  monitor: MonitorCog,
  cpu: Cpu,
  rocket: Rocket,
  app: AppWindow,
}

function kindLabel(kind: DeveloperIdeKind) {
  return IDE_OPTIONS.find((item) => item.value === kind)?.label ?? "IDE"
}

function defaultIdeDraft(): IdeDraft {
  return { name: "Visual Studio Code", kind: "vscode", icon: "code", customUriTemplate: "" }
}

function emptyProjectDraft(ideId = ""): ProjectDraft {
  return { name: "", ideId, handle: null, currentFolderName: "", legacyPath: "" }
}

function normalizeIdeRow(row: any): DeveloperIde {
  return {
    id: String(row.id),
    name: String(row.name || kindLabel(row.kind)),
    kind: IDE_OPTIONS.some((item) => item.value === row.kind) ? row.kind : "custom",
    icon: ICON_OPTIONS.includes(row.icon) ? row.icon : "code",
    customUriTemplate: String(row.custom_uri_template ?? ""),
    sortOrder: Number(row.sort_order || 0),
  }
}

function normalizeProjectRow(row: any): DeveloperLocalProject {
  return {
    id: String(row.id),
    name: String(row.name || row.folder_name || "Projeto local"),
    folderName: String(row.folder_name ?? ""),
    ideId: row.ide_id ? String(row.ide_id) : null,
    legacyPath: String(row.legacy_path ?? ""),
    createdAt: String(row.created_at ?? new Date().toISOString()),
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

function localPathBaseName(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/")
  return normalized.split("/").filter(Boolean).at(-1) ?? ""
}

function isAbsoluteLocalPath(value: string) {
  const path = value.trim()
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\/.test(path) || /^\/(?!\/)/.test(path)
}

function buildLaunchUri(ide: DeveloperIde, project: DeveloperLocalProject) {
  const launchPath = project.legacyPath.trim()
  if (launchPath && ide.kind === "vscode") return `vscode://file/${encodedLocalPath(launchPath)}`
  if (launchPath && ide.kind === "cursor") return `cursor://file/${encodedLocalPath(launchPath)}`

  const custom = ide.customUriTemplate.trim()
  if (custom) {
    return custom
      .replaceAll("{project}", encodeURIComponent(project.name))
      .replaceAll("{folder}", encodeURIComponent(project.folderName))
      .replaceAll("{path}", encodeURIComponent(launchPath))
      .replaceAll("{projectId}", encodeURIComponent(project.id))
  }

  if (ide.kind === "vscode") return "vscode://"
  if (ide.kind === "cursor") return "cursor://"
  return ""
}

function iconFor(ide?: DeveloperIde | null, className = "size-4") {
  const Icon = ICONS[ide?.icon ?? "code"]
  return <Icon className={className} />
}

export function DeveloperEnvironment({ currentUserId, onNotice }: Props) {
  const supabase = React.useMemo(() => createClient(), [])
  const { projects: devboardProjects } = useStore()

  // O Store incrementa trackedSeconds das subatividades em execução a cada segundo,
  // criando uma nova referência para projects. A área de IDE só depende de nome e
  // repository; manter esse recorte estável evita refazer a consulta do ambiente
  // inteiro a cada tick do cronômetro.
  const launchProjectFingerprint = JSON.stringify(
    devboardProjects.map((project) => ({
      name: project.name,
      repository: String(project.repository ?? ""),
    })),
  )
  const launchProjects = React.useMemo<Array<{ name: string; repository: string }>>(
    () => JSON.parse(launchProjectFingerprint),
    [launchProjectFingerprint],
  )

  const [ides, setIdes] = React.useState<DeveloperIde[]>([])
  const [localProjects, setLocalProjects] = React.useState<DeveloperLocalProject[]>([])
  const [folderAvailability, setFolderAvailability] = React.useState<Record<string, boolean>>({})
  const [loading, setLoading] = React.useState(true)
  const [manageDialogOpen, setManageDialogOpen] = React.useState(false)
  const [ideDialogOpen, setIdeDialogOpen] = React.useState(false)
  const [ideDraft, setIdeDraft] = React.useState<IdeDraft>(defaultIdeDraft)
  const [projectDialogOpen, setProjectDialogOpen] = React.useState(false)
  const [projectDraft, setProjectDraft] = React.useState<ProjectDraft>(emptyProjectDraft)
  const [savingIde, setSavingIde] = React.useState(false)
  const [savingProject, setSavingProject] = React.useState(false)
  const [agentAvailable, setAgentAvailable] = React.useState(false)
  const pickerSupported = React.useMemo(() => supportsDirectoryPicker(), [])

  React.useEffect(() => {
    let active = true
    const check = () => void getDeveloperAgentHealth().then((health) => {
      if (active) setAgentAvailable(Boolean(health?.ok))
    })
    check()
    const timer = window.setInterval(check, 12_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  const inferKnownLaunchPath = React.useCallback((folderName: string, projectName?: string, oldWorkspacePath?: string) => {
    const folder = folderName.trim().toLocaleLowerCase("pt-BR")
    const name = (projectName ?? "").trim().toLocaleLowerCase("pt-BR")
    if (!folder) return ""

    const repositoryMatch = launchProjects.find((project) => {
      const repository = project.repository.trim()
      if (!isAbsoluteLocalPath(repository)) return false
      const base = localPathBaseName(repository).toLocaleLowerCase("pt-BR")
      return base === folder || (name && project.name.trim().toLocaleLowerCase("pt-BR") === name && base === folder)
    })
    if (repositoryMatch?.repository) return repositoryMatch.repository.trim()

    const oldPath = String(oldWorkspacePath ?? "").trim()
    if (isAbsoluteLocalPath(oldPath) && localPathBaseName(oldPath).toLocaleLowerCase("pt-BR") === folder) return oldPath
    return ""
  }, [launchProjects])

  const loadEnvironment = React.useCallback(async () => {
    if (!currentUserId) return
    const [{ data: ideRows, error: ideError }, { data: projectRows, error: projectError }, { data: settingsRow }] = await Promise.all([
      supabase.from("developer_ides").select("id,name,kind,icon,custom_uri_template,sort_order").eq("user_id", currentUserId).order("sort_order").order("created_at"),
      supabase.from("developer_local_projects").select("id,name,folder_name,ide_id,legacy_path,created_at").eq("user_id", currentUserId).order("created_at"),
      supabase.from("developer_settings").select("ide_workspace_path").eq("user_id", currentUserId).maybeSingle(),
    ])
    if (ideError) throw ideError
    if (projectError) throw projectError

    const mappedIdes = (ideRows ?? []).map(normalizeIdeRow)
    const mappedProjects = (projectRows ?? []).map(normalizeProjectRow)
    const oldWorkspacePath = String((settingsRow as any)?.ide_workspace_path ?? "")

    // A versão anterior tinha o caminho completo. A seleção por File System Access API não revela
    // esse caminho ao navegador, portanto recuperamos automaticamente o caminho antigo (ou o
    // repository local já cadastrado no Devboard) quando o nome da pasta confere.
    for (const project of mappedProjects) {
      if (project.legacyPath || !project.folderName) continue
      const recovered = inferKnownLaunchPath(project.folderName, project.name, oldWorkspacePath)
      if (!recovered) continue
      project.legacyPath = recovered
      void supabase
        .from("developer_local_projects")
        .update({ legacy_path: recovered })
        .eq("id", project.id)
        .eq("user_id", currentUserId)
    }

    setIdes(mappedIdes)
    setLocalProjects(mappedProjects)

    const availability: Record<string, boolean> = {}
    await Promise.all(mappedProjects.map(async (project) => {
      try {
        availability[project.id] = Boolean(await getDirectoryHandle(localDirectoryKey(currentUserId, project.id)))
      } catch {
        availability[project.id] = false
      }
    }))
    setFolderAvailability(availability)
  }, [currentUserId, inferKnownLaunchPath, supabase])

  React.useEffect(() => {
    if (!currentUserId) return
    let alive = true
    setLoading(true)
    loadEnvironment()
      .catch((error: any) => alive && onNotice(String(error?.message ?? error ?? "Não foi possível carregar IDEs e projetos locais.")))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [currentUserId, loadEnvironment, onNotice])

  React.useEffect(() => {
    if (!currentUserId) return
    const channel = supabase
      .channel(`devboard-developer-environment-${currentUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_ides", filter: `user_id=eq.${currentUserId}` }, () => void loadEnvironment())
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_local_projects", filter: `user_id=eq.${currentUserId}` }, () => void loadEnvironment())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [currentUserId, loadEnvironment, supabase])

  function openNewIde() {
    setManageDialogOpen(false)
    setIdeDraft(defaultIdeDraft())
    setIdeDialogOpen(true)
  }

  function editIde(ide: DeveloperIde) {
    setManageDialogOpen(false)
    setIdeDraft({ id: ide.id, name: ide.name, kind: ide.kind, icon: ide.icon, customUriTemplate: ide.customUriTemplate })
    setIdeDialogOpen(true)
  }

  function changeIdeKind(kind: DeveloperIdeKind) {
    const preset = IDE_OPTIONS.find((item) => item.value === kind)
    setIdeDraft((current) => ({
      ...current,
      kind,
      name: current.id || current.name.trim() ? current.name : (preset?.label ?? "IDE"),
      icon: preset?.icon ?? current.icon,
    }))
  }

  async function saveIde() {
    const name = ideDraft.name.trim()
    if (!currentUserId || !name || savingIde) return
    setSavingIde(true)
    const payload = {
      user_id: currentUserId,
      name,
      kind: ideDraft.kind,
      icon: ideDraft.icon,
      custom_uri_template: ideDraft.customUriTemplate.trim(),
    }
    const query = ideDraft.id
      ? supabase.from("developer_ides").update(payload).eq("id", ideDraft.id).eq("user_id", currentUserId)
      : supabase.from("developer_ides").insert(payload)
    const { error } = await query
    setSavingIde(false)
    if (error) {
      onNotice(error.message)
      return
    }
    setIdeDialogOpen(false)
    await loadEnvironment()
    setManageDialogOpen(true)
    onNotice(ideDraft.id ? "IDE atualizada." : "IDE adicionada.")
  }

  async function deleteIde(ide: DeveloperIde) {
    if (!currentUserId || !window.confirm(`Remover a IDE “${ide.name}”? Os projetos vinculados ficarão sem IDE até você escolher outra.`)) return
    const { error } = await supabase.from("developer_ides").delete().eq("id", ide.id).eq("user_id", currentUserId)
    if (error) {
      onNotice(error.message)
      return
    }
    await loadEnvironment()
  }

  function openNewProject() {
    setProjectDraft(emptyProjectDraft(ides[0]?.id ?? ""))
    setProjectDialogOpen(true)
  }

  function editProject(project: DeveloperLocalProject) {
    setProjectDraft({
      id: project.id,
      name: project.name,
      ideId: project.ideId ?? ides[0]?.id ?? "",
      handle: null,
      currentFolderName: project.folderName,
      legacyPath: project.legacyPath,
    })
    setProjectDialogOpen(true)
  }

  async function chooseFolderForDraft() {
    // Quando o Agent está ativo, usamos o seletor NATIVO do Windows. Além de ser mais
    // natural, ele conhece o caminho absoluto da pasta e consegue abrir Delphi/VS Code/etc.
    // exatamente naquele diretório. O File System Access API do navegador não expõe esse path.
    if (agentAvailable) {
      try {
        const picked = await pickDeveloperProjectFolder({
          projectId: projectDraft.id,
          projectName: projectDraft.name,
          expectedFolderName: projectDraft.currentFolderName,
        })
        setProjectDraft((current) => ({
          ...current,
          handle: null,
          currentFolderName: picked.name,
          name: current.name.trim() || picked.name,
          legacyPath: picked.path,
        }))
        return
      } catch (error: any) {
        if (error?.code === "picker_cancelled") return
        // Se o Agent ficou indisponível entre o heartbeat e o clique, ainda temos o picker web.
        setAgentAvailable(false)
      }
    }

    try {
      const handle = await pickDirectory(`project-${projectDraft.id ?? currentUserId ?? "developer"}`)
      const recovered = inferKnownLaunchPath(handle.name, projectDraft.name)
      setProjectDraft((current) => ({
        ...current,
        handle,
        currentFolderName: handle.name,
        name: current.name.trim() || handle.name,
        legacyPath: recovered || (localPathBaseName(current.legacyPath).toLocaleLowerCase("pt-BR") === handle.name.toLocaleLowerCase("pt-BR") ? current.legacyPath : ""),
      }))
    } catch (error: any) {
      if (error?.name === "AbortError") return
      onNotice(String(error?.message ?? error ?? "Não foi possível selecionar a pasta."))
    }
  }

  async function saveProject() {
    const name = projectDraft.name.trim()
    if (!currentUserId || !name || !projectDraft.ideId || savingProject) return
    if (!projectDraft.id && !projectDraft.handle && !projectDraft.legacyPath.trim() && pickerSupported) {
      onNotice("Escolha a pasta do projeto antes de adicionar o atalho.")
      return
    }

    setSavingProject(true)
    const folderName = projectDraft.handle?.name ?? projectDraft.currentFolderName
    const recoveredPath = projectDraft.legacyPath || inferKnownLaunchPath(folderName, name)
    const payload = {
      user_id: currentUserId,
      name,
      folder_name: folderName,
      ide_id: projectDraft.ideId,
      legacy_path: recoveredPath,
    }

    const result = projectDraft.id
      ? await supabase
        .from("developer_local_projects")
        .update(payload)
        .eq("id", projectDraft.id)
        .eq("user_id", currentUserId)
        .select("id,name,folder_name,ide_id,legacy_path,created_at")
        .single()
      : await supabase
        .from("developer_local_projects")
        .insert(payload)
        .select("id,name,folder_name,ide_id,legacy_path,created_at")
        .single()

    if (result.error) {
      setSavingProject(false)
      onNotice(result.error.message)
      return
    }

    if (projectDraft.handle) {
      try {
        await saveDirectoryHandle(localDirectoryKey(currentUserId, result.data.id), projectDraft.handle)
      } catch {
        onNotice("Projeto salvo, mas este navegador não conseguiu guardar o vínculo persistente da pasta.")
      }
    }

    // O Agent mantém também um vínculo local por máquina. Assim um mesmo atalho pode apontar
    // para C:\Projetos\ERP neste PC e para D:\Fontes\ERP em outro sem quebrar a abertura.
    if (recoveredPath && agentAvailable) {
      try { await bindDeveloperProjectFolder(result.data.id, recoveredPath) } catch { /* fallback web continua disponível */ }
    }

    setSavingProject(false)
    setProjectDialogOpen(false)
    await loadEnvironment()
    onNotice(projectDraft.id ? "Projeto local atualizado." : "Projeto local adicionado.")
  }


  async function deleteProject(project: DeveloperLocalProject) {
    if (!currentUserId || !window.confirm(`Remover o atalho local “${project.name}”? Nenhum arquivo da pasta será apagado.`)) return
    const { error } = await supabase.from("developer_local_projects").delete().eq("id", project.id).eq("user_id", currentUserId)
    if (error) {
      onNotice(error.message)
      return
    }
    try { await removeDirectoryHandle(localDirectoryKey(currentUserId, project.id)) } catch { /* metadado local opcional */ }
    await loadEnvironment()
  }

  async function verifyFolder(project: DeveloperLocalProject) {
    if (!currentUserId) return false
    const handle = await getDirectoryHandle(localDirectoryKey(currentUserId, project.id))
    if (!handle) return false
    const allowed = await ensureDirectoryPermission(handle)
    setFolderAvailability((current) => ({ ...current, [project.id]: allowed }))
    return allowed
  }

  async function openProject(project: DeveloperLocalProject) {
    const ide = ides.find((item) => item.id === project.ideId)
    if (!ide) {
      onNotice("Escolha uma IDE para este projeto primeiro.")
      return
    }

    // Prioridade: Devboard Agent. Ele abre o executável real da IDE e passa a pasta/projeto
    // como argumento, sem depender de vscode://, cursor:// ou do navegador conhecer o path.
    if (agentAvailable) {
      try {
        const result = await openDeveloperProjectWithAgent(ide, project, { allowFolderPicker: true })
        if (result.path && result.path !== project.legacyPath) {
          setLocalProjects((current) => current.map((item) => item.id === project.id ? { ...item, legacyPath: result.path! } : item))
          void supabase.from("developer_local_projects").update({ legacy_path: result.path }).eq("id", project.id).eq("user_id", currentUserId)
        }
        return
      } catch (error: any) {
        if (error?.code === "picker_cancelled") return
        // Só cai para o método antigo se o serviço local realmente não respondeu.
        const health = await getDeveloperAgentHealth()
        if (health?.ok) {
          onNotice(String(error?.message ?? error ?? `Não foi possível abrir ${ide.name}.`))
          return
        }
        setAgentAvailable(false)
      }
    }

    if (folderAvailability[project.id]) {
      try {
        const allowed = await verifyFolder(project)
        if (!allowed) {
          onNotice("O navegador perdeu a permissão da pasta. Edite o atalho e selecione-a novamente.")
          return
        }
      } catch {
        // O vínculo local não impede a tentativa via protocolo.
      }
    }

    const uri = buildLaunchUri(ide, project)
    if (!uri) {
      onNotice(`${ide.name} precisa do Devboard Agent para abrir diretamente o projeto nesta IDE.`)
      return
    }

    window.location.href = uri
    if ((ide.kind === "vscode" || ide.kind === "cursor") && !project.legacyPath) {
      onNotice(`O Devboard Agent não está disponível. ${ide.name} foi aberto sem forçar a pasta.`)
    }
  }

  if (!currentUserId) return null

  return (
    <>
      <section className="min-w-0 rounded-2xl border border-border bg-card">
        <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Code2 className="size-[1.1rem]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">Projetos & IDEs</h2>
            <p className="mt-0.5 truncate text-[0.67rem] text-muted-foreground">
              {localProjects.length} {localProjects.length === 1 ? "projeto" : "projetos"} · {ides.length} {ides.length === 1 ? "IDE" : "IDEs"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={openNewProject}
              disabled={!ides.length}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
              title="Adicionar projeto local"
            >
              <Plus className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setManageDialogOpen(true)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Gerenciar IDEs"
            >
              <Settings2 className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="p-2.5">
          {loading ? (
            <div className="px-2 py-5 text-center text-[0.67rem] text-muted-foreground">Carregando atalhos...</div>
          ) : localProjects.length === 0 ? (
            <button
              type="button"
              onClick={ides.length ? openNewProject : () => setManageDialogOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-xs font-medium text-muted-foreground hover:bg-muted/35"
            >
              <Plus className="size-3.5" />
              {ides.length ? "Adicionar projeto local" : "Adicionar uma IDE"}
            </button>
          ) : (
            <div className="max-h-[245px] space-y-0.5 overflow-y-auto overscroll-contain pr-0.5">
              {localProjects.map((project) => {
                const ide = ides.find((item) => item.id === project.ideId)
                const hasFolder = folderAvailability[project.id] === true || Boolean(project.legacyPath)
                const opensFolder = Boolean(project.legacyPath) && Boolean(ide && (ide.kind === "vscode" || ide.kind === "cursor"))
                return (
                  <div key={project.id} className="group flex min-w-0 items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-muted/45">
                    <span className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      ide ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}>
                      {ide ? iconFor(ide, "size-3.5") : <Folder className="size-3.5" />}
                    </span>
                    <button type="button" onClick={() => editProject(project)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-xs font-semibold" title={project.name}>{project.name}</span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[0.62rem] text-muted-foreground">
                        {hasFolder ? <FolderCheck className="size-3 shrink-0" /> : <Folder className="size-3 shrink-0" />}
                        <span className="truncate" title={`${ide?.name ?? "Sem IDE"} · ${project.folderName || "Pasta não vinculada"}`}>
                          {ide?.name ?? "Sem IDE"} · {project.folderName || "Pasta não vinculada"}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void openProject(project)}
                      disabled={!ide}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
                      title={ide ? `${opensFolder ? "Abrir pasta em" : "Abrir"} ${ide.name}` : "Escolha uma IDE"}
                    >
                      <ExternalLink className="size-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {localProjects.length > 0 && (
            <button
              type="button"
              onClick={openNewProject}
              disabled={!ides.length}
              className="mt-1 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[0.65rem] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-35"
            >
              <Plus className="size-3" />Novo atalho
            </button>
          )}
        </div>
      </section>

      <Dialog open={manageDialogOpen} onOpenChange={setManageDialogOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Gerenciar IDEs</DialogTitle>
            <DialogDescription>Cadastre seus ambientes sem ocupar espaço no Painel Dev.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {ides.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma IDE cadastrada.</div>
            ) : ides.map((ide) => (
              <div key={ide.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background/45 p-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{iconFor(ide)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold" title={ide.name}>{ide.name}</p>
                  <p className="mt-0.5 truncate text-[0.64rem] text-muted-foreground">{kindLabel(ide.kind)}</p>
                </div>
                <button type="button" onClick={() => editIde(ide)} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Editar IDE"><Pencil className="size-3.5" /></button>
                <button type="button" onClick={() => void deleteIde(ide)} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover IDE"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
          </div>
          <DialogFooter className="sm:justify-between">
            <button type="button" onClick={openNewIde} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted"><Plus className="size-3.5" />Adicionar IDE</button>
            <button type="button" onClick={() => setManageDialogOpen(false)} className="h-9 rounded-xl bg-foreground px-3 text-xs font-semibold text-background">Concluir</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={ideDialogOpen} onOpenChange={setIdeDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader><DialogTitle>{ideDraft.id ? "Editar IDE" : "Adicionar IDE"}</DialogTitle><DialogDescription>Crie um atalho para cada ambiente que você usa.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label><input value={ideDraft.name} onChange={(event) => setIdeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Delphi 12" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tipo</label><select value={ideDraft.kind} onChange={(event) => changeIdeKind(event.target.value as DeveloperIdeKind)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary">{IDE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Ícone</label><div className="grid grid-cols-9 gap-1 rounded-xl border border-border bg-background p-1">{ICON_OPTIONS.map((icon) => { const Icon = ICONS[icon]; return <button key={icon} type="button" onClick={() => setIdeDraft((current) => ({ ...current, icon }))} className={cn("flex h-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted", ideDraft.icon === icon && "bg-primary/10 text-primary ring-1 ring-primary/25")} title={`Ícone ${icon}`}><Icon className="size-3.5" /></button> })}</div></div>
            </div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Protocolo/launcher avançado <span className="font-normal">(opcional)</span></label><input value={ideDraft.customUriTemplate} onChange={(event) => setIdeDraft((current) => ({ ...current, customUriTemplate: event.target.value }))} placeholder="devlauncher://open?path={path}" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-primary" /><p className="mt-1.5 text-[0.63rem] leading-relaxed text-muted-foreground">Marcadores: {"{project}"}, {"{folder}"}, {"{path}"} e {"{projectId}"}. VS Code e Cursor usam abertura nativa quando o caminho local está disponível.</p></div>
          </div>
          <DialogFooter><button type="button" onClick={() => setIdeDialogOpen(false)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold">Cancelar</button><button type="button" onClick={() => void saveIde()} disabled={!ideDraft.name.trim() || savingIde} className="h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">{savingIde ? "Salvando..." : "Salvar IDE"}</button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{projectDraft.id ? "Editar projeto local" : "Novo projeto local"}</DialogTitle>
            <DialogDescription>Escolha a pasta e defina qual IDE deve abrir este projeto.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label><input value={projectDraft.name} onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: ERP Softwork" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">IDE deste projeto</label><select value={projectDraft.ideId} onChange={(event) => setProjectDraft((current) => ({ ...current, ideId: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="">Escolher IDE</option>{ides.map((ide) => <option key={ide.id} value={ide.id}>{ide.name}</option>)}</select></div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Pasta</label>
              <button type="button" onClick={() => void chooseFolderForDraft()} disabled={!agentAvailable && !pickerSupported} className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors", projectDraft.handle || projectDraft.currentFolderName ? "border-success/25 bg-success/5" : "border-dashed border-border bg-background hover:bg-muted/35", !agentAvailable && !pickerSupported && "cursor-not-allowed opacity-45")}>
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", projectDraft.handle || projectDraft.currentFolderName ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{projectDraft.handle || projectDraft.currentFolderName ? <FolderCheck className="size-4" /> : <FolderOpen className="size-4" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{projectDraft.handle?.name || projectDraft.currentFolderName || "Escolher pasta do projeto"}</span><span className="mt-0.5 block text-[0.63rem] text-muted-foreground">{projectDraft.handle || projectDraft.currentFolderName ? "Clique para trocar a pasta" : agentAvailable ? "Abre o seletor nativo do Windows pelo Devboard Agent" : "Abre o seletor de diretórios do navegador"}</span></span>
              </button>
              {!agentAvailable && !pickerSupported && <p className="mt-1.5 text-[0.63rem] text-muted-foreground">Instale/atualize o Devboard Agent ou use Chrome/Edge atualizado para selecionar diretórios.</p>}
              {projectDraft.currentFolderName && projectDraft.legacyPath && <p className="mt-1.5 flex items-center gap-1.5 text-[0.63rem] font-medium text-success"><FolderCheck className="size-3" />{agentAvailable ? "Pasta vinculada ao Agent: abertura direta na IDE disponível." : "Abertura direta disponível para VS Code/Cursor."}</p>}
            </div>
          </div>
          <DialogFooter>
            {projectDraft.id && <button type="button" onClick={() => { const project = localProjects.find((item) => item.id === projectDraft.id); if (project) void deleteProject(project); setProjectDialogOpen(false) }} className="mr-auto h-9 rounded-xl px-2 text-xs font-semibold text-destructive hover:bg-destructive/10">Remover</button>}
            <button type="button" onClick={() => setProjectDialogOpen(false)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold">Cancelar</button>
            <button type="button" onClick={() => void saveProject()} disabled={!projectDraft.name.trim() || !projectDraft.ideId || savingProject} className="h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">{savingProject ? "Salvando..." : projectDraft.id ? "Salvar" : "Adicionar projeto"}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
