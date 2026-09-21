"use client"

import * as React from "react"
import { Check, ChevronDown, ChevronUp, Copy, Download, ExternalLink, FileCode2, LoaderCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"

const MAX_TEXT_PREVIEW_CHARS = 120_000

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

export function InlineTextAttachment({
  attachmentId,
  name,
  mimeType,
  size,
  sourceUrl,
  bucket,
  storagePath,
  textContent,
  className,
  compact = false,
}: {
  attachmentId?: string
  name: string
  mimeType?: string
  size?: number
  sourceUrl?: string | null
  bucket?: string
  storagePath?: string
  textContent?: string
  className?: string
  compact?: boolean
}) {
  const supabase = React.useMemo(() => createClient(), [])
  const [resolvedUrl, setResolvedUrl] = React.useState<string | null>(sourceUrl ?? null)
  const [text, setText] = React.useState<string | null>(textContent ?? null)
  const [truncated, setTruncated] = React.useState(false)
  const [loading, setLoading] = React.useState(textContent === undefined)
  const [error, setError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const pendingUrlRef = React.useRef<Promise<string | null> | null>(null)
  const pendingDatabaseTextRef = React.useRef<Promise<string | null> | null>(null)

  React.useEffect(() => {
    setResolvedUrl(sourceUrl ?? null)
    setText(textContent ?? null)
    setTruncated(false)
    setLoading(textContent === undefined)
    setError(null)
    setExpanded(false)
    pendingUrlRef.current = null
    pendingDatabaseTextRef.current = null
  }, [attachmentId, sourceUrl, storagePath, textContent, name])

  const ensureUrl = React.useCallback(async () => {
    if (resolvedUrl) return resolvedUrl
    if (sourceUrl) {
      setResolvedUrl(sourceUrl)
      return sourceUrl
    }
    if (pendingUrlRef.current) return pendingUrlRef.current
    if (!bucket || !storagePath) return null

    const request = supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 60)
      .then(({ data, error: signedError }) => {
        if (signedError || !data?.signedUrl) return null
        setResolvedUrl(data.signedUrl)
        return data.signedUrl
      })
      .finally(() => {
        pendingUrlRef.current = null
      })

    pendingUrlRef.current = request
    return request
  }, [bucket, resolvedUrl, sourceUrl, storagePath, supabase])

  const loadDatabaseText = React.useCallback(async () => {
    if (!attachmentId) return null
    if (pendingDatabaseTextRef.current) return pendingDatabaseTextRef.current

    const request = supabase
      .from("attachments")
      .select("text_content")
      .eq("id", attachmentId)
      .maybeSingle()
      .then(({ data, error: textError }) => {
        if (textError || typeof data?.text_content !== "string") return null
        return data.text_content
      })
      .finally(() => {
        pendingDatabaseTextRef.current = null
      })

    pendingDatabaseTextRef.current = request
    return request
  }, [attachmentId, supabase])

  React.useEffect(() => {
    if (textContent !== undefined) {
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void ensureUrl().then(async (url) => {
      if (cancelled) return
      try {
        let value: string | null = null
        if (url) {
          try {
            const response = await fetch(url)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            value = await response.text()
          } catch {
            // Anexos textuais antigos do Acompanhamento/AQS podem ter o
            // conteúdo salvo diretamente no banco. Também serve como fallback
            // caso o Storage esteja temporariamente indisponível.
            value = await loadDatabaseText()
          }
        } else {
          value = await loadDatabaseText()
        }
        if (value === null) throw new Error("Conteúdo textual indisponível")
        if (cancelled) return
        setTruncated(value.length > MAX_TEXT_PREVIEW_CHARS)
        setText(value.slice(0, MAX_TEXT_PREVIEW_CHARS))
      } catch {
        if (!cancelled) setError("Não foi possível carregar o conteúdo deste arquivo agora.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [ensureUrl, loadDatabaseText, textContent])

  async function copyText() {
    if (text === null) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard pode ser bloqueado pelo navegador; não afeta o preview.
    }
  }

  async function openExternal() {
    const url = await ensureUrl()
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

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
            // Fallback abaixo tenta o conteúdo persistido antes de abrir a URL.
          }
          if (!blob) {
            const databaseText = await loadDatabaseText()
            if (databaseText !== null) blob = new Blob([databaseText], { type: mimeType || "text/plain;charset=utf-8" })
            else {
              window.open(url, "_blank", "noopener,noreferrer")
              return
            }
          }
        } else {
          const databaseText = await loadDatabaseText()
          if (databaseText !== null) blob = new Blob([databaseText], { type: mimeType || "text/plain;charset=utf-8" })
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

  const canOpen = Boolean(sourceUrl || (bucket && storagePath))
  const canDownload = textContent !== undefined || Boolean(attachmentId) || canOpen
  const info = formatBytes(size)
  const previewMaxHeight = compact ? "max-h-52" : "max-h-72"

  return (
    <div className={cn("mt-2 w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card", className)}>
      <div
        className={cn(
          "relative overflow-auto bg-muted/20",
          expanded ? "max-h-[70dvh]" : previewMaxHeight,
          loading || error ? "min-h-28" : "",
        )}
      >
        {loading ? (
          <div className="flex min-h-28 items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            <span>Carregando conteúdo...</span>
          </div>
        ) : text !== null ? (
          <pre className="min-w-0 whitespace-pre-wrap break-words px-4 py-3 font-mono text-[0.72rem] leading-relaxed text-foreground selection:bg-primary/20">
            <code>{text || "Arquivo vazio"}</code>
          </pre>
        ) : (
          <div className="flex min-h-28 items-center justify-center px-4 text-center text-xs text-muted-foreground">
            {error || "Preview indisponível."}
          </div>
        )}

        {!expanded && text !== null && (text.length > 1200 || truncated) && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card/95 to-transparent" />
        )}
      </div>

      <div className="flex min-w-0 items-center gap-2 border-t border-border bg-card px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          title={expanded ? "Recolher preview" : "Expandir preview"}
          aria-label={expanded ? "Recolher preview" : "Expandir preview"}
        >
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>

        <FileCode2 className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium" title={name}>{name}</p>
          {info && <p className="mt-0.5 text-[0.62rem] text-muted-foreground">{info}{truncated ? " · preview limitado" : ""}</p>}
        </div>

        {text !== null && (
          <button
            type="button"
            onClick={() => void copyText()}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Copiar conteúdo"
            aria-label="Copiar conteúdo"
          >
            {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          </button>
        )}

        {canOpen && (
          <button
            type="button"
            onClick={() => void openExternal()}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Abrir em nova aba"
            aria-label="Abrir em nova aba"
          >
            <ExternalLink className="size-4" />
          </button>
        )}

        {canDownload && (
          <button
            type="button"
            onClick={() => void downloadFile()}
            disabled={downloading}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            title="Baixar arquivo"
            aria-label="Baixar arquivo"
          >
            {downloading ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
          </button>
        )}
      </div>
    </div>
  )
}
