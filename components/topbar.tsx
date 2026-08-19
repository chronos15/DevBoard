"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Menu, Search } from "lucide-react"
import { useStore } from "@/lib/store"
import { MemberAvatar } from "@/components/member-avatar"
import { RunningTimerChip } from "@/components/running-timer-chip"
import { ThemeToggle } from "@/components/theme-toggle"
import { RecentSubactivities } from "@/components/recent-subactivities"
import { NotificationCenter } from "@/components/notifications/notification-center"
import { ACCESS_ROLE_LABELS } from "@/lib/types"

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const router = useRouter()
  const { members, projects, currentUserId, currentUserRole } = useStore()
  const me = members.find((member) => member.id === currentUserId)
  const canBrowseProjects = currentUserRole === "admin" || currentUserRole === "developer"
  const [query, setQuery] = React.useState("")
  const [focused, setFocused] = React.useState(false)

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !canBrowseProjects) return []
    return projects
      .filter((project) => {
        const content = [
          project.name,
          project.client,
          project.tag,
          ...project.activities.flatMap((activity) => [
            activity.title,
            ...activity.subactivities.map((sub) => sub.title),
          ]),
        ]
          .join(" ")
          .toLowerCase()
        return content.includes(q)
      })
      .slice(0, 5)
  }, [canBrowseProjects, projects, query])

  function openProject(id: string) {
    setQuery("")
    setFocused(false)
    router.push(`/projetos/${id}`)
  }

  return (
    <header className="sticky top-0 z-30 flex min-w-0 items-center gap-2 border-b border-border bg-background/80 px-3 py-3 backdrop-blur-md sm:gap-3 sm:px-4 md:px-6">
      <button onClick={onMenu} className="rounded-lg p-2 text-muted-foreground hover:bg-muted lg:hidden" aria-label="Abrir menu">
        <Menu className="size-5" />
      </button>

      {canBrowseProjects ? <div className="relative hidden max-w-md flex-1 md:block">
        <Search className="pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) openProject(results[0].id)
          }}
          placeholder="Buscar projetos, atividades..."
          className="h-10 w-full rounded-xl border border-border bg-muted/60 pr-4 pl-9 text-sm outline-none transition-colors focus:border-ring focus:bg-card"
        />
        {focused && query.trim() && (
          <div className="absolute top-12 left-0 z-50 w-full overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-xl">
            {results.length ? (
              results.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openProject(project.id)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                    {project.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{project.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{project.client}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3 py-3 text-sm text-muted-foreground">Nenhum projeto encontrado.</p>
            )}
          </div>
        )}
      </div> : <div className="hidden flex-1 md:block" />}

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
            <span className="block text-xs font-semibold">{me?.name ?? "Conta"}</span>
            <span className="block text-[0.7rem] text-muted-foreground">{ACCESS_ROLE_LABELS[currentUserRole]}</span>
          </span>
        </button>
      </div>
    </header>
  )
}
