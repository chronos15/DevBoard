"use client"

import * as React from "react"
import { Search } from "lucide-react"
import { useStore } from "@/lib/store"
import type { Priority } from "@/lib/types"
import { ProjectCard } from "@/components/projects/project-card"
import { cn } from "@/lib/utils"

const filters: { key: Priority | "all"; label: string }[] = [
  { key: "all", label: "Todos" },
  { key: "high", label: "Alta prioridade" },
  { key: "medium", label: "Média" },
  { key: "low", label: "Baixa" },
]

export function ProjectsView() {
  const { projects } = useStore()
  const [filter, setFilter] = React.useState<Priority | "all">("all")
  const [query, setQuery] = React.useState("")

  const visible = projects.filter((p) => {
    const matchFilter = filter === "all" || p.priority === filter
    const matchQuery =
      query.trim() === "" ||
      `${p.name} ${p.client} ${p.tag}`.toLowerCase().includes(query.toLowerCase())
    return matchFilter && matchQuery
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                filter === f.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filtrar projetos..."
            className="h-10 w-full rounded-xl border border-border bg-card pr-4 pl-9 text-sm outline-none transition-colors focus:border-ring"
          />
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          Nenhum projeto encontrado para esse filtro.
        </div>
      )}
    </div>
  )
}
