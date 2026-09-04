"use client"

import * as React from "react"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Code2,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FileVideo,
  FolderKanban,
  Hash,
  Info,
  Menu,
  MessageSquareText,
  Paperclip,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  UsersRound,
  Video,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import type { AqsReview, AqsReviewStatus, AttachmentEntry, CommentEntry, Project, Subactivity } from "@/lib/types"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { AttachmentDialog } from "@/components/attachments/attachment-dialog"
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
import { createClient } from "@/lib/supabase/client"
import { DeveloperVcsTaskChanges, type DeveloperTaskVcsChange } from "@/components/developer/developer-vcs-task-changes"
import { ProjectIcon } from "@/components/projects/project-icon"
import { formatHMS } from "@/lib/project-utils"
import { ActivityMeetingButton } from "@/components/activity-meeting-button"
import { isActivityMeetingLog, visibleMeetingLogDescription } from "@/lib/work-meetings"

const reviewMeta: Record<AqsReviewStatus, { label: string; shortLabel: string; dot: string; badge: string }> = {
  awaiting: {
    label: "Aguardando análise",
    shortLabel: "Aguardando",
    dot: "bg-chart-2",
    badge: "bg-chart-2/12 text-chart-2",
  },
  evaluating: {
    label: "Em análise AQS",
    shortLabel: "Em análise",
    dot: "bg-chart-3",
    badge: "bg-chart-3/12 text-chart-3",
  },
  completed: {
    label: "Concluída pelo AQS",
    shortLabel: "Concluída",
    dot: "bg-success",
    badge: "bg-success/12 text-success",
  },
  revoked: {
    label: "Revogada pelo AQS",
    shortLabel: "Revogada",
    dot: "bg-destructive",
    badge: "bg-destructive/10 text-destructive",
  },
}

type ReviewFilter = "active" | AqsReviewStatus | "all"

type LocatedReview = {
  review: AqsReview
  project: Project
  activity: Project["activities"][number]
  sub: Subactivity
}

type TimelineItem =
  | { id: string; kind: "system"; createdAt: string; title: string; description?: string; tone?: "success" | "danger" | "primary" | "meeting" }
  | { id: string; kind: "comment"; createdAt: string; comment: CommentEntry }
  | { id: string; kind: "attachment"; createdAt: string; attachment: AttachmentEntry }

function safeTime(value?: string) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

