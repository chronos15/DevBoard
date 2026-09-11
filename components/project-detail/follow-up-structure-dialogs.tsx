"use client"

import * as React from "react"
import { Check, ChevronRight, FileText, Plus, SlidersHorizontal } from "lucide-react"
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
import { cn } from "@/lib/utils"

function executionMembersOnly<T extends { role?: string }>(members: T[]) {
  return members.filter((member) => member.role === "developer" || member.role === "admin")
}

type AddActivityStep = "identification" | "extras"

type FollowUpAddActivityDialogProps = {
  projectId: string
  trigger?: "icon" | "button"
  className?: string
}

export function FollowUpAddActivityDialog({
  projectId,
  trigger = "icon",
  className,
}: FollowUpAddActivityDialogProps) {
  const { members, projects, currentUserId, currentUserRole, currentAccessPolicy, addActivity, workItemTypes } = useStore()
  const executionMembers = executionMembersOnly(members)
  const project = projects.find((item) => item.id === projectId)
  const canManageStructure = canPerformAction(currentUserRole, currentAccessPolicy, "createActivities") && (currentUserRole === "admin" || Boolean(project?.memberIds.includes(currentUserId)))
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState<AddActivityStep>("identification")
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
  const tabRefs = React.useRef<Record<AddActivityStep, HTMLButtonElement | null>>({
    identification: null,
    extras: null,
  })

  if (!canManageStructure) return null

  const identificationReady = Boolean(title.trim())

  function resetForm() {
    setStep("identification")
    setTitle("")
    setAssigneeId("")
    setTypeId("")
    setBuild(project?.build ?? "")
    setLinkedOs("")
    setPriority("medium")
    setRelatedModule("")
    setSubject("")
    setResponsibleDepartment("")
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const nextStep: AddActivityStep = step === "identification" ? "extras" : "identification"
    setStep(nextStep)
    window.setTimeout(() => tabRefs.current[nextStep]?.focus(), 0)
  }

  function openDialog() {
    resetForm()
    setOpen(true)
  }

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
      resetForm()
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
        if (next) resetForm()
      }}
    >
      {trigger === "button" ? (
        <Button
          type="button"
          size="sm"
          className={cn("gap-1.5", className)}
          onClick={openDialog}
        >
          <Plus className="size-4" />
          Adicionar atividade
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={openDialog}
          title="Nova atividade"
          aria-label="Nova atividade"
        >
          <Plus className="size-3.5" />
        </Button>
      )}

      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="gap-1.5 border-b border-border px-5 pb-4 pt-5 pr-12">
          <DialogTitle className="text-lg">Nova atividade</DialogTitle>
          <DialogDescription className="max-w-2xl text-xs leading-relaxed">
            Crie uma atividade usando as mesmas regras do modo Lista e Kanban.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border bg-muted/20 px-5 py-2.5">
          <div
            role="tablist"
            aria-label="Etapas da nova atividade"
            onKeyDown={handleTabKeyDown}
            className="grid max-w-xl grid-cols-2 gap-1 rounded-xl border border-border bg-background p-1"
          >
            <button
              ref={(node) => { tabRefs.current.identification = node }}
              type="button"
              role="tab"
              aria-selected={step === "identification"}
              tabIndex={step === "identification" ? 0 : -1}
              onClick={() => setStep("identification")}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                step === "identification" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", step === "identification" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <FileText className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">Identificação</span>
                <span className="block truncate text-[0.62rem] text-muted-foreground">Título, tipo, responsável e prioridade</span>
              </span>
              {identificationReady && <Check className="size-3.5 shrink-0 text-success" />}
            </button>

            <button
              ref={(node) => { tabRefs.current.extras = node }}
              type="button"
              role="tab"
              aria-selected={step === "extras"}
              tabIndex={step === "extras" ? 0 : -1}
              onClick={() => setStep("extras")}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                step === "extras" ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg", step === "extras" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                <SlidersHorizontal className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">Extras</span>
                <span className="block truncate text-[0.62rem] text-muted-foreground">Build, O.S. e contexto do projeto</span>
              </span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[0.58rem] font-semibold text-muted-foreground">
                Opcional
              </span>
            </button>
          </div>
        </div>

        <form id="followup-add-activity" onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 [scrollbar-gutter:stable]">
          {step === "identification" ? (
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Título *</label>
                <textarea
                  autoFocus
                  rows={4}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Descreva a atividade com o nível de detalhe necessário..."
                  maxLength={1200}
                  className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring"
                />
                <div className="flex items-center justify-between gap-3 text-[0.65rem] text-muted-foreground">
                  <p>Pode usar múltiplas linhas. O texto completo fica disponível no painel de informações.</p>
                  <span className="shrink-0 font-mono tabular-nums">{title.length}/1200</span>
                </div>
              </div>

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

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Prioridade</label>
                <select
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as Priority)}
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring sm:max-w-[calc(50%-0.375rem)]"
                >
                  <option value="low">Baixa</option>
                  <option value="medium">Média</option>
                  <option value="high">Alta</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="grid gap-4">
              <section className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Build</label>
                  <input
                    value={build}
                    onChange={(event) => setBuild(event.target.value)}
                    placeholder="Ex: 2026.09.11.1"
                    maxLength={120}
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/65 focus:border-ring"
                  />
                  <p className="text-[0.62rem] text-muted-foreground">Inicia com o Build atual do projeto e pode ser ajustado nesta atividade.</p>
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
                  <p className="text-[0.62rem] text-muted-foreground">Opcional. Informe a referência da O.S. relacionada.</p>
                </div>
              </section>

              <section className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3.5 sm:p-4">
                <div>
                  <h3 className="text-xs font-semibold text-foreground">Contexto do projeto</h3>
                  <p className="mt-0.5 text-[0.65rem] text-muted-foreground">As opções vêm do “Contexto do sistema” configurado neste projeto.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
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
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Departamento responsável</label>
                    <select
                      value={responsibleDepartment}
                      onChange={(event) => setResponsibleDepartment(event.target.value)}
                      disabled={!project?.responsibleDepartments?.length}
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-55 focus:border-ring sm:max-w-[calc(50%-0.375rem)]"
                    >
                      <option value="">{project?.responsibleDepartments?.length ? "Sem departamento relacionado" : "Nenhum departamento configurado"}</option>
                      {(project?.responsibleDepartments ?? []).map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </div>
                </div>
              </section>
            </div>
          )}
        </form>

        <DialogFooter className="m-0 rounded-none border-t border-border bg-popover/95 px-5 py-3 sm:items-center sm:justify-between">
          <div className="hidden text-[0.62rem] text-muted-foreground sm:block">Tab navega · ←/→ troca guia · Esc fecha</div>
          <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
            {step === "identification" ? (
              <Button type="button" onClick={() => setStep("extras")}>
                Continuar para extras <ChevronRight className="size-4" />
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={() => setStep("identification")} disabled={saving}>Voltar</Button>
                <Button type="submit" form="followup-add-activity" disabled={!title.trim()} loading={saving} loadingText="Criando...">
                  <Plus className="size-4" /> Criar atividade
                </Button>
              </>
            )}
          </div>
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
