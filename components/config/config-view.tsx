"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Bell, Building2, CalendarDays, Camera, Check, ImageIcon, LayoutDashboard, Loader2, Palette, Pencil, Pipette, Plus, Power, RotateCcw, ShieldCheck, Sparkles, Tags, TimerOff, Trash2, Upload, User, UserPlus, Users, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { createClient } from "@/lib/supabase/client"
import { AVATARS_BUCKET } from "@/lib/supabase/helpers"
import { cn } from "@/lib/utils"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { ACCESS_ROLE_LABELS, type AccessRole, type ActionAccessKey, type Member, type MemberAccessPolicy, type ScreenAccessKey, type UserPreferences } from "@/lib/types"
import { ACTION_ACCESS_DEFINITIONS, defaultActionPermissions, defaultScreenPermissions, SCREEN_ACCESS_DEFINITIONS } from "@/lib/access-control"
import { SecurityHealthSection } from "@/components/config/security-health-section"
import { RequestUnitIcon, RequestUnitIconPicker, normalizeRequestUnitIcon } from "@/components/requests/request-unit-icon"
import { BROWSER_NOTIFICATION_PREFERENCE_EVENT, dismissBrowserNotificationPrompt, isBrowserNotificationPromptDismissed, resetBrowserNotificationPrompt } from "@/lib/browser-notification-preference"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const sections = [
  { id: "perfil", label: "Perfil", icon: User, adminOnly: false },
  { id: "equipe", label: "Equipe", icon: Users, adminOnly: false },
  { id: "notificacoes", label: "Notificações", icon: Bell, adminOnly: false },
  { id: "aparencia", label: "Aparência", icon: Palette, adminOnly: false },
  { id: "tipos", label: "Tipos", icon: Tags, adminOnly: true },
  { id: "unidades", label: "Unidades", icon: Building2, adminOnly: true },
  { id: "seguranca", label: "Segurança", icon: ShieldCheck, adminOnly: true },
] as const

type SectionId = (typeof sections)[number]["id"]

const roleDescriptions: Record<AccessRole, string> = {
  admin: "Acesso total: projetos, execução, AQS, tópicos, equipe e administração.",
  developer: "Acesso ao sistema e projetos; executa somente atividades e subatividades sob sua responsabilidade.",
  aqs: "Valida tarefas em Aguardando AQS, registra evidências e atua na triagem de tópicos.",
  support: "Abre e acompanha tópicos da operação, com ordem, descrição e evidências.",
  member: "Acompanha o workspace, Chat e os próprios tópicos enviados para análise.",
}


const primaryColors = [
  { value: "#F45A3C", label: "Coral" },
  { value: "#F59E0B", label: "Âmbar" },
  { value: "#10B981", label: "Esmeralda" },
  { value: "#14B8A6", label: "Turquesa" },
  { value: "#0EA5E9", label: "Céu" },
  { value: "#3B82F6", label: "Azul" },
  { value: "#6366F1", label: "Índigo" },
  { value: "#8B5CF6", label: "Violeta" },
  { value: "#D946EF", label: "Magenta" },
  { value: "#F43F5E", label: "Rosa" },
] as const

const DEFAULT_PRIMARY_PREVIEW = "#F45A3C"

function normalizedPrimaryColor(value?: string | null) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? String(value).toUpperCase() : null
}
const avatarColors = [
  { value: "#F45A3C", label: "Coral" },
  { value: "#E5484D", label: "Vermelho" },
  { value: "#F59E0B", label: "Âmbar" },
  { value: "#84CC16", label: "Lima" },
  { value: "#22C55E", label: "Verde" },
  { value: "#14B8A6", label: "Turquesa" },
  { value: "#0EA5E9", label: "Céu" },
  { value: "#3B82F6", label: "Azul" },
  { value: "#6366F1", label: "Índigo" },
  { value: "#8B5CF6", label: "Violeta" },
  { value: "#D946EF", label: "Magenta" },
  { value: "#64748B", label: "Grafite" },
] as const

function avatarColorPickerValue(value?: string) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? String(value).toUpperCase() : avatarColors[0].value
}

function avatarColorForeground(value: string) {
  if (!/^#[0-9a-f]{6}$/i.test(value)) return "#FFFFFF"
  const r = Number.parseInt(value.slice(1, 3), 16)
  const g = Number.parseInt(value.slice(3, 5), 16)
  const b = Number.parseInt(value.slice(5, 7), 16)
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111111" : "#FFFFFF"
}

export function ConfigView() {
  const { members, currentUserId, currentUserRole } = useStore()
  const searchParams = useSearchParams()
  const me = members.find((member) => member.id === currentUserId)
  const [active, setActive] = React.useState<SectionId>("perfil")
  const visibleSections = React.useMemo(() => sections.filter((section) => !section.adminOnly || currentUserRole === "admin"), [currentUserRole])

  React.useEffect(() => {
    const section = sections.find((item) => item.id === active)
    if (section?.adminOnly && currentUserRole !== "admin") setActive("perfil")
  }, [active, currentUserRole])

  React.useEffect(() => {
    const requested = searchParams.get("section") as SectionId | null
    if (!requested) return
    const section = sections.find((item) => item.id === requested)
    if (!section || (section.adminOnly && currentUserRole !== "admin")) return
    setActive(requested)
  }, [currentUserRole, searchParams])

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-card p-2 ring-1 ring-foreground/8 lg:flex-col lg:overflow-visible">
        {visibleSections.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => setActive(section.id)}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active === section.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <section.icon className="size-[1.1rem]" />
            {section.label}
          </button>
        ))}
      </nav>

      <div className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8 md:p-6">
        {active === "perfil" && <ProfileSection me={me} />}
        {active === "equipe" && <TeamSection />}
        {active === "notificacoes" && <NotificationsSection />}
        {active === "aparencia" && <AppearanceSection />}
        {active === "tipos" && currentUserRole === "admin" && <WorkItemTypesSection />}
        {active === "unidades" && currentUserRole === "admin" && <ServiceRequestUnitsSection />}
        {active === "seguranca" && currentUserRole === "admin" && <SecurityHealthSection />}
      </div>
    </div>
  )
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
    </div>
  )
}

