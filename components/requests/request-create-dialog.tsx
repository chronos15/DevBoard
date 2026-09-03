"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Database, FileText, Paperclip, ShieldCheck, Upload, Video, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { SERVICE_REQUEST_ATTACHMENT_LABELS, SERVICE_REQUEST_TYPE_LABELS } from "@/lib/service-requests"
import type { ServiceRequestAttachmentCategory, ServiceRequestFileInput, ServiceRequestType } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const REQUIRED_CATEGORIES: ServiceRequestAttachmentCategory[] = ["order-pdf", "analysis-video", "database"]
const MAX_FILE_BYTES = 200 * 1024 * 1024

function fileIcon(category: ServiceRequestAttachmentCategory) {
  if (category === "analysis-video") return Video
  if (category === "database") return Database
  if (category === "certificate") return ShieldCheck
  return FileText
}

function formatBytes(value: number) {
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

export function NewServiceRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const { createServiceRequest } = useStore()
  const [orderNumber, setOrderNumber] = React.useState("")
  const [requestType, setRequestType] = React.useState<ServiceRequestType>("failure")
  const [unit, setUnit] = React.useState("")
  const [module, setModule] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [priorityRequested, setPriorityRequested] = React.useState(false)
  const [priorityReason, setPriorityReason] = React.useState("")
  const [files, setFiles] = React.useState<ServiceRequestFileInput[]>([])
  const [saving, setSaving] = React.useState(false)
  const inputRefs = React.useRef<Partial<Record<ServiceRequestAttachmentCategory, HTMLInputElement | null>>>({})

  const categoriesPresent = React.useMemo(() => new Set(files.map((item) => item.category)), [files])
  const protocolReady = REQUIRED_CATEGORIES.every((category) => categoriesPresent.has(category))
  const formReady = orderNumber.trim().length >= 2 && unit.trim().length >= 2 && module.trim().length >= 2 && subject.trim().length >= 2 && title.trim().length >= 3 && description.trim().length >= 10 && protocolReady && (!priorityRequested || priorityReason.trim().length >= 5)

  function reset() {
    setOrderNumber("")
    setRequestType("failure")
    setUnit("")
    setModule("")
    setSubject("")
    setTitle("")
    setDescription("")
    setPriorityRequested(false)
    setPriorityReason("")
    setFiles([])
  }

  function addFiles(category: ServiceRequestAttachmentCategory, picked: File[]) {
    const valid = picked.filter((file) => file.size > 0 && file.size <= MAX_FILE_BYTES)
    if (!valid.length) return
    setFiles((current) => [
      ...current.filter((item) => category === "other" || item.category !== category),
      ...valid.map((file) => ({ file, category })),
    ])
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!formReady || saving) return
    setSaving(true)
    try {
      const id = await createServiceRequest({
        orderNumber: orderNumber.trim(),
        requestType,
        unit: unit.trim(),
        module: module.trim(),
        subject: subject.trim(),
        title: title.trim(),
        description: description.trim(),
        priorityRequested,
        priorityReason: priorityRequested ? priorityReason.trim() : undefined,
        files,
      })
      if (!id) return
      reset()
      onOpenChange(false)
      router.push(`/solicitacoes/${id}`)
    } finally {
      setSaving(false)
    }
  }

  const protocolItems: Array<{ category: ServiceRequestAttachmentCategory; helper: string; required: boolean; accept: string }> = [
    { category: "order-pdf", helper: "Ordem de serviço original em PDF.", required: true, accept: "application/pdf,.pdf" },
    { category: "analysis-video", helper: "Vídeo que demonstra a análise, falha ou processo realizado.", required: true, accept: "video/*" },
    { category: "database", helper: "Banco/pacote atualizado utilizado na análise.", required: true, accept: ".fdb,.fbk,.zip,.7z,.rar,.bak,.db,.sqlite,application/octet-stream,application/zip" },
    { category: "certificate", helper: "Anexe quando estiver disponível e for necessário ao cenário.", required: false, accept: ".pfx,.p12,.cer,.crt,.zip,.rar,application/x-pkcs12,application/pkix-cert" },
  ]

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!saving) { onOpenChange(value); if (!value) reset() } }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Nova solicitação</DialogTitle>
          <DialogDescription>
            Protocole a OS com as informações e evidências exigidas antes da análise AQS. O trabalho técnico continua sendo gerenciado normalmente em Projetos.
          </DialogDescription>
        </DialogHeader>

        <form id="new-service-request-form" onSubmit={submit} className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Número da OS *</span>
              <input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value)} placeholder="Ex: 198855" className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Tipo da solicitação *</span>
              <Select value={requestType} onValueChange={(value) => value && setRequestType(String(value) as ServiceRequestType)}>
                <SelectTrigger className="h-10 w-full rounded-xl bg-card"><SelectValue /></SelectTrigger>
                <SelectContent align="start">
                  {(Object.entries(SERVICE_REQUEST_TYPE_LABELS) as Array<[ServiceRequestType, string]>).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Unidade *</span>
              <input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="Ex: Goiânia / Filial 01" className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring" />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Módulo *</span>
              <input value={module} onChange={(event) => setModule(event.target.value)} placeholder="Ex: Vendas" className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring" />
            </label>
            <label className="space-y-1.5 sm:col-span-1 lg:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Assunto *</span>
              <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Ex: Pagamento POS / Fiscal" className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring" />
            </label>
            <label className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-muted-foreground">Título *</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Resumo curto e objetivo da solicitação" className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring" />
            </label>
            <label className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-muted-foreground">Descrição detalhada *</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Descreva o cenário, o processo realizado, o comportamento encontrado e o resultado esperado..." className="w-full resize-y rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none transition-colors focus:border-ring" />
            </label>
          </section>

          <section className="rounded-2xl border border-border bg-muted/20 p-4">
            <button type="button" onClick={() => setPriorityRequested((value) => !value)} className="flex w-full items-center justify-between gap-4 text-left">
              <span>
                <span className="block text-sm font-semibold">Solicitar prioridade</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">O AQS ainda decidirá se a prioridade será aprovada ao encaminhar para o DEV.</span>
              </span>
              <span className={cn("flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors", priorityRequested ? "bg-primary" : "bg-muted-foreground/25")}>
                <span className={cn("size-5 rounded-full bg-white shadow-sm transition-transform", priorityRequested && "translate-x-5")} />
              </span>
            </button>
            {priorityRequested && (
              <textarea value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} rows={3} placeholder="Justifique por que esta solicitação deve ser tratada como prioridade..." className="mt-4 w-full resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" />
            )}
          </section>

          <section>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Checklist do protocolo</p>
                <p className="mt-1 text-xs text-muted-foreground">Os três primeiros itens são obrigatórios. Certificado é anexado quando disponível.</p>
              </div>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium", protocolReady ? "border-success/25 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground")}>
                <Check className="size-3.5" /> {REQUIRED_CATEGORIES.filter((category) => categoriesPresent.has(category)).length}/{REQUIRED_CATEGORIES.length} obrigatórios
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {protocolItems.map((item) => {
                const Icon = fileIcon(item.category)
                const selected = files.find((file) => file.category === item.category)
                return (
                  <div key={item.category} className={cn("rounded-2xl border p-3 transition-colors", selected ? "border-primary/25 bg-primary/[0.04]" : "border-border bg-card")}>
                    <div className="flex items-start gap-3">
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", selected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}><Icon className="size-4" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs font-semibold">{SERVICE_REQUEST_ATTACHMENT_LABELS[item.category]}</p>
                          {item.required && <span className="text-[0.6rem] font-semibold uppercase tracking-wide text-primary">Obrigatório</span>}
                        </div>
                        <p className="mt-1 text-[0.68rem] leading-relaxed text-muted-foreground">{item.helper}</p>
                        {selected ? (
                          <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-background/70 px-2.5 py-2">
                            <span className="min-w-0 flex-1 truncate text-[0.68rem] font-medium">{selected.file.name}</span>
                            <span className="shrink-0 text-[0.62rem] text-muted-foreground">{formatBytes(selected.file.size)}</span>
                            <button type="button" onClick={() => setFiles((current) => current.filter((file) => file !== selected))} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"><X className="size-3.5" /></button>
                          </div>
                        ) : (
                          <Button type="button" variant="outline" size="sm" className="mt-2 h-8" onClick={() => inputRefs.current[item.category]?.click()}><Upload className="size-3.5" /> Selecionar arquivo</Button>
                        )}
                        <input ref={(node) => { inputRefs.current[item.category] = node }} type="file" accept={item.accept} className="hidden" onChange={(event) => { addFiles(item.category, Array.from(event.target.files ?? [])); event.currentTarget.value = "" }} />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-3 rounded-2xl border border-dashed border-border bg-card/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Paperclip className="size-4" /></span>
                  <div className="min-w-0"><p className="text-xs font-semibold">Outros arquivos relevantes</p><p className="mt-0.5 text-[0.68rem] text-muted-foreground">Logs, prints, documentos e materiais complementares · até 200 MB por arquivo.</p></div>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => inputRefs.current.other?.click()}><Paperclip className="size-3.5" /> Adicionar</Button>
                <input ref={(node) => { inputRefs.current.other = node }} type="file" multiple className="hidden" onChange={(event) => { addFiles("other", Array.from(event.target.files ?? [])); event.currentTarget.value = "" }} />
              </div>
              {files.some((item) => item.category === "other") && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {files.filter((item) => item.category === "other").map((item, index) => (
                    <span key={`${item.file.name}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[0.68rem]">
                      <span className="max-w-48 truncate font-medium">{item.file.name}</span><span className="text-muted-foreground">{formatBytes(item.file.size)}</span>
                      <button type="button" onClick={() => setFiles((current) => current.filter((file) => file !== item))} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
        </form>

        <DialogFooter className="border-t border-border pt-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button type="submit" form="new-service-request-form" disabled={!formReady || saving} loading={saving} loadingText="Protocolando...">Protocolar solicitação</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
