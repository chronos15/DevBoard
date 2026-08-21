"use client"

import * as React from "react"
import Link from "next/link"
import { Check, Clock3, ExternalLink, Pause, TimerReset, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useStore } from "@/lib/store"
import {
  DEFAULT_DEVELOPER_SETTINGS,
  DEVELOPER_CONTEXTS_EVENT,
  DEVELOPER_FOCUS_EVENT,
  DEVELOPER_SETTINGS_EVENT,
  DEVELOPER_TIMER_STARTED_EVENT,
  developerFocusStorageKey,
  mapDeveloperSettings,
  minutesOfDay,
  safeExternalUrl,
  startDeveloperFocusSession,
  type DeveloperSettings,
} from "@/lib/developer/panel"
import {
  contextForProject,
  developerLaunchUri,
  normalizeDeveloperContext,
  normalizeDeveloperIde,
  normalizeDeveloperLocalProject,
  type DeveloperContextRecord,
  type DeveloperIdeRecord,
  type DeveloperLocalProjectRecord,
} from "@/lib/developer/context"

const SETTINGS_SELECT = "work_start,work_end,break_start,break_end,work_days,hydration_goal_ml,hydration_cup_ml,hydration_reminder_minutes,notify_shift_end,notify_hydration,music_provider,music_url,ide_kind,ide_workspace_path,ide_custom_uri,focus_minutes,break_minutes,auto_focus_on_timer,auto_open_ide_on_timer,auto_open_music_on_timer,notify_forgotten_timer,forgotten_timer_minutes,notify_wrapup,wrapup_minutes"

type AgentPrompt =
  | { kind: "forgotten"; subId: string; title: string; description: string }
  | { kind: "wrapup"; title: string; description: string }
  | { kind: "ended"; title: string; description: string }