function ProfileSection({ me }: { me?: Member }) {
  const { currentUserRole, updateMyProfile } = useStore()
  const [name, setName] = React.useState(me?.name ?? "")
  const [photo, setPhoto] = React.useState<File | null>(null)
  const [preview, setPreview] = React.useState<string | null>(null)
  const [avatarColor, setAvatarColor] = React.useState(me?.color ?? avatarColors[0].value)
  const [removeAvatar, setRemoveAvatar] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => setName(me?.name ?? ""), [me?.name])
  React.useEffect(() => setAvatarColor(me?.color ?? avatarColors[0].value), [me?.id, me?.color])
  React.useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function clearPhotoDraft() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setPhoto(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (preview) URL.revokeObjectURL(preview)
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
    setRemoveAvatar(false)
  }

  function removePhoto() {
    clearPhotoDraft()
    setRemoveAvatar(Boolean(me?.avatarUrl))
  }

  function cancelChanges() {
    setName(me?.name ?? "")
    clearPhotoDraft()
    setAvatarColor(me?.color ?? avatarColors[0].value)
    setRemoveAvatar(false)
    setSaved(false)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!me || !name.trim() || saving) return
    setSaving(true)
    setSaved(false)
    const colorChanged = avatarColor !== me.color
    const ok = await updateMyProfile({
      name: name.trim(),
      avatarFile: photo,
      avatarColor: colorChanged ? avatarColor : undefined,
      removeAvatar,
    })
    setSaving(false)
    if (ok) {
      clearPhotoDraft()
      setRemoveAvatar(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    }
  }

  if (!me) {
    return <p className="text-sm text-muted-foreground">Carregando perfil...</p>
  }

  const previewMember: Member = {
    ...me,
    color: avatarColor,
    avatarUrl: preview ?? (removeAvatar ? undefined : me.avatarUrl),
  }
  const hasVisiblePhoto = Boolean(previewMember.avatarUrl)
  const customPickerColor = avatarColorPickerValue(avatarColor)

  return (
    <form onSubmit={save}>
      <SectionTitle title="Perfil" subtitle="Dados vinculados à sua conta no TaskBoard." />

      <div className="mb-6 overflow-hidden rounded-2xl border border-border bg-muted/20">
        <div className="flex flex-col gap-5 p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="relative w-fit shrink-0">
            <MemberAvatar
              member={previewMember}
              profileEnabled={false}
              className="size-20 rounded-[1.35rem] text-xl shadow-sm ring-1 ring-foreground/10 sm:size-[5.5rem]"
            />
            <span className="absolute -right-2 -bottom-2 inline-flex items-center rounded-full border border-border bg-card px-2 py-1 text-[0.62rem] font-semibold text-muted-foreground shadow-sm">
              Prévia
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Seu avatar</p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Use uma foto ou deixe suas iniciais representarem você. A cor escolhida aparece em todo o TaskBoard quando não houver foto.
            </p>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={choosePhoto}
              className="hidden"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-xs font-semibold transition-colors hover:bg-muted"
              >
                <Camera className="size-4" />
                {hasVisiblePhoto ? "Alterar foto" : "Adicionar foto"}
              </button>

              {(preview || me.avatarUrl) && !removeAvatar && (
                <button
                  type="button"
                  onClick={removePhoto}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                  Remover foto
                </button>
              )}

              {removeAvatar && me.avatarUrl && (
                <button
                  type="button"
                  onClick={() => setRemoveAvatar(false)}
                  className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3.5 text-xs font-semibold transition-colors hover:bg-muted"
                >
                  <RotateCcw className="size-4" />
                  Manter foto
                </button>
              )}
            </div>

            {removeAvatar && me.avatarUrl && (
              <p className="mt-2 text-[0.68rem] font-medium text-destructive">
                A foto atual será removida ao salvar. Suas iniciais passarão a usar a cor escolhida abaixo.
              </p>
            )}
          </div>
        </div>

        <div className="border-t border-border bg-card/55 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Palette className="size-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Cor do avatar</p>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Escolha uma cor pronta ou personalize a sua.</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {avatarColors.map((swatch) => {
                const selected = avatarColor.toUpperCase() === swatch.value
                return (
                  <button
                    key={swatch.value}
                    type="button"
                    title={swatch.label}
                    aria-label={`Usar cor ${swatch.label}`}
                    aria-pressed={selected}
                    onClick={() => setAvatarColor(swatch.value)}
                    className={cn(
                      "relative size-8 rounded-full border-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                      selected ? "border-card ring-2 ring-foreground ring-offset-2 ring-offset-card" : "border-transparent",
                    )}
                    style={{ backgroundColor: swatch.value }}
                  >
                    {selected && <Check className="absolute inset-0 m-auto size-4" style={{ color: avatarColorForeground(swatch.value) }} />}
                  </button>
                )
              })}

              <label
                title="Escolher uma cor personalizada"
                className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-3 text-[0.68rem] font-semibold transition-colors hover:bg-muted"
              >
                <span className="size-3 rounded-full border border-foreground/10" style={{ backgroundColor: customPickerColor }} />
                <Pipette className="size-3.5 text-muted-foreground" />
                Personalizar
                <input
                  type="color"
                  value={customPickerColor}
                  onChange={(event) => setAvatarColor(event.target.value.toUpperCase())}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  aria-label="Escolher cor personalizada do avatar"
                />
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Nome completo</span>
          <input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} className="h-10 rounded-xl border border-border bg-muted/50 px-3 text-sm outline-none transition-colors focus:border-ring focus:bg-card" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">E-mail</span>
          <input value={me.email ?? ""} readOnly className="h-10 cursor-not-allowed rounded-xl border border-border bg-muted/50 px-3 text-sm text-muted-foreground outline-none" />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-medium">Nível de acesso</span>
          <div className="flex h-10 items-center gap-2 rounded-xl border border-border bg-muted/50 px-3 text-sm">
            <ShieldCheck className="size-4 text-muted-foreground" />
            {ACCESS_ROLE_LABELS[currentUserRole]}
          </div>
        </label>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {saved && <span className="mr-auto text-xs font-medium text-success">Alterações salvas com sucesso.</span>}
        <button
          type="button"
          onClick={cancelChanges}
          className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          Cancelar
        </button>
        <button disabled={saving} type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">
          {saving && <Loader2 className="size-4 animate-spin" />}
          Salvar alterações
        </button>
      </div>
    </form>
  )
}

const TEAM_WORK_DAYS = [
  { value: 1, label: "Seg" },
  { value: 2, label: "Ter" },
  { value: 3, label: "Qua" },
  { value: 4, label: "Qui" },
  { value: 5, label: "Sex" },
  { value: 6, label: "Sáb" },
  { value: 0, label: "Dom" },
] as const

type ManagedTeamMember = Member & {
  active: boolean
  workDays: number[]
  dailyHours: number
  workSchedule: Record<number, number>
  accessPolicy: MemberAccessPolicy
}

