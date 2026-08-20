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
  TerminalSquare,
  Trash2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
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
  name: string
  ideId: string
  handle: LocalDirectoryHandle | null
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
  return path.trim().replace(/\\/g, "/").split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join("/")
}

function buildLaunchUri(ide: DeveloperIde, project: DeveloperLocalProject) {
  const legacyPath = project.legacyPath.trim()
  if (legacyPath && ide.kind === "vscode") return `vscode://file/${encodedLocalPath(legacyPath)}`
  if (legacyPath && ide.kind === "cursor") return `cursor://file/${encodedLocalPath(legacyPath)}`

  const custom = ide.customUriTemplate.trim()
  if (custom) {
    return custom
      .replaceAll("{project}", encodeURIComponent(project.name))
      .replaceAll("{folder}", encodeURIComponent(project.folderName))
      .replaceAll("{projectId}", encodeURIComponent(project.id))
  }

  if (ide.kind === "vscode") return "vscode://"
  if (ide.kind === "cursor") return "cursor://"
  return ""
}

function iconFor(ide?: DeveloperIde | null) {
  const Icon = ICONS[ide?.icon ?? "code"]
  return <Icon className="size-4" />
}

export function DeveloperEnvironment({ currentUserId, onNotice }: Props) {
  const supabase = React.useMemo(() => createClient(), [])
  const [ides, setIdes] = React.useState<DeveloperIde[]>([])
  const [localProjects, setLocalProjects] = React.useState<DeveloperLocalProject[]>([])
  const [folderAvailability, setFolderAvailability] = React.useState<Record<string, boolean>>({})
  const [loading, setLoading] = React.useState(true)
  const [ideDialogOpen, setIdeDialogOpen] = React.useState(false)
  const [ideDraft, setIdeDraft] = React.useState<IdeDraft>(defaultIdeDraft)
  const [projectDialogOpen, setProjectDialogOpen] = React.useState(false)
  const [projectDraft, setProjectDraft] = React.useState<ProjectDraft>({ name: "", ideId: "", handle: null })
  const [savingIde, setSavingIde] = React.useState(false)
  const [savingProject, setSavingProject] = React.useState(false)
  const pickerSupported = React.useMemo(() => supportsDirectoryPicker(), [])

  const loadEnvironment = React.useCallback(async () => {
    if (!currentUserId) return
    const [{ data: ideRows, error: ideError }, { data: projectRows, error: projectError }] = await Promise.all([
      supabase.from("developer_ides").select("id,name,kind,icon,custom_uri_template,sort_order").eq("user_id", currentUserId).order("sort_order").order("created_at"),
      supabase.from("developer_local_projects").select("id,name,folder_name,ide_id,legacy_path,created_at").eq("user_id", currentUserId).order("created_at"),
    ])
    if (ideError) throw ideError
    if (projectError) throw projectError
    const mappedIdes = (ideRows ?? []).map(normalizeIdeRow)
    const mappedProjects = (projectRows ?? []).map(normalizeProjectRow)
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
  }, [currentUserId, supabase])

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
    setIdeDraft(defaultIdeDraft())
    setIdeDialogOpen(true)
  }

  function editIde(ide: DeveloperIde) {
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
    setProjectDraft({ name: "", ideId: ides[0]?.id ?? "", handle: null })
    setProjectDialogOpen(true)
  }

  async function chooseFolderForDraft() {
    try {
      const handle = await pickDirectory(`new-${currentUserId ?? "developer"}`)
      setProjectDraft((current) => ({ ...current, handle, name: current.name.trim() || handle.name }))
    } catch (error: any) {
      if (error?.name === "AbortError") return
      onNotice(String(error?.message ?? error ?? "Não foi possível selecionar a pasta."))
    }
  }

  async function saveProject() {
    const name = projectDraft.name.trim()
    if (!currentUserId || !name || !projectDraft.ideId || savingProject) return
    setSavingProject(true)
    const { data, error } = await supabase
      .from("developer_local_projects")
      .insert({
        user_id: currentUserId,
        name,
        folder_name: projectDraft.handle?.name ?? "",
        ide_id: projectDraft.ideId,
      })
      .select("id,name,folder_name,ide_id,legacy_path,created_at")
      .single()
    if (error) {
      setSavingProject(false)
      onNotice(error.message)
      return
    }
    if (projectDraft.handle) {
      try {
        await saveDirectoryHandle(localDirectoryKey(currentUserId, data.id), projectDraft.handle)
      } catch {
        onNotice("Projeto salvo, mas este navegador não conseguiu guardar o vínculo persistente da pasta.")
      }
    }
    setSavingProject(false)
    setProjectDialogOpen(false)
    await loadEnvironment()
  }

  async function chooseFolder(project: DeveloperLocalProject) {
    if (!currentUserId) return
    try {
      const handle = await pickDirectory(`project-${project.id}`)
      await saveDirectoryHandle(localDirectoryKey(currentUserId, project.id), handle)
      const { error } = await supabase.from("developer_local_projects").update({ folder_name: handle.name, legacy_path: "" }).eq("id", project.id).eq("user_id", currentUserId)
      if (error) throw error
      setFolderAvailability((current) => ({ ...current, [project.id]: true }))
      await loadEnvironment()
      onNotice(`Pasta “${handle.name}” vinculada neste navegador.`)
    } catch (error: any) {
      if (error?.name === "AbortError") return
      onNotice(String(error?.message ?? error ?? "Não foi possível selecionar a pasta."))
    }
  }

  async function assignIde(project: DeveloperLocalProject, ideId: string) {
    if (!currentUserId) return
    setLocalProjects((current) => current.map((item) => item.id === project.id ? { ...item, ideId } : item))
    const { error } = await supabase.from("developer_local_projects").update({ ide_id: ideId || null }).eq("id", project.id).eq("user_id", currentUserId)
    if (error) {
      onNotice(error.message)
      await loadEnvironment()
    }
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

    if (folderAvailability[project.id]) {
      try {
        const allowed = await verifyFolder(project)
        if (!allowed) {
          onNotice("O navegador perdeu a permissão da pasta. Clique em Pasta e selecione-a novamente.")
          return
        }
      } catch {
        // O vínculo local não impede a tentativa de abrir a IDE.
      }
    }

    const uri = buildLaunchUri(ide, project)
    if (!uri) {
      onNotice(`${ide.name} está vinculada ao projeto, mas precisa de um protocolo/launcher personalizado para abrir pelo navegador.`)
      return
    }

    window.location.href = uri
    if (!project.legacyPath && !ide.customUriTemplate.trim()) {
      onNotice(`Abrindo ${ide.name}. Por segurança, navegadores não revelam o caminho absoluto da pasta selecionada; o vínculo da pasta continua salvo localmente no Devboard.`)
    }
  }

  if (!currentUserId) return null

  return (
    <section className="rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Code2 className="size-[1.1rem]" /></span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold sm:text-base">Ambiente de desenvolvimento</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Cadastre várias IDEs e diga qual delas cada projeto local deve usar.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <button type="button" onClick={openNewIde} className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold hover:bg-muted"><Plus className="size-3.5" />IDE</button>
          <button type="button" onClick={openNewProject} disabled={!ides.length} className="inline-flex h-9 items-center gap-2 rounded-xl bg-foreground px-3 text-xs font-semibold text-background disabled:cursor-not-allowed disabled:opacity-40"><FolderOpen className="size-3.5" />Projeto local</button>
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-5">
        <div>
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold">Minhas IDEs</p><p className="mt-0.5 text-[0.66rem] text-muted-foreground">Delphi, VS Code, Cursor e quantas outras você precisar.</p></div>
            <span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">{ides.length}</span>
          </div>
          {ides.length === 0 ? (
            <button type="button" onClick={openNewIde} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-7 text-xs font-medium text-muted-foreground hover:bg-muted/35"><Plus className="size-4" />Adicionar primeira IDE</button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {ides.map((ide) => (
                <div key={ide.id} className="group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background/45 p-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">{iconFor(ide)}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold" title={ide.name}>{ide.name}</p><p className="mt-0.5 truncate text-[0.64rem] text-muted-foreground">{kindLabel(ide.kind)}</p></div>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => editIde(ide)} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Editar IDE"><Pencil className="size-3.5" /></button>
                    <button type="button" onClick={() => void deleteIde(ide)} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover IDE"><Trash2 className="size-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-border pt-5">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <div><p className="text-xs font-semibold">Projetos locais</p><p className="mt-0.5 text-[0.66rem] text-muted-foreground">Cada pasta pode usar uma IDE diferente. O vínculo da pasta fica somente neste navegador.</p></div>
            <span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">{localProjects.length}</span>
          </div>

          {!pickerSupported && (
            <div className="mb-3 rounded-xl border border-warning/20 bg-warning/5 px-3 py-2.5 text-[0.66rem] leading-relaxed text-muted-foreground">A seleção nativa de pasta não está disponível neste navegador. No desktop, use Chrome ou Edge atualizado para vincular diretórios sem digitar caminhos.</div>
          )}

          {localProjects.length === 0 ? (
            <button type="button" onClick={openNewProject} disabled={!ides.length} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-7 text-xs font-medium text-muted-foreground hover:bg-muted/35 disabled:opacity-40"><Folder className="size-4" />{ides.length ? "Vincular um projeto local" : "Adicione uma IDE primeiro"}</button>
          ) : (
            <div className="space-y-2">
              {localProjects.map((project) => {
                const ide = ides.find((item) => item.id === project.ideId)
                const hasLocalFolder = folderAvailability[project.id] === true
                return (
                  <div key={project.id} className="grid min-w-0 gap-3 rounded-xl border border-border bg-background/45 p-3 md:grid-cols-[minmax(0,1fr)_minmax(180px,260px)_auto] md:items-center">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", hasLocalFolder || project.legacyPath ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{hasLocalFolder || project.legacyPath ? <FolderCheck className="size-4" /> : <Folder className="size-4" />}</span>
                      <div className="min-w-0"><p className="truncate text-xs font-semibold" title={project.name}>{project.name}</p><p className="mt-0.5 truncate text-[0.64rem] text-muted-foreground" title={project.folderName || project.legacyPath}>{project.folderName || project.legacyPath || "Pasta ainda não selecionada"}</p></div>
                    </div>

                    <select value={project.ideId ?? ""} onChange={(event) => void assignIde(project, event.target.value)} className="h-9 min-w-0 rounded-xl border border-border bg-background px-2.5 text-xs outline-none focus:border-primary">
                      <option value="">Escolher IDE</option>
                      {ides.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>

                    <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                      <button type="button" onClick={() => void chooseFolder(project)} disabled={!pickerSupported} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-2.5 text-[0.67rem] font-semibold text-muted-foreground hover:bg-muted disabled:opacity-40" title="Escolher ou trocar pasta"><FolderOpen className="size-3.5" /><span className="hidden sm:inline">Pasta</span></button>
                      <button type="button" onClick={() => void openProject(project)} disabled={!ide} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-2.5 text-[0.67rem] font-semibold text-background disabled:opacity-35" title={ide ? `Abrir ${ide.name}` : "Escolha uma IDE"}>{ide ? iconFor(ide) : <Code2 className="size-3.5" />}<span className="hidden sm:inline">Abrir</span></button>
                      <button type="button" onClick={() => void deleteProject(project)} className="flex size-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remover projeto local"><Trash2 className="size-3.5" /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl bg-muted/45 px-3 py-2.5 text-[0.64rem] leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">Privacidade da pasta:</strong> o navegador não entrega o caminho absoluto de diretórios escolhidos. O Devboard guarda o acesso à pasta no IndexedDB deste dispositivo e sincroniza apenas nome do projeto, pasta e IDE escolhida. Para abrir Delphi/Visual Studio/JetBrains diretamente em um projeto, você pode configurar um protocolo/launcher local na IDE usando os marcadores <code>{"{project}"}</code>, <code>{"{folder}"}</code> e <code>{"{projectId}"}</code>.
        </div>
      </div>

      <Dialog open={ideDialogOpen} onOpenChange={setIdeDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader><DialogTitle>{ideDraft.id ? "Editar IDE" : "Adicionar IDE"}</DialogTitle><DialogDescription>Crie um atalho visual para cada ambiente que você usa no dia a dia.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label><input value={ideDraft.name} onChange={(event) => setIdeDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Delphi 12" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tipo</label><select value={ideDraft.kind} onChange={(event) => changeIdeKind(event.target.value as DeveloperIdeKind)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary">{IDE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Ícone</label><div className="grid grid-cols-9 gap-1 rounded-xl border border-border bg-background p-1">{ICON_OPTIONS.map((icon) => { const Icon = ICONS[icon]; return <button key={icon} type="button" onClick={() => setIdeDraft((current) => ({ ...current, icon }))} className={cn("flex h-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted", ideDraft.icon === icon && "bg-primary/10 text-primary ring-1 ring-primary/25")} title={`Ícone ${icon}`}><Icon className="size-3.5" /></button> })}</div></div>
            </div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Protocolo/launcher avançado <span className="font-normal">(opcional)</span></label><input value={ideDraft.customUriTemplate} onChange={(event) => setIdeDraft((current) => ({ ...current, customUriTemplate: event.target.value }))} placeholder="devlauncher://open?project={projectId}" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/50 focus:border-primary" /><p className="mt-1.5 text-[0.63rem] leading-relaxed text-muted-foreground">Use somente se você tiver um protocolo local registrado. Marcadores: {"{project}"}, {"{folder}"} e {"{projectId}"}. VS Code e Cursor abrem o aplicativo automaticamente.</p></div>
          </div>
          <DialogFooter><button type="button" onClick={() => setIdeDialogOpen(false)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold">Cancelar</button><button type="button" onClick={() => void saveIde()} disabled={!ideDraft.name.trim() || savingIde} className="h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">{savingIde ? "Salvando..." : "Salvar IDE"}</button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader><DialogTitle>Novo projeto local</DialogTitle><DialogDescription>Escolha a pasta pelo navegador e defina qual IDE deve ser usada para este projeto.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label><input value={projectDraft.name} onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: ERP Softwork" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">IDE deste projeto</label><select value={projectDraft.ideId} onChange={(event) => setProjectDraft((current) => ({ ...current, ideId: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="">Escolher IDE</option>{ides.map((ide) => <option key={ide.id} value={ide.id}>{ide.name}</option>)}</select></div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Pasta</label><button type="button" onClick={() => void chooseFolderForDraft()} disabled={!pickerSupported} className={cn("flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left transition-colors", projectDraft.handle ? "border-success/25 bg-success/5" : "border-dashed border-border bg-background hover:bg-muted/35", !pickerSupported && "cursor-not-allowed opacity-45")}><span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", projectDraft.handle ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{projectDraft.handle ? <FolderCheck className="size-4" /> : <FolderOpen className="size-4" />}</span><span className="min-w-0"><span className="block truncate text-xs font-semibold">{projectDraft.handle?.name ?? "Escolher pasta do projeto"}</span><span className="mt-0.5 block text-[0.63rem] text-muted-foreground">{projectDraft.handle ? "Acesso será salvo neste navegador" : "Abre o seletor nativo de diretórios"}</span></span></button></div>
          </div>
          <DialogFooter><button type="button" onClick={() => setProjectDialogOpen(false)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold">Cancelar</button><button type="button" onClick={() => void saveProject()} disabled={!projectDraft.name.trim() || !projectDraft.ideId || savingProject} className="h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">{savingProject ? "Salvando..." : "Adicionar projeto"}</button></DialogFooter>
        </DialogContent>
      </Dialog>

      {loading && <div className="px-4 pb-4 text-[0.65rem] text-muted-foreground">Carregando ambiente local...</div>}
    </section>
  )
}
