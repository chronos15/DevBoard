"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Boxes, ExternalLink, Music2, Play, Plus, Settings2, Trash2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import {
  DEVELOPER_CONTEXTS_EVENT,
  DEFAULT_DEVELOPER_SETTINGS,
  safeExternalUrl,
  startDeveloperFocusSession,
  type DeveloperMusicProvider,
} from "@/lib/developer/panel"
import {
  developerLaunchUri,
  normalizeDeveloperContext,
  normalizeDeveloperIde,
  normalizeDeveloperLocalProject,
  rememberDeveloperContext,
  type DeveloperContextRecord,
  type DeveloperIdeRecord,
  type DeveloperLocalProjectRecord,
} from "@/lib/developer/context"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type Props = { currentUserId: string; onNotice: (message: string | null) => void }

type Draft = {
  id?: string
  name: string
  devboardProjectId: string
  localProjectId: string
  ideId: string
  musicProvider: DeveloperMusicProvider
  musicUrl: string
  autoFocus: boolean
  autoOpenIde: boolean
  autoOpenMusic: boolean
}

function emptyDraft(): Draft {
  return { name: "", devboardProjectId: "", localProjectId: "", ideId: "", musicProvider: "spotify", musicUrl: "", autoFocus: true, autoOpenIde: true, autoOpenMusic: false }
}

