"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  ExternalLink,
  GitBranch,
  Pause,
  Play,
  RotateCcw,
  Zap,
} from "lucide-react"
import { useStore } from "@/lib/store"
import { SubactivityStatusConfirmDialog } from "@/components/project-detail/subactivity-status-confirm-dialog"

function formatTimer(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  if (h > 0) return `${h}h${m ? ` ${m}min` : ""}`
  if (m > 0) return `${m}min`
  return `${safe}s`
}

type Props = { onOpenEnvironment?: () => void }

export function DeveloperSessionHub({ onOpenEnvironment }: Props) {
  const router = useRouter()
  const {
    currentUserId,
    currentUserRole,
    projects,
    workSessions,
    activeSubId,
    startTimer,
    stopTimer,
    setSubStatus,
    findSub,
  } = useStore()
  const [now, setNow] = React.useState(() => new Date())
  const [pending, setPending] = React.useState(false)
  const [completeOpen, setCompleteOpen] = React.useState(false)

  React.useEffect(() => {
    const syncNow = () => setNow(new Date())
    const timer = window.setInterval(syncNow, 1000)
    const handleVisibility = () => {
      if (document.visibilityState === "visible") syncNow()
    }

    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("focus", syncNow)
    window.addEventListener("pageshow", syncNow)

    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("focus", syncNow)
      window.removeEventListener("pageshow", syncNow)
    }
  }, [])

  const mySessions = React.useMemo(
    () => workSessions
      .filter((session) => session.userId === currentUserId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()),
    [currentUserId, workSessions],
  )

  const active = React.useMemo(() => activeSubId ? findSub(activeSubId) : null, [activeSubId, findSub, projects])
  const lastSession = mySessions.find((session) => {
    if (session.subactivityId === activeSubId) return false
    const found = findSub(session.subactivityId)
    return Boolean(found && found.sub.assigneeId === currentUserId && !["done", "cancelled", "waiting-aqs"].includes(found.sub.status))
  }) ?? null
  const last = lastSession ? findSub(lastSession.subactivityId) : null
  const activeActivityTitle = active ? active.project.activities.find((activity) => activity.id === active.activityId)?.title ?? "Atividade" : ""
  const lastActivityTitle = last ? last.project.activities.find((activity) => activity.id === last.activityId)?.title ?? "Atividade" : ""
  const activeSession = activeSubId ? mySessions.find((session) => session.subactivityId === activeSubId && !session.endedAt) : null
  const activeStartedAt = activeSession?.startedAt ?? active?.sub.timerStartedAt
  const activeSessionSeconds = activeStartedAt
    ? Math.max(0, Math.floor((now.getTime() - new Date(activeStartedAt).getTime()) / 1000))
    : 0
  const activeTrackedSeconds = active?.sub.trackedSeconds ?? activeSessionSeconds
  const estimatedSeconds = active ? Math.max(0, Number(active.sub.estimatedHours || 0) * 3600) : 0
  const progress = estimatedSeconds > 0 ? Math.min(100, Math.round((activeTrackedSeconds / estimatedSeconds) * 100)) : 0

  async function continueLast() {
    if (!last || pending) return
    setPending(true)
    const ok = await startTimer(last.sub.id)
    setPending(false)
    if (ok) router.push(`/projetos/${last.project.id}#sub-${last.sub.id}`)
  }

  async function completeActive() {
    if (!active || pending) return
    setPending(true)
    const ok = await setSubStatus(active.sub.id, "done")
    setPending(false)
    if (ok) setCompleteOpen(false)
  }

  React.useEffect(() => {
    function focusFromShortcut() {
      if (window.location.hash !== "#dev-session") return
      window.requestAnimationFrame(() => document.getElementById("dev-session")?.focus({ preventScroll: false }))
    }
    focusFromShortcut()
    window.addEventListener("hashchange", focusFromShortcut)
    return () => window.removeEventListener("hashchange", focusFromShortcut)
  }, [])

  return (
    <>
      <section
        id="dev-session"
        tabIndex={-1}
        className="relative min-w-0 scroll-mt-24 overflow-hidden rounded-2xl border border-border bg-card outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[38%] overflow-hidden lg:block" aria-hidden="true">
          <div className="absolute right-[-3.5rem] top-1/2 size-72 -translate-y-1/2 rounded-full border border-primary/10" />
          <div className="absolute right-[-0.5rem] top-1/2 size-52 -translate-y-1/2 rounded-full border border-primary/15" />
          <div className="absolute right-[2.5rem] top-1/2 flex size-32 -translate-y-1/2 items-center justify-center rounded-full border border-primary/25 bg-primary/[0.06]">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-[0_0_45px_-18px_var(--primary)]">
              <Zap className="size-7" />
            </span>
          </div>
        </div>

        <div className="relative z-10 p-4 sm:p-5 lg:max-w-[68%] lg:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[0.64rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Trabalhando agora</p>
            {active && <span className="size-2 rounded-full bg-success shadow-[0_0_0_4px_color-mix(in_oklab,var(--success)_12%,transparent)]" />}
          </div>

          {active ? (
            <div className="mt-3 min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted-foreground">
                <span className="truncate font-medium text-foreground/80">{active.project.name}</span>
                <ArrowRight className="size-3 shrink-0" />
                <span className="truncate">{activeActivityTitle}</span>
                <ArrowRight className="size-3 shrink-0" />
                <span className="min-w-0 truncate">{active.sub.title}</span>
              </div>

              <p className="mt-4 font-mono text-[2.45rem] font-semibold leading-none tracking-[-0.07em] tabular-nums sm:text-5xl">
                {formatTimer(activeSessionSeconds)}
              </p>

              <div className="mt-3 max-w-xl">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[0.7rem]">
                  <span className="font-semibold">
                    {formatDuration(activeTrackedSeconds)}
                    {estimatedSeconds > 0 && <span className="font-normal text-muted-foreground"> / {formatDuration(estimatedSeconds)} estimadas</span>}
                  </span>
                  {estimatedSeconds > 0 && <span className="text-muted-foreground">{progress}%</span>}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${estimatedSeconds > 0 ? Math.max(3, progress) : 18}%` }} />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                <Link
                  href={`/projetos/${active.project.id}#sub-${active.sub.id}`}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90"
                >
                  Abrir <ExternalLink className="size-3.5" />
                </Link>
                <button type="button" onClick={onOpenEnvironment} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
                  <Code2 className="size-3.5" />IDE
                </button>
                <button type="button" onClick={onOpenEnvironment} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold hover:bg-muted">
                  <GitBranch className="size-3.5" />Git / SVN
                </button>
                <button type="button" disabled={pending} onClick={() => void stopTimer(active.sub.id)} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                  <Pause className="size-3.5" />Pausar
                </button>
                <button type="button" disabled={pending} onClick={() => setCompleteOpen(true)} className="col-span-2 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-success px-4 text-xs font-semibold text-success-foreground hover:opacity-90 disabled:opacity-50 sm:col-span-1">
                  <Check className="size-3.5" />Concluir
                </button>
              </div>
            </div>
          ) : last ? (
            <div className="mt-3 min-w-0">
              <div className="flex items-center gap-2 text-[0.68rem] text-muted-foreground"><RotateCcw className="size-3.5" /><span>Continuar de onde você parou</span></div>
              <h2 className="mt-3 line-clamp-2 text-lg font-semibold leading-snug sm:text-xl">{last.sub.title}</h2>
              <p className="mt-1.5 truncate text-xs text-muted-foreground">{last.project.name} · {lastActivityTitle}</p>
              <p className="mt-3 text-[0.68rem] text-muted-foreground">Última sessão em {new Date(lastSession!.startedAt).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              <button type="button" onClick={() => void continueLast()} disabled={pending} className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">
                {pending ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play className="size-3.5" />}
                Continuar trabalho
              </button>
            </div>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-background/30 px-4 py-7 text-center sm:text-left">
              <CheckCircle2 className="mx-auto size-5 text-success sm:mx-0" />
              <p className="mt-2 text-sm font-semibold">Tudo pronto para começar</p>
              <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">Inicie uma subatividade na fila abaixo. Sua sessão atual, tempo estimado e ações rápidas aparecem aqui.</p>
            </div>
          )}
        </div>
      </section>

      {active && (
        <SubactivityStatusConfirmDialog
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          subactivityTitle={active.sub.title}
          fromStatus={active.sub.status}
          toStatus="done"
          isAdmin={currentUserRole === "admin"}
          loading={pending}
          projectId={active.project.id}
          onConfirm={() => void completeActive()}
        />
      )}
    </>
  )
}
