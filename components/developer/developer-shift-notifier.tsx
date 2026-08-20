"use client"

import * as React from "react"
import { createClient } from "@/lib/supabase/client"
import { useStore } from "@/lib/store"
import {
  DEFAULT_DEVELOPER_SETTINGS,
  DEVELOPER_SETTINGS_EVENT,
  DEVELOPER_WATER_EVENT,
  mapDeveloperSettings,
  minutesOfDay,
  shiftState,
  type DeveloperSettings,
} from "@/lib/developer/panel"

const SW_PATH = "/devboard-sw.js"
const CHECK_INTERVAL_MS = 30_000

async function showDeveloperNotification(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return
  const options: NotificationOptions = {
    body,
    icon: "/devboard-icon-192.png",
    badge: "/devboard-icon-64.png",
    tag,
    data: { url: "/dev" },
  }
  try {
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.register(SW_PATH)
      await registration.showNotification(title, options)
      return
    }
  } catch {
    // Usa Notification diretamente como fallback.
  }
  try { new Notification(title, options) } catch { /* sem contexto seguro/permissão */ }
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function DeveloperShiftNotifier() {
  const { hydrated, currentUserId, currentUserRole } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const [settings, setSettings] = React.useState<DeveloperSettings>({ ...DEFAULT_DEVELOPER_SETTINGS })

  const loadSettings = React.useCallback(async () => {
    if (!currentUserId || currentUserRole !== "developer") return
    const { data, error } = await supabase
      .from("developer_settings")
      .select("work_start,work_end,break_start,break_end,work_days,hydration_goal_ml,hydration_cup_ml,hydration_reminder_minutes,notify_shift_end,notify_hydration,music_provider,music_url,ide_kind,ide_workspace_path,ide_custom_uri,focus_minutes,break_minutes")
      .eq("user_id", currentUserId)
      .maybeSingle()
    // Migration ainda não aplicada: o restante do Devboard não deve ser afetado.
    if (error) return
    setSettings(mapDeveloperSettings(data))
  }, [currentUserId, currentUserRole, supabase])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer" || !currentUserId) return
    void loadSettings()

    const onSettings = (event: Event) => {
      const detail = (event as CustomEvent<DeveloperSettings>).detail
      if (detail) setSettings(detail)
      else void loadSettings()
    }
    const onWater = () => {
      try { window.localStorage.setItem(`devboard-developer-water-reminder:${currentUserId}`, String(Date.now())) } catch { /* opcional */ }
    }
    window.addEventListener(DEVELOPER_SETTINGS_EVENT, onSettings)
    window.addEventListener(DEVELOPER_WATER_EVENT, onWater)

    const channel = supabase
      .channel(`devboard-developer-notifier-${currentUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_settings", filter: `user_id=eq.${currentUserId}` }, () => void loadSettings())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "developer_water_logs", filter: `user_id=eq.${currentUserId}` }, () => {
        try { window.localStorage.setItem(`devboard-developer-water-reminder:${currentUserId}`, String(Date.now())) } catch { /* opcional */ }
      })
      .subscribe()

    return () => {
      window.removeEventListener(DEVELOPER_SETTINGS_EVENT, onSettings)
      window.removeEventListener(DEVELOPER_WATER_EVENT, onWater)
      void supabase.removeChannel(channel)
    }
  }, [currentUserId, currentUserRole, hydrated, loadSettings, supabase])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer" || !currentUserId) return

    const hydrationKey = `devboard-developer-water-reminder:${currentUserId}`
    try {
      if (!window.localStorage.getItem(hydrationKey)) window.localStorage.setItem(hydrationKey, String(Date.now()))
    } catch {
      // Sem localStorage, os avisos de expediente continuam disponíveis.
    }

    const check = () => {
      if (!("Notification" in window) || Notification.permission !== "granted") return
      const now = new Date()
      const state = shiftState(settings, now)
      const today = dateKey(now)

      if (settings.notifyShiftEnd && settings.workDays.includes(now.getDay())) {
        const currentMinutes = now.getHours() * 60 + now.getMinutes()
        const endMinutes = minutesOfDay(settings.workEnd)
        if (currentMinutes >= endMinutes && currentMinutes < endMinutes + 2) {
          const key = `devboard-developer-shift-end:${currentUserId}:${today}`
          let alreadyShown = false
          try { alreadyShown = window.localStorage.getItem(key) === "1" } catch { /* segue */ }
          if (!alreadyShown) {
            try { window.localStorage.setItem(key, "1") } catch { /* segue */ }
            void showDeveloperNotification(
              "Expediente encerrado",
              "Seu horário terminou. Revise os itens importantes, salve o que estiver fazendo e encerre o dia quando estiver pronto.",
              `devboard-shift-end-${today}`,
            )
          }
        }
      }

      if (settings.notifyHydration && state.kind === "working") {
        let lastReminder = Date.now()
        try { lastReminder = Number(window.localStorage.getItem(hydrationKey) || Date.now()) } catch { /* mantém agora */ }
        const intervalMs = Math.max(15, settings.hydrationReminderMinutes) * 60_000
        if (Date.now() - lastReminder >= intervalMs) {
          try { window.localStorage.setItem(hydrationKey, String(Date.now())) } catch { /* segue */ }
          void showDeveloperNotification(
            "Hora de tomar água",
            `Faça uma pausa rápida e registre sua hidratação no Painel Dev. Sua meta diária é ${settings.hydrationGoalMl} ml.`,
            "devboard-hydration",
          )
        }
      }
    }

    check()
    const timer = window.setInterval(check, CHECK_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [currentUserId, currentUserRole, hydrated, settings])

  return null
}
