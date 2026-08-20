"use client"

import * as React from "react"
import { Bell, Loader2, Palette, ShieldCheck, User, Users } from "lucide-react"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { ACCESS_ROLE_LABELS, type AccessRole, type Member, type UserPreferences } from "@/lib/types"

const sections = [
  { id: "perfil", label: "Perfil", icon: User },
  { id: "equipe", label: "Equipe", icon: Users },
  { id: "notificacoes", label: "Notificações", icon: Bell },
  { id: "aparencia", label: "Aparência", icon: Palette },
] as const

type SectionId = (typeof sections)[number]["id"]

const roleDescriptions: Record<AccessRole, string> = {
  admin: "Acesso total: projetos, execução, AQS, tópicos, equipe e administração.",
  developer: "Acesso ao sistema e projetos; executa somente atividades e subatividades sob sua responsabilidade.",
  aqs: "Valida tarefas em Aguardando AQS, registra evidências e atua na triagem de tópicos.",
  support: "Abre e acompanha tópicos da operação, com ordem, descrição e evidências.",
  member: "Acompanha o workspace, Chat e os próprios tópicos enviados para análise.",
}

export function ConfigView() {
  const { members, currentUserId } = useStore()
  const me = members.find((member) => member.id === currentUserId)
  const [active, setActive] = React.useState<SectionId>("perfil")

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
      <nav className="flex gap-1 overflow-x-auto rounded-2xl bg-card p-2 ring-1 ring-foreground/8 lg:flex-col lg:overflow-visible">
        {sections.map((section) => (
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
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => setName(me?.name ?? ""), [me?.name])
  React.useEffect(() => () => { if (preview) URL.revokeObjectURL(preview) }, [preview])

  function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    if (preview) URL.revokeObjectURL(preview)
    setPhoto(file)
    setPreview(URL.createObjectURL(file))
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || saving) return
    setSaving(true)
    setSaved(false)
    const ok = await updateMyProfile({ name: name.trim(), avatarFile: photo })
    setSaving(false)
    if (ok) {
      setPhoto(null)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    }
  }

  if (!me) {
    return <p className="text-sm text-muted-foreground">Carregando perfil...</p>
  }

  return (
    <form onSubmit={save}>
      <SectionTitle title="Perfil" subtitle="Dados vinculados à sua conta autenticada no Supabase." />

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="relative size-16 overflow-hidden rounded-2xl">
          {preview ? (
            <img src={preview} alt="Prévia da foto" className="size-full object-cover" />
          ) : (
            <MemberAvatar member={me} className="size-16 rounded-2xl text-base ring-0" />
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={choosePhoto} className="hidden" />
        <button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:bg-muted">
          Alterar foto
        </button>
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

      <div className="mt-6 flex items-center justify-end gap-2">
        {saved && <span className="mr-auto text-xs font-medium text-success">Alterações salvas no Supabase.</span>}
        <button
          type="button"
          onClick={() => { setName(me.name); setPhoto(null); if (preview) URL.revokeObjectURL(preview); setPreview(null) }}
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
        Novos usuários são criados pelo Auth e entram inicialmente como Membro. Apenas Administradores podem alterar roles. Em produção, mantenha o cadastro público desabilitado se o ambiente for interno.
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

function AppearanceSection() {
  const { draft, saving, patch } = usePreferenceEditor()
  return (
    <div>
      <SectionTitle title="Aparência" subtitle="Preferências de interface sincronizadas com sua conta." />
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
