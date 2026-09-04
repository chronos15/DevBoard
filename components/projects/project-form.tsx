"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, FolderKanban, GitBranch, ImageIcon, LoaderCircle, PackageCheck, Trash2, Upload, Users } from "lucide-react"
import { useStore } from "@/lib/store"
import type { Priority } from "@/lib/types"
import { cn } from "@/lib/utils"
import { MemberName } from "@/components/member-avatar"
import { ProjectIcon, ProjectIconPicker, normalizeProjectIcon } from "@/components/projects/project-icon"

export function ProjectForm({ projectId }: { projectId?: string }) {
  const router = useRouter()
  const { projects, members, addProject, updateProject, currentUserId, currentUserRole, hydrated } = useStore()
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined
  const editing = Boolean(projectId)

  const [name, setName] = React.useState(project?.name ?? "")
  const [icon, setIcon] = React.useState(normalizeProjectIcon(project?.icon))
  const [useCustomImage, setUseCustomImage] = React.useState(Boolean(project?.iconImagePath))
  const [iconImageFile, setIconImageFile] = React.useState<File | null>(null)
  const [iconImagePreview, setIconImagePreview] = React.useState<string | null>(project?.iconImageUrl ?? null)
  const [iconImageError, setIconImageError] = React.useState("")
  const imageInputRef = React.useRef<HTMLInputElement>(null)
  const objectUrlRef = React.useRef<string | null>(null)
  const [client, setClient] = React.useState(project?.client ?? "")
  const [description, setDescription] = React.useState(project?.description ?? "")
  const [tag, setTag] = React.useState(project?.tag ?? "Desenvolvimento")
  const [priority, setPriority] = React.useState<Priority>(project?.priority ?? "medium")
  const [dueDate, setDueDate] = React.useState(project?.dueDate ?? "")
  const [repository, setRepository] = React.useState(project?.repository ?? "")
  const [memberIds, setMemberIds] = React.useState<string[]>(project?.memberIds ?? [])
  const initializedNewMembers = React.useRef(Boolean(projectId))
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!project) return
    setName(project.name)
    setIcon(normalizeProjectIcon(project.icon))
    setUseCustomImage(Boolean(project.iconImagePath))
    setIconImageFile(null)
    setIconImagePreview(project.iconImageUrl ?? null)
    setIconImageError("")
    setClient(project.client)
    setDescription(project.description)
    setTag(project.tag)
    setPriority(project.priority)
    setDueDate(project.dueDate)
    setRepository(project.repository ?? "")
    setMemberIds(project.memberIds)
  }, [project])

  React.useEffect(() => {
    if (editing || initializedNewMembers.current || !hydrated) return
    setMemberIds(currentUserId ? [currentUserId] : members[0] ? [members[0].id] : [])
    initializedNewMembers.current = true
  }, [currentUserId, editing, hydrated, members])

  // `members` contém somente contas ativas do workspace. Desde a migration 049,
  // contas ainda sem confirmação de e-mail permanecem inativas e não podem
  // continuar selecionadas silenciosamente ao editar um projeto antigo.
  React.useEffect(() => {
    if (!hydrated) return
    const availableMemberIds = new Set(members.map((member) => member.id))
    setMemberIds((current) => current.filter((id) => availableMemberIds.has(id)))
  }, [hydrated, members])

  React.useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
  }, [])

  if (editing && !hydrated) {
    return (
      <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-foreground/8">
        <p className="text-sm text-muted-foreground">Carregando projeto...</p>
      </div>
    )
  }

  if (editing && !project) {
    return (
      <div className="rounded-2xl bg-card p-8 text-center ring-1 ring-foreground/8">
        <p className="text-sm text-muted-foreground">Projeto não encontrado.</p>
        <Link href="/projetos" className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
          Voltar para projetos
        </Link>
      </div>
    )
  }

  const canEditProject = !editing || currentUserRole === "admin" || Boolean(
    project && currentUserRole === "developer" && project.memberIds.includes(currentUserId),
  )

  if (editing && !canEditProject) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl bg-card p-8 text-center ring-1 ring-foreground/8">
        <p className="text-sm font-semibold">Você não pode editar este projeto.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Somente administradores ou Desenvolvedores integrados ao projeto podem alterar suas configurações.
          Comentários e anexos continuam disponíveis na tela do projeto.
        </p>
        <Link href={`/projetos/${projectId}`} className="mt-4 inline-flex text-sm font-medium text-primary hover:underline">
          Voltar ao projeto
        </Link>
      </div>
    )
  }

  function chooseCustomImage(file?: File | null) {
    if (!file) return
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
    if (!allowedTypes.has(file.type)) {
      setIconImageError("Use uma imagem JPG, PNG, WEBP ou GIF.")
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setIconImageError("A imagem deve ter no máximo 3 MB.")
      return
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const preview = URL.createObjectURL(file)
    objectUrlRef.current = preview
    setIconImageFile(file)
    setIconImagePreview(preview)
    setUseCustomImage(true)
    setIconImageError("")
  }

  function usePresetIcon() {
    setUseCustomImage(false)
    setIconImageError("")
  }

  function toggleMember(id: string) {
    setMemberIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !dueDate || saving) return
    if (useCustomImage && !iconImageFile && !project?.iconImagePath) {
      setIconImageError("Selecione uma imagem para usar como ícone do projeto.")
      return
    }
    setSaving(true)

    const availableMemberIds = new Set(members.map((member) => member.id))
    const confirmedMemberIds = memberIds.filter((id) => availableMemberIds.has(id))

    const data = {
      name: name.trim(),
      icon,
      client: client.trim() || "Projeto interno",
      description: description.trim(),
      tag: tag.trim() || "Desenvolvimento",
      priority,
      dueDate,
      memberIds: confirmedMemberIds,
      version: project?.version,
      build: project?.build,
      repository: repository.trim(),
      activities: project?.activities ?? [],
    }

    try {
      if (projectId) {
        const ok = await updateProject(projectId, data, { useCustomImage, imageFile: iconImageFile })
        if (!ok) return
        router.push(`/projetos/${projectId}`)
        return
      }

      const id = await addProject(data, { useCustomImage, imageFile: iconImageFile })
      if (!id) return
      router.push(`/projetos/${id}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href={projectId ? `/projetos/${projectId}` : "/projetos"}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        {projectId ? "Voltar ao projeto" : "Projetos"}
      </Link>

      <div>
        <p className="font-mono text-[0.68rem] tracking-[0.16em] text-primary uppercase">
          {editing ? "Configuração do projeto" : "Novo projeto"}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">
          {editing ? "Editar projeto" : "Criar projeto"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {editing
            ? "Atualize os dados do projeto. As alterações serão registradas automaticamente no histórico."
            : "Mantenha apenas as informações essenciais para o time começar a trabalhar."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="space-y-5">
          <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8 md:p-6">
            <div className="mb-5 flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FolderKanban className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Informações principais</h2>
                <p className="text-xs text-muted-foreground">Identificação, contexto e prazo.</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome do projeto" required className="sm:col-span-2">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Plataforma de vendas" className={inputClass} required />
              </Field>
              <Field label="Cliente / área">
                <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Ex: Comercial" className={inputClass} />
              </Field>
              <Field label="Categoria">
                <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Desenvolvimento" className={inputClass} />
              </Field>
              <Field label="Descrição" className="sm:col-span-2">
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Objetivo e contexto do projeto..." className={cn(inputClass, "h-auto resize-none py-2.5")} />
              </Field>
              <Field label="Prioridade">
                <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputClass}>
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </Field>
              <Field label="Data de entrega" required>
                <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} required />
              </Field>
            </div>
          </section>

          <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8 md:p-6">
            <div className="mb-5 flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-xl bg-chart-4/10 text-chart-4">
                <GitBranch className="size-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Desenvolvimento</h2>
                <p className="text-xs text-muted-foreground">Referência do código e versionamento atual.</p>
              </div>
            </div>

            {editing && (project?.version || project?.build) && (
              <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
                <PackageCheck className="size-4 text-primary" />
                <span>Versão atual:</span>
                <strong className="font-mono text-foreground">v{project.version || "—"}</strong>
                <span>·</span>
                <span>Build:</span>
                <strong className="font-mono text-foreground">{project.build || "—"}</strong>
                <span className="ml-auto">Use “Versionar” dentro do projeto para alterar.</span>
              </div>
            )}

            <Field label="Git / SVN / caminho local">
              <input value={repository} onChange={(e) => setRepository(e.target.value)} placeholder="https://github.com/... ou C:\\Projetos\\..." className={inputClass} />
            </Field>

            {!editing && (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                O número da versão e o build são registrados depois, pela opção <strong className="font-medium text-foreground">Versionar</strong> dentro do projeto.
              </p>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
            <div className="mb-4 flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary/10 text-primary">
                <ProjectIcon
                  icon={icon}
                  imageUrl={useCustomImage ? iconImagePreview : undefined}
                  className="size-5"
                  imageClassName="size-full rounded-none object-cover"
                />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Identidade do projeto</h2>
                <p className="text-[0.68rem] text-muted-foreground">Use um ícone do Devboard ou envie sua própria imagem.</p>
              </div>
            </div>

            <div className="mb-4 grid grid-cols-2 rounded-xl bg-muted p-1">
              <button
                type="button"
                onClick={usePresetIcon}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded-lg text-[0.7rem] font-medium transition-colors",
                  !useCustomImage ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <FolderKanban className="size-3.5" /> Ícone
              </button>
              <button
                type="button"
                onClick={() => { setUseCustomImage(true); setIconImageError("") }}
                className={cn(
                  "flex h-8 items-center justify-center gap-1.5 rounded-lg text-[0.7rem] font-medium transition-colors",
                  useCustomImage ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ImageIcon className="size-3.5" /> Imagem
              </button>
            </div>

            {!useCustomImage ? (
              <ProjectIconPicker
                value={icon}
                onChange={(value) => {
                  setIcon(value)
                  setUseCustomImage(false)
                }}
              />
            ) : (
              <div className="space-y-3">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(event) => {
                    chooseCustomImage(event.target.files?.[0])
                    event.currentTarget.value = ""
                  }}
                />

                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-border bg-background p-3 text-left transition-colors hover:border-primary/30 hover:bg-muted/35"
                >
                  <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted text-muted-foreground ring-1 ring-foreground/8">
                    {iconImagePreview ? (
                      <img src={iconImagePreview} alt="Prévia do ícone do projeto" className="size-full object-cover" />
                    ) : (
                      <Upload className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{iconImagePreview ? "Trocar imagem" : "Enviar imagem"}</span>
                    <span className="mt-0.5 block text-[0.65rem] leading-relaxed text-muted-foreground">JPG, PNG, WEBP ou GIF · até 3 MB. Formato quadrado fica melhor.</span>
                  </span>
                  <Upload className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </button>

                {iconImagePreview && (
                  <button
                    type="button"
                    onClick={usePresetIcon}
                    className="inline-flex items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" /> Remover imagem e usar ícone
                  </button>
                )}
                {iconImageError && <p className="text-[0.68rem] font-medium text-destructive">{iconImageError}</p>}
              </div>
            )}
          </section>

          <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
            <div className="mb-4 flex items-center gap-2">
              <Users className="size-4 text-primary" />
              <h2 className="text-sm font-semibold">Responsáveis</h2>
            </div>
            <div className="space-y-2">
              {members.map((member) => {
                const selected = memberIds.includes(member.id)
                return (
                  <button
                    key={member.id}
                    type="button"
                    onClick={() => toggleMember(member.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selected ? "border-primary/30 bg-primary/[0.06]" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[0.65rem] font-semibold text-white" style={{ backgroundColor: member.color }}>
                      {member.initials}
                    </span>
                    <MemberName member={member} className="min-w-0 flex-1 truncate text-sm font-medium" />
                    <span className={cn("flex size-5 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border")}>
                      {selected && <Check className="size-3" strokeWidth={3} />}
                    </span>
                  </button>
                )
              })}
            </div>
            {!editing && memberIds.some((id) => id !== currentUserId) && (
              <p className="mt-3 text-[0.68rem] leading-relaxed text-primary">
                Os outros usuários selecionados receberão uma notificação quando o projeto for criado.
              </p>
            )}
          </section>

          <div className="flex gap-2 lg:flex-col">
            <button
              type="submit"
              disabled={saving}
              aria-busy={saving || undefined}
              style={{ height: 56, minHeight: 56 }}
              className="flex w-full flex-none items-center justify-center gap-2 rounded-xl bg-primary px-4 py-0 text-sm font-semibold leading-none text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
            >
              {saving && <LoaderCircle className="size-4 animate-spin" aria-hidden />}
              {saving ? (editing ? "Salvando..." : "Criando projeto...") : editing ? "Salvar alterações" : "Criar projeto"}
            </button>
            <Link
              href={projectId ? `/projetos/${projectId}` : "/projetos"}
              style={{ height: 56, minHeight: 56 }}
              className="flex w-full flex-none items-center justify-center rounded-xl border border-border bg-card px-4 py-0 text-sm font-medium leading-none transition-colors hover:bg-muted"
            >
              Cancelar
            </Link>
          </div>
        </aside>
      </form>
    </div>
  )
}

const inputClass = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring focus:ring-2 focus:ring-ring/10"

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted-foreground">
        {label} {required && <span className="text-primary">*</span>}
      </span>
      {children}
    </label>
  )
}