export function DeveloperContexts({ currentUserId, onNotice }: Props) {
  const supabase = React.useMemo(() => createClient(), [])
  const router = useRouter()
  const { projects } = useStore()
  const projectFingerprint = JSON.stringify(projects.map((project) => ({ id: project.id, name: project.name })))
  const devboardProjects = React.useMemo<Array<{ id: string; name: string }>>(() => JSON.parse(projectFingerprint), [projectFingerprint])

  const [contexts, setContexts] = React.useState<DeveloperContextRecord[]>([])
  const [ides, setIdes] = React.useState<DeveloperIdeRecord[]>([])
  const [localProjects, setLocalProjects] = React.useState<DeveloperLocalProjectRecord[]>([])
  const [focusMinutes, setFocusMinutes] = React.useState(DEFAULT_DEVELOPER_SETTINGS.focusMinutes)
  const [loading, setLoading] = React.useState(true)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft>(emptyDraft)
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    const [{ data: contextRows, error }, { data: ideRows }, { data: localRows }, { data: settingsRow }] = await Promise.all([
      supabase.from("developer_contexts").select("id,name,devboard_project_id,local_project_id,ide_id,music_provider,music_url,auto_focus,auto_open_ide,auto_open_music,sort_order").eq("user_id", currentUserId).order("sort_order").order("created_at"),
      supabase.from("developer_ides").select("id,name,kind,icon,custom_uri_template").eq("user_id", currentUserId).order("sort_order"),
      supabase.from("developer_local_projects").select("id,name,folder_name,ide_id,legacy_path").eq("user_id", currentUserId).order("created_at"),
      supabase.from("developer_settings").select("focus_minutes").eq("user_id", currentUserId).maybeSingle(),
    ])
    if (error) throw error
    setContexts((contextRows ?? []).map(normalizeDeveloperContext))
    setIdes((ideRows ?? []).map(normalizeDeveloperIde))
    setLocalProjects((localRows ?? []).map(normalizeDeveloperLocalProject))
    setFocusMinutes(Number((settingsRow as any)?.focus_minutes || DEFAULT_DEVELOPER_SETTINGS.focusMinutes))
  }, [currentUserId, supabase])

  React.useEffect(() => {
    let alive = true
    setLoading(true)
    load().catch((error: any) => alive && onNotice(String(error?.message ?? error ?? "Não foi possível carregar contextos."))).finally(() => alive && setLoading(false))
    const channel = supabase
      .channel(`devboard-developer-contexts-ui-${currentUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_contexts", filter: `user_id=eq.${currentUserId}` }, () => void load())
      .subscribe()
    return () => { alive = false; void supabase.removeChannel(channel) }
  }, [currentUserId, load, onNotice, supabase])

  function newContext() {
    const firstLocal = localProjects[0]
    setDraft({ ...emptyDraft(), localProjectId: firstLocal?.id ?? "", ideId: firstLocal?.ideId ?? ides[0]?.id ?? "" })
    setDialogOpen(true)
  }

  function editContext(context: DeveloperContextRecord) {
    setDraft({
      id: context.id,
      name: context.name,
      devboardProjectId: context.devboardProjectId ?? "",
      localProjectId: context.localProjectId ?? "",
      ideId: context.ideId ?? "",
      musicProvider: context.musicProvider,
      musicUrl: context.musicUrl,
      autoFocus: context.autoFocus,
      autoOpenIde: context.autoOpenIde,
      autoOpenMusic: context.autoOpenMusic,
    })
    setDialogOpen(true)
  }

  function changeLocalProject(localProjectId: string) {
    const local = localProjects.find((item) => item.id === localProjectId)
    setDraft((current) => ({ ...current, localProjectId, ideId: local?.ideId ?? current.ideId }))
  }

  async function save() {
    if (!draft.name.trim() || saving) return
    setSaving(true)
    const row = {
      user_id: currentUserId,
      name: draft.name.trim(),
      devboard_project_id: draft.devboardProjectId || null,
      local_project_id: draft.localProjectId || null,
      ide_id: draft.ideId || null,
      music_provider: draft.musicProvider,
      music_url: draft.musicUrl.trim(),
      auto_focus: draft.autoFocus,
      auto_open_ide: draft.autoOpenIde,
      auto_open_music: draft.autoOpenMusic,
    }
    const query = draft.id
      ? supabase.from("developer_contexts").update(row).eq("id", draft.id).eq("user_id", currentUserId)
      : supabase.from("developer_contexts").insert(row)
    const { error } = await query
    setSaving(false)
    if (error) { onNotice(error.message); return }
    setDialogOpen(false)
    await load()
    window.dispatchEvent(new Event(DEVELOPER_CONTEXTS_EVENT))
    onNotice(draft.id ? "Contexto atualizado." : "Contexto criado.")
  }

  async function remove(context: DeveloperContextRecord) {
    if (!window.confirm(`Remover o contexto “${context.name}”? Seus projetos e IDEs não serão apagados.`)) return
    const { error } = await supabase.from("developer_contexts").delete().eq("id", context.id).eq("user_id", currentUserId)
    if (error) { onNotice(error.message); return }
    await load()
    window.dispatchEvent(new Event(DEVELOPER_CONTEXTS_EVENT))
  }

  function launch(context: DeveloperContextRecord) {
    rememberDeveloperContext(currentUserId, context)
    const local = localProjects.find((item) => item.id === context.localProjectId) ?? null
    const ide = ides.find((item) => item.id === (context.ideId || local?.ideId)) ?? null

    if (context.autoFocus) startDeveloperFocusSession(currentUserId, focusMinutes)
    if (context.autoOpenMusic) {
      const music = safeExternalUrl(context.musicUrl)
      if (music) window.open(music, "_blank", "noopener,noreferrer")
    }
    if (context.autoOpenIde) {
      const uri = developerLaunchUri(ide, local)
      if (uri) {
        const a = document.createElement("a")
        a.href = uri
        a.style.display = "none"
        document.body.appendChild(a)
        a.click()
        a.remove()
      } else if (ide) {
        onNotice(`${ide.name} precisa de um launcher/protocolo configurado para este contexto.`)
      }
    }
    if (context.devboardProjectId) router.push(`/projetos/${context.devboardProjectId}`)
  }

  return (
    <>
      <section className="min-w-0 rounded-2xl border border-border bg-card">
        <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Boxes className="size-[1.05rem]" /></span>
          <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Contextos</h2><p className="mt-0.5 truncate text-[0.67rem] text-muted-foreground">Projeto + IDE + foco + música em um clique.</p></div>
          <button type="button" onClick={newContext} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Novo contexto"><Plus className="size-3.5" /></button>
        </div>
        <div className="p-2.5">
          {loading ? <div className="py-5 text-center text-[0.67rem] text-muted-foreground">Carregando contextos...</div> : contexts.length === 0 ? (
            <button type="button" onClick={newContext} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-5 text-xs font-medium text-muted-foreground hover:bg-muted/35"><Plus className="size-3.5" />Criar primeiro contexto</button>
          ) : (
            <div className="max-h-[225px] space-y-0.5 overflow-y-auto overscroll-contain">
              {contexts.map((context) => {
                const project = devboardProjects.find((item) => item.id === context.devboardProjectId)
                const local = localProjects.find((item) => item.id === context.localProjectId)
                const ide = ides.find((item) => item.id === (context.ideId || local?.ideId))
                return (
                  <div key={context.id} className="group flex min-w-0 items-center gap-2 rounded-xl px-2 py-2 hover:bg-muted/45">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Play className="size-3.5" /></span>
                    <button type="button" onClick={() => editContext(context)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-xs font-semibold" title={context.name}>{context.name}</span>
                      <span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground" title={`${project?.name ?? "Sem projeto"} · ${ide?.name ?? "Sem IDE"}`}>{project?.name ?? "Sem projeto"} · {ide?.name ?? "Sem IDE"}</span>
                    </button>
                    <button type="button" onClick={() => launch(context)} className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background" title="Iniciar contexto"><ExternalLink className="size-3.5" /></button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader><DialogTitle>{draft.id ? "Editar contexto" : "Novo contexto"}</DialogTitle><DialogDescription>Monte um atalho de trabalho. Você decide o que acontece ao iniciar este contexto.</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome</label><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: ERP Delphi" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Projeto no Devboard</label><select value={draft.devboardProjectId} onChange={(event) => setDraft((current) => ({ ...current, devboardProjectId: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="">Sem vínculo</option>{devboardProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Projeto local</label><select value={draft.localProjectId} onChange={(event) => changeLocalProject(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="">Sem projeto local</option>{localProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">IDE</label><select value={draft.ideId} onChange={(event) => setDraft((current) => ({ ...current, ideId: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="">IDE do projeto local</option>{ides.map((ide) => <option key={ide.id} value={ide.id}>{ide.name}</option>)}</select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Música</label><select value={draft.musicProvider} onChange={(event) => setDraft((current) => ({ ...current, musicProvider: event.target.value as DeveloperMusicProvider }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary"><option value="spotify">Spotify</option><option value="youtube-music">YouTube Music</option></select></div>
            </div>
            <div><label className="mb-1.5 block text-xs font-medium text-muted-foreground">Playlist / música <span className="font-normal">(opcional)</span></label><input value={draft.musicUrl} onChange={(event) => setDraft((current) => ({ ...current, musicUrl: event.target.value }))} placeholder="https://open.spotify.com/playlist/..." className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { key: "autoFocus" as const, label: "Modo foco", icon: Play },
                { key: "autoOpenIde" as const, label: "Abrir IDE", icon: Settings2 },
                { key: "autoOpenMusic" as const, label: "Abrir música", icon: Music2 },
              ].map(({ key, label, icon: Icon }) => <button key={key} type="button" onClick={() => setDraft((current) => ({ ...current, [key]: !current[key] }))} className={cn("flex h-10 items-center justify-center gap-2 rounded-xl border text-xs font-semibold", draft[key] ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground")}><Icon className="size-3.5" />{label}</button>)}
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <div>{draft.id && <button type="button" onClick={() => { const context = contexts.find((item) => item.id === draft.id); if (context) void remove(context); setDialogOpen(false) }} className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5" />Remover</button>}</div>
            <div className="flex gap-2"><button type="button" onClick={() => setDialogOpen(false)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold">Cancelar</button><button type="button" onClick={() => void save()} disabled={!draft.name.trim() || saving} className="h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-40">{saving ? "Salvando..." : "Salvar contexto"}</button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
