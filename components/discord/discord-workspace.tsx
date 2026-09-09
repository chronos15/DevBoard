"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Hash,
  Inbox,
  LoaderCircle,
  MessageCircleMore,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { scopeFollowUpProjects } from "@/lib/follow-up-access"
import { statusMeta } from "@/lib/project-utils"
import { cn } from "@/lib/utils"
import { ProjectIcon } from "@/components/projects/project-icon"
import { ProjectFollowUp } from "@/components/project-detail/project-follow-up"
import { RequestDetail } from "@/components/requests/request-detail"
import { NewServiceRequestDialog } from "@/components/requests/request-create-dialog"
import { FollowUpAddActivityDialog, FollowUpAddSubactivityDialog } from "@/components/project-detail/follow-up-structure-dialogs"
import { ChatView } from "@/components/chat/chat-view"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SERVICE_REQUEST_STATUS_LABELS, serviceRequestReference } from "@/lib/service-requests"
import type { AqsReview, Project } from "@/lib/types"

type DiscordSpace = "project" | "requests" | "aqs" | "chat"

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

function ProjectServerButton({ project, active, unread, onClick }: { project: Project; active: boolean; unread: "mention" | "unread" | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={project.name} className="group relative flex h-12 w-full items-center justify-center">
      <span className={cn("absolute left-0 w-1 rounded-r-full bg-foreground transition-all", active ? "h-10" : unread ? "h-2" : "h-0 group-hover:h-5")} />
      <span className={cn(
        "relative flex size-11 items-center justify-center overflow-visible rounded-[22px] bg-muted text-muted-foreground ring-1 ring-border transition-all duration-150 group-hover:rounded-[15px] group-hover:bg-primary/15 group-hover:text-primary",
        active && "rounded-[15px] bg-primary text-primary-foreground ring-primary",
      )}>
        <span className="flex size-full items-center justify-center overflow-hidden rounded-[inherit]">
          <ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-5" imageClassName="size-full rounded-[inherit] object-cover" />
        </span>
        {unread === "mention" && <span className="absolute -bottom-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[0.52rem] font-bold leading-4 text-destructive-foreground ring-2 ring-background">@</span>}
        {unread === "unread" && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-sky-400 ring-2 ring-background" />}
      </span>
    </button>
  )
}

function SpecialServerButton({ title, active, icon: Icon, badge, onClick }: { title: string; active: boolean; icon: typeof Inbox; badge?: number; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={title} className="group relative flex h-12 w-full items-center justify-center">
      <span className={cn("absolute left-0 w-1 rounded-r-full bg-foreground transition-all", active ? "h-10" : "h-0 group-hover:h-5")} />
      <span className={cn("relative flex size-11 items-center justify-center rounded-[22px] bg-muted text-muted-foreground ring-1 ring-border transition-all group-hover:rounded-[15px] group-hover:bg-primary group-hover:text-primary-foreground", active && "rounded-[15px] bg-primary text-primary-foreground ring-primary")}>
        <Icon className="size-5" />
        {!!badge && <span className="absolute -bottom-1 -right-1 min-w-4 rounded-full bg-destructive px-1 text-center font-mono text-[0.5rem] font-bold leading-4 text-destructive-foreground ring-2 ring-background">{badge > 99 ? "99+" : badge}</span>}
      </span>
    </button>
  )
}

function ChannelButton({ active, label, muted, statusClass, onClick }: { active: boolean; label: string; muted?: string; statusClass?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("group flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[0.82rem] transition-colors", active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground")}>
      <Hash className="size-4 shrink-0 opacity-70" />
      <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
      {statusClass && <span className={cn("size-1.5 shrink-0 rounded-full", statusClass)} />}
      {muted && <span className="max-w-16 shrink-0 truncate text-[0.55rem] opacity-60">{muted}</span>}
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
  const {
    projects,
    serviceRequests,
    aqsReviews,
    notifications,
    members,
    currentUserId,
    currentUserRole,
    deleteActivity,
  } = useStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [channelSearch, setChannelSearch] = React.useState("")
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const [createRequestOpen, setCreateRequestOpen] = React.useState(false)
  const [mobileChannelsOpen, setMobileChannelsOpen] = React.useState(false)
  const [deletingActivityId, setDeletingActivityId] = React.useState<string | null>(null)

  const accessibleProjects = React.useMemo(() => scopeFollowUpProjects(projects, currentUserId, currentUserRole), [projects, currentUserId, currentUserRole])
  const visibleRequests = React.useMemo(() => serviceRequests, [serviceRequests])
  const visibleReviews = React.useMemo(() => aqsReviews, [aqsReviews])

  const requestedSpace = searchParams.get("space") as DiscordSpace | null
  const requestedProjectId = searchParams.get("project")
  const requestedRequestId = searchParams.get("request")
  const requestedReviewId = searchParams.get("review")
  const requestedSubId = searchParams.get("sub")
  const requestedActivityId = searchParams.get("activity")

  const space: DiscordSpace = requestedSpace && ["project", "requests", "aqs", "chat"].includes(requestedSpace)
    ? requestedSpace
    : requestedRequestId ? "requests" : requestedReviewId ? "aqs" : "project"

  const selectedProject = accessibleProjects.find((project) => project.id === requestedProjectId) ?? accessibleProjects[0] ?? null
  const selectedRequest = visibleRequests.find((request) => request.id === requestedRequestId) ?? null
  const selectedReview = visibleReviews.find((review) => review.id === requestedReviewId || (!requestedReviewId && requestedSubId && review.subactivityId === requestedSubId)) ?? null

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

  const setLocation = React.useCallback((next: Record<string, string | null | undefined>) => {
    const params = new URLSearchParams()
    Object.entries(next).forEach(([key, value]) => { if (value) params.set(key, value) })
    router.replace(`/?${params.toString()}`, { scroll: false })
  }, [router])

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
  }, [canManageSelectedProject, channelSearch, collapsed, deleteActivity, deletingActivityId, projectSelection?.subactivityId, projects, requestedRequestId, requestedReviewId, selectedProject, selectedRequest?.id, selectedReview?.id, setLocation, space, visibleRequests, visibleReviews])

  let content: React.ReactNode
  if (space === "chat") {
    content = <ChatView />
  } else if (selectedRequest && (space === "requests" || requestedRequestId)) {
    content = <RequestDetail requestId={selectedRequest.id} embedded backHref="/" />
  } else if (selectedReview) {
    const project = projects.find((item) => item.id === selectedReview.projectId)
    content = project ? <div className="flex h-full min-h-0 flex-col"><AqsActionBar review={selectedReview} /><div className="min-h-0 flex-1"><ProjectFollowUp project={project} availableProjects={accessibleProjects} initialActivityId={selectedReview.activityId} initialSubactivityId={selectedReview.subactivityId} discordEmbedded /></div></div> : null
  } else if (selectedProject && projectSelection) {
    content = <ProjectFollowUp key={`${selectedProject.id}:${projectSelection.subactivityId}`} project={selectedProject} availableProjects={accessibleProjects} initialActivityId={projectSelection.activityId} initialSubactivityId={projectSelection.subactivityId} discordEmbedded />
  } else {
    content = <div className="flex h-full items-center justify-center p-8 text-center"><div><div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageCircleMore className="size-7" /></div><h2 className="mt-4 text-lg font-semibold">Bem-vindo ao Devboard</h2><p className="mt-2 max-w-md text-sm text-muted-foreground">Escolha um projeto, solicitação ou análise na lateral para começar. No Modo Discord, tudo acontece em canais e conversas.</p></div></div>
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 overflow-hidden bg-background">
      <nav className="flex w-[64px] shrink-0 flex-col border-r border-border bg-background/95 py-2" aria-label="Projetos e áreas">
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex flex-col items-center gap-1">
            {accessibleProjects.map((project) => <ProjectServerButton key={project.id} project={project} active={space === "project" && selectedProject?.id === project.id} unread={projectUnread(project.id)} onClick={() => selectProject(project)} />)}
          </div>
          <div className="mx-auto my-2 h-px w-8 bg-border" />
          <SpecialServerButton title="Solicitações" active={space === "requests"} icon={Inbox} badge={openRequestsCount} onClick={() => { setChannelSearch(""); const first = visibleRequests.find((r) => !CLOSED_REQUEST_STATUSES.has(r.status)) ?? visibleRequests[0]; setLocation({ space: "requests", request: first?.id }) }} />
          {(currentUserRole === "admin" || currentUserRole === "aqs" || currentUserRole === "developer") && <SpecialServerButton title="Análise AQS" active={space === "aqs"} icon={ClipboardCheck} badge={activeAqsCount} onClick={() => { setChannelSearch(""); const first = visibleReviews.find((r) => r.status === "awaiting" || r.status === "evaluating") ?? visibleReviews[0]; setLocation({ space: "aqs", review: first?.id, project: first?.projectId, activity: first?.activityId, sub: first?.subactivityId }) }} />}
          <SpecialServerButton title="Mensagens" active={space === "chat"} icon={MessageCircleMore} onClick={() => { setChannelSearch(""); setLocation({ space: "chat" }) }} />
        </div>
        <div className="mt-2 flex flex-col items-center gap-2 border-t border-border pt-2">
          <button type="button" title="Configurações" onClick={() => router.push("/config")} className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><Settings className="size-4" /></button>
        </div>
      </nav>

      {space !== "chat" && <aside className="hidden w-[286px] shrink-0 flex-col border-r border-border bg-card/70 md:flex">{channelSidebar}<div className="flex h-[52px] shrink-0 items-center gap-2 border-t border-border bg-background/45 px-2.5">{currentUser && <MemberAvatar member={currentUser} className="size-8" />}<div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{currentUser?.name ?? "Usuário"}</p><p className="truncate text-[0.56rem] text-muted-foreground">{currentUserRole === "admin" ? "Administrador" : currentUserRole === "developer" ? "Desenvolvedor" : currentUserRole === "aqs" ? "AQS" : currentUserRole === "support" ? "Suporte" : "Membro"}</p></div><button type="button" onClick={() => router.push("/config")} className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" title="Configurações"><Settings className="size-4" /></button></div></aside>}

      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {space !== "chat" && <button type="button" onClick={() => setMobileChannelsOpen(true)} className="absolute left-2 top-2 z-40 flex size-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm md:hidden" aria-label="Abrir canais"><Hash className="size-4" /></button>}
        {content}
      </main>

      {space !== "chat" && mobileChannelsOpen && <div className="fixed inset-0 z-[120] md:hidden"><button type="button" className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={() => setMobileChannelsOpen(false)} aria-label="Fechar canais" /><aside className="absolute inset-y-0 left-[64px] flex w-[min(82vw,300px)] flex-col border-r border-border bg-card shadow-2xl">{channelSidebar}</aside></div>}

      <NewServiceRequestDialog open={createRequestOpen} onOpenChange={setCreateRequestOpen} />
    </div>
  )
}