async function notify(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return
  const options: NotificationOptions = { body, icon: "/devboard-icon-192.png", badge: "/devboard-icon-64.png", tag, data: { url: "/dev" } }
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.register("/devboard-sw.js")
      await registration.showNotification(title, options)
      return
    }
  } catch { /* fallback */ }
  try { new Notification(title, options) } catch { /* opcional */ }
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function DeveloperAutomationAgent() {
  const supabase = React.useMemo(() => createClient(), [])
  const { hydrated, currentUserId, currentUserRole, projects, activeSubId, stopTimer } = useStore()
  const [settings, setSettings] = React.useState<DeveloperSettings>({ ...DEFAULT_DEVELOPER_SETTINGS })
  const [contexts, setContexts] = React.useState<DeveloperContextRecord[]>([])
  const [ides, setIdes] = React.useState<DeveloperIdeRecord[]>([])
  const [localProjects, setLocalProjects] = React.useState<DeveloperLocalProjectRecord[]>([])
  const [prompt, setPrompt] = React.useState<AgentPrompt | null>(null)

  const loadAutomation = React.useCallback(async () => {
    if (!currentUserId || currentUserRole !== "developer") return
    const [{ data: settingsRow, error: settingsError }, { data: contextRows, error: contextError }, { data: ideRows }, { data: localRows }] = await Promise.all([
      supabase.from("developer_settings").select(SETTINGS_SELECT).eq("user_id", currentUserId).maybeSingle(),
      supabase.from("developer_contexts").select("id,name,devboard_project_id,local_project_id,ide_id,music_provider,music_url,auto_focus,auto_open_ide,auto_open_music,sort_order").eq("user_id", currentUserId).order("sort_order").order("created_at"),
      supabase.from("developer_ides").select("id,name,kind,icon,custom_uri_template").eq("user_id", currentUserId),
      supabase.from("developer_local_projects").select("id,name,folder_name,ide_id,legacy_path").eq("user_id", currentUserId),
    ])
    if (settingsError) throw settingsError
    if (contextError) throw contextError
    setSettings(mapDeveloperSettings(settingsRow))
    setContexts((contextRows ?? []).map(normalizeDeveloperContext))
    setIdes((ideRows ?? []).map(normalizeDeveloperIde))
    setLocalProjects((localRows ?? []).map(normalizeDeveloperLocalProject))
  }, [currentUserId, currentUserRole, supabase])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer" || !currentUserId) return
    void loadAutomation().catch(() => undefined)
    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<DeveloperSettings>).detail
      if (detail) setSettings(detail)
    }
    const onContexts = () => void loadAutomation().catch(() => undefined)
    window.addEventListener(DEVELOPER_SETTINGS_EVENT, onSettings)
    window.addEventListener(DEVELOPER_CONTEXTS_EVENT, onContexts)
    const channel = supabase
      .channel(`devboard-developer-automation-${currentUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_contexts", filter: `user_id=eq.${currentUserId}` }, onContexts)
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_ides", filter: `user_id=eq.${currentUserId}` }, onContexts)
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_local_projects", filter: `user_id=eq.${currentUserId}` }, onContexts)
      .subscribe()
    return () => {
      window.removeEventListener(DEVELOPER_SETTINGS_EVENT, onSettings)
      window.removeEventListener(DEVELOPER_CONTEXTS_EVENT, onContexts)
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, currentUserRole, hydrated, loadAutomation, supabase])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer" || !currentUserId) return

    const onTimerStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string; subactivityId?: string }>).detail
      const context = contextForProject(contexts, detail?.projectId, currentUserId)

      if (settings.autoFocusOnTimer && (context?.autoFocus ?? true)) {
        startDeveloperFocusSession(currentUserId, settings.focusMinutes)
      }

      if (settings.autoOpenMusicOnTimer && context?.autoOpenMusic) {
        const target = safeExternalUrl(context.musicUrl || settings.musicUrl)
        if (target) window.open(target, "_blank", "noopener,noreferrer")
      }

      if (settings.autoOpenIdeOnTimer && context?.autoOpenIde) {
        const local = localProjects.find((item) => item.id === context.localProjectId) ?? null
        const ideId = context.ideId || local?.ideId
        const ide = ides.find((item) => item.id === ideId) ?? null
        const uri = developerLaunchUri(ide, local)
        if (uri) {
          const anchor = document.createElement("a")
          anchor.href = uri
          anchor.style.display = "none"
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
        }
      }
    }

    window.addEventListener(DEVELOPER_TIMER_STARTED_EVENT, onTimerStarted)
    return () => window.removeEventListener(DEVELOPER_TIMER_STARTED_EVENT, onTimerStarted)
  }, [contexts, currentUserId, currentUserRole, hydrated, ides, localProjects, settings])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer" || !currentUserId) return
    const key = developerFocusStorageKey(currentUserId)
    const checkFocus = () => {
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) return
        const state = JSON.parse(raw) as { mode?: "focus" | "break"; remaining?: number; running?: boolean; endAt?: number | null }
        if (!state.running || !state.endAt || Number(state.endAt) > Date.now()) return
        const finishedMode = state.mode === "break" ? "break" : "focus"
        const nextMode = finishedMode === "focus" ? "break" : "focus"
        const seconds = (nextMode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60
        const next = { mode: nextMode, remaining: seconds, running: false, endAt: null }
        window.localStorage.setItem(key, JSON.stringify(next))
        window.dispatchEvent(new CustomEvent(DEVELOPER_FOCUS_EVENT, { detail: next }))
        const marker = `devboard-focus-completed:${currentUserId}:${finishedMode}:${Math.floor(Number(state.endAt) / 1000)}`
        if (window.localStorage.getItem(marker) !== "1") {
          window.localStorage.setItem(marker, "1")
          void notify(
            finishedMode === "focus" ? "Bloco de foco concluído" : "Pausa concluída",
            finishedMode === "focus" ? "Seu bloco terminou. Faça uma pausa curta antes de continuar." : "Sua pausa terminou. Você pode voltar ao foco quando estiver pronto.",
            `devboard-focus-global-${finishedMode}`,
          )
        }
      } catch { /* estado local opcional */ }
    }
    checkFocus()
    const timer = window.setInterval(checkFocus, 1000)
    return () => window.clearInterval(timer)
  }, [currentUserId, currentUserRole, hydrated, settings.breakMinutes, settings.focusMinutes])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer" || !currentUserId) return
    const check = () => {
      const now = new Date()
      const today = dateKey(now)
      const currentMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
      const endMinutes = minutesOfDay(settings.workEnd)

      if (settings.notifyWrapup && settings.workDays.includes(now.getDay())) {
        const wrapupAt = endMinutes - settings.wrapupMinutes
        if (currentMinutes >= wrapupAt && currentMinutes < endMinutes) {
          const key = `devboard-developer-wrapup:${currentUserId}:${today}`
          let shown = false
          try { shown = window.localStorage.getItem(key) === "1" } catch { /* segue */ }
          if (!shown) {
            try { window.localStorage.setItem(key, "1") } catch { /* segue */ }
            setPrompt({ kind: "wrapup", title: "Hora de organizar o fim do dia", description: `Seu expediente termina às ${settings.workEnd}. Revise a sessão atual, pendências e o resumo de hoje.` })
            void notify("Fim do expediente se aproximando", `Faltam ${settings.wrapupMinutes} min para ${settings.workEnd}.`, `devboard-wrapup-${today}`)
          }
        }
        if (currentMinutes >= endMinutes) {
          const key = `devboard-developer-ended-panel:${currentUserId}:${today}`
          let shown = false
          try { shown = window.localStorage.getItem(key) === "1" } catch { /* segue */ }
          if (!shown) {
            try { window.localStorage.setItem(key, "1") } catch { /* segue */ }
            setPrompt({ kind: "ended", title: "Expediente encerrado", description: activeSubId ? "Há uma subatividade ainda em execução. Revise o resumo antes de fechar o dia." : "Seu horário terminou. Veja o resumo do dia e deixe o próximo passo preparado." })
          }
        }
      }

      if (!settings.notifyForgottenTimer || !activeSubId) return
      let found: { title: string; timerStartedAt?: string } | null = null
      for (const project of projects) {
        for (const activity of project.activities) {
          const sub = activity.subactivities.find((item) => item.id === activeSubId)
          if (sub) { found = { title: sub.title, timerStartedAt: sub.timerStartedAt }; break }
        }
        if (found) break
      }
      if (!found?.timerStartedAt) return
      const elapsedMinutes = (Date.now() - new Date(found.timerStartedAt).getTime()) / 60_000
      if (elapsedMinutes < settings.forgottenTimerMinutes) return
      const sessionKey = new Date(found.timerStartedAt).getTime()
      const key = `devboard-developer-forgotten:${currentUserId}:${activeSubId}:${sessionKey}`
      let shown = false
      try { shown = window.localStorage.getItem(key) === "1" } catch { /* segue */ }
      if (shown) return
      try { window.localStorage.setItem(key, "1") } catch { /* segue */ }
      const hours = Math.max(1, Math.floor(elapsedMinutes / 60))
      setPrompt({ kind: "forgotten", subId: activeSubId, title: "Cronômetro ainda está ativo", description: `“${found.title}” está em execução há cerca de ${hours}h. Você ainda está trabalhando nisso?` })
      void notify("Cronômetro possivelmente esquecido", `A subatividade “${found.title}” continua em execução.`, `devboard-forgotten-${activeSubId}`)
    }

    check()
    const timer = window.setInterval(check, 15_000)
    return () => window.clearInterval(timer)
  }, [activeSubId, currentUserId, currentUserRole, hydrated, projects, settings])

  if (!prompt || currentUserRole !== "developer") return null

  return (
    <div className="fixed bottom-4 right-4 z-[95] w-[min(390px,calc(100vw-2rem))] rounded-2xl border border-border bg-card p-4 shadow-2xl">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {prompt.kind === "forgotten" ? <TimerReset className="size-4" /> : <Clock3 className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{prompt.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{prompt.description}</p>
        </div>
        <button type="button" onClick={() => setPrompt(null)} className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Fechar"><X className="size-3.5" /></button>
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {prompt.kind === "forgotten" ? (
          <>
            <button type="button" onClick={() => setPrompt(null)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted"><Check className="mr-1.5 inline size-3.5" />Continuar</button>
            <button type="button" onClick={() => { void stopTimer(prompt.subId); setPrompt(null) }} className="h-9 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground"><Pause className="mr-1.5 inline size-3.5" />Pausar timer</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setPrompt(null)} className="h-9 rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted">Continuar trabalhando</button>
            <Link href="/dev#resumo-dia" onClick={() => setPrompt(null)} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground"><ExternalLink className="size-3.5" />Revisar meu dia</Link>
          </>
        )}
      </div>
    </div>
  )
}
