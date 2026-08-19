"use client"

import * as React from "react"
import { Download, ExternalLink, FileCode2, FileText, Film, Image as ImageIcon, Loader2, Music2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { CHAT_MEDIA_BUCKET } from "@/lib/supabase/helpers"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { AttachmentKind } from "@/lib/types"
import { useChatMediaActivation } from "@/components/chat/use-chat-media-activation"

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
  const [loadingUrl, setLoadingUrl] = React.useState(false)
  const [mediaReady, setMediaReady] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [textPreview, setTextPreview] = React.useState<string | null>(null)
  const urlRef = React.useRef<string | null>(null)
  const pendingUrlRef = React.useRef<Promise<string | null> | null>(null)
  const mountedRef = React.useRef(true)
  const isVisualMedia = kind === "image" || kind === "video"
  const { targetRef, activated, activate } = useChatMediaActivation<HTMLDivElement>({ enabled: isVisualMedia })

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    urlRef.current = url
  }, [url])

  React.useEffect(() => {
    urlRef.current = null
    pendingUrlRef.current = null
    setUrl(null)
    setFailed(false)
    setLoadingUrl(false)
    setMediaReady(false)
    setTextPreview(null)
  }, [storagePath])

  const ensureUrl = React.useCallback(async () => {
    if (urlRef.current) return urlRef.current
    if (pendingUrlRef.current) return pendingUrlRef.current
    if (!storagePath) {
      if (mountedRef.current) setFailed(true)
      return null
    }

    if (mountedRef.current) {
      setLoadingUrl(true)
      setFailed(false)
    }

    const request = (async () => {
      const { data, error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(storagePath, 60 * 60)
      if (error || !data?.signedUrl) {
        if (mountedRef.current) setFailed(true)
        return null
      }
      if (mountedRef.current) {
        urlRef.current = data.signedUrl
        setUrl(data.signedUrl)
      }
      return data.signedUrl
    })().finally(() => {
      pendingUrlRef.current = null
      if (mountedRef.current) setLoadingUrl(false)
    })

    pendingUrlRef.current = request
    return request
  }, [storagePath, supabase])

  React.useEffect(() => {
    if (!isVisualMedia || !activated) return
    void ensureUrl()
  }, [activated, ensureUrl, isVisualMedia])

  async function openPreview() {
    activate()
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

  if (kind === "image") {
    return (
      <>
        <div ref={targetRef} className="w-[clamp(11rem,58vw,18rem)] max-w-full">
          <button type="button" className="block w-full text-left" onClick={() => void openPreview()}>
            <span className="relative block aspect-[4/3] w-full overflow-hidden rounded-xl bg-background/20 ring-1 ring-current/10">
              {url && (
                <img
                  src={url}
                  alt={fileName}
                  loading="lazy"
                  decoding="async"
                  onLoad={() => setMediaReady(true)}
                  onError={() => {
                    setMediaReady(false)
                    setFailed(true)
                  }}
                  className={cn(
                    "absolute inset-0 h-full w-full object-contain transition-opacity duration-200",
                    mediaReady ? "opacity-100" : "opacity-0",
                  )}
                />
              )}

              {!mediaReady && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-[0.68rem] opacity-75">
                  {failed ? <ImageIcon className="size-6" /> : loadingUrl || activated ? <Loader2 className="size-5 animate-spin" /> : <ImageIcon className="size-6" />}
                  <span>{failed ? "Imagem indisponível" : loadingUrl || activated ? "Carregando imagem..." : "Imagem"}</span>
                </span>
              )}
            </span>
            {caption && <span className="block px-1 pt-2 text-sm whitespace-pre-wrap break-words">{caption}</span>}
          </button>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="w-[min(96vw,1100px)] max-w-none bg-black/95 p-2" showCloseButton>
            <DialogHeader className="sr-only"><DialogTitle>{fileName}</DialogTitle></DialogHeader>
            {url && <img src={url} alt={fileName} className="max-h-[86dvh] w-full object-contain" />}
          </DialogContent>
        </Dialog>
      </>
    )
  }

  if (kind === "video") {
    return (
      <div ref={targetRef} className="w-[clamp(13rem,62vw,22rem)] max-w-full">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-background/20 ring-1 ring-current/10">
          {url && (
            <video
              src={url}
              controls
              playsInline
              preload="metadata"
              onLoadedMetadata={() => setMediaReady(true)}
              onError={() => {
                setMediaReady(false)
                setFailed(true)
              }}
              className={cn(
                "absolute inset-0 h-full w-full object-contain transition-opacity duration-200",
                mediaReady ? "opacity-100" : "opacity-0",
              )}
            />
          )}

          {!mediaReady && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-[0.68rem] opacity-75">
              {failed ? <Film className="size-6" /> : loadingUrl || activated ? <Loader2 className="size-5 animate-spin" /> : <Film className="size-6" />}
              <span>{failed ? "Vídeo indisponível" : loadingUrl || activated ? "Carregando vídeo..." : "Vídeo"}</span>
            </div>
          )}
        </div>
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
        {loadingUrl && <Loader2 className="size-3.5 shrink-0 animate-spin opacity-50" />}
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
