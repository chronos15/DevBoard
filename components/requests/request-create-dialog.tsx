"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Check,
  ChevronRight,
  Database,
  FileText,
  Link2,
  Paperclip,
  ShieldCheck,
  Upload,
  Video,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { SERVICE_REQUEST_ATTACHMENT_LABELS, SERVICE_REQUEST_TYPE_LABELS } from "@/lib/service-requests"
import type {
  ServiceRequestAttachmentCategory,
  ServiceRequestExternalResourceInput,
  ServiceRequestFileInput,
  ServiceRequestType,
} from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const REQUIRED_CATEGORIES: ServiceRequestAttachmentCategory[] = ["order-pdf", "analysis-video", "database"]
const URL_ELIGIBLE_CATEGORIES = new Set<ServiceRequestAttachmentCategory>(["analysis-video", "database", "certificate"])
const MAX_FILE_BYTES = 200 * 1024 * 1024
const LIMITS = {
  orderNumber: { min: 2, max: 40, label: "Número da OS" },
  module: { min: 2, max: 120, label: "Módulo" },
  subject: { min: 2, max: 180, label: "Assunto" },
  title: { min: 3, max: 180, label: "Título" },
  description: { min: 10, max: 12000, label: "Descrição" },
  priorityReason: { min: 5, max: 2000, label: "Justificativa da prioridade" },
} as const

type SourceMode = "upload" | "url"
type RequestStep = "identification" | "attachments"

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

function validExternalUrl(value: string) {
  return /^(ftp|ftps|https?):\/\/[^\s]+$/i.test(value.trim()) && value.trim().length <= 2000
}

function lengthIssue(value: string, rule: { min: number; max: number; label: string }) {
  const length = value.trim().length
  if (length < rule.min) return `${rule.label}: mínimo de ${rule.min} caracteres.`
  if (length > rule.max) return `${rule.label}: máximo de ${rule.max.toLocaleString("pt-BR")} caracteres.`
  return null
}

function FieldHint({ value, min, max, issue }: { value: string; min: number; max: number; issue?: string | null }) {
  const length = value.length
  return (
    <div className="mt-1 flex items-start justify-between gap-2 text-[0.62rem] leading-none">
      <span className={cn("min-w-0 text-muted-foreground", issue && "font-medium text-destructive")}>{issue ?? `Mínimo ${min} caracteres`}</span>
      <span className={cn("shrink-0 font-mono text-muted-foreground", length > max && "text-destructive")}>{length}/{max}</span>
    </div>
  )
}

function ValidationStrip({ issues }: { issues: string[] }) {
  if (!issues.length) return null
  const visible = issues.slice(0, 3)
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/[0.045] px-3 py-2.5" role="alert">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
        <div className="min-w-0 text-[0.68rem] leading-relaxed">
          <span className="font-semibold text-destructive">Revise esta etapa:</span>{" "}
          <span className="text-muted-foreground">{visible.join(" · ")}{issues.length > visible.length ? ` · +${issues.length - visible.length} pendência(s)` : ""}</span>
        </div>
      </div>
    </div>
  )
}

