"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useStore } from "@/lib/store"
import { canPerformAction } from "@/lib/access-control"
import { statusMeta, statusOrder } from "@/lib/project-utils"
import type { Priority, Status } from "@/lib/types"

function executionMembersOnly<T extends { role?: string }>(members: T[]) {
  return members.filter((member) => member.role === "developer" || member.role === "admin")
}

export function FollowUpAddActivityDialog({ projectId }: { projectId: string }) {
  const { members, projects, currentUserId, currentUserRole, currentAccessPolicy, addActivity, workItemTypes } = useStore()
  const executionMembers = executionMembersOnly(members)
  const project = projects.find((item) => item.id === projectId)
  const canManageStructure = canPerformAction(currentUserRole, currentAccessPolicy, "createActivities") && (currentUserRole === "admin" || Boolean(project?.memberIds.includes(currentUserId)))
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [assigneeId, setAssigneeId] = React.useState("")
  const [typeId, setTypeId] = React.useState("")
  const [build, setBuild] = React.useState(project?.build ?? "")
  const [linkedOs, setLinkedOs] = React.useState("")
  const [priority, setPriority] = React.useState<Priority>("medium")
  const [relatedModule, setRelatedModule] = React.useState("")
  const [subject, setSubject] = React.useState("")
  const [responsibleDepartment, setResponsibleDepartment] = React.useState("")
  const [saving, setSaving] = React.useState(false)

  if (!canManageStructure) return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const ok = await addActivity(projectId, title.trim(), assigneeId ? [assigneeId] : [], typeId || null, {
        build,
        linkedOs,
        priority,
        relatedModule,
        subject,
        responsibleDepartment,
      })
      if (!ok) return
      setTitle("")
      setTypeId("")
      setBuild(project?.build ?? "")
      setLinkedOs("")
      setPriority("medium")
      setRelatedModule("")
      setSubject("")
      setResponsibleDepartment("")
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        setOpen(next)
        if (next) {
          setAssigneeId("")
          setBuild(project?.build ?? "")
          setLinkedOs("")
          setPriority("medium")
          setRelatedModule("")
          setSubject("")
          setResponsibleDepartment("")
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => setOpen(true)}
        title="Nova atividade"
        aria-label="Nova atividade"
      >
        <Plus className="size-3.5" />
      </Button>

      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Nova atividade</DialogTitle>
          <DialogDescription>
            Crie a atividade e relacione os dados operacionais do projeto.
          </DialogDescription>
        </DialogHeader>

        <form id="followup-add-activity" onSubmit={submit} className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Título</label>
            <textarea
              autoFocus
              rows={4}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Descreva a atividade com o nível de detalhe necessário..."
              maxLength={1200}
              className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
            />
            <p className="text-[0.65rem] text-muted-foreground">Pode usar múltiplas linhas. O texto completo fica disponível no painel de informações da atividade.</p>
          </div>

          <section className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3.5 sm:p-4">
            <div>
              <h3 className="text-xs font-semibold text-foreground">Dados da atividade</h3>
              <p className="mt-0.5 text-[0.65rem] text-muted-foreground">Informações específicas desta abertura.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Build</label>
                <input
                  value={build}
                  onChange={(event) => setBuild(event.target.value)}
                  placeholder="Ex: 2026.09.11.1"
                  maxLength={120}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">O.S. vinculada</label>
                <input
                  value={linkedOs}
                  onChange={(event) => setLinkedOs(event.target.value)}
                  placeholder="Ex: 15482"
                  maxLength={120}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Prioridade</label>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as Priority)}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3.5 sm:p-4">
            <div>
              <h3 className="text-xs font-semibold text-foreground">Contexto do projeto</h3>
              <p className="mt-0.5 text-[0.65rem] text-muted-foreground">As opções abaixo vêm do “Contexto do sistema” deste projeto.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Módulo relacionado</label>
                <select
                  value={relatedModule}
                  onChange={(event) => setRelatedModule(event.target.value)}
                  disabled={!project?.modules?.length}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55 focus:border-ring"
                >
                  <option value="">{project?.modules?.length ? "Sem módulo relacionado" : "Nenhum módulo configurado"}</option>
                  {(project?.modules ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Assunto</label>
                <select
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                  disabled={!project?.subjects?.length}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55 focus:border-ring"
                >
                  <option value="">{project?.subjects?.length ? "Sem assunto relacionado" : "Nenhum assunto configurado"}</option>
                  {(project?.subjects ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Departamento responsável</label>
                <select
                  value={responsibleDepartment}
                  onChange={(event) => setResponsibleDepartment(event.target.value)}
                  disabled={!project?.responsibleDepartments?.length}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55 focus:border-ring"
                >
                  <option value="">{project?.responsibleDepartments?.length ? "Sem departamento relacionado" : "Nenhum departamento configurado"}</option>
                  {(project?.responsibleDepartments ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <select
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
              >
                <option value="">Sem tipo</option>
                {workItemTypes.filter((item) => item.active).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Responsável <span className="font-normal opacity-70">(opcional)</span></label>
              <select
                value={assigneeId}
                onChange={(event) => setAssigneeId(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
              >
                <option value="">Sem responsável específico</option>
                {executionMembers.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button type="submit" form="followup-add-activity" disabled={!title.trim()} loading={saving} loadingText="Criando...">
            <Plus className="size-4" /> Criar atividade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function FollowUpAddSubactivityDialog({
  projectId,
  activityId,
}: {
  projectId: string
  activityId: string
}) {
  const { members, projects, serviceRequests, addSubactivity, currentUserId, currentUserRole, currentAccessPolicy, workItemTypes } = useStore()
  const executionMembers = executionMembersOnly(members)
  const project = projects.find((item) => item.id === projectId)
  const canManageStructure = canPerformAction(currentUserRole, currentAccessPolicy, "createSubactivities") && (currentUserRole === "admin" || currentUserRole === "developer" || Boolean(project?.memberIds.includes(currentUserId)))
  const aqsRequired = serviceRequests.some((request) => request.activityId === activityId)
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [hours, setHours] = React.useState("4")
  const [assigneeId, setAssigneeId] = React.useState(
    executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "",
  )
  const [status, setStatus] = React.useState<Status>("backlog")
  const [typeId, setTypeId] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const canSetInitialStatus = currentUserRole === "admin" || (currentUserRole === "developer" && assigneeId === currentUserId)

  React.useEffect(() => {
    if (!assigneeId) {
      setAssigneeId(executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "")
    }
    const canChooseStatus = currentUserRole === "admin" || (currentUserRole === "developer" && assigneeId === currentUserId)
    if (!canChooseStatus && status !== "backlog") setStatus("backlog")
    if (aqsRequired && (status === "done" || status === "cancelled")) setStatus("backlog")
  }, [aqsRequired, assigneeId, currentUserId, currentUserRole, executionMembers, status])

  if (!canManageStructure) return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || !assigneeId || saving) return
    if (!aqsRequired && (status === "done" || status === "cancelled") && !window.confirm(`Criar esta subatividade já como “${statusMeta[status].label}”?`)) return

    setSaving(true)
    try {
      const ok = await addSubactivity(projectId, activityId, {
        title: title.trim(),
        estimatedHours: Math.max(0, Number(hours) || 0),
        assigneeId,
        status,
        typeId: typeId || null,
      })
      if (!ok) return
      setTitle("")
      setHours("4")
      setStatus("backlog")
      setTypeId("")
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return
        setOpen(next)
        if (next) setAssigneeId(executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "")
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={() => setOpen(true)}
        title="Nova subatividade"
        aria-label="Nova subatividade"
      >
        <Plus className="size-3.5" />
      </Button>

      <DialogContent className="w-[calc(100vw-1rem)] max-w-xl sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova subatividade</DialogTitle>
          <DialogDescription>
            {aqsRequired ? "Esta atividade pertence a uma solicitação. A conclusão é obrigatoriamente feita pela Análise AQS." : "Mesmas regras de criação, responsável, situação e estimativa usadas em Lista/Kanban."}
          </DialogDescription>
        </DialogHeader>

        <form id={`followup-add-sub-${activityId}`} onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Descrição</label>
            <textarea
              autoFocus
              rows={5}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Descreva o que precisa ser feito..."
              className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring sm:min-h-32"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Estimativa (h)</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Situação</label>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as Status)}
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
              >
                {statusOrder.map((item) => (
                  <option key={item} value={item} disabled={(!canSetInitialStatus && item !== "backlog") || (aqsRequired && (item === "done" || item === "cancelled"))}>
                    {statusMeta[item].label}
                  </option>
                ))}
              </select>
              {aqsRequired ? (
                <p className="text-[0.68rem] leading-snug text-primary">OS vinculada: finalize enviando para Aguardando AQS.</p>
              ) : !canSetInitialStatus ? (
                <p className="text-[0.68rem] leading-snug text-muted-foreground">
                  Para outro responsável, a nova subatividade começa no Backlog.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <select
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
              >
                <option value="">Sem tipo</option>
                {workItemTypes.filter((item) => item.active).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Responsável</label>
            <select
              value={assigneeId}
              onChange={(event) => setAssigneeId(event.target.value)}
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
            >
              {executionMembers.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
          <Button type="submit" form={`followup-add-sub-${activityId}`} disabled={!title.trim() || !assigneeId} loading={saving} loadingText="Criando...">
            <Plus className="size-4" /> Criar subatividade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
