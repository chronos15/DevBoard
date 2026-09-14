"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  File as FileIcon,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FolderKanban,
  Hash,
  Layers3,
  Link2,
  LoaderCircle,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import type { AttachmentKind, AttachmentUploadInput, Project, ServiceRequestAttachmentCategory } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { DevboardLogo } from "@/components/devboard-logo"
import { ProjectIcon } from "@/components/projects/project-icon"
import { cn } from "@/lib/utils"
import { SERVICE_REQUEST_FINAL_STATUSES, serviceRequestReference } from "@/lib/service-requests"
import {
  MAX_ATTACHMENT_FILE_BYTES,
  isSingleVideoSelection,
  prepareVideoAttachment,
  type VideoProcessingProgress,
} from "@/lib/video-attachment-processor"

const SHARE_CACHE = "devboard-share-target-v1"
const SHARE_PREFIX = "/__devboard-share-target__/"
const MAX_FILE_BYTES = MAX_ATTACHMENT_FILE_BYTES
const MAX_BATCH_BYTES = 150 * 1024 * 1024

const textExtensions = new Set([
  "sql", "txt", "md", "json", "xml", "csv", "log", "yaml", "yml", "ini", "env",
  "js", "ts", "tsx", "jsx", "css", "html", "dart", "pas",
])
const documentExtensions = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf"])

type DestinationGroup = "work" | "request" | "aqs"
type DestinationKind = "project" | "activity" | "subactivity"
type ShareDestinationType = DestinationKind | "request" | "aqs"
type DestinationFilter = "all" | ShareDestinationType

type ShareDestination = {
  key: string
  type: ShareDestinationType
  title: string
  subtitle: string
  searchText: string
  updatedAt: string
  projectId?: string
  activityId?: string
  subactivityId?: string
  requestId?: string
  aqsReviewId?: string
  projectIcon?: string
  projectIconUrl?: string
}

type ShareHistoryEntry = {
  key: string
  count: number
  lastUsedAt: string
}

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

function subactivityIsAvailable(sub: Project["activities"][number]["subactivities"][number], currentUserId: string, isAdmin: boolean) {
  if (isAdmin) return true
  return sub.assigneeId === currentUserId || Boolean(sub.memberIds?.includes(currentUserId))
}

function activityIsAvailable(activity: Project["activities"][number], currentUserId: string, isAdmin: boolean) {
  if (isAdmin) return true
  return Boolean(activity.assigneeIds?.includes(currentUserId))
    || activity.subactivities.some((sub) => subactivityIsAvailable(sub, currentUserId, false))
}

function projectIsAvailable(project: Project, currentUserId: string, isAdmin: boolean) {
  if (isAdmin) return true
  return project.activities.some((activity) => activityIsAvailable(activity, currentUserId, false))
}


function latestIso(values: Array<string | undefined>) {
  return values.filter(Boolean).sort().at(-1) ?? ""
}

function destinationLabel(type: ShareDestinationType) {
  if (type === "subactivity") return "Acompanhamento"
  if (type === "activity") return "Atividade"
  if (type === "project") return "Projeto"
  if (type === "request") return "Solicitação"
  return "Análise AQS"
}

function DestinationGlyph({ destination }: { destination: ShareDestination }) {
  if (destination.projectIcon || destination.projectIconUrl) {
    return (
      <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-foreground ring-1 ring-foreground/10">
        <ProjectIcon
          icon={destination.projectIcon}
          imageUrl={destination.projectIconUrl}
          className="size-5"
          imageClassName="size-full rounded-none object-cover"
        />
      </span>
    )
  }

  const Icon = destination.type === "subactivity"
    ? MessageSquareText
    : destination.type === "activity"
      ? Layers3
      : destination.type === "project"
        ? FolderKanban
        : destination.type === "request"
          ? ClipboardList
          : ClipboardCheck

  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/8 text-primary ring-1 ring-primary/10">
      <Icon className="size-5" />
    </span>
  )
}

function DestinationRow({
  destination,
  selected,
  onSelect,
  compact = false,
}: {
  destination: ShareDestination
  selected: boolean
  onSelect: () => void
  compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-3 rounded-2xl text-left transition-colors",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
        selected ? "bg-primary/[0.075] ring-1 ring-primary/20" : "hover:bg-muted/65 active:bg-muted",
      )}
    >
      <DestinationGlyph destination={destination} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{destination.title}</span>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[0.56rem] font-semibold text-muted-foreground">
            {destinationLabel(destination.type)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">{destination.subtitle}</span>
      </span>
      <span
        className={cn(
          "flex size-6 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background",
        )}
        aria-hidden="true"
      >
        {selected && <Check className="size-3.5" strokeWidth={2.5} />}
      </span>
    </button>
  )
}