function sanitizeTeamDays(days: unknown): number[] {
  if (!Array.isArray(days)) return [1, 2, 3, 4, 5]
  return Array.from(new Set(days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort((a, b) => a - b)
}

function fallbackWorkSchedule(days: number[], dailyHours: number) {
  const minutes = Math.max(1, Math.min(1440, Math.round((Number.isFinite(dailyHours) && dailyHours > 0 ? dailyHours : 8) * 60)))
  return Object.fromEntries(days.map((day) => [day, minutes])) as Record<number, number>
}

function normalizeWorkSchedule(value: unknown, fallbackDays: number[] = [1, 2, 3, 4, 5], fallbackHours = 8) {
  if (!value || typeof value !== "object") return fallbackWorkSchedule(fallbackDays, fallbackHours)
  const output: Record<number, number> = {}
  for (const [rawDay, rawMinutes] of Object.entries(value as Record<string, unknown>)) {
    const day = Number(rawDay)
    const minutes = Math.round(Number(rawMinutes))
    if (Number.isInteger(day) && day >= 0 && day <= 6 && Number.isFinite(minutes) && minutes > 0 && minutes <= 1440) output[day] = minutes
  }
  return Object.keys(output).length ? output : fallbackWorkSchedule(fallbackDays, fallbackHours)
}

function minutesToTime(minutes: number) {
  const safe = Math.max(0, Math.min(1440, Math.round(minutes || 0)))
  const hours = Math.floor(safe / 60)
  const mins = safe % 60
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`
}

function timeToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

function TeamSchedulePicker({ schedule, disabled, onChange }: {
  schedule: Record<number, number>
  disabled?: boolean
  onChange: (schedule: Record<number, number>) => void
}) {
  function toggle(day: number) {
    const next = { ...schedule }
    if (next[day] > 0) delete next[day]
    else next[day] = 8 * 60
    onChange(next)
  }

  function setTime(day: number, value: string) {
    const minutes = timeToMinutes(value)
    if (minutes === null) return
    const next = { ...schedule }
    if (minutes <= 0) delete next[day]
    else next[day] = minutes
    onChange(next)
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3 sm:p-4">
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="size-4 text-primary" /> Jornada semanal</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Defina uma carga diferente para cada dia. Use o formato HH:mm; dias desmarcados são tratados como folga.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {TEAM_WORK_DAYS.map((day) => {
          const active = Number(schedule[day.value] ?? 0) > 0
          return (
            <div key={day.value} className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 rounded-xl border p-2.5 transition-colors", active ? "border-primary/25 bg-primary/[0.04]" : "border-border bg-card/70")}> 
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(day.value)}
                className={cn("flex h-9 min-w-12 items-center justify-center rounded-lg border px-2 text-xs font-semibold transition-colors disabled:opacity-50", active ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-muted/40 text-muted-foreground")}
              >
                {day.label}
              </button>
              {active ? (
                <label className="min-w-0">
                  <span className="sr-only">Carga de {day.label}</span>
                  <input
                    type="time"
                    step={60}
                    disabled={disabled}
                    value={minutesToTime(schedule[day.value])}
                    onChange={(event) => setTime(day.value, event.target.value)}
                    className="h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2 text-sm font-medium tabular-nums outline-none focus:border-ring disabled:opacity-50"
                  />
                </label>
              ) : (
                <span className="px-1 text-xs text-muted-foreground">Folga</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AccessProfileEditor({ role, policy, disabled, onChange }: {
  role: AccessRole
  policy: MemberAccessPolicy
  disabled?: boolean
  onChange: (policy: MemberAccessPolicy) => void
}) {
  const isAdmin = role === "admin"
  const effectiveEnabled = !isAdmin && policy.enabled

  function setEnabled(enabled: boolean) {
    onChange({
      ...policy,
      enabled: isAdmin ? false : enabled,
      screenPermissions: enabled ? { ...defaultScreenPermissions(role), ...policy.screenPermissions } : policy.screenPermissions,
      actionPermissions: enabled ? { ...defaultActionPermissions(role), ...policy.actionPermissions } : policy.actionPermissions,
    })
  }

  function toggleScreen(key: ScreenAccessKey) {
    onChange({ ...policy, screenPermissions: { ...policy.screenPermissions, [key]: !policy.screenPermissions[key] } })
  }

  function toggleAction(key: ActionAccessKey) {
    onChange({ ...policy, actionPermissions: { ...policy.actionPermissions, [key]: !policy.actionPermissions[key] } })
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={disabled || isAdmin}
        onClick={() => setEnabled(!effectiveEnabled)}
        className={cn("flex w-full items-start justify-between gap-4 rounded-2xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-65", effectiveEnabled ? "border-primary/25 bg-primary/[0.04]" : "border-border bg-muted/20")}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-primary" /> Acesso personalizado</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{isAdmin ? "Administradores mantêm acesso integral para evitar bloqueio administrativo." : "Desativado mantém 100% das regras atuais do perfil. Ative somente para este colaborador."}</span>
        </span>
        <span className={cn("relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors", effectiveEnabled ? "bg-primary" : "bg-muted-foreground/25")}><span className={cn("absolute top-1 size-4 rounded-full bg-white transition-transform", effectiveEnabled ? "translate-x-6" : "translate-x-1")} /></span>
      </button>

      {effectiveEnabled && (
        <>
          <div className="rounded-2xl border border-border p-3 sm:p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold">Telas disponíveis</p>
              <p className="mt-1 text-xs text-muted-foreground">Escolha exatamente quais áreas aparecem e podem ser abertas por este usuário.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {SCREEN_ACCESS_DEFINITIONS.filter((screen) => defaultScreenPermissions(role)[screen.key]).map((screen) => {
                const allowed = policy.screenPermissions[screen.key] !== false
                return (
                  <button key={screen.key} type="button" disabled={disabled} onClick={() => toggleScreen(screen.key)} className={cn("flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50", allowed ? "border-primary/20 bg-primary/[0.035]" : "border-border bg-muted/15")}> 
                    <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border", allowed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-transparent")}><Check className="size-3" /></span>
                    <span className="min-w-0"><span className="block text-xs font-semibold">{screen.label}</span><span className="mt-0.5 block text-[0.65rem] leading-relaxed text-muted-foreground">{screen.description}</span></span>
                  </button>
                )
              })}
            </div>
          </div>


          <div className="rounded-2xl border border-border p-3 sm:p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold">Ações permitidas</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Controle ações estruturais sem mudar a role do usuário. Essas permissões só restringem o que a role já poderia fazer.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {ACTION_ACCESS_DEFINITIONS.filter((action) => defaultActionPermissions(role)[action.key]).map((action) => {
                const allowed = policy.actionPermissions[action.key] !== false
                return (
                  <button key={action.key} type="button" disabled={disabled} onClick={() => toggleAction(action.key)} className={cn("flex min-w-0 items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50", allowed ? "border-primary/20 bg-primary/[0.035]" : "border-border bg-muted/15")}>
                    <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border", allowed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-transparent")}><Check className="size-3" /></span>
                    <span className="min-w-0"><span className="block text-xs font-semibold">{action.label}</span><span className="mt-0.5 block text-[0.65rem] leading-relaxed text-muted-foreground">{action.description}</span></span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-border p-3 sm:p-4">
            <p className="text-sm font-semibold">Escopo dos projetos</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">As restrições abaixo são cumulativas e também são aplicadas pela RLS no Supabase. Elas não alteram os vínculos existentes.</p>
            <div className="mt-3 space-y-2">
              {[
                ["restrictProjects", "Somente projetos integrados", "Exibe o projeto apenas quando o usuário participa do projeto, de uma atividade ou de uma subatividade dele."],
                ["restrictActivities", "Somente atividades integradas", "Dentro dos projetos visíveis, mostra apenas atividades em que o usuário participa diretamente ou por alguma subatividade."],
                ["restrictSubactivities", "Somente subatividades integradas", "Mostra somente subatividades em que é responsável ou participante."],
              ].map(([key, label, description]) => {
                const typedKey = key as "restrictProjects" | "restrictActivities" | "restrictSubactivities"
                const checked = policy[typedKey]
                return (
                  <button key={key} type="button" disabled={disabled} onClick={() => onChange({ ...policy, [typedKey]: !checked })} className="flex w-full items-start gap-3 rounded-xl border border-border bg-card/60 p-3 text-left hover:bg-muted/40 disabled:opacity-50">
                    <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border", checked ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent")}><Check className="size-3" /></span>
                    <span><span className="block text-xs font-semibold">{label}</span><span className="mt-0.5 block text-[0.65rem] leading-relaxed text-muted-foreground">{description}</span></span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TeamSection() {
  const { members, currentUserId, currentUserRole, setMemberRole, refreshAll } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const [teamMembers, setTeamMembers] = React.useState<ManagedTeamMember[]>([])
  const [loadingTeam, setLoadingTeam] = React.useState(false)
  const [changing, setChanging] = React.useState<string | null>(null)
  const [editing, setEditing] = React.useState<ManagedTeamMember | null>(null)
  const [editRole, setEditRole] = React.useState<AccessRole>("member")
  const [editActive, setEditActive] = React.useState(true)
  const [editSchedule, setEditSchedule] = React.useState<Record<number, number>>(fallbackWorkSchedule([1, 2, 3, 4, 5], 8))
  const [editAccess, setEditAccess] = React.useState<MemberAccessPolicy>({ enabled: false, screenPermissions: defaultScreenPermissions("member"), actionPermissions: defaultActionPermissions("member"), restrictProjects: false, restrictActivities: false, restrictSubactivities: false })
  const [editTab, setEditTab] = React.useState<"schedule" | "access">("schedule")
  const [editSaving, setEditSaving] = React.useState(false)
  const [editError, setEditError] = React.useState("")
  const [addOpen, setAddOpen] = React.useState(false)
  const [addName, setAddName] = React.useState("")
  const [addEmail, setAddEmail] = React.useState("")
  const [addPassword, setAddPassword] = React.useState("")
  const [addRole, setAddRole] = React.useState<AccessRole>("member")
  const [addSchedule, setAddSchedule] = React.useState<Record<number, number>>(fallbackWorkSchedule([1, 2, 3, 4, 5], 8))
  const [adding, setAdding] = React.useState(false)
  const [addError, setAddError] = React.useState("")

  const makePolicy = React.useCallback((role: AccessRole, row?: any): MemberAccessPolicy => ({
    enabled: role === "admin" ? false : row?.access_enabled === true,
    screenPermissions: { ...defaultScreenPermissions(role), ...(row?.access_screens && typeof row.access_screens === "object" ? row.access_screens : {}) },
    actionPermissions: { ...defaultActionPermissions(role), ...(row?.access_actions && typeof row.access_actions === "object" ? row.access_actions : {}) },
    restrictProjects: row?.restrict_projects === true,
    restrictActivities: row?.restrict_activities === true,
    restrictSubactivities: row?.restrict_subactivities === true,
  }), [])

  const loadAdminTeam = React.useCallback(async () => {
    if (currentUserRole !== "admin") return
    setLoadingTeam(true)
    try {
      const { data, error } = await supabase.rpc("list_workspace_team_members_v2")
      if (error) throw error
      const rows = (data ?? []).map((row: any): ManagedTeamMember => {
        const avatarPath = row.avatar_path || undefined
        const avatarUrl = avatarPath ? supabase.storage.from(AVATARS_BUCKET).getPublicUrl(avatarPath).data.publicUrl : undefined
        const role = (["admin", "developer", "aqs", "support", "member"].includes(String(row.role)) ? row.role : "member") as AccessRole
        const workDays = sanitizeTeamDays(row.work_days)
        const dailyHours = Number(row.daily_hours || 8)
        const workSchedule = normalizeWorkSchedule(row.work_schedule, workDays, dailyHours)
        return {
          id: row.user_id,
          name: row.name || row.email || "Usuário",
          initials: row.initials || "US",
          color: row.color || "#64748B",
          email: row.email || undefined,
          avatarPath,
          avatarUrl,
          role,
          active: row.active !== false,
          workDays: Object.keys(workSchedule).map(Number).sort((a, b) => a - b),
          dailyHours,
          workSchedule,
          accessPolicy: makePolicy(role, row),
        }
      })
      setTeamMembers(rows)
    } catch (error) {
      console.error("[TaskBoard/Equipe] Falha ao carregar equipe administrativa", error)
    } finally {
      setLoadingTeam(false)
    }
  }, [currentUserRole, makePolicy, supabase])

  React.useEffect(() => {
    if (currentUserRole === "admin") {
      void loadAdminTeam()
      return
    }
    setTeamMembers(members.map((member) => {
      const role = member.role ?? "member"
      const workDays = sanitizeTeamDays(member.workDays)
      const dailyHours = Number(member.dailyHours || 8)
      const workSchedule = normalizeWorkSchedule(member.workSchedule, workDays, dailyHours)
      return {
        ...member,
        active: true,
        workDays,
        dailyHours,
        workSchedule,
        accessPolicy: member.accessPolicy ?? { enabled: false, screenPermissions: defaultScreenPermissions(role), actionPermissions: defaultActionPermissions(role), restrictProjects: false, restrictActivities: false, restrictSubactivities: false },
      }
    }))
  }, [currentUserRole, loadAdminTeam, members])

  async function changeRole(memberId: string, role: AccessRole) {
    if (memberId === currentUserId && currentUserRole !== "admin") return
    setChanging(memberId)
    const ok = await setMemberRole(memberId, role)
    if (ok) await loadAdminTeam()
    setChanging(null)
  }

  function openEdit(member: ManagedTeamMember) {
    setEditing(member)
    const role = member.role ?? "member"
    setEditRole(role)
    setEditActive(member.active)
    setEditSchedule({ ...member.workSchedule })
    setEditAccess({ ...member.accessPolicy, screenPermissions: { ...member.accessPolicy.screenPermissions }, actionPermissions: { ...member.accessPolicy.actionPermissions } })
    setEditTab("schedule")
    setEditError("")
  }

  async function saveEdit() {
    if (!editing || editSaving) return
    if (Object.values(editSchedule).some((minutes) => !Number.isFinite(minutes) || minutes < 0 || minutes > 1440)) {
      setEditError("Revise a jornada. Cada dia deve estar entre 00:00 e 24:00.")
      return
    }
    setEditSaving(true)
    setEditError("")
    try {
      if ((editing.role ?? "member") !== editRole) {
        const ok = await setMemberRole(editing.id, editRole)
        if (!ok) throw new Error("Não foi possível alterar a permissão.")
      }
      const { error: scheduleError } = await supabase.rpc("set_workspace_member_weekly_schedule", {
        p_user_id: editing.id,
        p_schedule: Object.fromEntries(Object.entries(editSchedule).map(([day, minutes]) => [day, Math.round(Number(minutes) || 0)])),
      })
      if (scheduleError) throw scheduleError

      const accessPayload = editRole === "admin" ? { ...editAccess, enabled: false } : editAccess
      const { error: accessError } = await supabase.rpc("set_workspace_member_access_profile_v2", {
        p_user_id: editing.id,
        p_enabled: accessPayload.enabled,
        p_screen_permissions: accessPayload.screenPermissions,
        p_action_permissions: accessPayload.actionPermissions,
        p_restrict_projects: accessPayload.restrictProjects,
        p_restrict_activities: accessPayload.restrictActivities,
        p_restrict_subactivities: accessPayload.restrictSubactivities,
      })
      if (accessError) throw accessError

      if (editing.active !== editActive) {
        const { error: activeError } = await supabase.rpc("set_workspace_member_active", { p_user_id: editing.id, p_active: editActive })
        if (activeError) throw activeError
      }
      await Promise.all([refreshAll(), loadAdminTeam()])
      setEditing(null)
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Não foi possível salvar os dados do usuário.")
    } finally {
      setEditSaving(false)
    }
  }

  function resetAddForm() {
    setAddName("")
    setAddEmail("")
    setAddPassword("")
    setAddRole("member")
    setAddSchedule(fallbackWorkSchedule([1, 2, 3, 4, 5], 8))
    setAddError("")
  }

  async function addUser(event: React.FormEvent) {
    event.preventDefault()
    if (adding) return
    setAdding(true)
    setAddError("")
    try {
      const activeEntries = Object.entries(addSchedule).filter(([, minutes]) => Number(minutes) > 0)
      const averageMinutes = activeEntries.length ? activeEntries.reduce((sum, [, minutes]) => sum + Number(minutes), 0) / activeEntries.length : 8 * 60
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addName.trim(), email: addEmail.trim(), password: addPassword, role: addRole,
          workDays: activeEntries.map(([day]) => Number(day)), dailyHours: averageMinutes / 60, workSchedule: addSchedule,
        }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string }
      if (!response.ok) throw new Error(payload.error || "Não foi possível adicionar o usuário.")
      await Promise.all([refreshAll(), loadAdminTeam()])
      setAddOpen(false)
      resetAddForm()
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Não foi possível adicionar o usuário.")
    } finally {
      setAdding(false)
    }
  }

  function scheduleSummary(member: ManagedTeamMember) {
    const pieces = TEAM_WORK_DAYS.flatMap((day) => {
      const minutes = Number(member.workSchedule[day.value] ?? 0)
      return minutes > 0 ? [`${day.label} ${minutesToTime(minutes)}`] : []
    })
    return pieces.length ? pieces.join(" · ") : "Sem jornada definida"
  }

  return (
    <div className="min-w-0">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Equipe</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{currentUserRole === "admin" ? "Gerencie usuários, jornada por dia e acessos personalizados sem alterar o comportamento padrão das roles." : "Usuários confirmados da equipe e seus níveis de acesso."}</p>
        </div>
        {currentUserRole === "admin" && (
          <button type="button" onClick={() => { resetAddForm(); setAddOpen(true) }} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-auto">
            <UserPlus className="size-4" /> Adicionar usuário
          </button>
        )}
      </div>

      {loadingTeam && currentUserRole === "admin" && teamMembers.length === 0 ? (
        <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Carregando equipe...</div>
      ) : (
        <ul className="space-y-3">
          {teamMembers.map((member) => (
            <li key={member.id} className={cn("rounded-2xl border border-border p-3.5 sm:p-4", !member.active && "bg-muted/25 opacity-70")}>
              <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                <MemberAvatar member={member} className="size-10 text-xs ring-0 sm:size-11" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-semibold"><MemberName member={member} suffix={member.id === currentUserId ? " · você" : ""} /></p>
                    <span className={cn("rounded-full px-2 py-0.5 text-[0.58rem] font-semibold", member.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{member.active ? "Ativo" : "Inativo"}</span>
                    {member.accessPolicy.enabled && member.role !== "admin" && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.58rem] font-semibold text-primary">Acesso personalizado</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{member.email ?? "Conta sem e-mail"}</p>
                  {currentUserRole === "admin" && <p className="mt-1.5 whitespace-normal text-[0.64rem] leading-relaxed text-muted-foreground">{scheduleSummary(member)}</p>}
                </div>
                {currentUserRole === "admin" ? (
                  <div className="col-span-2 mt-1 flex w-full items-center gap-2 border-t border-border/60 pt-3 sm:col-span-1 sm:mt-0 sm:w-auto sm:border-0 sm:pt-0">
                    <div className="relative min-w-0 flex-1 sm:w-36 sm:flex-none">
                      <select aria-label={`Permissão de ${member.name}`} disabled={changing === member.id || !member.active} value={member.role ?? "member"} onChange={(event) => void changeRole(member.id, event.target.value as AccessRole)} className="h-9 w-full rounded-xl border border-border bg-card px-3 text-xs font-medium outline-none focus:border-ring disabled:opacity-60">
                        <option value="admin">Administrador</option><option value="developer">Desenvolvedor</option><option value="aqs">AQS</option><option value="support">Suporte</option><option value="member">Membro</option>
                      </select>
                      {changing === member.id && <Loader2 className="pointer-events-none absolute top-2.5 right-2.5 size-4 animate-spin" />}
                    </div>
                    <button type="button" onClick={() => openEdit(member)} className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" title="Gerenciar usuário" aria-label={`Gerenciar ${member.name}`}><Pencil className="size-4" /></button>
                  </div>
                ) : (
                  <span className="col-span-2 mt-1 w-fit rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground sm:col-span-1 sm:mt-0">{ACCESS_ROLE_LABELS[member.role ?? "member"]}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        <p className="mb-2 text-xs font-semibold">Perfis de acesso padrão</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {(Object.keys(ACCESS_ROLE_LABELS) as AccessRole[]).map((role) => (
            <div key={role} className="rounded-xl bg-muted/35 p-3 ring-1 ring-foreground/6"><p className="text-xs font-semibold">{ACCESS_ROLE_LABELS[role]}</p><p className="mt-1.5 text-[0.68rem] leading-relaxed text-muted-foreground">{roleDescriptions[role]}</p></div>
          ))}
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        {currentUserRole === "admin" ? "Acesso personalizado é opt-in: usuários atuais continuam com as regras de sua role até você ativar a personalização individual. Administradores mantêm acesso integral." : "Apenas Administradores podem alterar permissões, jornada ou status dos usuários."}
      </p>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open && !editSaving) setEditing(null) }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Gerenciar colaborador</DialogTitle><DialogDescription>Configure a jornada semanal e, opcionalmente, um nível de acesso individual.</DialogDescription></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-2xl border border-border p-3">
                <MemberAvatar member={editing} className="size-10" />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{editing.name}</p><p className="truncate text-xs text-muted-foreground">{editing.email}</p></div>
                <span className={cn("rounded-full px-2 py-1 text-[0.6rem] font-semibold", editActive ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{editActive ? "Ativo" : "Inativo"}</span>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold">Perfil base</span>
                <select value={editRole} disabled={editSaving} onChange={(event) => { const role = event.target.value as AccessRole; setEditRole(role); setEditAccess((current) => ({ ...current, screenPermissions: current.enabled ? { ...defaultScreenPermissions(role), ...current.screenPermissions } : defaultScreenPermissions(role), actionPermissions: current.enabled ? Object.fromEntries(Object.entries(defaultActionPermissions(role)).map(([key, allowed]) => [key, allowed && current.actionPermissions[key as ActionAccessKey] !== false])) as Record<ActionAccessKey, boolean> : defaultActionPermissions(role) })) }} className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring disabled:opacity-50">
                  <option value="admin">Administrador</option><option value="developer">Desenvolvedor</option><option value="aqs">AQS</option><option value="support">Suporte</option><option value="member">Membro</option>
                </select>
              </label>

              <div className="grid grid-cols-2 rounded-xl bg-muted p-1">
                <button type="button" onClick={() => setEditTab("schedule")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold transition-colors", editTab === "schedule" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>Jornada</button>
                <button type="button" onClick={() => setEditTab("access")} className={cn("rounded-lg px-3 py-2 text-xs font-semibold transition-colors", editTab === "access" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}>Acesso</button>
              </div>

              {editTab === "schedule" ? <TeamSchedulePicker schedule={editSchedule} disabled={editSaving} onChange={setEditSchedule} /> : <AccessProfileEditor role={editRole} policy={editAccess} disabled={editSaving} onChange={setEditAccess} />}

              <button type="button" disabled={editSaving || editing.id === currentUserId} onClick={() => setEditActive((value) => !value)} className={cn("flex w-full items-center justify-between gap-3 rounded-2xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", editActive ? "border-destructive/20 bg-destructive/[0.04]" : "border-success/20 bg-success/[0.04]")}>
                <span><span className="block text-sm font-semibold">{editActive ? "Inativar usuário" : "Reativar usuário"}</span><span className="mt-0.5 block text-xs text-muted-foreground">{editActive ? "O usuário perde o acesso ao workspace, mas seu histórico é preservado." : "O usuário volta a poder acessar o workspace imediatamente."}</span></span>
                <Power className={cn("size-4 shrink-0", editActive ? "text-destructive" : "text-success")} />
              </button>
              {editing.id === currentUserId && <p className="text-[0.65rem] text-muted-foreground">Sua própria conta não pode ser inativada por esta tela.</p>}
              {editError && <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{editError}</p>}
            </div>
          )}
          <DialogFooter><button type="button" disabled={editSaving} onClick={() => setEditing(null)} className="h-9 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancelar</button><button type="button" disabled={editSaving} onClick={() => void saveEdit()} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{editSaving && <Loader2 className="size-4 animate-spin" />} Salvar</button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addOpen} onOpenChange={(open) => { if (!open && !adding) { setAddOpen(false); resetAddForm() } }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={addUser} className="space-y-4">
            <DialogHeader><DialogTitle>Adicionar usuário</DialogTitle><DialogDescription>A conta será criada com o e-mail confirmado e já vinculada ao workspace.</DialogDescription></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Nome</span><input required minLength={2} value={addName} onChange={(event) => setAddName(event.target.value)} disabled={adding} className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring disabled:opacity-50" placeholder="Nome do colaborador" /></label>
              <label><span className="mb-1.5 block text-sm font-semibold">E-mail</span><input required type="email" value={addEmail} onChange={(event) => setAddEmail(event.target.value)} disabled={adding} className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring disabled:opacity-50" placeholder="usuario@empresa.com" /></label>
              <label><span className="mb-1.5 block text-sm font-semibold">Senha inicial</span><input required minLength={6} type="password" value={addPassword} onChange={(event) => setAddPassword(event.target.value)} disabled={adding} className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring disabled:opacity-50" placeholder="Mínimo 6 caracteres" /></label>
              <label className="sm:col-span-2"><span className="mb-1.5 block text-sm font-semibold">Perfil base</span><select value={addRole} onChange={(event) => setAddRole(event.target.value as AccessRole)} disabled={adding} className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring disabled:opacity-50"><option value="admin">Administrador</option><option value="developer">Desenvolvedor</option><option value="aqs">AQS</option><option value="support">Suporte</option><option value="member">Membro</option></select></label>
            </div>
            <TeamSchedulePicker schedule={addSchedule} disabled={adding} onChange={setAddSchedule} />
            {addError && <p className="rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">{addError}</p>}
            <DialogFooter><button type="button" disabled={adding} onClick={() => { setAddOpen(false); resetAddForm() }} className="h-9 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">Cancelar</button><button type="submit" disabled={adding} className="inline-flex h-9 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{adding && <Loader2 className="size-4 animate-spin" />} Criar usuário</button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PreferenceToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-4 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-60",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-5 shrink-0 rounded-full bg-background shadow-sm ring-1 ring-foreground/10 transition-transform duration-200 ease-out",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </button>
    </div>
  )
}

function usePreferenceEditor() {
  const { preferences, updatePreferences } = useStore()
  const [draft, setDraft] = React.useState<UserPreferences>(preferences)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => setDraft(preferences), [preferences])

  async function patch(next: Partial<UserPreferences>) {
    const value = { ...draft, ...next }
    setDraft(value)
    setSaving(true)
    const ok = await updatePreferences(value)
    if (!ok) setDraft(preferences)
    setSaving(false)
  }

  return { draft, saving, patch }
}

function BrowserNotificationSettings() {
  const { currentUserId } = useStore()
  const [permission, setPermission] = React.useState<NotificationPermission | "unsupported">("unsupported")
  const [dismissed, setDismissed] = React.useState(false)
  const [requesting, setRequesting] = React.useState(false)
  const [showHelp, setShowHelp] = React.useState(false)

  const refresh = React.useCallback(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPermission("unsupported")
      return
    }
    setPermission(Notification.permission)
    setDismissed(isBrowserNotificationPromptDismissed(currentUserId))
  }, [currentUserId])

  React.useEffect(() => {
    refresh()
    if (typeof window === "undefined") return
    const onPreference = (event: Event) => {
      const detail = (event as CustomEvent<{ userId?: string; dismissed?: boolean }>).detail
      if (!detail || detail.userId !== currentUserId) return
      setDismissed(Boolean(detail.dismissed))
    }
    const onVisibility = () => { if (document.visibilityState === "visible") refresh() }
    window.addEventListener(BROWSER_NOTIFICATION_PREFERENCE_EVENT, onPreference)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener(BROWSER_NOTIFICATION_PREFERENCE_EVENT, onPreference)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [currentUserId, refresh])

  async function activate() {
    if (typeof window === "undefined" || !("Notification" in window)) return
    if (Notification.permission === "denied") {
      setPermission("denied")
      setShowHelp(true)
      return
    }
    setRequesting(true)
    try {
      const next = await Notification.requestPermission()
      setPermission(next)
      if (next === "granted") {
        resetBrowserNotificationPrompt(currentUserId)
        setDismissed(false)
        setShowHelp(false)
        try { if ("serviceWorker" in navigator) await navigator.serviceWorker.register("/devboard-sw.js") } catch {}
      } else {
        dismissBrowserNotificationPrompt(currentUserId)
        setDismissed(true)
        setShowHelp(next === "denied")
      }
    } finally {
      setRequesting(false)
    }
  }

  const status = permission === "granted"
    ? { label: "Ativadas", className: "bg-success/10 text-success", description: "O Chrome pode exibir chamadas, mensagens, menções e atualizações do TaskBoard." }
    : permission === "denied"
      ? { label: "Bloqueadas", className: "bg-destructive/10 text-destructive", description: "O Chrome bloqueou as notificações para este site. A liberação precisa ser feita nas permissões do navegador." }
      : permission === "unsupported"
        ? { label: "Indisponíveis", className: "bg-muted text-muted-foreground", description: "Este navegador não oferece suporte às notificações utilizadas pelo TaskBoard." }
        : dismissed
          ? { label: "Ignoradas", className: "bg-warning/10 text-warning", description: "Você escolheu não ativar agora. O aviso automático não será exibido novamente neste dispositivo." }
          : { label: "Não configuradas", className: "bg-muted text-muted-foreground", description: "Ative se quiser receber avisos do TaskBoard mesmo quando estiver em outra tela." }

  return (
    <div className="mb-5 rounded-2xl border border-border bg-muted/20 p-4 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bell className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Notificações do navegador</p>
            <span className={cn("rounded-full px-2 py-0.5 text-[0.62rem] font-semibold", status.className)}>{status.label}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{status.description}</p>
        </div>
        {permission !== "granted" && permission !== "unsupported" && (
          <button
            type="button"
            disabled={requesting}
            onClick={() => void activate()}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {requesting && <Loader2 className="size-3.5 animate-spin" />}
            {permission === "denied" ? "Como ativar" : "Ativar notificações"}
          </button>
        )}
      </div>

      {(showHelp || permission === "denied") && (
        <div className="mt-4 rounded-xl border border-warning/20 bg-warning/[0.05] px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
          <strong className="font-semibold text-foreground">Permissão bloqueada no Chrome.</strong> Abra as informações do site (ícone ao lado do endereço), entre em <strong className="font-medium text-foreground">Permissões / Configurações do site → Notificações</strong> e selecione <strong className="font-medium text-foreground">Permitir</strong>. Depois volte ao TaskBoard; o status será atualizado automaticamente.
        </div>
      )}
    </div>
  )
}

function NotificationsSection() {
  const { draft, saving, patch } = usePreferenceEditor()
  return (
    <div>
      <SectionTitle title="Notificações" subtitle="Preferências persistidas no seu perfil do workspace." />
      <BrowserNotificationSettings />
      <PreferenceToggle label="Atribuições" description="Avisar quando você for adicionado a projeto, atividade ou subatividade." checked={draft.notifyAssignments} disabled={saving} onChange={(value) => void patch({ notifyAssignments: value })} />
      <PreferenceToggle label="Comentários" description="Avisar quando outra pessoa comentar em uma subatividade sua." checked={draft.notifyComments} disabled={saving} onChange={(value) => void patch({ notifyComments: value })} />
      <PreferenceToggle label="Atividade da equipe" description="Reserva a preferência para eventos gerais de conclusão da equipe." checked={draft.notifyTeamActivity} disabled={saving} onChange={(value) => void patch({ notifyTeamActivity: value })} />
      <PreferenceToggle label="Prazos" description="Reserva a preferência para alertas automáticos de vencimento." checked={draft.notifyDeadlines} disabled={saving} onChange={(value) => void patch({ notifyDeadlines: value })} />
    </div>
  )
}

function ServiceRequestUnitsSection() {
  const {
    serviceRequestUnits,
    serviceRequests,
    createServiceRequestUnit,
    updateServiceRequestUnit,
    deleteServiceRequestUnit,
  } = useStore()
  const [name, setName] = React.useState("")
  const [icon, setIcon] = React.useState("building")
  const [useCustomImage, setUseCustomImage] = React.useState(false)
  const [imageFile, setImageFile] = React.useState<File | null>(null)
  const [imagePreview, setImagePreview] = React.useState<string | null>(null)
  const [imageError, setImageError] = React.useState("")
  const [editingUnitId, setEditingUnitId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)
  const imageInputRef = React.useRef<HTMLInputElement>(null)
  const objectUrlRef = React.useRef<string | null>(null)

  const usage = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const request of serviceRequests) {
      if (!request.unitId) continue
      map.set(request.unitId, (map.get(request.unitId) ?? 0) + 1)
    }
    return map
  }, [serviceRequests])

  React.useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  function clearDraft() {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setName("")
    setIcon("building")
    setUseCustomImage(false)
    setImageFile(null)
    setImagePreview(null)
    setImageError("")
    setEditingUnitId(null)
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  function chooseImage(file?: File | null) {
    if (!file) return
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
    if (!allowedTypes.has(file.type)) {
      setImageError("Use uma imagem JPG, PNG, WEBP ou GIF.")
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setImageError("A imagem deve ter no máximo 3 MB.")
      return
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const preview = URL.createObjectURL(file)
    objectUrlRef.current = preview
    setImageFile(file)
    setImagePreview(preview)
    setUseCustomImage(true)
    setImageError("")
  }

  function editUnit(unitId: string) {
    const unit = serviceRequestUnits.find((item) => item.id === unitId)
    if (!unit) return
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    objectUrlRef.current = null
    setEditingUnitId(unit.id)
    setName(unit.name)
    setIcon(normalizeRequestUnitIcon(unit.icon))
    setUseCustomImage(Boolean(unit.iconImagePath))
    setImagePreview(unit.iconImageUrl ?? null)
    setImageFile(null)
    setImageError("")
    if (imageInputRef.current) imageInputRef.current.value = ""
  }

  async function saveUnit(event: React.FormEvent) {
    event.preventDefault()
    const value = name.trim()
    if (value.length < 2 || value.length > 80 || saving) return
    const currentImagePath = editingUnitId ? serviceRequestUnits.find((item) => item.id === editingUnitId)?.iconImagePath : undefined
    if (useCustomImage && !imageFile && !currentImagePath) {
      setImageError("Selecione uma imagem para a unidade.")
      return
    }
    setSaving(true)
    try {
      const visual = { icon, useCustomImage, imageFile }
      const ok = editingUnitId
        ? await updateServiceRequestUnit(editingUnitId, { name: value }, visual)
        : await createServiceRequestUnit(value, visual)
      if (ok) clearDraft()
    } finally {
      setSaving(false)
    }
  }

  async function toggleUnit(unitId: string, active: boolean) {
    if (pendingId) return
    setPendingId(unitId)
    try {
      await updateServiceRequestUnit(unitId, { active })
    } finally {
      setPendingId(null)
    }
  }

  async function removeUnit(unitId: string, label: string) {
    if (pendingId || !window.confirm(`Excluir a unidade “${label}”? As solicitações antigas manterão o nome registrado.`)) return
    setPendingId(unitId)
    try {
      await deleteServiceRequestUnit(unitId)
      if (editingUnitId === unitId) clearDraft()
    } finally {
      setPendingId(null)
    }
  }

  const editingUnit = editingUnitId ? serviceRequestUnits.find((item) => item.id === editingUnitId) : null
  const previewUrl = useCustomImage ? (imagePreview ?? editingUnit?.iconImageUrl ?? null) : null

  return (
    <div>
      <SectionTitle title="Unidades" subtitle="Cadastre as unidades que organizam a navegação das Solicitações. Cada unidade pode usar um ícone do TaskBoard ou uma imagem própria." />

      <form onSubmit={saveUnit} className="mb-5 rounded-2xl border border-border bg-muted/20 p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="group relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
            aria-label="Selecionar imagem personalizada da unidade"
          >
            {previewUrl ? <img src={previewUrl} alt="" className="size-full object-contain p-1.5" /> : <RequestUnitIcon icon={icon} className="size-6" />}
            <span className="absolute inset-x-0 bottom-0 flex h-5 items-center justify-center bg-background/80 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"><Upload className="size-3" /></span>
          </button>

          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <label className="min-w-0">
                <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{editingUnitId ? "Nome da unidade" : "Nova unidade"}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={80} placeholder="Ex.: Goiânia / Unidade 01" className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring" />
              </label>
              <div className="flex items-center gap-2">
                {editingUnitId && <button type="button" onClick={clearDraft} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><X className="size-4" /> Cancelar</button>}
                <button type="submit" disabled={name.trim().length < 2 || saving} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-50">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : editingUnitId ? <Check className="size-4" /> : <Plus className="size-4" />}
                  {editingUnitId ? "Salvar unidade" : "Adicionar unidade"}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-xs font-semibold">Identidade visual</p><p className="mt-0.5 text-[0.64rem] text-muted-foreground">Escolha um ícone ou use uma foto personalizada.</p></div>
                <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
                  <button type="button" onClick={() => { setUseCustomImage(false); setImageError("") }} className={cn("rounded-md px-2.5 py-1.5 text-[0.64rem] font-semibold transition-colors", !useCustomImage ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>Ícone</button>
                  <button type="button" onClick={() => imageInputRef.current?.click()} className={cn("rounded-md px-2.5 py-1.5 text-[0.64rem] font-semibold transition-colors", useCustomImage ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}><ImageIcon className="mr-1 inline size-3" /> Foto</button>
                </div>
              </div>
              {!useCustomImage ? <RequestUnitIconPicker value={icon} onChange={setIcon} /> : <div className="flex items-center gap-2 text-xs text-muted-foreground"><Upload className="size-3.5" /><span>{imageFile?.name ?? (editingUnit?.iconImagePath ? "Imagem atual da unidade" : "Selecione JPG, PNG, WEBP ou GIF · máx. 3 MB")}</span></div>}
              {imageError && <p className="text-[0.66rem] font-medium text-destructive">{imageError}</p>}
              <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => chooseImage(event.target.files?.[0])} />
            </div>
            <p className="text-right text-[0.62rem] text-muted-foreground">{name.length}/80 caracteres</p>
          </div>
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border">
        {serviceRequestUnits.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma unidade cadastrada.</div>
        ) : (
          <div className="divide-y divide-border">
            {serviceRequestUnits.map((unit) => {
              const pending = pendingId === unit.id
              const count = usage.get(unit.id) ?? 0
              return (
                <div key={unit.id} className="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4">
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground"><RequestUnitIcon icon={unit.icon} imageUrl={unit.iconImageUrl} className="size-4" /></span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{unit.name}</p><p className="mt-0.5 text-[0.66rem] text-muted-foreground">{count} solicitação{count === 1 ? "" : "ões"} vinculada{count === 1 ? "" : "s"}{!unit.active ? " · inativa" : ""}</p></div>
                  <button type="button" disabled={pending} onClick={() => editUnit(unit.id)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label={`Editar unidade ${unit.name}`}><Pencil className="size-4" /></button>
                  <button type="button" disabled={pending} onClick={() => void toggleUnit(unit.id, !unit.active)} className={cn("inline-flex h-8 shrink-0 items-center rounded-lg border px-2.5 text-[0.65rem] font-semibold transition-colors disabled:opacity-50", unit.active ? "border-success/25 bg-success/8 text-success hover:bg-success/12" : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground")}>{pending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}{unit.active ? "Ativa" : "Ativar"}</button>
                  <button type="button" disabled={pending} onClick={() => void removeUnit(unit.id, unit.name)} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40" aria-label={`Excluir unidade ${unit.name}`}><Trash2 className="size-4" /></button>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <p className="mt-3 text-[0.68rem] leading-relaxed text-muted-foreground">Desativar uma unidade remove a opção das novas solicitações sem afetar o histórico. Excluir também preserva o nome já gravado nas solicitações antigas.</p>
    </div>
  )
}

function WorkItemTypesSection() {
  const {
    workItemTypes,
    projects,
    createWorkItemType,
    updateWorkItemType,
    deleteWorkItemType,
  } = useStore()
  const [name, setName] = React.useState("")
  const [color, setColor] = React.useState("#3B82F6")
  const [intermittent, setIntermittent] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  const usageByType = React.useMemo(() => {
    const counts = new Map<string, { activities: number; subactivities: number }>()
    for (const type of workItemTypes) counts.set(type.id, { activities: 0, subactivities: 0 })
    for (const project of projects) {
      for (const activity of project.activities) {
        if (activity.typeId) {
          const current = counts.get(activity.typeId) ?? { activities: 0, subactivities: 0 }
          counts.set(activity.typeId, { ...current, activities: current.activities + 1 })
        }
        for (const sub of activity.subactivities) {
          if (!sub.typeId) continue
          const current = counts.get(sub.typeId) ?? { activities: 0, subactivities: 0 }
          counts.set(sub.typeId, { ...current, subactivities: current.subactivities + 1 })
        }
      }
    }
    return counts
  }, [projects, workItemTypes])

  async function addType(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      const ok = await createWorkItemType({ name: name.trim(), color, intermittent })
      if (ok) {
        setName("")
        setIntermittent(false)
      }
    } finally {
      setSaving(false)
    }
  }

  async function toggleType(typeId: string, active: boolean) {
    if (pendingId) return
    setPendingId(typeId)
    try {
      await updateWorkItemType(typeId, { active })
    } finally {
      setPendingId(null)
    }
  }

  async function toggleIntermittent(typeId: string, nextIntermittent: boolean) {
    if (pendingId) return
    setPendingId(typeId)
    try {
      await updateWorkItemType(typeId, { intermittent: nextIntermittent })
    } finally {
      setPendingId(null)
    }
  }

  async function removeType(typeId: string, label: string) {
    if (pendingId) return
    const usage = usageByType.get(typeId)
    if ((usage?.activities ?? 0) + (usage?.subactivities ?? 0) > 0) return
    if (!window.confirm(`Excluir o tipo “${label}”?`)) return
    setPendingId(typeId)
    try {
      await deleteWorkItemType(typeId)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div>
      <SectionTitle
        title="Tipos de atividade"
        subtitle="Catálogo do workspace usado para classificar atividades e subatividades. Somente administradores alteram este catálogo."
      />

      <form onSubmit={addType} className="mb-5 grid gap-2 rounded-2xl border border-border bg-muted/20 p-3 sm:grid-cols-[minmax(0,1fr)_120px_180px_auto] sm:items-end">
        <label className="min-w-0">
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Novo tipo</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={48}
            placeholder="Ex.: Integração"
            className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-ring"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Cor</span>
          <span className="relative flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-2.5">
            <span className="size-5 rounded-full border border-foreground/10" style={{ backgroundColor: color }} />
            <span className="font-mono text-[0.65rem] text-muted-foreground">{color}</span>
            <input
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value.toUpperCase())}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Cor do tipo"
            />
          </span>
        </label>
        <label className="flex h-10 cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3">
          <input
            type="checkbox"
            checked={intermittent}
            onChange={(event) => setIntermittent(event.target.checked)}
            className="size-4 accent-primary"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold"><TimerOff className="size-3.5 text-muted-foreground" />Intermitente</span>
            <span className="block truncate text-[0.58rem] text-muted-foreground">Não pausa por inatividade</span>
          </span>
        </label>
        <button
          type="submit"
          disabled={!name.trim() || saving}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Adicionar
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-border">
        {workItemTypes.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Nenhum tipo cadastrado. Crie o primeiro tipo acima.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {workItemTypes.map((type) => {
              const usage = usageByType.get(type.id) ?? { activities: 0, subactivities: 0 }
              const totalUsage = usage.activities + usage.subactivities
              const pending = pendingId === type.id
              return (
                <div key={type.id} className="flex min-w-0 items-center gap-3 px-3 py-3 sm:px-4">
                  <span className="size-3 shrink-0 rounded-full ring-2 ring-background" style={{ backgroundColor: type.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-semibold">{type.name}</p>
                      {!type.active && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.58rem] font-semibold text-muted-foreground">Inativo</span>
                      )}
                      {type.intermittent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[0.58rem] font-semibold text-primary">
                          <TimerOff className="size-2.5" />Intermitente
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[0.66rem] text-muted-foreground">
                      {usage.activities} atividade{usage.activities === 1 ? "" : "s"} · {usage.subactivities} subatividade{usage.subactivities === 1 ? "" : "s"}
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void toggleIntermittent(type.id, !type.intermittent)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[0.65rem] font-semibold transition-colors disabled:opacity-50",
                      type.intermittent
                        ? "border-primary/25 bg-primary/8 text-primary hover:bg-primary/12"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    title="Tipos intermitentes não são pausados automaticamente por inatividade"
                  >
                    <TimerOff className="size-3.5" />
                    <span className="hidden md:inline">{type.intermittent ? "Intermitente" : "Auto pausa"}</span>
                  </button>

                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void toggleType(type.id, !type.active)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center rounded-lg border px-2.5 text-[0.65rem] font-semibold transition-colors disabled:opacity-50",
                      type.active
                        ? "border-success/25 bg-success/8 text-success hover:bg-success/12"
                        : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {pending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : null}
                    {type.active ? "Ativo" : "Ativar"}
                  </button>

                  <button
                    type="button"
                    disabled={pending || totalUsage > 0}
                    onClick={() => void removeType(type.id, type.name)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
                    title={totalUsage > 0 ? "Tipos em uso não podem ser excluídos. Desative-o para impedir novos usos." : "Excluir tipo"}
                    aria-label={`Excluir tipo ${type.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <p className="mt-3 text-[0.68rem] leading-relaxed text-muted-foreground">
        Desativar um tipo preserva os registros existentes, mas remove a opção das novas atividades e subatividades. Tipos marcados como intermitentes (por exemplo, reunião) não são pausados automaticamente por inatividade.
      </p>
    </div>
  )
}

function AppearanceSection() {
  const { draft, saving, patch } = usePreferenceEditor()
  const selectedPrimary = normalizedPrimaryColor(draft.primaryColor)
  const customPickerColor = selectedPrimary ?? DEFAULT_PRIMARY_PREVIEW

  return (
    <div>
      <SectionTitle title="Aparência" subtitle="Preferências de interface sincronizadas com sua conta." />

      <div className="mb-6 rounded-2xl border border-border bg-card/55 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Interface</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Escolha a experiência do TaskBoard para a sua conta. O Modo Resumido muda apenas a navegação e a apresentação: projetos, permissões e dados continuam exatamente os mesmos.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void patch({ interfaceMode: "focused" })}
            className={cn(
              "group flex min-h-28 items-start gap-3 rounded-2xl border p-4 text-left transition-all disabled:opacity-60",
              draft.interfaceMode === "focused"
                ? "border-primary bg-primary/8 ring-2 ring-primary/12"
                : "border-border bg-background hover:border-primary/35 hover:bg-muted/35",
            )}
          >
            <span className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
              draft.interfaceMode === "focused" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}>
              <Sparkles className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                Resumido
                {draft.interfaceMode === "focused" && <Check className="size-4 text-primary" />}
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                Experiência em canais: projetos como servidores, subatividades como canais, solicitações/AQS integradas e conversa como centro do trabalho.
              </span>
            </span>
          </button>

          <button
            type="button"
            disabled={saving}
            onClick={() => void patch({ interfaceMode: "complete" })}
            className={cn(
              "group flex min-h-28 items-start gap-3 rounded-2xl border p-4 text-left transition-all disabled:opacity-60",
              draft.interfaceMode === "complete"
                ? "border-primary bg-primary/8 ring-2 ring-primary/12"
                : "border-border bg-background hover:border-primary/35 hover:bg-muted/35",
            )}
          >
            <span className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
              draft.interfaceMode === "complete" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}>
              <LayoutDashboard className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold">
                Completa
                {draft.interfaceMode === "complete" && <Check className="size-4 text-primary" />}
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                Mantém a experiência atual com todos os módulos, páginas gerenciais e ferramentas avançadas visíveis na navegação.
              </span>
            </span>
          </button>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card/55 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Palette className="size-4 text-primary" />
              <p className="text-sm font-semibold">Cor primária</p>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Personaliza destaques, botões, seleção, foco e elementos de navegação. A mesma identidade é ajustada automaticamente para os temas claro e escuro.
            </p>
          </div>

          {selectedPrimary && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void patch({ primaryColor: null })}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-border bg-background px-2.5 text-[0.68rem] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
            >
              <RotateCcw className="size-3.5" />
              Restaurar padrão
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            aria-pressed={!selectedPrimary}
            onClick={() => void patch({ primaryColor: null })}
            className={cn(
              "group flex h-9 items-center gap-2 rounded-full border px-2.5 text-[0.68rem] font-semibold transition-all disabled:opacity-60",
              !selectedPrimary ? "border-primary bg-primary/10 text-foreground ring-2 ring-primary/15" : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="size-4 rounded-full border border-black/5" style={{ backgroundColor: DEFAULT_PRIMARY_PREVIEW }} />
            Padrão TaskBoard
            {!selectedPrimary && <Check className="size-3.5 text-primary" />}
          </button>

          {primaryColors.map((swatch) => {
            const selected = selectedPrimary === swatch.value
            return (
              <button
                key={swatch.value}
                type="button"
                disabled={saving}
                title={swatch.label}
                aria-label={`Usar ${swatch.label} como cor primária`}
                aria-pressed={selected}
                onClick={() => void patch({ primaryColor: swatch.value })}
                className={cn(
                  "relative size-9 rounded-full border-2 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-60",
                  selected ? "border-card ring-2 ring-foreground ring-offset-2 ring-offset-card" : "border-transparent",
                )}
                style={{ backgroundColor: swatch.value }}
              >
                {selected && <Check className="absolute inset-0 m-auto size-4" style={{ color: avatarColorForeground(swatch.value) }} />}
              </button>
            )
          })}

          <label
            title="Escolher cor primária personalizada"
            className={cn(
              "relative inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-full border bg-background px-3 text-[0.68rem] font-semibold transition-colors hover:bg-muted",
              selectedPrimary && !primaryColors.some((item) => item.value === selectedPrimary) ? "border-primary ring-2 ring-primary/15" : "border-border",
              saving && "pointer-events-none opacity-60",
            )}
          >
            <span className="size-3.5 rounded-full border border-foreground/10" style={{ backgroundColor: customPickerColor }} />
            <Pipette className="size-3.5 text-muted-foreground" />
            Personalizar
            <input
              type="color"
              value={customPickerColor}
              disabled={saving}
              onChange={(event) => void patch({ primaryColor: event.target.value.toUpperCase() })}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Escolher cor primária personalizada"
            />
          </label>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-md">
          <div className="overflow-hidden rounded-xl border border-border bg-[#fbfaf8] p-2.5">
            <div className="mb-2 text-[0.58rem] font-semibold uppercase tracking-wide text-[#6b665f]">Tema claro</div>
            <div className="flex items-center gap-2">
              <span className="h-7 flex-1 rounded-lg" style={{ backgroundColor: selectedPrimary ?? DEFAULT_PRIMARY_PREVIEW }} />
              <span className="size-7 rounded-lg border border-black/10 bg-white" />
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-[#171717] p-2.5">
            <div className="mb-2 text-[0.58rem] font-semibold uppercase tracking-wide text-[#a3a3a3]">Tema escuro</div>
            <div className="flex items-center gap-2">
              <span className="h-7 flex-1 rounded-lg" style={{ backgroundColor: selectedPrimary ?? DEFAULT_PRIMARY_PREVIEW }} />
              <span className="size-7 rounded-lg border border-white/10 bg-[#262626]" />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-border bg-card/55 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Pencil className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Leitura e tipografia</p>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Ajuste a fonte, o tamanho e o espaçamento da leitura. As opções valem para Chat, Acompanhamento, logs, respostas, anexos e cartões de comandos.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">Tipo de letra</span>
            <select
              value={draft.fontFamily}
              disabled={saving}
              onChange={(event) => void patch({ fontFamily: event.target.value as UserPreferences["fontFamily"] })}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60"
            >
              <option value="jakarta">Plus Jakarta Sans · padrão</option>
              <option value="system">Sistema · Segoe UI / San Francisco</option>
              <option value="arial">Arial · neutra e familiar</option>
              <option value="verdana">Verdana · leitura ampla</option>
              <option value="tahoma">Tahoma · compacta e nítida</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">Tamanho das conversas</span>
            <select
              value={draft.chatTextSize}
              disabled={saving}
              onChange={(event) => void patch({ chatTextSize: event.target.value as UserPreferences["chatTextSize"] })}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60"
            >
              <option value="small">Pequeno</option>
              <option value="medium">Padrão</option>
              <option value="large">Grande</option>
              <option value="xlarge">Extra grande</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium">Espaçamento das mensagens</span>
            <select
              value={draft.chatLineSpacing}
              disabled={saving}
              onChange={(event) => void patch({ chatLineSpacing: event.target.value as UserPreferences["chatLineSpacing"] })}
              className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring disabled:opacity-60"
            >
              <option value="compact">Compacto</option>
              <option value="comfortable">Confortável</option>
              <option value="relaxed">Relaxado</option>
            </select>
          </label>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-background px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <strong className="tb-chat-title truncate">Mauricio Costa</strong>
            <span className="tb-chat-meta shrink-0 text-muted-foreground">agora</span>
          </div>
          <p className="tb-chat-text mt-1 text-foreground/90">
            Prévia de uma mensagem do TaskBoard. Use este exemplo para escolher uma leitura confortável para longos períodos de trabalho.
          </p>
          <div className="mt-2 rounded-lg bg-muted/45 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2"><span className="tb-chat-title truncate font-medium">Subatividade pausada</span><span className="tb-chat-meta shrink-0 text-muted-foreground">09:42</span></div>
            <p className="tb-chat-meta mt-0.5 truncate text-muted-foreground">Motivo: Transição de atividade</p>
          </div>
        </div>
      </div>

      <PreferenceToggle label="Timer sempre visível" description="Mantém o cronômetro em execução destacado no topo." checked={draft.timerSticky} disabled={saving} onChange={(value) => void patch({ timerSticky: value })} />
      <PreferenceToggle label="Animações reduzidas" description="Reduz transições e movimentos na interface." checked={draft.reducedMotion} disabled={saving} onChange={(value) => void patch({ reducedMotion: value })} />
      <div className="mt-6">
        <p className="mb-2 text-sm font-medium">Densidade</p>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["comfortable", "compact"] as const).map((density) => (
            <button
              key={density}
              type="button"
              disabled={saving}
              onClick={() => void patch({ density })}
              className={cn(
                "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60",
                draft.density === density ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {density === "comfortable" ? "Confortável" : "Compacto"}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
