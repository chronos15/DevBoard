"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Clock3, History, ListTodo } from "lucide-react"
import { useStore } from "@/lib/store"
import { statusMeta } from "@/lib/project-utils"
import type { Status } from "@/lib/types"
import { cn } from "@/lib/utils"

type RecentItem = {
  projectId: string
  projectName: string
  activityId: string
  activityTitle: string
  subactivityId: string
  subactivityTitle: string
  status: Status
  trackedSeconds: number
  createdAt?: string
}

function formatWorkedTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}min`
  if (minutes > 0) return `${minutes} min`
  return "0h"
}

function formatCreatedAt(value?: string) {
  if (!value) return "Data não disponível"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Data não disponível"
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function RecentSubactivities() {
  const router = useRouter()
  const { projects, currentUserId } = useStore()
  const [open, setOpen] = React.useState(false)
  const wrapperRef = React.useRef<HTMLDivElement>(null)

  const items = React.useMemo<RecentItem[]>(() => {
    const result: RecentItem[] = []

    for (const project of projects) {
      for (const activity of project.activities) {
        for (const sub of activity.subactivities) {
          if (sub.assigneeId !== currentUserId) continue
          if (sub.status === "done" || sub.status === "cancelled") continue
          result.push({
            projectId: project.id,
            projectName: project.name,
            activityId: activity.id,
            activityTitle: activity.title,
            subactivityId: sub.id,
            subactivityTitle: sub.title,
            status: sub.status,
            trackedSeconds: sub.trackedSeconds,
            createdAt: sub.createdAt,
          })
        }
      }
    }

    return result.sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })
  }, [currentUserId, projects])

  const recentItems = items.slice(0, 8)

  React.useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  function openActivity(item: RecentItem) {
    setOpen(false)
    router.push(`/projetos/${item.projectId}#activity-${item.activityId}`)
  }

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          open && "border-primary/25 bg-primary/[0.06] text-foreground",
        )}
        aria-label="Subatividades recentes"
        aria-expanded={open}
        title="Subatividades recentes"
      >
        <History className="size-[1.1rem]" />
        {items.length > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4.5 items-center justify-center rounded-full bg-muted-foreground px-1 font-mono text-[0.56rem] font-semibold leading-[18px] text-background ring-2 ring-background">
            {items.length > 99 ? "99+" : items.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-[min(430px,calc(100vw-16px))] overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Subatividades recentes</p>
              <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                {items.length
                  ? `${items.length} ${items.length === 1 ? "pendente atribuída" : "pendentes atribuídas"} a você`
                  : "Nenhuma subatividade pendente"}
              </p>
            </div>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ListTodo className="size-4" />
            </span>
          </div>

          <div className="max-h-[min(520px,70vh)] overflow-y-auto p-2">
            {recentItems.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <History className="mx-auto size-6 text-muted-foreground/55" />
                <p className="mt-3 text-sm font-medium">Tudo em dia</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Suas próximas subatividades aparecerão aqui enquanto não estiverem concluídas.
                </p>
              </div>
            ) : (
              recentItems.map((item) => {
                const meta = statusMeta[item.status]
                return (
                  <button
                    key={item.subactivityId}
                    type="button"
                    onClick={() => openActivity(item)}
                    className="group w-full rounded-xl px-3 py-3 text-left transition-colors hover:bg-muted"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
                        <ListTodo className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.subactivityTitle}</span>
                          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-medium", meta.className)}>
                            <span className={cn("size-1.5 rounded-full", meta.dot)} />
                            {meta.label}
                          </span>
                        </span>

                        <span className="mt-1.5 block truncate text-[0.68rem] text-muted-foreground">
                          <strong className="font-medium text-foreground/85">{item.activityTitle}</strong>
                          <span className="mx-1.5">·</span>
                          {item.projectName}
                        </span>

                        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.64rem] text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="size-3" />
                            {formatWorkedTime(item.trackedSeconds)} trabalhados
                          </span>
                          <span>{formatCreatedAt(item.createdAt)}</span>
                        </span>
                      </span>
                      <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {items.length > recentItems.length && (
            <div className="border-t border-border px-4 py-2.5 text-center text-[0.65rem] text-muted-foreground">
              Exibindo as {recentItems.length} subatividades mais recentes.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
