"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useTheme } from "next-themes"
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Hash,
  Inbox,
  LoaderCircle,
  MessageCircleMore,
  Moon,
  Plus,
  Search,
  Settings,
  PanelLeftOpen,
  PanelLeftClose,
  LogOut,
  ShieldCheck,
  Sun,
  Trash2,
  UsersRound,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { scopeFollowUpProjects } from "@/lib/follow-up-access"
import { statusMeta } from "@/lib/project-utils"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { toUserFacingError } from "@/lib/user-facing-error"
import { ProjectIcon } from "@/components/projects/project-icon"
import { ProjectFollowUp } from "@/components/project-detail/project-follow-up"
import { RequestDetail } from "@/components/requests/request-detail"
import { NewServiceRequestDialog } from "@/components/requests/request-create-dialog"
import { FollowUpAddActivityDialog, FollowUpAddSubactivityDialog } from "@/components/project-detail/follow-up-structure-dialogs"
import { ChatView } from "@/components/chat/chat-view"
import { MemberAvatar } from "@/components/member-avatar"
import { RecentSubactivities } from "@/components/recent-subactivities"
import { NotificationCenter } from "@/components/notifications/notification-center"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SERVICE_REQUEST_STATUS_LABELS, serviceRequestReference } from "@/lib/service-requests"
import type { AqsReview, Project } from "@/lib/types"

type DiscordSpace = "project" | "channels" | "requests" | "aqs" | "chat"

type WorkspaceChannel = {
  id: string
  workspaceId: string
  conversationId: string
  name: string
  description?: string
  createdBy: string
  closedAt?: string
  closedBy?: string
  createdAt: string
  updatedAt: string
}

type SearchResult = {
  key: string
  kind: "Canal" | "Projeto" | "Tópico" | "Solicitação" | "Análise AQS" | "Área"
  title: string
  subtitle?: string
  closed?: boolean
  target: Record<string, string | undefined>
}

const CLOSED_REQUEST_STATUSES = new Set(["completed", "rejected", "cancelled"])

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
}

function projectFirstSub(project?: Project | null) {
  if (!project) return null
  for (const activity of project.activities) {
    const running = activity.subactivities.find((sub) => sub.status === "in-progress")
    if (running) return { activityId: activity.id, subactivityId: running.id }
  }
  for (const activity of project.activities) {
    const open = activity.subactivities.find((sub) => sub.status !== "done" && sub.status !== "cancelled")
    if (open) return { activityId: activity.id, subactivityId: open.id }
  }
  const activity = project.activities[0]
  const sub = activity?.subactivities[0]
  return activity && sub ? { activityId: activity.id, subactivityId: sub.id } : null
}

