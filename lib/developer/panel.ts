export type DeveloperMusicProvider = "spotify" | "youtube-music"
export type DeveloperIdeKind = "vscode" | "cursor" | "visual-studio" | "delphi" | "jetbrains" | "custom"

export type DeveloperSettings = {
  workStart: string
  workEnd: string
  breakStart: string
  breakEnd: string
  workDays: number[]
  hydrationGoalMl: number
  hydrationCupMl: number
  hydrationReminderMinutes: number
  notifyShiftEnd: boolean
  notifyHydration: boolean
  musicProvider: DeveloperMusicProvider
  musicUrl: string
  ideKind: DeveloperIdeKind
  ideWorkspacePath: string
  ideCustomUri: string
  focusMinutes: number
  breakMinutes: number
  autoFocusOnTimer: boolean
  autoOpenIdeOnTimer: boolean
  autoOpenMusicOnTimer: boolean
  notifyForgottenTimer: boolean
  forgottenTimerMinutes: number
  notifyWrapup: boolean
  wrapupMinutes: number
}

export type DeveloperNote = {
  id: string
  content: string
  pinned: boolean
  createdAt: string
  updatedAt: string
}

export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = {
  workStart: "08:00",
  workEnd: "18:00",
  breakStart: "12:00",
  breakEnd: "13:00",
  workDays: [1, 2, 3, 4, 5],
  hydrationGoalMl: 2500,
  hydrationCupMl: 300,
  hydrationReminderMinutes: 60,
  notifyShiftEnd: true,
  notifyHydration: false,
  musicProvider: "spotify",
  musicUrl: "",
  ideKind: "vscode",
  ideWorkspacePath: "",
  ideCustomUri: "",
  focusMinutes: 50,
  breakMinutes: 10,
  autoFocusOnTimer: true,
  autoOpenIdeOnTimer: false,
  autoOpenMusicOnTimer: false,
  notifyForgottenTimer: true,
  forgottenTimerMinutes: 120,
  notifyWrapup: true,
  wrapupMinutes: 30,
}

export const DEVELOPER_SETTINGS_EVENT = "devboard:developer-settings-updated"
export const DEVELOPER_WATER_EVENT = "devboard:developer-water-logged"
export const DEVELOPER_TIMER_STARTED_EVENT = "devboard:developer-timer-started"
export const DEVELOPER_FOCUS_EVENT = "devboard:developer-focus-control"
export const DEVELOPER_CONTEXTS_EVENT = "devboard:developer-contexts-updated"
export const FOCUS_STORAGE_PREFIX = "devboard-developer-focus-v1"

export function normalizeTime(value?: string | null, fallback = "08:00") {
  const match = String(value ?? "").match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : fallback
}

export function mapDeveloperSettings(row: any): DeveloperSettings {
  if (!row) return { ...DEFAULT_DEVELOPER_SETTINGS }
  return {
    workStart: normalizeTime(row.work_start, DEFAULT_DEVELOPER_SETTINGS.workStart),
    workEnd: normalizeTime(row.work_end, DEFAULT_DEVELOPER_SETTINGS.workEnd),
    breakStart: normalizeTime(row.break_start, DEFAULT_DEVELOPER_SETTINGS.breakStart),
    breakEnd: normalizeTime(row.break_end, DEFAULT_DEVELOPER_SETTINGS.breakEnd),
    workDays: Array.isArray(row.work_days) && row.work_days.length ? row.work_days.map(Number) : [...DEFAULT_DEVELOPER_SETTINGS.workDays],
    hydrationGoalMl: Number(row.hydration_goal_ml || DEFAULT_DEVELOPER_SETTINGS.hydrationGoalMl),
    hydrationCupMl: Number(row.hydration_cup_ml || DEFAULT_DEVELOPER_SETTINGS.hydrationCupMl),
    hydrationReminderMinutes: Number(row.hydration_reminder_minutes || DEFAULT_DEVELOPER_SETTINGS.hydrationReminderMinutes),
    notifyShiftEnd: row.notify_shift_end !== false,
    notifyHydration: row.notify_hydration === true,
    musicProvider: row.music_provider === "youtube-music" ? "youtube-music" : "spotify",
    musicUrl: String(row.music_url ?? ""),
    ideKind: (["vscode", "cursor", "visual-studio", "delphi", "jetbrains", "custom"] as const).includes(row.ide_kind)
      ? row.ide_kind
      : "vscode",
    ideWorkspacePath: String(row.ide_workspace_path ?? ""),
    ideCustomUri: String(row.ide_custom_uri ?? ""),
    focusMinutes: Number(row.focus_minutes || DEFAULT_DEVELOPER_SETTINGS.focusMinutes),
    breakMinutes: Number(row.break_minutes || DEFAULT_DEVELOPER_SETTINGS.breakMinutes),
    autoFocusOnTimer: row.auto_focus_on_timer !== false,
    autoOpenIdeOnTimer: row.auto_open_ide_on_timer === true,
    autoOpenMusicOnTimer: row.auto_open_music_on_timer === true,
    notifyForgottenTimer: row.notify_forgotten_timer !== false,
    forgottenTimerMinutes: Number(row.forgotten_timer_minutes || DEFAULT_DEVELOPER_SETTINGS.forgottenTimerMinutes),
    notifyWrapup: row.notify_wrapup !== false,
    wrapupMinutes: Number(row.wrapup_minutes || DEFAULT_DEVELOPER_SETTINGS.wrapupMinutes),
  }
}

