"use client"

import * as React from "react"
import Link from "next/link"
import { Activity, CircleOff, Clock3, Eye, UsersRound } from "lucide-react"
import { MemberAvatar } from "@/components/member-avatar"
import { useStore } from "@/lib/store"
import { followUpHref } from "@/lib/follow-up-launcher"
import { formatHMS } from "@/lib/project-utils"
import { ACCESS_ROLE_LABELS, type Member, type Project, type Subactivity } from "@/lib/types"
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

export function WorkspaceActivityStatus() {
  const { members, memberPresence, presenceReady, projects } = useStore()
  const [now, setNow] = React.useState(() => Date.now())

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

  return (
    <section className="flex min-h-[360px] min-w-0 flex-col rounded-2xl bg-card p-4 ring-1 ring-foreground/8 sm:p-5 xl:h-[420px] xl:min-h-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UsersRound className="size-4 shrink-0 text-primary" />
            <h2 className="text-base font-semibold">Equipe agora</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Status de todos os usuários do workspace em tempo real.</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!presenceReady ? (
            <span className="rounded-full bg-muted px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground">Sincronizando…</span>
          ) : (
            <>
              <span className="rounded-full bg-success/10 px-2 py-1 text-[0.62rem] font-semibold text-success">{onlineCount} online</span>
              <span className="rounded-full bg-primary/10 px-2 py-1 text-[0.62rem] font-semibold text-primary">{runningCount} executando</span>
            </>
          )}
        </div>
      </div>

      <div className="mt-4 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]">
        {rows.map(({ member, presence, work, running, idle }) => {
          const screen = presence?.screenLabel || "TaskBoard"
          const online = Boolean(presence?.online)
          const noTasks = work.length === 0
          const href = running
            ? followUpHref({ projectId: running.project.id, activityId: running.activityId, subactivityId: running.subactivity.id })
            : undefined

          const content = (
            <>
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
                {presenceReady && presence?.connections && presence.connections > 1 ? (
                  <span className="text-[0.56rem] text-muted-foreground">{presence.connections} sessões</span>
                ) : null}
              </div>
            </>
          )

          return href ? (
            <Link key={member.id} href={href} className="flex min-w-0 items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5 transition-colors hover:border-border hover:bg-muted/45">
              {content}
            </Link>
          ) : (
            <div key={member.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-transparent px-2.5 py-2.5">
              {content}
            </div>
          )
        })}

        {members.length === 0 && (
          <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
            Nenhum usuário disponível no workspace.
          </div>
        )}
      </div>
    </section>
  )
}