function ProjectServerButton({ project, active, unread, expanded, onClick }: { project: Project; active: boolean; unread: "mention" | "unread" | null; expanded?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={project.name} className={cn("group relative flex h-12 w-full items-center transition-colors", expanded ? "justify-start gap-2 px-2" : "justify-center")}>
      <span className={cn("absolute left-0 w-1 rounded-r-full bg-foreground transition-all", active ? "h-10" : unread ? "h-2" : "h-0 group-hover:h-5")} />
      <span className={cn(
        "relative flex size-11 shrink-0 items-center justify-center overflow-visible rounded-[22px] bg-muted text-muted-foreground ring-1 ring-border transition-all duration-150 group-hover:rounded-[15px] group-hover:bg-primary/15 group-hover:text-primary",
        active && "rounded-[15px] bg-primary text-primary-foreground ring-primary",
      )}>
        <span className="flex size-full items-center justify-center overflow-hidden rounded-[inherit]">
          <ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-5" imageClassName="size-full rounded-[inherit] object-cover" />
        </span>
        {unread === "mention" && <span className="absolute -bottom-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.52rem] font-bold leading-4 text-destructive-foreground ring-2 ring-background">@</span>}
        {unread === "unread" && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-sky-400 ring-2 ring-background" />}
      </span>
      {expanded && <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground/85">{project.name}</span>}
    </button>
  )
}

function SpecialServerButton({ title, active, icon: Icon, badge, expanded, onClick }: { title: string; active: boolean; icon: typeof Inbox; badge?: number; expanded?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={title} className={cn("group relative flex h-12 w-full items-center transition-colors", expanded ? "justify-start gap-2 px-2" : "justify-center")}>
      <span className={cn("absolute left-0 w-1 rounded-r-full bg-foreground transition-all", active ? "h-10" : "h-0 group-hover:h-5")} />
      <span className={cn("relative flex size-11 shrink-0 items-center justify-center rounded-[22px] bg-muted text-muted-foreground ring-1 ring-border transition-all group-hover:rounded-[15px] group-hover:bg-primary group-hover:text-primary-foreground", active && "rounded-[15px] bg-primary text-primary-foreground ring-primary")}>
        <Icon className="size-5" />
        {!!badge && <span className="absolute -bottom-1 -right-1 min-w-4 rounded-full bg-destructive px-1 text-center font-mono text-[0.5rem] font-bold leading-4 text-destructive-foreground ring-2 ring-background">{badge > 99 ? "99+" : badge}</span>}
      </span>
      {expanded && <span className="min-w-0 flex-1 truncate text-left text-xs font-medium text-foreground/85">{title}</span>}
    </button>
  )
}

function ChannelButton({ active, label, muted, statusClass, onClick }: { active: boolean; label: string; muted?: string; statusClass?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[0.82rem] transition-colors", active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
      <Hash className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {statusClass && <span className={cn("size-1.5 shrink-0 rounded-full", statusClass)} />}
      {muted && <span className="max-w-20 shrink-0 truncate text-[0.55rem] opacity-60">{muted}</span>}
    </button>
  )
}

function CategoryHeader({ label, open, count, onToggle, actions }: { label: string; open: boolean; count?: number; onToggle: () => void; actions?: React.ReactNode }) {
  return (
    <div className="group/category flex h-7 w-full min-w-0 items-center gap-1">
      <button type="button" onClick={onToggle} className="flex h-7 min-w-0 flex-1 items-center gap-1 px-1 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {typeof count === "number" && count > 0 && <span className="font-mono text-[0.54rem] opacity-60">{count}</span>}
      </button>
      {actions && <div className="flex shrink-0 items-center opacity-70 transition-opacity group-hover/category:opacity-100">{actions}</div>}
    </div>
  )
}

function AqsActionBar({ review }: { review: AqsReview }) {
  const { currentUserRole, startAqsReview, completeAqsReview, revokeAqsReview } = useStore()
  const canReview = currentUserRole === "admin" || currentUserRole === "aqs"
  const [busy, setBusy] = React.useState(false)
  const [revokeOpen, setRevokeOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  if (!canReview) return null

  async function run(action: () => Promise<boolean>) {
    if (busy) return
    setBusy(true)
    try { await action() } finally { setBusy(false) }
  }

  return (
    <>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <ShieldCheck className="size-4 text-primary" />
        <span className="text-xs font-semibold">Análise AQS</span>
        <span className={cn("rounded-full px-2 py-1 text-[0.6rem] font-semibold", review.status === "awaiting" ? "bg-warning/10 text-warning" : review.status === "evaluating" ? "bg-primary/10 text-primary" : review.status === "completed" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>{review.status === "awaiting" ? "Aguardando" : review.status === "evaluating" ? "Em análise" : review.status === "completed" ? "Concluída" : "Revogada"}</span>
        <div className="ml-auto flex items-center gap-2">
          {review.status === "awaiting" && <Button size="sm" disabled={busy} onClick={() => void run(() => startAqsReview(review.id))}>Assumir análise</Button>}
          {review.status === "evaluating" && <><Button size="sm" variant="outline" disabled={busy} onClick={() => setRevokeOpen(true)}>Revogar</Button><Button size="sm" disabled={busy} onClick={() => void run(() => completeAqsReview(review.id))}>Aprovar</Button></>}
        </div>
      </div>
      <Dialog open={revokeOpen} onOpenChange={(open) => !busy && setRevokeOpen(open)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Revogar análise AQS</DialogTitle><DialogDescription>Explique objetivamente o que precisa ser corrigido antes de uma nova validação.</DialogDescription></DialogHeader>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-ring" placeholder="Motivo da revogação..." />
          <DialogFooter><Button variant="outline" onClick={() => setRevokeOpen(false)} disabled={busy}>Cancelar</Button><Button variant="destructive" disabled={busy || reason.trim().length < 5} onClick={() => void run(async () => { const ok = await revokeAqsReview(review.id, reason.trim()); if (ok) { setReason(""); setRevokeOpen(false) } return ok })}>Revogar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function DiscordWorkspace() {
  const { resolvedTheme, setTheme } = useTheme()
  const [themeMounted, setThemeMounted] = React.useState(false)

  React.useEffect(() => setThemeMounted(true), [])

  const isDarkTheme = resolvedTheme === "dark"
  const toggleTheme = React.useCallback(() => {
    setTheme(isDarkTheme ? "light" : "dark")
  }, [isDarkTheme, setTheme])
  const {
    projects,
    serviceRequests,
    aqsReviews,
    notifications,
    members,
    currentUserId,
    currentUserRole,
    workspaceId,
    refreshAll,
    deleteActivity,
    signOut,
  } = useStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = React.useMemo(() => createClient(), [])

  const [channelSearch, setChannelSearch] = React.useState("")
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const [createRequestOpen, setCreateRequestOpen] = React.useState(false)
  const [mobileChannelsOpen, setMobileChannelsOpen] = React.useState(false)
  const [deletingActivityId, setDeletingActivityId] = React.useState<string | null>(null)
  const [workspaceChannels, setWorkspaceChannels] = React.useState<WorkspaceChannel[]>([])
  const [channelsLoading, setChannelsLoading] = React.useState(false)
  const [channelsError, setChannelsError] = React.useState<string | null>(null)
  const [createChannelOpen, setCreateChannelOpen] = React.useState(false)
  const [createChannelBusy, setCreateChannelBusy] = React.useState(false)
  const [createChannelName, setCreateChannelName] = React.useState("")
  const [createChannelDescription, setCreateChannelDescription] = React.useState("")
  const [createChannelError, setCreateChannelError] = React.useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = React.useState(false)
  const [archiveTarget, setArchiveTarget] = React.useState<WorkspaceChannel | null>(null)
  const [commandOpen, setCommandOpen] = React.useState(false)
  const [commandQuery, setCommandQuery] = React.useState("")
  const [commandIndex, setCommandIndex] = React.useState(0)
  const [serverRailExpanded, setServerRailExpanded] = React.useState(false)

  React.useEffect(() => {
    try { setServerRailExpanded(window.localStorage.getItem("taskboard:resumido:server-rail-expanded") === "1") } catch {}
  }, [])

  React.useEffect(() => {
    try { window.localStorage.setItem("taskboard:resumido:server-rail-expanded", serverRailExpanded ? "1" : "0") } catch {}
  }, [serverRailExpanded])

  const collapseServerRailOnSmallScreen = React.useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) setServerRailExpanded(false)
  }, [])

  const accessibleProjects = React.useMemo(() => scopeFollowUpProjects(projects, currentUserId, currentUserRole), [projects, currentUserId, currentUserRole])
  const visibleRequests = React.useMemo(() => serviceRequests, [serviceRequests])
  const visibleReviews = React.useMemo(() => aqsReviews, [aqsReviews])
  const openWorkspaceChannels = React.useMemo(() => workspaceChannels.filter((channel) => !channel.closedAt), [workspaceChannels])
  const workspaceChannelConversationIds = React.useMemo(() => workspaceChannels.map((channel) => channel.conversationId), [workspaceChannels])

  const requestedSpace = searchParams.get("space") as DiscordSpace | null
  const requestedProjectId = searchParams.get("project")
  const requestedRequestId = searchParams.get("request")
  const requestedReviewId = searchParams.get("review")
  const requestedChannelId = searchParams.get("channel")
  const requestedSubId = searchParams.get("sub")
  const requestedActivityId = searchParams.get("activity")

  const space: DiscordSpace = requestedSpace && ["project", "channels", "requests", "aqs", "chat"].includes(requestedSpace)
    ? requestedSpace
    : requestedChannelId ? "channels" : requestedRequestId ? "requests" : requestedReviewId ? "aqs" : "project"

  const selectedProject = accessibleProjects.find((project) => project.id === requestedProjectId) ?? accessibleProjects[0] ?? null
  const selectedRequest = visibleRequests.find((request) => request.id === requestedRequestId) ?? null
  const selectedReview = visibleReviews.find((review) => review.id === requestedReviewId || (!requestedReviewId && requestedSubId && review.subactivityId === requestedSubId)) ?? null
  const selectedWorkspaceChannel = workspaceChannels.find((channel) => channel.id === requestedChannelId)
    ?? (space === "channels" ? openWorkspaceChannels[0] ?? null : null)

  const projectSelection = React.useMemo(() => {
    if (!selectedProject) return null
    if (selectedReview && selectedReview.projectId === selectedProject.id) return { activityId: selectedReview.activityId, subactivityId: selectedReview.subactivityId }
    if (requestedSubId) {
      for (const activity of selectedProject.activities) {
        if (activity.subactivities.some((sub) => sub.id === requestedSubId)) return { activityId: activity.id, subactivityId: requestedSubId }
      }
    }
    if (requestedActivityId) {
      const activity = selectedProject.activities.find((item) => item.id === requestedActivityId)
      const sub = activity?.subactivities[0]
      if (activity && sub) return { activityId: activity.id, subactivityId: sub.id }
    }
    return projectFirstSub(selectedProject)
  }, [requestedActivityId, requestedSubId, selectedProject, selectedReview])

  const currentUser = members.find((member) => member.id === currentUserId)
  const canManageSelectedProject = Boolean(selectedProject && (currentUserRole === "admin" || selectedProject.memberIds.includes(currentUserId)))
  const openRequestsCount = visibleRequests.filter((request) => !CLOSED_REQUEST_STATUSES.has(request.status)).length
  const activeAqsCount = visibleReviews.filter((review) => review.status === "awaiting" || review.status === "evaluating").length
  const isAdmin = currentUserRole === "admin"

  const setLocation = React.useCallback((next: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams()
    Object.entries(next).forEach(([key, value]) => { if (value) params.set(key, value) })
    router.replace(`/?${params.toString()}`, { scroll: false })
  }, [router])

  const loadWorkspaceChannels = React.useCallback(async () => {
    if (!workspaceId) {
      setWorkspaceChannels([])
      return
    }
    setChannelsLoading(true)
    try {
      const { data, error } = await supabase
        .from("workspace_channels")
        .select("id,workspace_id,conversation_id,name,description,created_by,closed_at,closed_by,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .order("closed_at", { ascending: true, nullsFirst: true })
        .order("updated_at", { ascending: false })
      if (error) throw error
      setWorkspaceChannels((data ?? []).map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        conversationId: row.conversation_id,
        name: row.name,
        description: row.description ?? undefined,
        createdBy: row.created_by,
        closedAt: row.closed_at ?? undefined,
        closedBy: row.closed_by ?? undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })))
      setChannelsError(null)
    } catch (error) {
      setChannelsError(toUserFacingError(error, "Não foi possível carregar os canais do workspace"))
    } finally {
      setChannelsLoading(false)
    }
  }, [supabase, workspaceId])

  React.useEffect(() => {
    void loadWorkspaceChannels()
    if (!workspaceId) return
    const realtime = supabase
      .channel(`discord-workspace-channels-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_channels", filter: `workspace_id=eq.${workspaceId}` }, () => void loadWorkspaceChannels())
      .subscribe()
    return () => { void supabase.removeChannel(realtime) }
  }, [loadWorkspaceChannels, supabase, workspaceId])

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.code !== "KeyK") return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setCommandOpen(true)
      setCommandQuery("")
      setCommandIndex(0)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  function selectProject(project: Project) {
    const first = projectFirstSub(project)
    setChannelSearch("")
    setLocation({ space: "project", project: project.id, activity: first?.activityId, sub: first?.subactivityId })
  }

  const projectUnread = React.useCallback((projectId: string) => {
    const unread = notifications.filter((n) => !n.readAt && n.recipientId === currentUserId && n.projectId === projectId)
    if (unread.some((n) => n.type === "followup-mention")) return "mention" as const
    return unread.length ? "unread" as const : null
  }, [currentUserId, notifications])

  async function createWorkspaceChannel() {
    const name = createChannelName.trim().replace(/^#+\s*/, "")
    if (!name || createChannelBusy) return
    setCreateChannelBusy(true)
    setCreateChannelError(null)
    try {
      const { data, error } = await supabase.rpc("create_workspace_channel", {
        p_name: name,
        p_description: createChannelDescription.trim() || null,
      })
      if (error) throw error
      await Promise.all([loadWorkspaceChannels(), refreshAll()])
      setCreateChannelName("")
      setCreateChannelDescription("")
      setCreateChannelOpen(false)
      if (typeof data === "string") setLocation({ space: "channels", channel: data })
    } catch (error) {
      setCreateChannelError(toUserFacingError(error, "Não foi possível criar o canal"))
    } finally {
      setCreateChannelBusy(false)
    }
  }

  async function setChannelClosed(channel: WorkspaceChannel, closed: boolean) {
    if (archiveBusy) return
    const fallbackOpenChannel = closed ? workspaceChannels.find((item) => item.id !== channel.id && !item.closedAt) : null
    setArchiveBusy(true)
    try {
      const { error } = await supabase.rpc("set_workspace_channel_closed", { p_channel_id: channel.id, p_closed: closed })
      if (error) throw error
      await loadWorkspaceChannels()
      setArchiveTarget(null)
      setLocation({ space: "channels", channel: closed ? fallbackOpenChannel?.id : channel.id })
    } catch (error) {
      setChannelsError(toUserFacingError(error, closed ? "Não foi possível fechar o canal" : "Não foi possível reabrir o canal"))
    } finally {
      setArchiveBusy(false)
    }
  }

  const commandResults = React.useMemo<SearchResult[]>(() => {
    const q = normalize(commandQuery.trim())
    const results: SearchResult[] = []
    const matches = (value: string) => !q || normalize(value).includes(q)

    for (const channel of workspaceChannels) {
      // Fechados ficam realmente fora da navegação e só aparecem quando o usuário pesquisa algo.
      if (channel.closedAt && !q) continue
      if (!matches(`${channel.name} ${channel.description ?? ""}`)) continue
      results.push({
        key: `channel:${channel.id}`,
        kind: "Canal",
        title: `# ${channel.name}`,
        subtitle: channel.closedAt ? "Canal fechado · histórico" : channel.description || "Canal do workspace",
        closed: Boolean(channel.closedAt),
        target: { space: "channels", channel: channel.id },
      })
    }

    for (const project of accessibleProjects) {
      if (matches(project.name)) {
        const first = projectFirstSub(project)
        results.push({ key: `project:${project.id}`, kind: "Projeto", title: project.name, subtitle: project.client || "Projeto", target: { space: "project", project: project.id, activity: first?.activityId, sub: first?.subactivityId } })
      }
      if (q) {
        for (const activity of project.activities) {
          for (const sub of activity.subactivities) {
            if (!matches(`${sub.title} ${activity.title} ${project.name}`)) continue
            results.push({ key: `sub:${sub.id}`, kind: "Tópico", title: `# ${sub.title}`, subtitle: `${project.name} · ${activity.title}`, target: { space: "project", project: project.id, activity: activity.id, sub: sub.id } })
          }
        }
      }
    }

    if (q) for (const request of visibleRequests) {
      if (!matches(`${request.title} ${request.orderNumber} ${request.unit} ${request.module}`)) continue
      results.push({ key: `request:${request.id}`, kind: "Solicitação", title: `${serviceRequestReference(request)} · ${request.title}`, subtitle: SERVICE_REQUEST_STATUS_LABELS[request.status], target: { space: "requests", request: request.id } })
    }

    if (q) for (const review of visibleReviews) {
      const project = projects.find((item) => item.id === review.projectId)
      const activity = project?.activities.find((item) => item.id === review.activityId)
      const sub = activity?.subactivities.find((item) => item.id === review.subactivityId)
      if (!matches(`${sub?.title ?? ""} ${activity?.title ?? ""} ${project?.name ?? ""}`)) continue
      results.push({ key: `aqs:${review.id}`, kind: "Análise AQS", title: sub?.title ?? "Análise AQS", subtitle: project?.name, target: { space: "aqs", review: review.id, project: review.projectId, activity: review.activityId, sub: review.subactivityId } })
    }

    if (matches("canais tópicos workspace")) results.push({ key: "area:channels", kind: "Área", title: "Canais", subtitle: "Canais gerais do workspace", target: { space: "channels", channel: openWorkspaceChannels[0]?.id } })
    if (matches("solicitações protocolos atendimento")) results.push({ key: "area:requests", kind: "Área", title: "Solicitações", subtitle: "Protocolos e atendimento", target: { space: "requests", request: visibleRequests.find((item) => !CLOSED_REQUEST_STATUSES.has(item.status))?.id ?? visibleRequests[0]?.id } })
    if (matches("mensagens chat grupos reuniões")) results.push({ key: "area:chat", kind: "Área", title: "Mensagens", subtitle: "Chats, grupos e reuniões", target: { space: "chat" } })

    return results.slice(0, 60)
  }, [accessibleProjects, commandQuery, openWorkspaceChannels, projects, visibleRequests, visibleReviews, workspaceChannels])

  React.useEffect(() => {
    setCommandIndex((current) => Math.min(current, Math.max(0, commandResults.length - 1)))
  }, [commandResults.length])

  function openCommandResult(result: SearchResult) {
    setCommandOpen(false)
    setCommandQuery("")
    setChannelSearch("")
    setLocation(result.target)
  }

  const channelSidebar = React.useMemo(() => {
    const q = normalize(channelSearch.trim())

    if (space === "project" && selectedProject) {
      const projectRequests = visibleRequests.filter((request) => request.projectId === selectedProject.id && !CLOSED_REQUEST_STATUSES.has(request.status))
      const projectReviews = visibleReviews.filter((review) => review.projectId === selectedProject.id && (review.status === "awaiting" || review.status === "evaluating"))
      return (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 shadow-sm">
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{selectedProject.name}</p><p className="truncate text-[0.58rem] text-muted-foreground">{selectedProject.client || "Projeto"}</p></div>
            <UsersRound className="size-4 text-muted-foreground" />
            {canManageSelectedProject && <FollowUpAddActivityDialog projectId={selectedProject.id} />}
          </div>
          <div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={channelSearch} onChange={(e) => setChannelSearch(e.target.value)} placeholder="Buscar canais" className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-8 text-xs outline-none focus:border-ring" />{channelSearch && <button type="button" onClick={() => setChannelSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="size-3.5" /></button>}</div></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
            {selectedProject.activities.map((activity) => {
              const subs = activity.subactivities.filter((sub) => !q || normalize(`${sub.title} ${activity.title}`).includes(q))
              if (q && !subs.length) return null
              const isOpen = q ? true : !collapsed.has(`activity:${activity.id}`)
              return <div key={activity.id} className="mt-1"><CategoryHeader label={activity.title} open={isOpen} count={subs.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); const key = `activity:${activity.id}`; next.has(key) ? next.delete(key) : next.add(key); return next })} actions={canManageSelectedProject ? <><FollowUpAddSubactivityDialog projectId={selectedProject.id} activityId={activity.id} />{activity.subactivities.length === 0 && <Button type="button" variant="ghost" size="icon-xs" disabled={deletingActivityId === activity.id} onClick={() => void (async () => { if (!window.confirm(`Excluir a atividade “${activity.title}”?`)) return; setDeletingActivityId(activity.id); try { await deleteActivity(selectedProject.id, activity.id) } finally { setDeletingActivityId(null) } })()} title="Excluir atividade vazia" className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive">{deletingActivityId === activity.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}</Button>}</> : undefined} />{isOpen && <div className="space-y-0.5">{subs.map((sub) => <ChannelButton key={sub.id} active={!requestedRequestId && !requestedReviewId && projectSelection?.subactivityId === sub.id} label={sub.title} statusClass={statusMeta[sub.status].columnClassName} onClick={() => { setLocation({ space: "project", project: selectedProject.id, activity: activity.id, sub: sub.id }); setMobileChannelsOpen(false) }} />)}</div>}</div>
            })}
            {projectRequests.length > 0 && <div className="mt-3"><CategoryHeader label="Solicitações" open={!collapsed.has("project:requests")} count={projectRequests.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); next.has("project:requests") ? next.delete("project:requests") : next.add("project:requests"); return next })} />{!collapsed.has("project:requests") && <div className="space-y-0.5">{projectRequests.filter((request) => !q || normalize(`${request.title} ${request.orderNumber}`).includes(q)).map((request) => <ChannelButton key={request.id} active={requestedRequestId === request.id} label={`${serviceRequestReference(request)} · ${request.title}`} muted={SERVICE_REQUEST_STATUS_LABELS[request.status]} onClick={() => { setLocation({ space: "project", project: selectedProject.id, request: request.id }); setMobileChannelsOpen(false) }} />)}</div>}</div>}
            {projectReviews.length > 0 && <div className="mt-3"><CategoryHeader label="Análise AQS" open={!collapsed.has("project:aqs")} count={projectReviews.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); next.has("project:aqs") ? next.delete("project:aqs") : next.add("project:aqs"); return next })} />{!collapsed.has("project:aqs") && <div className="space-y-0.5">{projectReviews.filter((review) => { const activity = selectedProject.activities.find((a) => a.id === review.activityId); const sub = activity?.subactivities.find((s) => s.id === review.subactivityId); return !q || normalize(`${sub?.title ?? ""} ${activity?.title ?? ""}`).includes(q) }).map((review) => { const activity = selectedProject.activities.find((a) => a.id === review.activityId); const sub = activity?.subactivities.find((s) => s.id === review.subactivityId); return <ChannelButton key={review.id} active={requestedReviewId === review.id} label={sub?.title ?? "Análise AQS"} muted={review.status === "awaiting" ? "Aguardando" : review.status === "evaluating" ? "Em análise" : review.status === "completed" ? "Concluída" : "Revogada"} onClick={() => { setLocation({ space: "project", project: selectedProject.id, review: review.id, activity: review.activityId, sub: review.subactivityId }); setMobileChannelsOpen(false) }} /> })}</div>}</div>}
          </div>
        </>
      )
    }

    if (space === "channels") {
      const filtered = openWorkspaceChannels.filter((channel) => !q || normalize(`${channel.name} ${channel.description ?? ""}`).includes(q))
      return (
        <>
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
            <Hash className="size-4 text-primary" />
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold">Canais</p><p className="truncate text-[0.58rem] text-muted-foreground">Conversas gerais do workspace</p></div>
            {isAdmin && <Button size="icon-xs" onClick={() => setCreateChannelOpen(true)} title="Criar canal"><Plus className="size-3.5" /></Button>}
          </div>
          <div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={channelSearch} onChange={(e) => setChannelSearch(e.target.value)} placeholder="Buscar canais abertos" className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring" /></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]">
            <div className="mt-1">
              <CategoryHeader label="Canais" open={!collapsed.has("workspace:channels")} count={filtered.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); next.has("workspace:channels") ? next.delete("workspace:channels") : next.add("workspace:channels"); return next })} actions={isAdmin ? <button type="button" onClick={() => setCreateChannelOpen(true)} title="Criar canal" className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><Plus className="size-3.5" /></button> : undefined} />
              {!collapsed.has("workspace:channels") && <div className="space-y-0.5">{filtered.map((channel) => <ChannelButton key={channel.id} active={selectedWorkspaceChannel?.id === channel.id && !selectedWorkspaceChannel.closedAt} label={channel.name} muted={channel.description} onClick={() => { setLocation({ space: "channels", channel: channel.id }); setMobileChannelsOpen(false) }} />)}</div>}
            </div>
            {!channelsLoading && filtered.length === 0 && <div className="px-3 py-8 text-center text-xs text-muted-foreground">{isAdmin ? "Nenhum canal aberto. Crie o primeiro canal para a equipe." : "Nenhum canal aberto no momento."}</div>}
            {channelsError && <div className="mx-1 mt-3 rounded-lg border border-destructive/20 bg-destructive/5 px-2.5 py-2 text-[0.65rem] text-destructive">{channelsError}</div>}
            {selectedWorkspaceChannel?.closedAt && <div className="mx-1 mt-3 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-[0.65rem] text-muted-foreground"><Archive className="mr-1 inline size-3" />O canal aberto pela pesquisa está fechado e não aparece nesta lista.</div>}
          </div>
        </>
      )
    }

    if (space === "requests") {
      const filtered = visibleRequests.filter((request) => !q || normalize(`${request.title} ${request.orderNumber} ${request.unit} ${request.module}`).includes(q))
      const open = filtered.filter((request) => !CLOSED_REQUEST_STATUSES.has(request.status))
      const closed = filtered.filter((request) => CLOSED_REQUEST_STATUSES.has(request.status))
      return <><div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3"><div><p className="text-sm font-semibold">Solicitações</p><p className="text-[0.58rem] text-muted-foreground">Protocolos e atendimento</p></div><Button size="icon-xs" onClick={() => setCreateRequestOpen(true)} title="Nova solicitação"><Plus className="size-3.5" /></Button></div><div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={channelSearch} onChange={(e) => setChannelSearch(e.target.value)} placeholder="Buscar solicitações" className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring" /></div></div><div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]"><div className="mt-1"><CategoryHeader label="Em andamento" open={!collapsed.has("requests:open")} count={open.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); next.has("requests:open") ? next.delete("requests:open") : next.add("requests:open"); return next })} />{!collapsed.has("requests:open") && open.map((request) => <ChannelButton key={request.id} active={selectedRequest?.id === request.id} label={`${serviceRequestReference(request)} · ${request.title}`} muted={SERVICE_REQUEST_STATUS_LABELS[request.status]} onClick={() => { setLocation({ space: "requests", request: request.id }); setMobileChannelsOpen(false) }} />)}</div>{closed.length > 0 && <div className="mt-3"><CategoryHeader label="Concluídas" open={!collapsed.has("requests:closed")} count={closed.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); next.has("requests:closed") ? next.delete("requests:closed") : next.add("requests:closed"); return next })} />{!collapsed.has("requests:closed") && closed.slice(0, 60).map((request) => <ChannelButton key={request.id} active={selectedRequest?.id === request.id} label={`${serviceRequestReference(request)} · ${request.title}`} muted={SERVICE_REQUEST_STATUS_LABELS[request.status]} onClick={() => { setLocation({ space: "requests", request: request.id }); setMobileChannelsOpen(false) }} />)}</div>}</div></>
    }

    if (space === "aqs") {
      const filtered = visibleReviews.filter((review) => { const project = projects.find((p) => p.id === review.projectId); const activity = project?.activities.find((a) => a.id === review.activityId); const sub = activity?.subactivities.find((s) => s.id === review.subactivityId); return !q || normalize(`${project?.name ?? ""} ${activity?.title ?? ""} ${sub?.title ?? ""}`).includes(q) })
      const active = filtered.filter((review) => review.status === "awaiting" || review.status === "evaluating")
      const closed = filtered.filter((review) => review.status === "completed" || review.status === "revoked")
      const renderReview = (review: AqsReview) => { const project = projects.find((p) => p.id === review.projectId); const activity = project?.activities.find((a) => a.id === review.activityId); const sub = activity?.subactivities.find((s) => s.id === review.subactivityId); return <ChannelButton key={review.id} active={selectedReview?.id === review.id} label={sub?.title ?? "Análise AQS"} muted={project?.name} onClick={() => { setLocation({ space: "aqs", review: review.id, project: review.projectId, activity: review.activityId, sub: review.subactivityId }); setMobileChannelsOpen(false) }} /> }
      return <><div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3"><ShieldCheck className="size-4 text-primary" /><div><p className="text-sm font-semibold">Análise AQS</p><p className="text-[0.58rem] text-muted-foreground">Validação e qualidade</p></div></div><div className="p-2"><div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={channelSearch} onChange={(e) => setChannelSearch(e.target.value)} placeholder="Buscar análises" className="h-8 w-full rounded-md border border-border bg-background pl-8 pr-2 text-xs outline-none focus:border-ring" /></div></div><div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-width:thin]"><div className="mt-1"><CategoryHeader label="Ativas" open={!collapsed.has("aqs:active")} count={active.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); next.has("aqs:active") ? next.delete("aqs:active") : next.add("aqs:active"); return next })} />{!collapsed.has("aqs:active") && active.map(renderReview)}</div>{closed.length > 0 && <div className="mt-3"><CategoryHeader label="Histórico" open={!collapsed.has("aqs:closed")} count={closed.length} onToggle={() => setCollapsed((current) => { const next = new Set(current); next.has("aqs:closed") ? next.delete("aqs:closed") : next.add("aqs:closed"); return next })} />{!collapsed.has("aqs:closed") && closed.slice(0, 60).map(renderReview)}</div>}</div></>
    }

    return null
  }, [canManageSelectedProject, channelSearch, channelsError, channelsLoading, collapsed, deleteActivity, deletingActivityId, isAdmin, openWorkspaceChannels, projectSelection?.subactivityId, projects, requestedRequestId, requestedReviewId, selectedProject, selectedRequest?.id, selectedReview?.id, selectedWorkspaceChannel, setLocation, space, visibleRequests, visibleReviews])

  let content: React.ReactNode
  if (space === "chat") {
    content = <ChatView embedded excludeConversationIds={workspaceChannelConversationIds} />
  } else if (space === "channels" && selectedWorkspaceChannel) {
    content = (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex min-h-10 shrink-0 items-center gap-2 border-b border-border bg-card/70 px-3 py-1.5">
          <Hash className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{selectedWorkspaceChannel.name}</p>
            <p className="truncate text-[0.58rem] text-muted-foreground">{selectedWorkspaceChannel.closedAt ? "Canal fechado · somente histórico" : selectedWorkspaceChannel.description || "Canal geral do workspace"}</p>
          </div>
          {selectedWorkspaceChannel.closedAt && <span className="hidden rounded-full bg-muted px-2 py-1 text-[0.58rem] font-medium text-muted-foreground sm:inline">Arquivado</span>}
          {isAdmin && (
            <Button type="button" size="sm" variant="ghost" disabled={archiveBusy} onClick={() => selectedWorkspaceChannel.closedAt ? void setChannelClosed(selectedWorkspaceChannel, false) : setArchiveTarget(selectedWorkspaceChannel)} className="h-8 gap-1.5 px-2 text-xs">
              {archiveBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : selectedWorkspaceChannel.closedAt ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />}
              <span className="hidden sm:inline">{selectedWorkspaceChannel.closedAt ? "Reabrir" : "Fechar"}</span>
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <ChatView embedded conversationOnly conversationId={selectedWorkspaceChannel.conversationId} readOnly={Boolean(selectedWorkspaceChannel.closedAt)} />
        </div>
      </div>
    )
  } else if (space === "channels") {
    content = (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"><Hash className="size-7" /></div>
          <h2 className="mt-4 text-lg font-semibold">Canais da equipe</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">Canais gerais são compartilhados com toda a equipe e mantêm o histórico centralizado.</p>
          {isAdmin && <Button className="mt-4" onClick={() => setCreateChannelOpen(true)}><Plus className="size-4" /> Criar primeiro canal</Button>}
        </div>
      </div>
    )
  } else if (selectedRequest && (space === "requests" || requestedRequestId)) {
    content = <RequestDetail requestId={selectedRequest.id} embedded backHref="/" />
  } else if (selectedReview) {
    const project = projects.find((item) => item.id === selectedReview.projectId)
    content = project ? <div className="flex h-full min-h-0 flex-col"><AqsActionBar review={selectedReview} /><div className="min-h-0 flex-1"><ProjectFollowUp project={project} availableProjects={accessibleProjects} initialActivityId={selectedReview.activityId} initialSubactivityId={selectedReview.subactivityId} discordEmbedded /></div></div> : null
  } else if (selectedProject && projectSelection) {
    content = <ProjectFollowUp key={`${selectedProject.id}:${projectSelection.subactivityId}`} project={selectedProject} availableProjects={accessibleProjects} initialActivityId={projectSelection.activityId} initialSubactivityId={projectSelection.subactivityId} discordEmbedded />
  } else {
    content = <div className="flex h-full items-center justify-center p-8 text-center"><div><div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageCircleMore className="size-7" /></div><h2 className="mt-4 text-lg font-semibold">Bem-vindo ao TaskBoard</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Escolha um projeto, canal, solicitação ou análise na lateral para começar. No Modo Resumido, tudo acontece em canais e conversas.</p></div></div>
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background">
      <nav className={cn("flex shrink-0 flex-col border-r border-border bg-background/95 py-2 transition-[width] duration-200 ease-out", serverRailExpanded ? "w-[220px]" : "w-[64px]")} aria-label="Projetos e áreas">
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className={cn("mb-1 flex", serverRailExpanded ? "justify-end px-2" : "justify-center")}>
            <button
              type="button"
              onClick={() => setServerRailExpanded((current) => !current)}
              className={cn("flex h-9 items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", serverRailExpanded ? "w-full justify-between gap-2 px-2" : "w-10 justify-center")}
              title={serverRailExpanded ? "Recolher nomes" : "Mostrar nomes"}
              aria-label={serverRailExpanded ? "Recolher barra de projetos" : "Expandir barra de projetos"}
              aria-expanded={serverRailExpanded}
            >
              {serverRailExpanded && <span className="truncate text-xs font-semibold">TaskBoard</span>}
              {serverRailExpanded ? <PanelLeftClose className="size-4 shrink-0" /> : <PanelLeftOpen className="size-4" />}
            </button>
          </div>
          <div className="flex flex-col items-stretch gap-1">
            {accessibleProjects.map((project) => <ProjectServerButton key={project.id} project={project} active={space === "project" && selectedProject?.id === project.id} unread={projectUnread(project.id)} expanded={serverRailExpanded} onClick={() => { selectProject(project); collapseServerRailOnSmallScreen() }} />)}
          </div>
          <div className={cn("mx-auto my-2 h-px bg-border", serverRailExpanded ? "w-[calc(100%-16px)]" : "w-8")} />
          <SpecialServerButton title="Canais" active={space === "channels"} icon={Hash} expanded={serverRailExpanded} onClick={() => { setChannelSearch(""); setLocation({ space: "channels", channel: openWorkspaceChannels[0]?.id }); collapseServerRailOnSmallScreen() }} />
          <SpecialServerButton title="Solicitações" active={space === "requests"} icon={Inbox} badge={openRequestsCount} expanded={serverRailExpanded} onClick={() => { setChannelSearch(""); const first = visibleRequests.find((r) => !CLOSED_REQUEST_STATUSES.has(r.status)) ?? visibleRequests[0]; setLocation({ space: "requests", request: first?.id }); collapseServerRailOnSmallScreen() }} />
          {(currentUserRole === "admin" || currentUserRole === "aqs" || currentUserRole === "developer") && <SpecialServerButton title="Análise AQS" active={space === "aqs"} icon={ClipboardCheck} badge={activeAqsCount} expanded={serverRailExpanded} onClick={() => { setChannelSearch(""); const first = visibleReviews.find((r) => r.status === "awaiting" || r.status === "evaluating") ?? visibleReviews[0]; setLocation({ space: "aqs", review: first?.id, project: first?.projectId, activity: first?.activityId, sub: first?.subactivityId }); collapseServerRailOnSmallScreen() }} />}
          <SpecialServerButton title="Mensagens" active={space === "chat"} icon={MessageCircleMore} expanded={serverRailExpanded} onClick={() => { setChannelSearch(""); setLocation({ space: "chat" }); collapseServerRailOnSmallScreen() }} />
        </div>
        <div className={cn("mt-2 flex flex-col gap-2 border-t border-border pt-2", serverRailExpanded ? "items-stretch px-2" : "items-center")}>
          <div className={cn(serverRailExpanded && "flex items-center gap-2 rounded-lg px-1")}><NotificationCenter compact popoverSide="right" />{serverRailExpanded && <span className="truncate text-xs text-muted-foreground">Notificações</span>}</div>
          <div className={cn(serverRailExpanded && "flex items-center gap-2 rounded-lg px-1")}><RecentSubactivities compact popoverSide="right" />{serverRailExpanded && <span className="truncate text-xs text-muted-foreground">Subatividades recentes</span>}</div>
          <div className={cn("h-px bg-border", serverRailExpanded ? "w-full" : "w-8")} />
          <button
            type="button"
            title={isDarkTheme ? "Ativar tema claro" : "Ativar tema escuro"}
            aria-label={isDarkTheme ? "Ativar tema claro" : "Ativar tema escuro"}
            onClick={toggleTheme}
            className={cn("flex h-10 items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", serverRailExpanded ? "w-full justify-start gap-2 px-3" : "w-10 justify-center")}
          >
            {themeMounted && !isDarkTheme ? <Moon className="size-4 shrink-0" /> : <Sun className="size-4 shrink-0" />}
            {serverRailExpanded && <span className="truncate text-xs">{isDarkTheme ? "Tema claro" : "Tema escuro"}</span>}
          </button>
          <button type="button" title="Configurações" onClick={() => router.push("/config")} className={cn("flex h-10 items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", serverRailExpanded ? "w-full justify-start gap-2 px-3" : "w-10 justify-center")}><Settings className="size-4 shrink-0" />{serverRailExpanded && <span className="truncate text-xs">Configurações</span>}</button>
          <button
            type="button"
            title="Sair da conta"
            aria-label="Sair da conta"
            onClick={() => void signOut()}
            className={cn("flex h-10 items-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive", serverRailExpanded ? "w-full justify-start gap-2 px-3" : "w-10 justify-center")}
          >
            <LogOut className="size-4 shrink-0" />
            {serverRailExpanded && <span className="truncate text-xs">Sair da conta</span>}
          </button>
        </div>
      </nav>

      {space !== "chat" && <aside className="hidden w-[286px] shrink-0 flex-col border-r border-border bg-card/70 md:flex">{channelSidebar}<div className="flex h-[52px] shrink-0 items-center gap-2 border-t border-border bg-background/45 px-2.5">{currentUser && <MemberAvatar member={currentUser} className="size-8" />}<div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{currentUser?.name ?? "Usuário"}</p><p className="truncate text-[0.56rem] text-muted-foreground">{currentUserRole === "admin" ? "Administrador" : currentUserRole === "developer" ? "Desenvolvedor" : currentUserRole === "aqs" ? "AQS" : currentUserRole === "support" ? "Suporte" : "Membro"}</p></div><button type="button" onClick={toggleTheme} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title={isDarkTheme ? "Ativar tema claro" : "Ativar tema escuro"} aria-label={isDarkTheme ? "Ativar tema claro" : "Ativar tema escuro"}>{themeMounted && !isDarkTheme ? <Moon className="size-4" /> : <Sun className="size-4" />}</button><button type="button" onClick={() => router.push("/config")} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="Configurações"><Settings className="size-4" /></button><button type="button" onClick={() => void signOut()} className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive" title="Sair da conta" aria-label="Sair da conta"><LogOut className="size-4" /></button></div></aside>}

      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {space !== "chat" && <button type="button" onClick={() => setMobileChannelsOpen(true)} className="absolute left-2 top-2 z-40 flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm md:hidden" aria-label="Abrir canais"><Hash className="size-4" /></button>}
        {content}
      </main>

      {space !== "chat" && mobileChannelsOpen && <div className="fixed inset-0 z-[120] md:hidden"><button type="button" className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setMobileChannelsOpen(false)} aria-label="Fechar canais" /><aside style={{ left: serverRailExpanded ? 220 : 64 }} className="absolute inset-y-0 flex w-[min(82vw,300px)] flex-col border-r border-border bg-card shadow-2xl">{channelSidebar}</aside></div>}

      <NewServiceRequestDialog open={createRequestOpen} onOpenChange={setCreateRequestOpen} />

      <Dialog open={createChannelOpen} onOpenChange={(open) => { if (!createChannelBusy) { setCreateChannelOpen(open); if (!open) setCreateChannelError(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Criar canal</DialogTitle>
            <DialogDescription>Crie uma conversa geral para todo o workspace. Todos os usuários ativos entram automaticamente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-medium">Nome do canal</span><div className="relative"><Hash className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><input autoFocus value={createChannelName} onChange={(event) => setCreateChannelName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && createChannelName.trim()) { event.preventDefault(); void createWorkspaceChannel() } }} maxLength={80} placeholder="duvidas-gerais" className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-ring" /></div></label>
            <label className="block"><span className="mb-1.5 block text-xs font-medium">Descrição <span className="font-normal text-muted-foreground">(opcional)</span></span><textarea value={createChannelDescription} onChange={(event) => setCreateChannelDescription(event.target.value)} maxLength={300} rows={3} placeholder="Para que este canal será usado?" className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" /></label>
            {createChannelError && <div className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">{createChannelError}</div>}
          </div>
          <DialogFooter><Button variant="outline" disabled={createChannelBusy} onClick={() => setCreateChannelOpen(false)}>Cancelar</Button><Button disabled={!createChannelName.trim() || createChannelBusy} onClick={() => void createWorkspaceChannel()}>{createChannelBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />} Criar canal</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(archiveTarget)} onOpenChange={(open) => { if (!open && !archiveBusy) setArchiveTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fechar canal</DialogTitle>
            <DialogDescription>
              O canal <strong className="font-semibold text-foreground">#{archiveTarget?.name}</strong> sairá da navegação de todos. O histórico continuará disponível somente pela pesquisa <kbd className="rounded border border-border bg-muted px-1 font-mono text-[0.65rem]">Ctrl K</kbd>.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-muted/25 px-3 py-3 text-xs text-muted-foreground">Nenhuma mensagem será apagada. Como o canal ficará fechado, novas mensagens e chamadas serão bloqueadas até ele ser reaberto.</div>
          <DialogFooter>
            <Button variant="outline" disabled={archiveBusy} onClick={() => setArchiveTarget(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={!archiveTarget || archiveBusy} onClick={() => archiveTarget && void setChannelClosed(archiveTarget, true)}>{archiveBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Archive className="size-4" />} Fechar canal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={commandOpen} onOpenChange={setCommandOpen}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only"><DialogTitle>Pesquisa geral</DialogTitle><DialogDescription>Procure projetos, canais, tópicos, solicitações e análises.</DialogDescription></DialogHeader>
          <div className="flex h-14 items-center gap-3 border-b border-border px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={commandQuery}
              onChange={(event) => { setCommandQuery(event.target.value); setCommandIndex(0) }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((current) => commandResults.length ? (current + 1) % commandResults.length : 0) }
                else if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((current) => commandResults.length ? (current - 1 + commandResults.length) % commandResults.length : 0) }
                else if (event.key === "Enter" && commandResults[commandIndex]) { event.preventDefault(); openCommandResult(commandResults[commandIndex]) }
              }}
              placeholder="Buscar canais, projetos, tópicos, solicitações..."
              className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <kbd className="rounded-md border border-border bg-muted px-2 py-1 font-mono text-[0.58rem] text-muted-foreground">Esc</kbd>
          </div>
          <div className="max-h-[min(62vh,520px)] overflow-y-auto p-2">
            {commandResults.length ? commandResults.map((result, index) => (
              <button key={result.key} type="button" onMouseEnter={() => setCommandIndex(index)} onClick={() => openCommandResult(result)} className={cn("flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors", index === commandIndex ? "bg-primary/10 text-foreground" : "hover:bg-muted")}> 
                <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", result.closed ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>{result.kind === "Projeto" ? <UsersRound className="size-4" /> : result.kind === "Solicitação" ? <Inbox className="size-4" /> : result.kind === "Análise AQS" ? <ClipboardCheck className="size-4" /> : result.closed ? <Archive className="size-4" /> : <Hash className="size-4" />}</span>
                <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-xs font-semibold">{result.title}</span>{result.closed && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[0.52rem] font-medium text-muted-foreground">Fechado</span>}</span><span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">{result.kind}{result.subtitle ? ` · ${result.subtitle}` : ""}</span></span>
                {index === commandIndex && <span className="shrink-0 font-mono text-[0.56rem] text-muted-foreground">Enter</span>}
              </button>
            )) : <div className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhum resultado encontrado.</div>}
          </div>
          <div className="flex items-center justify-between border-t border-border bg-muted/20 px-4 py-2 text-[0.58rem] text-muted-foreground"><span>↑↓ navegar · Enter abrir</span><span>Ctrl K pesquisa geral</span></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
