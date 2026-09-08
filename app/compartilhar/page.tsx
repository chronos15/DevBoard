"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  File as FileIcon,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FolderKanban,
  Layers3,
  Link2,
  LoaderCircle,
  Paperclip,
  RotateCcw,
  Send,
  Share2,
  Smartphone,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import type { AttachmentKind, AttachmentUploadInput, Project } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { DevboardLogo } from "@/components/devboard-logo"
import { cn } from "@/lib/utils"

const SHARE_CACHE = "devboard-share-target-v1"
const SHARE_PREFIX = "/__devboard-share-target__/"
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_BATCH_BYTES = 150 * 1024 * 1024

const textExtensions = new Set([
  "sql", "txt", "md", "json", "xml", "csv", "log", "yaml", "yml", "ini", "env",
  "js", "ts", "tsx", "jsx", "css", "html", "dart", "pas",
])
const documentExtensions = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"])

type DestinationKind = "project" | "activity" | "subactivity"

type SharedFileMetadata = {
  index: number
  name: string
  type: string
  size: number
  lastModified: number
}

type SharedPayload = {
  id: string
  title: string
  text: string
  url: string
  receivedAt: string
  files: SharedFileMetadata[]
}

function shareCacheUrl(path: string) {
  return new URL(path, window.location.origin).toString()
}

async function deleteCachedShare(shareId: string) {
  if (!("caches" in window) || !shareId) return
  const cache = await caches.open(SHARE_CACHE)
  const keys = await cache.keys()
  await Promise.all(keys
    .filter((entry) => entry.url.includes(`${SHARE_PREFIX}${shareId}/`))
    .map((entry) => cache.delete(entry)))
}

async function readCachedShare(shareId: string) {
  if (!("caches" in window)) throw new Error("O armazenamento temporário do PWA não está disponível.")
  const cache = await caches.open(SHARE_CACHE)
  const metadataResponse = await cache.match(shareCacheUrl(`${SHARE_PREFIX}${shareId}/metadata`))
  if (!metadataResponse) throw new Error("O conteúdo compartilhado não está mais disponível.")

  const metadata = await metadataResponse.json() as SharedPayload
  const files = await Promise.all(metadata.files.map(async (item) => {
    const response = await cache.match(shareCacheUrl(`${SHARE_PREFIX}${shareId}/file/${item.index}`))
    if (!response) throw new Error(`Não foi possível recuperar “${item.name}”.`)
    const blob = await response.blob()
    return new File([blob], item.name, {
      type: item.type || blob.type || "application/octet-stream",
      lastModified: item.lastModified || Date.now(),
    })
  }))

  return { metadata, files }
}

function extensionOf(name: string) {
  const index = name.lastIndexOf(".")
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ""
}

function detectKind(file: File): AttachmentKind {
  const extension = extensionOf(file.name)
  const mime = (file.type || "").toLowerCase()
  if (mime.startsWith("image/")) return "image"
  if (mime === "application/pdf" || extension === "pdf") return "pdf"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime.startsWith("text/") || textExtensions.has(extension)) return "text"
  if (documentExtensions.has(extension) || /officedocument|msword|ms-excel|ms-powerpoint/.test(mime)) return "document"
  return "other"
}

async function fileToUpload(file: File): Promise<AttachmentUploadInput> {
  const kind = detectKind(file)
  const base = {
    name: file.name || "arquivo-compartilhado",
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    kind,
  }
  if (kind === "text") return { ...base, textContent: await file.text() }
  return { ...base, file }
}

