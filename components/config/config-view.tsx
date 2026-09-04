"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { Bell, Building2, Camera, Check, ImageIcon, Loader2, Palette, Pencil, Pipette, Plus, RotateCcw, ShieldCheck, Tags, TimerOff, Trash2, Upload, User, Users, X } from "lucide-react"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { ACCESS_ROLE_LABELS, type AccessRole, type Member, type UserPreferences } from "@/lib/types"
import { SecurityHealthSection } from "@/components/config/security-health-section"
import { RequestUnitIcon, RequestUnitIconPicker, normalizeRequestUnitIcon } from "@/components/requests/request-unit-icon"

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
      <SectionTitle title="Perfil" subtitle="Dados vinculados à sua conta autenticada no Supabase." />

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
              Use uma foto ou deixe suas iniciais representarem você. A cor escolhida aparece em todo o Devboard quando não houver foto.
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
        {saved && <span className="mr-auto text-xs font-medium text-success">Alterações salvas no Supabase.</span>}
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

function TeamSection() {
  const { members, currentUserId, currentUserRole, setMemberRole } = useStore()
  const [changing, setChanging] = React.useState<string | null>(null)

  async function changeRole(memberId: string, role: AccessRole) {
    if (memberId === currentUserId && currentUserRole !== "admin") return
    setChanging(memberId)
    await setMemberRole(memberId, role)
    setChanging(null)
  }

  return (
    <div>
      <SectionTitle title="Equipe" subtitle="Membros autenticados do workspace e seus níveis de acesso." />
      <ul className="flex flex-col gap-2">
        {members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3 sm:flex-nowrap">
            <MemberAvatar member={member} className="size-10 text-xs ring-0" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium"><MemberName member={member} suffix={member.id === currentUserId ? " · você" : ""} /></p>
              <p className="truncate text-xs text-muted-foreground">{member.email ?? "Conta Supabase"}</p>
            </div>
            {currentUserRole === "admin" ? (
              <div className="relative min-w-32">
                <select
                  aria-label={`Permissão de ${member.name}`}
                  disabled={changing === member.id}
                  value={member.role ?? "member"}
                  onChange={(event) => void changeRole(member.id, event.target.value as AccessRole)}
                  className="h-9 w-full rounded-xl border border-border bg-card px-3 text-xs font-medium outline-none focus:border-ring disabled:opacity-60"
                >
                  <option value="admin">Administrador</option>
                  <option value="developer">Desenvolvedor</option>
                  <option value="aqs">AQS</option>
                  <option value="support">Suporte</option>
                  <option value="member">Membro</option>
                </select>
                {changing === member.id && <Loader2 className="pointer-events-none absolute top-2.5 right-2.5 size-4 animate-spin" />}
              </div>
            ) : (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {ACCESS_ROLE_LABELS[member.role ?? "member"]}
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <p className="mb-2 text-xs font-semibold">Perfis de acesso</p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {(Object.keys(ACCESS_ROLE_LABELS) as AccessRole[]).map((role) => (
            <div key={role} className="rounded-xl bg-muted/35 p-3 ring-1 ring-foreground/6">
              <p className="text-xs font-semibold">{ACCESS_ROLE_LABELS[role]}</p>
              <p className="mt-1.5 text-[0.68rem] leading-relaxed text-muted-foreground">{roleDescriptions[role]}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
        Novos usuários são criados pelo Supabase Auth e entram inicialmente como Membro. Apenas Administradores podem alterar roles. Em produção, mantenha o cadastro público desabilitado se o ambiente for interno.
      </p>
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
        className={cn("relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60", checked ? "bg-primary" : "bg-muted")}
      >
        <span className={cn("absolute top-0.5 size-5 rounded-full bg-card shadow-sm transition-transform", checked ? "translate-x-[1.375rem]" : "translate-x-0.5")} />
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

function NotificationsSection() {
  const { draft, saving, patch } = usePreferenceEditor()
  return (
    <div>
      <SectionTitle title="Notificações" subtitle="Preferências persistidas no seu perfil do workspace." />
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
      <SectionTitle title="Unidades" subtitle="Cadastre as unidades que organizam a navegação das Solicitações. Cada unidade pode usar um ícone do Devboard ou uma imagem própria." />

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
            Padrão Devboard
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
