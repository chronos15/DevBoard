"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileText,
  ImageIcon,
  LoaderCircle,
  Paperclip,
  Plus,
  Search,
  Send,
  Video,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { createClient } from "@/lib/supabase/client"
import { TOPIC_MEDIA_BUCKET, chatMediaKind } from "@/lib/supabase/helpers"
import type { SupportTopic, SupportTopicStatus, TopicAttachment } from "@/lib/types"
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

const columns: Array<{ status: SupportTopicStatus; label: string; tone: string; helper: string }> = [
  { status: "open", label: "Aberto", tone: "bg-chart-2", helper: "Aguardando triagem" },
  { status: "analyzing", label: "Em análise", tone: "bg-chart-3", helper: "AQS / DEV / Admin" },
  { status: "sent-to-dev", label: "Enviado ao DEV", tone: "bg-success", helper: "Convertido em atividade" },
  { status: "revoked", label: "Revogado", tone: "bg-destructive", helper: "Devolvido ao solicitante" },
]

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
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

  if (loading) return <div className="h-28 animate-pulse rounded-xl bg-muted" />
  if (!url) return <div className="rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground">Não foi possível abrir este arquivo.</div>

  if (attachment.kind === "image") {
    return <a href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl bg-muted"><img src={url} alt={attachment.name} className="h-40 w-full object-contain" /></a>
  }
  if (attachment.kind === "video") {
    return <video src={url} controls className="h-44 w-full rounded-xl bg-black object-contain" />
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><FileText className="size-4" /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{attachment.name}</span><span className="text-[0.65rem] text-muted-foreground">{formatBytes(attachment.size)}</span></span>
    </a>
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
        <DialogHeader>
          <DialogTitle>Novo tópico</DialogTitle>
          <DialogDescription>Abra uma solicitação completa para AQS, desenvolvimento ou administração. Evidências são obrigatórias.</DialogDescription>
        </DialogHeader>
        <form id="new-topic-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Número da ordem *</span>
            <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="Ex: OS-45892" className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Título *</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Resumo do problema" className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring" />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Descrição *</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Explique o cenário, comportamento atual, resultado esperado e como reproduzir..." className="resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" />
          </label>

          <div className="sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div><p className="text-xs font-medium">Evidências *</p><p className="text-[0.68rem] text-muted-foreground">Fotos, vídeos, PDFs, logs ou documentos · até 50 MB por arquivo.</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}><Paperclip className="size-3.5" /> Adicionar</Button>
            </div>
            <input ref={inputRef} type="file" multiple className="hidden" accept="image/*,video/*,application/pdf,text/*,.sql,.json,.log,.txt,.doc,.docx,.xls,.xlsx" onChange={(event) => {
              const picked = Array.from(event.target.files ?? []).filter((file) => file.size > 0 && file.size <= 50 * 1024 * 1024)
              setFiles((current) => [...current, ...picked])
              event.currentTarget.value = ""
            }} />
            {files.length ? (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {files.map((file, index) => {
                  const kind = chatMediaKind(file)
                  const preview = kind === "image" ? URL.createObjectURL(file) : null
                  return (
                    <div key={`${file.name}-${index}`} className="relative min-w-0 overflow-hidden rounded-xl border border-border bg-muted/25 p-2">
                      {kind === "image" && preview ? <img src={preview} alt="" className="h-20 w-full rounded-lg object-contain" onLoad={() => URL.revokeObjectURL(preview)} /> : kind === "video" && preview ? <div className="flex h-20 items-center justify-center rounded-lg bg-muted"><Video className="size-5 text-muted-foreground" /></div> : <div className="flex h-20 items-center justify-center rounded-lg bg-muted"><FileText className="size-5 text-muted-foreground" /></div>}
                      <p className="mt-2 truncate text-[0.68rem] font-medium">{file.name}</p>
                      <button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-background/90 text-muted-foreground shadow-sm hover:text-destructive" aria-label="Remover arquivo"><X className="size-3.5" /></button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground transition-colors hover:bg-muted/40"><ImageIcon className="mb-2 size-5" />Adicione pelo menos uma evidência</button>
            )}
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="new-topic-form" disabled={!orderNumber.trim() || title.trim().length < 3 || description.trim().length < 5 || files.length === 0} loading={saving} loadingText="Abrindo tópico...">Abrir tópico</Button>
        </DialogFooter>
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
    currentUserId,
    currentUserRole,
    startSupportTopicAnalysis,
    revokeSupportTopic,
    sendSupportTopicToActivity,
    addSupportTopicAttachments,
  } = useStore()
  const [newOpen, setNewOpen] = React.useState(false)
  const [selected, setSelected] = React.useState<SupportTopic | null>(null)
  const [search, setSearch] = React.useState("")
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
  const normalized = search.trim().toLowerCase()
  const visibleTopics = supportTopics.filter((topic) => !normalized || `${topic.orderNumber} ${topic.title} ${topic.description}`.toLowerCase().includes(normalized))

  React.useEffect(() => {
    if (!selected) return
    const fresh = supportTopics.find((topic) => topic.id === selected.id)
    if (fresh) setSelected(fresh)
  }, [selected?.id, supportTopics])

  React.useEffect(() => {
    if (selected || supportTopics.length === 0) return
    const topicId = new URLSearchParams(window.location.search).get("topic")
    if (!topicId) return
    const target = supportTopics.find((topic) => topic.id === topicId)
    if (target) setSelected(target)
  }, [selected, supportTopics])

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

  return (
    <div className="min-w-0 space-y-6">
      <PageHeading
        eyebrow="Suporte e demandas"
        title="Tópicos"
        subtitle="Central de solicitações com evidências, triagem e conversão direta em atividade de desenvolvimento."
        action={canCreate ? <Button onClick={() => setNewOpen(true)}><Plus className="size-4" /> Novo tópico</Button> : undefined}
      />

      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-card px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar ordem, título ou descrição..." className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" />
      </div>

      <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain pb-3">
        <div className="flex w-max min-w-full flex-nowrap items-stretch gap-3">
          {columns.map((column) => {
            const topics = visibleTopics.filter((topic) => topic.status === column.status)
            return (
              <section key={column.status} className="flex min-h-[500px] w-[285px] min-w-[285px] flex-col rounded-2xl border border-border bg-muted/25 p-2.5 xl:w-[310px] xl:min-w-[310px]">
                <header className="px-1 py-1.5">
                  <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className={cn("size-2 rounded-full", column.tone)} /><h2 className="text-xs font-semibold">{column.label}</h2></div><span className="rounded-full bg-card px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground ring-1 ring-foreground/8">{topics.length}</span></div>
                  <p className="mt-1 text-[0.65rem] text-muted-foreground">{column.helper}</p>
                </header>
                <div className="mt-2 flex flex-1 flex-col gap-2">
                  {topics.map((topic) => {
                    const creator = members.find((member) => member.id === topic.createdBy)
                    const analyst = members.find((member) => member.id === topic.assignedAnalystId)
                    return (
                      <button key={topic.id} type="button" onClick={() => setSelected(topic)} className="rounded-xl bg-card p-3 text-left shadow-sm ring-1 ring-foreground/8 transition-all hover:-translate-y-0.5 hover:shadow-md">
                        <div className="flex items-center justify-between gap-2"><span className="font-mono text-[0.65rem] font-semibold text-primary">{topic.orderNumber}</span><span className="flex items-center gap-1 text-[0.62rem] text-muted-foreground"><Paperclip className="size-3" />{topic.attachments.length}</span></div>
                        <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug">{topic.title}</h3>
                        <p className="mt-1 line-clamp-2 text-[0.68rem] leading-relaxed text-muted-foreground">{topic.description}</p>
                        <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2.5"><div className="flex min-w-0 items-center gap-1.5"><MemberAvatar member={creator} className="size-6" /><span className="truncate text-[0.65rem] text-muted-foreground">{creator?.name ?? "Usuário"}</span></div>{analyst && <MemberAvatar member={analyst} className="size-6" />}</div>
                      </button>
                    )
                  })}
                  {topics.length === 0 && <div className="flex min-h-24 flex-1 items-center justify-center rounded-xl border border-dashed border-border px-4 text-center text-xs text-muted-foreground">Nenhum tópico nesta etapa.</div>}
                </div>
              </section>
            )
          })}
        </div>
      </div>

      <NewTopicDialog open={newOpen} onOpenChange={setNewOpen} />

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          {selected && (
            <>
              <DialogHeader>
                <div className="pr-8"><p className="font-mono text-[0.68rem] font-semibold text-primary">ORDEM {selected.orderNumber}</p><DialogTitle className="mt-1 leading-snug">{selected.title}</DialogTitle></div>
                <DialogDescription>{selected.description}</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-muted/45 p-3"><p className="text-[0.65rem] text-muted-foreground">Solicitante</p><div className="mt-2 flex items-center gap-2"><MemberAvatar member={members.find((m) => m.id === selected.createdBy)} /><span className="truncate text-xs font-medium">{members.find((m) => m.id === selected.createdBy)?.name}</span></div></div>
                <div className="rounded-xl bg-muted/45 p-3"><p className="text-[0.65rem] text-muted-foreground">Analista</p><p className="mt-2 truncate text-xs font-medium">{members.find((m) => m.id === selected.assignedAnalystId)?.name ?? "Não atribuído"}</p></div>
                <div className="rounded-xl bg-muted/45 p-3"><p className="text-[0.65rem] text-muted-foreground">Status</p><p className="mt-2 text-xs font-medium">{columns.find((column) => column.status === selected.status)?.label}</p></div>
              </div>

              {selected.revokedReason && <div className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-xs leading-relaxed text-destructive"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{selected.revokedReason}</div>}

              <section>
                <div className="mb-2 flex items-center justify-between gap-3"><div><h3 className="text-sm font-semibold">Evidências</h3><p className="text-[0.68rem] text-muted-foreground">{selected.attachments.length} arquivo(s)</p></div><Button size="sm" variant="outline" onClick={() => addFilesRef.current?.click()}><Plus className="size-3.5" />Adicionar</Button></div>
                <input ref={addFilesRef} type="file" multiple className="hidden" onChange={(event) => {
                  const files = Array.from(event.target.files ?? []).filter((file) => file.size > 0 && file.size <= 50 * 1024 * 1024)
                  event.currentTarget.value = ""
                  if (files.length) void addSupportTopicAttachments(selected.id, files)
                }} />
                <div className="grid gap-2 sm:grid-cols-2">{selected.attachments.map((attachment) => <AttachmentPreview key={attachment.id} attachment={attachment} />)}</div>
              </section>

              {selected.status === "sent-to-dev" && selected.projectId && selected.activityId && (currentUserRole === "admin" || currentUserRole === "developer") && (
                <button type="button" onClick={() => router.push(`/projetos/${selected.projectId}#activity-${selected.activityId}`)} className="flex w-full items-center justify-between rounded-xl border border-border bg-card p-3 text-left transition-colors hover:bg-muted"><span><span className="block text-xs font-semibold">Atividade criada</span><span className="mt-0.5 block text-[0.68rem] text-muted-foreground">Abrir no projeto associado</span></span><ArrowRight className="size-4 text-muted-foreground" /></button>
              )}

              {canAnalyze && selected.status !== "sent-to-dev" && selected.status !== "revoked" && (
                <DialogFooter className="mx-0 mb-0 rounded-xl">
                  {selected.status === "open" && <Button variant="outline" loading={busy === selected.id} onClick={() => void startAnalysis(selected)}>Iniciar análise</Button>}
                  <Button variant="outline" onClick={() => { setReason(""); setRevokeOpen(true) }}>Revogar</Button>
                  <Button onClick={() => { setProjectId(projects[0]?.id ?? ""); setDeveloperId(""); setSendOpen(true) }}><Send className="size-3.5" />Enviar Atividade</Button>
                </DialogFooter>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Revogar tópico?</DialogTitle><DialogDescription>O solicitante será notificado com o motivo informado.</DialogDescription></DialogHeader>
          <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={5} placeholder="Informe por que o tópico está sendo revogado..." className="resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" />
          <DialogFooter><Button variant="outline" onClick={() => setRevokeOpen(false)}>Cancelar</Button><Button variant="destructive" disabled={reason.trim().length < 3} loading={Boolean(selected && busy === selected.id)} onClick={() => void confirmRevoke()}>Revogar tópico</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Enviar como atividade</DialogTitle><DialogDescription>Escolha o projeto. Associar um desenvolvedor é opcional; administradores sempre serão notificados.</DialogDescription></DialogHeader>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Projeto *</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"><option value="">Selecione...</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
          <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">Desenvolvedor · opcional</span><select value={developerId} onChange={(event) => setDeveloperId(event.target.value)} className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"><option value="">Sem desenvolvedor associado</option>{developers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <div className="rounded-xl bg-muted/45 p-3 text-xs leading-relaxed text-muted-foreground"><CheckCircle2 className="mr-1 inline size-3.5" />Será criada uma atividade real com o número da ordem no título. Administradores e o desenvolvedor associado receberão notificação.</div>
          <DialogFooter><Button variant="outline" onClick={() => setSendOpen(false)}>Cancelar</Button><Button disabled={!projectId} loading={Boolean(selected && busy === selected.id)} onClick={() => void sendToDev()}>Criar atividade</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
