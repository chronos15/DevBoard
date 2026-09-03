"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  AtSign,
  CheckCircle2,
  ClipboardCheck,
  Code2,
  Database,
  FileText,
  FolderKanban,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  Play,
  RefreshCcw,
  Send,
  ShieldCheck,
  UserRound,
  Video,
  X,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { SERVICE_REQUEST_MEDIA_BUCKET, chatMediaKind } from "@/lib/supabase/helpers"
import { useStore } from "@/lib/store"
import {
  SERVICE_REQUEST_ATTACHMENT_LABELS,
  SERVICE_REQUEST_STATUS_LABELS,
  SERVICE_REQUEST_TYPE_LABELS,
  serviceRequestStatusTone,
  serviceRequestTypeTone,
} from "@/lib/service-requests"
import type { ChatMention, ServiceRequest, ServiceRequestFileInput } from "@/lib/types"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

function attachmentIcon(category: string) {
  if (category === "analysis-video") return Video
  if (category === "database") return Database
  if (category === "certificate") return ShieldCheck
  return FileText
}

function RequestAttachmentLink({ attachment, compact = false }: { attachment: ServiceRequest["attachments"][number]; compact?: boolean }) {
  const supabase = React.useMemo(() => createClient(), [])
  const [opening, setOpening] = React.useState(false)

  async function open() {
    if (opening) return
    setOpening(true)
    try {
      const { data, error } = await supabase.storage.from(SERVICE_REQUEST_MEDIA_BUCKET).createSignedUrl(attachment.storagePath, 60 * 20)
      if (error) throw error
      window.open(data.signedUrl, "_blank", "noopener,noreferrer")
    } finally {
      setOpening(false)
    }
  }

  const Icon = attachmentIcon(attachment.category)
  return (
    <button type="button" onClick={() => void open()} className={cn("group flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card text-left transition-colors hover:border-primary/25 hover:bg-primary/[0.03]", compact ? "p-2.5" : "p-3")}>
      <span className={cn("flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:text-primary", compact ? "size-8" : "size-9")}>
        {opening ? <LoaderCircle className="size-4 animate-spin" /> : <Icon className="size-4" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{attachment.name}</span>
        <span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">{SERVICE_REQUEST_ATTACHMENT_LABELS[attachment.category]} · {formatBytes(attachment.size)}</span>
      </span>
      <ArrowRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
    </button>
  )
}

function TextActionDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  confirmLabel,
  destructive = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label: string
  placeholder: string
  confirmLabel: string
  destructive?: boolean
  onConfirm: (text: string) => Promise<boolean>
}) {
  const [text, setText] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const formId = React.useId()

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (text.trim().length < 5 || saving) return
    setSaving(true)
    try {
      if (await onConfirm(text.trim())) {
        setText("")
        onOpenChange(false)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!saving) { onOpenChange(value); if (!value) setText("") } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <form id={formId} onSubmit={submit} className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">{label}</label>
          <textarea value={text} onChange={(event) => setText(event.target.value)} rows={4} placeholder={placeholder} className="w-full resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" />
        </form>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" form={formId} variant={destructive ? "destructive" : "default"} disabled={text.trim().length < 5 || saving} loading={saving} loadingText="Salvando...">{confirmLabel}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SendToDevDialog({ open, onOpenChange, request }: { open: boolean; onOpenChange: (open: boolean) => void; request: ServiceRequest }) {
  const { members, projects, sendServiceRequestToDev } = useStore()
  const developers = members.filter((member) => member.role === "developer" || member.role === "admin")
  const [responsibleDevId, setResponsibleDevId] = React.useState(request.responsibleDevId ?? "")
  const [projectId, setProjectId] = React.useState(request.projectId ?? "none")
  const [activityId, setActivityId] = React.useState(request.activityId ?? "none")
  const [summary, setSummary] = React.useState(request.aqsSummary ?? "")
  const [priorityApproved, setPriorityApproved] = React.useState(request.priorityApproved)
  const [saving, setSaving] = React.useState(false)
  const project = projects.find((item) => item.id === projectId)

  React.useEffect(() => {
    if (!open) return
    setResponsibleDevId(request.responsibleDevId ?? "")
    setProjectId(request.projectId ?? "none")
    setActivityId(request.activityId ?? "none")
    setSummary(request.aqsSummary ?? "")
    setPriorityApproved(request.priorityApproved)
  }, [open, request])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!responsibleDevId || saving) return
    setSaving(true)
    try {
      const ok = await sendServiceRequestToDev(request.id, {
        responsibleDevId,
        projectId: projectId === "none" ? undefined : projectId,
        activityId: activityId === "none" ? undefined : activityId,
        summary: summary.trim() || undefined,
        priorityApproved,
      })
      if (ok) onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Encaminhar solicitação ao DEV</DialogTitle><DialogDescription>Defina o responsável do departamento e, opcionalmente, vincule o protocolo a um projeto/atividade já existente. Nenhuma atividade ou subatividade será criada ou alterada por esta ação.</DialogDescription></DialogHeader>
        <form id="send-request-dev" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Responsável DEV *</span><Select value={responsibleDevId} onValueChange={(value) => value && setResponsibleDevId(String(value))}><SelectTrigger className="h-10 w-full rounded-xl bg-card"><SelectValue placeholder="Selecione o responsável" /></SelectTrigger><SelectContent>{developers.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Projeto relacionado</span><Select value={projectId} onValueChange={(value) => { const next = String(value); setProjectId(next); setActivityId("none") }}><SelectTrigger className="h-10 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sem vínculo técnico ainda</SelectItem>{projects.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Atividade existente</span><Select value={activityId} disabled={!project} onValueChange={(value) => value && setActivityId(String(value))}><SelectTrigger className="h-10 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Somente projeto</SelectItem>{project?.activities.map((activity) => <SelectItem key={activity.id} value={activity.id}>{activity.title}</SelectItem>)}</SelectContent></Select></label>
          <label className="space-y-1.5 sm:col-span-2"><span className="text-xs font-medium text-muted-foreground">Resumo consolidado da análise AQS</span><textarea value={summary} onChange={(event) => setSummary(event.target.value)} rows={5} placeholder="Problema identificado, comportamento esperado, como reproduzir e informações relevantes para o DEV..." className="w-full resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" /></label>
          <button type="button" onClick={() => setPriorityApproved((value) => !value)} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3 text-left sm:col-span-2">
            <span><span className="block text-xs font-semibold">Prioridade aprovada pelo AQS</span><span className="mt-0.5 block text-[0.68rem] text-muted-foreground">A solicitação original apenas pede prioridade; a aprovação fica registrada aqui.</span></span>
            <span className={cn("flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors", priorityApproved ? "bg-primary" : "bg-muted-foreground/25")}><span className={cn("size-5 rounded-full bg-white shadow transition-transform", priorityApproved && "translate-x-5")} /></span>
          </button>
        </form>
        <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" form="send-request-dev" disabled={!responsibleDevId || saving} loading={saving} loadingText="Encaminhando..."><Code2 className="size-4" /> Enviar ao DEV</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AssignExecutorDialog({ open, onOpenChange, request }: { open: boolean; onOpenChange: (open: boolean) => void; request: ServiceRequest }) {
  const { members, assignServiceRequestExecutor } = useStore()
  const developers = members.filter((member) => member.role === "developer" || member.role === "admin")
  const [executorId, setExecutorId] = React.useState(request.executorId ?? "")
  const [saving, setSaving] = React.useState(false)
  React.useEffect(() => { if (open) setExecutorId(request.executorId ?? "") }, [open, request.executorId])
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!executorId || saving) return
    setSaving(true)
    try { if (await assignServiceRequestExecutor(request.id, executorId)) onOpenChange(false) } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Designar executor</DialogTitle><DialogDescription>O executor receberá a solicitação e poderá iniciar o atendimento. Isso não altera responsáveis de atividades/subatividades existentes.</DialogDescription></DialogHeader><form id="assign-request-executor" onSubmit={submit}><Select value={executorId} onValueChange={(value) => value && setExecutorId(String(value))}><SelectTrigger className="h-10 w-full rounded-xl bg-card"><SelectValue placeholder="Selecione o executor" /></SelectTrigger><SelectContent>{developers.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectContent></Select></form><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" form="assign-request-executor" disabled={!executorId || saving} loading={saving} loadingText="Designando...">Designar</Button></DialogFooter></DialogContent></Dialog>
}

function CompleteRequestDialog({ open, onOpenChange, requestId }: { open: boolean; onOpenChange: (open: boolean) => void; requestId: string }) {
  const { completeServiceRequest } = useStore()
  const [build, setBuild] = React.useState("")
  const [note, setNote] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (build.trim().length < 2 || saving) return
    setSaving(true)
    try { if (await completeServiceRequest(requestId, build.trim(), note.trim() || undefined)) { setBuild(""); setNote(""); onOpenChange(false) } } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Concluir solicitação</DialogTitle><DialogDescription>Registre a build/versão em que a solução ficou disponível. Esta informação será usada no encerramento do protocolo.</DialogDescription></DialogHeader><form id="complete-request" onSubmit={submit} className="space-y-4"><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Build / versão *</span><input value={build} onChange={(event) => setBuild(event.target.value)} placeholder="Ex: 06.05a117281f88" className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring" /></label><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Observações finais</span><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Processos adicionais para o solicitante, se houver..." className="w-full resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" /></label></form><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button><Button type="submit" form="complete-request" disabled={build.trim().length < 2 || saving} loading={saving} loadingText="Concluindo..."><CheckCircle2 className="size-4" /> Concluir</Button></DialogFooter></DialogContent></Dialog>
}

function RequestComposer({ request }: { request: ServiceRequest }) {
  const { members, currentUserId, addServiceRequestMessage } = useStore()
  const [draft, setDraft] = React.useState("")
  const [mentions, setMentions] = React.useState<ChatMention[]>([])
  const [files, setFiles] = React.useState<ServiceRequestFileInput[]>([])
  const [sending, setSending] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)

  const mentionQuery = React.useMemo(() => {
    const match = draft.match(/(?:^|\s)@([^\s@]{0,40})$/u)
    return match ? match[1].toLocaleLowerCase("pt-BR") : null
  }, [draft])
  const mentionOptions = React.useMemo(() => {
    if (mentionQuery === null) return []
    return members.filter((member) => member.id !== currentUserId && (member.name.toLocaleLowerCase("pt-BR").includes(mentionQuery) || member.email?.toLocaleLowerCase("pt-BR").includes(mentionQuery))).slice(0, 6)
  }, [currentUserId, members, mentionQuery])

  function chooseMention(memberId: string) {
    const member = members.find((item) => item.id === memberId)
    if (!member) return
    setDraft((current) => current.replace(/(?:^|\s)@([^\s@]{0,40})$/u, (full) => `${full.startsWith(" ") ? " " : ""}@${member.name} `))
    setMentions((current) => current.some((item) => item.kind === "user" && item.id === member.id) ? current : [...current, { kind: "user", id: member.id, label: member.name }])
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  async function send() {
    if ((!draft.trim() && files.length === 0) || sending) return
    setSending(true)
    try {
      const ok = await addServiceRequestMessage(request.id, draft.trim(), mentions, files)
      if (ok) { setDraft(""); setMentions([]); setFiles([]) }
    } finally { setSending(false) }
  }

  return (
    <div className="relative border-t border-border bg-card p-3 sm:p-4">
      {files.length > 0 && <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{files.map((item, index) => <div key={`${item.file.name}-${index}`} className="relative flex w-52 shrink-0 items-center gap-2 rounded-xl border border-border bg-muted/30 p-2"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Paperclip className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[0.68rem] font-semibold">{item.file.name}</span><span className="block text-[0.6rem] text-muted-foreground">{formatBytes(item.file.size)}</span></span><button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"><X className="size-3.5" /></button></div>)}</div>}
      <div className="relative flex min-w-0 items-end gap-2 rounded-2xl border border-border bg-background p-2 focus-within:border-ring">
        <button type="button" onClick={() => inputRef.current?.click()} className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" title="Adicionar arquivo"><Paperclip className="size-4" /></button>
        <button type="button" onClick={() => { setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@`); requestAnimationFrame(() => textareaRef.current?.focus()) }} className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" title="Mencionar usuário"><AtSign className="size-4" /></button>
        <textarea ref={textareaRef} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && mentionOptions.length === 0) { event.preventDefault(); void send() } }} rows={1} placeholder={`Conversar em “OS ${request.orderNumber}” · use @ para mencionar`} className="max-h-36 min-h-9 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground" />
        <Button type="button" size="icon" className="size-9 shrink-0 rounded-xl" disabled={(!draft.trim() && files.length === 0) || sending} onClick={() => void send()}>{sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}</Button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => { const picked = Array.from(event.target.files ?? []).filter((file) => file.size > 0 && file.size <= 200 * 1024 * 1024).map((file) => ({ file, category: "other" as const })); setFiles((current) => [...current, ...picked]); event.currentTarget.value = "" }} />
      </div>
      {mentionOptions.length > 0 && <div className="absolute bottom-[calc(100%-4px)] left-16 z-30 w-[min(320px,calc(100%-80px))] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl">{mentionOptions.map((member) => <button key={member.id} type="button" onClick={() => chooseMention(member.id)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted"><MemberAvatar member={member} className="size-6 text-[0.55rem]" /><span className="min-w-0"><span className="block truncate text-xs font-semibold">{member.name}</span><span className="block truncate text-[0.62rem] text-muted-foreground">{member.email ?? member.role}</span></span></button>)}</div>}
      <p className="mt-1.5 px-1 text-[0.62rem] text-muted-foreground">Enter envia · Shift+Enter quebra linha · @ menciona e inclui o usuário no protocolo.</p>
    </div>
  )
}

export function RequestDetail({ requestId }: { requestId: string }) {
  const router = useRouter()
  const {
    hydrated,
    serviceRequests,
    members,
    projects,
    currentUserId,
    currentUserRole,
    startServiceRequestAqs,
    requestServiceRequestInfo,
    rejectServiceRequest,
    startServiceRequestDev,
    sendServiceRequestToAqs,
    returnServiceRequestToDev,
    approveServiceRequestForBuild,
  } = useStore()
  const request = serviceRequests.find((item) => item.id === requestId)
  const [infoOpen, setInfoOpen] = React.useState(false)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [sendDevOpen, setSendDevOpen] = React.useState(false)
  const [assignOpen, setAssignOpen] = React.useState(false)
  const [sendAqsOpen, setSendAqsOpen] = React.useState(false)
  const [reworkOpen, setReworkOpen] = React.useState(false)
  const [approveOpen, setApproveOpen] = React.useState(false)
  const [completeOpen, setCompleteOpen] = React.useState(false)
  const [quickLoading, setQuickLoading] = React.useState<string | null>(null)

  if (!hydrated) return <div className="mx-auto max-w-7xl animate-pulse space-y-4"><div className="h-12 rounded-2xl bg-muted" /><div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="h-[560px] rounded-2xl bg-muted" /><div className="h-[420px] rounded-2xl bg-muted" /></div></div>
  if (!request) return <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8 text-center"><ClipboardCheck className="mx-auto size-8 text-muted-foreground" /><h1 className="mt-4 text-lg font-semibold">Solicitação não encontrada</h1><p className="mt-2 text-sm text-muted-foreground">Ela pode não existir ou seu usuário não possui acesso a este protocolo.</p><Button type="button" variant="outline" className="mt-5" onClick={() => router.push("/solicitacoes")}><ArrowLeft className="size-4" /> Voltar</Button></div>

  const creator = members.find((member) => member.id === request.createdBy)
  const aqs = members.find((member) => member.id === request.assignedAqsId)
  const responsibleDev = members.find((member) => member.id === request.responsibleDevId)
  const executor = members.find((member) => member.id === request.executorId)
  const project = projects.find((item) => item.id === request.projectId)
  const activity = project?.activities.find((item) => item.id === request.activityId)
  const canAqs = currentUserRole === "admin" || currentUserRole === "aqs"
  const canDev = currentUserRole === "admin" || currentUserRole === "developer"
  const canOperateDev = currentUserRole === "admin" || (currentUserRole === "developer" && [request.responsibleDevId, request.executorId].includes(currentUserId))
  const initialAttachments = request.attachments.filter((attachment) => !attachment.messageId)
  const checklist = ["order-pdf", "analysis-video", "database"].map((category) => ({ category, ok: initialAttachments.some((attachment) => attachment.category === category) }))
  const timeline = [
    ...request.events.map((event) => ({ kind: "event" as const, createdAt: event.createdAt, event })),
    ...request.messages.map((message) => ({ kind: "message" as const, createdAt: message.createdAt, message })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  async function quick(key: string, action: () => Promise<boolean>) {
    if (quickLoading) return
    setQuickLoading(key)
    try { await action() } finally { setQuickLoading(null) }
  }

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => router.push("/solicitacoes")} className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" /> Solicitações</button>
            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-primary">OS {request.orderNumber}</span><span className={cn("rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold", serviceRequestTypeTone(request.requestType))}>{SERVICE_REQUEST_TYPE_LABELS[request.requestType]}</span><span className={cn("rounded-full border px-2.5 py-1 text-[0.65rem] font-semibold", serviceRequestStatusTone(request.status))}>{SERVICE_REQUEST_STATUS_LABELS[request.status]}</span>{request.priorityRequested && <span className="rounded-full border border-warning/25 bg-warning/10 px-2.5 py-1 text-[0.65rem] font-semibold text-warning">{request.priorityApproved ? "Prioridade aprovada" : "Prioridade solicitada"}</span>}</div>
            <h1 className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{request.title}</h1>
            <p className="mt-2 max-w-4xl text-sm leading-relaxed text-muted-foreground">{request.description}</p>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {canAqs && ["received", "waiting-info"].includes(request.status) && <Button type="button" onClick={() => void quick("aqs", () => startServiceRequestAqs(request.id))} disabled={!!quickLoading} loading={quickLoading === "aqs"} loadingText="Assumindo..."><ClipboardCheck className="size-4" /> {request.status === "waiting-info" ? "Retomar análise" : "Assumir análise"}</Button>}
            {canAqs && request.status === "aqs-analysis" && <><Button type="button" variant="outline" onClick={() => setInfoOpen(true)}>Solicitar informações</Button><Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setRejectOpen(true)}>Recusar</Button><Button type="button" onClick={() => setSendDevOpen(true)}><Code2 className="size-4" /> Enviar ao DEV</Button></>}
            {canDev && request.status === "waiting-dev" && (currentUserRole === "admin" || request.responsibleDevId === currentUserId) && <Button type="button" onClick={() => setAssignOpen(true)}><UserRound className="size-4" /> Designar executor</Button>}
            {canOperateDev && ["waiting-executor", "rework"].includes(request.status) && <Button type="button" onClick={() => void quick("dev-start", () => startServiceRequestDev(request.id))} disabled={!!quickLoading} loading={quickLoading === "dev-start"} loadingText="Iniciando..."><Play className="size-4" /> Iniciar execução</Button>}
            {canOperateDev && ["in-dev", "rework"].includes(request.status) && <Button type="button" onClick={() => setSendAqsOpen(true)}><Send className="size-4" /> Enviar para AQS</Button>}
            {canAqs && request.status === "waiting-aqs" && <><Button type="button" variant="outline" onClick={() => setReworkOpen(true)}><RefreshCcw className="size-4" /> Reavaliar DEV</Button><Button type="button" onClick={() => setApproveOpen(true)}><CheckCircle2 className="size-4" /> Aprovar execução</Button></>}
            {canAqs && request.status === "waiting-build" && <Button type="button" onClick={() => setCompleteOpen(true)}><CheckCircle2 className="size-4" /> Concluir / informar build</Button>}
          </div>
        </div>

        <div className="grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">Unidade</p><p className="mt-1 font-semibold">{request.unit}</p></div>
          <div><p className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">Módulo</p><p className="mt-1 font-semibold">{request.module}</p></div>
          <div><p className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">Assunto</p><p className="mt-1 font-semibold">{request.subject}</p></div>
          <div><p className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">Protocolada</p><p className="mt-1 font-semibold">{formatDateTime(request.createdAt)}</p></div>
        </div>
      </div>

      <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex min-h-[620px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"><div><h2 className="text-sm font-semibold">Histórico do protocolo</h2><p className="mt-0.5 text-[0.68rem] text-muted-foreground">Comunicação e mudanças de estado entre solicitante, AQS e DEV.</p></div><MessageSquareText className="size-4 text-muted-foreground" /></div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3 sm:p-4">
            {timeline.length === 0 ? <div className="py-16 text-center text-sm text-muted-foreground">Nenhum registro ainda.</div> : timeline.map((item) => item.kind === "event" ? (
              <div key={`event-${item.event.id}`} className="flex gap-3 rounded-xl px-2 py-3 hover:bg-muted/25">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><RefreshCcw className="size-3.5" /></span>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold">{item.event.title}</p><span className="font-mono text-[0.6rem] text-muted-foreground">{formatDateTime(item.event.createdAt)}</span></div>{item.event.description && <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{item.event.description}</p>}{item.event.actorId && <p className="mt-1.5 text-[0.62rem] text-muted-foreground"><MemberName member={members.find((member) => member.id === item.event.actorId)} fallback="Sistema" /></p>}</div>
              </div>
            ) : (
              <div key={`message-${item.message.id}`} className="flex gap-3 rounded-xl px-2 py-3 hover:bg-muted/25">
                <MemberAvatar member={members.find((member) => member.id === item.message.authorId)} className="mt-0.5 size-8 shrink-0 text-[0.65rem]" />
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><MemberName member={members.find((member) => member.id === item.message.authorId)} className="text-xs font-semibold" fallback="Usuário" /><span className="font-mono text-[0.6rem] text-muted-foreground">{formatDateTime(item.message.createdAt)}</span></div>{item.message.content && <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.message.content}</p>}{item.message.attachments.length > 0 && <div className="mt-2 grid gap-2 sm:grid-cols-2">{item.message.attachments.map((attachment) => <RequestAttachmentLink key={attachment.id} attachment={attachment} compact />)}</div>}</div>
              </div>
            ))}
          </div>
          <RequestComposer request={request} />
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Responsáveis</h2><div className="mt-3 space-y-3">{[
            { label: "Solicitante", member: creator },
            { label: "AQS", member: aqs },
            { label: "Responsável DEV", member: responsibleDev },
            { label: "Executor", member: executor },
          ].map((item) => <div key={item.label} className="flex items-center gap-3"><MemberAvatar member={item.member} className="size-8 text-[0.65rem]" /><div className="min-w-0"><p className="text-[0.62rem] font-medium uppercase tracking-wide text-muted-foreground">{item.label}</p><MemberName member={item.member} className="mt-0.5 block truncate text-xs font-semibold" fallback="Não definido" /></div></div>)}</div></section>

          <section className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Checklist do protocolo</h2><span className={cn("rounded-full px-2 py-0.5 text-[0.62rem] font-semibold", checklist.every((item) => item.ok) ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>{checklist.filter((item) => item.ok).length}/{checklist.length}</span></div><div className="mt-3 space-y-2">{checklist.map((item) => <div key={item.category} className="flex items-center gap-2 text-xs"><span className={cn("flex size-5 items-center justify-center rounded-full", item.ok ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{item.ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}</span><span>{SERVICE_REQUEST_ATTACHMENT_LABELS[item.category as keyof typeof SERVICE_REQUEST_ATTACHMENT_LABELS]}</span></div>)}</div></section>

          <section className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Documentos</h2><span className="font-mono text-[0.62rem] text-muted-foreground">{initialAttachments.length}</span></div><div className="mt-3 space-y-2">{initialAttachments.length ? initialAttachments.map((attachment) => <RequestAttachmentLink key={attachment.id} attachment={attachment} compact />) : <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">Nenhum documento protocolado.</p>}</div></section>

          <section className="rounded-2xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">Trabalho técnico relacionado</h2>{project ? <div className="mt-3 rounded-xl border border-border bg-muted/20 p-3"><div className="flex items-center gap-2"><FolderKanban className="size-4 text-primary" /><p className="truncate text-xs font-semibold">{project.name}</p></div><p className="mt-2 text-[0.68rem] text-muted-foreground">{activity ? activity.title : "Solicitação vinculada somente ao projeto."}</p><Link href={`/projetos/${project.id}${activity ? `#activity-${activity.id}` : ""}`} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">Abrir no projeto <ArrowRight className="size-3.5" /></Link></div> : <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-center text-xs leading-relaxed text-muted-foreground">Ainda sem vínculo técnico. O AQS pode selecionar um projeto/atividade existente ao enviar para o DEV.</p>}</section>

          {request.finalBuild && <section className="rounded-2xl border border-success/25 bg-success/[0.05] p-4"><p className="text-[0.65rem] font-semibold uppercase tracking-wide text-success">Disponível a partir da build</p><p className="mt-2 font-mono text-sm font-semibold">{request.finalBuild}</p></section>}
        </aside>
      </div>

      <TextActionDialog open={infoOpen} onOpenChange={setInfoOpen} title="Solicitar informações" description="A solicitação volta para o solicitante complementar o protocolo. O histórico permanece preservado." label="O que está faltando?" placeholder="Ex: encaminhar vídeo reproduzindo a falha com a última build..." confirmLabel="Solicitar informações" onConfirm={(text) => requestServiceRequestInfo(request.id, text)} />
      <TextActionDialog open={rejectOpen} onOpenChange={setRejectOpen} title="Recusar solicitação" description="Use quando o protocolo não atende aos requisitos ou não possui fundamento suficiente para análise." label="Motivo da recusa" placeholder="Explique objetivamente por que a solicitação está sendo recusada..." confirmLabel="Recusar solicitação" destructive onConfirm={(text) => rejectServiceRequest(request.id, text)} />
      <SendToDevDialog open={sendDevOpen} onOpenChange={setSendDevOpen} request={request} />
      <AssignExecutorDialog open={assignOpen} onOpenChange={setAssignOpen} request={request} />
      <TextActionDialog open={sendAqsOpen} onOpenChange={setSendAqsOpen} title="Enviar para validação AQS" description="Registre o que foi executado. O trabalho técnico continua registrado no projeto/atividade, sem duplicar a estrutura." label="Resumo da execução DEV" placeholder="Descreva implementação, módulos afetados, testes realizados e evidências anexadas..." confirmLabel="Enviar para AQS" onConfirm={(text) => sendServiceRequestToAqs(request.id, text)} />
      <TextActionDialog open={reworkOpen} onOpenChange={setReworkOpen} title="Reavaliar no DEV" description="Devolve a mesma solicitação para o executor, preservando todo o histórico e vínculo técnico." label="Motivo da reavaliação" placeholder="Descreva o que não ficou de acordo e o que precisa ser revisto..." confirmLabel="Enviar para reavaliação" onConfirm={(text) => returnServiceRequestToDev(request.id, text)} />
      <TextActionDialog open={approveOpen} onOpenChange={setApproveOpen} title="Aprovar execução" description="A solicitação passará para Aguardando versão/build, etapa anterior ao encerramento definitivo." label="Observação da validação" placeholder="Ex: testes realizados e comportamento validado conforme solicitado..." confirmLabel="Aprovar e aguardar build" onConfirm={(text) => approveServiceRequestForBuild(request.id, text)} />
      <CompleteRequestDialog open={completeOpen} onOpenChange={setCompleteOpen} requestId={request.id} />
    </div>
  )
}
