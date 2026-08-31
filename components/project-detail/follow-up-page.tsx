"use client"

import * as React from "react"
import { Keyboard, MessageSquareText } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { useStore } from "@/lib/store"
import { ProjectFollowUp } from "@/components/project-detail/project-follow-up"
import { ProjectIcon } from "@/components/projects/project-icon"

function FollowUpPageSkeleton() {
  return (
    <div className="grid h-full min-h-0 w-full animate-pulse overflow-hidden md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[64px_290px_minmax(0,1fr)_245px]">
      <div className="hidden border-r border-border bg-muted/25 p-2 xl:block">
        <div className="mx-auto h-8 w-8 rounded-lg bg-muted" />
        <div className="mt-5 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="mx-auto size-10 rounded-xl bg-muted" />)}
        </div>
      </div>
      <div className="hidden border-r border-border bg-muted/15 p-3 md:block">
        <div className="h-10 rounded-xl bg-muted" />
        <div className="mt-5 space-y-2">
          {Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted" />)}
        </div>
      </div>
      <div className="min-w-0 bg-background/50 p-4 sm:p-6">
        <div className="h-10 w-2/3 rounded-lg bg-muted" />
        <div className="mt-8 space-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <div className="size-9 shrink-0 rounded-full bg-muted" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3 w-40 rounded bg-muted" />
                <div className="h-4 w-[78%] rounded bg-muted" />
                <div className="h-4 w-[54%] rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 h-12 rounded-xl bg-muted" />
      </div>
      <div className="hidden border-l border-border bg-muted/15 p-3 xl:block">
        <div className="h-8 rounded-lg bg-muted" />
        <div className="mt-5 space-y-3">
          {Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-9 rounded-lg bg-muted" />)}
        </div>
      </div>
    </div>
  )
}

export function FollowUpPage() {
  const { projects, runningSubIds } = useStore()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = React.useState(true)
  const switchTimerRef = React.useRef<number | null>(null)

  const fallbackProjectId = React.useMemo(() => {
    for (const project of projects) {
      if (project.activities.some((activity) => activity.subactivities.some((sub) => runningSubIds.includes(sub.id)))) {
        return project.id
      }
    }
    return projects[0]?.id ?? null
  }, [projects, runningSubIds])

  const requestedProjectId = searchParams.get("project")
  const projectId = requestedProjectId && projects.some((project) => project.id === requestedProjectId)
    ? requestedProjectId
    : fallbackProjectId
  const requestedActivityId = searchParams.get("activity")
  const requestedSubactivityId = searchParams.get("sub")
  const initialTimelineId = searchParams.get("focus")
  const selectedProject = projects.find((project) => project.id === projectId) ?? null
  const resolvedActivity = selectedProject?.activities.find((activity) => activity.id === requestedActivityId) ?? null
  const initialSubactivityId = requestedSubactivityId && selectedProject?.activities.some((activity) => activity.subactivities.some((sub) => sub.id === requestedSubactivityId))
    ? requestedSubactivityId
    : resolvedActivity?.subactivities[0]?.id ?? null

  const showProject = React.useCallback((nextProjectId: string, subactivityId?: string | null, timelineId?: string | null, activityId?: string | null) => {
    if (!nextProjectId) return
    setLoading(true)
    const params = new URLSearchParams()
    params.set("project", nextProjectId)
    if (activityId) params.set("activity", activityId)
    if (subactivityId) params.set("sub", subactivityId)
    if (timelineId) params.set("focus", timelineId)
    router.replace(`/acompanhamento?${params.toString()}`, { scroll: false })
  }, [router])

  React.useEffect(() => {
    if (!projects.length || !projectId) {
      setLoading(false)
      return
    }
    if (switchTimerRef.current) window.clearTimeout(switchTimerRef.current)
    setLoading(true)
    switchTimerRef.current = window.setTimeout(() => setLoading(false), 180)
    return () => {
      if (switchTimerRef.current) window.clearTimeout(switchTimerRef.current)
    }
  }, [projectId, projects.length])

  React.useEffect(() => {
    if (!projectId || requestedProjectId === projectId) return
    const params = new URLSearchParams()
    params.set("project", projectId)
    if (requestedActivityId) params.set("activity", requestedActivityId)
    if (initialSubactivityId) params.set("sub", initialSubactivityId)
    if (initialTimelineId) params.set("focus", initialTimelineId)
    router.replace(`/acompanhamento?${params.toString()}`, { scroll: false })
  }, [initialSubactivityId, initialTimelineId, projectId, requestedActivityId, requestedProjectId, router])

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-background" aria-label="Acompanhamento de projetos">
      <header className="flex min-h-[58px] shrink-0 items-center gap-2.5 border-b border-border bg-card px-3 sm:px-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <MessageSquareText className="size-4" />
        </span>
        <div className="hidden min-w-0 md:block">
          <h1 className="text-sm font-semibold leading-tight">Acompanhamento</h1>
          <p className="mt-0.5 text-[0.66rem] text-muted-foreground">Mensagens, evidências, execução e equipe em uma única visão.</p>
        </div>

        <div className="ml-0 flex min-w-0 flex-1 items-center gap-2 md:ml-4">
          {selectedProject && (
            <span className="hidden size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary sm:flex">
              <ProjectIcon icon={selectedProject.icon} imageUrl={selectedProject.iconImageUrl} className="size-4" imageClassName="size-full rounded-none object-cover" />
            </span>
          )}
          <label className="min-w-0 flex-1 md:max-w-lg">
            <span className="sr-only">Projeto no acompanhamento</span>
            <select
              value={projectId ?? ""}
              onChange={(event) => showProject(event.target.value, null)}
              disabled={!projects.length}
              className="h-9 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-xs font-medium outline-none transition-colors hover:bg-muted focus:border-primary/40 disabled:opacity-60"
            >
              {!projects.length && <option value="">Nenhum projeto disponível</option>}
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
        </div>

        <div className="hidden shrink-0 items-center gap-2 rounded-lg bg-muted px-2 py-1 text-[0.6rem] text-muted-foreground lg:flex">
          <Keyboard className="size-3.5" />
          <span><kbd className="font-mono">Ctrl F</kbd> local</span>
          <span className="text-border">·</span>
          <span><kbd className="font-mono">Ctrl K</kbd> geral</span>
          <span className="text-border">·</span>
          <span><kbd className="font-mono">Ctrl P</kbd> abrir</span>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!projects.length ? (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <MessageSquareText className="size-5" />
              </span>
              <h2 className="mt-4 text-sm font-semibold">Nenhum projeto disponível</h2>
              <p className="mt-1 text-xs text-muted-foreground">Quando houver projetos no workspace, eles aparecerão aqui para acompanhamento.</p>
            </div>
          </div>
        ) : !selectedProject || loading ? (
          <FollowUpPageSkeleton />
        ) : (
          <ProjectFollowUp
            key={selectedProject.id}
            project={selectedProject}
            initialActivityId={requestedActivityId}
            initialSubactivityId={initialSubactivityId}
            initialTimelineId={initialTimelineId}
            onProjectChange={(nextId, nextSubId, nextTimelineId, nextActivityId) => showProject(nextId, nextSubId ?? null, nextTimelineId ?? null, nextActivityId ?? null)}
          />
        )}
      </div>
    </section>
  )
}
