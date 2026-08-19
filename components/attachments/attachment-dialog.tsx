"use client"

import * as React from "react"
import {
  CheckCircle2,
  CircleOff,
  Clipboard,
  Download,
  File as FileIcon,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  Paperclip,
  Save,
  Upload,
  X,
} from "lucide-react"
import type {
  AttachmentEntry,
  AttachmentKind,
  AttachmentUploadInput,
} from "@/lib/types"
import { useStore } from "@/lib/store"
import { createClient } from "@/lib/supabase/client"
import { ATTACHMENTS_BUCKET } from "@/lib/supabase/helpers"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_BATCH_BYTES = 150 * 1024 * 1024

const textExtensions = new Set([
  "sql",
  "txt",
  "md",
  "json",
  "xml",
  "csv",
  "log",
  "yaml",
  "yml",
  "ini",
  "env",
  "js",
  "ts",
  "tsx",
  "jsx",
  "css",
  "html",
  "dart",
  "pas",
])

const documentExtensions = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
])

function extensionOf(name: string) {
  const index = name.lastIndexOf(".")
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ""
}

function detectKind(file: File): AttachmentKind {
  const extension = extensionOf(file.name)
  if (file.type.startsWith("image/")) return "image"
  if (file.type === "application/pdf" || extension === "pdf") return "pdf"
  if (file.type.startsWith("video/")) return "video"
  if (file.type.startsWith("audio/")) return "audio"
  if (file.type.startsWith("text/") || textExtensions.has(extension)) return "text"
  if (documentExtensions.has(extension)) return "document"
  return "other"
}


async function fileToUpload(file: File): Promise<AttachmentUploadInput> {
  const kind = detectKind(file)
  const base = {
    name: file.name,
    mimeType: file.type,
    size: file.size,
    kind,
  }

  if (kind === "text") {
    return { ...base, textContent: await file.text() }
  }

  return { ...base, file, dataUrl: URL.createObjectURL(file) }
}

function revokePreviewUrls(files: AttachmentUploadInput[]) {
  for (const file of files) {
    if (file.dataUrl?.startsWith("blob:")) URL.revokeObjectURL(file.dataUrl)
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function kindLabel(kind: AttachmentKind) {
  if (kind === "image") return "Imagem"
  if (kind === "pdf") return "PDF"
  if (kind === "text") return "Texto / código"
  if (kind === "document") return "Documento"
  if (kind === "video") return "Vídeo"
  if (kind === "audio") return "Áudio"
  return "Arquivo"
}

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon =
    kind === "image"
      ? FileImage
      : kind === "text"
        ? FileCode2
        : kind === "video"
          ? FileVideo
          : kind === "audio"
            ? FileAudio
            : kind === "pdf" || kind === "document"
              ? FileText
              : FileIcon
  return <Icon className={className} />
}

function textDownloadHref(attachment: AttachmentEntry) {
  const mime = attachment.mimeType || "text/plain"
  return `data:${mime};charset=utf-8,${encodeURIComponent(attachment.textContent ?? "")}`
}

type PreviewableAttachment = Pick<
  AttachmentEntry,
  "name" | "kind" | "dataUrl" | "textContent"
>

function AttachmentPreview({ attachment }: { attachment: PreviewableAttachment }) {
  const downloadHref = attachment.textContent !== undefined
    ? textDownloadHref(attachment)
    : attachment.dataUrl

  if (attachment.kind === "image" && attachment.dataUrl) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-xl bg-muted/35 p-3">
        <img
          src={attachment.dataUrl}
          alt={attachment.name}
          className="max-h-[52dvh] max-w-full rounded-lg object-contain"
        />
      </div>
    )
  }

  if (attachment.kind === "pdf" && attachment.dataUrl) {
    return (
      <iframe
        src={attachment.dataUrl}
        title={`Visualização de ${attachment.name}`}
        className="h-[52dvh] min-h-80 w-full rounded-xl border border-border bg-background"
      />
    )
  }

  if (attachment.kind === "video" && attachment.dataUrl) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-xl bg-muted/35 p-3">
        <video src={attachment.dataUrl} controls className="max-h-[50dvh] max-w-full rounded-lg" />
      </div>
    )
  }

  if (attachment.kind === "audio" && attachment.dataUrl) {
    return (
      <div className="flex min-h-52 flex-col items-center justify-center rounded-xl bg-muted/35 p-6">
        <FileAudio className="size-9 text-muted-foreground/55" />
        <audio src={attachment.dataUrl} controls className="mt-5 w-full max-w-lg" />
      </div>
    )
  }

  if (attachment.kind === "text" && attachment.textContent !== undefined) {
    return (
      <pre className="max-h-[52dvh] min-h-72 overflow-auto rounded-xl border border-border bg-sidebar p-4 font-mono text-xs leading-relaxed text-sidebar-foreground selection:bg-primary/25">
        <code>{attachment.textContent}</code>
      </pre>
    )
  }

  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 px-6 text-center">
      <KindIcon kind={attachment.kind} className="size-10 text-muted-foreground/45" />
      <p className="mt-4 text-sm font-medium">Pré-visualização não disponível</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        Este formato fica preservado como anexo, mas não possui visualizador nativo nesta etapa da interface.
      </p>
      {downloadHref && (
        <a
          href={downloadHref}
          download={attachment.name}
          className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
        >
          <Download className="size-3.5" />
          Baixar arquivo
        </a>
      )}
    </div>
  )
}

