"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CalendarDays, Clock3, ListTree, Pencil } from "lucide-react"
import type { Project } from "@/lib/types"
import {
  formatDate,
  formatHours,
  priorityMeta,
  projectEstimated,
  projectProgress,
  projectSubactivities,
  projectTracked,
} from "@/lib/project-utils"
import { MemberStack } from "@/components/member-avatar"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { ProjectIcon } from "@/components/projects/project-icon"

export function ProjectCard({ project }: { project: Project }) {
  const router = useRouter()
  const { currentUserId, currentUserRole } = useStore()
  const canEditProject = currentUserRole === "admin" || (currentUserRole === "developer" && project.memberIds.includes(currentUserId))
  const progress = projectProgress(project)
  const prio = priorityMeta[project.priority]
  const subs = projectSubactivities(project)
  const doneCount = subs.filter((s) => s.status === "done").length
  const tracked = projectTracked(project)
  const estimated = projectEstimated(project)

  function openProject(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement | null
    if (target?.closest("a,button,input,select,textarea,[role='button']")) return
    router.push(`/projetos/${project.id}`)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") return
    const target = event.target as HTMLElement | null
    if (target?.closest("a,button,input,select,textarea,[role='button']")) return
    event.preventDefault()
    router.push(`/projetos/${project.id}`)
  }

  return (
    <article
      role="link"
      tabIndex={0}
      aria-label={`Abrir projeto ${project.name}`}
      onClick={openProject}
      onKeyDown={handleKeyDown}
      className="group flex cursor-pointer flex-col gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/8 transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-foreground/5 hover:ring-foreground/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
    >
      <div className="flex items-start justify-between gap-3">
        <Link href={`/projetos/${project.id}`} className="flex min-w-0 items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/12 text-primary">
            <ProjectIcon icon={project.icon} imageUrl={project.iconImageUrl} className="size-5" imageClassName="size-full rounded-none object-cover" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-semibold leading-tight transition-colors hover:text-primary">{project.name}</h3>
            <p className="truncate text-xs text-muted-foreground">{project.client}</p>
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[0.65rem] font-medium",
              prio.className,
            )}
          >
            {prio.label}
          </span>
          {canEditProject && (
            <Link
              href={`/projetos/${project.id}/editar`}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={`Editar ${project.name}`}
              title="Editar projeto"
            >
              <Pencil className="size-3.5" />
            </Link>
          )}
        </div>
      </div>

      <Link href={`/projetos/${project.id}`} className="block">
        <p className="line-clamp-2 text-sm text-muted-foreground">
          {project.description}
        </p>
      </Link>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {doneCount}/{subs.length} subatividades
          </span>
          <span className="font-mono font-medium tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ListTree className="size-3.5" />
          {project.activities.length} atividades
        </span>
        <span className="flex items-center gap-1.5">
          <Clock3 className="size-3.5" />
          {formatHours(tracked)} / {formatHours(estimated)}
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarDays className="size-3.5" />
          {formatDate(project.dueDate)}
        </span>
      </div>

      <div className="flex items-center justify-between border-t border-border pt-4">
        <MemberStack ids={project.memberIds} />
        <div className="flex items-center gap-2">
          {project.version && (
            <span className="rounded-full bg-primary/8 px-2.5 py-1 font-mono text-[0.65rem] text-primary">
              v{project.version}{project.build ? ` · ${project.build}` : ""}
            </span>
          )}
          <span className="rounded-full bg-muted px-2.5 py-1 text-[0.65rem] font-medium text-muted-foreground">
            {project.tag}
          </span>
        </div>
      </div>
    </article>
  )
}
