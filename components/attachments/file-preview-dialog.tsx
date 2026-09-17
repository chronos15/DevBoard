"use client"

import * as React from "react"
import {
  Download,
  ExternalLink,
  FileAudio,
  FileCode2,
  FileIcon,
  FileText,
  FileVideo,
  LoaderCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { inferAttachmentKind } from "@/lib/attachment-preview"
import { ZoomableVideoStage } from "@/components/media/video-viewer-dialog"
import type { AttachmentKind } from "@/lib/types"

const MAX_TEXT_PREVIEW_CHARS = 120_000

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

function PreviewIcon({ kind }: { kind: AttachmentKind }) {
  if (kind === "video") return <FileVideo className="size-9" />
  if (kind === "audio") return <FileAudio className="size-9" />
  if (kind === "text") return <FileCode2 className="size-9" />
  if (kind === "pdf" || kind === "document") return <FileText className="size-9" />
  return <FileIcon className="size-9" />
}

export function FilePreviewDialog({
  open,
  onOpenChange,
  name,
  mimeType,
  size,
  kind,
  sourceUrl,
  bucket,
  storagePath,
  textContent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  mimeType?: string
  size?: number
  kind?: AttachmentKind
  sourceUrl?: string | null
  bucket?: string
  storagePath?: string
  textContent?: string
}) {
  const supabase = React.useMemo(() => createClient(), [])
  const effectiveKind = React.useMemo(
    () => inferAttachmentKind({ name, mimeType, kind }),
    [kind, mimeType, name],
  )
  const [resolvedUrl, setResolvedUrl] = React.useState<string | null>(sourceUrl ?? null)
  const [loadingUrl, setLoadingUrl] = React.useState(false)
  const [textPreview, setTextPreview] = React.useState<string | null>(textContent ?? null)
  const [textTruncated, setTextTruncated] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [downloading, setDownloading] = React.useState(false)
  const pendingUrlRef = React.useRef<Promise<string | null> | null>(null)

  React.useEffect(() => {
    setResolvedUrl(sourceUrl ?? null)
    setTextPreview(textContent ?? null)
    setTextTruncated(false)
    setPreviewError(null)
    pendingUrlRef.current = null
  }, [sourceUrl, storagePath, textContent])

  const ensureUrl = React.useCallback(async () => {
    if (resolvedUrl) return resolvedUrl
    if (sourceUrl) {
      setResolvedUrl(sourceUrl)
      return sourceUrl
    }
    if (pendingUrlRef.current) return pendingUrlRef.current
    if (!bucket || !storagePath) return null

    setLoadingUrl(true)
    setPreviewError(null)
    const request = supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 60)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          setPreviewError("Não foi possível abrir este arquivo agora.")
          return null
        }
        setResolvedUrl(data.signedUrl)
        return data.signedUrl
      })
      .finally(() => {
        setLoadingUrl(false)
        pendingUrlRef.current = null
      })
    pendingUrlRef.current = request
    return request
  }, [bucket, resolvedUrl, sourceUrl, storagePath, supabase])

  React.useEffect(() => {
    if (!open) return
    if (effectiveKind === "text" && textContent !== undefined) return
    if (effectiveKind === "other" && !bucket && !storagePath && !sourceUrl) return
    void ensureUrl()
  }, [effectiveKind, ensureUrl, open, sourceUrl, storagePath, textContent, bucket])

  React.useEffect(() => {
    if (!open || effectiveKind !== "text" || textContent !== undefined || textPreview !== null) return
    let cancelled = false
    void ensureUrl().then(async (url) => {
      if (!url || cancelled) return
      try {
        const response = await fetch(url)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const value = await response.text()
        if (cancelled) return
        setTextTruncated(value.length > MAX_TEXT_PREVIEW_CHARS)
        setTextPreview(value.slice(0, MAX_TEXT_PREVIEW_CHARS))
      } catch {
        if (!cancelled) setPreviewError("Não foi possível gerar o preview textual. O download continua disponível.")
      }
    })
    return () => { cancelled = true }
  }, [effectiveKind, ensureUrl, open, textContent, textPreview])

  async function downloadFile() {
    if (downloading) return
    setDownloading(true)
    try {
      let blob: Blob | null = null
      if (textContent !== undefined) {
        blob = new Blob([textContent], { type: mimeType || "text/plain;charset=utf-8" })
      } else {
        const url = await ensureUrl()
        if (url) {
          try {
            const response = await fetch(url)
            if (response.ok) blob = await response.blob()
          } catch {
            // Fallback abaixo abre a URL assinada em uma nova aba.
          }
          if (!blob) {
            window.open(url, "_blank", "noopener,noreferrer")
            return
          }
        }
      }
      if (!blob) return
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = name || "arquivo"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
    } finally {
      setDownloading(false)
    }
  }

  async function openExternal() {
    const url = await ensureUrl()
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  const info = [mimeType || undefined, formatBytes(size)].filter(Boolean).join(" · ")
  const canDownload = textContent !== undefined || Boolean(sourceUrl || (bucket && storagePath))
  const canOpenExternal = Boolean(sourceUrl || (bucket && storagePath))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[min(95vw,980px)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className="break-all text-base">{name}</DialogTitle>
          {info && <p className="mt-1 text-xs text-muted-foreground">{info}</p>}
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/15 p-3 sm:p-5">
          {effectiveKind === "text" ? (
            <div className="min-h-72 rounded-xl border border-border bg-sidebar p-4 sm:p-5">
              {textPreview !== null ? (
                <>
                  <pre className="overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-sidebar-foreground selection:bg-primary/25">
                    <code>{textPreview || "Arquivo vazio"}</code>
                  </pre>
                  {textTruncated && (
                    <p className="mt-4 border-t border-sidebar-border pt-3 text-[0.68rem] text-muted-foreground">
                      Preview limitado para manter a interface rápida. Baixe o arquivo para visualizar o conteúdo completo.
                    </p>
                  )}
                </>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
                  {loadingUrl && !previewError ? <LoaderCircle className="size-6 animate-spin" /> : <FileCode2 className="size-8 opacity-55" />}
                  <p className="text-sm">{previewError || "Carregando preview..."}</p>
                </div>
              )}
            </div>
          ) : effectiveKind === "pdf" && resolvedUrl ? (
            <iframe title={name} src={resolvedUrl} className="h-[64dvh] min-h-96 w-full rounded-xl border border-border bg-white" />
          ) : effectiveKind === "video" && resolvedUrl ? (
            <ZoomableVideoStage
              src={resolvedUrl}
              className="h-[64dvh] min-h-72 rounded-xl border border-border"
            />
          ) : effectiveKind === "audio" && resolvedUrl ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-5 rounded-xl border border-border bg-card p-6">
              <FileAudio className="size-10 text-muted-foreground/55" />
              <audio src={resolvedUrl} controls className="w-full max-w-xl" />
            </div>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
              {loadingUrl ? <LoaderCircle className="size-8 animate-spin text-muted-foreground" /> : <PreviewIcon kind={effectiveKind} />}
              <p className="mt-4 text-sm font-semibold">{loadingUrl ? "Preparando arquivo..." : "Pré-visualização não disponível"}</p>
              <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                {previewError || "Este formato não possui visualizador nativo no TaskBoard. Você ainda pode abrir ou baixar o arquivo."}
              </p>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border bg-card px-4 py-3">
          {canOpenExternal && (
            <Button type="button" variant="outline" onClick={() => void openExternal()} disabled={loadingUrl}>
              <ExternalLink className="size-4" /> Abrir
            </Button>
          )}
          {canDownload && (
            <Button type="button" onClick={() => void downloadFile()} loading={downloading}>
              <Download className="size-4" /> Baixar
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