type StatusFilter = "active" | "inactive" | "all"

export function AttachmentDialog({
  title,
  description,
  attachments,
  onAdd,
  onSetActive,
  compact = false,
  buttonLabel = "Arquivos",
  className,
}: {
  title: string
  description: string
  attachments: AttachmentEntry[]
  onAdd: (files: AttachmentUploadInput[]) => boolean | void | Promise<boolean | void>
  onSetActive: (attachmentId: string, active: boolean) => boolean | void | Promise<boolean | void>
  compact?: boolean
  buttonLabel?: string
  className?: string
}) {
  const { members } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const [open, setOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<StatusFilter>("active")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [error, setError] = React.useState("")
  const [reading, setReading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [statusSavingId, setStatusSavingId] = React.useState<string | null>(null)
  const [resolvedUrls, setResolvedUrls] = React.useState<Record<string, string>>({})
  const [resolvedText, setResolvedText] = React.useState<Record<string, string>>({})
  const [previewLoadingId, setPreviewLoadingId] = React.useState<string | null>(null)
  const [pendingUploads, setPendingUploads] = React.useState<AttachmentUploadInput[]>([])
  const [pendingIndex, setPendingIndex] = React.useState(0)
  const [pendingSource, setPendingSource] = React.useState<"selection" | "paste">("selection")
  const inputRef = React.useRef<HTMLInputElement>(null)

  const sorted = React.useMemo(
    () => [...attachments].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [attachments],
  )

  const filtered = React.useMemo(
    () => sorted.filter((attachment) => filter === "all" || attachment.active === (filter === "active")),
    [sorted, filter],
  )

  const activeCount = attachments.filter((attachment) => attachment.active).length
  const inactiveCount = attachments.length - activeCount
  const selectedBase = attachments.find((attachment) => attachment.id === selectedId) ?? filtered[0]
  const selected = selectedBase
    ? {
        ...selectedBase,
        dataUrl: selectedBase.dataUrl ?? resolvedUrls[selectedBase.id],
        textContent: selectedBase.textContent ?? resolvedText[selectedBase.id],
      }
    : undefined
  const pendingSelected = pendingUploads[pendingIndex]

  React.useEffect(() => {
    if (!open) return
    if (!filtered.some((attachment) => attachment.id === selectedId)) {
      setSelectedId(filtered[0]?.id ?? null)
    }
  }, [open, filtered, selectedId])

  React.useEffect(() => {
    if (!open || !selectedBase) return

    const needsStorageUrl = Boolean(
      selectedBase.storagePath && !selectedBase.dataUrl && !resolvedUrls[selectedBase.id],
    )
    const needsText = Boolean(
      selectedBase.kind === "text" &&
      !selectedBase.storagePath &&
      selectedBase.textContent === undefined &&
      resolvedText[selectedBase.id] === undefined,
    )
    if (!needsStorageUrl && !needsText) return

    let cancelled = false
    setPreviewLoadingId(selectedBase.id)

    const request = needsStorageUrl
      ? supabase.storage
          .from(ATTACHMENTS_BUCKET)
          .createSignedUrl(selectedBase.storagePath!, 3600)
          .then(({ data, error }) => {
            if (error || !data?.signedUrl) throw error ?? new Error("URL do anexo indisponível")
            if (!cancelled) setResolvedUrls((current) => ({ ...current, [selectedBase.id]: data.signedUrl }))
          })
      : supabase
          .from("attachments")
          .select("text_content")
          .eq("id", selectedBase.id)
          .maybeSingle()
          .then(({ data, error }) => {
            if (error) throw error
            if (!cancelled) setResolvedText((current) => ({ ...current, [selectedBase.id]: data?.text_content ?? "" }))
          })

    void request
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar a pré-visualização deste anexo agora.")
      })
      .finally(() => {
        if (!cancelled) setPreviewLoadingId((current) => current === selectedBase.id ? null : current)
      })

    return () => { cancelled = true }
  }, [open, resolvedText, resolvedUrls, selectedBase, supabase])

  React.useEffect(() => {
    if (!open) {
      revokePreviewUrls(pendingUploads)
      setError("")
      setReading(false)
      setSaving(false)
      setStatusSavingId(null)
      setPendingUploads([])
      setPendingIndex(0)
      setPendingSource("selection")
    }
    // pendingUploads deve ser lido apenas na transição de fechamento; incluí-lo aqui
    // causaria revogação do preview enquanto o modal ainda está aberto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const stageFiles = React.useCallback(async (files: File[], source: "selection" | "paste") => {
    if (files.length === 0) return

    const tooLarge = files.find((file) => file.size > MAX_FILE_BYTES)
    if (tooLarge) {
      setError(`“${tooLarge.name || "Arquivo colado"}” ultrapassa ${formatBytes(MAX_FILE_BYTES)}, limite configurado no Supabase Storage.`)
      return
    }

    const total = files.reduce((sum, file) => sum + file.size, 0)
    if (total > MAX_BATCH_BYTES) {
      setError(`A seleção ultrapassa ${formatBytes(MAX_BATCH_BYTES)}. Envie os arquivos em lotes menores.`)
      return
    }

    setReading(true)
    setError("")
    try {
      const uploads = await Promise.all(files.map(fileToUpload))
      revokePreviewUrls(pendingUploads)
      setPendingUploads(uploads)
      setPendingIndex(0)
      setPendingSource(source)
    } catch {
      setError("Não foi possível ler um dos arquivos selecionados.")
    } finally {
      setReading(false)
    }
  }, [pendingUploads])

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    await stageFiles(files, "selection")
  }

  React.useEffect(() => {
    if (!open) return

    function handlePaste(event: ClipboardEvent) {
      if (reading || !event.clipboardData) return

      const files = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))

      if (files.length > 0) {
        event.preventDefault()
        void stageFiles(files, "paste")
        return
      }

      const text = event.clipboardData.getData("text/plain")
      if (!text) return

      event.preventDefault()
      const stamp = new Date()
        .toISOString()
        .replace(/[:T]/g, "-")
        .replace(/\..+$/, "")
      const textSize = new TextEncoder().encode(text).byteLength
      const upload: AttachmentUploadInput = {
        name: `texto-colado-${stamp}.txt`,
        mimeType: "text/plain",
        size: textSize,
        kind: "text",
        textContent: text,
      }

      setError("")
      revokePreviewUrls(pendingUploads)
      setPendingUploads([upload])
      setPendingIndex(0)
      setPendingSource("paste")
    }

    window.addEventListener("paste", handlePaste)
    return () => window.removeEventListener("paste", handlePaste)
  }, [open, pendingUploads, reading, stageFiles])

  function cancelPending() {
    if (saving) return
    revokePreviewUrls(pendingUploads)
    setPendingUploads([])
    setPendingIndex(0)
    setPendingSource("selection")
    setError("")
  }

  async function confirmPending() {
    if (pendingUploads.length === 0 || saving) return
    setSaving(true)
    setError("")
    try {
      const result = await onAdd(pendingUploads)
      if (result === false) {
        setError("O Supabase não confirmou o envio. Revise o erro exibido e tente novamente; sua seleção foi preservada.")
        return
      }
      revokePreviewUrls(pendingUploads)
      setPendingUploads([])
      setPendingIndex(0)
      setPendingSource("selection")
      setFilter("active")
    } catch {
      setError("Não foi possível salvar os anexos. Sua seleção foi preservada para uma nova tentativa.")
    } finally {
      setSaving(false)
    }
  }

  const downloadHref = selected
    ? selected.textContent !== undefined
      ? textDownloadHref(selected)
      : selected.dataUrl
    : undefined

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          compact
            ? "inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            : "flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted",
          className,
        )}
        aria-label={`${buttonLabel} de ${title}`}
        title={buttonLabel}
      >
        <Paperclip className="size-3.5" />
        {compact ? (
          attachments.length > 0 && (
            <span className="font-mono text-[0.62rem] tabular-nums">{attachments.length}</span>
          )
        ) : (
          <>
            <span>{buttonLabel}</span>
            {attachments.length > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[0.6rem] tabular-nums text-muted-foreground">
                {attachments.length}
              </span>
            )}
          </>
        )}
      </button>

      <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving || nextOpen) setOpen(nextOpen) }}>
        <DialogContent className="grid min-w-0 max-h-[92dvh] w-[calc(100dvw-1.5rem)] max-w-[calc(100dvw-1.5rem)] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:w-full sm:max-w-5xl">
          <DialogHeader className="min-w-0 overflow-hidden border-b border-border px-4 py-4 pr-12 sm:px-5">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Paperclip className="size-4" />
              </span>
              <div className="min-w-0 flex-1 overflow-hidden">
                <DialogTitle className="line-clamp-2 max-w-full break-words leading-snug sm:line-clamp-1" title={title}>{title}</DialogTitle>
                <DialogDescription className="mt-1 line-clamp-2 break-words">{description}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-w-0 overflow-hidden border-b border-border bg-muted/20 px-4 py-3 sm:px-5">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  ["active", `Ativos ${activeCount}`],
                  ["inactive", `Inativos ${inactiveCount}`],
                  ["all", `Todos ${attachments.length}`],
                ] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[0.68rem] font-medium transition-colors",
                      filter === key
                        ? "border-primary/25 bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="min-w-0 flex flex-col items-stretch gap-1.5 sm:items-end">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*,audio/*,application/pdf,text/*,.sql,.json,.md,.csv,.xml,.yaml,.yml,.log,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.dart,.pas"
                    onChange={handleFiles}
                    className="hidden"
                  />
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => inputRef.current?.click()}
                    disabled={reading || saving}
                    loading={reading}
                    loadingText="Lendo..."
                    className="w-full gap-1.5 sm:w-auto"
                  >
                    <Upload className="size-3.5" />
                    {pendingUploads.length > 0 ? "Trocar seleção" : "Adicionar arquivos"}
                  </Button>
                </div>
                <span className="flex min-w-0 items-start justify-center gap-1 break-words text-center text-[0.62rem] leading-relaxed text-muted-foreground sm:items-center sm:justify-end sm:text-right">
                  <Clipboard className="mt-0.5 size-3 shrink-0 sm:mt-0" />
                  Com este modal aberto, use Ctrl+V para colar mídia, arquivo ou texto
                </span>
              </div>
            </div>
            <p className={cn("mt-2 max-w-full break-words text-[0.62rem] leading-relaxed", error ? "text-destructive" : "text-muted-foreground") }>
              {error || (pendingUploads.length > 0
                ? "Revise o preview abaixo. Os anexos só serão adicionados após sua confirmação."
                : "Arquivos ficam ativos por padrão e não podem ser excluídos; somente marcados como inativos. Limite do Supabase Storage: 50 MB por arquivo.")}
            </p>
          </div>

          {pendingUploads.length > 0 ? (
            <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto">
              <div className="border-b border-border bg-primary/[0.035] px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Pré-visualização antes de salvar</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pendingSource === "paste" ? "Conteúdo recebido pelo Ctrl+V" : "Arquivos selecionados"} · {pendingUploads.length} {pendingUploads.length === 1 ? "item" : "itens"}
                    </p>
                  </div>
                  <div className="flex w-full gap-2 sm:w-auto">
                    <Button type="button" variant="outline" size="lg" onClick={cancelPending} disabled={saving} className="flex-1 gap-1.5 sm:flex-none">
                      <X className="size-3.5" />
                      Cancelar
                    </Button>
                    <Button type="button" size="lg" onClick={() => void confirmPending()} disabled={saving} loading={saving} loadingText="Enviando..." className="flex-1 gap-1.5 sm:flex-none">
                      <Save className="size-3.5" />
                      Confirmar e salvar
                    </Button>
                  </div>
                </div>
              </div>

              <div className="md:grid md:min-h-[420px] md:grid-cols-[260px_minmax(0,1fr)]">
                <div className="border-b border-border p-3 md:border-r md:border-b-0">
                  <div className="flex gap-2 overflow-x-auto pb-1 md:block md:space-y-1.5 md:overflow-visible md:pb-0">
                    {pendingUploads.map((attachment, index) => (
                      <button
                        key={`${attachment.name}-${index}`}
                        type="button"
                        onClick={() => setPendingIndex(index)}
                        className={cn(
                          "flex min-w-[210px] items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors md:min-w-0 md:w-full",
                          pendingIndex === index ? "bg-primary/8 ring-1 ring-primary/15" : "bg-muted/30 hover:bg-muted/60",
                        )}
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                          <KindIcon kind={attachment.kind} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium" title={attachment.name}>{attachment.name}</span>
                          <span className="mt-1 block text-[0.62rem] text-muted-foreground">
                            {kindLabel(attachment.kind)} · {formatBytes(attachment.size)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="min-w-0 p-4 sm:p-5">
                  {pendingSelected && (
                    <div className="space-y-4">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="min-w-0 max-w-full flex-1 truncate text-sm font-semibold" title={pendingSelected.name}>{pendingSelected.name}</h3>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.62rem] font-medium text-primary">Aguardando confirmação</span>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {kindLabel(pendingSelected.kind)} · {formatBytes(pendingSelected.size)}
                        </p>
                      </div>
                      <AttachmentPreview attachment={pendingSelected} />
                      <div className="rounded-xl border border-primary/15 bg-primary/[0.035] px-3 py-2.5 text-[0.68rem] text-muted-foreground">
                        Nada foi salvo ainda. Confira o conteúdo e use <strong className="font-medium text-foreground/80">Confirmar e salvar</strong> para adicionar {pendingUploads.length === 1 ? "este anexo" : "estes anexos"}.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
          <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto md:grid md:grid-cols-[285px_minmax(0,1fr)] md:overflow-hidden">
            <div className="min-w-0 border-b border-border p-3 md:min-h-0 md:overflow-y-auto md:border-r md:border-b-0">
              {filtered.length === 0 ? (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed border-border px-5 text-center">
                  <Paperclip className="size-5 text-muted-foreground/45" />
                  <p className="mt-3 text-sm font-medium">
                    {attachments.length === 0 ? "Nenhum arquivo ainda" : "Nenhum arquivo neste filtro"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {attachments.length === 0
                      ? "Qualquer usuário pode adicionar documentação, SQL e mídias."
                      : "Altere o filtro para visualizar os outros anexos."}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filtered.map((attachment) => {
                    const uploader = members.find((member) => member.id === attachment.uploadedBy)
                    const current = selected?.id === attachment.id
                    return (
                      <button
                        key={attachment.id}
                        type="button"
                        onClick={() => setSelectedId(attachment.id)}
                        className={cn(
                          "flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition-colors",
                          current ? "bg-primary/8 ring-1 ring-primary/15" : "hover:bg-muted/60",
                          !attachment.active && "opacity-65",
                        )}
                      >
                        <span className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg",
                          attachment.active ? "bg-muted text-muted-foreground" : "bg-muted/60 text-muted-foreground/60",
                        )}>
                          <KindIcon kind={attachment.kind} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium" title={attachment.name}>{attachment.name}</span>
                          <span className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-[0.6rem] text-muted-foreground">
                            {uploader && <MemberAvatar member={uploader} className="size-4 text-[0.4rem] ring-0" />}
                            <MemberName member={uploader} className="truncate" fallback="Usuário" />
                            <span>·</span>
                            <span className="shrink-0">{formatBytes(attachment.size)}</span>
                          </span>
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 size-2 shrink-0 rounded-full",
                            attachment.active ? "bg-emerald-500" : "bg-muted-foreground/35",
                          )}
                          title={attachment.active ? "Ativo" : "Inativo"}
                        />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="min-h-0 min-w-0 overflow-x-hidden p-4 md:overflow-y-auto sm:p-5">
              {selected ? (
                <div className="space-y-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="min-w-0 max-w-full flex-1 truncate text-sm font-semibold" title={selected.name}>{selected.name}</h3>
                        <span className={cn(
                          "rounded-full px-2 py-0.5 text-[0.62rem] font-medium",
                          selected.active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground",
                        )}>
                          {selected.active ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                      <p className="mt-1 max-w-full break-words text-xs leading-relaxed text-muted-foreground">
                        {kindLabel(selected.kind)} · {formatBytes(selected.size)} · enviado em {formatDate(selected.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {downloadHref && (
                        <a
                          href={downloadHref}
                          download={selected.name}
                          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium transition-colors hover:bg-muted"
                        >
                          <Download className="size-3.5" />
                          Baixar
                        </a>
                      )}
                      <Button
                        type="button"
                        size="lg"
                        variant={selected.active ? "outline" : "default"}
                        onClick={() => {
                          if (statusSavingId) return
                          setStatusSavingId(selected.id)
                          void Promise.resolve(onSetActive(selected.id, !selected.active)).finally(() => setStatusSavingId(null))
                        }}
                        loading={statusSavingId === selected.id}
                        loadingText={selected.active ? "Inativando..." : "Reativando..."}
                        className="gap-1.5"
                      >
                        {selected.active ? <CircleOff className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                        {selected.active ? "Marcar inativo" : "Reativar"}
                      </Button>
                    </div>
                  </div>

                  {previewLoadingId === selected.id ? (
                    <div className="flex min-h-72 items-center justify-center rounded-xl border border-border bg-muted/20">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Carregando pré-visualização...
                      </div>
                    </div>
                  ) : (
                    <AttachmentPreview attachment={selected} />
                  )}

                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-[0.68rem] text-muted-foreground">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>Enviado por <strong className="font-medium text-foreground/80"><MemberName member={members.find((member) => member.id === selected.uploadedBy)} fallback="Usuário" /></strong></span>
                      <span>Estado atual: <strong className="font-medium text-foreground/80">{selected.active ? "Ativo" : "Inativo"}</strong></span>
                      {selected.statusChangedAt && (
                        <span>
                          Última alteração por <strong className="font-medium text-foreground/80"><MemberName member={members.find((member) => member.id === selected.statusChangedBy)} fallback="Usuário" /></strong> · {formatDate(selected.statusChangedAt)}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5">O histórico é preservado: não existe ação de exclusão para anexos.</p>
                  </div>
                </div>
              ) : (
                <div className="flex min-h-72 items-center justify-center text-center text-sm text-muted-foreground">
                  Selecione um arquivo para visualizar os detalhes.
                </div>
              )}
            </div>
          </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
