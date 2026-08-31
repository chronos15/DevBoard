"use client"

import * as React from "react"
import { Keyboard, MessageSquareText, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { OPEN_FOLLOW_UP_EVENT, type FollowUpOpenDetail } from "@/lib/follow-up-launcher"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ProjectFollowUp } from "@/components/project-detail/project-follow-up"

function FollowUpSkeleton() {
  return (
    <div className="grid h-full min-h-0 w-full animate-pulse overflow-hidden md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[64px_290px_minmax(0,1fr)_245px]">
      <div className="hidden border-r border-border bg-muted/25 p-2 xl:block">
        <div className="mx-auto h-8 w-8 rounded-lg bg-muted" />
        <div className="mt-5 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="mx-auto size-10 rounded-xl bg-muted" />)}</div>
      </div>
      <div className="hidden border-r border-border bg-muted/15 p-3 md:block">
        <div className="h-10 rounded-xl bg-muted" />
        <div className="mt-5 space-y-2">{Array.from({ length: 9 }).map((_, i) => <div key={i} className="h-10 rounded-lg bg-muted" />)}</div>
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
        <div className="mt-5 space-y-3">{Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-9 rounded-lg bg-muted" />)}</div>
      </div>
    </div>
  )
}

export function FollowUpModal() {
  const { projects, runningSubIds, hydrated } = useStore()
  const [open, setOpen] = React.useState(false)
  const [projectId, setProjectId] = React.useState<string | null>(null)
  const [initialSubactivityId, setInitialSubactivityId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const switchTimerRef = React.useRef<number | null>(null)
  const deepLinkHandledRef = React.useRef(false)
  const openRef = React.useRef(false)

  const selectedProject = projects.find((project) => project.id === projectId) ?? null

  const chooseFallbackProject = React.useCallback(() => {
    for (const project of projects) {
      if (project.activities.some((activity) => activity.subactivities.some((sub) => runningSubIds.includes(sub.id)))) return project.id
    }
    return projects[0]?.id ?? null
  }, [projects, runningSubIds])

  const switchProject = React.useCallback((nextProjectId: string, subactivityId?: string | null) => {
    if (!nextProjectId) return
    if (switchTimerRef.current) window.clearTimeout(switchTimerRef.current)
    setLoading(true)
    setProjectId(nextProjectId)
    setInitialSubactivityId(subactivityId ?? null)
    switchTimerRef.current = window.setTimeout(() => setLoading(false), 180)
  }, [])

  React.useEffect(() => {
    function openFromDetail(detail: FollowUpOpenDetail = {}) {
      const nextProjectId = detail.projectId && projects.some((project) => project.id === detail.projectId)
        ? detail.projectId
        : chooseFallbackProject()
      if (!nextProjectId) return
      setOpen(true)
      switchProject(nextProjectId, detail.subactivityId)
    }

    function onOpen(event: Event) {
      openFromDetail((event as CustomEvent<FollowUpOpenDetail>).detail)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) return
      if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || event.code !== "KeyP") return
      event.preventDefault()
      if (openRef.current) return
      openFromDetail({})
    }

    window.addEventListener(OPEN_FOLLOW_UP_EVENT, onOpen)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener(OPEN_FOLLOW_UP_EVENT, onOpen)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [chooseFallbackProject, projects, switchProject])

  React.useEffect(() => {
    openRef.current = open
  }, [open])

  React.useEffect(() => () => {
    if (switchTimerRef.current) window.clearTimeout(switchTimerRef.current)
  }, [])

  React.useEffect(() => {
    if (deepLinkHandledRef.current || !hydrated || !projects.length) return
    const params = new URLSearchParams(window.location.search)
    if (params.get("view") !== "followup") return
    deepLinkHandledRef.current = true
    const match = window.location.pathname.match(/^\/projetos\/([^/]+)/)
    const hash = window.location.hash.replace(/^#sub-/, "")
    const nextProjectId = match?.[1] && projects.some((project) => project.id === match[1]) ? match[1] : chooseFallbackProject()
    if (!nextProjectId) return
    setOpen(true)
    switchProject(nextProjectId, hash && hash !== window.location.hash ? hash : null)
  }, [chooseFallbackProject, hydrated, projects, switchProject])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) return
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (url.searchParams.get("view") === "followup") {
      url.searchParams.delete("view")
      window.history.replaceState({}, "", url)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent showCloseButton={false} className="grid h-[min(94dvh,960px)] w-[calc(100vw-0.75rem)] max-w-[1680px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-2xl p-0 sm:w-[calc(100vw-2rem)]">
        <DialogHeader className="shrink-0 border-b border-border bg-card px-3 py-2.5 pr-3 sm:px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquareText className="size-4" />
            </span>
            <div className="hidden min-w-0 sm:block">
              <DialogTitle>Acompanhamento</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">Mensagens, evidências, execução e equipe em uma única visão.</DialogDescription>
            </div>
            <label className="ml-0 min-w-0 flex-1 sm:ml-3 sm:max-w-md">
              <span className="sr-only">Projeto no acompanhamento</span>
              <select
                value={projectId ?? ""}
                onChange={(event) => switchProject(event.target.value)}
                className="h-9 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-xs font-medium outline-none transition-colors hover:bg-muted focus:border-primary/40"
              >
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <div className="hidden shrink-0 items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-[0.62rem] text-muted-foreground lg:flex">
              <Keyboard className="size-3.5" />
              <kbd className="font-mono">Ctrl + P</kbd>
            </div>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Fechar acompanhamento" />}>
              <X className="size-4" />
            </DialogClose>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {!selectedProject || loading ? (
            <FollowUpSkeleton />
          ) : (
            <ProjectFollowUp
              key={selectedProject.id}
              project={selectedProject}
              initialSubactivityId={initialSubactivityId}
              onProjectChange={(nextId) => switchProject(nextId)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
