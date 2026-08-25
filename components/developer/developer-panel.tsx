"use client"

import * as React from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Check,
  Clock,
  Code2,
  Coffee,
  Droplets,
  FolderKanban,
  GitBranch,
  ExternalLink,
  ListTodo,
  Music,
  NotebookPen,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings,
  SlidersHorizontal,
  Timer,
  Trash2,
} from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { DeveloperEnvironment } from "@/components/developer/developer-environment"
import { DeveloperSessionHub } from "@/components/developer/developer-session-hub"
import { DeveloperContexts } from "@/components/developer/developer-contexts"
import { DeveloperWindowsAgent } from "@/components/developer/developer-windows-agent"
import { DEVELOPER_VCS_STATUS_EVENT } from "@/lib/developer/vcs"
import {
  DEFAULT_DEVELOPER_SETTINGS,
  DEVELOPER_SETTINGS_EVENT,
  DEVELOPER_WATER_EVENT,
  DEVELOPER_FOCUS_EVENT,
  FOCUS_STORAGE_PREFIX,
  developerSettingsRow,
  formatMinutesCompact,
  mapDeveloperSettings,
  musicHome,
  safeExternalUrl,
  shiftState,
  type DeveloperMusicProvider,
  type DeveloperNote,
  type DeveloperSettings,
} from "@/lib/developer/panel"

const DAY_OPTIONS = [
  { value: 1, label: "Seg", title: "Segunda-feira" },
  { value: 2, label: "Ter", title: "Terça-feira" },
  { value: 3, label: "Qua", title: "Quarta-feira" },
  { value: 4, label: "Qui", title: "Quinta-feira" },
  { value: 5, label: "Sex", title: "Sexta-feira" },
  { value: 6, label: "Sáb", title: "Sábado" },
  { value: 0, label: "Dom", title: "Domingo" },
] as const


const SW_PATH = "/devboard-sw.js"

type FocusMode = "focus" | "break"

type FocusStoredState = {
  mode: FocusMode
  remaining: number
  running: boolean
  endAt: number | null
}

type DevAlert = {
  id: string
  tone: "warning" | "info" | "success"
  title: string
  description: string
  href?: string
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

function localDayRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

function formatFocus(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
}

function formatNoteDate(value: string) {
  const date = new Date(value)
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

function sameLocalDay(value: string, now: Date) {
  const date = new Date(value)
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
}

function formatWorkedTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours > 0) return `${hours}h${minutes ? ` ${minutes}min` : ""}`
  if (minutes > 0) return `${minutes}min`
  return `${safe}s`
}

function subStatusLabel(status: string) {
  if (status === "in-progress") return "Executando"
  if (status === "paused") return "Pausada"
  if (status === "waiting") return "Aguardando"
  if (status === "backlog") return "Backlog"
  return "Pendente"
}

function priorityLabel(priority: string) {
  if (priority === "high") return "Alta"
  if (priority === "medium") return "Média"
  return "Baixa"
}

async function browserNotification(title: string, body: string, tag: string) {
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
    // Fallback abaixo.
  }
  try {
    new Notification(title, options)
  } catch {
    // O painel continua funcionando sem notificação do sistema.
  }
}

function Surface({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("rounded-2xl border border-border bg-card", className)}>{children}</section>
}

function CardHeader({ icon: Icon, title, subtitle, action }: { icon: React.ElementType; title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-4 sm:px-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="size-[1.1rem]" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold sm:text-base">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

function Metric({ label, value, detail, icon: Icon }: { label: string; value: string; detail: string; icon: React.ElementType }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-[1.05rem]" />
      </span>
      <div className="min-w-0">
        <p className="text-[0.65rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="mt-0.5 truncate text-lg font-semibold">{value}</p>
        <p className="truncate text-[0.68rem] text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{children}</label>
}

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/45 p-3 text-left transition-colors hover:bg-muted/45"
      aria-pressed={checked}
    >
      <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted-foreground/25")}>
        <span className={cn("absolute top-1 size-4 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-1")} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-[0.67rem] leading-relaxed text-muted-foreground">{description}</span>}
      </span>
    </button>
  )
}

