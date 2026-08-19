"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Columns3,
  FileText,
  Filter,
  FolderKanban,
  ImageIcon,
  List,
  Paperclip,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  UserRound,
  Video,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { createClient } from "@/lib/supabase/client"
import { TOPIC_MEDIA_BUCKET, chatMediaKind } from "@/lib/supabase/helpers"
import type { SupportTopic, SupportTopicStatus, TopicAttachment } from "@/lib/types"
import { supportTopicDisplayStatus, type SupportTopicDisplayStatus } from "@/lib/project-utils"
import { PageHeading } from "@/components/page-heading"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const columns: Array<{ status: SupportTopicDisplayStatus; label: string; tone: string; helper: string }> = [
  { status: "open", label: "Aberto", tone: "bg-chart-2", helper: "Aguardando triagem" },
  { status: "analyzing", label: "Em análise", tone: "bg-chart-3", helper: "AQS / DEV / Admin" },
  { status: "sent-to-dev", label: "Enviado ao DEV", tone: "bg-chart-5", helper: "Convertido em atividade" },
  { status: "completed-dev", label: "Concluído Dev.", tone: "bg-success", helper: "Atividade concluída pelo desenvolvimento" },
  { status: "revoked", label: "Revogado", tone: "bg-destructive", helper: "Devolvido ao solicitante" },
]

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function dateKey(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function statusClass(status: SupportTopicDisplayStatus) {
  if (status === "completed-dev") return "bg-success/15 text-success"
  if (status === "sent-to-dev") return "bg-chart-5/15 text-chart-5"
  if (status === "revoked") return "bg-destructive/10 text-destructive"
  if (status === "analyzing") return "bg-chart-3/15 text-chart-3"
  return "bg-chart-2/15 text-chart-2"
}

function selectClassName() {
  return "h-10 w-full min-w-0 rounded-xl border border-border bg-card pl-3 pr-10 text-sm outline-none transition-colors focus:border-ring"
}

function todayDateKey() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}


function attachmentKindLabel(kind: TopicAttachment["kind"]) {
  if (kind === "image") return "Imagem"
  if (kind === "video") return "Vídeo"
  if (kind === "audio") return "Áudio"
  return "Documento"
}

function AttachmentPreview({ attachment }: { attachment: TopicAttachment }) {
  const supabase = React.useMemo(() => createClient(), [])
  const [url, setUrl] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true
    void supabase.storage.from(TOPIC_MEDIA_BUCKET).createSignedUrl(attachment.storagePath, 60 * 20).then(({ data, error }) => {
      if (!active) return
      if (!error) setUrl(data.signedUrl)
      setLoading(false)
    })
    return () => { active = false }
  }, [attachment.storagePath, supabase])

  if (loading) return <div className="h-52 animate-pulse rounded-2xl border border-border bg-muted/40" />
  if (!url) return <div className="flex h-52 items-center justify-center rounded-2xl border border-dashed border-border bg-card/60 p-5 text-center text-xs text-muted-foreground">Não foi possível abrir este arquivo.</div>

  const label = attachmentKindLabel(attachment.kind)
  const media = attachment.kind === "image"
    ? <a href={url} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center p-2.5"><img src={url} alt={attachment.name} className="h-full w-full rounded-lg object-contain" /></a>
    : attachment.kind === "video"
      ? <video src={url} controls className="h-full w-full rounded-lg bg-black object-contain" />
      : (
        <a href={url} target="_blank" rel="noreferrer" className="flex h-full w-full flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-border/70 bg-background/60 p-4 text-center transition-colors hover:bg-muted/40">
          <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground"><FileText className="size-4" /></span>
          <div className="min-w-0 max-w-full">
            <p className="truncate text-sm font-semibold text-foreground">{attachment.name}</p>
            <p className="mt-1 text-[0.66rem] text-muted-foreground">Clique para abrir</p>
          </div>
        </a>
      )

  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/70 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-md">
      <div className="flex items-center justify-between gap-2.5 border-b border-border/70 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            {attachment.kind === "image" ? <ImageIcon className="size-3.5" /> : attachment.kind === "video" ? <Video className="size-3.5" /> : <FileText className="size-3.5" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold">{attachment.name}</p>
            <p className="truncate text-[0.62rem] text-muted-foreground">{attachment.mimeType || label}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[0.58rem] font-medium text-muted-foreground">{formatBytes(attachment.size)}</span>
      </div>
      <div className="bg-muted/20 p-2.5">
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-xl bg-background/65 lg:h-36 xl:h-40">
          {media}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-[0.62rem] font-medium text-muted-foreground">{label} · {formatDateTime(attachment.createdAt)}</p>
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Abrir arquivo">
          <ArrowRight className="size-3.5" />
        </a>
      </div>
    </article>
  )
}

function NewTopicDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { createSupportTopic } = useStore()
  const [orderNumber, setOrderNumber] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [files, setFiles] = React.useState<File[]>([])
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  function reset() {
    setOrderNumber("")
    setTitle("")
    setDescription("")
    setFiles([])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!orderNumber.trim() || title.trim().length < 3 || description.trim().length < 5 || files.length === 0 || saving) return
    setSaving(true)
    try {
      const id = await createSupportTopic({ orderNumber: orderNumber.trim(), title: title.trim(), description: description.trim(), files })
      if (id) {
        reset()
        onOpenChange(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { onOpenChange(value); if (!value && !saving) reset() }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Novo tópico</DialogTitle><DialogDescription>Abra uma solicitação completa para AQS, desenvolvimento ou administração. Evidências são obrigatórias.</DialogDescription></DialogHeader>
        <form id="new-topic-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Número da ordem *</span><input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="Ex: OS-45892" className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring" /></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Título *</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Resumo do problema" className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring" /></label>
          <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Descrição *</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Explique o cenário, comportamento atual, resultado esperado e como reproduzir..." className="resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" /></label>
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-medium">Evidências *</p><p className="text-[0.68rem] text-muted-foreground">Fotos, vídeos, PDFs, logs ou documentos · até 50 MB por arquivo.</p></div><Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Paperclip className="size-3.5" /> Adicionar</Button></div>
            <input ref={inputRef} type="file" multiple className="hidden" accept="image/*,video/*,application/pdf,text/*,.sql,.json,.log,.txt,.doc,.docx,.xls,.xlsx" onChange={(event) => { const picked = Array.from(event.target.files ?? []).filter((file) => file.size > 0 && file.size <= 50 * 1024 * 1024); setFiles((current) => [...current, ...picked]); event.currentTarget.value = "" }} />
            {files.length ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((file, index) => {
                  const kind = chatMediaKind(file)
                  const preview = kind === "image" ? URL.createObjectURL(file) : null
                  return (
                    <div key={`${file.name}-${index}`} className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-muted/25 p-2">
                      {kind === "image" && preview ? <img src={preview} alt="" className="h-20 w-full rounded-lg object-contain" onLoad={() => URL.revokeObjectURL(preview)} /> : kind === "video" ? <div className="flex h-20 items-center justify-center rounded-lg bg-muted"><Video className="size-5 text-muted-foreground" /></div> : <div className="flex h-20 items-center justify-center rounded-lg bg-muted"><FileText className="size-5 text-muted-foreground" /></div>}
                      <p className="mt-2 truncate text-[0.68rem] font-medium">{file.name}</p>
                      <button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm hover:text-destructive" aria-label="Remover arquivo"><X className="size-3.5" /></button>
                    </div>
                  )
                })}
              </div>
            ) : <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground transition-colors hover:bg-muted/40"><ImageIcon className="mb-2 size-5" />Adicione pelo menos uma evidência</button>}
          </div>
        </form>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" form="new-topic-form" disabled={!orderNumber.trim() || title.trim().length < 3 || description.trim().length < 5 || files.length === 0} loading={saving} loadingText="Abrindo tópico...">Abrir tópico</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TopicsView() {
  const router = useRouter()
  const {
    supportTopics,
    members,
    projects,
    currentUserRole,
    startSupportTopicAnalysis,
    revokeSupportTopic,
    sendSupportTopicToActivity,
    addSupportTopicAttachments,
  } = useStore()

  const [newOpen, setNewOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<SupportTopic | null>(null)
  const [search, setSearch] = React.useState("")
  const [viewMode, setViewMode] = React.useState<"kanban" | "list">("list")
  const [filtersOpen, setFiltersOpen] = React.useState(false)
  const [statusFilter, setStatusFilter] = React.useState<"all" | SupportTopicDisplayStatus>("all")
  const [dateFrom, setDateFrom] = React.useState(() => todayDateKey())
  const [dateTo, setDateTo] = React.useState(() => todayDateKey())
  const [creatorFilter, setCreatorFilter] = React.useState("all")
  const [analystFilter, setAnalystFilter] = React.useState("all")
  const [projectFilter, setProjectFilter] = React.useState("all")
  const [draftStatusFilter, setDraftStatusFilter] = React.useState<"all" | SupportTopicDisplayStatus>("all")
  const [draftDateFrom, setDraftDateFrom] = React.useState(() => todayDateKey())
  const [draftDateTo, setDraftDateTo] = React.useState(() => todayDateKey())
  const [draftCreatorFilter, setDraftCreatorFilter] = React.useState("all")
  const [draftAnalystFilter, setDraftAnalystFilter] = React.useState("all")
  const [draftProjectFilter, setDraftProjectFilter] = React.useState("all")
  const [busy, setBusy] = React.useState<string | null>(null)
  const [revokeOpen, setRevokeOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [sendOpen, setSendOpen] = React.useState(false)
  const [projectId, setProjectId] = React.useState("")
  const [developerId, setDeveloperId] = React.useState("")
  const addFilesRef = React.useRef<HTMLInputElement>(null)

  const canCreate = currentUserRole === "admin" || currentUserRole === "support" || currentUserRole === "member"
  const canAnalyze = currentUserRole === "admin" || currentUserRole === "developer" || currentUserRole === "aqs"
  const developers = members.filter((member) => member.role === "developer")
  const topicStatus = React.useCallback((topic: SupportTopic) => supportTopicDisplayStatus(topic, projects), [projects])

  const creatorOptions = React.useMemo(() => {
    const ids = new Set(supportTopics.map((topic) => topic.createdBy))
    return members.filter((member) => ids.has(member.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [members, supportTopics])

  const analystOptions = React.useMemo(() => {
    const ids = new Set(supportTopics.map((topic) => topic.assignedAnalystId).filter(Boolean) as string[])
    return members.filter((member) => ids.has(member.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [members, supportTopics])

  const topicProjectOptions = React.useMemo(() => {
    const ids = new Set(supportTopics.map((topic) => topic.projectId).filter(Boolean) as string[])
    return projects.filter((project) => ids.has(project.id)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [projects, supportTopics])

  const normalized = search.trim().toLowerCase()
  const visibleTopics = React.useMemo(() => supportTopics.filter((topic) => {
    if (normalized && !`${topic.orderNumber} ${topic.title} ${topic.description}`.toLowerCase().includes(normalized)) return false
    if (statusFilter !== "all" && topicStatus(topic) !== statusFilter) return false
    if (creatorFilter !== "all" && topic.createdBy !== creatorFilter) return false
    if (analystFilter !== "all" && topic.assignedAnalystId !== analystFilter) return false
    if (projectFilter !== "all" && topic.projectId !== projectFilter) return false
    const created = dateKey(topic.createdAt)
    if (dateFrom && created < dateFrom) return false
    if (dateTo && created > dateTo) return false
    return true
  }), [analystFilter, creatorFilter, dateFrom, dateTo, normalized, projectFilter, statusFilter, supportTopics, topicStatus])

  const today = todayDateKey()
  const activeFilterCount = [dateFrom !== today, dateTo !== today, statusFilter !== "all", creatorFilter !== "all", analystFilter !== "all", projectFilter !== "all"].filter(Boolean).length
  const hasFilters = activeFilterCount > 0

  React.useEffect(() => {
    if (!selected) return
    const fresh = supportTopics.find((topic) => topic.id === selected.id)
    if (fresh) setSelected(fresh)
  }, [selected?.id, supportTopics])

  React.useEffect(() => {
    if (supportTopics.length === 0) return

    const url = new URL(window.location.href)
    const topicId = url.searchParams.get("topic")
    if (!topicId) return

    const target = supportTopics.find((topic) => topic.id === topicId)
    if (!target) return

    // O parâmetro `topic` é apenas um comando de navegação para abrir o modal.
    // Consumimos ele imediatamente para que, ao fechar o modal, o effect não
    // leia a mesma URL e reabra o tópico em loop.
    url.searchParams.delete("topic")
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    )

    setSelected(target)
  }, [supportTopics])

  async function startAnalysis(topic: SupportTopic) {
    setBusy(topic.id)
    try { await startSupportTopicAnalysis(topic.id) } finally { setBusy(null) }
  }

  async function confirmRevoke() {
    if (!selected || reason.trim().length < 3) return
    setBusy(selected.id)
    try {
      const ok = await revokeSupportTopic(selected.id, reason.trim())
      if (ok) { setRevokeOpen(false); setReason("") }
    } finally { setBusy(null) }
  }

  async function sendToDev() {
    if (!selected || !projectId) return
    setBusy(selected.id)
    try {
      const activityId = await sendSupportTopicToActivity(selected.id, projectId, developerId || undefined)
      if (activityId) {
        setSendOpen(false)
        setProjectId("")
        setDeveloperId("")
      }
    } finally { setBusy(null) }
  }

  function openFilters() {
    setDraftStatusFilter(statusFilter)
    setDraftDateFrom(dateFrom)
    setDraftDateTo(dateTo)
    setDraftCreatorFilter(creatorFilter)
    setDraftAnalystFilter(analystFilter)
    setDraftProjectFilter(projectFilter)
    setFiltersOpen(true)
  }

  function clearDraftFilters() {
    setDraftStatusFilter("all")
    const today = todayDateKey()
    setDraftDateFrom(today)
    setDraftDateTo(today)
    setDraftCreatorFilter("all")
    setDraftAnalystFilter("all")
    setDraftProjectFilter("all")
  }

  function applyFilters() {
    setStatusFilter(draftStatusFilter)
    setDateFrom(draftDateFrom)
    setDateTo(draftDateTo)
    setCreatorFilter(draftCreatorFilter)
    setAnalystFilter(draftAnalystFilter)
    setProjectFilter(draftProjectFilter)
    setFiltersOpen(false)
  }

  const draftHasFilters = [
    draftDateFrom !== today,
    draftDateTo !== today,
    draftStatusFilter !== "all",
    draftCreatorFilter !== "all",
    draftAnalystFilter !== "all",
    draftProjectFilter !== "all",
  ].some(Boolean)

  return (
    <div className="min-w-0 space-y-5 sm:space-y-6">
      <PageHeading eyebrow="Suporte e demandas" title="Tópicos" subtitle="Central de solicitações com evidências, triagem e conversão direta em atividade de desenvolvimento." action={canCreate ? <Button onClick={() => setNewOpen(true)}><Plus className="size-4" /> Novo tópico</Button> : undefined} />

      <section className="rounded-2xl border border-border bg-card p-2.5 sm:p-3">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-background px-3.5 transition-colors focus-within:border-ring sm:h-10 sm:gap-2 sm:px-3">
            <Search className="size-[18px] shrink-0 text-muted-foreground sm:size-4" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ordem, título ou descrição..." className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
            {search && <button type="button" onClick={() => setSearch("")} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground sm:size-7" aria-label="Limpar busca"><X className="size-3.5" /></button>}
          </div>

          <div className="flex min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-xl bg-muted p-1 sm:flex-none">
              <button type="button" onClick={() => setViewMode("list")} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors sm:flex-none", viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><List className="size-3.5" />Lista</button>
              <button type="button" onClick={() => setViewMode("kanban")} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors sm:flex-none", viewMode === "kanban" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><Columns3 className="size-3.5" />Kanban</button>
            </div>
            <button type="button" onClick={openFilters} className={cn("relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", hasFilters && "border-primary/30 bg-primary/[0.06] text-primary")} aria-label="Abrir filtros">
              <SlidersHorizontal className="size-4" />
              {activeFilterCount > 0 && <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-[0.58rem] font-semibold text-primary-foreground">{activeFilterCount}</span>}
            </button>
          </div>
        </div>
        <p className="mt-2 px-0.5 text-[0.68rem] text-muted-foreground"><strong className="font-semibold text-foreground">{visibleTopics.length}</strong> tópico(s) encontrado(s)</p>
      </section>

      <Dialog open={filtersOpen} onOpenChange={(open) => { if (!open) setFiltersOpen(false) }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Filtros dos tópicos</DialogTitle>
            <DialogDescription>Refine a fila por status, período, solicitante, analista e projeto.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="min-w-0"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Filter className="size-3.5" />Status</span><select value={draftStatusFilter} onChange={(event) => setDraftStatusFilter(event.target.value as "all" | SupportTopicDisplayStatus)} className={selectClassName()}><option value="all">Todos</option>{columns.map((column) => <option key={column.status} value={column.status}>{column.label}</option>)}</select></label>
            <label className="min-w-0"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><FolderKanban className="size-3.5" />Projeto</span><select value={draftProjectFilter} onChange={(event) => setDraftProjectFilter(event.target.value)} className={selectClassName()}><option value="all">Todos</option>{topicProjectOptions.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
            <label className="min-w-0"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><UserRound className="size-3.5" />Solicitante</span><select value={draftCreatorFilter} onChange={(event) => setDraftCreatorFilter(event.target.value)} className={selectClassName()}><option value="all">Todos</option>{creatorOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <label className="min-w-0"><span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><UserRound className="size-3.5" />Analista</span><select value={draftAnalystFilter} onChange={(event) => setDraftAnalystFilter(event.target.value)} className={selectClassName()}><option value="all">Todos</option>{analystOptions.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><CalendarDays className="size-3.5" />Período</div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input aria-label="Data inicial" type="date" value={draftDateFrom} onChange={(event) => setDraftDateFrom(event.target.value)} className="h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring" />
                <input aria-label="Data final" type="date" value={draftDateTo} onChange={(event) => setDraftDateTo(event.target.value)} className="h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring" />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button type="button" variant="ghost" onClick={clearDraftFilters} disabled={!draftHasFilters}>Limpar filtros</Button>
            <Button type="button" onClick={applyFilters}>Aplicar filtros</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {viewMode === "kanban" ? (
        <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-3">
          <div className="flex w-max min-w-full flex-nowrap items-stretch gap-3">
            {columns.map((column) => {
              const topics = visibleTopics.filter((topic) => topicStatus(topic) === column.status)
              return (
                <section key={column.status} className="flex min-h-[500px] w-[285px] min-w-[285px] flex-col rounded-2xl border border-border bg-muted/25 p-2.5 xl:w-[310px] xl:min-w-[310px]">
                  <header className="px-1 py-1.5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className={cn("size-2 rounded-full", column.tone)} /><h2 className="text-xs font-semibold">{column.label}</h2></div><span className="rounded-full bg-card px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground ring-1 ring-foreground/8">{topics.length}</span></div><p className="mt-1 text-[0.65rem] text-muted-foreground">{column.helper}</p></header>
                  <div className="mt-2 flex flex-1 flex-col gap-2">
                    {topics.map((topic) => {
                      const creator = members.find((member) => member.id === topic.createdBy)
                      const analyst = members.find((member) => member.id === topic.assignedAnalystId)
                      return <button key={topic.id} type="button" onClick={() => setSelected(topic)} className="rounded-xl bg-card p-3 text-left shadow-sm ring-1 ring-foreground/8 transition-all hover:-translate-y-0.5 hover:shadow-md"><div className="flex items-center justify-between gap-2"><span className="font-mono text-[0.65rem] font-semibold text-primary">{topic.orderNumber}</span><span className="flex items-center gap-1 text-[0.62rem] text-muted-foreground"><Paperclip className="size-3" />{topic.attachments.length}</span></div><h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{topic.title}</h3><p className="mt-1 line-clamp-2 text-[0.68rem] leading-relaxed text-muted-foreground">{topic.description}</p><div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5"><div className="flex min-w-0 items-center gap-1.5"><MemberAvatar member={creator} className="size-6" /><span className="truncate text-[0.65rem] text-muted-foreground">{creator?.name ?? "Usuário"}</span></div>{analyst && <MemberAvatar member={analyst} className="size-6" />}</div></button>
                    })}
                    {topics.length === 0 && <div className="flex min-h-24 flex-1 items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-xs text-muted-foreground">Nenhum tópico nesta etapa.</div>}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      ) : (
        <section className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden grid-cols-[110px_minmax(200px,1.5fr)_150px_150px_140px_90px] gap-3 border-b border-border bg-muted/35 px-4 py-2.5 text-[0.68rem] font-medium text-muted-foreground lg:grid"><span>Ordem</span><span>Tópico</span><span>Solicitante</span><span>Analista</span><span>Status</span><span className="text-right">Arquivos</span></div>
          <div className="divide-y divide-border">
            {visibleTopics.map((topic) => {
              const creator = members.find((member) => member.id === topic.createdBy)
              const analyst = members.find((member) => member.id === topic.assignedAnalystId)
              const displayStatus = topicStatus(topic)
              const status = columns.find((item) => item.status === displayStatus)
              return (
                <button key={topic.id} type="button" onClick={() => setSelected(topic)} className="grid w-full min-w-0 gap-3 p-3 text-left transition-colors hover:bg-muted/35 sm:p-4 lg:grid-cols-[110px_minmax(200px,1.5fr)_150px_150px_140px_90px] lg:items-center">
                  <span className="font-mono text-[0.68rem] font-semibold text-primary">{topic.orderNumber}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold">{topic.title}</span><span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">{topic.description} · {formatDateTime(topic.createdAt)}</span></span>
                  <span className="flex min-w-0 items-center gap-2"><MemberAvatar member={creator} className="size-7" /><span className="truncate text-xs">{creator?.name ?? "Usuário"}</span></span>
                  <span className="flex min-w-0 items-center gap-2">{analyst ? <MemberAvatar member={analyst} className="size-7" /> : <span className="size-7 shrink-0 rounded-full border border-dashed border-border" />}<span className="truncate text-xs">{analyst?.name ?? "Não atribuído"}</span></span>
                  <span><span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.65rem] font-medium", statusClass(displayStatus))}><span className={cn("size-1.5 rounded-full", status?.tone)} />{status?.label}</span></span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground lg:justify-end"><Paperclip className="size-3.5" />{topic.attachments.length}</span>
                </button>
              )
            })}
            {visibleTopics.length === 0 && <div className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhum tópico encontrado com os filtros atuais.</div>}
          </div>
        </section>
      )}

      <NewTopicDialog open={newOpen} onOpenChange={setNewOpen} />

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="flex max-h-[95dvh] w-[calc(100vw-1rem)] max-w-[1480px] flex-col overflow-hidden p-0 sm:w-[calc(100vw-2rem)] xl:w-[calc(100vw-4rem)] lg:h-[min(88dvh,860px)]">
          {selected && (
            <>
              <DialogHeader className="shrink-0 border-b border-border px-4 py-4 pr-12 sm:px-5 lg:px-6">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-[0.66rem] font-semibold tracking-[0.12em] text-primary">ORDEM {selected.orderNumber}</p>
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.62rem] font-medium", statusClass(topicStatus(selected)))}>
                      <span className={cn("size-1.5 rounded-full", columns.find((column) => column.status === topicStatus(selected))?.tone)} />
                      {columns.find((column) => column.status === topicStatus(selected))?.label}
                    </span>
                  </div>
                  <DialogTitle className="mt-1.5 truncate text-lg leading-snug sm:text-xl">{selected.title}</DialogTitle>
                  <DialogDescription className="mt-1 line-clamp-2 max-w-4xl text-xs leading-relaxed sm:text-sm">{selected.description}</DialogDescription>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto bg-background/20">
                <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 sm:p-5 lg:p-6">
                  <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_320px]">
                    <section className="rounded-2xl border border-border bg-card/65 p-4 shadow-sm">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Solicitante</p>
                      <div className="mt-4 flex items-center gap-3">
                        <MemberAvatar member={members.find((m) => m.id === selected.createdBy)} className="size-11" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{members.find((m) => m.id === selected.createdBy)?.name ?? "Usuário"}</p>
                          <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Abriu o tópico e enviou as evidências iniciais.</p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-border bg-card/65 p-4 shadow-sm">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Analista</p>
                      <div className="mt-4 min-w-0">
                        <p className="truncate text-sm font-semibold">{members.find((m) => m.id === selected.assignedAnalystId)?.name ?? "Não atribuído"}</p>
                        <p className="mt-0.5 text-[0.68rem] text-muted-foreground">Responsável atual pela triagem e pelo retorno do tópico.</p>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-border bg-card/65 p-4 shadow-sm">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Status</p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.68rem] font-medium", statusClass(topicStatus(selected)))}>
                          <span className={cn("size-1.5 rounded-full", columns.find((column) => column.status === topicStatus(selected))?.tone)} />
                          {columns.find((column) => column.status === topicStatus(selected))?.label}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-[0.62rem] text-muted-foreground">Criado</p>
                          <p className="mt-1 text-xs font-medium">{formatDateTime(selected.createdAt)}</p>
                        </div>
                        <div>
                          <p className="text-[0.62rem] text-muted-foreground">Atualizado</p>
                          <p className="mt-1 text-xs font-medium">{formatDateTime(selected.updatedAt)}</p>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-2xl border border-border bg-card/65 p-4 shadow-sm xl:row-span-2">
                      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ações</p>
                      <div className="mt-4 grid gap-2">
                        {selected.status === "sent-to-dev" && selected.projectId && selected.activityId && (currentUserRole === "admin" || currentUserRole === "developer") ? (
                          <button type="button" onClick={() => router.push(`/projetos/${selected.projectId}#activity-${selected.activityId}`)} className="group flex w-full items-center justify-between rounded-2xl border border-border bg-background/50 p-3 text-left transition-colors hover:bg-muted">
                            <span className="min-w-0">
                              <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Atividade vinculada</span>
                              <span className="mt-1.5 block text-sm font-semibold">Abrir no projeto</span>
                              <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">Acompanhar a execução do DEV</span>
                            </span>
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground"><ArrowRight className="size-4" /></span>
                          </button>
                        ) : null}

                        {canAnalyze && selected.status !== "sent-to-dev" && selected.status !== "revoked" ? (
                          <>
                            {selected.status === "open" ? <Button variant="outline" loading={busy === selected.id} onClick={() => void startAnalysis(selected)}>Iniciar análise</Button> : null}
                            <div className="grid grid-cols-2 gap-2">
                              <Button variant="outline" onClick={() => { setReason(""); setRevokeOpen(true) }}>Revogar</Button>
                              <Button onClick={() => { setProjectId(projects[0]?.id ?? ""); setDeveloperId(""); setSendOpen(true) }}><Send className="size-3.5" />Enviar</Button>
                            </div>
                          </>
                        ) : null}

                        <div className="rounded-2xl border border-dashed border-border/80 bg-background/40 p-3">
                          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Resumo</p>
                          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-xl bg-muted/40 p-3">
                              <p className="text-[0.62rem] text-muted-foreground">Evidências</p>
                              <p className="mt-1 text-base font-semibold">{selected.attachments.length}</p>
                            </div>
                            <div className="rounded-xl bg-muted/40 p-3">
                              <p className="text-[0.62rem] text-muted-foreground">Ordem</p>
                              <p className="mt-1 font-mono text-base font-semibold">{selected.orderNumber}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </section>

                    {selected.revokedReason ? (
                      <div className="xl:col-span-3">
                        <div className="flex gap-2 rounded-2xl border border-destructive/25 bg-destructive/10 p-3.5 text-xs leading-relaxed text-destructive">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                          <span>{selected.revokedReason}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <section className="rounded-2xl border border-border bg-card/50 shadow-sm">
                    <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Paperclip className="size-4" /></span>
                          <div>
                            <h3 className="text-sm font-semibold">Evidências</h3>
                            <p className="text-[0.68rem] text-muted-foreground">{selected.attachments.length} arquivo(s) anexado(s) ao tópico</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="rounded-full border border-border bg-background/70 px-3 py-1 text-[0.68rem] text-muted-foreground">Preview rápido · imagens, vídeos e documentos</div>
                        <Button size="sm" variant="outline" onClick={() => addFilesRef.current?.click()}><Plus className="size-3.5" />Adicionar</Button>
                      </div>
                    </div>

                    <input ref={addFilesRef} type="file" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []).filter((file) => file.size > 0 && file.size <= 50 * 1024 * 1024); event.currentTarget.value = ""; if (files.length) void addSupportTopicAttachments(selected.id, files) }} />

                    {selected.attachments.length > 0 ? (
                      <div className="max-h-[54dvh] overflow-y-auto px-4 py-4 sm:px-5 lg:px-5">
                        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                          {selected.attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
                        </div>
                      </div>
                    ) : (
                      <button type="button" onClick={() => addFilesRef.current?.click()} className="m-4 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/15 px-6 text-center transition-colors hover:bg-muted/25 sm:m-5">
                        <Paperclip className="size-8 text-muted-foreground/60" />
                        <p className="mt-3 text-sm font-semibold">Nenhuma evidência ainda</p>
                        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">Adicione imagens, vídeos, PDFs, documentos ou arquivos de apoio para manter o histórico completo do tópico.</p>
                      </button>
                    )}
                  </section>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}><DialogContent><DialogHeader><DialogTitle>Revogar tópico?</DialogTitle><DialogDescription>O solicitante será notificado com o motivo informado.</DialogDescription></DialogHeader><textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={5} placeholder="Informe por que o tópico está sendo revogado..." className="resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" /><DialogFooter><Button variant="outline" onClick={() => setRevokeOpen(false)}>Cancelar</Button><Button variant="destructive" disabled={reason.trim().length < 3} loading={Boolean(selected && busy === selected.id)} onClick={() => void confirmRevoke()}>Revogar tópico</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}><DialogContent><DialogHeader><DialogTitle>Enviar como atividade</DialogTitle><DialogDescription>Escolha o projeto. Associar um desenvolvedor é opcional; administradores sempre serão notificados.</DialogDescription></DialogHeader><label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Projeto *</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"><option value="">Selecione...</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Desenvolvedor · opcional</span><select value={developerId} onChange={(event) => setDeveloperId(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"><option value="">Sem desenvolvedor associado</option>{developers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><div className="rounded-xl bg-muted/45 p-3 text-xs leading-relaxed text-muted-foreground"><CheckCircle2 className="mr-1 inline size-3.5" />Será criada uma atividade real com o número da ordem no título. Administradores e o desenvolvedor associado receberão notificação.</div><DialogFooter><Button variant="outline" onClick={() => setSendOpen(false)}>Cancelar</Button><Button disabled={!projectId} loading={Boolean(selected && busy === selected.id)} onClick={() => void sendToDev()}>Criar atividade</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