function textEvidence(payload: Pick<SharedPayload, "title" | "text" | "url">): AttachmentUploadInput | null {
  const parts: string[] = []
  const title = payload.title.trim()
  const text = payload.text.trim()
  const url = payload.url.trim()

  if (title) parts.push(`Título: ${title}`)
  if (text && text !== title && text !== url) parts.push(text)
  if (url && !text.includes(url)) parts.push(`Link: ${url}`)
  if (!parts.length && url) parts.push(url)
  if (!parts.length) return null

  const content = parts.join("\n\n")
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")
  return {
    name: url ? `link-compartilhado-${stamp}.txt` : `texto-compartilhado-${stamp}.txt`,
    mimeType: url ? "text/uri-list" : "text/plain",
    size: new TextEncoder().encode(content).byteLength,
    kind: "text",
    textContent: content,
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function KindIcon({ kind, className }: { kind: AttachmentKind; className?: string }) {
  const Icon = kind === "image"
    ? FileImage
    : kind === "video"
      ? FileVideo
      : kind === "audio"
        ? FileAudio
        : kind === "text"
          ? FileCode2
          : kind === "pdf" || kind === "document"
            ? FileText
            : FileIcon
  return <Icon className={className} />
}

function SharedFilePreview({ file }: { file: File }) {
  const kind = detectKind(file)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (kind !== "image") return
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, kind])

  if (kind === "image" && previewUrl) {
    return <img src={previewUrl} alt="" className="size-12 shrink-0 rounded-xl bg-muted object-cover ring-1 ring-foreground/8" />
  }

  return (
    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground ring-1 ring-foreground/8">
      <KindIcon kind={kind} className="size-5" />
    </span>
  )
}

function projectIsAvailable(project: Project, currentUserId: string, isAdmin: boolean) {
  if (isAdmin) return true
  if (project.memberIds.includes(currentUserId)) return true
  return project.activities.some((activity) =>
    activity.assigneeIds?.includes(currentUserId)
    || activity.subactivities.some((sub) => sub.assigneeId === currentUserId || sub.memberIds?.includes(currentUserId)),
  )
}