export default function ShareToDevboardPage() {
  const router = useRouter()
  const {
    hydrated,
    projects,
    serviceRequests,
    aqsReviews,
    currentUserId,
    currentUserRole,
    addProjectAttachments,
    addActivityAttachments,
    addSubactivityAttachments,
    addAqsReviewAttachments,
    addServiceRequestAttachments,
  } = useStore()

  const [loadingShare, setLoadingShare] = React.useState(true)
  const [shareId, setShareId] = React.useState("")
  const [payload, setPayload] = React.useState<SharedPayload | null>(null)
  const [files, setFiles] = React.useState<File[]>([])
  const [includeText, setIncludeText] = React.useState(true)
  const [destinationGroup, setDestinationGroup] = React.useState<DestinationGroup>("work")
  const [destination, setDestination] = React.useState<DestinationKind>("subactivity")
  const [projectId, setProjectId] = React.useState("")
  const [activityId, setActivityId] = React.useState("")
  const [subactivityId, setSubactivityId] = React.useState("")
  const [requestId, setRequestId] = React.useState("")
  const [aqsReviewId, setAqsReviewId] = React.useState("")
  const [selectedDestinationKey, setSelectedDestinationKey] = React.useState("")
  const [destinationQuery, setDestinationQuery] = React.useState("")
  const [destinationFilter, setDestinationFilter] = React.useState<DestinationFilter>("all")
  const [shareHistory, setShareHistory] = React.useState<ShareHistoryEntry[]>([])
  const [error, setError] = React.useState("")
  const [warning, setWarning] = React.useState("")
  const [sending, setSending] = React.useState(false)
  const [videoProgress, setVideoProgress] = React.useState<VideoProcessingProgress | null>(null)
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
        ? `O Chrome ainda estava usando a versão anterior do PWA e não conseguiu preservar ${fileNames.length === 1 ? `o arquivo “${fileNames[0]}”` : "os arquivos recebidos"}. O TaskBoard já atualizou o receptor; compartilhe novamente.`
        : "O receptor do PWA acabou de ser atualizado. Os próximos compartilhamentos já serão preservados localmente antes da escolha do destino.")
    } else if (params.get("erro") === "recebimento") {
      setError("Não foi possível receber este compartilhamento. Tente compartilhar novamente pelo Chrome.")
    }

    setLoadingShare(false)
  }, [])

  const isAdmin = currentUserRole === "admin"
  const availableProjects = React.useMemo(() => projects.filter((project) =>
    projectIsAvailable(project, currentUserId, isAdmin),
  ), [currentUserId, isAdmin, projects])

  const availableRequests = React.useMemo(() => serviceRequests
    .filter((request) => !SERVICE_REQUEST_FINAL_STATUSES.has(request.status))
    .filter((request) => isAdmin
      || request.participantIds.includes(currentUserId)
      || request.createdBy === currentUserId
      || request.assignedAqsId === currentUserId
      || request.responsibleDevId === currentUserId
      || request.executorId === currentUserId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [currentUserId, isAdmin, serviceRequests])
  const selectedRequest = availableRequests.find((request) => request.id === requestId)

  const availableAqsReviews = React.useMemo(() => aqsReviews.flatMap((review) => {
    if (review.status !== "awaiting" && review.status !== "evaluating") return []
    const project = projects.find((item) => item.id === review.projectId)
    const activity = project?.activities.find((item) => item.id === review.activityId)
    const sub = activity?.subactivities.find((item) => item.id === review.subactivityId)
    if (!project || !activity || !sub) return []
    const follows = review.assignedAqsId === currentUserId
      || review.createdBy === currentUserId
      || subactivityIsAvailable(sub, currentUserId, false)
    if (!isAdmin && !follows) return []
    return [{ review, project, activity, sub }]
  }).sort((a, b) => b.review.createdAt.localeCompare(a.review.createdAt)), [aqsReviews, currentUserId, isAdmin, projects])
  const selectedAqsReview = availableAqsReviews.find((item) => item.review.id === aqsReviewId)

  const allDestinations = React.useMemo<ShareDestination[]>(() => {
    const items: ShareDestination[] = []

    for (const project of availableProjects) {
      const visibleActivities = project.activities.filter((activity) =>
        activityIsAvailable(activity, currentUserId, isAdmin),
      )
      const visibleSubs = visibleActivities.flatMap((activity) =>
        activity.subactivities
          .filter((sub) => subactivityIsAvailable(sub, currentUserId, isAdmin))
          .map((sub) => ({ activity, sub })),
      )
      const projectUpdatedAt = latestIso(visibleSubs.flatMap(({ sub }) => [sub.updatedAt, sub.createdAt]))

      items.push({
        key: `project:${project.id}`,
        type: "project",
        title: project.name,
        subtitle: project.client ? `Projeto · ${project.client}` : "Projeto",
        searchText: `${project.name} ${project.client} ${project.tag}`.toLowerCase(),
        updatedAt: projectUpdatedAt,
        projectId: project.id,
        projectIcon: project.icon,
        projectIconUrl: project.iconImageUrl,
      })

      for (const activity of visibleActivities) {
        const activitySubs = activity.subactivities.filter((sub) =>
          subactivityIsAvailable(sub, currentUserId, isAdmin),
        )
        items.push({
          key: `activity:${activity.id}`,
          type: "activity",
          title: activity.title,
          subtitle: `${project.name} · Atividade`,
          searchText: `${activity.title} ${project.name} ${project.client}`.toLowerCase(),
          updatedAt: latestIso(activitySubs.flatMap((sub) => [sub.updatedAt, sub.createdAt])),
          projectId: project.id,
          activityId: activity.id,
          projectIcon: project.icon,
          projectIconUrl: project.iconImageUrl,
        })

        for (const sub of activitySubs) {
          items.push({
            key: `subactivity:${sub.id}`,
            type: "subactivity",
            title: sub.title,
            subtitle: `${project.name} · ${activity.title}`,
            searchText: `${sub.title} ${activity.title} ${project.name} ${project.client}`.toLowerCase(),
            updatedAt: sub.updatedAt || sub.createdAt || "",
            projectId: project.id,
            activityId: activity.id,
            subactivityId: sub.id,
            projectIcon: project.icon,
            projectIconUrl: project.iconImageUrl,
          })
        }
      }
    }

    for (const request of availableRequests) {
      items.push({
        key: `request:${request.id}`,
        type: "request",
        title: request.title,
        subtitle: `${serviceRequestReference(request)} · ${request.unit || request.module || "Solicitação"}`,
        searchText: `${request.title} ${serviceRequestReference(request)} ${request.unit} ${request.module} ${request.subject}`.toLowerCase(),
        updatedAt: request.updatedAt,
        requestId: request.id,
      })
    }

    for (const { review, project, activity, sub } of availableAqsReviews) {
      items.push({
        key: `aqs:${review.id}`,
        type: "aqs",
        title: sub.title,
        subtitle: `${project.name} · ${activity.title}`,
        searchText: `${sub.title} ${activity.title} ${project.name} aqs análise`.toLowerCase(),
        updatedAt: sub.updatedAt || review.createdAt,
        projectId: project.id,
        activityId: activity.id,
        subactivityId: sub.id,
        aqsReviewId: review.id,
        projectIcon: project.icon,
        projectIconUrl: project.iconImageUrl,
      })
    }

    const rank: Record<ShareDestinationType, number> = {
      subactivity: 0,
      request: 1,
      aqs: 2,
      activity: 3,
      project: 4,
    }

    return items.sort((a, b) => {
      const byDate = b.updatedAt.localeCompare(a.updatedAt)
      return byDate || rank[a.type] - rank[b.type] || a.title.localeCompare(b.title)
    })
  }, [availableAqsReviews, availableProjects, availableRequests, currentUserId, isAdmin])

  const selectedDestination = allDestinations.find((item) => item.key === selectedDestinationKey)

  React.useEffect(() => {
    if (!currentUserId) return
    try {
      const raw = window.localStorage.getItem(`taskboard-share-history-v2:${currentUserId}`)
      const parsed = raw ? JSON.parse(raw) : []
      setShareHistory(Array.isArray(parsed) ? parsed.slice(0, 20) : [])
    } catch {
      setShareHistory([])
    }
  }, [currentUserId])

  const frequentDestinations = React.useMemo(() => shareHistory
    .slice()
    .sort((a, b) => b.count - a.count || b.lastUsedAt.localeCompare(a.lastUsedAt))
    .map((entry) => allDestinations.find((item) => item.key === entry.key))
    .filter((item): item is ShareDestination => Boolean(item))
    .slice(0, 6), [allDestinations, shareHistory])

  const recentDestinations = React.useMemo(() => {
    const frequentKeys = new Set(frequentDestinations.map((item) => item.key))
    return allDestinations
      .filter((item) => !frequentKeys.has(item.key))
      .slice(0, 8)
  }, [allDestinations, frequentDestinations])

  const normalizedDestinationQuery = destinationQuery.trim().toLowerCase()
  const filteredDestinations = React.useMemo(() => allDestinations.filter((item) => {
    if (destinationFilter !== "all" && item.type !== destinationFilter) return false
    if (!normalizedDestinationQuery) return true
    return item.searchText.includes(normalizedDestinationQuery)
      || item.title.toLowerCase().includes(normalizedDestinationQuery)
      || item.subtitle.toLowerCase().includes(normalizedDestinationQuery)
  }), [allDestinations, destinationFilter, normalizedDestinationQuery])

  const sharedText = payload ? textEvidence(payload) : null
  const hasContent = files.length > 0 || Boolean(includeText && sharedText)

  function chooseDestination(item: ShareDestination) {
    setSelectedDestinationKey(item.key)
    setError("")
    setProjectId(item.projectId ?? "")
    setActivityId(item.activityId ?? "")
    setSubactivityId(item.subactivityId ?? "")
    setRequestId(item.requestId ?? "")
    setAqsReviewId(item.aqsReviewId ?? "")

    if (item.type === "request") {
      setDestinationGroup("request")
      return
    }
    if (item.type === "aqs") {
      setDestinationGroup("aqs")
      return
    }

    setDestinationGroup("work")
    setDestination(item.type)
  }

  function rememberDestination(key: string) {
    if (!currentUserId || !key) return
    const now = new Date().toISOString()
    const current = shareHistory.find((entry) => entry.key === key)
    const next = [
      { key, count: (current?.count ?? 0) + 1, lastUsedAt: now },
      ...shareHistory.filter((entry) => entry.key !== key),
    ].slice(0, 20)
    setShareHistory(next)
    try {
      window.localStorage.setItem(`taskboard-share-history-v2:${currentUserId}`, JSON.stringify(next))
    } catch {
      // O histórico é apenas um acelerador local; o envio não depende dele.
    }
  }

  async function discardAndLeave() {
    if (shareId) await deleteCachedShare(shareId).catch(() => undefined)
    if (window.history.length > 1) window.history.back()
    else router.replace("/")
  }

  async function sendEvidence() {
    if (sending || !hasContent) return
    if (!selectedDestinationKey || !selectedDestination) {
      setError("Escolha onde deseja enviar este conteúdo.")
      return
    }
    if (destinationGroup === "work") {
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
    } else if (destinationGroup === "request") {
      if (!requestId || !selectedRequest) {
        setError("Selecione uma solicitação em aberto.")
        return
      }
    } else if (!aqsReviewId || !selectedAqsReview) {
      setError("Selecione uma análise AQS em aberto.")
      return
    }

    const singleVideo = isSingleVideoSelection(files)
    if (!singleVideo) {
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
    }

    setSending(true)
    setVideoProgress(null)
    setError("")
    try {
      const preparedFiles = singleVideo
        ? await prepareVideoAttachment(files[0], setVideoProgress)
        : files

      const invalidPart = preparedFiles.find((file) => file.size > MAX_FILE_BYTES)
      if (invalidPart) {
        setError(`A parte “${invalidPart.name}” ainda ficou acima de ${formatBytes(MAX_FILE_BYTES)}.`)
        return
      }

      let ok = false
      if (destinationGroup === "request") {
        const requestFiles = [...preparedFiles]
        if (includeText && sharedText?.textContent) {
          requestFiles.push(new File([sharedText.textContent], sharedText.name, { type: sharedText.mimeType }))
        }
        ok = await addServiceRequestAttachments(requestId, requestFiles.map((file) => ({
          file,
          category: (detectKind(file) === "video" ? "analysis-video" : "other") as ServiceRequestAttachmentCategory,
        })))
      } else {
        const uploads = await Promise.all(preparedFiles.map(fileToUpload))
        if (includeText && sharedText) uploads.push(sharedText)
        if (destinationGroup === "aqs") {
          ok = await addAqsReviewAttachments(aqsReviewId, uploads)
        } else {
          ok = destination === "project"
            ? await addProjectAttachments(projectId, uploads)
            : destination === "activity"
              ? await addActivityAttachments(activityId, uploads)
              : await addSubactivityAttachments(subactivityId, uploads)
        }
      }

      if (!ok) {
        setError("Não foi possível anexar a evidência agora. Sua seleção foi mantida para tentar novamente.")
        return
      }

      if (shareId) await deleteCachedShare(shareId).catch(() => undefined)
      rememberDestination(selectedDestinationKey)
      setSuccess(true)
    } catch (cause) {
      console.error("[TaskBoard/PWA Share] Falha ao preparar evidências", cause)
      setError(cause instanceof Error
        ? cause.message
        : "Não foi possível preparar um dos arquivos compartilhados.")
    } finally {
      setSending(false)
    }
  }

  function openDestination() {
    if (destinationGroup === "request") {
      router.replace(`/solicitacoes/${requestId}`)
      return
    }
    if (destinationGroup === "aqs") {
      const subId = selectedAqsReview?.sub.id ?? ""
      router.replace(subId ? `/analise?sub=${encodeURIComponent(subId)}` : "/analise")
      return
    }
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
            O conteúdo foi salvo no destino escolhido e a cópia temporária recebida pelo dispositivo foi removida.
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
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/92 px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => void discardAndLeave()}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted"
              aria-label="Cancelar compartilhamento"
            >
              <ArrowLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-semibold tracking-tight">Enviar para...</h1>
              <p className="truncate text-[0.68rem] text-muted-foreground">
                Escolha rapidamente onde anexar no TaskBoard
              </p>
            </div>
            <DevboardLogo className="size-8 shrink-0" priority />
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={destinationQuery}
              onChange={(event) => setDestinationQuery(event.target.value)}
              placeholder="Buscar projeto, atividade, subatividade, solicitação..."
              className="h-11 w-full rounded-2xl border border-border bg-muted/55 pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-muted-foreground/80 focus:border-primary/30 focus:bg-card focus:ring-3 focus:ring-primary/10"
              inputMode="search"
              autoComplete="off"
            />
            {destinationQuery && (
              <button
                type="button"
                onClick={() => setDestinationQuery("")}
                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 px-3 pb-32 pt-3 sm:px-5">
          <details className="group overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
            <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3 [&::-webkit-details-marker]:hidden">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
                <Paperclip className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {files.length + (includeText && sharedText ? 1 : 0)} {files.length + (includeText && sharedText ? 1 : 0) === 1 ? "item pronto" : "itens prontos"} para enviar
                </span>
                <span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">
                  Toque para revisar ou remover antes do envio
                </span>
              </span>
              <span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground transition-colors group-open:bg-primary/8 group-open:text-primary">
                Ver conteúdo
              </span>
            </summary>

            <div className="space-y-2 border-t border-border/70 p-3">
              {files.map((file, index) => {
                const kind = detectKind(file)
                return (
                  <div key={`${file.name}-${file.lastModified}-${index}`} className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/40 p-2.5">
                    <SharedFilePreview file={file} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold" title={file.name}>{file.name || "Arquivo compartilhado"}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
                        <KindIcon kind={kind} className="size-3" />
                        {formatBytes(file.size)}
                        {file.type && <span className="truncate">· {file.type}</span>}
                        {files.length === 1 && kind === "video" && file.size > MAX_FILE_BYTES && (
                          <span className="shrink-0 text-primary">· otimização automática</span>
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                      aria-label={`Remover ${file.name}`}
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )
              })}

              {sharedText && includeText && payload && (
                <div className="flex min-w-0 items-start gap-3 rounded-xl bg-muted/40 p-2.5">
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
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    aria-label="Remover texto ou link compartilhado"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}

              {!hasContent && !warning && (
                <div className="rounded-xl border border-dashed border-border px-4 py-7 text-center">
                  <Paperclip className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 text-sm font-semibold">Nenhum conteúdo recebido</p>
                  <p className="mt-1 text-xs text-muted-foreground">Compartilhe novamente pelo menu do Android/iOS.</p>
                </div>
              )}
            </div>
          </details>

          {!isAdmin && (
            <p className="mt-3 px-1 text-[0.65rem] leading-relaxed text-muted-foreground">
              Você vê somente destinos disponíveis para o seu nível de acesso.
            </p>
          )}

          {!normalizedDestinationQuery && destinationFilter === "all" && frequentDestinations.length > 0 && (
            <section className="mt-5">
              <div className="mb-2 flex items-center gap-2 px-1">
                <Hash className="size-3.5 text-primary" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Frequentes</h2>
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {frequentDestinations.map((item) => (
                  <DestinationRow
                    key={`frequent-${item.key}`}
                    destination={item}
                    selected={selectedDestinationKey === item.key}
                    onSelect={() => chooseDestination(item)}
                    compact
                  />
                ))}
              </div>
            </section>
          )}

          {!normalizedDestinationQuery && destinationFilter === "all" && recentDestinations.length > 0 && (
            <section className="mt-5">
              <div className="mb-2 flex items-center gap-2 px-1">
                <Clock3 className="size-3.5 text-primary" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Recentes</h2>
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                {recentDestinations.map((item) => (
                  <DestinationRow
                    key={`recent-${item.key}`}
                    destination={item}
                    selected={selectedDestinationKey === item.key}
                    onSelect={() => chooseDestination(item)}
                    compact
                  />
                ))}
              </div>
            </section>
          )}

          <section className="mt-5">
            <div className="flex items-center justify-between gap-3 px-1">
              <h2 className="text-sm font-semibold">
                {normalizedDestinationQuery ? "Resultados" : "Todos os destinos"}
              </h2>
              <span className="text-[0.65rem] text-muted-foreground">{filteredDestinations.length} disponíveis</span>
            </div>

            <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {([
                ["all", "Todos"],
                ["subactivity", "Acompanhamentos"],
                ["request", "Solicitações"],
                ["aqs", "AQS"],
                ["activity", "Atividades"],
                ["project", "Projetos"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setDestinationFilter(key)}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-3 text-xs font-semibold transition-colors",
                    destinationFilter === key
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-2 grid gap-1">
              {filteredDestinations.map((item) => (
                <DestinationRow
                  key={item.key}
                  destination={item}
                  selected={selectedDestinationKey === item.key}
                  onSelect={() => chooseDestination(item)}
                />
              ))}

              {filteredDestinations.length === 0 && (
                <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center">
                  <Search className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 text-sm font-semibold">Nenhum destino encontrado</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Tente outro nome ou altere o filtro selecionado.
                  </p>
                </div>
              )}
            </div>
          </section>

          {videoProgress && sending && (
            <div className="mt-4 rounded-2xl border border-primary/15 bg-primary/[0.045] px-4 py-3">
              <div className="flex items-start gap-3">
                <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-foreground">Preparando vídeo</p>
                    <span className="font-mono text-[0.65rem] text-primary">{Math.round(videoProgress.progress * 100)}%</span>
                  </div>
                  <p className="mt-1 text-[0.68rem] leading-relaxed text-muted-foreground">{videoProgress.message}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{ width: `${Math.round(videoProgress.progress * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {warning && (
            <div className="mt-4 rounded-2xl border border-warning/20 bg-warning/8 px-4 py-3 text-xs leading-relaxed text-warning">
              <div className="flex gap-2.5">
                <RotateCcw className="mt-0.5 size-4 shrink-0" />
                <span>{warning}</span>
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-xs leading-relaxed text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/94 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:px-5">
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
            {selectedDestination ? (
              <div className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl bg-muted/60 px-2.5 py-2">
                <DestinationGlyph destination={selectedDestination} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{selectedDestination.title}</p>
                  <p className="truncate text-[0.62rem] text-muted-foreground">{destinationLabel(selectedDestination.type)} · {selectedDestination.subtitle}</p>
                </div>
              </div>
            ) : (
              <div className="min-w-0 flex-1 px-2">
                <p className="text-xs font-semibold">Escolha um destino</p>
                <p className="text-[0.62rem] text-muted-foreground">Toque em uma opção acima</p>
              </div>
            )}
            <Button
              size="lg"
              className="h-12 shrink-0 rounded-full px-5"
              onClick={() => void sendEvidence()}
              disabled={!hasContent || !selectedDestinationKey || sending}
              loading={sending}
              loadingText={videoProgress ? "Otimizando…" : "Enviando…"}
            >
              {!sending && <Send className="size-4" />}
              Enviar
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}