export function NewServiceRequestDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter()
  const { createServiceRequest, serviceRequestUnits } = useStore()
  const activeUnits = React.useMemo(() => serviceRequestUnits.filter((item) => item.active), [serviceRequestUnits])

  const [step, setStep] = React.useState<RequestStep>("identification")
  const [orderNumber, setOrderNumber] = React.useState("")
  const [requestType, setRequestType] = React.useState<ServiceRequestType>("failure")
  const [unitId, setUnitId] = React.useState("")
  const [module, setModule] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [title, setTitle] = React.useState("")
  const [description, setDescription] = React.useState("")
  const [priorityRequested, setPriorityRequested] = React.useState(false)
  const [priorityReason, setPriorityReason] = React.useState("")
  const [files, setFiles] = React.useState<ServiceRequestFileInput[]>([])
  const [resourceUrls, setResourceUrls] = React.useState<Partial<Record<ServiceRequestAttachmentCategory, string>>>({})
  const [sourceModes, setSourceModes] = React.useState<Partial<Record<ServiceRequestAttachmentCategory, SourceMode>>>({
    "analysis-video": "upload",
    database: "upload",
    certificate: "upload",
  })
  const [saving, setSaving] = React.useState(false)
  const [showValidation, setShowValidation] = React.useState(false)

  const inputRefs = React.useRef<Partial<Record<ServiceRequestAttachmentCategory, HTMLInputElement | null>>>({})
  const tabRefs = React.useRef<Record<RequestStep, HTMLButtonElement | null>>({ identification: null, attachments: null })

  const categoriesPresent = React.useMemo(() => {
    const categories = new Set(files.map((item) => item.category))
    for (const [category, url] of Object.entries(resourceUrls) as Array<[ServiceRequestAttachmentCategory, string | undefined]>) {
      if (url && validExternalUrl(url)) categories.add(category)
    }
    return categories
  }, [files, resourceUrls])

  const protocolReady = REQUIRED_CATEGORIES.every((category) => categoriesPresent.has(category))
  const selectedUnit = activeUnits.find((item) => item.id === unitId)

  const identificationIssues = React.useMemo(() => [
    lengthIssue(orderNumber, LIMITS.orderNumber),
    !selectedUnit ? "Selecione uma unidade ativa." : null,
    lengthIssue(module, LIMITS.module),
    lengthIssue(subject, LIMITS.subject),
    lengthIssue(title, LIMITS.title),
    lengthIssue(description, LIMITS.description),
    priorityRequested ? lengthIssue(priorityReason, LIMITS.priorityReason) : null,
  ].filter(Boolean) as string[], [description, module, orderNumber, priorityReason, priorityRequested, selectedUnit, subject, title])

  const attachmentIssues = React.useMemo(() => {
    const next = [
      !categoriesPresent.has("order-pdf") ? "Anexe a Ordem de Serviço em PDF." : null,
      !categoriesPresent.has("analysis-video") ? "Informe o vídeo/evidência por arquivo ou URL." : null,
      !categoriesPresent.has("database") ? "Informe o banco atualizado por arquivo ou URL FTP." : null,
    ].filter(Boolean) as string[]

    for (const category of URL_ELIGIBLE_CATEGORIES) {
      const value = resourceUrls[category]?.trim()
      if (sourceModes[category] === "url" && value && !validExternalUrl(value)) {
        next.push(`${SERVICE_REQUEST_ATTACHMENT_LABELS[category]}: informe uma URL FTP/HTTP válida.`)
      }
    }
    return next
  }, [categoriesPresent, resourceUrls, sourceModes])

  const issues = React.useMemo(() => [...identificationIssues, ...attachmentIssues], [attachmentIssues, identificationIssues])
  const identificationReady = identificationIssues.length === 0

  function reset() {
    setStep("identification")
    setOrderNumber("")
    setRequestType("failure")
    setUnitId("")
    setModule("")
    setSubject("")
    setTitle("")
    setDescription("")
    setPriorityRequested(false)
    setPriorityReason("")
    setFiles([])
    setResourceUrls({})
    setSourceModes({ "analysis-video": "upload", database: "upload", certificate: "upload" })
    setShowValidation(false)
  }

  function addFiles(category: ServiceRequestAttachmentCategory, picked: File[]) {
    const tooLarge = picked.find((file) => file.size > MAX_FILE_BYTES)
    if (tooLarge) {
      window.alert(`O arquivo “${tooLarge.name}” excede o limite de 200 MB. Para arquivos grandes, use a opção URL FTP.`)
      return
    }
    const valid = picked.filter((file) => file.size > 0)
    if (!valid.length) return
    setFiles((current) => [
      ...current.filter((item) => category === "other" || item.category !== category),
      ...valid.map((file) => ({ file, category })),
    ])
  }

  function chooseMode(category: ServiceRequestAttachmentCategory, mode: SourceMode) {
    setSourceModes((current) => ({ ...current, [category]: mode }))
    if (mode === "url") setFiles((current) => current.filter((item) => item.category !== category))
    else setResourceUrls((current) => ({ ...current, [category]: "" }))
  }

  function moveToAttachments() {
    if (!identificationReady) {
      setShowValidation(true)
      setStep("identification")
      return
    }
    setStep("attachments")
    setShowValidation(false)
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const order: RequestStep[] = ["identification", "attachments"]
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    let next: RequestStep = step
    if (event.key === "Home") next = order[0]
    else if (event.key === "End") next = order[order.length - 1]
    else {
      const index = order.indexOf(step)
      next = event.key === "ArrowRight" ? order[(index + 1) % order.length] : order[(index - 1 + order.length) % order.length]
    }
    setStep(next)
    requestAnimationFrame(() => tabRefs.current[next]?.focus())
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setShowValidation(true)
    if (issues.length || saving) {
      setStep(identificationIssues.length ? "identification" : "attachments")
      return
    }

    const externalResources: ServiceRequestExternalResourceInput[] = Array.from(URL_ELIGIBLE_CATEGORIES).flatMap((category) => {
      const url = resourceUrls[category]?.trim()
      if (sourceModes[category] !== "url" || !url || !validExternalUrl(url)) return []
      return [{ category, url, name: `${SERVICE_REQUEST_ATTACHMENT_LABELS[category]} · URL externa` }]
    })

    setSaving(true)
    try {
      const id = await createServiceRequest({
        orderNumber: orderNumber.trim(),
        requestType,
        unitId,
        module: module.trim(),
        subject: subject.trim(),
        title: title.trim(),
        description: description.trim(),
        priorityRequested,
        priorityReason: priorityRequested ? priorityReason.trim() : undefined,
        files,
        externalResources,
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
    { category: "analysis-video", helper: "Vídeo/evidência da análise. Arquivo ou URL FTP.", required: true, accept: "video/*" },
    { category: "database", helper: "Banco atualizado. Para bases grandes, prefira a URL FTP.", required: true, accept: ".fdb,.fbk,.zip,.7z,.rar,.bak,.db,.sqlite,application/octet-stream,application/zip" },
    { category: "certificate", helper: "Certificado digital quando disponível. Arquivo ou URL.", required: false, accept: ".pfx,.p12,.cer,.crt,.zip,.rar,application/x-pkcs12,application/pkix-cert" },
  ]

  const fieldIssue = (value: string, rule: typeof LIMITS[keyof typeof LIMITS]) => showValidation ? lengthIssue(value, rule) : null
  const currentIssues = step === "identification" ? identificationIssues : attachmentIssues

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!saving) { onOpenChange(value); if (!value) reset() } }}>
      <DialogContent
        className="h-[min(86dvh,760px)] max-h-[calc(100dvh-1.5rem)] overflow-hidden p-0 sm:max-w-5xl"
        showCloseButton
      >
        <form id="new-service-request-form" onSubmit={submit} className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto]">
          <DialogHeader className="gap-1.5 border-b border-border px-5 pb-4 pt-5 pr-12">
            <DialogTitle className="text-lg">Nova solicitação</DialogTitle>
            <DialogDescription className="max-w-3xl text-xs leading-relaxed">
              Protocole a OS para o fluxo AQS → DEV. Arquivos grandes podem permanecer no FTP e ser referenciados por URL.
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-border bg-muted/20 px-5 py-2.5">
            <div
              role="tablist"
              aria-label="Etapas da nova solicitação"
              onKeyDown={handleTabKeyDown}
              className="grid max-w-xl grid-cols-2 gap-1 rounded-xl border border-border bg-background p-1"
            >
              <button
                ref={(node) => { tabRefs.current.identification = node }}
                type="button"
                role="tab"
                aria-selected={step === "identification"}
                tabIndex={step === "identification" ? 0 : -1}
                onClick={() => setStep("identification")}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  step === "identification" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", step === "identification" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <FileText className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Identificação</span>
                  <span className="block truncate text-[0.62rem] text-muted-foreground">Dados da OS e prioridade</span>
                </span>
                {identificationReady && <Check className="size-3.5 shrink-0 text-success" />}
              </button>

              <button
                ref={(node) => { tabRefs.current.attachments = node }}
                type="button"
                role="tab"
                aria-selected={step === "attachments"}
                tabIndex={step === "attachments" ? 0 : -1}
                onClick={() => setStep("attachments")}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  step === "attachments" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", step === "attachments" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  <Paperclip className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">Anexos</span>
                  <span className="block truncate text-[0.62rem] text-muted-foreground">Arquivos e URLs do protocolo</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[0.58rem]", protocolReady ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>
                  {REQUIRED_CATEGORIES.filter((category) => categoriesPresent.has(category)).length}/{REQUIRED_CATEGORIES.length}
                </span>
              </button>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
            <div className="mx-auto w-full max-w-5xl">
              {showValidation && <ValidationStrip issues={currentIssues} />}

              {step === "identification" ? (
                <div className={cn("grid gap-3", showValidation && currentIssues.length ? "mt-3" : "")}> 
                  <section className="grid gap-x-3 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Número da OS *</span>
                      <input
                        autoFocus
                        maxLength={LIMITS.orderNumber.max}
                        value={orderNumber}
                        onChange={(event) => setOrderNumber(event.target.value)}
                        placeholder="Ex: 198855"
                        className={cn("h-9 w-full rounded-xl border bg-card px-3 text-sm outline-none transition-colors focus:border-ring", fieldIssue(orderNumber, LIMITS.orderNumber) ? "border-destructive" : "border-border")}
                      />
                      <FieldHint value={orderNumber} min={LIMITS.orderNumber.min} max={LIMITS.orderNumber.max} issue={fieldIssue(orderNumber, LIMITS.orderNumber)} />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Tipo da solicitação *</span>
                      <Select value={requestType} onValueChange={(value) => value && setRequestType(String(value) as ServiceRequestType)}>
                        <SelectTrigger className="h-9 w-full rounded-xl bg-card"><SelectValue>{SERVICE_REQUEST_TYPE_LABELS[requestType]}</SelectValue></SelectTrigger>
                        <SelectContent align="start">{(Object.entries(SERVICE_REQUEST_TYPE_LABELS) as Array<[ServiceRequestType, string]>).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                      </Select>
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Unidade *</span>
                      <Select value={unitId} onValueChange={(value) => value && setUnitId(String(value))}>
                        <SelectTrigger className={cn("h-9 w-full rounded-xl bg-card", showValidation && !selectedUnit && "border-destructive")}>
                          <SelectValue placeholder="Selecione a unidade">{selectedUnit?.name ?? "Selecione a unidade"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent align="start">{activeUnits.map((unit) => <SelectItem key={unit.id} value={unit.id}>{unit.name}</SelectItem>)}</SelectContent>
                      </Select>
                      {activeUnits.length === 0 ? <p className="text-[0.62rem] font-medium text-warning">Nenhuma unidade ativa. Cadastre em Configurações → Unidades.</p> : showValidation && !selectedUnit ? <p className="text-[0.62rem] font-medium text-destructive">Selecione uma unidade ativa.</p> : null}
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Módulo *</span>
                      <input maxLength={LIMITS.module.max} value={module} onChange={(event) => setModule(event.target.value)} placeholder="Ex: Vendas" className={cn("h-9 w-full rounded-xl border bg-card px-3 text-sm outline-none transition-colors focus:border-ring", fieldIssue(module, LIMITS.module) ? "border-destructive" : "border-border")} />
                      <FieldHint value={module} min={LIMITS.module.min} max={LIMITS.module.max} issue={fieldIssue(module, LIMITS.module)} />
                    </label>

                    <label className="space-y-1.5 sm:col-span-1 lg:col-span-2">
                      <span className="text-xs font-medium text-muted-foreground">Assunto *</span>
                      <input maxLength={LIMITS.subject.max} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Ex: Pagamento POS / Fiscal" className={cn("h-9 w-full rounded-xl border bg-card px-3 text-sm outline-none transition-colors focus:border-ring", fieldIssue(subject, LIMITS.subject) ? "border-destructive" : "border-border")} />
                      <FieldHint value={subject} min={LIMITS.subject.min} max={LIMITS.subject.max} issue={fieldIssue(subject, LIMITS.subject)} />
                    </label>

                    <label className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                      <span className="text-xs font-medium text-muted-foreground">Título *</span>
                      <input maxLength={LIMITS.title.max} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Resumo curto e objetivo da solicitação" className={cn("h-9 w-full rounded-xl border bg-card px-3 text-sm outline-none transition-colors focus:border-ring", fieldIssue(title, LIMITS.title) ? "border-destructive" : "border-border")} />
                      <FieldHint value={title} min={LIMITS.title.min} max={LIMITS.title.max} issue={fieldIssue(title, LIMITS.title)} />
                    </label>

                    <label className="space-y-1.5 sm:col-span-2 lg:col-span-3">
                      <span className="text-xs font-medium text-muted-foreground">Descrição detalhada *</span>
                      <textarea
                        maxLength={LIMITS.description.max}
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        rows={3}
                        placeholder="Descreva o cenário, o processo realizado, o comportamento encontrado e o resultado esperado..."
                        className={cn("min-h-24 w-full resize-y rounded-xl border bg-card p-3 text-sm leading-relaxed outline-none transition-colors focus:border-ring", fieldIssue(description, LIMITS.description) ? "border-destructive" : "border-border")}
                      />
                      <FieldHint value={description} min={LIMITS.description.min} max={LIMITS.description.max} issue={fieldIssue(description, LIMITS.description)} />
                    </label>
                  </section>

                  <section className="rounded-2xl border border-border bg-muted/20 px-3.5 py-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                      <button type="button" onClick={() => setPriorityRequested((value) => !value)} className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold">Solicitar prioridade</span>
                          <span className="mt-0.5 block text-[0.68rem] text-muted-foreground">O AQS decidirá se a prioridade será aprovada.</span>
                        </span>
                        <span className={cn("flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors", priorityRequested ? "bg-primary" : "bg-muted-foreground/25")}>
                          <span className={cn("size-5 rounded-full bg-white shadow-sm transition-transform", priorityRequested && "translate-x-5")} />
                        </span>
                      </button>
                      {priorityRequested && (
                        <div className="min-w-0 flex-1 lg:max-w-xl">
                          <textarea maxLength={LIMITS.priorityReason.max} value={priorityReason} onChange={(event) => setPriorityReason(event.target.value)} rows={2} placeholder="Justifique a prioridade..." className={cn("w-full resize-none rounded-xl border bg-card px-3 py-2 text-xs leading-relaxed outline-none focus:border-ring", fieldIssue(priorityReason, LIMITS.priorityReason) ? "border-destructive" : "border-border")} />
                          <FieldHint value={priorityReason} min={LIMITS.priorityReason.min} max={LIMITS.priorityReason.max} issue={fieldIssue(priorityReason, LIMITS.priorityReason)} />
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                <div className={cn(showValidation && currentIssues.length ? "mt-3" : "")}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold">Checklist do protocolo</p>
                      <p className="mt-0.5 text-[0.68rem] text-muted-foreground">OS em PDF; vídeo e banco por arquivo ou URL. Certificado é opcional.</p>
                    </div>
                    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.68rem] font-medium", protocolReady ? "border-success/25 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground")}>
                      <Check className="size-3.5" /> {REQUIRED_CATEGORIES.filter((category) => categoriesPresent.has(category)).length}/{REQUIRED_CATEGORIES.length} obrigatórios
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {protocolItems.map((item) => {
                      const Icon = fileIcon(item.category)
                      const selected = files.find((file) => file.category === item.category)
                      const canUseUrl = URL_ELIGIBLE_CATEGORIES.has(item.category)
                      const mode = sourceModes[item.category] ?? "upload"
                      const url = resourceUrls[item.category] ?? ""
                      const urlValid = validExternalUrl(url)
                      const present = Boolean(selected) || (mode === "url" && urlValid)

                      return (
                        <div key={item.category} className={cn("rounded-2xl border p-3 transition-colors", present ? "border-primary/25 bg-primary/[0.035]" : "border-border bg-card")}>
                          <div className="flex items-start gap-3">
                            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", present ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}><Icon className="size-4" /></span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 items-center gap-2">
                                <p className="min-w-0 flex-1 truncate text-xs font-semibold">{SERVICE_REQUEST_ATTACHMENT_LABELS[item.category]}</p>
                                {item.required && <span className="shrink-0 text-[0.56rem] font-semibold uppercase tracking-wide text-primary">Obrigatório</span>}
                              </div>
                              <p className="mt-0.5 line-clamp-2 text-[0.66rem] leading-relaxed text-muted-foreground">{item.helper}</p>

                              {canUseUrl && (
                                <div className="mt-2 inline-flex rounded-lg border border-border bg-background p-0.5">
                                  <button type="button" onClick={() => chooseMode(item.category, "upload")} className={cn("h-7 rounded-md px-2.5 text-[0.62rem] font-semibold", mode === "upload" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>Arquivo</button>
                                  <button type="button" onClick={() => chooseMode(item.category, "url")} className={cn("h-7 rounded-md px-2.5 text-[0.62rem] font-semibold", mode === "url" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>URL FTP</button>
                                </div>
                              )}

                              {mode === "url" && canUseUrl ? (
                                <div className="mt-2">
                                  <div className={cn("flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5", url && !urlValid ? "border-destructive" : "border-border")}> 
                                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                                    <input value={url} onChange={(event) => setResourceUrls((current) => ({ ...current, [item.category]: event.target.value }))} maxLength={2000} placeholder="ftp://servidor/solicitacoes/..." className="min-w-0 flex-1 bg-transparent text-[0.68rem] outline-none placeholder:text-muted-foreground/65" />
                                    {url && <button type="button" aria-label="Limpar URL" onClick={() => setResourceUrls((current) => ({ ...current, [item.category]: "" }))} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>}
                                  </div>
                                  {url && !urlValid && <p className="mt-1 text-[0.6rem] font-medium text-destructive">Use ftp://, ftps://, http:// ou https://.</p>}
                                </div>
                              ) : selected ? (
                                <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-background/70 px-2.5 py-2">
                                  <span className="min-w-0 flex-1 truncate text-[0.68rem] font-medium">{selected.file.name}</span>
                                  <span className="shrink-0 text-[0.62rem] text-muted-foreground">{formatBytes(selected.file.size)}</span>
                                  <button type="button" aria-label="Remover arquivo" onClick={() => setFiles((current) => current.filter((file) => file !== selected))} className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-destructive"><X className="size-3.5" /></button>
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
                        <div className="min-w-0">
                          <p className="text-xs font-semibold">Outros arquivos relevantes</p>
                          <p className="mt-0.5 text-[0.66rem] text-muted-foreground">Logs, prints e materiais complementares · até 200 MB por arquivo.</p>
                        </div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => inputRefs.current.other?.click()}><Paperclip className="size-3.5" /> Adicionar</Button>
                      <input ref={(node) => { inputRefs.current.other = node }} type="file" multiple className="hidden" onChange={(event) => { addFiles("other", Array.from(event.target.files ?? [])); event.currentTarget.value = "" }} />
                    </div>
                    {files.some((item) => item.category === "other") && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {files.filter((item) => item.category === "other").map((item, index) => (
                          <span key={`${item.file.name}-${index}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[0.68rem]">
                            <span className="max-w-48 truncate font-medium">{item.file.name}</span>
                            <span className="text-muted-foreground">{formatBytes(item.file.size)}</span>
                            <button type="button" aria-label="Remover arquivo" onClick={() => setFiles((current) => current.filter((file) => file !== item))} className="text-muted-foreground hover:text-destructive"><X className="size-3.5" /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="m-0 rounded-none border-t border-border bg-popover/95 px-5 py-3 sm:items-center sm:justify-between">
            <div className="hidden text-[0.62rem] text-muted-foreground sm:block">Tab navega · ←/→ troca guia · Enter confirma · Esc fecha</div>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              {step === "identification" ? (
                <Button type="button" onClick={moveToAttachments} disabled={activeUnits.length === 0}>
                  Continuar para anexos <ChevronRight className="size-4" />
                </Button>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={() => setStep("identification")} disabled={saving}>Voltar</Button>
                  <Button type="submit" disabled={saving || activeUnits.length === 0} loading={saving} loadingText="Protocolando...">Protocolar solicitação</Button>
                </>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
