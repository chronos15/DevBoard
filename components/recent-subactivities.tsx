"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronRight, ClipboardCheck, Clock3, History, ListTodo, LoaderCircle, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { statusMeta } from "@/lib/project-utils"
import type { Status } from "@/lib/types"
import { cn } from "@/lib/utils"
import { AnchoredPopoverPortal } from "@/components/ui/anchored-popover-portal"
import { openProjectFollowUp } from "@/lib/follow-up-launcher"

type RecentItem = {
  kind: "task" | "approval"
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

export function RecentSubactivities({ compact = false, popoverSide = "bottom" }: { compact?: boolean; popoverSide?: "bottom" | "right" }) {
  const router = useRouter()
  const { projects, currentUserId, preferences, decideSubactivityApproval } = useStore()
  const [open, setOpen] = React.useState(false)
  const [decisionSaving, setDecisionSaving] = React.useState<{ id: string; approved: boolean } | null>(null)
  const wrapperRef = React.useRef<HTMLDivElement>(null)
  const closePopover = React.useCallback(() => setOpen(false), [])

  const items = React.useMemo<RecentItem[]>(() => {
    const result: RecentItem[] = []

    for (const project of projects) {
      for (const activity of project.activities) {
        for (const sub of activity.subactivities) {
          const isApproval = sub.status === "waiting" && sub.approvalUserId === currentUserId
          const isAssignedPending = sub.assigneeId === currentUserId && sub.status !== "done" && sub.status !== "cancelled"
          if (!isApproval && !isAssignedPending) continue

          result.push({
            kind: isApproval ? "approval" : "task",
            projectId: project.id,
            projectName: project.name,
            activityId: activity.id,
            activityTitle: activity.title,
            subactivityId: sub.id,
            subactivityTitle: sub.title,
            status: sub.status,
            trackedSeconds: sub.trackedSeconds,
            createdAt: isApproval ? (sub.approvalRequestedAt ?? sub.updatedAt ?? sub.createdAt) : sub.createdAt,
          })
        }
      }
    }

    return result.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "approval" ? -1 : 1
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return bTime - aTime
    })
  }, [currentUserId, projects])

  const approvalCount = items.filter((item) => item.kind === "approval").length
  const approvalItems = items.filter((item) => item.kind === "approval")
  const taskItems = items.filter((item) => item.kind === "task")
  const recentItems = [
    ...approvalItems,
    ...taskItems.slice(0, Math.max(0, 8 - approvalItems.length)),
  ]

  function openActivity(item: RecentItem) {
    setOpen(false)
    if (item.kind === "approval") {
      openProjectFollowUp({
        projectId: item.projectId,
        activityId: item.activityId,
        subactivityId: item.subactivityId,
      })
      return
    }
    if (preferences.interfaceMode === "focused") {
      const params = new URLSearchParams({
        space: "project",
        project: item.projectId,
        activity: item.activityId,
        sub: item.subactivityId,
      })
      router.push(`/?${params.toString()}`)
      return
    }
    router.push(`/projetos/${item.projectId}#activity-${item.activityId}`)
  }

  async function decideApproval(item: RecentItem, approved: boolean) {
    if (decisionSaving) return
    setDecisionSaving({ id: item.subactivityId, approved })
    try {
      await decideSubactivityApproval(item.subactivityId, approved)
    } finally {
      setDecisionSaving(null)
    }
  }

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "relative flex size-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          compact ? "rounded-full" : "rounded-xl border border-border bg-card",
          open && (compact ? "bg-primary/10 text-primary" : "border-primary/25 bg-primary/[0.06] text-foreground"),
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

      <AnchoredPopoverPortal
        open={open}
        anchorRef={wrapperRef}
        onClose={closePopover}
        side={popoverSide}
        desktopWidth={430}
        ariaLabel="Subatividades recentes"
      >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3.5">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Subatividades recentes</p>
              <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                {items.length === 0
                  ? "Nenhuma subatividade pendente"
                  : approvalCount > 0
                    ? `${approvalCount} ${approvalCount === 1 ? "aprovação pendente" : "aprovações pendentes"} · ${items.length} pendências`
                    : `${items.length} ${items.length === 1 ? "pendente atribuída" : "pendentes atribuídas"} a você`}
              </p>
            </div>
            <span className="hidden size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground md:flex">
              <ListTodo className="size-4" />
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
              aria-label="Fechar subatividades recentes"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 md:max-h-[min(520px,70vh)] md:flex-none">
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
                const isApproval = item.kind === "approval"
                const isSaving = decisionSaving?.id === item.subactivityId

                return (
                  <div
                    key={item.subactivityId}
                    className={cn(
                      "group rounded-xl border border-transparent transition-colors",
                      isApproval
                        ? "border-rose-400/15 bg-rose-500/[0.045] hover:border-rose-400/20 hover:bg-rose-500/[0.065]"
                        : "hover:bg-muted",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => openActivity(item)}
                      className="w-full rounded-xl px-3 py-3 text-left"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span className={cn(
                          "mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors",
                          isApproval
                            ? "bg-rose-400/[0.09] text-rose-300/75 group-hover:text-rose-200"
                            : "bg-muted text-muted-foreground group-hover:text-foreground",
                        )}>
                          {isApproval ? <ClipboardCheck className="size-3.5" /> : <ListTodo className="size-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.subactivityTitle}</span>
                            <span className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6rem] font-medium",
                              isApproval ? "bg-rose-400/[0.08] text-rose-200/75" : meta.className,
                            )}>
                              <span className={cn("size-1.5 rounded-full", isApproval ? "bg-rose-300/70" : meta.dot)} />
                              {isApproval ? "Sua aprovação" : meta.label}
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

                    {isApproval && (
                      <div className="mx-3 flex items-center justify-between gap-3 border-t border-rose-300/10 pb-2.5 pt-2">
                        <span className="min-w-0 text-[0.64rem] font-medium text-rose-100/65">
                          Aguardando sua aprovação
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => { void decideApproval(item, false) }}
                            disabled={Boolean(decisionSaving)}
                            className="flex size-7 items-center justify-center rounded-lg border border-border/70 bg-background/30 text-muted-foreground transition-colors hover:border-rose-300/20 hover:bg-rose-400/[0.07] hover:text-rose-200 disabled:pointer-events-none disabled:opacity-45"
                            title="Revogar e devolver para Backlog"
                            aria-label="Revogar aprovação e devolver para Backlog"
                          >
                            {isSaving && decisionSaving?.approved === false ? <LoaderCircle className="size-3.5 animate-spin" /> : <X className="size-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => { void decideApproval(item, true) }}
                            disabled={Boolean(decisionSaving)}
                            className="flex size-7 items-center justify-center rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300/80 transition-colors hover:bg-emerald-400/[0.11] hover:text-emerald-200 disabled:pointer-events-none disabled:opacity-45"
                            title="Aprovar e concluir"
                            aria-label="Aprovar e concluir subatividade"
                          >
                            {isSaving && decisionSaving?.approved === true ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                          </button>
                        </span>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {items.length > recentItems.length && (
            <div className="border-t border-border px-4 py-2.5 text-center text-[0.65rem] text-muted-foreground">
              Exibindo {recentItems.length} de {items.length} pendências. Aprovações ficam sempre no topo.
            </div>
          )}
      </AnchoredPopoverPortal>
    </div>
  )
}
