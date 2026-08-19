"use client"

import * as React from "react"
import {
  ChevronLeft,
  ChevronRight,
  FileArchive,
  FileCode2,
  FileText,
  Film,
  Image as ImageIcon,
  Music2,
  Paperclip,
  Send,
  Trash2,
} from "lucide-react"
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

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function fileExtension(name: string) {
  return name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : ""
}

function isTextFile(file: File) {
  const ext = fileExtension(file.name)
  return file.type.startsWith("text/") || ["sql", "txt", "md", "json", "xml", "yaml", "yml", "csv", "log", "ts", "tsx", "js", "jsx", "css", "scss", "html", "dart", "pas", "kt", "java", "py", "sh", "ps1"].includes(ext)
}

function fileIcon(file: File) {
  if (file.type.startsWith("image/")) return ImageIcon
  if (file.type.startsWith("video/")) return Film
  if (file.type.startsWith("audio/")) return Music2
  if (isTextFile(file)) return FileCode2
  if (["zip", "rar", "7z", "tar", "gz"].includes(fileExtension(file.name))) return FileArchive
  return FileText
}

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = React.useState<string | null>(null)
  const [text, setText] = React.useState<string | null>(null)
  const [textFailed, setTextFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    const nextUrl = URL.createObjectURL(file)
    setUrl(nextUrl)
    setText(null)
    setTextFailed(false)

    if (isTextFile(file) && file.size <= 1024 * 1024) {
      void file.text().then((value) => {
        if (!cancelled) setText(value.slice(0, 30000))
      }).catch(() => {
        if (!cancelled) setTextFailed(true)
      })
    }

    return () => {
      cancelled = true
      URL.revokeObjectURL(nextUrl)
    }
  }, [file])

  if (file.type.startsWith("image/") && url) {
    return <img src={url} alt={file.name} className="h-full max-h-[52vh] w-full object-contain" />
  }
  if (file.type.startsWith("video/") && url) {
    return <video src={url} controls playsInline className="h-full max-h-[52vh] w-full object-contain" />
  }
  if (file.type.startsWith("audio/") && url) {
    return (
      <div className="flex h-full min-h-56 flex-col items-center justify-center gap-4 p-6">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Music2 className="size-7" /></span>
        <audio src={url} controls preload="metadata" className="w-full max-w-md" />
      </div>
    )
  }
  if (file.type === "application/pdf" && url) {
    return <iframe title={file.name} src={url} className="h-[52vh] w-full rounded-xl bg-white" />
  }
  if (isTextFile(file)) {
    return (
      <div className="h-full max-h-[52vh] min-h-64 overflow-auto rounded-xl bg-background p-4 ring-1 ring-foreground/8">
        {textFailed ? (
          <p className="text-sm text-muted-foreground">Não foi possível gerar o preview deste arquivo.</p>
        ) : text === null ? (
          <p className="text-sm text-muted-foreground">Carregando preview...</p>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">{text || "Arquivo vazio"}</pre>
        )}
      </div>
    )
  }

  const Icon = fileIcon(file)
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-6 text-center">
      <span className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><Icon className="size-7" /></span>
      <div className="max-w-md">
        <p className="break-all text-sm font-medium">{file.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{file.type || "Arquivo"} · {formatBytes(file.size)}</p>
      </div>
    </div>
  )
}

