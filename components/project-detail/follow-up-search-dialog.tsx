"use client"

import * as React from "react"
import {
  Activity,
  AtSign,
  CalendarDays,
  FileText,
  FolderKanban,
  Hash,
  MessageSquareText,
  Paperclip,
  Search,
  SlidersHorizontal,
  UserRound,
} from "lucide-react"
import type { Member, Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { ProjectIcon } from "@/components/projects/project-icon"

type SearchKind = "all" | "projects" | "messages" | "attachments" | "activities" | "subactivities" | "logs"
type SearchPeriod = "all" | "today" | "7d" | "30d"

export type FollowUpSearchTarget = {
  projectId: string
  activityId?: string
  subactivityId?: string
  commentId?: string
  timelineId?: string
}

type SearchResult = FollowUpSearchTarget & {
  id: string
  kind: Exclude<SearchKind, "all">
  title: string
  description: string
  searchable: string
  projectName: string
  activityTitle?: string
  subactivityTitle?: string
  authorId?: string
  mentionedUserIds?: string[]
  createdAt?: string
  iconKind?: string
  iconImageUrl?: string
}

const KIND_LABELS: Record<Exclude<SearchKind, "all">, string> = {
  projects: "Projeto",
  messages: "Mensagem",
  attachments: "Arquivo",
  activities: "Atividade",
  subactivities: "Subatividade",
  logs: "Log",
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
}

function withinPeriod(value: string | undefined, period: SearchPeriod, now: number) {
  if (period === "all") return true
  if (!value) return false
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return false
  if (period === "today") {
    const date = new Date(now)
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
    return timestamp >= start
  }
  const days = period === "7d" ? 7 : 30
  return timestamp >= now - days * 24 * 60 * 60 * 1000
}

function formatDate(value?: string) {
  if (!value) return ""
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function shortText(value: string, limit = 155) {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length > limit ? `${compact.slice(0, limit)}…` : compact
}

function ResultKindIcon({ kind }: { kind: Exclude<SearchKind, "all"> }) {
  if (kind === "projects") return <FolderKanban className="size-4" />
  if (kind === "messages") return <MessageSquareText className="size-4" />
  if (kind === "attachments") return <Paperclip className="size-4" />
  if (kind === "activities") return <Activity className="size-4" />
  if (kind === "subactivities") return <Hash className="size-4" />
  return <FileText className="size-4" />
}

export function FollowUpSearchDialog({
  open,
  onOpenChange,
  projects,
  members,
  currentProjectId,
  onOpenResult,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  members: Member[]
  currentProjectId?: string
  onOpenResult: (target: FollowUpSearchTarget) => void
}) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [query, setQuery] = React.useState("")
  const [projectId, setProjectId] = React.useState("all")
  const [kind, setKind] = React.useState<SearchKind>("all")
  const [authorId, setAuthorId] = React.useState("all")
  const [mentionUserId, setMentionUserId] = React.useState("all")
  const [period, setPeriod] = React.useState<SearchPeriod>("all")
  const [filtersOpen, setFiltersOpen] = React.useState(true)
  const [activeIndex, setActiveIndex] = React.useState(0)

  React.useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const allResults = React.useMemo<SearchResult[]>(() => {
    const results: SearchResult[] = []

    for (const project of projects) {
      const firstProjectSub = project.activities.flatMap((activity) => activity.subactivities)[0]
      results.push({
        id: `project:${project.id}`,
        kind: "projects",
        projectId: project.id,
        subactivityId: firstProjectSub?.id,
        title: project.name,
        description: project.client || project.description || "Projeto",
        searchable: `${project.name} ${project.client} ${project.description} ${project.tag}`,
        projectName: project.name,
        iconKind: project.icon,
        iconImageUrl: project.iconImageUrl,
      })

      for (const activity of project.activities) {
        results.push({
          id: `activity:${project.id}:${activity.id}`,
          kind: "activities",
          projectId: project.id,
          activityId: activity.id,
          subactivityId: activity.subactivities[0]?.id,
          title: activity.title,
          description: project.name,
          searchable: `${activity.title} ${project.name}`,
          projectName: project.name,
          activityTitle: activity.title,
          iconKind: project.icon,
          iconImageUrl: project.iconImageUrl,
        })

        for (const sub of activity.subactivities) {
          results.push({
            id: `subactivity:${project.id}:${sub.id}`,
            kind: "subactivities",
            projectId: project.id,
            activityId: activity.id,
            subactivityId: sub.id,
            title: sub.title,
            description: `${activity.title} · ${project.name}`,
            searchable: `${sub.title} ${activity.title} ${project.name}`,
            projectName: project.name,
            activityTitle: activity.title,
            subactivityTitle: sub.title,
            createdAt: sub.createdAt,
            iconKind: project.icon,
            iconImageUrl: project.iconImageUrl,
          })

          for (const comment of sub.comments ?? []) {
            const author = members.find((member) => member.id === comment.authorId)
            const mentionNames = (comment.mentions ?? [])
              .map((mention) => mention.label)
              .join(" ")
            results.push({
              id: `message:${project.id}:${comment.id}`,
              kind: "messages",
              projectId: project.id,
              activityId: activity.id,
              subactivityId: sub.id,
              commentId: comment.id,
              timelineId: `comment-${comment.id}`,
              title: shortText(comment.content || "Mensagem"),
              description: `${author?.name ?? "Usuário"} · ${sub.title} · ${project.name}`,
              searchable: `${comment.content} ${author?.name ?? ""} ${author?.email ?? ""} ${mentionNames} ${sub.title} ${activity.title} ${project.name}`,
              projectName: project.name,
              activityTitle: activity.title,
              subactivityTitle: sub.title,
              authorId: comment.authorId,
              mentionedUserIds: (comment.mentions ?? []).filter((mention) => mention.kind === "user").map((mention) => mention.id),
              createdAt: comment.createdAt,
              iconKind: project.icon,
              iconImageUrl: project.iconImageUrl,
            })
          }

          for (const attachment of sub.attachments ?? []) {
            const author = members.find((member) => member.id === attachment.uploadedBy)
            results.push({
              id: `attachment:${project.id}:${attachment.id}`,
              kind: "attachments",
              projectId: project.id,
              activityId: activity.id,
              subactivityId: sub.id,
              timelineId: `attachment-${attachment.id}`,
              title: attachment.name,
              description: `${author?.name ?? "Usuário"} · ${sub.title} · ${project.name}`,
              searchable: `${attachment.name} ${attachment.mimeType} ${attachment.textContent ?? ""} ${author?.name ?? ""} ${sub.title} ${activity.title} ${project.name}`,
              projectName: project.name,
              activityTitle: activity.title,
              subactivityTitle: sub.title,
              authorId: attachment.uploadedBy,
              createdAt: attachment.createdAt,
              iconKind: project.icon,
              iconImageUrl: project.iconImageUrl,
            })
          }
        }
      }

      for (const log of project.logs ?? []) {
        const author = members.find((member) => member.id === log.actorId)
        results.push({
          id: `log:${project.id}:${log.id}`,
          kind: "logs",
          projectId: project.id,
          subactivityId: firstProjectSub?.id,
          timelineId: `log-${log.id}`,
          title: log.title,
          description: shortText(`${log.description ?? ""}${author ? ` · ${author.name}` : ""}`),
          searchable: `${log.title} ${log.description ?? ""} ${author?.name ?? ""} ${project.name}`,
          projectName: project.name,
          authorId: log.actorId,
          createdAt: log.createdAt,
          iconKind: project.icon,
          iconImageUrl: project.iconImageUrl,
        })
      }
    }

    return results
  }, [members, projects])

  const results = React.useMemo(() => {
    const needle = normalize(query)
    const tokens = needle.split(/\s+/).filter(Boolean)
    const now = Date.now()

    return allResults
      .filter((result) => projectId === "all" || result.projectId === projectId)
      .filter((result) => kind === "all" || result.kind === kind)
      .filter((result) => authorId === "all" || result.authorId === authorId)
      .filter((result) => mentionUserId === "all" || result.mentionedUserIds?.includes(mentionUserId))
      .filter((result) => withinPeriod(result.createdAt, period, now))
      .map((result) => {
        const searchable = normalize(result.searchable)
        if (tokens.length && !tokens.every((token) => searchable.includes(token))) return null
        let score = 0
        if (tokens.length) {
          const title = normalize(result.title)
          if (title === needle) score += 120
          else if (title.startsWith(needle)) score += 95
          else if (title.includes(needle)) score += 75
          else score += 45
        }
        if (result.projectId === currentProjectId) score += 12
        if (result.createdAt) score += Math.max(0, 8 - Math.floor((now - new Date(result.createdAt).getTime()) / (7 * 24 * 60 * 60 * 1000)))
        return { result, score }
      })
      .filter((item): item is { result: SearchResult; score: number } => Boolean(item))
      .sort((a, b) => {
        if (query.trim() && b.score !== a.score) return b.score - a.score
        if (!query.trim() && currentProjectId) {
          const aCurrent = a.result.projectId === currentProjectId ? 1 : 0
          const bCurrent = b.result.projectId === currentProjectId ? 1 : 0
          if (aCurrent !== bCurrent) return bCurrent - aCurrent
        }
        const aTime = a.result.createdAt ? new Date(a.result.createdAt).getTime() : 0
        const bTime = b.result.createdAt ? new Date(b.result.createdAt).getTime() : 0
        if (bTime !== aTime) return bTime - aTime
        return a.result.title.localeCompare(b.result.title, "pt-BR")
      })
      .slice(0, 80)
      .map((item) => item.result)
  }, [allResults, authorId, currentProjectId, kind, mentionUserId, period, projectId, query])

  React.useEffect(() => setActiveIndex(0), [authorId, kind, mentionUserId, period, projectId, query])

  function openResult(result: SearchResult) {
    onOpenChange(false)
    onOpenResult({
      projectId: result.projectId,
      activityId: result.activityId,
      subactivityId: result.subactivityId,
      commentId: result.commentId,
      timelineId: result.timelineId,
    })
  }

  const hasFilters = projectId !== "all" || kind !== "all" || authorId !== "all" || mentionUserId !== "all" || period !== "all"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="grid max-h-[min(82dvh,760px)] w-[calc(100vw-1.25rem)] max-w-[calc(100vw-1.25rem)] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:w-[min(760px,calc(100vw-2rem))] sm:max-w-[760px]">
        <DialogHeader className="sr-only">
          <DialogTitle>Pesquisa geral do acompanhamento</DialogTitle>
          <DialogDescription>Pesquise mensagens, arquivos, atividades, subatividades e logs dos projetos disponíveis.</DialogDescription>
        </DialogHeader>

        <div className="border-b border-border p-3 sm:p-4">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" && results.length) {
                  event.preventDefault()
                  setActiveIndex((current) => Math.min(results.length - 1, current + 1))
                } else if (event.key === "ArrowUp" && results.length) {
                  event.preventDefault()
                  setActiveIndex((current) => Math.max(0, current - 1))
                } else if (event.key === "Enter" && results[activeIndex]) {
                  event.preventDefault()
                  openResult(results[activeIndex])
                }
              }}
              placeholder="Pesquisar em todo o acompanhamento..."
              className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/70"
            />
            <kbd className="hidden shrink-0 rounded-md bg-muted px-2 py-1 font-mono text-[0.62rem] text-muted-foreground sm:inline">Ctrl K</kbd>
          </div>
        </div>

        <div className="border-b border-border bg-muted/15 px-3 py-2 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFiltersOpen((current) => !current)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[0.68rem] font-medium transition-colors",
                filtersOpen || hasFilters ? "border-primary/25 bg-primary/8 text-primary" : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              <SlidersHorizontal className="size-3.5" /> Filtros
              {hasFilters && <span className="size-1.5 rounded-full bg-primary" />}
            </button>
            <span className="text-[0.65rem] text-muted-foreground">{results.length} resultado{results.length === 1 ? "" : "s"}</span>
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setProjectId("all"); setKind("all"); setAuthorId("all"); setMentionUserId("all"); setPeriod("all") }}
                className="ml-auto text-[0.65rem] font-medium text-primary hover:underline"
              >
                Limpar filtros
              </button>
            )}
          </div>

          {filtersOpen && (
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5">
                <FolderKanban className="size-3.5 shrink-0 text-muted-foreground" />
                <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-[0.7rem] outline-none">
                  <option value="all">Todos os projetos</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5">
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                <select value={kind} onChange={(event) => setKind(event.target.value as SearchKind)} className="h-9 min-w-0 flex-1 bg-transparent text-[0.7rem] outline-none">
                  <option value="all">Todos os tipos</option>
                  <option value="projects">Projetos</option>
                  <option value="messages">Mensagens</option>
                  <option value="attachments">Arquivos</option>
                  <option value="activities">Atividades</option>
                  <option value="subactivities">Subatividades</option>
                  <option value="logs">Logs</option>
                </select>
              </label>
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5">
                <UserRound className="size-3.5 shrink-0 text-muted-foreground" />
                <select value={authorId} onChange={(event) => setAuthorId(event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-[0.7rem] outline-none">
                  <option value="all">Qualquer autor</option>
                  {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5">
                <AtSign className="size-3.5 shrink-0 text-muted-foreground" />
                <select value={mentionUserId} onChange={(event) => setMentionUserId(event.target.value)} className="h-9 min-w-0 flex-1 bg-transparent text-[0.7rem] outline-none">
                  <option value="all">Qualquer menção</option>
                  {members.map((member) => <option key={member.id} value={member.id}>Menciona {member.name}</option>)}
                </select>
              </label>
              <label className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background px-2.5">
                <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
                <select value={period} onChange={(event) => setPeriod(event.target.value as SearchPeriod)} className="h-9 min-w-0 flex-1 bg-transparent text-[0.7rem] outline-none">
                  <option value="all">Qualquer período</option>
                  <option value="today">Hoje</option>
                  <option value="7d">Últimos 7 dias</option>
                  <option value="30d">Últimos 30 dias</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-2 [scrollbar-width:thin] sm:p-3">
          {!query.trim() && !hasFilters && (
            <div className="px-2 pb-2 pt-1 text-[0.65rem] font-medium text-muted-foreground">Mais recentes e itens do projeto atual aparecem primeiro.</div>
          )}
          {results.length ? (
            <div className="space-y-1">
              {results.map((result, index) => {
                const author = result.authorId ? members.find((member) => member.id === result.authorId) : undefined
                return (
                  <button
                    key={result.id}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => openResult(result)}
                    className={cn(
                      "flex w-full min-w-0 items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                      index === activeIndex ? "bg-primary/8" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground">
                      {result.kind === "projects" || result.kind === "activities" || result.kind === "subactivities" ? (
                        <ProjectIcon icon={result.iconKind} imageUrl={result.iconImageUrl} className="size-4" imageClassName="size-full rounded-none object-cover" />
                      ) : author ? (
                        <MemberAvatar member={author} profileEnabled={false} className="size-9 rounded-xl text-[0.6rem]" />
                      ) : (
                        <ResultKindIcon kind={result.kind} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <strong className="truncate text-xs font-medium">{result.title || KIND_LABELS[result.kind]}</strong>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.55rem] font-medium text-muted-foreground">{KIND_LABELS[result.kind]}</span>
                      </span>
                      <span className="mt-1 block truncate text-[0.65rem] text-muted-foreground">{result.description}</span>
                      <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[0.58rem] text-muted-foreground/80">
                        <span className="truncate">{result.projectName}{result.subactivityTitle ? ` · # ${result.subactivityTitle}` : ""}</span>
                        {result.createdAt && <time className="ml-auto shrink-0">{formatDate(result.createdAt)}</time>}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
              <Search className="size-6 text-muted-foreground/50" />
              <p className="mt-3 text-sm font-medium">Nenhum resultado</p>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">Tente remover algum filtro ou usar outros termos de pesquisa.</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/20 px-3 py-2 text-[0.58rem] text-muted-foreground sm:px-4">
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">↑ ↓</kbd> navegar</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">Enter</kbd> abrir</span>
          <span><kbd className="rounded bg-muted px-1 py-0.5 font-mono">Esc</kbd> fechar</span>
          <span className="ml-auto hidden sm:inline">Ctrl + F pesquisa somente na subatividade atual</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
