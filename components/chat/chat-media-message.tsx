"use client"

import * as React from "react"
import { Download, ExternalLink, FileCode2, FileText, Film, Image as ImageIcon, Loader2, Music2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { CHAT_MEDIA_BUCKET } from "@/lib/supabase/helpers"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { AttachmentKind } from "@/lib/types"

function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return ""
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function KindIcon({ kind }: { kind?: AttachmentKind }) {
  if (kind === "image") return <ImageIcon className="size-5" />
  if (kind === "video") return <Film className="size-5" />
  if (kind === "audio") return <Music2 className="size-5" />
  if (kind === "text") return <FileCode2 className="size-5" />
  return <FileText className="size-5" />
}

export function ChatMediaMessage({
  storagePath,
  name,
  mimeType,
  sizeBytes,
  kind,
  caption,
}: {
  storagePath?: string
  name?: string
  mimeType?: string
  sizeBytes?: number
  kind?: AttachmentKind
  caption?: string
}) {
  const supabase = React.useMemo(() => createClient(), [])
  const [url, setUrl] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [textPreview, setTextPreview] = React.useState<string | null>(null)

  const ensureUrl = React.useCallback(async () => {
    if (url) return url
    if (!storagePath) {
      setFailed(true)
      return null
    }
    const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(storagePath, 60 * 60)
    if (error || !data?.signedUrl) {
      setFailed(true)
      return null
    }
    setUrl(data.signedUrl)
    return data.signedUrl
  }, [storagePath, supabase, url])

  React.useEffect(() => {
    if (kind === "image" || kind === "video") void ensureUrl()
  }, [ensureUrl, kind])

  async function openPreview() {
    const signedUrl = await ensureUrl()
    if (!signedUrl) return
    if (kind === "text" && textPreview === null) {
      try {
        const response = await fetch(signedUrl)
        const text = await response.text()
        setTextPreview(text.slice(0, 50000))
      } catch {
        setTextPreview("Não foi possível carregar o conteúdo textual.")
      }
    }
    setOpen(true)
  }

  const fileName = name || "Arquivo"
  const info = [mimeType || "Arquivo", formatBytes(sizeBytes)].filter(Boolean).join(" · ")

  if (kind === "image" && url) {
    return (
      <>
        <button type="button" className="block max-w-sm overflow-hidden rounded-xl text-left" onClick={() => void openPreview()}>
          <img src={url} alt={fileName} className="max-h-72 w-full object-contain" />
          {caption && <span className="block px-1 pt-2 text-sm whitespace-pre-wrap break-words">{caption}</span>}
        </button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="w-[min(96vw,1100px)] max-w-none bg-black/95 p-2" showCloseButton>
            <DialogHeader className="sr-only"><DialogTitle>{fileName}</DialogTitle></DialogHeader>
            <img src={url} alt={fileName} className="max-h-[86dvh] w-full object-contain" />
          </DialogContent>
        </Dialog>
      </>
    )
  }

  if (kind === "video" && url) {
    return (
      <div className="max-w-md">
        <video src={url} controls playsInline preload="metadata" className="max-h-72 w-full rounded-xl object-contain" />
        {caption && <p className="mt-2 whitespace-pre-wrap break-words">{caption}</p>}
      </div>
    )
  }

  if (failed) {
    return <div className="flex min-w-48 items-center gap-2 py-1 text-xs opacity-80"><KindIcon kind={kind} /><span>Arquivo indisponível</span></div>
  }

  return (
    <>
      <button type="button" onClick={() => void openPreview()} className="flex min-w-56 max-w-sm items-center gap-3 rounded-xl bg-background/15 p-2.5 text-left ring-1 ring-current/10">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-background/20"><KindIcon kind={kind} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{fileName}</span>
          <span className="mt-0.5 block truncate text-[0.6rem] opacity-70">{info || "Abrir arquivo"}</span>
          {caption && <span className="mt-1 block line-clamp-2 text-xs">{caption}</span>}
        </span>
        {!url && <Loader2 className="size-3.5 shrink-0 animate-spin opacity-50" />}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[min(94vw,900px)] max-w-none">
          <DialogHeader>
            <DialogTitle className="break-all">{fileName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-48 max-h-[66dvh] overflow-auto rounded-xl bg-muted/30 p-3 ring-1 ring-foreground/8">
            {kind === "audio" && url ? (
              <audio controls src={url} className="w-full" />
            ) : mimeType === "application/pdf" && url ? (
              <iframe title={fileName} src={url} className="h-[58dvh] w-full rounded-lg bg-white" />
            ) : kind === "text" ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{textPreview ?? "Carregando..."}</pre>
            ) : (
              <div className="flex min-h-44 flex-col items-center justify-center gap-3 text-center">
                <KindIcon kind={kind} />
                <p className="max-w-md break-all text-sm">{fileName}</p>
                <p className="text-xs text-muted-foreground">{info}</p>
              </div>
            )}
          </div>
          {caption && <p className="whitespace-pre-wrap break-words text-sm">{caption}</p>}
          <div className="flex justify-end gap-2">
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted">
                <ExternalLink className="size-4" /> Abrir
              </a>
            )}
            {url && (
              <a href={url} download={fileName} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-85">
                <Download className="size-4" /> Baixar
              </a>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
