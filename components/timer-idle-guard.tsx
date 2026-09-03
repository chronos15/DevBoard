"use client"

import * as React from "react"
import { Clock3, MousePointer2, PauseCircle, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { getIdleDetectorConstructor, IDLE_PERMISSION_CHANGED_EVENT, storedIdleDetectionPermission } from "@/lib/idle-detection"

const WARNING_AFTER_MS = 4 * 60 * 1000
const PAUSE_AFTER_MS = 5 * 60 * 1000
const WARNING_WINDOW_MS = PAUSE_AFTER_MS - WARNING_AFTER_MS

async function notifyIdle(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return
  const options: NotificationOptions = {
    body,
    tag,
    icon: "/devboard-icon-192.png",
    badge: "/devboard-icon-64.png",
    silent: false,
  }

  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready
      await registration.showNotification(title, options)
      return
    }
  } catch {
    // Cai para Notification nativa.
  }

  try { new Notification(title, options) } catch { /* contexto sem permissão */ }
}

type WarningState = {
  kind: "warning" | "paused"
  subId: string
  subTitle: string
  projectName: string
  deadline?: number
}

export function TimerIdleGuard() {
  const { activeSubId, projects, workItemTypes, stopTimer } = useStore()
  const [warning, setWarning] = React.useState<WarningState | null>(null)
  const [remainingSeconds, setRemainingSeconds] = React.useState(60)
  const [permissionVersion, setPermissionVersion] = React.useState(0)
  const lastActivityRef = React.useRef(Date.now())
  const pauseInFlightRef = React.useRef(false)
  const warningNotifiedRef = React.useRef<string | null>(null)

  const activeMeta = React.useMemo(() => {
    if (!activeSubId) return null
    for (const project of projects) {
      for (const activity of project.activities) {
        const sub = activity.subactivities.find((item) => item.id === activeSubId)
        if (sub) {
          return {
            subTitle: sub.title,
            projectName: project.name,
            subTypeId: sub.typeId ?? null,
            activityTypeId: activity.typeId ?? null,
          }
        }
      }
    }
    return null
  }, [activeSubId, projects])

  const activeSubTitle = activeMeta?.subTitle ?? ""
  const activeProjectName = activeMeta?.projectName ?? ""
  const activeSubTypeId = activeMeta?.subTypeId ?? null
  const activeActivityTypeId = activeMeta?.activityTypeId ?? null

  const intermittent = React.useMemo(() => {
    const subType = activeSubTypeId ? workItemTypes.find((type) => type.id === activeSubTypeId) : undefined
    const activityType = activeActivityTypeId ? workItemTypes.find((type) => type.id === activeActivityTypeId) : undefined
    return Boolean(subType?.intermittent || activityType?.intermittent)
  }, [activeActivityTypeId, activeSubTypeId, workItemTypes])

  const clearWarning = React.useCallback(() => {
    warningNotifiedRef.current = null
    setWarning(null)
    setRemainingSeconds(60)
  }, [])

  const markActive = React.useCallback(() => {
    lastActivityRef.current = Date.now()
    clearWarning()
  }, [clearWarning])

  const pauseForIdle = React.useCallback(async () => {
    if (!activeSubId || !activeSubTitle || intermittent || pauseInFlightRef.current) return
    pauseInFlightRef.current = true
    try {
      const ok = await stopTimer(activeSubId)
      if (!ok) return
      const pausedState: WarningState = {
        kind: "paused",
        subId: activeSubId,
        subTitle: activeSubTitle,
        projectName: activeProjectName,
      }
      setWarning(pausedState)
      void notifyIdle(
        "Cronômetro pausado por inatividade",
        `“${activeSubTitle}” foi pausada após 5 minutos sem atividade.`,
        `devboard-idle-paused-${activeSubId}`,
      )
      window.setTimeout(() => {
        setWarning((current) => current?.kind === "paused" && current.subId === activeSubId ? null : current)
      }, 12000)
    } finally {
      pauseInFlightRef.current = false
    }
  }, [activeProjectName, activeSubId, activeSubTitle, intermittent, stopTimer])

  const showWarning = React.useCallback((deadline: number) => {
    if (!activeSubId || !activeSubTitle || intermittent) return
    const next: WarningState = {
      kind: "warning",
      subId: activeSubId,
      subTitle: activeSubTitle,
      projectName: activeProjectName,
      deadline,
    }
    setWarning(next)
    if (warningNotifiedRef.current !== activeSubId) {
      warningNotifiedRef.current = activeSubId
      void notifyIdle(
        "Cronômetro será pausado em 1 minuto",
        `Sem atividade detectada. “${activeSubTitle}” será pausada automaticamente aos 5 minutos.`,
        `devboard-idle-warning-${activeSubId}`,
      )
    }
  }, [activeProjectName, activeSubId, activeSubTitle, intermittent])

  React.useEffect(() => {
    const onPermissionChanged = () => setPermissionVersion((value) => value + 1)
    window.addEventListener(IDLE_PERMISSION_CHANGED_EVENT, onPermissionChanged)
    return () => window.removeEventListener(IDLE_PERMISSION_CHANGED_EVENT, onPermissionChanged)
  }, [])

  React.useEffect(() => {
    lastActivityRef.current = Date.now()
    pauseInFlightRef.current = false
    clearWarning()
  }, [activeSubId, clearWarning, intermittent])

  React.useEffect(() => {
    if (!activeSubId || !activeSubTitle || intermittent || typeof window === "undefined") return

    let disposed = false
    let fallbackInterval: number | null = null
    let countdownInterval: number | null = null
    let detectorAbort: AbortController | null = null

    const updateCountdown = () => {
      setWarning((current) => {
        if (!current || current.kind !== "warning" || !current.deadline) return current
        const seconds = Math.max(0, Math.ceil((current.deadline - Date.now()) / 1000))
        setRemainingSeconds(seconds)
        if (seconds <= 0) void pauseForIdle()
        return current
      })
    }

    countdownInterval = window.setInterval(updateCountdown, 1000)

    const startFallback = () => {
      if (disposed || fallbackInterval !== null) return
        lastActivityRef.current = Date.now()

      const events: Array<keyof WindowEventMap> = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"]
      for (const name of events) window.addEventListener(name, markActive, { passive: true })
      const onVisible = () => {
        if (document.visibilityState === "visible") markActive()
      }
      document.addEventListener("visibilitychange", onVisible)

      fallbackInterval = window.setInterval(() => {
        const elapsed = Date.now() - lastActivityRef.current
        if (elapsed >= PAUSE_AFTER_MS) {
          void pauseForIdle()
          return
        }
        if (elapsed >= WARNING_AFTER_MS) {
          showWarning(lastActivityRef.current + PAUSE_AFTER_MS)
        }
      }, 1000)

      const previousCleanup = cleanupFallbackRef.current
      previousCleanup?.()
      cleanupFallbackRef.current = () => {
        for (const name of events) window.removeEventListener(name, markActive)
        document.removeEventListener("visibilitychange", onVisible)
        if (fallbackInterval !== null) window.clearInterval(fallbackInterval)
        fallbackInterval = null
      }
    }

    const cleanupFallbackRef = { current: null as null | (() => void) }

    async function startSystemIdleDetector() {
      const IdleDetectorCtor = getIdleDetectorConstructor()
      if (!IdleDetectorCtor || storedIdleDetectionPermission() !== "granted") {
        startFallback()
        return
      }

      detectorAbort = new AbortController()
      try {
        const detector = new IdleDetectorCtor()
        detector.addEventListener("change", () => {
          if (disposed) return
          if (detector.userState === "idle") {
            showWarning(Date.now() + WARNING_WINDOW_MS)
          } else {
            lastActivityRef.current = Date.now()
            clearWarning()
          }
        })
        await detector.start({ threshold: WARNING_AFTER_MS, signal: detectorAbort.signal })
        if (disposed) return
      } catch {
        if (!disposed) startFallback()
      }
    }

    void startSystemIdleDetector()

    return () => {
      disposed = true
      detectorAbort?.abort()
      cleanupFallbackRef.current?.()
      if (countdownInterval !== null) window.clearInterval(countdownInterval)
    }
  }, [activeSubId, activeSubTitle, clearWarning, intermittent, markActive, pauseForIdle, permissionVersion, showWarning])

  if (!warning) return null

  if (warning.kind === "paused") {
    return (
      <div className="fixed bottom-4 right-4 z-[10020] w-[min(390px,calc(100vw-2rem))] rounded-2xl border border-border bg-popover p-3.5 shadow-2xl shadow-black/20">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <PauseCircle className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Pausada por inatividade</p>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              “{warning.subTitle}” foi pausada após 5 minutos sem atividade detectada.
            </p>
          </div>
          <button type="button" onClick={() => setWarning(null)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Fechar aviso">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 z-[10020] w-[min(410px,calc(100vw-2rem))] rounded-2xl border border-warning/30 bg-popover p-3.5 shadow-2xl shadow-black/20">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
          <MousePointer2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Inatividade detectada</p>
            <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 font-mono text-[0.66rem] font-semibold tabular-nums text-warning">
              <Clock3 className="size-3" />
              {String(Math.floor(Math.max(0, remainingSeconds) / 60)).padStart(2, "0")}:{String(Math.max(0, remainingSeconds) % 60).padStart(2, "0")}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            O cronômetro de “{warning.subTitle}” será pausado automaticamente aos 5 minutos sem atividade.
          </p>
          <button
            type="button"
            onClick={markActive}
            className="mt-2 inline-flex h-8 items-center rounded-lg bg-primary px-3 text-[0.68rem] font-semibold text-primary-foreground hover:opacity-90"
          >
            Continuar trabalhando
          </button>
        </div>
      </div>
    </div>
  )
}