function formatDate(value?: string) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "—"
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function elapsed(value?: string) {
  if (!value) return "agora"
  const diff = Math.max(0, Date.now() - safeTime(value))
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return "agora"
  if (minutes < 60) return `há ${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  return `há ${Math.floor(hours / 24)}d`
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function AttachmentKindIcon({ attachment }: { attachment: AttachmentEntry }) {
  const Icon = attachment.kind === "image"
    ? FileImage
    : attachment.kind === "video"
      ? FileVideo
      : attachment.kind === "audio"
        ? FileAudio
        : attachment.kind === "text"
          ? FileCode2
          : FileText
  return <Icon className="size-4" />
}

function reviewMatchesFilter(review: AqsReview, filter: ReviewFilter) {
  if (filter === "all") return true
  if (filter === "active") return review.status === "awaiting" || review.status === "evaluating"
  return review.status === filter
}

export function AnalysisView() {
  const {
    aqsReviews,
    projects,
    members,
    currentUserId,
    currentUserRole,
    startAqsReview,
    completeAqsReview,
    revokeAqsReview,
    addSubactivityAttachments,
    setSubactivityAttachmentActive,
    addSubactivityComment,
  } = useStore()

  const canReview = currentUserRole === "admin" || currentUserRole === "aqs"
  const [filter, setFilter] = React.useState<ReviewFilter>("active")
  const [search, setSearch] = React.useState("")
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null)
  const [selectedReviewId, setSelectedReviewId] = React.useState<string | null>(null)
  const [collapsedActivities, setCollapsedActivities] = React.useState<Set<string>>(() => new Set())
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = React.useState(false)
  const [mobileDetailsOpen, setMobileDetailsOpen] = React.useState(false)
  const [busy, setBusy] = React.useState<Set<string>>(() => new Set())
  const [revokeTarget, setRevokeTarget] = React.useState<AqsReview | null>(null)
  const [reason, setReason] = React.useState("")
  const [comment, setComment] = React.useState("")
  const [sendingComment, setSendingComment] = React.useState(false)
  const timelineRef = React.useRef<HTMLDivElement>(null)
  const [vcsChangesBySubactivity, setVcsChangesBySubactivity] = React.useState<Record<string, DeveloperTaskVcsChange[]>>({})

  const locatedReviews = React.useMemo<LocatedReview[]>(() => {
    const result: LocatedReview[] = []
    for (const review of aqsReviews) {
      const project = projects.find((item) => item.id === review.projectId)
      const activity = project?.activities.find((item) => item.id === review.activityId)
      const sub = activity?.subactivities.find((item) => item.id === review.subactivityId)
      if (!project || !activity || !sub) continue
      result.push({ review, project, activity, sub })
    }
    return result.sort((a, b) => {
      const priority = (status: AqsReviewStatus) => status === "evaluating" ? 0 : status === "awaiting" ? 1 : status === "revoked" ? 2 : 3
      return priority(a.review.status) - priority(b.review.status) || safeTime(b.review.createdAt) - safeTime(a.review.createdAt)
    })
  }, [aqsReviews, projects])

  const normalizedSearch = search.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")

  const visibleReviews = React.useMemo(() => locatedReviews.filter((item) => {
    if (!reviewMatchesFilter(item.review, filter)) return false
    if (!normalizedSearch) return true
    const developer = members.find((member) => member.id === item.sub.assigneeId)
    const aqs = members.find((member) => member.id === item.review.assignedAqsId)
    const haystack = `${item.project.name} ${item.activity.title} ${item.sub.title} ${developer?.name ?? ""} ${aqs?.name ?? ""}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR")
    return haystack.includes(normalizedSearch)
  }), [filter, locatedReviews, members, normalizedSearch])

  const projectGroups = React.useMemo(() => {
    const ids = new Set(visibleReviews.map((item) => item.project.id))
    return projects.filter((project) => ids.has(project.id))
  }, [projects, visibleReviews])

  React.useEffect(() => {
    if (!projectGroups.length) {
      setSelectedProjectId(null)
      return
    }
    if (!selectedProjectId || !projectGroups.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(projectGroups[0].id)
    }
  }, [projectGroups, selectedProjectId])

  const reviewsInSelectedProject = React.useMemo(
    () => visibleReviews.filter((item) => item.project.id === selectedProjectId),
    [selectedProjectId, visibleReviews],
  )

  React.useEffect(() => {
    if (!reviewsInSelectedProject.length) {
      setSelectedReviewId(null)
      return
    }
    if (!selectedReviewId || !reviewsInSelectedProject.some((item) => item.review.id === selectedReviewId)) {
      setSelectedReviewId(reviewsInSelectedProject[0].review.id)
    }
  }, [reviewsInSelectedProject, selectedReviewId])

  const selected = React.useMemo(
    () => locatedReviews.find((item) => item.review.id === selectedReviewId) ?? null,
    [locatedReviews, selectedReviewId],
  )

  const counts = React.useMemo(() => ({
    active: locatedReviews.filter((item) => reviewMatchesFilter(item.review, "active")).length,
    awaiting: locatedReviews.filter((item) => item.review.status === "awaiting").length,
    evaluating: locatedReviews.filter((item) => item.review.status === "evaluating").length,
    completed: locatedReviews.filter((item) => item.review.status === "completed").length,
    revoked: locatedReviews.filter((item) => item.review.status === "revoked").length,
    all: locatedReviews.length,
  }), [locatedReviews])

  const vcsSubactivityKey = React.useMemo(
    () => Array.from(new Set(locatedReviews.map((item) => item.sub.id))).sort().join(","),
    [locatedReviews],
  )

  const loadVcsChanges = React.useCallback(async () => {
    const ids = vcsSubactivityKey ? vcsSubactivityKey.split(",") : []
    if (!ids.length) {
      setVcsChangesBySubactivity({})
      return
    }
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from("developer_vcs_changes")
        .select("id,subactivity_id,provider,revision,branch,message,committed_at")
        .in("subactivity_id", ids)
        .order("committed_at", { ascending: false })
      if (error) {
        if (error.code === "42P01" || error.code === "42703") return
        console.warn("Não foi possível carregar os commits vinculados à AQS.", error)
        return
      }
      const grouped: Record<string, DeveloperTaskVcsChange[]> = {}
      for (const row of data ?? []) {
        const subactivityId = row.subactivity_id ? String(row.subactivity_id) : ""
        if (!subactivityId) continue
        const item: DeveloperTaskVcsChange = {
          id: String(row.id),
          provider: String(row.provider) === "svn" ? "svn" : "git",
          revision: String(row.revision ?? ""),
          branch: String(row.branch ?? ""),
          message: String(row.message ?? ""),
          committedAt: String(row.committed_at ?? ""),
        }
        grouped[subactivityId] = [...(grouped[subactivityId] ?? []), item]
      }
      setVcsChangesBySubactivity(grouped)
    } catch (error) {
      console.warn("Não foi possível carregar os commits vinculados à AQS.", error)
    }
  }, [vcsSubactivityKey])

  React.useEffect(() => {
    void loadVcsChanges()
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null
    try {
      const supabase = createClient()
      channel = supabase
        .channel(`aqs-vcs-workspace-${currentUserId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "developer_vcs_changes" }, () => void loadVcsChanges())
        .subscribe()
    } catch {
      // A fila AQS permanece funcional sem a tabela opcional de commits.
    }
    return () => {
      if (channel) void createClient().removeChannel(channel)
    }
  }, [currentUserId, loadVcsChanges])

  const focusSubactivity = React.useCallback((subactivityId: string) => {
    const target = locatedReviews.find((item) => item.sub.id === subactivityId)
    if (!target) return
    if (!reviewMatchesFilter(target.review, filter)) setFilter("all")
    setSelectedProjectId(target.project.id)
    setSelectedReviewId(target.review.id)
    setMobileNavigatorOpen(false)
  }, [filter, locatedReviews])

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const initialSub = params.get("sub")
    if (initialSub) focusSubactivity(initialSub)

    function onFocus(event: Event) {
      const subactivityId = (event as CustomEvent<{ subactivityId?: string }>).detail?.subactivityId
      if (subactivityId) focusSubactivity(subactivityId)
    }
    window.addEventListener("devboard:focus-analysis", onFocus)
    return () => window.removeEventListener("devboard:focus-analysis", onFocus)
  }, [focusSubactivity])

  React.useEffect(() => {
    if (!selected) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("sub") === selected.sub.id) return
    url.searchParams.set("sub", selected.sub.id)
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
  }, [selected])

  React.useEffect(() => {
    if (!selectedReviewId) return
    window.requestAnimationFrame(() => {
      const viewport = timelineRef.current
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
  }, [selectedReviewId])

  const timeline = React.useMemo<TimelineItem[]>(() => {
    if (!selected) return []
    const { review, sub } = selected
    const items: TimelineItem[] = [
      {
        id: `review-created-${review.id}`,
        kind: "system",
        createdAt: review.createdAt,
        title: "Desenvolvimento enviado para análise AQS",
        description: "A subatividade entrou na fila de validação.",
        tone: "primary",
      },
    ]
    if (review.startedAt) {
      items.push({
        id: `review-started-${review.id}`,
        kind: "system",
        createdAt: review.startedAt,
        title: "Análise AQS iniciada",
        description: "O item foi assumido para validação.",
        tone: "primary",
      })
    }
    if (review.completedAt) {
      items.push({
        id: `review-completed-${review.id}`,
        kind: "system",
        createdAt: review.completedAt,
        title: "AQS concluiu a análise",
        description: "A subatividade foi aprovada e concluída no projeto.",
        tone: "success",
      })
    }
    if (review.revokedAt) {
      items.push({
        id: `review-revoked-${review.id}`,
        kind: "system",
        createdAt: review.revokedAt,
        title: "AQS revogou a análise",
        description: review.revokedReason ? `${review.revokedReason} · A subatividade retornou ao desenvolvedor.` : "A subatividade retornou ao desenvolvedor.",
        tone: "danger",
      })
    }
    for (const entry of sub.comments ?? []) {
      items.push({ id: `comment-${entry.id}`, kind: "comment", createdAt: entry.createdAt, comment: entry })
    }
    for (const entry of (sub.attachments ?? []).filter((attachment) => attachment.active)) {
      items.push({ id: `attachment-${entry.id}`, kind: "attachment", createdAt: entry.createdAt, attachment: entry })
    }
    for (const log of selected.project.logs ?? []) {
      if (!isActivityMeetingLog(log, selected.activity.id)) continue
      items.push({
        id: `meeting-${log.id}`,
        kind: "system",
        createdAt: log.createdAt,
        title: log.title,
        description: visibleMeetingLogDescription(log.description),
        tone: "meeting",
      })
    }
    return items.sort((a, b) => safeTime(a.createdAt) - safeTime(b.createdAt))
  }, [selected])

  async function withBusy(id: string, action: () => Promise<boolean>) {
    setBusy((current) => new Set(current).add(id))
    try {
      return await action()
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  async function startReview(review: AqsReview) {
    if (!canReview || review.status !== "awaiting") return
    await withBusy(review.id, () => startAqsReview(review.id))
  }

  async function completeReview(review: AqsReview) {
    if (!canReview || review.status !== "evaluating") return
    await withBusy(review.id, () => completeAqsReview(review.id))
  }

  async function confirmRevoke() {
    if (!revokeTarget || reason.trim().length < 3) return
    const ok = await withBusy(revokeTarget.id, () => revokeAqsReview(revokeTarget.id, reason.trim()))
    if (ok) {
      setRevokeTarget(null)
      setReason("")
    }
  }

  async function sendComment() {
    if (!selected || !comment.trim() || sendingComment) return
    setSendingComment(true)
    try {
      const result = await addSubactivityComment(selected.sub.id, comment.trim())
      if (result !== false) setComment("")
    } finally {
      setSendingComment(false)
    }
  }

  const lockedByOther = selected?.review.status === "evaluating"
    && Boolean(selected.review.assignedAqsId && selected.review.assignedAqsId !== currentUserId && currentUserRole !== "admin")
  const selectedDeveloper = selected ? members.find((member) => member.id === selected.sub.assigneeId) : undefined
  const selectedAqs = selected ? members.find((member) => member.id === selected.review.assignedAqsId) : undefined
  const selectedCreatedBy = selected ? members.find((member) => member.id === selected.review.createdBy) : undefined

  const selectedProject = projectGroups.find((project) => project.id === selectedProjectId) ?? null
  const selectedProjectActiveCount = selectedProject
    ? visibleReviews.filter((item) => item.project.id === selectedProject.id && (item.review.status === "awaiting" || item.review.status === "evaluating")).length
    : 0

  function selectReview(item: LocatedReview) {
    setSelectedReviewId(item.review.id)
    setSelectedProjectId(item.project.id)
    setMobileNavigatorOpen(false)
  }

  function toggleActivity(activityId: string) {
    setCollapsedActivities((current) => {
      const next = new Set(current)
      if (next.has(activityId)) next.delete(activityId)
      else next.add(activityId)
      return next
    })
  }

  const navigator = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{selectedProject?.name ?? "Fila AQS"}</p>
            <p className="mt-0.5 text-[0.61rem] text-muted-foreground">
              Projetos <ChevronRight className="mx-0.5 inline size-2.5" /> Atividades <ChevronRight className="mx-0.5 inline size-2.5" /> Subatividades
            </p>
          </div>
          {selectedProjectActiveCount > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[0.58rem] text-primary">{selectedProjectActiveCount}</span>}
        </div>

        <div className="mt-3 flex h-9 min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5 focus-within:border-primary/35">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar na análise..."
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
          {search && <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground" aria-label="Limpar busca"><X className="size-3.5" /></button>}
        </div>

        <label className="mt-2 block">
          <span className="sr-only">Filtrar análises AQS</span>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as ReviewFilter)}
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs outline-none transition-colors hover:bg-muted focus:border-primary/35"
          >
            <option value="active">Fila AQS · {counts.active}</option>
            <option value="awaiting">Aguardando · {counts.awaiting}</option>
            <option value="evaluating">Em análise · {counts.evaluating}</option>
            <option value="completed">Concluídas · {counts.completed}</option>
            <option value="revoked">Revogadas · {counts.revoked}</option>
            <option value="all">Todas · {counts.all}</option>
          </select>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin]">
        {!selectedProject ? (
          <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 text-center">
            <ClipboardCheck className="size-5 text-muted-foreground/55" />
            <p className="mt-3 text-xs font-medium">Nenhum item nesta visão</p>
            <p className="mt-1 text-[0.65rem] leading-relaxed text-muted-foreground">Ajuste o filtro ou aguarde novas subatividades em Aguardando AQS.</p>
          </div>
        ) : (
          selectedProject.activities.map((activity) => {
            const activityItems = reviewsInSelectedProject.filter((item) => item.activity.id === activity.id)
            if (!activityItems.length) return null
            const collapsed = collapsedActivities.has(activity.id)
            return (
              <section key={activity.id} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggleActivity(activity.id)}
                  className="flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[0.66rem] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronDown className={cn("size-3 shrink-0 transition-transform", collapsed && "-rotate-90")} />
                  <span className="min-w-0 flex-1 truncate" title={activity.title}>{activity.title}</span>
                  <span className="font-mono text-[0.56rem] font-normal">{activityItems.length}</span>
                </button>
                {!collapsed && (
                  <div className="mt-0.5 space-y-0.5">
                    {activityItems.map((item) => {
                      const developer = members.find((member) => member.id === item.sub.assigneeId)
                      const selectedItem = item.review.id === selectedReviewId
                      const meta = reviewMeta[item.review.status]
                      return (
                        <button
                          type="button"
                          key={item.review.id}
                          onClick={() => selectReview(item)}
                          className={cn(
                            "group flex w-full min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                            selectedItem ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                          )}
                        >
                          <Hash className={cn("mt-0.5 size-3.5 shrink-0", selectedItem ? "text-primary" : "text-muted-foreground/65")} />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={item.sub.title}>{item.sub.title}</span>
                              <span className={cn("size-1.5 shrink-0 rounded-full", meta.dot)} title={meta.label} />
                            </div>
                            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[0.58rem]">
                              <MemberAvatar member={developer} className="size-4 text-[0.42rem] ring-0" />
                              <span className="min-w-0 flex-1 truncate"><MemberName member={developer} fallback="Sem DEV" /></span>
                              <span className="shrink-0 font-mono">{elapsed(item.review.createdAt)}</span>
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })
        )}
      </div>
    </div>
  )

  const details = selected ? (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-muted/10 p-3 [scrollbar-width:thin]">
      <section className="rounded-xl border border-border bg-card p-3">
        <h2 className="text-xs font-semibold">Responsáveis</h2>
        <div className="mt-3 space-y-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <MemberAvatar member={selectedDeveloper} className="size-8" />
            <div className="min-w-0 flex-1">
              <p className="text-[0.56rem] font-medium uppercase tracking-wide text-muted-foreground">Desenvolvedor</p>
              <p className="truncate text-xs font-semibold"><MemberName member={selectedDeveloper} fallback="Sem responsável" /></p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2.5">
            {selectedAqs ? <MemberAvatar member={selectedAqs} className="size-8" /> : <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"><ShieldCheck className="size-3.5" /></span>}
            <div className="min-w-0 flex-1">
              <p className="text-[0.56rem] font-medium uppercase tracking-wide text-muted-foreground">AQS responsável</p>
              <p className="truncate text-xs font-semibold"><MemberName member={selectedAqs} fallback="Não atribuído" /></p>
            </div>
          </div>
          {selectedCreatedBy && selectedCreatedBy.id !== selectedDeveloper?.id && (
            <div className="flex min-w-0 items-center gap-2.5">
              <MemberAvatar member={selectedCreatedBy} className="size-8" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.56rem] font-medium uppercase tracking-wide text-muted-foreground">Enviado por</p>
                <p className="truncate text-xs font-semibold"><MemberName member={selectedCreatedBy} fallback="Usuário" /></p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="mt-3 rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold">Fluxo AQS</h2>
          <span className={cn("rounded-full px-2 py-0.5 text-[0.56rem] font-medium", reviewMeta[selected.review.status].badge)}>{reviewMeta[selected.review.status].shortLabel}</span>
        </div>
        <div className="mt-3 space-y-2.5">
          <div className="flex gap-2.5">
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary"><Check className="size-3" /></span>
            <div><p className="text-[0.66rem] font-medium">Enviado ao AQS</p><p className="mt-0.5 font-mono text-[0.55rem] text-muted-foreground">{formatDate(selected.review.createdAt)}</p></div>
          </div>
          <div className="flex gap-2.5">
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", selected.review.startedAt ? "bg-primary/12 text-primary" : "bg-muted text-muted-foreground")}>
              {selected.review.startedAt ? <Check className="size-3" /> : <Clock3 className="size-3" />}
            </span>
            <div><p className="text-[0.66rem] font-medium">Em validação</p><p className="mt-0.5 font-mono text-[0.55rem] text-muted-foreground">{selected.review.startedAt ? formatDate(selected.review.startedAt) : "Aguardando AQS"}</p></div>
          </div>
          <div className="flex gap-2.5">
            <span className={cn(
              "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
              selected.review.status === "completed" ? "bg-success/12 text-success" : selected.review.status === "revoked" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
            )}>
              {selected.review.status === "completed" ? <Check className="size-3" /> : selected.review.status === "revoked" ? <RotateCcw className="size-3" /> : <Clock3 className="size-3" />}
            </span>
            <div>
              <p className="text-[0.66rem] font-medium">Resultado</p>
              <p className="mt-0.5 font-mono text-[0.55rem] text-muted-foreground">
                {selected.review.status === "completed" ? formatDate(selected.review.completedAt) : selected.review.status === "revoked" ? formatDate(selected.review.revokedAt) : "Pendente"}
              </p>
            </div>
          </div>
        </div>
        {selected.review.revokedReason && (
          <div className="mt-3 rounded-lg bg-destructive/8 p-2.5 text-[0.63rem] leading-relaxed text-destructive">
            <strong className="block">Ajustes solicitados</strong>
            <span className="mt-1 block text-destructive/90">{selected.review.revokedReason}</span>
          </div>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-border bg-card p-3">
        <h2 className="text-xs font-semibold">Informações</h2>
        <dl className="mt-3 space-y-2 text-[0.64rem]">
          <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Tempo trabalhado</dt><dd className="font-mono font-medium">{formatHMS(selected.sub.trackedSeconds)}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Estimativa</dt><dd className="font-mono font-medium">{selected.sub.estimatedHours || 0}h</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Comentários</dt><dd className="font-mono font-medium">{selected.sub.comments?.length ?? 0}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Evidências</dt><dd className="font-mono font-medium">{selected.sub.attachments?.filter((item) => item.active).length ?? 0}</dd></div>
        </dl>
      </section>

      <section className="mt-3 rounded-xl border border-border bg-card p-3">
        <h2 className="text-xs font-semibold">Ferramentas</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          <AttachmentDialog
            title={`Evidências AQS · ${selected.sub.title}`}
            description="Prints, vídeos, documentos, SQL e demais evidências da análise."
            attachments={selected.sub.attachments ?? []}
            onAdd={(files) => addSubactivityAttachments(selected.sub.id, files)}
            onSetActive={(attachmentId, active) => setSubactivityAttachmentActive(selected.sub.id, attachmentId, active)}
            buttonLabel="Evidências"
          />
          <DeveloperVcsTaskChanges changes={vcsChangesBySubactivity[selected.sub.id] ?? []} taskTitle={selected.sub.title} />
        </div>
      </section>
    </div>
  ) : null

  return (
    <section className="relative flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Análise AQS">
      <header className="flex min-h-[58px] shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 sm:px-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ClipboardCheck className="size-4" />
        </span>
        <div className="hidden min-w-0 md:block">
          <h1 className="text-sm font-semibold leading-tight">Análise AQS</h1>
          <p className="mt-0.5 text-[0.66rem] text-muted-foreground">Validação do DEV em uma única visão: projeto, atividade, subatividade, evidências e decisão.</p>
        </div>

        <div className="ml-0 flex min-w-0 flex-1 items-center gap-2 md:ml-4">
          <label className="min-w-0 flex-1 md:max-w-md xl:hidden">
            <span className="sr-only">Projeto da fila AQS</span>
            <select
              value={selectedProjectId ?? ""}
              onChange={(event) => {
                setSelectedProjectId(event.target.value)
                const first = visibleReviews.find((item) => item.project.id === event.target.value)
                setSelectedReviewId(first?.review.id ?? null)
              }}
              disabled={!projectGroups.length}
              className="h-9 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-xs font-medium outline-none transition-colors hover:bg-muted focus:border-primary/40 disabled:opacity-60"
            >
              {!projectGroups.length && <option value="">Nenhuma análise disponível</option>}
              {projectGroups.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          {selectedProject && (
            <div className="hidden min-w-0 items-center gap-2 xl:flex">
              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">
                <ProjectIcon icon={selectedProject.icon} imageUrl={selectedProject.iconImageUrl} className="size-4" imageClassName="size-full rounded-none object-cover" />
              </span>
              <div className="min-w-0">
                <p className="max-w-[280px] truncate text-xs font-semibold">{selectedProject.name}</p>
                <p className="text-[0.59rem] text-muted-foreground">{reviewsInSelectedProject.length} {reviewsInSelectedProject.length === 1 ? "subatividade" : "subatividades"} nesta visão</p>
              </div>
            </div>
          )}
        </div>

        <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
          <span className="rounded-lg bg-muted px-2 py-1 text-[0.58rem] text-muted-foreground"><strong className="font-mono text-foreground">{counts.awaiting}</strong> aguardando</span>
          <span className="rounded-lg bg-muted px-2 py-1 text-[0.58rem] text-muted-foreground"><strong className="font-mono text-foreground">{counts.evaluating}</strong> em análise</span>
        </div>
      </header>

      {!canReview && (
        <div className="shrink-0 border-b border-border bg-muted/20 px-3 py-2 text-[0.66rem] text-muted-foreground sm:px-4">
          Você está em modo de acompanhamento. Apenas AQS e Administradores podem assumir, concluir ou revogar análises.
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-card">
        <nav className="hidden w-16 shrink-0 min-h-0 flex-col border-r border-border bg-muted/30 xl:flex" aria-label="Projetos com análise AQS">
          <div className="flex h-12 items-center justify-center border-b border-border"><FolderKanban className="size-4 text-muted-foreground" /></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex flex-col items-center gap-2">
              {projectGroups.map((project) => {
                const projectReviews = visibleReviews.filter((item) => item.project.id === project.id)
                const active = project.id === selectedProjectId
                const pending = projectReviews.filter((item) => item.review.status === "awaiting" || item.review.status === "evaluating").length
                return (
                  <button
                    type="button"
                    key={project.id}
                    onClick={() => {
                      setSelectedProjectId(project.id)
                      setSelectedReviewId(projectReviews[0]?.review.id ?? null)
                    }}
                    title={`${project.name} · ${projectReviews.length} análises`}
                    className={cn(
                      "relative flex size-10 items-center justify-center overflow-visible rounded-xl text-xs font-semibold transition-all",
                      active ? "rounded-[14px] bg-primary text-primary-foreground shadow-sm" : "bg-card text-muted-foreground ring-1 ring-foreground/8 hover:rounded-[14px] hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    <span className="flex size-full items-center justify-center overflow-hidden rounded-[inherit]">
                      <ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-4" imageClassName="size-full rounded-[inherit] object-cover" />
                    </span>
                    {active && <span className="absolute -left-2.5 h-6 w-1 rounded-r-full bg-primary" />}
                    {pending > 0 && <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[0.5rem] leading-4 text-primary-foreground ring-2 ring-card">{pending}</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </nav>

        <aside className="hidden w-[300px] shrink-0 min-h-0 flex-col border-r border-border bg-muted/20 md:flex">
          {navigator}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background/55">
          {selected ? (
            <>
              <header className="flex min-h-12 min-w-0 items-center gap-2 border-b border-border bg-card/90 px-2.5 py-2 backdrop-blur sm:px-3">
                <Button type="button" variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setMobileNavigatorOpen(true)} aria-label="Abrir projetos e atividades">
                  <Menu className="size-4" />
                </Button>
                <Hash className="hidden size-4 shrink-0 text-muted-foreground sm:block" />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="hidden max-w-[220px] truncate text-[0.64rem] text-muted-foreground lg:inline">{selected.activity.title}</span>
                    <ChevronRight className="hidden size-3 shrink-0 text-muted-foreground/60 lg:block" />
                    <strong className="truncate text-xs sm:text-sm" title={selected.sub.title}>{selected.sub.title}</strong>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[0.58rem] text-muted-foreground sm:hidden">
                    <span className={cn("size-1.5 rounded-full", reviewMeta[selected.review.status].dot)} />
                    <span>{reviewMeta[selected.review.status].shortLabel}</span>
                  </div>
                </div>

                <span className={cn("hidden shrink-0 rounded-full px-2 py-1 text-[0.6rem] font-medium sm:inline-flex", reviewMeta[selected.review.status].badge)}>{reviewMeta[selected.review.status].shortLabel}</span>

                <ActivityMeetingButton activityId={selected.activity.id} />

                {canReview && selected.review.status === "awaiting" && (
                  <Button type="button" size="sm" onClick={() => void startReview(selected.review)} loading={busy.has(selected.review.id)}>
                    <ShieldCheck className="size-3.5" /> Avaliar
                  </Button>
                )}
                {canReview && selected.review.status === "evaluating" && (
                  <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={lockedByOther || busy.has(selected.review.id)} onClick={() => { setReason(""); setRevokeTarget(selected.review) }}>
                      <RotateCcw className="size-3.5" /> Revogar
                    </Button>
                    <Button type="button" size="sm" disabled={lockedByOther} loading={busy.has(selected.review.id)} onClick={() => void completeReview(selected.review)}>
                      <CheckCircle2 className="size-3.5" /> Concluir
                    </Button>
                  </div>
                )}
                <Button type="button" variant="ghost" size="icon-sm" className="xl:hidden" onClick={() => setMobileDetailsOpen(true)} aria-label="Ver detalhes da análise">
                  <Info className="size-4" />
                </Button>
              </header>

              {lockedByOther && (
                <div className="shrink-0 border-b border-border bg-chart-3/[0.06] px-3 py-2 text-[0.62rem] text-muted-foreground">
                  Esta análise está com <strong className="font-medium text-foreground"><MemberName member={selectedAqs} fallback="outro AQS" /></strong>. Você pode acompanhar, mas não alterar o resultado.
                </div>
              )}

              <div ref={timelineRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 lg:px-6 [scrollbar-width:thin]">
                <div className="w-full min-w-0">
                  <div className="mb-5 border-b border-border pb-5">
                    <div className="flex items-start gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ClipboardCheck className="size-5" /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.62rem] text-muted-foreground">
                          <span className="truncate">{selected.project.name}</span><ChevronRight className="size-3" /><span className="truncate">{selected.activity.title}</span>
                        </div>
                        <h2 className="mt-1 break-words text-lg font-semibold">{selected.sub.title}</h2>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Histórico de validação, comentários e evidências da subatividade em uma única conversa.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-0.5">
                    {timeline.map((item) => {
                      if (item.kind === "system") {
                        const toneClass = item.tone === "success" ? "bg-success/10 text-success" : item.tone === "danger" ? "bg-destructive/10 text-destructive" : item.tone === "meeting" ? "bg-chart-2/10 text-chart-2" : "bg-primary/10 text-primary"
                        return (
                          <article key={item.id} className="flex min-w-0 gap-3 rounded-xl px-2 py-2.5 sm:px-3">
                            <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full", toneClass)}>
                              {item.tone === "success" ? <CheckCircle2 className="size-4" /> : item.tone === "danger" ? <RotateCcw className="size-4" /> : item.tone === "meeting" ? <Video className="size-4" /> : <ShieldCheck className="size-4" />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <strong className="text-xs">{item.title}</strong>
                                <time className="shrink-0 font-mono text-[0.58rem] text-muted-foreground">{formatDate(item.createdAt)}</time>
                              </div>
                              {item.description && <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{item.description}</p>}
                            </div>
                          </article>
                        )
                      }

                      if (item.kind === "comment") {
                        const author = members.find((member) => member.id === item.comment.authorId)
                        return (
                          <article key={item.id} className="group flex min-w-0 gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/35 sm:px-3">
                            <MemberAvatar member={author} className="mt-0.5 size-9 text-[0.68rem]" />
                            <div className="min-w-0 flex-1">
                              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                                <strong className="truncate text-xs"><MemberName member={author} fallback="Usuário" /></strong>
                                <time className="shrink-0 font-mono text-[0.58rem] text-muted-foreground">{formatDate(item.createdAt)}</time>
                              </div>
                              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">{item.comment.content}</p>
                            </div>
                          </article>
                        )
                      }

                      const uploader = members.find((member) => member.id === item.attachment.uploadedBy)
                      return (
                        <article key={item.id} className="group flex min-w-0 gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/35 sm:px-3">
                          <MemberAvatar member={uploader} className="mt-0.5 size-9 text-[0.68rem]" />
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                              <strong className="truncate text-xs"><MemberName member={uploader} fallback="Usuário" /></strong>
                              <time className="shrink-0 font-mono text-[0.58rem] text-muted-foreground">{formatDate(item.createdAt)}</time>
                            </div>
                            <div className="mt-2 flex max-w-xl min-w-0 items-center gap-2.5 rounded-xl border border-border bg-card p-3">
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><AttachmentKindIcon attachment={item.attachment} /></span>
                              <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={item.attachment.name}>{item.attachment.name}</p><p className="mt-0.5 text-[0.58rem] text-muted-foreground">{formatBytes(item.attachment.size)} · evidência</p></div>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="shrink-0 border-t border-border bg-card px-3 py-3 sm:px-4">
                {canReview && selected.review.status === "evaluating" && (
                  <div className="mb-2 flex items-center gap-2 sm:hidden">
                    <Button type="button" size="sm" variant="outline" className="flex-1 text-destructive hover:text-destructive" disabled={lockedByOther || busy.has(selected.review.id)} onClick={() => { setReason(""); setRevokeTarget(selected.review) }}><RotateCcw className="size-3.5" /> Revogar</Button>
                    <Button type="button" size="sm" className="flex-1" disabled={lockedByOther} loading={busy.has(selected.review.id)} onClick={() => void completeReview(selected.review)}><CheckCircle2 className="size-3.5" /> Concluir</Button>
                  </div>
                )}
                <div className="flex min-w-0 items-end gap-2 rounded-xl border border-border bg-background px-2.5 py-2 focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/8">
                  <AttachmentDialog
                    title={`Evidências AQS · ${selected.sub.title}`}
                    description="Anexe ou consulte prints, vídeos, documentos, SQL e demais evidências da análise."
                    attachments={selected.sub.attachments ?? []}
                    onAdd={(files) => addSubactivityAttachments(selected.sub.id, files)}
                    onSetActive={(attachmentId, active) => setSubactivityAttachmentActive(selected.sub.id, attachmentId, active)}
                    compact
                    buttonLabel="Evidências"
                    className="mb-0.5 shrink-0"
                  />
                  <textarea
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        void sendComment()
                      }
                    }}
                    rows={1}
                    maxLength={1200}
                    placeholder={`Conversar em “${selected.sub.title}”`}
                    className="max-h-28 min-h-7 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <Button type="button" size="icon-sm" onClick={() => void sendComment()} disabled={!comment.trim()} loading={sendingComment} title="Enviar comentário">
                    <Send className="size-3.5" /><span className="sr-only">Enviar comentário</span>
                  </Button>
                </div>
                <p className="mt-1.5 px-1 text-[0.56rem] text-muted-foreground">Enter envia · Shift+Enter quebra a linha · evidências ficam vinculadas à subatividade.</p>
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-0 items-center justify-center p-6 text-center">
              <div>
                <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"><ClipboardCheck className="size-5" /></span>
                <h2 className="mt-4 text-sm font-semibold">Nenhuma análise selecionada</h2>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">A fila mostra as subatividades enviadas pelo desenvolvimento para validação AQS.</p>
              </div>
            </div>
          )}
        </main>

        <aside className="hidden w-[260px] shrink-0 min-h-0 border-l border-border bg-muted/15 xl:block">
          {details}
        </aside>
      </div>

      {mobileNavigatorOpen && (
        <div className="absolute inset-0 z-50 flex md:hidden">
          <button type="button" className="absolute inset-0 bg-black/45" onClick={() => setMobileNavigatorOpen(false)} aria-label="Fechar navegação" />
          <aside className="relative z-10 h-full w-[min(88vw,330px)] border-r border-border bg-card shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-border px-3"><span className="text-xs font-semibold">Fila AQS</span><Button type="button" variant="ghost" size="icon-sm" onClick={() => setMobileNavigatorOpen(false)}><X className="size-4" /></Button></div>
            <div className="h-[calc(100%-3rem)]">{navigator}</div>
          </aside>
        </div>
      )}

      {mobileDetailsOpen && selected && (
        <div className="absolute inset-0 z-50 flex justify-end xl:hidden">
          <button type="button" className="absolute inset-0 bg-black/45" onClick={() => setMobileDetailsOpen(false)} aria-label="Fechar detalhes" />
          <aside className="relative z-10 h-full w-[min(88vw,330px)] border-l border-border bg-card shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-border px-3"><span className="text-xs font-semibold">Detalhes da análise</span><Button type="button" variant="ghost" size="icon-sm" onClick={() => setMobileDetailsOpen(false)}><X className="size-4" /></Button></div>
            <div className="h-[calc(100%-3rem)]">{details}</div>
          </aside>
        </div>
      )}

      <Dialog open={Boolean(revokeTarget)} onOpenChange={(open) => { if (!open) setRevokeTarget(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar análise AQS?</DialogTitle>
            <DialogDescription>A subatividade voltará para <strong>Aguardando</strong>, ficará sinalizada para ajuste e o desenvolvedor responsável será notificado.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Motivo / ajustes necessários</span>
            <textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} rows={5} placeholder="Descreva objetivamente o que precisa ser corrigido..." className="resize-none rounded-xl border border-border bg-card p-3 text-sm outline-none focus:border-ring" />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={reason.trim().length < 3} loading={Boolean(revokeTarget && busy.has(revokeTarget.id))} onClick={() => void confirmRevoke()}>Revogar e devolver ao DEV</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