export function developerSettingsRow(userId: string, settings: DeveloperSettings) {
  return {
    user_id: userId,
    work_start: settings.workStart,
    work_end: settings.workEnd,
    break_start: settings.breakStart,
    break_end: settings.breakEnd,
    work_days: settings.workDays,
    hydration_goal_ml: settings.hydrationGoalMl,
    hydration_cup_ml: settings.hydrationCupMl,
    hydration_reminder_minutes: settings.hydrationReminderMinutes,
    notify_shift_end: settings.notifyShiftEnd,
    notify_hydration: settings.notifyHydration,
    music_provider: settings.musicProvider,
    music_url: settings.musicUrl.trim(),
    ide_kind: settings.ideKind,
    ide_workspace_path: settings.ideWorkspacePath.trim(),
    ide_custom_uri: settings.ideCustomUri.trim(),
    focus_minutes: settings.focusMinutes,
    break_minutes: settings.breakMinutes,
    auto_focus_on_timer: settings.autoFocusOnTimer,
    auto_open_ide_on_timer: settings.autoOpenIdeOnTimer,
    auto_open_music_on_timer: settings.autoOpenMusicOnTimer,
    notify_forgotten_timer: settings.notifyForgottenTimer,
    forgotten_timer_minutes: settings.forgottenTimerMinutes,
    notify_wrapup: settings.notifyWrapup,
    wrapup_minutes: settings.wrapupMinutes,
  }
}

export function minutesOfDay(value: string) {
  const [hours, minutes] = normalizeTime(value, "00:00").split(":").map(Number)
  return hours * 60 + minutes
}

export function shiftState(settings: DeveloperSettings, now = new Date()) {
  const day = now.getDay()
  const workday = settings.workDays.includes(day)
  const current = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
  const start = minutesOfDay(settings.workStart)
  const end = minutesOfDay(settings.workEnd)
  const breakStart = minutesOfDay(settings.breakStart)
  const breakEnd = minutesOfDay(settings.breakEnd)

  if (!workday) return { kind: "off" as const, label: "Fora da escala", progress: 0, minutesLeft: 0, workday }
  if (current < start) return { kind: "before" as const, label: "Ainda não começou", progress: 0, minutesLeft: Math.ceil(start - current), workday }
  if (current >= end) return { kind: "ended" as const, label: "Expediente encerrado", progress: 100, minutesLeft: 0, workday }
  if (breakEnd > breakStart && current >= breakStart && current < breakEnd) {
    return { kind: "break" as const, label: "Em intervalo", progress: Math.min(100, Math.max(0, ((current - start) / Math.max(1, end - start)) * 100)), minutesLeft: Math.ceil(breakEnd - current), workday }
  }
  return {
    kind: "working" as const,
    label: "Em expediente",
    progress: Math.min(100, Math.max(0, ((current - start) / Math.max(1, end - start)) * 100)),
    minutesLeft: Math.ceil(end - current),
    workday,
  }
}

export function formatMinutesCompact(minutes: number) {
  const safe = Math.max(0, Math.round(minutes))
  const hours = Math.floor(safe / 60)
  const rest = safe % 60
  if (!hours) return `${rest} min`
  if (!rest) return `${hours}h`
  return `${hours}h ${rest}min`
}

export function buildIdeUri(settings: DeveloperSettings) {
  if (settings.ideKind === "custom") return settings.ideCustomUri.trim()
  const path = settings.ideWorkspacePath.trim().replace(/\\/g, "/")
  if (!path) return ""
  const encodedPath = path.split("/").map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join("/")
  if (settings.ideKind === "vscode") return `vscode://file/${encodedPath}`
  if (settings.ideKind === "cursor") return `cursor://file/${encodedPath}`
  // Visual Studio, Delphi e IDEs JetBrains não possuem um protocolo universal confiável no navegador.
  // Nesses casos, o usuário pode informar um protocolo/launcher próprio no campo personalizado.
  return settings.ideCustomUri.trim()
}

export function musicHome(provider: DeveloperMusicProvider) {
  return provider === "youtube-music" ? "https://music.youtube.com/" : "https://open.spotify.com/"
}

export function safeExternalUrl(value: string) {
  const candidate = value.trim()
  if (!candidate) return ""
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : ""
  } catch {
    return ""
  }
}


export function developerFocusStorageKey(userId: string) {
  return `${FOCUS_STORAGE_PREFIX}:${userId}`
}

export function startDeveloperFocusSession(userId: string, minutes: number) {
  if (typeof window === "undefined" || !userId) return
  const duration = Math.max(10, Math.min(180, Math.round(minutes))) * 60
  const state = { mode: "focus", remaining: duration, running: true, endAt: Date.now() + duration * 1000 }
  try { window.localStorage.setItem(developerFocusStorageKey(userId), JSON.stringify(state)) } catch { /* opcional */ }
  window.dispatchEvent(new CustomEvent(DEVELOPER_FOCUS_EVENT, { detail: state }))
}
