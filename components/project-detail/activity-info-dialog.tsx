"use client"

import * as React from "react"
import { Activity as ActivityIcon, CheckCircle2, Clock3, Gauge, Info, ListChecks, Timer, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MemberAvatar } from "@/components/member-avatar"
import { useStore } from "@/lib/store"
import { activityEstimated, activityTracked, formatHours, statusMeta } from "@/lib/project-utils"
import type { Activity, Project, Status } from "@/lib/types"
import { cn } from "@/lib/utils"

const visibleStatuses: Status[] = ["backlog", "waiting", "in-progress", "paused", "waiting-aqs", "done", "cancelled"]

export function ActivityInfoDialog({ activity, project, triggerClassName, compact = false }: { activity: Activity; project?: Project; triggerClassName?: string; compact?: boolean }) {
  const { members, workItemTypes } = useStore()
  const [open, setOpen] = React.useState(false)
  const total = activity.subactivities.length
  const done = activity.subactivities.filter((sub) => sub.status === "done").length
  const completion = total ? Math.round((done / total) * 100) : 0
  const tracked = activityTracked(activity)
  const estimated = activityEstimated(activity)
  const type = workItemTypes.find((item) => item.id === activity.typeId)
  const assignees = (activity.assigneeIds ?? []).map((id) => members.find((member) => member.id === id)).filter(Boolean)
  const statusCounts = visibleStatuses.map((status) => ({ status, count: activity.subactivities.filter((sub) => sub.status === status).length })).filter((entry) => entry.count > 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="ghost" size={compact ? "icon-xs" : "icon-sm"} onClick={() => setOpen(true)} className={triggerClassName} title="Informações da atividade" aria-label={`Informações da atividade ${activity.title}`}>
        <Info className="size-3.5" />
      </Button>
      <DialogContent className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] flex-col overflow-hidden p-0 sm:h-auto sm:max-h-[90dvh] sm:max-w-3xl md:max-w-4xl" showCloseButton>
        <DialogHeader className="border-b border-border px-5 py-5 pr-14 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ActivityIcon className="size-5" /></span>
            <div className="min-w-0 flex-1"><DialogTitle className="text-lg leading-snug sm:text-xl">{activity.title}</DialogTitle><p className="mt-1 text-xs text-muted-foreground">{project?.name ?? "Projeto"}{project?.client ? ` · ${project.client}` : ""}</p></div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric icon={ListChecks} label="Subatividades" value={`${done}/${total}`} hint={`${completion}% concluído`} />
            <Metric icon={Timer} label="Tempo registrado" value={formatHours(tracked)} hint="tempo acumulado" />
            <Metric icon={Clock3} label="Estimativa" value={formatHours(estimated)} hint={estimated ? "estimativa total" : "sem estimativa"} />
            <Metric icon={Gauge} label="Progresso" value={`${completion}%`} hint={total ? `${total - done} pendente${total - done === 1 ? "" : "s"}` : "sem subatividades"} />
          </div>
          <section className="mt-5 rounded-2xl border border-border bg-card/50 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">Descrição da atividade</h3>{type && <span className="rounded-full bg-primary/10 px-2 py-1 text-[0.64rem] font-semibold text-primary">{type.name}</span>}</div>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/85">{activity.title}</p>
          </section>
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.42fr)]">
            <section className="min-w-0 rounded-2xl border border-border bg-card/50 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Subatividades e status</h3><span className="text-[0.68rem] text-muted-foreground">{total} item{total === 1 ? "" : "s"}</span></div>
              <div className="mt-3 space-y-2">
                {activity.subactivities.length ? activity.subactivities.map((sub) => {
                  const meta = statusMeta[sub.status]
                  const assignee = members.find((member) => member.id === sub.assigneeId)
                  return <div key={sub.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/55 px-3 py-3"><span className={cn("size-2 shrink-0 rounded-full", meta.dot)} /><div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-medium leading-snug">{sub.title}</p><div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.65rem] text-muted-foreground"><span>{meta.label}</span><span>·</span><span>{formatHours(sub.trackedSeconds)}</span>{assignee && <><span>·</span><span className="truncate">{assignee.name}</span></>}</div></div></div>
                }) : <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">Nenhuma subatividade criada nesta atividade.</div>}
              </div>
            </section>
            <div className="space-y-4">
              <section className="rounded-2xl border border-border bg-card/50 p-4"><div className="flex items-center gap-2"><UsersRound className="size-4 text-primary" /><h3 className="text-sm font-semibold">Responsáveis</h3></div><div className="mt-3 space-y-2">{assignees.length ? assignees.map((member) => member && <div key={member.id} className="flex items-center gap-2 rounded-xl bg-background/60 p-2.5"><MemberAvatar member={member} className="size-8" /><div className="min-w-0"><p className="truncate text-xs font-semibold">{member.name}</p><p className="text-[0.62rem] text-muted-foreground">{member.role === "admin" ? "Administrador" : "Desenvolvedor"}</p></div></div>) : <p className="text-xs leading-relaxed text-muted-foreground">Sem responsável específico. Desenvolvedores podem criar subatividades normalmente.</p>}</div></section>
              <section className="rounded-2xl border border-border bg-card/50 p-4"><div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-primary" /><h3 className="text-sm font-semibold">Distribuição</h3></div><div className="mt-3 space-y-2">{statusCounts.length ? statusCounts.map(({ status, count }) => <div key={status} className="flex items-center gap-2 text-xs"><span className={cn("size-2 rounded-full", statusMeta[status].dot)} /><span className="min-w-0 flex-1 text-muted-foreground">{statusMeta[status].label}</span><strong className="font-mono text-foreground">{count}</strong></div>) : <p className="text-xs text-muted-foreground">Sem status para exibir.</p>}</div></section>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Metric({ icon: Icon, label, value, hint }: { icon: typeof ActivityIcon; label: string; value: string; hint: string }) {
  return <div className="rounded-2xl border border-border bg-card/60 p-4"><div className="flex items-center gap-2 text-muted-foreground"><Icon className="size-4" /><span className="text-[0.68rem] font-medium">{label}</span></div><p className="mt-2 text-xl font-semibold tracking-tight">{value}</p><p className="mt-0.5 text-[0.62rem] text-muted-foreground">{hint}</p></div>
}