export function DeveloperPanel() {
  const { currentUserId, currentUserRole, members, projects, workSessions, activeSubId, hydrated, startTimer, stopTimer, findSub } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const me = members.find((member) => member.id === currentUserId)

  const [settings, setSettings] = React.useState<DeveloperSettings>({ ...DEFAULT_DEVELOPER_SETTINGS })
  const [savedSettings, setSavedSettings] = React.useState<DeveloperSettings>({ ...DEFAULT_DEVELOPER_SETTINGS })
  const [notes, setNotes] = React.useState<DeveloperNote[]>([])
  const [noteDraft, setNoteDraft] = React.useState("")
  const [waterMl, setWaterMl] = React.useState(0)
  const [lastWaterAt, setLastWaterAt] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [vcsDirtyProjects, setVcsDirtyProjects] = React.useState<Array<{ id: string; name: string; provider: string; changedCount: number }>>([])
  const [backendMissing, setBackendMissing] = React.useState(false)
  const [now, setNow] = React.useState(() => new Date())
  const [notificationPermission, setNotificationPermission] = React.useState<NotificationPermission | "unsupported">("unsupported")
  const [personalizeOpen, setPersonalizeOpen] = React.useState(false)
  const [advancedToolsOpen, setAdvancedToolsOpen] = React.useState(false)
  const [pendingTaskId, setPendingTaskId] = React.useState<string | null>(null)

  const [focusMode, setFocusMode] = React.useState<FocusMode>("focus")
  const [focusRemaining, setFocusRemaining] = React.useState(DEFAULT_DEVELOPER_SETTINGS.focusMinutes * 60)
  const [focusRunning, setFocusRunning] = React.useState(false)
  const [focusEndAt, setFocusEndAt] = React.useState<number | null>(null)
  const focusInitializedRef = React.useRef(false)

  const settingsDirty = React.useMemo(() => JSON.stringify(settings) !== JSON.stringify(savedSettings), [savedSettings, settings])
  const shift = React.useMemo(() => shiftState(settings, now), [now, settings])
  const waterPercent = Math.min(100, Math.round((waterMl / Math.max(1, settings.hydrationGoalMl)) * 100))

  const loadSettings = React.useCallback(async () => {
    if (!currentUserId || currentUserRole !== "developer") return
    const legacySelect = "work_start,work_end,break_start,break_end,work_days,hydration_goal_ml,hydration_cup_ml,hydration_reminder_minutes,notify_shift_end,notify_hydration,music_provider,music_url,ide_kind,ide_workspace_path,ide_custom_uri,focus_minutes,break_minutes,auto_focus_on_timer,auto_open_ide_on_timer,auto_open_music_on_timer,notify_forgotten_timer,forgotten_timer_minutes,notify_wrapup,wrapup_minutes"
    let result = await supabase.from("developer_settings").select(`${legacySelect},idle_detection_enabled,idle_threshold_minutes`).eq("user_id", currentUserId).maybeSingle()
    if (result.error && /idle_detection_enabled|idle_threshold_minutes/i.test(result.error.message)) {
      result = await supabase.from("developer_settings").select(legacySelect).eq("user_id", currentUserId).maybeSingle()
    }
    if (result.error) throw result.error
    const mapped = mapDeveloperSettings(result.data)
    setSettings(mapped)
    setSavedSettings(mapped)
  }, [currentUserId, currentUserRole, supabase])

  const loadNotes = React.useCallback(async () => {
    if (!currentUserId || currentUserRole !== "developer") return
    const { data, error } = await supabase
      .from("developer_notes")
      .select("id,content,pinned,created_at,updated_at")
      .eq("user_id", currentUserId)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(40)
    if (error) throw error
    setNotes((data ?? []).map((row: any) => ({
      id: row.id,
      content: row.content,
      pinned: row.pinned === true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })))
  }, [currentUserId, currentUserRole, supabase])

  const loadWater = React.useCallback(async () => {
    if (!currentUserId || currentUserRole !== "developer") return
    const range = localDayRange()
    const { data, error } = await supabase
      .from("developer_water_logs")
      .select("amount_ml,logged_at")
      .eq("user_id", currentUserId)
      .gte("logged_at", range.start)
      .lt("logged_at", range.end)
      .order("logged_at", { ascending: false })
    if (error) throw error
    const rows = data ?? []
    setWaterMl(rows.reduce((sum: number, row: any) => sum + Number(row.amount_ml || 0), 0))
    setLastWaterAt(rows[0]?.logged_at ?? null)
  }, [currentUserId, currentUserRole, supabase])

  React.useEffect(() => {
    if (!hydrated || currentUserRole !== "developer" || !currentUserId) return
    let alive = true
    setLoading(true)
    setBackendMissing(false)
    Promise.all([loadSettings(), loadNotes(), loadWater()])
      .catch((error: any) => {
        if (!alive) return
        const text = String(error?.message ?? error ?? "")
        setBackendMissing(/developer_settings|developer_notes|developer_water_logs|schema cache|does not exist/i.test(text))
        setNotice(text || "Não foi possível carregar o painel do desenvolvedor.")
      })
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [currentUserId, currentUserRole, hydrated, loadNotes, loadSettings, loadWater])

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

  React.useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported")
      return
    }
    setNotificationPermission(Notification.permission)
  }, [])

  React.useEffect(() => {
    if (!currentUserId || currentUserRole !== "developer" || backendMissing) return
    const channel = supabase
      .channel(`devboard-developer-panel-${currentUserId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_settings", filter: `user_id=eq.${currentUserId}` }, () => void loadSettings())
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_notes", filter: `user_id=eq.${currentUserId}` }, () => void loadNotes())
      .on("postgres_changes", { event: "*", schema: "public", table: "developer_water_logs", filter: `user_id=eq.${currentUserId}` }, () => void loadWater())
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [backendMissing, currentUserId, currentUserRole, loadNotes, loadSettings, loadWater, supabase])

  React.useEffect(() => {
    if (!currentUserId || focusInitializedRef.current) return
    focusInitializedRef.current = true
    const key = `${FOCUS_STORAGE_PREFIX}:${currentUserId}`
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) {
        setFocusRemaining(settings.focusMinutes * 60)
        return
      }
      const parsed = JSON.parse(raw) as FocusStoredState
      const mode: FocusMode = parsed.mode === "break" ? "break" : "focus"
      let remaining = Math.max(0, Number(parsed.remaining || 0))
      let running = parsed.running === true
      let endAt = Number(parsed.endAt || 0) || null
      if (running && endAt) remaining = Math.max(0, Math.ceil((endAt - Date.now()) / 1000))
      if (remaining <= 0) {
        running = false
        endAt = null
        remaining = (mode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60
      }
      setFocusMode(mode)
      setFocusRemaining(remaining)
      setFocusRunning(running)
      setFocusEndAt(endAt)
    } catch {
      setFocusRemaining(settings.focusMinutes * 60)
    }
  }, [currentUserId, settings.breakMinutes, settings.focusMinutes])

  React.useEffect(() => {
    if (!currentUserId) return
    const onFocusControl = (event: Event) => {
      const detail = (event as CustomEvent<FocusStoredState>).detail
      if (!detail) return
      setFocusMode(detail.mode === "break" ? "break" : "focus")
      setFocusRemaining(Math.max(0, Number(detail.remaining || 0)))
      setFocusRunning(detail.running === true)
      setFocusEndAt(detail.endAt ? Number(detail.endAt) : null)
      focusInitializedRef.current = true
    }
    window.addEventListener(DEVELOPER_FOCUS_EVENT, onFocusControl)
    return () => window.removeEventListener(DEVELOPER_FOCUS_EVENT, onFocusControl)
  }, [currentUserId])

  React.useEffect(() => {
    if (!currentUserId || !focusInitializedRef.current) return
    const key = `${FOCUS_STORAGE_PREFIX}:${currentUserId}`
    const state: FocusStoredState = { mode: focusMode, remaining: focusRemaining, running: focusRunning, endAt: focusEndAt }
    try { window.localStorage.setItem(key, JSON.stringify(state)) } catch { /* opcional */ }
  }, [currentUserId, focusEndAt, focusMode, focusRemaining, focusRunning])

  React.useEffect(() => {
    if (!focusRunning || !focusEndAt) return
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((focusEndAt - Date.now()) / 1000))
      setFocusRemaining(remaining)
      if (remaining > 0) return
      window.clearInterval(timer)
      setFocusRunning(false)
      setFocusEndAt(null)
      const finishedMode = focusMode
      const nextMode: FocusMode = finishedMode === "focus" ? "break" : "focus"
      setFocusMode(nextMode)
      setFocusRemaining((nextMode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60)
      void browserNotification(
        finishedMode === "focus" ? "Bloco de foco concluído" : "Pausa concluída",
        finishedMode === "focus" ? "Boa. Levante um pouco, descanse os olhos e volte quando estiver pronto." : "Sua pausa terminou. Hora de voltar ao foco.",
        `devboard-focus-${finishedMode}`,
      )
    }, 250)
    return () => window.clearInterval(timer)
  }, [focusEndAt, focusMode, focusRunning, settings.breakMinutes, settings.focusMinutes])

  React.useEffect(() => {
    function onVcsStatus(event: Event) {
      const detail = (event as CustomEvent<{ dirtyProjects?: Array<{ id: string; name: string; provider: string; changedCount: number }> }>).detail
      setVcsDirtyProjects(Array.isArray(detail?.dirtyProjects) ? detail.dirtyProjects : [])
    }
    window.addEventListener(DEVELOPER_VCS_STATUS_EVENT, onVcsStatus)
    return () => window.removeEventListener(DEVELOPER_VCS_STATUS_EVENT, onVcsStatus)
  }, [])

  const assignedItems = React.useMemo(() => {
    return projects.flatMap((project) => project.activities.flatMap((activity) => activity.subactivities
      .filter((sub) => sub.assigneeId === currentUserId)
      .map((sub) => ({ project, activity, sub }))))
  }, [currentUserId, projects])

  const activeFound = React.useMemo(() => activeSubId ? findSub(activeSubId) : null, [activeSubId, findSub, projects])

  const todaySummary = React.useMemo(() => {
    const today = workSessions.filter((session) => session.userId === currentUserId && sameLocalDay(session.startedAt, now))
    let seconds = 0
    const subIds = new Set<string>()
    const projectIds = new Set<string>()
    for (const session of today) {
      seconds += session.endedAt
        ? session.durationSeconds
        : Math.max(0, Math.floor((now.getTime() - new Date(session.startedAt).getTime()) / 1000))
      subIds.add(session.subactivityId)
      const found = findSub(session.subactivityId)
      if (found) projectIds.add(found.project.id)
    }
    return { seconds, sessions: today.length, subactivities: subIds.size, projects: projectIds.size }
  }, [currentUserId, findSub, now, projects, workSessions])

  const nextTasks = React.useMemo(() => {
    const statusRank: Record<string, number> = { paused: 0, "in-progress": 1, waiting: 2, backlog: 3 }
    const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
    return assignedItems
      .filter((item) => item.sub.id !== activeSubId && !["done", "cancelled", "waiting-aqs"].includes(item.sub.status))
      .sort((a, b) => {
        const attentionDiff = Number(Boolean(b.sub.needsAttention)) - Number(Boolean(a.sub.needsAttention))
        if (attentionDiff) return attentionDiff
        const statusDiff = (statusRank[a.sub.status] ?? 9) - (statusRank[b.sub.status] ?? 9)
        if (statusDiff) return statusDiff
        const priorityDiff = (priorityRank[a.project.priority] ?? 9) - (priorityRank[b.project.priority] ?? 9)
        if (priorityDiff) return priorityDiff
        const aDue = a.project.dueDate ? new Date(`${a.project.dueDate}T12:00:00`).getTime() : Number.MAX_SAFE_INTEGER
        const bDue = b.project.dueDate ? new Date(`${b.project.dueDate}T12:00:00`).getTime() : Number.MAX_SAFE_INTEGER
        return aDue - bDue
      })
      .slice(0, 5)
  }, [activeSubId, assignedItems])

  async function startQueuedTask(subId: string) {
    if (pendingTaskId || activeSubId) return
    setPendingTaskId(subId)
    const ok = await startTimer(subId)
    setPendingTaskId(null)
    if (!ok) setNotice("Não foi possível iniciar esta subatividade.")
  }

  function showEnvironment() {
    setAdvancedToolsOpen(true)
    window.setTimeout(() => document.getElementById("dev-environment")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80)
  }

  const alerts = React.useMemo<DevAlert[]>(() => {
    const result: DevAlert[] = []
    const attention = assignedItems.filter((item) => item.sub.needsAttention)
    const running = assignedItems.filter((item) => item.sub.status === "in-progress")
    const paused = assignedItems.filter((item) => item.sub.status === "paused")
    if (attention.length) {
      const first = attention[0]
      result.push({
        id: "attention",
        tone: "warning",
        title: `${attention.length} ${attention.length === 1 ? "subatividade precisa" : "subatividades precisam"} de atenção`,
        description: first.sub.attentionMessage || first.sub.title,
        href: `/projetos/${first.project.id}`,
      })
    }
    if (running.length) {
      const first = running[0]
      result.push({
        id: "running",
        tone: "success",
        title: "Você tem uma subatividade em execução",
        description: `${first.project.name} · ${first.sub.title}`,
        href: `/projetos/${first.project.id}`,
      })
    }
    if (paused.length) {
      result.push({
        id: "paused",
        tone: "info",
        title: `${paused.length} ${paused.length === 1 ? "subatividade pausada" : "subatividades pausadas"}`,
        description: "Revise o que ficou parado antes de encerrar o expediente.",
        href: `/projetos/${paused[0].project.id}`,
      })
    }
    if (vcsDirtyProjects.length) {
      const total = vcsDirtyProjects.reduce((sum, item) => sum + Math.max(0, item.changedCount), 0)
      const first = vcsDirtyProjects[0]
      result.push({
        id: "vcs-dirty",
        tone: "warning",
        title: `${total} alteraç${total === 1 ? "ão" : "ões"} local${total === 1 ? "" : "is"} sem commit`,
        description: `${first.name}${vcsDirtyProjects.length > 1 ? ` e mais ${vcsDirtyProjects.length - 1} projeto${vcsDirtyProjects.length === 2 ? "" : "s"}` : ""}. Revise em Projetos & IDEs antes de encerrar o dia.`,
      })
    }
    const dueProjects = Array.from(new Map(assignedItems
      .filter((item) => !["done", "cancelled"].includes(item.sub.status))
      .map((item) => [item.project.id, item.project])).values())
      .map((project) => {
        const due = new Date(`${project.dueDate}T12:00:00`)
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12)
        return { project, days: Math.ceil((due.getTime() - today.getTime()) / 86_400_000) }
      })
      .filter((item) => item.days <= 2)
      .sort((a, b) => a.days - b.days)
    if (dueProjects.length) {
      const first = dueProjects[0]
      const when = first.days < 0 ? `${Math.abs(first.days)}d atrasado` : first.days === 0 ? "vence hoje" : first.days === 1 ? "vence amanhã" : "vence em 2 dias"
      result.push({ id: "deadline", tone: first.days <= 0 ? "warning" : "info", title: `Prazo: ${first.project.name}`, description: when, href: `/projetos/${first.project.id}` })
    }
    if (shift.kind === "working" && shift.minutesLeft <= 30) {
      result.push({ id: "shift-end", tone: "info", title: "Fim do expediente se aproximando", description: `Faltam ${formatMinutesCompact(shift.minutesLeft)} para ${settings.workEnd}.` })
    }
    if (waterPercent < 50 && shift.kind === "working") {
      result.push({ id: "water", tone: "info", title: "Hidratação abaixo da metade da meta", description: `Você registrou ${waterMl} ml de ${settings.hydrationGoalMl} ml hoje.` })
    }
    return result.slice(0, 5)
  }, [assignedItems, now, settings.hydrationGoalMl, settings.workEnd, shift.kind, shift.minutesLeft, vcsDirtyProjects, waterMl, waterPercent])

  async function saveSettings() {
    if (!currentUserId || saving) return
    const normalized: DeveloperSettings = {
      ...settings,
      hydrationGoalMl: clampNumber(settings.hydrationGoalMl, 500, 10000),
      hydrationCupMl: clampNumber(settings.hydrationCupMl, 50, 2000),
      hydrationReminderMinutes: clampNumber(settings.hydrationReminderMinutes, 15, 240),
      focusMinutes: clampNumber(settings.focusMinutes, 10, 180),
      breakMinutes: clampNumber(settings.breakMinutes, 5, 60),
      forgottenTimerMinutes: clampNumber(settings.forgottenTimerMinutes, 30, 480),
      wrapupMinutes: clampNumber(settings.wrapupMinutes, 5, 120),
      idleThresholdMinutes: clampNumber(settings.idleThresholdMinutes, 3, 120),
      workDays: settings.workDays.length ? Array.from(new Set(settings.workDays)).sort() : [1, 2, 3, 4, 5],
    }
    setSaving(true)
    setNotice(null)
    const row = developerSettingsRow(currentUserId, normalized)
    let { error } = await supabase.from("developer_settings").upsert(row, { onConflict: "user_id" })
    if (error && /idle_detection_enabled|idle_threshold_minutes/i.test(error.message)) {
      const legacyRow = { ...row } as Record<string, unknown>
      delete legacyRow.idle_detection_enabled
      delete legacyRow.idle_threshold_minutes
      const fallback = await supabase.from("developer_settings").upsert(legacyRow, { onConflict: "user_id" })
      error = fallback.error
    }
    setSaving(false)
    if (error) {
      setNotice(error.message)
      return
    }
    setSettings(normalized)
    setSavedSettings(normalized)
    if (!focusRunning) setFocusRemaining((focusMode === "focus" ? normalized.focusMinutes : normalized.breakMinutes) * 60)
    setNotice("Configurações salvas.")
    window.dispatchEvent(new CustomEvent(DEVELOPER_SETTINGS_EVENT, { detail: normalized }))
    window.setTimeout(() => setNotice((current) => current === "Configurações salvas." ? null : current), 2200)
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported")
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    if (permission === "granted") {
      try { if ("serviceWorker" in navigator) await navigator.serviceWorker.register(SW_PATH) } catch { /* fallback Notification ainda funciona */ }
      void browserNotification("Notificações ativadas", "O Devboard poderá avisar sobre fim do expediente, hidratação e blocos de foco.", "devboard-developer-enabled")
    }
  }

  async function addWater(amount = settings.hydrationCupMl) {
    if (!currentUserId) return
    const safeAmount = clampNumber(amount, 50, 2000)
    const optimistic = waterMl + safeAmount
    setWaterMl(optimistic)
    setLastWaterAt(new Date().toISOString())
    const { error } = await supabase.from("developer_water_logs").insert({ user_id: currentUserId, amount_ml: safeAmount })
    if (error) {
      setWaterMl(waterMl)
      setNotice(error.message)
      return
    }
    window.dispatchEvent(new CustomEvent(DEVELOPER_WATER_EVENT, { detail: { loggedAt: Date.now() } }))
  }

  async function resetWater() {
    if (!currentUserId) return
    const previous = waterMl
    setWaterMl(0)
    setLastWaterAt(null)
    const range = localDayRange()
    const { error } = await supabase.from("developer_water_logs").delete().eq("user_id", currentUserId).gte("logged_at", range.start).lt("logged_at", range.end)
    if (error) {
      setWaterMl(previous)
      setNotice(error.message)
    }
  }

  async function addNote() {
    const content = noteDraft.trim()
    if (!currentUserId || !content) return
    setNoteDraft("")
    const { error } = await supabase.from("developer_notes").insert({ user_id: currentUserId, content })
    if (error) {
      setNoteDraft(content)
      setNotice(error.message)
      return
    }
    await loadNotes()
  }

  async function togglePin(note: DeveloperNote) {
    setNotes((current) => current.map((item) => item.id === note.id ? { ...item, pinned: !item.pinned } : item))
    const { error } = await supabase.from("developer_notes").update({ pinned: !note.pinned }).eq("id", note.id).eq("user_id", currentUserId)
    if (error) {
      setNotes((current) => current.map((item) => item.id === note.id ? note : item))
      setNotice(error.message)
    }
  }

  async function deleteNote(note: DeveloperNote) {
    setNotes((current) => current.filter((item) => item.id !== note.id))
    const { error } = await supabase.from("developer_notes").delete().eq("id", note.id).eq("user_id", currentUserId)
    if (error) {
      setNotes((current) => [note, ...current])
      setNotice(error.message)
    }
  }

  function toggleWorkDay(day: number) {
    setSettings((current) => ({
      ...current,
      workDays: current.workDays.includes(day) ? current.workDays.filter((item) => item !== day) : [...current.workDays, day],
    }))
  }

  function startFocus() {
    if (focusRunning) return
    const remaining = focusRemaining > 0 ? focusRemaining : (focusMode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60
    setFocusRemaining(remaining)
    setFocusEndAt(Date.now() + remaining * 1000)
    setFocusRunning(true)
  }

  function pauseFocus() {
    if (!focusRunning) return
    const remaining = focusEndAt ? Math.max(0, Math.ceil((focusEndAt - Date.now()) / 1000)) : focusRemaining
    setFocusRemaining(remaining)
    setFocusRunning(false)
    setFocusEndAt(null)
  }

  function resetFocus() {
    setFocusRunning(false)
    setFocusEndAt(null)
    setFocusRemaining((focusMode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60)
  }

  function switchFocusMode(mode: FocusMode) {
    setFocusMode(mode)
    setFocusRunning(false)
    setFocusEndAt(null)
    setFocusRemaining((mode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60)
  }

  function openMusic() {
    const target = safeExternalUrl(settings.musicUrl) || musicHome(settings.musicProvider)
    window.open(target, "_blank", "noopener,noreferrer")
  }



  if (hydrated && currentUserRole !== "developer") return null

  if (backendMissing) {
    return (
      <Surface className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive"><AlertTriangle className="size-4" /></span>
          <div className="min-w-0">
            <h2 className="font-semibold">Banco do Painel Dev ainda não foi aplicado</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Execute as migrations <code className="rounded bg-muted px-1.5 py-0.5 text-xs">015</code>, <code className="rounded bg-muted px-1.5 py-0.5 text-xs">016</code> e <code className="rounded bg-muted px-1.5 py-0.5 text-xs">017_devboard_developer_cockpit_automation.sql</code>, depois rode <code className="rounded bg-muted px-1.5 py-0.5 text-xs">supabase/verify_backend.sql</code>.</p>
          </div>
        </div>
      </Surface>
    )
  }

  const lastDrinkLabel = lastWaterAt ? `Último registro às ${formatClock(new Date(lastWaterAt))}` : "Nenhum registro hoje"
  const shiftDetail = shift.kind === "working"
    ? `${formatMinutesCompact(shift.minutesLeft)} restantes`
    : shift.kind === "break"
      ? `Retorno em ${formatMinutesCompact(shift.minutesLeft)}`
      : `${settings.workStart} — ${settings.workEnd}`
  const dirtyChangeCount = vcsDirtyProjects.reduce((sum, item) => sum + Math.max(0, item.changedCount), 0)
  const activeProject = activeFound?.project ?? null

  return (
    <>
      <div className="flex min-w-0 flex-col gap-4 pb-24 sm:gap-5 lg:pb-4">
        <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Painel Dev</h1>
              <span className={cn(
                "rounded-full px-2.5 py-1 text-[0.64rem] font-semibold",
                shift.kind === "working" ? "bg-success/12 text-success" : shift.kind === "break" ? "bg-warning/12 text-warning" : "bg-muted text-muted-foreground",
              )}>{shift.label}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Meu dia · {now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })} · {formatClock(now)}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {notice && <span className="max-w-[320px] truncate text-xs text-muted-foreground" title={notice}>{notice}</span>}
            {settingsDirty && (
              <button type="button" onClick={() => void saveSettings()} disabled={saving || loading} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-45">
                {saving ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="size-3.5" />}
                Salvar
              </button>
            )}
            <button
              type="button"
              onClick={() => setPersonalizeOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-xs font-semibold hover:bg-muted"
            >
              <SlidersHorizontal className="size-3.5" />
              Personalizar painel
              {settingsDirty && <span className="size-1.5 rounded-full bg-primary" aria-label="Alterações não salvas" />}
            </button>
          </div>
        </header>

        <DeveloperSessionHub onOpenEnvironment={showEnvironment} />

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
          <Surface className="min-w-0 lg:col-span-6">
            <CardHeader
              icon={ListTodo}
              title="Próximas tarefas"
              subtitle="Sua fila prioriza atenção, tarefas pausadas, prioridade do projeto e prazo."
              action={<Link href="/projetos" className="text-[0.68rem] font-semibold text-primary hover:underline">Ver todas</Link>}
            />
            <div className="p-3 sm:p-4">
              {nextTasks.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                  <Check className="mx-auto size-5 text-success" />
                  <p className="mt-2 text-xs font-semibold">Nenhuma tarefa pendente na fila</p>
                  <p className="mt-1 text-[0.67rem] text-muted-foreground">Suas próximas subatividades aparecerão aqui.</p>
                </div>
              ) : (
                <div className="divide-y divide-border/70">
                  {nextTasks.map((item, index) => {
                    const priority = priorityLabel(item.project.priority)
                    return (
                      <div key={item.sub.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted text-[0.62rem] font-semibold text-muted-foreground">{index + 1}</span>
                          <div className="min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-1 text-[0.62rem] text-muted-foreground">
                              <span className="max-w-[180px] truncate">{item.project.name}</span>
                              <ArrowRight className="size-2.5 shrink-0" />
                              <span className="max-w-[180px] truncate">{item.activity.title}</span>
                            </div>
                            <Link href={`/projetos/${item.project.id}#sub-${item.sub.id}`} className="mt-1 block truncate text-xs font-semibold hover:text-primary">{item.sub.title}</Link>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className={cn(
                                "rounded-md px-1.5 py-0.5 text-[0.58rem] font-semibold",
                                item.project.priority === "high" ? "bg-destructive/10 text-destructive" : item.project.priority === "medium" ? "bg-warning/10 text-warning" : "bg-success/10 text-success",
                              )}>{priority}</span>
                              <span className="text-[0.6rem] text-muted-foreground">{subStatusLabel(item.sub.status)}</span>
                              {item.sub.needsAttention && <span className="text-[0.6rem] font-semibold text-warning">Precisa de atenção</span>}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={Boolean(activeSubId) || Boolean(pendingTaskId)}
                          onClick={() => void startQueuedTask(item.sub.id)}
                          title={activeSubId ? "Pause a sessão atual antes de iniciar outra tarefa." : "Iniciar subatividade"}
                          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[0.65rem] font-semibold hover:bg-muted disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {pendingTaskId === item.sub.id ? <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Play className="size-3" />}
                          <span className="hidden sm:inline">Iniciar</span>
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </Surface>

          <Surface className="min-w-0 lg:col-span-3">
            <CardHeader icon={Clock} title="Hoje" subtitle="Resumo rápido do seu trabalho." />
            <div className="grid grid-cols-2 gap-2 p-3 sm:p-4">
              {[
                { label: "Horas", value: formatWorkedTime(todaySummary.seconds), icon: Clock },
                { label: "Sessões", value: String(todaySummary.sessions), icon: Timer },
                { label: "Subatividades", value: String(todaySummary.subactivities), icon: ListTodo },
                { label: "Projetos", value: String(todaySummary.projects), icon: FolderKanban },
              ].map((metric) => (
                <div key={metric.label} className="min-w-0 rounded-xl border border-border bg-background/45 p-3">
                  <metric.icon className="size-3.5 text-primary" />
                  <p className="mt-3 truncate text-base font-semibold">{metric.value}</p>
                  <p className="mt-0.5 truncate text-[0.62rem] text-muted-foreground">{metric.label}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-3">
              <Link href="/horas" className="inline-flex items-center gap-1 text-[0.66rem] font-semibold text-primary hover:underline">Ver detalhamento do dia <ArrowRight className="size-3" /></Link>
            </div>
          </Surface>

          <Surface className="min-w-0 lg:col-span-3">
            <CardHeader icon={AlertTriangle} title="Atenção" subtitle="O que vale revisar agora." />
            <div className="grid gap-2 p-3 sm:p-4">
              {alerts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-3 py-7 text-center">
                  <Check className="mx-auto size-5 text-success" />
                  <p className="mt-2 text-xs font-semibold">Tudo tranquilo</p>
                  <p className="mt-1 text-[0.64rem] text-muted-foreground">Nenhum alerta importante.</p>
                </div>
              ) : alerts.slice(0, 4).map((alert) => {
                const content = (
                  <div className="group flex min-w-0 items-start gap-2.5 rounded-xl border border-border bg-background/35 p-2.5 transition-colors hover:bg-muted/45">
                    <span className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                      alert.tone === "warning" ? "bg-warning/10 text-warning" : alert.tone === "success" ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
                    )}><AlertTriangle className="size-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-1 text-[0.7rem] font-semibold">{alert.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-[0.62rem] leading-relaxed text-muted-foreground">{alert.description}</p>
                    </div>
                    {alert.href && <ArrowRight className="mt-1 size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />}
                  </div>
                )
                return alert.href ? <Link key={alert.id} href={alert.href}>{content}</Link> : <div key={alert.id}>{content}</div>
              })}
            </div>
          </Surface>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Surface className="min-w-0">
            <CardHeader icon={Code2} title="Ambiente" subtitle="Seu projeto local, repositório e integrações de desenvolvimento." action={<button type="button" onClick={showEnvironment} className="text-[0.68rem] font-semibold text-primary hover:underline">Ver completo</button>} />
            <div className="p-4">
              <div className="space-y-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><FolderKanban className="size-4" /></span>
                  <div className="min-w-0"><p className="text-[0.62rem] text-muted-foreground">Projeto atual</p><p className="truncate text-xs font-semibold">{activeProject?.name ?? "Nenhuma sessão ativa"}</p></div>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"><GitBranch className="size-4" /></span>
                  <div className="min-w-0"><p className="text-[0.62rem] text-muted-foreground">Controle de versão</p><p className="truncate text-xs font-semibold">{dirtyChangeCount > 0 ? `${dirtyChangeCount} alteração${dirtyChangeCount === 1 ? "" : "ões"} sem commit` : activeProject?.repository ? "Repositório configurado" : "Abra o ambiente para configurar"}</p></div>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-success/10 text-success"><span className="size-2 rounded-full bg-success" /></span>
                  <div className="min-w-0"><p className="text-[0.62rem] text-muted-foreground">Integrações locais</p><p className="truncate text-xs font-semibold">IDE, Agent Windows e contextos</p></div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={showEnvironment} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground"><Code2 className="size-3.5" />Ambiente</button>
                <button type="button" onClick={showEnvironment} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-semibold hover:bg-muted"><GitBranch className="size-3.5" />Git / SVN</button>
              </div>
            </div>
          </Surface>

          <Surface className="min-w-0 self-start">
            <CardHeader icon={Droplets} title="Hidratação" subtitle="Meta diária e lembrete leve durante o expediente." action={<button type="button" onClick={() => void resetWater()} className="text-[0.68rem] font-medium text-muted-foreground hover:text-foreground">Zerar hoje</button>} />
            <div className="p-4">
              <div className="flex items-center gap-3">
                <div className="relative flex size-20 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(var(--primary) ${waterPercent}%, color-mix(in oklab, var(--muted) 88%, transparent) ${waterPercent}% 100%)` }}>
                  <div className="flex size-16 flex-col items-center justify-center rounded-full bg-card">
                    <span className="text-lg font-semibold">{waterPercent}%</span>
                    <span className="text-[0.62rem] text-muted-foreground">da meta</span>
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xl font-semibold tracking-tight">{waterMl.toLocaleString("pt-BR")} <span className="text-sm font-normal text-muted-foreground">/ {settings.hydrationGoalMl} ml</span></p>
                  <p className="mt-1 text-xs text-muted-foreground">{lastDrinkLabel}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[200, 300, 500].map((amount) => <button key={amount} type="button" onClick={() => void addWater(amount)} className="h-8 rounded-lg border border-border bg-background px-2.5 text-[0.68rem] font-semibold hover:bg-muted">+ {amount} ml</button>)}
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div><FieldLabel>Meta diária (ml)</FieldLabel><input type="number" min={500} max={10000} step={100} value={settings.hydrationGoalMl} onChange={(event) => setSettings((current) => ({ ...current, hydrationGoalMl: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
                <div><FieldLabel>Copo padrão (ml)</FieldLabel><input type="number" min={50} max={2000} step={50} value={settings.hydrationCupMl} onChange={(event) => setSettings((current) => ({ ...current, hydrationCupMl: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
                <div className="col-span-2 sm:col-span-1"><FieldLabel>Lembrete (min)</FieldLabel><input type="number" min={15} max={240} step={5} value={settings.hydrationReminderMinutes} onChange={(event) => setSettings((current) => ({ ...current, hydrationReminderMinutes: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
              </div>
              <div className="mt-3"><Toggle checked={settings.notifyHydration} onChange={(value) => setSettings((current) => ({ ...current, notifyHydration: value }))} label="Lembrete de água" description={`Durante o expediente, lembrar a cada ${settings.hydrationReminderMinutes || 60} minutos.`} /></div>
              <button type="button" onClick={() => void addWater(settings.hydrationCupMl)} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground"><Droplets className="size-3.5" />Registrar {settings.hydrationCupMl} ml</button>
            </div>
          </Surface>

          <Surface className="min-w-0 self-start lg:col-span-2 xl:col-span-1">
            <CardHeader icon={Timer} title="Modo foco" subtitle="Pomodoro configurável que continua contando mesmo navegando por outras telas." />
            <div className="p-4">
              <div className="flex rounded-xl bg-muted p-1">
                <button type="button" onClick={() => switchFocusMode("focus")} className={cn("h-8 flex-1 rounded-lg text-xs font-medium transition-colors", focusMode === "focus" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>Foco</button>
                <button type="button" onClick={() => switchFocusMode("break")} className={cn("h-8 flex-1 rounded-lg text-xs font-medium transition-colors", focusMode === "break" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>Pausa</button>
              </div>
              <div className="py-4 text-center">
                <p className="font-mono text-4xl font-semibold tracking-[-0.08em] tabular-nums sm:text-5xl">{formatFocus(focusRemaining)}</p>
                <p className="mt-2 text-xs text-muted-foreground">{focusRunning ? "Cronômetro em andamento" : focusMode === "focus" ? "Pronto para um bloco sem distrações" : "Hora de descansar um pouco"}</p>
              </div>
              <div className="flex justify-center gap-2">
                <button type="button" onClick={focusRunning ? pauseFocus : startFocus} className="inline-flex h-10 min-w-28 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground">{focusRunning ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}{focusRunning ? "Pausar" : "Iniciar"}</button>
                <button type="button" onClick={resetFocus} className="inline-flex size-10 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Reiniciar foco"><RotateCcw className="size-3.5" /></button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div><FieldLabel>Foco (min)</FieldLabel><input type="number" min={10} max={180} value={settings.focusMinutes} onChange={(event) => setSettings((current) => ({ ...current, focusMinutes: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
                <div><FieldLabel>Pausa (min)</FieldLabel><input type="number" min={5} max={60} value={settings.breakMinutes} onChange={(event) => setSettings((current) => ({ ...current, breakMinutes: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
              </div>
            </div>
          </Surface>
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.55fr)]">
          <Surface className="min-w-0">
            <CardHeader icon={NotebookPen} title="Notas rápidas" subtitle="Rascunhos pessoais para não perder ideias durante o trabalho." action={<span className="rounded-full bg-muted px-2 py-1 text-[0.65rem] text-muted-foreground">{notes.length} notas</span>} />
            <div className="p-4">
              <div className="min-w-0">
                <FieldLabel>Nova anotação</FieldLabel>
                <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void addNote() } }} placeholder="Anote algo antes que saia da cabeça..." rows={2} maxLength={6000} className="min-h-20 w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:border-primary" />
                <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="min-w-0 text-[0.64rem] text-muted-foreground">Ctrl/Cmd + Enter salva rapidamente.</p>
                  <button type="button" onClick={() => void addNote()} disabled={!noteDraft.trim()} className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-45 sm:w-auto"><Plus className="size-3.5" />Salvar nota</button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {notes.length === 0 && <div className="sm:col-span-2 xl:col-span-3 rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">Nenhuma anotação ainda.</div>}
                {notes.slice(0, 6).map((note) => (
                  <article key={note.id} className="group min-w-0 rounded-xl border border-border bg-background/50 p-3.5">
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{note.content}</p>
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button type="button" onClick={() => void togglePin(note)} className={cn("flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground", note.pinned && "text-primary")} title={note.pinned ? "Desafixar" : "Fixar"}>{note.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</button>
                        <button type="button" onClick={() => void deleteNote(note)} className="flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Excluir nota"><Trash2 className="size-3.5" /></button>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[0.62rem] text-muted-foreground">{note.pinned && <span className="font-semibold text-primary">Fixada</span>}<span>{formatNoteDate(note.updatedAt)}</span></div>
                  </article>
                ))}
              </div>
            </div>
          </Surface>

          <Surface className="min-w-0">
            <CardHeader icon={Coffee} title="Fechamento do dia" subtitle="Finalize de forma organizada antes de encerrar." />
            <div className="p-4">
              <div className="grid gap-2 text-xs">
                {[
                  "Pausar ou finalizar cronômetros ativos",
                  "Revisar subatividades com atenção",
                  "Salvar/commit das alterações locais",
                  "Registrar o que precisa continuar amanhã",
                ].map((item) => <div key={item} className="flex items-start gap-2 rounded-lg py-1.5"><span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-success/30 bg-success/5 text-[0.55rem] text-success">✓</span><span className="leading-relaxed text-muted-foreground">{item}</span></div>)}
              </div>
              <div className="mt-4 rounded-xl border border-border bg-background/45 p-3">
                <p className="text-[0.62rem] text-muted-foreground">Expediente</p>
                <p className="mt-1 text-sm font-semibold">{shift.label}</p>
                <p className="mt-0.5 text-[0.65rem] text-muted-foreground">{shiftDetail}</p>
              </div>
              <button type="button" onClick={() => setPersonalizeOpen(true)} className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-xs font-semibold hover:bg-muted"><Settings className="size-3.5" />Revisar rotina</button>
            </div>
          </Surface>
        </div>

        <section id="dev-environment" className={cn("scroll-mt-24 rounded-2xl border border-border bg-muted/20 p-3 sm:p-4", !advancedToolsOpen && "hidden")}>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[0.64rem] font-semibold tracking-[0.14em] text-primary uppercase">Ambiente completo</p>
              <h2 className="mt-1 text-sm font-semibold sm:text-base">IDE, Agent Windows, contextos e controle de versão</h2>
            </div>
            <button type="button" onClick={() => setAdvancedToolsOpen(false)} className="h-9 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted">Ocultar ferramentas</button>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="min-w-0 xl:col-span-2"><DeveloperEnvironment currentUserId={currentUserId} onNotice={setNotice} /></div>
            <DeveloperWindowsAgent currentUserId={currentUserId} onNotice={setNotice} />
            <DeveloperContexts currentUserId={currentUserId} onNotice={setNotice} />
          </div>
        </section>

        {loading && <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 mx-auto w-fit rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-lg">Carregando seu Painel Dev...</div>}
      </div>

      {activeFound && (
        <div className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-border bg-card/95 p-2.5 shadow-2xl backdrop-blur lg:hidden">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Timer className="size-4" /></span>
          <Link href={`/projetos/${activeFound.project.id}#sub-${activeFound.sub.id}`} className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{activeFound.sub.title}</p>
            <p className="mt-0.5 truncate text-[0.62rem] text-muted-foreground">{formatWorkedTime(activeFound.sub.trackedSeconds)} · Trabalhando agora</p>
          </Link>
          <button type="button" onClick={() => void stopTimer(activeFound.sub.id)} className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-label="Pausar cronômetro"><Pause className="size-4" /></button>
        </div>
      )}

      <Dialog open={personalizeOpen} onOpenChange={setPersonalizeOpen}>
        <DialogContent className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-h-[92dvh] sm:max-w-4xl">
          <DialogHeader className="min-w-0 border-b border-border px-5 py-5 pr-12 sm:px-6 sm:pr-12">
            <DialogTitle>Personalizar Painel Dev</DialogTitle>
            <DialogDescription>Configure sua rotina, automações, música e notificações. Hidratação e Modo foco continuam disponíveis diretamente no painel.</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-4 py-4 [scrollbar-gutter:stable] sm:px-6 sm:py-5">
            <div className="space-y-5">
              <section className="rounded-2xl border border-border bg-card">
                <CardHeader icon={Clock} title="Expediente" subtitle="Defina seu horário e dias de trabalho." action={<span className="font-mono text-xs text-muted-foreground">{settings.workStart}–{settings.workEnd}</span>} />
                <div className="p-4">
                  <div className="mb-4">
                    <div className="mb-2 flex items-center justify-between gap-3 text-xs"><span className="font-medium">{shift.label}</span><span className="text-muted-foreground">{shift.kind === "working" ? `${Math.round(shift.progress)}% do dia` : shiftDetail}</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${shift.progress}%` }} /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div><FieldLabel>Entrada</FieldLabel><input type="time" value={settings.workStart} onChange={(event) => setSettings((current) => ({ ...current, workStart: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
                    <div><FieldLabel>Saída</FieldLabel><input type="time" value={settings.workEnd} onChange={(event) => setSettings((current) => ({ ...current, workEnd: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
                    <div><FieldLabel>Início intervalo</FieldLabel><input type="time" value={settings.breakStart} onChange={(event) => setSettings((current) => ({ ...current, breakStart: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
                    <div><FieldLabel>Fim intervalo</FieldLabel><input type="time" value={settings.breakEnd} onChange={(event) => setSettings((current) => ({ ...current, breakEnd: event.target.value }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary" /></div>
                  </div>
                  <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <div><FieldLabel>Dias de trabalho</FieldLabel><div className="flex flex-wrap gap-1.5">{DAY_OPTIONS.map((day) => { const selected = settings.workDays.includes(day.value); return <button key={day.value} type="button" title={day.title} aria-pressed={selected} onClick={() => toggleWorkDay(day.value)} className={cn("flex h-9 min-w-10 items-center justify-center rounded-xl border px-2 text-[0.68rem] font-semibold transition-colors", selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted")}>{day.label}</button> })}</div></div>
                    <div className="min-w-0 flex-1 lg:max-w-md"><Toggle checked={settings.notifyShiftEnd} onChange={(value) => setSettings((current) => ({ ...current, notifyShiftEnd: value }))} label="Avisar quando o expediente terminar" description="Envia uma notificação no horário configurado." /></div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-card">
                <CardHeader icon={Settings} title="Automações" subtitle="Ações pessoais executadas durante sua rotina de desenvolvimento." />
                <div className="space-y-2 p-4">
                  <Toggle checked={settings.autoFocusOnTimer} onChange={(value) => setSettings((current) => ({ ...current, autoFocusOnTimer: value }))} label="Foco ao iniciar timer" description="Inicia seu bloco de foco automaticamente." />
                  <Toggle checked={settings.autoOpenIdeOnTimer} onChange={(value) => setSettings((current) => ({ ...current, autoOpenIdeOnTimer: value }))} label="Abrir IDE do contexto" description="Se houver contexto para o projeto, abre a IDE configurada." />
                  <Toggle checked={settings.autoOpenMusicOnTimer} onChange={(value) => setSettings((current) => ({ ...current, autoOpenMusicOnTimer: value }))} label="Abrir música do contexto" description="Usa a playlist definida naquele contexto." />
                  <Toggle checked={settings.idleDetectionEnabled} onChange={(value) => setSettings((current) => ({ ...current, idleDetectionEnabled: value }))} label="Detectar ausência pelo Windows" description="Com o Agent ativo, pergunta o que fazer com períodos longos sem teclado ou mouse." />
                  <Toggle checked={settings.notifyForgottenTimer} onChange={(value) => setSettings((current) => ({ ...current, notifyForgottenTimer: value }))} label="Detectar timer esquecido" description="Pergunta antes de deixar um cronômetro rodando por horas." />
                  <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-3">
                    <div><FieldLabel>Ausência após</FieldLabel><div className="relative"><input type="number" min={3} max={120} step={1} value={settings.idleThresholdMinutes} onChange={(event) => setSettings((current) => ({ ...current, idleThresholdMinutes: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 pr-10 text-sm outline-none focus:border-primary" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.62rem] text-muted-foreground">min</span></div></div>
                    <div><FieldLabel>Alertar timer após</FieldLabel><div className="relative"><input type="number" min={30} max={480} step={15} value={settings.forgottenTimerMinutes} onChange={(event) => setSettings((current) => ({ ...current, forgottenTimerMinutes: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 pr-10 text-sm outline-none focus:border-primary" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.62rem] text-muted-foreground">min</span></div></div>
                    <div><FieldLabel>Preparar saída antes</FieldLabel><div className="relative"><input type="number" min={5} max={120} step={5} value={settings.wrapupMinutes} onChange={(event) => setSettings((current) => ({ ...current, wrapupMinutes: Number(event.target.value) }))} className="h-10 w-full rounded-xl border border-border bg-background px-3 pr-10 text-sm outline-none focus:border-primary" /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[0.62rem] text-muted-foreground">min</span></div></div>
                  </div>
                  <Toggle checked={settings.notifyWrapup} onChange={(value) => setSettings((current) => ({ ...current, notifyWrapup: value }))} label="Preparar fim do expediente" description="Mostra resumo e checklist antes do horário de saída." />
                </div>
              </section>

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <section className="rounded-2xl border border-border bg-card">
                  <CardHeader icon={Music} title="Música de trabalho" subtitle="Sua playlist favorita a um clique." />
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-2">{(["spotify", "youtube-music"] as DeveloperMusicProvider[]).map((provider) => <button key={provider} type="button" onClick={() => setSettings((current) => ({ ...current, musicProvider: provider }))} className={cn("h-9 rounded-xl border text-xs font-semibold transition-colors", settings.musicProvider === provider ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-muted")}>{provider === "spotify" ? "Spotify" : "YouTube Music"}</button>)}</div>
                    <div className="mt-3"><FieldLabel>Playlist, álbum ou música</FieldLabel><input type="url" value={settings.musicUrl} onChange={(event) => setSettings((current) => ({ ...current, musicUrl: event.target.value }))} placeholder={settings.musicProvider === "spotify" ? "https://open.spotify.com/playlist/..." : "https://music.youtube.com/playlist?..."} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground/55 focus:border-primary" /></div>
                    <button type="button" onClick={openMusic} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background text-xs font-semibold hover:bg-muted"><ExternalLink className="size-3.5" />Abrir {settings.musicProvider === "spotify" ? "Spotify" : "YouTube Music"}</button>
                  </div>
                </section>

                <section className="rounded-2xl border border-border bg-card">
                  <CardHeader icon={Bell} title="Notificações do navegador" subtitle="Necessárias para expediente, água e foco em segundo plano." />
                  <div className="p-4">
                    {notificationPermission === "granted" ? (
                      <div className="flex items-center gap-3 rounded-xl border border-success/20 bg-success/5 p-3"><span className="flex size-8 items-center justify-center rounded-lg bg-success/10 text-success"><Check className="size-3.5" /></span><div><p className="text-xs font-semibold">Notificações ativadas</p><p className="mt-0.5 text-[0.65rem] text-muted-foreground">O navegador está autorizado.</p></div></div>
                    ) : notificationPermission === "unsupported" ? (
                      <p className="text-xs leading-relaxed text-muted-foreground">Este navegador não disponibiliza a API de notificações.</p>
                    ) : notificationPermission === "denied" ? (
                      <div className="rounded-xl border border-warning/20 bg-warning/5 p-3"><p className="text-xs font-semibold">Notificações bloqueadas</p><p className="mt-1 text-[0.66rem] leading-relaxed text-muted-foreground">Libere as notificações nas permissões deste site e recarregue a página.</p></div>
                    ) : (
                      <button type="button" onClick={() => void requestNotificationPermission()} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground"><Bell className="size-3.5" />Ativar notificações</button>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 border-t border-border bg-card px-4 py-4 sm:px-6">
            <button type="button" onClick={() => setPersonalizeOpen(false)} className="h-10 rounded-xl border border-border px-4 text-xs font-semibold hover:bg-muted">Fechar</button>
            <button type="button" onClick={() => void saveSettings()} disabled={!settingsDirty || saving || loading} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45">
              {saving ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Save className="size-3.5" />}
              Salvar alterações
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
