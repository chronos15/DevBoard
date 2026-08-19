"use client"

import * as React from "react"
import {
  FileArchive,
  FileCode2,
  FileText,
  Film,
  Image as ImageIcon,
  Music2,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
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
    return <img src={url} alt={file.name} className="h-full max-h-[62dvh] w-full object-contain" />
  }

  if (file.type.startsWith("video/") && url) {
    return <video src={url} controls playsInline className="h-full max-h-[62dvh] w-full object-contain" />
  }

  if (file.type.startsWith("audio/") && url) {
    return (
      <div className="flex min-h-[42dvh] w-full flex-col items-center justify-center gap-4 px-6">
        <span className="flex size-20 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Music2 className="size-8" />
        </span>
        <audio src={url} controls preload="metadata" className="w-full max-w-xl" />
      </div>
    )
  }

  if (file.type === "application/pdf" && url) {
    return <iframe title={file.name} src={url} className="h-[62dvh] w-full rounded-xl bg-white" />
  }

  if (isTextFile(file)) {
    return (
      <div className="h-[min(62dvh,640px)] w-full max-w-4xl overflow-auto rounded-xl bg-background p-4 ring-1 ring-foreground/8 sm:p-6">
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
    <div className="flex min-h-[42dvh] w-full flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-20 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Icon className="size-9" />
      </span>
      <div className="max-w-lg">
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
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(94dvh,820px)] w-[min(96vw,1180px)] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3 sm:px-4">
          <Button type="button" variant="ghost" size="icon" onClick={() => onOpenChange(false)} disabled={sending}>
            <X className="size-5" />
            <span className="sr-only">Fechar preview</span>
          </Button>
          {active && (
            <div className="min-w-0 px-3 text-center">
              <p className="max-w-[50vw] truncate text-xs font-medium">{active.name}</p>
              <p className="text-[0.6rem] text-muted-foreground">{formatBytes(active.size)}</p>
            </div>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={removeActive}
            disabled={!active || sending}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-4" />
            <span className="sr-only">Remover arquivo</span>
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/15 p-3 sm:p-5">
          {active ? <FilePreview file={active} /> : <p className="text-sm text-muted-foreground">Nenhum arquivo selecionado.</p>}
        </div>

        <div className="shrink-0 border-t border-border bg-card px-3 py-3 sm:px-4">
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <input
              value={caption}
              onChange={(event) => setCaption(event.target.value)}
              maxLength={1200}
              disabled={sending}
              placeholder="Adicionar legenda..."
              className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary/40 focus:ring-2 focus:ring-primary/10"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && files.length && !sending) {
                  event.preventDefault()
                  void onSend(caption)
                }
              }}
            />
            <Button
              type="button"
              size="icon-lg"
              className="shrink-0 rounded-full"
              onClick={() => void onSend(caption)}
              disabled={!files.length}
              loading={sending}
              title="Enviar"
            >
              <Send className="size-4 fill-current" />
              <span className="sr-only">Enviar arquivos</span>
            </Button>
          </div>

          <div className="mx-auto mt-3 flex max-w-3xl items-center gap-2 overflow-x-auto pb-1">
            {files.map((file, index) => {
              const Icon = fileIcon(file)
              const image = file.type.startsWith("image/")
              return (
                <PreviewThumb
                  key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                  file={file}
                  active={index === activeIndex}
                  image={image}
                  Icon={Icon}
                  onClick={() => setActiveIndex(index)}
                />
              )
            })}
            <Button
              type="button"
              variant="outline"
              className="size-14 shrink-0 rounded-xl p-0"
              onClick={() => inputRef.current?.click()}
              disabled={sending}
              title="Adicionar mais arquivos"
            >
              <Plus className="size-5" />
              <span className="sr-only">Adicionar mais arquivos</span>
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                appendFiles(event.target.files)
                event.currentTarget.value = ""
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PreviewThumb({
  file,
  active,
  image,
  Icon,
  onClick,
}: {
  file: File
  active: boolean
  image: boolean
  Icon: React.ComponentType<{ className?: string }>
  onClick: () => void
}) {
  const [url, setUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!image) return
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file, image])

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted ring-1 transition-all",
        active ? "ring-2 ring-primary" : "ring-foreground/10 hover:ring-foreground/25",
      )}
      title={file.name}
    >
      {image && url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <Icon className="size-5 text-muted-foreground" />}
    </button>
  )
}
