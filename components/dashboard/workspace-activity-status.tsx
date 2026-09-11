"use client"

import * as React from "react"
import Link from "next/link"
import { Activity, ChevronDown, CircleOff, Clock3, Eye, Gauge, UsersRound } from "lucide-react"
import { MemberAvatar } from "@/components/member-avatar"
import { useStore } from "@/lib/store"
import { followUpHref } from "@/lib/follow-up-launcher"
import { formatHMS, statusMeta } from "@/lib/project-utils"
import { ACCESS_ROLE_LABELS, type Member, type Project, type Subactivity, type WorkSession } from "@/lib/types"
import { cn } from "@/lib/utils"

const IDLE_AFTER_MS = 2 * 60 * 1000
const OPEN_STATUSES = new Set(["backlog", "waiting", "waiting-aqs", "in-progress", "paused"])

type WorkRef = {
  project: Project
  activityId: string
  activityTitle: string
  subactivity: Subactivity
}

function workForMember(projects: Project[], memberId: string) {
  const work: WorkRef[] = []
  for (const project of projects) {
    for (const activity of project.activities) {
      const activityAssigned = Boolean(activity.assigneeIds?.includes(memberId))
      for (const subactivity of activity.subactivities) {
        if (!OPEN_STATUSES.has(subactivity.status)) continue
        const related = activityAssigned
          || subactivity.assigneeId === memberId
          || Boolean(subactivity.memberIds?.includes(memberId))
        if (!related) continue
        work.push({ project, activityId: activity.id, activityTitle: activity.title, subactivity })
      }
    }
  }
  return work
}

function recentWork(items: WorkRef[], memberId: string) {
  return [...items].sort((a, b) => {
    const aRunning = a.subactivity.status === "in-progress" && a.subactivity.assigneeId === memberId
    const bRunning = b.subactivity.status === "in-progress" && b.subactivity.assigneeId === memberId
    if (aRunning !== bRunning) return aRunning ? -1 : 1
    const aCreated = new Date(a.subactivity.createdAt ?? 0).getTime()
    const bCreated = new Date(b.subactivity.createdAt ?? 0).getTime()
    return bCreated - aCreated
  }).slice(0, 3)
}

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

const DAILY_EFFECTIVE_TARGET_SECONDS = 8 * 60 * 60

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
  const { members, memberPresence, presenceReady, projects, workSessions, currentUserRole } = useStore()
  const [now, setNow] = React.useState(() => Date.now())
  const [expandedMemberId, setExpandedMemberId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<"presence" | "effective">("presence")

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  const rows = React.useMemo(() => members.map((member) => {
    const presence = memberPresence[member.id]
    const work = workForMember(projects, member.id)
    const running = work.find((item) => item.subactivity.status === "in-progress" && item.subactivity.assigneeId === member.id)
    const lastActiveTime = presence?.lastActiveAt ? new Date(presence.lastActiveAt).getTime() : 0
    const idle = Boolean(presence?.online && lastActiveTime && now - lastActiveTime >= IDLE_AFTER_MS)
    return { member, presence, work, running, idle }
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
    return { member, seconds, running }
  }).sort((a, b) => b.seconds - a.seconds || a.member.name.localeCompare(b.member.name, "pt-BR")), [members, now, projects, workSessions])

  return (
    <section className="flex h-full min-h-[360px] min-w-0 flex-col rounded-2xl bg-card p-4 ring-1 ring-foreground/8 sm:p-5 xl:h-[420px] xl:min-h-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UsersRound className="size-4 shrink-0 text-primary" />
            <h2 className="text-base font-semibold">Equipe</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{view === "presence" ? "Status de todos os usuários do workspace em tempo real." : "Horas efetivadas hoje em subatividades executadas."}</p>
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
        {rows.map(({ member, presence, work, running, idle }) => {
          const screen = presence?.screenLabel || "TaskBoard"
          const online = Boolean(presence?.online)
          const noTasks = work.length === 0
          const expanded = expandedMemberId === member.id
          const latest = recentWork(work, member.id)

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
                        {noTasks ? screen : `${work.length} tarefa${work.length === 1 ? "" : "s"} aberta${work.length === 1 ? "" : "s"}`}
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
                        {noTasks ? "Sem tarefas abertas" : `${work.length} tarefa${work.length === 1 ? "" : "s"} aberta${work.length === 1 ? "" : "s"}`}
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
                    <span className="text-[0.62rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Últimas tarefas abertas</span>
                    <span className="font-mono text-[0.6rem] tabular-nums text-muted-foreground">{Math.min(work.length, 3)}/{work.length}</span>
                  </div>

                  {latest.length > 0 ? (
                    <div className="space-y-1">
                      {latest.map((item) => {
                        const isRunning = item.subactivity.status === "in-progress" && item.subactivity.assigneeId === member.id
                        const meta = statusMeta[item.subactivity.status]
                        return (
                          <Link
                            key={item.subactivity.id}
                            href={followUpHref({ projectId: item.project.id, activityId: item.activityId, subactivityId: item.subactivity.id })}
                            className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-background/70"
                          >
                            <span className={cn("size-1.5 shrink-0 rounded-full", isRunning ? "bg-primary" : meta.dot)} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[0.72rem] font-medium group-hover:text-primary">{item.subactivity.title}</span>
                              <span className="mt-0.5 block truncate text-[0.6rem] text-muted-foreground">{item.project.name} · {item.activityTitle}</span>
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
                      Nenhuma atividade ou subatividade aberta para este usuário.
                    </div>
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
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {effectiveRows.map(({ member, seconds, running }) => {
              const percent = Math.min(100, Math.round((seconds / DAILY_EFFECTIVE_TARGET_SECONDS) * 100))
              return (
                <div key={member.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border/70 bg-background/35 p-3">
                  <div className="relative size-16 shrink-0 rounded-full p-[5px]" style={{ background: `conic-gradient(var(--primary) ${percent}%, var(--muted) ${percent}% 100%)` }}>
                    <div className="flex size-full items-center justify-center rounded-full bg-card">
                      <div className="text-center">
                        <div className="font-mono text-[0.7rem] font-semibold tabular-nums">{formatHM(seconds)}</div>
                        <div className="text-[0.5rem] text-muted-foreground">{percent}%</div>
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <MemberAvatar member={member} className="size-7 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{member.name}</div>
                        <div className="truncate text-[0.58rem] text-muted-foreground">{roleLabel(member)}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="text-[0.6rem] text-muted-foreground">Efetivado hoje</span>
                      <strong className="font-mono text-xs tabular-nums">{formatHM(seconds)}</strong>
                    </div>
                    <div className="mt-0.5 flex items-baseline justify-between gap-2">
                      <span className="text-[0.58rem] text-muted-foreground">Referência visual</span>
                      <span className="font-mono text-[0.58rem] text-muted-foreground">08:00</span>
                    </div>
                    {running ? (
                      <Link href={followUpHref({ projectId: running.project.id, activityId: running.activityId, subactivityId: running.subactivity.id })} className="mt-2 block truncate text-[0.6rem] font-medium text-primary hover:underline">
                        Executando · {running.subactivity.title}
                      </Link>
                    ) : (
                      <p className="mt-2 truncate text-[0.6rem] text-muted-foreground">Nenhuma subatividade em execução agora</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          {effectiveRows.length === 0 && <div className="flex min-h-44 items-center justify-center text-xs text-muted-foreground">Nenhum usuário disponível no workspace.</div>}
        </div>
      )}
    </section>
  )
}
