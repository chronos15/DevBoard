"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Inbox,
  FolderKanban,
  ListTodo,
  Menu,
  Search,
  UserRound,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { RunningTimerChip } from "@/components/running-timer-chip"
import { ThemeToggle } from "@/components/theme-toggle"
import { RecentSubactivities } from "@/components/recent-subactivities"
import { NotificationCenter } from "@/components/notifications/notification-center"
import { ACCESS_ROLE_LABELS, type AqsReviewStatus, type SupportTopicStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

type GlobalSearchKind = "user" | "project" | "activity" | "subactivity" | "topic" | "analysis" | "request"

type GlobalSearchResult = {
  id: string
  kind: GlobalSearchKind
  label: string
  meta: string
  href: string
  keywords: string
  memberId?: string
  score?: number
}

const KIND_LABELS: Record<GlobalSearchKind, string> = {
  user: "Usuário",
  project: "Projeto",
  activity: "Atividade",
  subactivity: "Subatividade",
  topic: "Tópico",
  analysis: "Análise AQS",
  request: "Solicitação",
}

const AQS_STATUS_LABELS: Record<AqsReviewStatus, string> = {
  awaiting: "Aguardando análise",
  evaluating: "Avaliando",
  completed: "Concluída",
  revoked: "Revogada",
}

const TOPIC_STATUS_LABELS: Record<SupportTopicStatus, string> = {
  open: "Aberto",
  analyzing: "Em análise",
  "sent-to-dev": "Enviado ao DEV",
  revoked: "Revogado",
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim()
}

function scoreResult(result: GlobalSearchResult, rawQuery: string) {
  const query = normalizeSearch(rawQuery)
  if (!query) return 0

  const label = normalizeSearch(result.label)
  const meta = normalizeSearch(result.meta)
  const keywords = normalizeSearch(result.keywords)
  const tokens = query.split(/\s+/).filter(Boolean)
  const searchable = `${label} ${meta} ${keywords}`

  if (!tokens.every((token) => searchable.includes(token))) return 0
  if (label === query) return 120
  if (label.startsWith(query)) return 100
  if (label.split(/\s+/).some((word) => word.startsWith(query))) return 88
  if (label.includes(query)) return 76
  if (meta.includes(query)) return 56
  return 42
}

function ResultIcon({ kind }: { kind: GlobalSearchKind }) {
  const className = "size-4"
  if (kind === "user") return <UserRound className={className} />
  if (kind === "project") return <FolderKanban className={className} />
  if (kind === "activity") return <ListTodo className={className} />
  if (kind === "subactivity") return <CheckCircle2 className={className} />
  if (kind === "topic") return <ClipboardList className={className} />
  if (kind === "request") return <Inbox className={className} />
  return <ClipboardCheck className={className} />
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter()
  const pathname = usePathname()
  const {
    members,
    projects,
    supportTopics,
    serviceRequests,
    aqsReviews,
    currentUserId,
    currentUserRole,
  } = useStore()
  const me = members.find((member) => member.id === currentUserId)
  const canBrowseProjects = currentUserRole === "admin" || currentUserRole === "developer"
  const canBrowseAnalysis = currentUserRole === "admin" || currentUserRole === "developer" || currentUserRole === "aqs"
  const [query, setQuery] = React.useState("")
  const [focused, setFocused] = React.useState(false)
  const [activeIndex, setActiveIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  const results = React.useMemo(() => {
    const rawQuery = query.trim()
    if (!rawQuery) return []

    const candidates: GlobalSearchResult[] = []

    for (const member of members) {
      candidates.push({
        id: `user:${member.id}`,
        kind: "user",
        label: member.name,
        meta: member.id === currentUserId
          ? `${ACCESS_ROLE_LABELS[member.role ?? currentUserRole]} · sua conta`
          : `${ACCESS_ROLE_LABELS[member.role ?? "member"]}${member.email ? ` · ${member.email}` : ""}`,
        href: member.id === currentUserId ? "/config" : `/chat?user=${encodeURIComponent(member.id)}`,
        keywords: `${member.name} ${member.email ?? ""} ${member.initials} ${ACCESS_ROLE_LABELS[member.role ?? "member"]}`,
        memberId: member.id,
      })
    }

    if (canBrowseProjects) {
      for (const project of projects) {
        candidates.push({
          id: `project:${project.id}`,
          kind: "project",
          label: project.name,
          meta: [project.client, project.version ? `v${project.version}` : ""].filter(Boolean).join(" · ") || "Projeto",
          href: `/projetos/${project.id}`,
          keywords: `${project.name} ${project.client} ${project.description} ${project.tag} ${project.repository ?? ""} ${project.version ?? ""} ${project.build ?? ""}`,
        })

        for (const activity of project.activities) {
          candidates.push({
            id: `activity:${project.id}:${activity.id}`,
            kind: "activity",
            label: activity.title,
            meta: `${project.name} · atividade`,
            href: `/projetos/${project.id}#activity-${activity.id}`,
            keywords: `${activity.title} ${project.name} ${project.client}`,
          })

          for (const subactivity of activity.subactivities) {
            const assignee = members.find((member) => member.id === subactivity.assigneeId)
            candidates.push({
              id: `subactivity:${project.id}:${subactivity.id}`,
              kind: "subactivity",
              label: subactivity.title,
              meta: `${project.name} · ${activity.title}`,
              href: `/projetos/${project.id}#sub-${subactivity.id}`,
              keywords: `${subactivity.title} ${activity.title} ${project.name} ${assignee?.name ?? ""} ${subactivity.status}`,
            })
          }
        }
      }
    }

    for (const request of serviceRequests) {
      const creator = members.find((member) => member.id === request.createdBy)
      candidates.push({
        id: `request:${request.id}`,
        kind: "request",
        label: `OS ${request.orderNumber} · ${request.title}`,
        meta: `${request.module} · ${request.subject}`,
        href: `/solicitacoes/${request.id}`,
        keywords: `${request.orderNumber} ${request.title} ${request.description} ${request.unit} ${request.module} ${request.subject} ${creator?.name ?? ""} ${request.status} ${request.requestType}`,
      })
    }

    for (const topic of supportTopics) {
      const creator = members.find((member) => member.id === topic.createdBy)
      const analyst = members.find((member) => member.id === topic.assignedAnalystId)
      const project = projects.find((item) => item.id === topic.projectId)
      candidates.push({
        id: `topic:${topic.id}`,
        kind: "topic",
        label: topic.title,
        meta: `Ordem ${topic.orderNumber} · ${TOPIC_STATUS_LABELS[topic.status]}`,
        href: `/topicos?topic=${encodeURIComponent(topic.id)}`,
        keywords: `${topic.title} ${topic.orderNumber} ${topic.description} ${TOPIC_STATUS_LABELS[topic.status]} ${creator?.name ?? ""} ${analyst?.name ?? ""} ${project?.name ?? ""}`,
      })
    }

    if (canBrowseAnalysis) {
      for (const review of aqsReviews) {
        const project = projects.find((item) => item.id === review.projectId)
        const activity = project?.activities.find((item) => item.id === review.activityId)
        const subactivity = activity?.subactivities.find((item) => item.id === review.subactivityId)
        const developer = members.find((member) => member.id === subactivity?.assigneeId)
        const aqs = members.find((member) => member.id === review.assignedAqsId)
        const label = subactivity?.title ?? activity?.title ?? project?.name ?? "Análise AQS"

        candidates.push({
          id: `analysis:${review.id}`,
          kind: "analysis",
          label,
          meta: `${AQS_STATUS_LABELS[review.status]}${project?.name ? ` · ${project.name}` : ""}`,
          href: `/analise?sub=${encodeURIComponent(review.subactivityId)}`,
          keywords: `${label} ${AQS_STATUS_LABELS[review.status]} ${project?.name ?? ""} ${activity?.title ?? ""} ${developer?.name ?? ""} ${aqs?.name ?? ""}`,
        })
      }
    }

    return candidates
      .map((result) => ({ ...result, score: scoreResult(result, rawQuery) }))
      .filter((result) => (result.score ?? 0) > 0)
      .sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0)
        if (scoreDiff) return scoreDiff
        return a.label.localeCompare(b.label, "pt-BR")
      })
      .slice(0, 14)
  }, [aqsReviews, canBrowseAnalysis, canBrowseProjects, currentUserId, currentUserRole, members, projects, query, serviceRequests, supportTopics])

  React.useEffect(() => {
    setActiveIndex(0)
  }, [query])

  React.useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (pathname.startsWith("/acompanhamento")) return
      if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase("pt-BR") !== "k") return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
      setFocused(true)
    }
    window.addEventListener("keydown", handleShortcut)
    return () => window.removeEventListener("keydown", handleShortcut)
  }, [pathname])

  function openResult(result: GlobalSearchResult) {
    setQuery("")
    setFocused(false)

    // Quando o usuário já está no Chat, o evento abre a conversa sem depender
    // de remount da página. Fora do Chat, o parâmetro `user` é consumido ao montar.
    if (result.kind === "user" && result.memberId && result.memberId !== currentUserId && typeof window !== "undefined") {
      router.push(result.href)
      if (window.location.pathname.startsWith("/chat")) {
        window.setTimeout(() => {
          window.dispatchEvent(new CustomEvent("devboard:open-chat-user", { detail: { memberId: result.memberId } }))
        }, 0)
      }
      return
    }

    router.push(result.href)

    // Next mantém o mesmo Client Component montado quando apenas a query muda.
    // Os eventos abaixo garantem que a navegação global também funcione quando
    // a busca é usada já dentro da própria tela de destino.
    if (typeof window !== "undefined" && result.kind === "topic" && window.location.pathname.startsWith("/topicos")) {
      const topicId = result.id.replace(/^topic:/, "")
      window.setTimeout(() => window.dispatchEvent(new CustomEvent("devboard:open-topic", { detail: { topicId } })), 0)
    }
    if (typeof window !== "undefined" && result.kind === "analysis" && window.location.pathname.startsWith("/analise")) {
      const subactivityId = new URL(result.href, window.location.origin).searchParams.get("sub")
      if (subactivityId) {
        window.setTimeout(() => window.dispatchEvent(new CustomEvent("devboard:focus-analysis", { detail: { subactivityId } })), 0)
      }
    }
  }

  return (
    <header className="sticky top-0 z-30 flex min-w-0 items-center gap-2 border-b border-border bg-background/80 px-3 py-3 backdrop-blur-md sm:gap-3 sm:px-4 md:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Abrir menu">
        <Menu className="size-5" />
      </button>

      <div className="relative hidden max-w-xl flex-1 md:block">
        <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 140)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && results.length) {
              event.preventDefault()
              setActiveIndex((current) => (current + 1) % results.length)
              return
            }
            if (event.key === "ArrowUp" && results.length) {
              event.preventDefault()
              setActiveIndex((current) => (current - 1 + results.length) % results.length)
              return
            }
            if (event.key === "Escape") {
              setFocused(false)
              event.currentTarget.blur()
              return
            }
            if (event.key === "Enter" && results[activeIndex]) {
              event.preventDefault()
              openResult(results[activeIndex])
            }
          }}
          placeholder="Buscar usuários, projetos, atividades..."
          aria-label="Pesquisa global"
          aria-expanded={focused && Boolean(query.trim())}
          aria-controls="global-search-results"
          className="h-10 w-full rounded-xl border border-border bg-muted/60 pr-16 pl-9 text-sm outline-none transition-colors focus:border-ring focus:bg-card"
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-md border border-border bg-background/75 px-1.5 py-0.5 font-mono text-[0.58rem] text-muted-foreground">Ctrl K</kbd>

        {focused && query.trim() && (
          <div id="global-search-results" className="absolute top-12 left-0 z-50 w-full overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <p className="text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase">Pesquisa global</p>
              {results.length > 0 && <span className="text-[0.62rem] text-muted-foreground">{results.length} resultado{results.length === 1 ? "" : "s"}</span>}
            </div>
            <div className="max-h-[min(28rem,65vh)] overflow-y-auto p-1.5">
              {results.length ? (
                results.map((result, index) => {
                  const member = result.kind === "user" && result.memberId
                    ? members.find((item) => item.id === result.memberId)
                    : undefined
                  return (
                    <button
                      key={result.id}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => openResult(result)}
                      className={cn(
                        "flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                        index === activeIndex ? "bg-muted" : "hover:bg-muted/70",
                      )}
                    >
                      {member ? (
                        <MemberAvatar member={member} profileEnabled={false} className="size-9 rounded-xl text-[0.65rem] ring-0" />
                      ) : (
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <ResultIcon kind={result.kind} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">{result.label}</span>
                          <span className="shrink-0 rounded-full bg-muted-foreground/10 px-1.5 py-0.5 text-[0.56rem] font-medium text-muted-foreground">{KIND_LABELS[result.kind]}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{result.meta}</span>
                      </span>
                    </button>
                  )
                })
              ) : (
                <div className="px-3 py-7 text-center">
                  <Search className="mx-auto size-5 text-muted-foreground/60" />
                  <p className="mt-2 text-sm font-medium">Nada encontrado</p>
                  <p className="mt-1 text-xs text-muted-foreground">Busque por usuário, projeto, atividade, subatividade, tópico ou análise.</p>
                </div>
              )}
            </div>
            {results.length > 0 && (
              <div className="border-t border-border px-3 py-2 text-[0.6rem] text-muted-foreground">
                ↑↓ navega · Enter abre · Esc fecha
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2 md:gap-3">
        <RunningTimerChip />
        <ThemeToggle />
        <RecentSubactivities />
        <NotificationCenter />

        <button
          type="button"
          onClick={() => router.push("/config")}
          className="flex items-center gap-2.5 rounded-xl border border-border bg-card py-1 pr-3 pl-1 text-left transition-colors hover:bg-muted max-[419px]:hidden"
        >
          <MemberAvatar member={me} className="size-8 rounded-lg ring-0" />
          <span className="hidden leading-tight sm:block">
            <MemberName member={me} className="block text-xs font-semibold" fallback="Conta" />
            <span className="block text-[0.7rem] text-muted-foreground">{ACCESS_ROLE_LABELS[currentUserRole]}</span>
          </span>
        </button>
      </div>
    </header>
  )
}
