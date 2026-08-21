"use client"

import * as React from "react"
import { GitBranch, GitCommitHorizontal } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export type DeveloperTaskVcsChange = {
  id: string
  provider: "git" | "svn"
  revision: string
  branch: string
  message: string
  committedAt: string
}

function relativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function DeveloperVcsTaskChanges({
  changes,
  taskTitle,
  compact = true,
}: {
  changes: DeveloperTaskVcsChange[]
  taskTitle: string
  compact?: boolean
}) {
  if (changes.length === 0) return null

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            compact ? "size-8" : "h-8 gap-1.5 px-2.5 text-[0.66rem] font-semibold",
          )}
          title={`${changes.length} commit${changes.length === 1 ? "" : "s"}/revisão vinculada${changes.length === 1 ? "" : "s"}`}
        >
          <GitCommitHorizontal className="size-3.5" />
          {!compact && <span>Código</span>}
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[0.52rem] font-semibold leading-4 text-primary-foreground ring-2 ring-card">
            {changes.length > 99 ? "99+" : changes.length}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[min(580px,calc(100dvh-2rem))] w-[calc(100vw-1.5rem)] max-w-lg overflow-hidden p-0 sm:w-full">
        <DialogHeader className="border-b border-border px-4 py-3.5 pr-11 text-left">
          <DialogTitle className="text-base">Alterações vinculadas</DialogTitle>
          <DialogDescription className="line-clamp-2 text-xs">{taskTitle}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[430px] overflow-y-auto overscroll-contain p-3">
          <div className="space-y-1.5">
            {changes.map((change) => (
              <div key={change.id} className="rounded-xl border border-border bg-muted/25 px-3 py-2.5">
                <div className="flex min-w-0 items-start gap-2.5">
                  <span className={cn(
                    "mt-0.5 shrink-0 rounded-md px-1.5 py-1 font-mono text-[0.58rem] font-semibold uppercase",
                    change.provider === "git" ? "bg-primary/8 text-primary" : "bg-chart-3/10 text-chart-3",
                  )}>
                    {change.provider}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-[0.65rem] font-semibold">{change.revision}</span>
                      {change.branch && (
                        <span className="inline-flex min-w-0 items-center gap-1 truncate text-[0.6rem] text-muted-foreground">
                          <GitBranch className="size-3 shrink-0" />
                          <span className="truncate">{change.branch}</span>
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs font-medium leading-snug">{change.message || "Sem mensagem"}</p>
                    <p className="mt-1 text-[0.6rem] text-muted-foreground">{relativeDate(change.committedAt)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
