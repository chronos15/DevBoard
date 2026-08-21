"use client"

import * as React from "react"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  GitBranch,
  History,
  Link2,
  LoaderCircle,
  RefreshCw,
  Upload,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { DeveloperLocalProjectRecord } from "@/lib/developer/context"
import {
  commitDeveloperVcs,
  DEVELOPER_VCS_CHANGED_EVENT,
  developerVcsProviderLabel,
  developerVcsRemoteUrl,
  getDeveloperVcsLog,
  getDeveloperVcsStatus,
  openDeveloperVcsNative,
  pushDeveloperVcs,
  updateDeveloperVcs,
  type DeveloperVcsLogEntry,
  type DeveloperVcsStatus,
} from "@/lib/developer/vcs"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type ActiveTask = {
  subactivityId: string
  title: string
  devboardProjectId: string
  projectName: string
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: DeveloperLocalProjectRecord | null
  currentUserId: string
  activeTask?: ActiveTask | null
  initialStatus?: DeveloperVcsStatus | null
  onStatusChanged?: (status: DeveloperVcsStatus) => void
  onNotice: (message: string | null) => void
}

type Tab = "changes" | "history"

type LinkedChange = {
  revision: string
  subactivityId: string | null
}

function relativeTime(value: string) {
  const date = new Date(value)
  const diff = Math.max(0, Date.now() - date.getTime())
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "agora"
  if (minutes < 60) return `${minutes} min atrás`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h atrás`
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })
}

function statusTone(status?: DeveloperVcsStatus | null) {
  if (!status || status.provider === "none") return "text-muted-foreground"
  if (status.conflicted > 0) return "text-destructive"
  if (status.changedCount > 0) return "text-warning"
  return "text-success"
}

function conciseStatus(status?: DeveloperVcsStatus | null) {
  if (!status) return "Consultando..."
  if (status.provider === "none") return "Nenhum Git/SVN detectado"
  if (!status.directStatus && status.provider === "svn") return "TortoiseSVN detectado"
  if (status.conflicted > 0) return `${status.conflicted} conflito${status.conflicted === 1 ? "" : "s"}`
  if (status.changedCount > 0) return `${status.changedCount} alteraç${status.changedCount === 1 ? "ão" : "ões"}`
  return "Working copy limpa"
}

export function DeveloperVcsDialog({
  open,
  onOpenChange,
  project,
  currentUserId,
  activeTask,
  initialStatus,
  onStatusChanged,
  onNotice,
}: Props) {
  const supabase = React.useMemo(() => createClient(), [])
  const [tab, setTab] = React.useState<Tab>("changes")
  const [status, setStatus] = React.useState<DeveloperVcsStatus | null>(initialStatus ?? null)
  const [logs, setLogs] = React.useState<DeveloperVcsLogEntry[]>([])
  const [linkedChanges, setLinkedChanges] = React.useState<LinkedChange[]>([])
  const [linkedProjectIds, setLinkedProjectIds] = React.useState<string[]>([])
  const [loadingStatus, setLoadingStatus] = React.useState(false)
  const [loadingLogs, setLoadingLogs] = React.useState(false)
  const [busyAction, setBusyAction] = React.useState<"commit" | "update" | "push" | "native" | null>(null)
  const [commitOpen, setCommitOpen] = React.useState(false)
  const [commitMessage, setCommitMessage] = React.useState("")
  const [includeUnversioned, setIncludeUnversioned] = React.useState(true)
  // O status do projeto é devolvido ao componente pai após cada consulta. Isso faz o
  // `initialStatus` receber uma nova referência e também pode recriar callbacks do pai.
  // Sem este controle, o efeito de inicialização era executado novamente e resetava
  // `tab` para Alterações e fechava o editor de Commit logo após o clique do usuário.
  const initializedProjectIdRef = React.useRef<string | null>(null)

  const activeMatches = Boolean(activeTask && (project?.devboardProjectId === activeTask.devboardProjectId || linkedProjectIds.includes(activeTask.devboardProjectId)))
  const remoteUrl = developerVcsRemoteUrl(status?.repository ?? "")

  const refreshStatus = React.useCallback(async (allowFolderPicker = false) => {
    if (!project) return null
    setLoadingStatus(true)
    try {
      const next = await getDeveloperVcsStatus(project, { allowFolderPicker })
      setStatus(next)
      onStatusChanged?.(next)
      return next
    } catch (error: any) {
      onNotice(String(error?.message ?? error ?? "Não foi possível consultar o controle de versão."))
      return null
    } finally {
      setLoadingStatus(false)
    }
  }, [onNotice, onStatusChanged, project])

  const loadLinks = React.useCallback(async () => {
    if (!project) return
    const [{ data: contexts }, { data: linked }] = await Promise.all([
      supabase.from("developer_contexts").select("devboard_project_id").eq("user_id", currentUserId).eq("local_project_id", project.id),
      supabase.from("developer_vcs_changes").select("revision,subactivity_id").eq("user_id", currentUserId).eq("local_project_id", project.id).order("committed_at", { ascending: false }).limit(100),
    ])
    setLinkedProjectIds(Array.from(new Set((contexts ?? []).map((row: any) => String(row.devboard_project_id ?? "")).filter(Boolean))))
    setLinkedChanges((linked ?? []).map((row: any) => ({ revision: String(row.revision), subactivityId: row.subactivity_id ? String(row.subactivity_id) : null })))
  }, [currentUserId, project, supabase])

  const refreshLogs = React.useCallback(async () => {
    if (!project) return
    setLoadingLogs(true)
    try {
      const result = await getDeveloperVcsLog(project, { limit: 30 })
      setLogs(result.entries)
    } catch (error: any) {
      onNotice(String(error?.message ?? error ?? "Não foi possível carregar os logs."))
    } finally {
      setLoadingLogs(false)
    }
  }, [onNotice, project])

  React.useEffect(() => {
    if (!open || !project) {
      initializedProjectIdRef.current = null
      return
    }

    // Inicializa a UI somente uma vez por abertura/projeto. Atualizações de status
    // vindas do Agent não podem alterar a aba escolhida nem fechar o formulário de commit.
    if (initializedProjectIdRef.current === project.id) return
    initializedProjectIdRef.current = project.id

    setStatus(initialStatus ?? null)
    setTab("changes")
    setCommitOpen(false)
    setCommitMessage(activeTask?.title ?? "")
    void Promise.all([refreshStatus(true), loadLinks()])
  }, [activeTask?.title, initialStatus, loadLinks, open, project, refreshStatus])

  React.useEffect(() => {
    if (!open || tab !== "history" || !project) return
    void refreshLogs()
  }, [open, project, refreshLogs, tab])

  async function recordChange(revision: string, message: string, source: "direct" | "manual", committedAt?: string) {
    if (!project || !activeTask || !activeMatches || !revision.trim() || !status || status.provider === "none") return false
    const { error } = await supabase.from("developer_vcs_changes").upsert({
      user_id: currentUserId,
      local_project_id: project.id,
      devboard_project_id: activeTask.devboardProjectId,
      subactivity_id: activeTask.subactivityId,
      provider: status?.provider,
      revision: revision.trim(),
      branch: status?.branch ?? "",
      repository: status?.repository ?? "",
      message: message.trim(),
      source,
      committed_at: committedAt || new Date().toISOString(),
    }, { onConflict: "user_id,local_project_id,provider,revision,subactivity_id", ignoreDuplicates: true })
    if (error) {
      if (/developer_vcs_changes/i.test(error.message)) {
        onNotice("Alteração concluída localmente, mas o vínculo com a tarefa exige a migration 019.")
      } else {
        onNotice(`Alteração concluída, mas não consegui vinculá-la à tarefa: ${error.message}`)
      }
      return false
    }
    await loadLinks()
    return true
  }

  async function runCommit() {
    if (!project || !commitMessage.trim() || busyAction) return
    setBusyAction("commit")
    try {
      const result = await commitDeveloperVcs(project, { message: commitMessage.trim(), includeUnversioned, allowFolderPicker: true })
      if (result.nativeOpened) {
        onNotice("TortoiseSVN aberto com a mensagem preenchida. Confirme o commit na janela nativa e depois atualize os logs.")
      } else {
        if (result.revision && activeMatches) await recordChange(result.revision, commitMessage, "direct")
        onNotice(`${result.message}${result.revision ? ` ${result.revision}` : ""}`)
      }
      setCommitOpen(false)
      const next = await refreshStatus()
      if (next?.provider !== "none") window.dispatchEvent(new Event(DEVELOPER_VCS_CHANGED_EVENT))
      if (tab === "history") await refreshLogs()
    } catch (error: any) {
      onNotice(String(error?.message ?? error ?? "Não foi possível concluir o commit."))
    } finally {
      setBusyAction(null)
    }
  }

  async function runUpdate() {
    if (!project || busyAction) return
    if ((status?.changedCount ?? 0) > 0 && !window.confirm(`Existem ${status?.changedCount} alterações locais. Deseja atualizar mesmo assim?`)) return
    setBusyAction("update")
    try {
      const result = await updateDeveloperVcs(project, { allowFolderPicker: true })
      onNotice(result.message)
      await refreshStatus()
      if (tab === "history") await refreshLogs()
      window.dispatchEvent(new Event(DEVELOPER_VCS_CHANGED_EVENT))
    } catch (error: any) {
      onNotice(String(error?.message ?? error ?? "Não foi possível atualizar o projeto."))
    } finally {
      setBusyAction(null)
    }
  }

  async function runPush() {
    if (!project || busyAction) return
    setBusyAction("push")
    try {
      const result = await pushDeveloperVcs(project)
      onNotice(result.message)
      await refreshStatus()
      window.dispatchEvent(new Event(DEVELOPER_VCS_CHANGED_EVENT))
    } catch (error: any) {
      onNotice(String(error?.message ?? error ?? "Não foi possível enviar os commits."))
    } finally {
      setBusyAction(null)
    }
  }

  async function openNative(command: "status" | "log" | "commit" | "update") {
    if (!project || busyAction) return
    setBusyAction("native")
    try {
      await openDeveloperVcsNative(project, command, command === "commit" ? commitMessage : "")
      onNotice("TortoiseSVN aberto.")
    } catch (error: any) {
      onNotice(String(error?.message ?? error ?? "Não foi possível abrir o TortoiseSVN."))
    } finally {
      setBusyAction(null)
    }
  }

  async function associateLog(entry: DeveloperVcsLogEntry) {
    if (!activeMatches) return
    const ok = await recordChange(entry.id, entry.message, "manual", entry.date)
    if (ok) onNotice(`${entry.shortId} associado à subatividade atual.`)
  }

  if (!project) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(86vh,760px)] flex-col overflow-hidden p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><GitBranch className="size-4" /></span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{project.name}</DialogTitle>
              <DialogDescription className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.68rem]">
                <span className={cn("font-medium", statusTone(status))}>{developerVcsProviderLabel(status?.provider ?? "none")} · {conciseStatus(status)}</span>
                {status?.branch && <span className="truncate">{status.branch}</span>}
                {status?.revision && <span className="font-mono">{status.revision}</span>}
              </DialogDescription>
            </div>
            <button type="button" onClick={() => void refreshStatus(true)} disabled={loadingStatus} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" title="Atualizar status"><RefreshCw className={cn("size-3.5", loadingStatus && "animate-spin")} /></button>
          </div>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <button type="button" onClick={() => setTab("changes")} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.68rem] font-semibold", tab === "changes" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><FileCode2 className="size-3.5" />Alterações{status && status.changedCount >= 0 ? ` (${status.changedCount})` : ""}</button>
            <button type="button" onClick={() => setTab("history")} className={cn("inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[0.68rem] font-semibold", tab === "history" ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><History className="size-3.5" />Histórico</button>
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              {remoteUrl && <a href={remoteUrl} target="_blank" rel="noreferrer" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" title="Abrir repositório"><ExternalLink className="size-3.5" /></a>}
              {status?.nativeAvailable && <button type="button" onClick={() => void openNative(tab === "history" ? "log" : "status")} disabled={busyAction !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[0.65rem] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">TortoiseSVN</button>}
            </div>
          </div>

          {status?.provider !== "none" && (
            <div className="grid grid-cols-3 gap-px border-b border-border bg-border sm:grid-cols-6">
              <Metric label="Alterados" value={status?.changedCount != null && status.changedCount >= 0 ? status.changedCount : "—"} />
              <Metric label="Novos" value={status?.added ?? 0} />
              <Metric label="Removidos" value={status?.removed ?? 0} />
              <Metric label="Conflitos" value={status?.conflicted ?? 0} danger={(status?.conflicted ?? 0) > 0} />
              <Metric label="À frente" value={status?.provider === "git" ? status.ahead : "—"} />
              <Metric label="Atrás" value={status?.provider === "git" ? status.behind : "—"} />
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!status && loadingStatus ? (
              <div className="flex items-center justify-center gap-2 px-4 py-14 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Consultando projeto local...</div>
            ) : status?.provider === "none" ? (
              <div className="px-5 py-10 text-center"><GitBranch className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-xs font-semibold">Nenhum repositório detectado</p><p className="mx-auto mt-1 max-w-md text-[0.68rem] leading-relaxed text-muted-foreground">A pasta vinculada não contém uma working copy Git ou SVN. O Agent procura também nos diretórios-pai.</p></div>
            ) : tab === "changes" ? (
              <div className="p-4">
                {status?.provider === "svn" && !status.directStatus ? (
                  <div className="rounded-xl border border-border bg-muted/35 p-4"><p className="text-xs font-semibold">TortoiseSVN encontrado</p><p className="mt-1 text-[0.68rem] leading-relaxed text-muted-foreground">O cliente de linha de comando <code className="font-mono">svn.exe</code> não foi encontrado. Update, Commit e Logs continuam disponíveis pela interface nativa do TortoiseSVN.</p><button type="button" onClick={() => void openNative("status")} className="mt-3 h-8 rounded-lg border border-border bg-background px-3 text-[0.67rem] font-semibold hover:bg-muted">Ver alterações no TortoiseSVN</button></div>
                ) : status?.files.length ? (
                  <div className="space-y-1">
                    {status.files.map((file, index) => <div key={`${file.path}-${index}`} className="flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/45"><span className={cn("min-w-16 shrink-0 rounded-md px-1.5 py-1 text-center text-[0.58rem] font-semibold", file.conflicted ? "bg-destructive/10 text-destructive" : file.label === "Novo" || file.label === "Adicionado" ? "bg-success/10 text-success" : file.label === "Removido" ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>{file.label}</span><span className="min-w-0 flex-1 truncate font-mono text-[0.68rem]" title={file.path}>{file.path}</span>{file.staged && <span className="shrink-0 text-[0.58rem] text-muted-foreground">staged</span>}</div>)}
                  </div>
                ) : (
                  <div className="rounded-xl border border-success/20 bg-success/5 px-4 py-8 text-center"><CheckCircle2 className="mx-auto size-5 text-success" /><p className="mt-2 text-xs font-semibold">Nenhuma alteração local</p><p className="mt-1 text-[0.67rem] text-muted-foreground">Seu projeto está limpo.</p></div>
                )}
              </div>
            ) : (
              <div className="p-4">
                {loadingLogs ? <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />Carregando histórico...</div> : status?.provider === "svn" && !status.directLog ? (
                  <div className="rounded-xl border border-border bg-muted/35 p-4"><p className="text-xs font-semibold">Logs disponíveis no TortoiseSVN</p><p className="mt-1 text-[0.68rem] text-muted-foreground">Instale o cliente de linha de comando SVN se quiser os logs renderizados dentro do Devboard.</p><button type="button" onClick={() => void openNative("log")} className="mt-3 h-8 rounded-lg border border-border bg-background px-3 text-[0.67rem] font-semibold hover:bg-muted">Abrir logs do TortoiseSVN</button></div>
                ) : logs.length === 0 ? <div className="py-10 text-center text-xs text-muted-foreground">Nenhum commit/revisão encontrado.</div> : <div className="space-y-1.5">{logs.map((entry) => {
                  const associated = linkedChanges.some((item) => item.subactivityId === activeTask?.subactivityId && (item.revision === entry.id || entry.id.startsWith(item.revision) || item.revision.startsWith(entry.id)))
                  return <div key={entry.id} className="rounded-xl border border-border bg-background/35 p-3"><div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 shrink-0 rounded-md bg-muted px-1.5 py-1 font-mono text-[0.6rem] font-semibold">{entry.shortId}</span><div className="min-w-0 flex-1"><p className="line-clamp-2 text-xs font-semibold leading-snug">{entry.message || "Sem mensagem"}</p><p className="mt-1 truncate text-[0.62rem] text-muted-foreground">{entry.author} · {relativeTime(entry.date)}{entry.filesChanged ? ` · ${entry.filesChanged} arquivos` : ""}</p></div>{activeMatches && <button type="button" onClick={() => void associateLog(entry)} disabled={associated} className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2 text-[0.6rem] font-semibold", associated ? "bg-success/10 text-success" : "border border-border text-muted-foreground hover:bg-muted hover:text-foreground")} title={associated ? "Já associado à tarefa atual" : "Associar à subatividade em execução"}>{associated ? <Check className="size-3" /> : <Link2 className="size-3" />}{associated ? "Vinculado" : "Associar"}</button>}</div></div>
                })}</div>}
              </div>
            )}
          </div>

          {status?.provider !== "none" && (
            <div className="border-t border-border bg-card px-4 py-3">
              {activeTask && (
                <div className={cn("mb-2.5 flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-[0.64rem]", activeMatches ? "bg-primary/[0.06] text-muted-foreground" : "bg-muted/45 text-muted-foreground")}>
                  <span className={cn("size-1.5 shrink-0 rounded-full", activeMatches ? "bg-primary" : "bg-muted-foreground/40")} />
                  <span className="min-w-0 flex-1 truncate">{activeMatches ? `Commit será associado a: ${activeTask.title}` : `Tarefa ativa: ${activeTask.title} · vincule este projeto local ao projeto do Devboard para associar commits.`}</span>
                </div>
              )}

              {commitOpen && (
                <div className="mb-3 rounded-xl border border-border bg-background/45 p-3">
                  <label className="text-[0.64rem] font-semibold text-muted-foreground">Mensagem do commit</label>
                  <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} rows={3} autoFocus className="mt-1.5 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus:border-primary" placeholder="Descreva a alteração..." />
                  {status?.provider === "svn" && status.directCommit && <label className="mt-2 flex cursor-pointer items-center gap-2 text-[0.64rem] text-muted-foreground"><input type="checkbox" checked={includeUnversioned} onChange={(event) => setIncludeUnversioned(event.target.checked)} className="size-3.5 rounded border-border" />Incluir arquivos novos (respeita svn:ignore)</label>}
                  <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setCommitOpen(false)} className="h-8 rounded-lg border border-border px-2.5 text-[0.65rem] font-semibold">Cancelar</button><button type="button" onClick={() => void runCommit()} disabled={!commitMessage.trim() || busyAction !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[0.65rem] font-semibold text-primary-foreground disabled:opacity-40">{busyAction === "commit" && <LoaderCircle className="size-3 animate-spin" />}Commitar tudo</button></div>
                </div>
              )}

              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <button type="button" onClick={() => void runUpdate()} disabled={busyAction !== null} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-[0.67rem] font-semibold hover:bg-muted disabled:opacity-40">{busyAction === "update" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}{status?.provider === "svn" ? "Update" : "Pull"}</button>
                <button type="button" onClick={() => { setCommitOpen((value) => !value); if (!commitMessage.trim()) setCommitMessage(activeMatches ? activeTask?.title ?? "" : "") }} disabled={busyAction !== null || (status?.directStatus && status.changedCount === 0)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-3 text-[0.67rem] font-semibold text-background disabled:opacity-35"><GitBranch className="size-3.5" />Commit</button>
                {status?.provider === "git" && <button type="button" onClick={() => void runPush()} disabled={busyAction !== null || (Boolean(status.upstream) && status.ahead <= 0)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-background px-3 text-[0.67rem] font-semibold hover:bg-muted disabled:opacity-35">{busyAction === "push" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}Push{status.ahead > 0 ? ` (${status.ahead})` : ""}</button>}
                {status?.conflicted ? <span className="ml-auto inline-flex items-center gap-1.5 text-[0.64rem] font-semibold text-destructive"><AlertTriangle className="size-3.5" />Resolva os conflitos antes de continuar</span> : null}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Metric({ label, value, danger = false }: { label: string; value: React.ReactNode; danger?: boolean }) {
  return <div className="min-w-0 bg-card px-2.5 py-2 text-center"><p className="truncate text-[0.56rem] text-muted-foreground">{label}</p><p className={cn("mt-0.5 text-xs font-semibold", danger && "text-destructive")}>{value}</p></div>
}
