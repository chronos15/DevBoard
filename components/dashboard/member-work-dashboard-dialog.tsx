"use client"

import * as React from "react"
import Link from "next/link"
import { Activity, ArrowUpRight, CalendarDays, CheckCircle2, Clock3, MessageSquareText, Paperclip, Pause, Play, Timer } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { MemberAvatar } from "@/components/member-avatar"
import { followUpHref, openProjectFollowUp } from "@/lib/follow-up-launcher"
import { recentWork, workForMember, workLastMovement, type MemberWorkRef } from "@/lib/member-work-activity"
import { formatHM, statusMeta } from "@/lib/project-utils"
import { ACCESS_ROLE_LABELS, type Member, type MemberPresence, type Project, type WorkSession } from "@/lib/types"
import { cn } from "@/lib/utils"

const GANTT_DAYS = 14

function startOfDay(value: number) {
  const date = new Date(value)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function sessionEnd(session: WorkSession, now: number) {
  if (session.endedAt) {
    const value = new Date(session.endedAt).getTime()
    if (Number.isFinite(value)) return value
  }
  if (!session.endedAt) return now
  const start = new Date(session.startedAt).getTime()
  return Number.isFinite(start) ? start + Math.max(0, session.durationSeconds) * 1000 : now
}

function sessionSeconds(session: WorkSession, now: number, rangeStart?: number, rangeEnd?: number) {
  const rawStart = new Date(session.startedAt).getTime()
  const rawEnd = sessionEnd(session, now)
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return 0
  const start = Math.max(rawStart, rangeStart ?? rawStart)
  const end = Math.min(rawEnd, rangeEnd ?? rawEnd, now)
  return end > start ? Math.floor((end - start) / 1000) : 0
}

function shortElapsed(timestamp: number, now: number) {
  if (!timestamp) return "agora"
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}min`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function movementIcon(kind: ReturnType<typeof workLastMovement>["kind"]) {
  if (kind === "comment") return MessageSquareText
  if (kind === "attachment") return Paperclip
  if (kind === "created") return CalendarDays
  return Activity
}

function MetricCard({ icon: Icon, label, value, hint }: { icon: typeof Clock3; label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/70 bg-background/55 p-3.5 shadow-sm sm:p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.68rem] font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 font-mono text-xl font-semibold tabular-nums sm:text-2xl">{value}</p>
          <p className="mt-1 truncate text-[0.62rem] text-muted-foreground">{hint}</p>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
      </div>
    </div>
  )
}

function Gantt({ memberId, work, workSessions, now, onNavigate }: { memberId: string; work: MemberWorkRef[]; workSessions: WorkSession[]; now: number; onNavigate: (item: MemberWorkRef) => void }) {
  const end = startOfDay(now) + 24 * 60 * 60 * 1000
  const start = end - GANTT_DAYS * 24 * 60 * 60 * 1000
  const duration = end - start
  const workMap = new Map(work.map((item) => [item.subactivity.id, item]))
  const sessions = workSessions
    .filter((session) => session.userId === memberId && workMap.has(session.subactivityId))
    .map((session) => ({ session, start: new Date(session.startedAt).getTime(), end: sessionEnd(session, now) }))
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > start && item.start < end)

  const rows = recentWork(
    work.filter((item) => sessions.some((entry) => entry.session.subactivityId === item.subactivity.id)),
    8,
  )

  const days = Array.from({ length: GANTT_DAYS }, (_, index) => start + index * 24 * 60 * 60 * 1000)

  if (rows.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed border-border bg-muted/15 px-4 text-center text-xs text-muted-foreground">
        Nenhuma sessão de execução registrada nos últimos {GANTT_DAYS} dias.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/45 [scrollbar-width:thin]">
      <div className="min-w-[760px] p-3 sm:p-4">
        <div className="grid grid-cols-[210px_minmax(520px,1fr)] gap-3 border-b border-border/70 pb-2">
          <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Subatividade</span>
          <div className="grid" style={{ gridTemplateColumns: `repeat(${GANTT_DAYS}, minmax(0,1fr))` }}>
            {days.map((day, index) => (
              <span key={day} className={cn("text-center font-mono text-[0.56rem] text-muted-foreground", index === GANTT_DAYS - 1 && "font-semibold text-primary")}>
                {new Date(day).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
              </span>
            ))}
          </div>
        </div>

        <div className="divide-y divide-border/60">
          {rows.map((item) => {
            const itemSessions = sessions.filter((entry) => entry.session.subactivityId === item.subactivity.id)
            const meta = statusMeta[item.subactivity.status]
            return (
              <div key={item.subactivity.id} className="grid grid-cols-[210px_minmax(520px,1fr)] items-center gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => onNavigate(item)}
                  className="group min-w-0 rounded-lg px-1 py-1 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={`Abrir acompanhamento de ${item.subactivity.title}`}
                >
                  <div className="truncate text-[0.7rem] font-medium transition-colors group-hover:text-primary">{item.subactivity.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={cn("size-1.5 rounded-full", meta.dot)} />
                    <span className="truncate text-[0.56rem] text-muted-foreground">{item.project.name}</span>
                  </div>
                </button>
                <div className="relative h-7 overflow-hidden rounded-lg bg-muted/35">
                  <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${GANTT_DAYS}, minmax(0,1fr))` }}>
                    {days.map((day) => <span key={day} className="border-r border-border/45 last:border-r-0" />)}
                  </div>
                  {itemSessions.map(({ session, start: rawStart, end: rawEnd }) => {
                    const segmentStart = Math.max(start, rawStart)
                    const segmentEnd = Math.min(end, rawEnd)
                    const left = ((segmentStart - start) / duration) * 100
                    const width = Math.max(0.75, ((segmentEnd - segmentStart) / duration) * 100)
                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => onNavigate(item)}
                        className="absolute top-1/2 h-3 -translate-y-1/2 rounded-full bg-primary shadow-sm outline-none transition-[filter,box-shadow] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                        style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                        title={`${item.subactivity.title} · ${new Date(segmentStart).toLocaleString("pt-BR")} → ${new Date(segmentEnd).toLocaleString("pt-BR")}`}
                        aria-label={`Abrir acompanhamento de ${item.subactivity.title}`}
                      />
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function MemberWorkDashboardDialog({
  member,
  projects,
  workSessions,
  presence,
  open,
  onOpenChange,
}: {
  member: Member | null
  projects: Project[]
  workSessions: WorkSession[]
  presence?: MemberPresence
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [open])

  const work = React.useMemo(() => member ? workForMember(projects, member.id) : [], [member, projects])
  const timeline = React.useMemo(() => recentWork(work, work.length), [work])
  const memberSessions = React.useMemo(() => member ? workSessions.filter((session) => session.userId === member.id) : [], [member, workSessions])

  if (!member) return null

  const todayStart = startOfDay(now)
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000
  const todaySeconds = memberSessions.reduce((total, session) => total + sessionSeconds(session, now, todayStart, todayStart + 24 * 60 * 60 * 1000), 0)
  const weekSeconds = memberSessions.reduce((total, session) => total + sessionSeconds(session, now, weekStart, todayStart + 24 * 60 * 60 * 1000), 0)
  const runningCount = work.filter((item) => item.subactivity.status === "in-progress").length
  const pausedCount = work.filter((item) => item.subactivity.status === "paused").length
  const completedCount = work.filter((item) => item.subactivity.status === "done").length
  const role = member.role ? ACCESS_ROLE_LABELS[member.role] : "Membro"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[calc(100dvh-16px)] w-[calc(100vw-16px)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:h-[min(92dvh,900px)] sm:w-[calc(100vw-32px)] sm:max-w-[1280px]" showCloseButton>
        <DialogHeader className="shrink-0 border-b border-border/70 bg-gradient-to-br from-primary/[0.06] via-background to-background px-4 py-4 pr-12 text-left sm:px-6 sm:py-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="relative shrink-0">
              <MemberAvatar member={member} className="size-12 text-sm sm:size-14" />
              <span className={cn("absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-background", presence?.online ? "bg-success" : "bg-muted-foreground/35")} />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate text-lg font-semibold leading-tight sm:text-xl">{member.name}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span>{role}</span>
                <span aria-hidden>·</span>
                <span>{presence?.online ? `Online${presence.screenLabel ? ` em ${presence.screenLabel}` : ""}` : "Offline"}</span>
                <span aria-hidden>·</span>
                <span>{timeline.length} item{timeline.length === 1 ? "" : "s"} movimentado{timeline.length === 1 ? "" : "s"}</span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain bg-muted/[0.12] px-3 py-3 [scrollbar-width:thin] sm:px-5 sm:py-5">
          <div className="mx-auto flex w-full max-w-[1220px] flex-col gap-4 sm:gap-5">
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <MetricCard icon={Clock3} label="Horas hoje" value={formatHM(todaySeconds)} hint={`7 dias: ${formatHM(weekSeconds)}`} />
              <MetricCard icon={Play} label="Em execução" value={String(runningCount)} hint="subatividades em andamento" />
              <MetricCard icon={Pause} label="Pausadas" value={String(pausedCount)} hint="aguardando retomada" />
              <MetricCard icon={CheckCircle2} label="Concluídas" value={String(completedCount)} hint={`${timeline.length} itens movimentados`} />
            </div>

            <section className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm sm:p-5">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2"><Timer className="size-4 text-primary" /><h3 className="text-sm font-semibold">Gantt de execução</h3></div>
                  <p className="mt-1 text-[0.68rem] text-muted-foreground">Sessões efetivamente registradas nos últimos {GANTT_DAYS} dias.</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 font-mono text-[0.6rem] text-muted-foreground">{formatHM(weekSeconds)} / 7 dias</span>
              </div>
              <Gantt
                memberId={member.id}
                work={work}
                workSessions={workSessions}
                now={now}
                onNavigate={(item) => {
                  onOpenChange(false)
                  openProjectFollowUp({ projectId: item.project.id, activityId: item.activityId, subactivityId: item.subactivity.id })
                }}
              />
            </section>

            <section className="rounded-2xl border border-border/70 bg-card p-3.5 shadow-sm sm:p-5">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2"><Activity className="size-4 text-primary" /><h3 className="text-sm font-semibold">Cronologia de atividades</h3></div>
                  <p className="mt-1 text-[0.68rem] text-muted-foreground">Mais recentes primeiro. Backlog e canceladas não entram neste resumo.</p>
                </div>
                <span className="shrink-0 font-mono text-[0.62rem] text-muted-foreground">{timeline.length}</span>
              </div>

              {timeline.length > 0 ? (
                <div className="divide-y divide-border/60">
                  {timeline.map((item) => {
                    const movement = workLastMovement(item)
                    const MovementIcon = movementIcon(movement.kind)
                    const meta = statusMeta[item.subactivity.status]
                    return (
                      <Link
                        key={item.subactivity.id}
                        href={followUpHref({ projectId: item.project.id, activityId: item.activityId, subactivityId: item.subactivity.id })}
                        onClick={() => onOpenChange(false)}
                        className="group flex min-w-0 items-start gap-3 px-1 py-3 transition-colors hover:bg-muted/35 sm:px-2"
                      >
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                          <MovementIcon className="size-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="min-w-0 flex-1 break-words text-xs font-semibold leading-relaxed sm:text-sm">{item.subactivity.title}</span>
                            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.58rem] font-semibold", meta.className)}>{meta.label}</span>
                          </span>
                          <span className="mt-1 block break-words text-[0.64rem] leading-relaxed text-muted-foreground">{item.project.name} · {item.activityTitle}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.6rem] text-muted-foreground">
                            <span>{movement.label} há {shortElapsed(movement.at, now)}</span>
                            <span className="font-mono">{formatHM(item.subactivity.trackedSeconds)} registradas</span>
                            <span>{item.subactivity.comments?.length ?? 0} comentário{(item.subactivity.comments?.length ?? 0) === 1 ? "" : "s"}</span>
                          </span>
                        </span>
                        <ArrowUpRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                  Nenhuma movimentação operacional encontrada para este usuário.
                </div>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