export function ChatAttachmentPreviewDialog({
  files,
  open,
  sending,
  onOpenChange,
  onFilesChange,
  onSend,
}: {
  files: File[]
  open: boolean
  sending: boolean
  onOpenChange: (open: boolean) => void
  onFilesChange: (files: File[]) => void
  onSend: (caption: string) => Promise<void>
}) {
  const [activeIndex, setActiveIndex] = React.useState(0)
  const [caption, setCaption] = React.useState("")
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    setActiveIndex((current) => Math.max(0, Math.min(current, files.length - 1)))
  }, [files.length])

  React.useEffect(() => {
    if (!open) {
      setActiveIndex(0)
      setCaption("")
    }
  }, [open])

  const active = files[activeIndex]

  function appendFiles(next: FileList | null) {
    if (!next?.length) return
    const incoming = Array.from(next)
    onFilesChange([...files, ...incoming])
    setActiveIndex(files.length)
  }

  function removeActive() {
    if (!active) return
    const next = files.filter((_, index) => index !== activeIndex)
    onFilesChange(next)
    if (!next.length) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="flex max-h-[92dvh] w-[min(94vw,900px)] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] flex-col gap-3 overflow-hidden p-3 sm:p-4" showCloseButton={!sending}>
        <DialogHeader className="pr-8">
          <DialogTitle>Enviar arquivos</DialogTitle>
          <DialogDescription>Revise o conteúdo antes de enviar. Nada é salvo antes da confirmação.</DialogDescription>
        </DialogHeader>

        {active ? (
          <div className="grid min-h-0 gap-3 md:grid-cols-[minmax(0,1fr)_190px]">
            <div className="relative min-h-0 overflow-hidden rounded-2xl bg-muted/25 ring-1 ring-foreground/8">
              <FilePreview file={active} />
              {files.length > 1 && (
                <>
                  <Button type="button" size="icon" variant="secondary" className="absolute left-2 top-1/2 -translate-y-1/2" onClick={() => setActiveIndex((activeIndex - 1 + files.length) % files.length)}>
                    <ChevronLeft className="size-4" /><span className="sr-only">Anterior</span>
                  </Button>
                  <Button type="button" size="icon" variant="secondary" className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setActiveIndex((activeIndex + 1) % files.length)}>
                    <ChevronRight className="size-4" /><span className="sr-only">Próximo</span>
                  </Button>
                </>
              )}
            </div>

            <aside className="min-h-0 overflow-y-auto rounded-2xl bg-muted/20 p-2 ring-1 ring-foreground/8">
              <div className="space-y-1.5">
                {files.map((file, index) => {
                  const Icon = fileIcon(file)
                  return (
                    <button
                      type="button"
                      key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                      onClick={() => setActiveIndex(index)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-xl p-2 text-left transition-colors",
                        index === activeIndex ? "bg-card ring-1 ring-primary/25" : "hover:bg-card/70",
                      )}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"><Icon className="size-3.5" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.68rem] font-medium">{file.name}</span>
                        <span className="block text-[0.58rem] text-muted-foreground">{formatBytes(file.size)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2 w-full gap-1.5" onClick={() => inputRef.current?.click()} disabled={sending}>
                <Paperclip className="size-3.5" /> Adicionar
              </Button>
              <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => { appendFiles(event.target.files); event.currentTarget.value = "" }} />
            </aside>

            <div className="md:col-span-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="truncate font-medium">{active.name}</p>
                  <p className="text-[0.62rem] text-muted-foreground">{formatBytes(active.size)} · {active.type || "tipo não informado"}</p>
                </div>
                <Button type="button" variant="ghost" size="icon-sm" onClick={removeActive} disabled={sending} className="text-destructive hover:text-destructive">
                  <Trash2 className="size-3.5" /><span className="sr-only">Remover do envio</span>
                </Button>
              </div>
              <textarea
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                rows={2}
                maxLength={1200}
                disabled={sending}
                placeholder="Adicionar legenda..."
                className="mt-2 min-h-10 w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>
        ) : (
          <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Nenhum arquivo selecionado.</div>
        )}

        <DialogFooter className="-mx-3 -mb-3 px-3 sm:-mx-4 sm:-mb-4 sm:px-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>Cancelar</Button>
          <Button type="button" onClick={() => void onSend(caption)} disabled={!files.length} loading={sending} loadingText="Enviando..." className="gap-1.5">
            <Send className="size-4" /> Enviar {files.length > 1 ? `${files.length} arquivos` : "arquivo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