function NativeSelect({
  value,
  onChange,
  disabled,
  label,
  placeholder,
  children,
}: {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label: string
  placeholder: string
  children: React.ReactNode
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <span className="relative block">
        <select
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 w-full appearance-none rounded-xl border border-border bg-card px-3 pr-9 text-sm font-medium outline-none transition-colors hover:bg-muted/40 focus:border-primary/40 focus:ring-3 focus:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">{placeholder}</option>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  )
}

export default function ShareToDevboardPage() {
  const router = useRouter()
  const {
    hydrated,
    projects,
    currentUserId,
    currentUserRole,
    addProjectAttachments,
    addActivityAttachments,
    addSubactivityAttachments,
  } = useStore()

  const [loadingShare, setLoadingShare] = React.useState(true)
  const [shareId, setShareId] = React.useState("")
  const [payload, setPayload] = React.useState<SharedPayload | null>(null)
  const [files, setFiles] = React.useState<File[]>([])
  const [includeText, setIncludeText] = React.useState(true)
  const [destination, setDestination] = React.useState<DestinationKind>("subactivity")
  const [projectId, setProjectId] = React.useState("")
  const [activityId, setActivityId] = React.useState("")
  const [subactivityId, setSubactivityId] = React.useState("")
  const [error, setError] = React.useState("")
  const [warning, setWarning] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [success, setSuccess] = React.useState(false)

  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/devboard-sw.js").catch(() => undefined)
    }

    const params = new URLSearchParams(window.location.search)
    const id = params.get("share") || ""
    setShareId(id)

    if (id) {
      void readCachedShare(id)
        .then(({ metadata, files: receivedFiles }) => {
          setPayload(metadata)
          setFiles(receivedFiles)
          setIncludeText(Boolean(textEvidence(metadata)))
        })
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : "Não foi possível recuperar o conteúdo compartilhado.")
        })
        .finally(() => setLoadingShare(false))
      return
    }

    const fallback = params.get("fallback") === "1"
    const title = params.get("title") || ""
    const text = params.get("text") || ""
    const url = params.get("url") || ""
    const fileNames = (params.get("files") || "").split("|").filter(Boolean)

    if (fallback) {
      const metadata: SharedPayload = {
        id: "fallback",
        title,
        text,
        url,
        receivedAt: new Date().toISOString(),
        files: [],
      }
      setPayload(metadata)
      setIncludeText(Boolean(textEvidence(metadata)))
      setWarning(fileNames.length
        ? `O Chrome ainda estava usando a versão anterior do PWA e não conseguiu preservar ${fileNames.length === 1 ? `o arquivo “${fileNames[0]}”` : "os arquivos recebidos"}. O Devboard já atualizou o receptor; compartilhe novamente.`
        : "O receptor do PWA acabou de ser atualizado. Os próximos compartilhamentos já serão preservados localmente antes da escolha do destino.")
    } else if (params.get("erro") === "recebimento") {
      setError("Não foi possível receber este compartilhamento. Tente compartilhar novamente pelo Chrome.")
    }

    setLoadingShare(false)
  }, [])

  const availableProjects = React.useMemo(() => projects.filter((project) =>
    projectIsAvailable(project, currentUserId, currentUserRole === "admin"),
  ), [currentUserId, currentUserRole, projects])

  const selectedProject = availableProjects.find((project) => project.id === projectId)
  const activities = selectedProject?.activities ?? []
  const selectedActivity = activities.find((activity) => activity.id === activityId)
  const subactivities = selectedActivity?.subactivities ?? []
  const sharedText = payload ? textEvidence(payload) : null
  const hasContent = files.length > 0 || Boolean(includeText && sharedText)

  React.useEffect(() => {
    if (projectId || availableProjects.length !== 1) return
    setProjectId(availableProjects[0].id)
  }, [availableProjects, projectId])

  React.useEffect(() => {
    if (destination === "project" || activityId || activities.length !== 1) return
    setActivityId(activities[0].id)
  }, [activities, activityId, destination])

  React.useEffect(() => {
    if (destination !== "subactivity" || subactivityId || subactivities.length !== 1) return
    setSubactivityId(subactivities[0].id)
  }, [destination, subactivities, subactivityId])

  function selectProject(next: string) {
    setProjectId(next)
    setActivityId("")
    setSubactivityId("")
    setError("")
  }

  function selectActivity(next: string) {
    setActivityId(next)
    setSubactivityId("")
    setError("")
  }

  function changeDestination(next: DestinationKind) {
    setDestination(next)
    if (next === "project") {
      setActivityId("")
      setSubactivityId("")
    } else if (next === "activity") {
      setSubactivityId("")
    }
    setError("")
  }

  async function discardAndLeave() {
    if (shareId) await deleteCachedShare(shareId).catch(() => undefined)
    if (window.history.length > 1) window.history.back()
    else router.replace("/")
  }

  async function sendEvidence() {
    if (sending || !hasContent) return
    if (!projectId) {
      setError("Selecione o projeto de destino.")
      return
    }
    if ((destination === "activity" || destination === "subactivity") && !activityId) {
      setError("Selecione a atividade de destino.")
      return
    }
    if (destination === "subactivity" && !subactivityId) {
      setError("Selecione a subatividade de destino.")
      return
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0) + (includeText && sharedText ? sharedText.size : 0)
    const tooLarge = files.find((file) => file.size > MAX_FILE_BYTES)
    if (tooLarge) {
      setError(`“${tooLarge.name}” ultrapassa o limite de ${formatBytes(MAX_FILE_BYTES)} por arquivo.`)
      return
    }
    if (totalBytes > MAX_BATCH_BYTES) {
      setError(`O compartilhamento ultrapassa o limite de ${formatBytes(MAX_BATCH_BYTES)} por envio.`)
      return
    }

    setSending(true)
    setError("")
    try {
      const uploads = await Promise.all(files.map(fileToUpload))
      if (includeText && sharedText) uploads.push(sharedText)

      const ok = destination === "project"
        ? await addProjectAttachments(projectId, uploads)
        : destination === "activity"
          ? await addActivityAttachments(activityId, uploads)
          : await addSubactivityAttachments(subactivityId, uploads)

      if (!ok) {
        setError("Não foi possível anexar a evidência agora. Sua seleção foi mantida para tentar novamente.")
        return
      }

      if (shareId) await deleteCachedShare(shareId).catch(() => undefined)
      setSuccess(true)
    } catch (cause) {
      console.error("[Devboard/PWA Share] Falha ao preparar evidências", cause)
      setError("Não foi possível preparar um dos arquivos compartilhados.")
    } finally {
      setSending(false)
    }
  }

  function openDestination() {
    if (destination === "subactivity") {
      const params = new URLSearchParams({ project: projectId, activity: activityId, sub: subactivityId })
      router.replace(`/acompanhamento?${params.toString()}`)
      return
    }
    if (destination === "activity") {
      router.replace(`/projetos/${projectId}#activity-${activityId}`)
      return
    }
    router.replace(`/projetos/${projectId}`)
  }

  if (!hydrated || loadingShare) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-5">
        <div className="flex items-center gap-3 rounded-2xl bg-card px-5 py-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
          <LoaderCircle className="size-4 animate-spin text-primary" />
          Preparando compartilhamento…
        </div>
      </main>
    )
  }

  if (success) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-8 sm:px-6">
        <section className="w-full max-w-md rounded-3xl bg-card p-6 text-center ring-1 ring-foreground/10 sm:p-8">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-success/10 text-success">
            <CheckCircle2 className="size-7" />
          </span>
          <h1 className="mt-5 text-xl font-bold tracking-tight">Evidência anexada</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            O conteúdo foi salvo no destino escolhido e a cópia temporária recebida pelo Android foi removida.
          </p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            <Button variant="outline" size="lg" onClick={() => void discardAndLeave()}>
              <ArrowLeft className="size-4" /> Voltar
            </Button>
            <Button size="lg" onClick={openDestination}>
              Abrir destino
            </Button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-background px-3 py-3 sm:px-5 sm:py-5">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex min-w-0 items-center gap-3 px-1 py-2">
          <button
            type="button"
            onClick={() => void discardAndLeave()}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Cancelar compartilhamento"
          >
            <ArrowLeft className="size-4.5" />
          </button>
          <DevboardLogo className="size-8 shrink-0" priority />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-bold tracking-tight sm:text-lg">Compartilhar no Devboard</h1>
            <p className="truncate text-[0.68rem] text-muted-foreground">Recebido pelo PWA · Chrome Android</p>
          </div>
          <span className="hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[0.65rem] font-semibold text-muted-foreground sm:flex">
            <Smartphone className="size-3" /> PWA
          </span>
        </header>

        <section className="mt-3 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Share2 className="size-4 text-primary" /> Conteúdo recebido
              </div>
              <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                Só será enviado depois que você confirmar o destino.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-[0.62rem] text-muted-foreground">
              {files.length + (includeText && sharedText ? 1 : 0)} item(ns)
            </span>
          </div>

          <div className="space-y-2 p-3 sm:p-4">
            {files.map((file, index) => {
              const kind = detectKind(file)
              return (
                <div key={`${file.name}-${file.lastModified}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-2.5">
                  <SharedFilePreview file={file} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold" title={file.name}>{file.name || "Arquivo compartilhado"}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                      <KindIcon kind={kind} className="size-3" />
                      {formatBytes(file.size)}
                      {file.type && <span className="truncate">· {file.type}</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={`Remover ${file.name}`}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )
            })}

            {sharedText && includeText && payload && (
              <div className="flex min-w-0 items-start gap-3 rounded-xl border border-border/70 bg-background/60 p-2.5">
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/10">
                  {payload.url ? <Link2 className="size-5" /> : <FileText className="size-5" />}
                </span>
                <div className="min-w-0 flex-1 py-0.5">
                  <p className="truncate text-sm font-semibold">{payload.title || (payload.url ? "Link compartilhado" : "Texto compartilhado")}</p>
                  {payload.text && <p className="mt-1 line-clamp-2 text-[0.68rem] leading-relaxed text-muted-foreground">{payload.text}</p>}
                  {payload.url && (
                    <a href={payload.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[0.68rem] font-medium text-primary hover:underline">
                      {payload.url}
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIncludeText(false)}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Remover texto ou link compartilhado"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}

            {!hasContent && !warning && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <Paperclip className="mx-auto size-5 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold">Nenhuma evidência recebida</p>
                <p className="mt-1 text-xs text-muted-foreground">Abra uma foto, arquivo ou link em outro aplicativo e escolha Compartilhar → Devboard.</p>
              </div>
            )}
          </div>
        </section>

        <section className="mt-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
              <FolderKanban className="size-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Onde anexar?</h2>
              <p className="mt-0.5 text-[0.68rem] leading-relaxed text-muted-foreground">Escolha se a evidência pertence ao projeto inteiro, a uma atividade ou diretamente a uma subatividade.</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
            {([
              ["project", "Projeto", FolderKanban],
              ["activity", "Atividade", Layers3],
              ["subactivity", "Subatividade", Paperclip],
            ] as const).map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => changeDestination(key)}
                className={cn(
                  "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-[0.7rem] font-semibold transition-all sm:text-xs",
                  destination === key ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/8" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3">
            <NativeSelect value={projectId} onChange={selectProject} label="Projeto" placeholder="Selecione o projeto">
              {availableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </NativeSelect>

            {destination !== "project" && (
              <NativeSelect value={activityId} onChange={selectActivity} disabled={!projectId} label="Atividade" placeholder={projectId ? "Selecione a atividade" : "Selecione o projeto primeiro"}>
                {activities.map((activity) => <option key={activity.id} value={activity.id}>{activity.title}</option>)}
              </NativeSelect>
            )}

            {destination === "subactivity" && (
              <NativeSelect value={subactivityId} onChange={(value) => { setSubactivityId(value); setError("") }} disabled={!activityId} label="Subatividade" placeholder={activityId ? "Selecione a subatividade" : "Selecione a atividade primeiro"}>
                {subactivities.map((sub) => <option key={sub.id} value={sub.id}>{sub.title}</option>)}
              </NativeSelect>
            )}
          </div>

          {availableProjects.length === 0 && (
            <p className="mt-3 rounded-xl border border-warning/20 bg-warning/8 px-3 py-2.5 text-xs leading-relaxed text-warning">
              Nenhum projeto disponível para o seu usuário. Verifique se você participa do projeto ou da atividade que deve receber a evidência.
            </p>
          )}
        </section>

        {warning && (
          <div className="mt-3 rounded-2xl border border-warning/20 bg-warning/8 px-4 py-3 text-xs leading-relaxed text-warning">
            <div className="flex gap-2.5">
              <RotateCcw className="mt-0.5 size-4 shrink-0" />
              <span>{warning}</span>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-3 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-xs leading-relaxed text-destructive">
            {error}
          </div>
        )}

        <div className="sticky bottom-0 mt-3 bg-gradient-to-t from-background via-background to-transparent pb-2 pt-3">
          <div className="flex gap-2 rounded-2xl bg-card p-2 ring-1 ring-foreground/10">
            <Button variant="outline" size="lg" className="h-11 flex-1" onClick={() => void discardAndLeave()} disabled={sending}>
              Cancelar
            </Button>
            <Button size="lg" className="h-11 flex-[1.5]" onClick={() => void sendEvidence()} disabled={!hasContent || sending} loading={sending} loadingText="Anexando…">
              {!sending && <Send className="size-4" />}
              Anexar evidência
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}
