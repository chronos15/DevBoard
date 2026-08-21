"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, CheckCircle2, Clock3, Pause, Play, RotateCcw, Zap } from "lucide-react"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`
  if (m > 0) return `${m}min ${String(s).padStart(2, "0")}s`
  return `${s}s`
}

function sameLocalDay(value: string, now: Date) {
  const date = new Date(value)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

export function DeveloperSessionHub() {
  const router = useRouter()
  const { currentUserId, projects, workSessions, activeSubId, startTimer, stopTimer, findSub } = useStore()
  const [now, setNow] = React.useState(() => new Date())
  const [pending, setPending] = React.useState(false)

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const mySessions = React.useMemo(
    () => workSessions.filter((session) => session.userId === currentUserId).sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [currentUserId, workSessions],
  )

  const active = React.useMemo(() => activeSubId ? findSub(activeSubId) : null, [activeSubId, findSub, projects])
  const lastSession = mySessions.find((session) => {
    if (session.subactivityId === activeSubId) return false
    const found = findSub(session.subactivityId)
    return Boolean(found && found.sub.assigneeId === currentUserId && !["done", "cancelled", "waiting-aqs"].includes(found.sub.status))
  }) ?? null
  const last = lastSession ? findSub(lastSession.subactivityId) : null
  const activeSession = activeSubId ? mySessions.find((session) => session.subactivityId === activeSubId && !session.endedAt) : null
  const activeSessionStartedAt = activeSession?.startedAt ?? active?.sub.timerStartedAt
  const activeSessionSeconds = activeSessionStartedAt ? Math.max(0, Math.floor((now.getTime() - new Date(activeSessionStartedAt).getTime()) / 1000)) : 0

  const todaySummary = React.useMemo(() => {
    const today = mySessions.filter((session) => sameLocalDay(session.startedAt, now))
    let seconds = 0
    const subIds = new Set<string>()
    const projectIds = new Set<string>()
    for (const session of today) {
      seconds += session.endedAt ? session.durationSeconds : Math.max(0, Math.floor((now.getTime() - new Date(session.startedAt).getTime()) / 1000))
      subIds.add(session.subactivityId)
      const found = findSub(session.subactivityId)
      if (found) projectIds.add(found.project.id)
    }
    return { seconds, sessions: today.length, subactivities: subIds.size, projects: projectIds.size }
  }, [findSub, mySessions, now, projects])

  async function continueLast() {
    if (!last || pending) return
    setPending(true)
    const ok = await startTimer(last.sub.id)
    setPending(false)
    if (ok) router.push(`/projetos/${last.project.id}#sub-${last.sub.id}`)
  }

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card">
      <div className="min-w-0 p-4">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.62rem] font-semibold tracking-[0.16em] text-primary uppercase">Sessão de trabalho</p>
            <h2 className="mt-1 text-sm font-semibold sm:text-base">{active ? "Você está trabalhando agora" : "Continuar de onde parei"}</h2>
          </div>
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-xl", active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}><Zap className="size-3.5" /></span>
        </div>

        {active ? (
          <div className="rounded-xl border border-success/20 bg-success/[0.04] p-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="size-2 rounded-full bg-success animate-pulse" /><span className="text-[0.64rem] font-semibold text-success">EM EXECUÇÃO</span><span className="font-mono text-[0.68rem] text-muted-foreground">{formatDuration(activeSessionSeconds)}</span></div>
                <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug">{active.sub.title}</p>
                <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{active.project.name} · total registrado {formatDuration(active.sub.trackedSeconds)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link href={`/projetos/${active.project.id}#sub-${active.sub.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[0.68rem] font-semibold hover:bg-muted">Abrir tarefa<ArrowRight className="size-3" /></Link>
                <button type="button" onClick={() => void stopTimer(active.sub.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-2.5 text-[0.68rem] font-semibold text-background"><Pause className="size-3" />Pausar</button>
              </div>
            </div>
          </div>
        ) : last ? (
          <div className="rounded-xl border border-border bg-background/45 p-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[0.64rem] text-muted-foreground"><RotateCcw className="size-3" /><span>Último trabalho · {new Date(lastSession!.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
                <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-snug">{last.sub.title}</p>
                <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{last.project.name}</p>
              </div>
              <button type="button" onClick={() => void continueLast()} disabled={pending} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-[0.68rem] font-semibold text-primary-foreground disabled:opacity-50">{pending ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play className="size-3" />}Continuar</button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-4 py-4 text-center"><CheckCircle2 className="mx-auto size-4 text-muted-foreground" /><p className="mt-1.5 text-xs font-semibold">Nenhuma sessão anterior encontrada</p><p className="mt-1 text-[0.65rem] text-muted-foreground">Ao iniciar uma subatividade, o Painel Dev passa a lembrar de onde continuar.</p></div>
        )}
      </div>

      <div id="resumo-dia" className="min-w-0 border-t border-border px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex shrink-0 items-center gap-2"><Clock3 className="size-3.5 text-primary" /><h3 className="text-xs font-semibold">Resumo de hoje</h3></div>
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:max-w-[430px] sm:grid-cols-4">
            <div className="min-w-0 rounded-lg bg-muted/45 px-2.5 py-2"><p className="text-[0.58rem] text-muted-foreground">Tempo</p><p className="mt-0.5 truncate text-xs font-semibold">{formatDuration(todaySummary.seconds)}</p></div>
            <div className="min-w-0 rounded-lg bg-muted/45 px-2.5 py-2"><p className="text-[0.58rem] text-muted-foreground">Sessões</p><p className="mt-0.5 text-xs font-semibold">{todaySummary.sessions}</p></div>
            <div className="min-w-0 rounded-lg bg-muted/45 px-2.5 py-2"><p className="text-[0.58rem] text-muted-foreground">Subativ.</p><p className="mt-0.5 text-xs font-semibold">{todaySummary.subactivities}</p></div>
            <div className="min-w-0 rounded-lg bg-muted/45 px-2.5 py-2"><p className="text-[0.58rem] text-muted-foreground">Projetos</p><p className="mt-0.5 text-xs font-semibold">{todaySummary.projects}</p></div>
          </div>
        </div>
      </div>
    </section>
  )
}
