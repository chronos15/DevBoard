"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, FolderKanban, GitBranch, LoaderCircle, PackageCheck, Users } from "lucide-react"
import { useStore } from "@/lib/store"
import type { Priority } from "@/lib/types"
import { cn } from "@/lib/utils"

export function ProjectForm({ projectId }: { projectId?: string }) {
  const router = useRouter()
  const { projects, members, addProject, updateProject, currentUserId, hydrated } = useStore()
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined
  const editing = Boolean(projectId)

  const [name, setName] = React.useState(project?.name ?? "")
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

  function toggleMember(id: string) {
    setMemberIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !dueDate || saving) return
    setSaving(true)

    const data = {
      name: name.trim(),
      client: client.trim() || "Projeto interno",
      description: description.trim(),
      tag: tag.trim() || "Desenvolvimento",
      priority,
      dueDate,
      memberIds,
      version: project?.version,
      build: project?.build,
      repository: repository.trim(),
      activities: project?.activities ?? [],
    }

    try {
      if (projectId) {
        const ok = await updateProject(projectId, data)
        if (!ok) return
        router.push(`/projetos/${projectId}`)
        return
      }

      const id = await addProject(data)
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
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{member.name}</span>
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
