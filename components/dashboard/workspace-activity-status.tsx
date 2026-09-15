"use client"

import * as React from "react"
import Link from "next/link"
import { Activity, ArrowRight, ChevronDown, CircleOff, Clock3, Eye, Gauge, UsersRound } from "lucide-react"
import { MemberAvatar } from "@/components/member-avatar"
import { useStore } from "@/lib/store"
import { followUpHref } from "@/lib/follow-up-launcher"
import { formatHMS, statusMeta } from "@/lib/project-utils"
import { recentWork, workForMember, workLastMovement } from "@/lib/member-work-activity"
import { MemberWorkDashboardDialog } from "@/components/dashboard/member-work-dashboard-dialog"
import { ACCESS_ROLE_LABELS, type Member, type WorkSession } from "@/lib/types"
import { cn } from "@/lib/utils"

const IDLE_AFTER_MS = 2 * 60 * 1000
function shortElapsed(iso: string | undefined, now: number) {
  if (!iso) return "agora"
  const value = new Date(iso).getTime()
  if (!Number.isFinite(value)) return "agora"
  const seconds = Math.max(0, Math.floor((now - value) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}min`
}

function roleLabel(member: Member) {
  return member.role ? ACCESS_ROLE_LABELS[member.role] : "Membro"
}

function formatHM(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function effectiveSecondsToday(sessions: WorkSession[], memberId: string, now: number) {
  const current = new Date(now)
  const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  let total = 0
  for (const session of sessions) {
    if (session.userId !== memberId) continue
    const rawStart = new Date(session.startedAt).getTime()
    const rawEnd = session.endedAt ? new Date(session.endedAt).getTime() : now
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue
    const start = Math.max(rawStart, dayStart)
    const end = Math.min(rawEnd, dayEnd, now)
    if (end > start) total += Math.floor((end - start) / 1000)
  }
  return total
}

export function WorkspaceActivityStatus() {
  const { members, memberPresence, presenceReady, projects, workSessions, currentUserId, currentUserRole } = useStore()
  const [now, setNow] = React.useState(() => Date.now())
  const [expandedMemberId, setExpandedMemberId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<"presence" | "effective">("presence")
  const [dashboardMemberId, setDashboardMemberId] = React.useState<string | null>(null)

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  const rows = React.useMemo(() => members.map((member) => {
    const presence = memberPresence[member.id]
    const work = workForMember(projects, member.id)
    const activeWork = work.filter((item) => item.subactivity.status !== "done")
    const running = work.find((item) => item.subactivity.status === "in-progress" && item.subactivity.assigneeId === member.id)
    const lastActiveTime = presence?.lastActiveAt ? new Date(presence.lastActiveAt).getTime() : 0
    const idle = Boolean(presence?.online && lastActiveTime && now - lastActiveTime >= IDLE_AFTER_MS)
    return { member, presence, work, activeWork, running, idle }
  }).sort((a, b) => {
    const score = (row: typeof a) => row.running ? 0 : row.presence?.online && !row.idle ? 1 : row.presence?.online ? 2 : 3
    return score(a) - score(b) || a.member.name.localeCompare(b.member.name, "pt-BR")
  }), [memberPresence, members, now, projects])

  const onlineCount = rows.filter((row) => row.presence?.online).length
  const runningCount = rows.filter((row) => row.running).length

  const effectiveRows = React.useMemo(() => members.map((member) => {
    const seconds = effectiveSecondsToday(workSessions, member.id, now)
    const work = workForMember(projects, member.id)
    const running = work.find((item) => item.subactivity.status === "in-progress" && item.subactivity.assigneeId === member.id)
    const weekday = new Date(now).getDay()
    const configuredMinutes = Number(member.workSchedule?.[weekday] ?? 0)
    const workDays = Array.isArray(member.workDays) ? member.workDays : [1, 2, 3, 4, 5]
    const legacyScheduledToday = workDays.includes(weekday)
    const legacyDailyHours = Number.isFinite(member.dailyHours) && Number(member.dailyHours) > 0 ? Number(member.dailyHours) : 8
    const targetMinutes = configuredMinutes > 0 ? configuredMinutes : legacyScheduledToday ? Math.round(legacyDailyHours * 60) : 0
    const scheduledToday = targetMinutes > 0
    const targetSeconds = targetMinutes * 60
    return { member, seconds, running, scheduledToday, targetSeconds }
  }).sort((a, b) => b.seconds - a.seconds || a.member.name.localeCompare(b.member.name, "pt-BR")), [members, now, projects, workSessions])

  const dashboardMember = members.find((member) => member.id === dashboardMemberId) ?? null

  return (
    <>
    <section className="flex h-full min-h-[360px] min-w-0 flex-col rounded-2xl bg-card p-4 ring-1 ring-foreground/8 sm:p-5 xl:h-[420px] xl:min-h-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UsersRound className="size-4 shrink-0 text-primary" />
            <h2 className="text-base font-semibold">Equipe</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{view === "presence" ? "Presença e últimas movimentações operacionais da equipe." : "Horas efetivadas hoje em subatividades executadas."}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {view === "presence" && (!presenceReady ? (
            <span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">Sincronizando…</span>
          ) : (
            <>
              <span className="hidden rounded-full bg-success/10 px-2 py-1 text-[0.62rem] font-semibold text-success sm:inline-flex">{onlineCount} online</span>
              <span className="hidden rounded-full bg-primary/10 px-2 py-1 text-[0.62rem] font-semibold text-primary sm:inline-flex">{runningCount} executando</span>
            </>
          ))}
          {currentUserRole === "admin" && (
            <button
              type="button"
              onClick={() => { setView((current) => current === "presence" ? "effective" : "presence"); setExpandedMemberId(null) }}
              className="flex size-8 items-center justify-center rounded-lg border border-border bg-background/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={view === "presence" ? "Ver horas efetivadas" : "Ver presença da equipe"}
              aria-label={view === "presence" ? "Ver horas efetivadas" : "Ver presença da equipe"}
            >
              {view === "presence" ? <Gauge className="size-4" /> : <UsersRound className="size-4" />}
            </button>
          )}
        </div>
      </div>

      {view === "presence" ? (
      <div className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {rows.map(({ member, presence, work, activeWork, running, idle }) => {
          const screen = presence?.screenLabel || "TaskBoard"
          const online = Boolean(presence?.online)
          const noTasks = activeWork.length === 0
          const canViewMore = currentUserRole === "admin" || member.id === currentUserId
          const expanded = expandedMemberId === member.id
          const latest = recentWork(work)

          return (
            <div
              key={member.id}
              className={cn(
                "overflow-hidden rounded-xl border transition-colors",
                expanded ? "border-border bg-muted/25" : "border-transparent",
              )}
            >
              <button
                type="button"
                onClick={() => setExpandedMemberId((current) => current === member.id ? null : member.id)}
                className="flex w-full min-w-0 items-center gap-3 px-2.5 py-2.5 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Recolher" : "Expandir"} atividades de ${member.name}`}
              >
                <div className="relative shrink-0">
                  <MemberAvatar member={member} className="size-9" />
                  <span className={cn(
                    "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
                    running ? "bg-primary" : online ? (idle ? "bg-warning" : "bg-success") : "bg-muted-foreground/35",
                  )} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold">{member.name}</span>
                    <span className="shrink-0 text-[0.6rem] text-muted-foreground">{roleLabel(member)}</span>
                  </div>

                  {running ? (
                    <>
                      <p className="mt-0.5 truncate text-xs font-medium text-foreground/90">{running.subactivity.title}</p>
                      <p className="mt-0.5 truncate text-[0.64rem] text-muted-foreground">
                        {running.project.name} · {running.activityTitle} · <span className="font-mono">{formatHMS(running.subactivity.trackedSeconds)}</span>
                      </p>
                    </>
                  ) : online ? (
                    <>
                      <p className="mt-0.5 truncate text-xs font-medium text-foreground/85">
                        {noTasks ? "Sem tarefas abertas" : idle ? `Parado em ${screen}` : `Navegando em ${screen}`}
                      </p>
                      <p className="mt-0.5 truncate text-[0.64rem] text-muted-foreground">
                        {noTasks ? screen : `${activeWork.length} tarefa${activeWork.length === 1 ? "" : "s"} ativa${activeWork.length === 1 ? "" : "s"}`}
                        {presence?.lastActiveAt ? ` · interação há ${shortElapsed(presence.lastActiveAt, now)}` : ""}
                      </p>
                    </>
                  ) : !presenceReady && !presence ? (
                    <>
                      <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">Atualizando status…</p>
                      <p className="mt-0.5 truncate text-[0.64rem] text-muted-foreground/75">Sincronizando Presence do workspace</p>
                    </>
                  ) : (
                    <>
                      <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">Offline</p>
                      <p className="mt-0.5 truncate text-[0.64rem] text-muted-foreground/75">
                        {noTasks ? "Sem tarefas abertas" : `${activeWork.length} tarefa${activeWork.length === 1 ? "" : "s"} ativa${activeWork.length === 1 ? "" : "s"}`}
                      </p>
                    </>
                  )}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[0.6rem] font-semibold",
                    running ? "bg-primary/10 text-primary"
                      : online && idle ? "bg-warning/10 text-warning"
                      : online ? "bg-success/10 text-success"
                      : "bg-muted text-muted-foreground",
                  )}>
                    {running ? <Activity className="size-3" /> : online && idle ? <Clock3 className="size-3" /> : online ? <Eye className="size-3" /> : <CircleOff className="size-3" />}
                    {running ? "Executando" : !presenceReady ? "…" : online && idle ? "Parado" : online ? "Online" : "Offline"}
                  </span>
                  <div className="flex items-center gap-1 text-[0.56rem] text-muted-foreground">
                    {presenceReady && presence?.connections && presence.connections > 1 ? <span>{presence.connections} sessões</span> : null}
                    <ChevronDown className={cn("size-3 transition-transform", expanded && "rotate-180")} />
                  </div>
                </div>
              </button>

              {expanded && (
                <div className="border-t border-border/70 px-2.5 pb-2.5 pt-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                    <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Últimas movimentações</span>
                    <span className="font-mono text-[0.6rem] tabular-nums text-muted-foreground">{Math.min(work.length, 3)}/{work.length}</span>
                  </div>

                  {latest.length > 0 ? (
                    <div className="space-y-1">
                      {latest.map((item) => {
                        const isRunning = item.subactivity.status === "in-progress" && item.subactivity.assigneeId === member.id
                        const meta = statusMeta[item.subactivity.status]
                        const movement = workLastMovement(item)
                        const changedAgo = movement.at ? shortElapsed(new Date(movement.at).toISOString(), now) : "agora"
                        return (
                          <Link
                            key={item.subactivity.id}
                            href={followUpHref({ projectId: item.project.id, activityId: item.activityId, subactivityId: item.subactivity.id })}
                            className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-background/70"
                          >
                            <span className={cn("size-1.5 shrink-0 rounded-full", isRunning ? "bg-primary" : meta.dot)} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[0.72rem] font-medium group-hover:text-primary">{item.subactivity.title}</span>
                              <span className="mt-0.5 block truncate text-[0.6rem] text-muted-foreground">{item.project.name} · {item.activityTitle} · {movement.label.toLocaleLowerCase("pt-BR")} há {changedAgo}</span>
                            </span>
                            <span className={cn(
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[0.56rem] font-semibold",
                              isRunning ? "bg-primary/10 text-primary" : meta.className,
                            )}>
                              {isRunning ? "Executando" : meta.label}
                            </span>
                          </Link>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[0.68rem] text-muted-foreground">
                      Nenhuma movimentação operacional para este usuário. Itens em backlog não aparecem aqui.
                    </div>
                  )}

                  {canViewMore && (
                    <button
                      type="button"
                      onClick={() => setDashboardMemberId(member.id)}
                      className="mt-1.5 flex w-full items-center justify-between gap-3 rounded-lg border border-dashed border-primary/25 bg-primary/[0.035] px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0">
                        <span className="block text-[0.7rem] font-semibold text-primary">Mais</span>
                        <span className="mt-0.5 block truncate text-[0.58rem] text-muted-foreground">Dashboard, cronologia e Gantt de {member.name}</span>
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-primary" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {members.length === 0 && (
          <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
            Nenhum usuário disponível no workspace.
          </div>
        )}
      </div>
      ) : (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          <div className="grid gap-1.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
            {effectiveRows.map(({ member, seconds, running, scheduledToday, targetSeconds }) => {
              const percent = targetSeconds > 0 ? Math.round((seconds / targetSeconds) * 100) : null
              const gaugePercent = percent === null ? 0 : Math.min(100, percent)
              return (
                <div key={member.id} className="min-w-0 rounded-xl border border-border/70 bg-background/35 px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <MemberAvatar member={member} className="size-7 shrink-0" />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="line-clamp-2 break-words text-[0.72rem] font-semibold leading-[0.875rem]" title={member.name}>{member.name}</div>
                      <div className="mt-px truncate text-[0.54rem] leading-3 text-muted-foreground">{roleLabel(member)}</div>
                    </div>
                  </div>

                  <div className="mt-1.5 grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-2">
                    <div className="relative size-[3.25rem] shrink-0 rounded-full p-1" style={{ background: `conic-gradient(var(--primary) ${gaugePercent}%, var(--muted) ${gaugePercent}% 100%)` }}>
                      <div className="flex size-full items-center justify-center rounded-full bg-card">
                        <div className="text-center leading-none">
                          <div className="font-mono text-[0.62rem] font-semibold tabular-nums">{formatHM(seconds)}</div>
                          <div className="mt-0.5 text-[0.45rem] text-muted-foreground">{percent === null ? "folga" : `${percent}%`}</div>
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2 leading-[0.875rem]">
                        <span className="truncate text-[0.56rem] text-muted-foreground">Efetivado hoje</span>
                        <strong className="shrink-0 font-mono text-[0.68rem] tabular-nums">{formatHM(seconds)}</strong>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 leading-[0.875rem]">
                        <span className="truncate text-[0.54rem] text-muted-foreground">Meta configurada</span>
                        <span className="shrink-0 font-mono text-[0.54rem] text-muted-foreground">{scheduledToday ? formatHM(targetSeconds) : "Folga"}</span>
                      </div>
                    </div>
                  </div>

                  {running ? (
                    <Link href={followUpHref({ projectId: running.project.id, activityId: running.activityId, subactivityId: running.subactivity.id })} className="mt-1.5 block truncate border-t border-border/50 pt-1.5 text-[0.56rem] font-medium leading-3 text-primary hover:underline">
                      Executando · {running.subactivity.title}
                    </Link>
                  ) : (
                    <p className="mt-1.5 truncate border-t border-border/50 pt-1.5 text-[0.56rem] leading-3 text-muted-foreground">Nenhuma subatividade em execução agora</p>
                  )}
                </div>
              )
            })}
          </div>
          {effectiveRows.length === 0 && <div className="flex min-h-44 items-center justify-center text-xs text-muted-foreground">Nenhum usuário disponível no workspace.</div>}
        </div>
      )}
    </section>
    <MemberWorkDashboardDialog
      member={dashboardMember}
      projects={projects}
      workSessions={workSessions}
      presence={dashboardMember ? memberPresence[dashboardMember.id] : undefined}
      open={Boolean(dashboardMember)}
      onOpenChange={(open) => { if (!open) setDashboardMemberId(null) }}
    />
    </>
  )
}
