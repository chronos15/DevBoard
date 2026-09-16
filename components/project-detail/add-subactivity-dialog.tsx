"use client"

import * as React from "react"
import { CircleAlert, Plus } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useStore } from "@/lib/store"
import { canPerformAction } from "@/lib/access-control"
import { statusMeta, statusOrder } from "@/lib/project-utils"
import type { Status } from "@/lib/types"
import { normalizeHHMMOnBlur, parseHHMMToDecimalHours } from "@/lib/duration-input"
import { DurationField } from "@/components/ui/duration-field"

export function AddSubactivityDialog({
  projectId,
  activityId,
  aqsRequired = false,
}: {
  projectId: string
  activityId: string
  aqsRequired?: boolean
}) {
  const { members, projects, addSubactivity, updateActivityContext, currentUserId, currentUserRole, currentAccessPolicy, workItemTypes } = useStore()
  const executionMembers = members.filter((member) => member.role === "developer" || member.role === "admin")
  const canCreateSubactivity = canPerformAction(currentUserRole, currentAccessPolicy, "createSubactivities")
  const project = projects.find((item) => item.id === projectId)
  const activity = project?.activities.find((item) => item.id === activityId)
  const canUpdateActivityContext = canPerformAction(currentUserRole, currentAccessPolicy, "createActivities")
    && Boolean(project)
    && (currentUserRole === "admin" || Boolean(project?.memberIds.includes(currentUserId)))
  const missingLinkedOs = Boolean(activity && !activity.linkedOs?.trim())
  const missingBuild = Boolean(activity && !activity.build?.trim())
  const shouldOfferActivityReferences = canUpdateActivityContext && (missingLinkedOs || missingBuild)
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [hours, setHours] = React.useState("")
  const [estimateError, setEstimateError] = React.useState<string | null>(null)
  const [assignee, setAssignee] = React.useState(
    executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "",
  )
  const [status, setStatus] = React.useState<Status>("backlog")
  const [typeId, setTypeId] = React.useState("")
  const [activityLinkedOs, setActivityLinkedOs] = React.useState(activity?.linkedOs ?? "")
  const [activityBuild, setActivityBuild] = React.useState(activity?.build ?? "")
  const [terminalConfirmOpen, setTerminalConfirmOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const canSetInitialStatus = currentUserRole === "admin" || (currentUserRole === "developer" && assignee === currentUserId)

  React.useEffect(() => {
    if (!assignee) setAssignee(executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "")
    const canChooseStatus = currentUserRole === "admin" || (currentUserRole === "developer" && assignee === currentUserId)
    if (!canChooseStatus && status !== "backlog") setStatus("backlog")
    if (aqsRequired && (status === "done" || status === "cancelled")) setStatus("backlog")
  }, [aqsRequired, assignee, currentUserId, currentUserRole, executionMembers, status])

  async function saveSubactivity() {
    const normalizedEstimate = normalizeHHMMOnBlur(hours)
    const parsedEstimate = parseHHMMToDecimalHours(normalizedEstimate)
    if (!title.trim() || !assignee || saving) return
    if (!parsedEstimate || parsedEstimate.totalMinutes <= 0) {
      setEstimateError(!hours.trim()
        ? "Informe a estimativa da subatividade."
        : parsedEstimate?.totalMinutes === 0
          ? "A estimativa deve ser maior que 00:00."
          : "Informe uma estimativa válida no formato HH:mm.")
      return
    }
    setEstimateError(null)
    if (normalizedEstimate !== hours) setHours(normalizedEstimate)
    setSaving(true)
    try {
      if (shouldOfferActivityReferences && activity) {
        const linkedOsChanged = missingLinkedOs && Boolean(activityLinkedOs.trim())
        const buildChanged = missingBuild && Boolean(activityBuild.trim())
        if (linkedOsChanged || buildChanged) {
          const referencesSaved = await updateActivityContext(activity.id, {
            linkedOs: activityLinkedOs,
            build: activityBuild,
          })
          if (!referencesSaved) return
        }
      }

      const ok = await addSubactivity(projectId, activityId, {
        title: title.trim(),
        estimatedHours: parsedEstimate.hours,
        assigneeId: assignee,
        status,
        typeId: typeId || null,
      })
      if (!ok) return
      setTitle("")
      setHours("")
      setEstimateError(null)
      setStatus("backlog")
      setTypeId("")
      setTerminalConfirmOpen(false)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const normalizedEstimate = normalizeHHMMOnBlur(hours)
    if (!title.trim() || !assignee) return
    const parsedForSubmit = parseHHMMToDecimalHours(normalizedEstimate)
    if (!parsedForSubmit || parsedForSubmit.totalMinutes <= 0) {
      setEstimateError(!hours.trim()
        ? "Informe a estimativa da subatividade."
        : parsedForSubmit?.totalMinutes === 0
          ? "A estimativa deve ser maior que 00:00."
          : "Informe uma estimativa válida no formato HH:mm.")
      return
    }
    setEstimateError(null)
    if (normalizedEstimate !== hours) setHours(normalizedEstimate)
    if (!aqsRequired && (status === "done" || status === "cancelled")) {
      setTerminalConfirmOpen(true)
      return
    }
    await saveSubactivity()
  }

  if (!canCreateSubactivity) return null

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) {
          setAssignee(executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "")
          setEstimateError(null)
          setActivityLinkedOs(activity?.linkedOs ?? "")
          setActivityBuild(activity?.build ?? "")
        }
      }}
    >
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
      >
        <Plus className="size-3.5" />
        Nova subatividade
      </button>

      <DialogContent className="w-[calc(100vw-1rem)] max-w-xl sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nova subatividade</DialogTitle>
          <DialogDescription>
            {aqsRequired ? "Esta atividade pertence a uma solicitação. Crie a etapa técnica normalmente; a conclusão será feita somente após envio e aprovação AQS." : "Descreva a subatividade, defina a situação, a estimativa e o responsável."}
          </DialogDescription>
        </DialogHeader>

        <form id="add-sub-form" onSubmit={submit} className="flex flex-col gap-4">
          {shouldOfferActivityReferences && (
            <section className="rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-3.5 dark:border-amber-400/20 dark:bg-amber-400/[0.08]">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-700 dark:text-amber-300">
                  <CircleAlert className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">Referências da atividade não informadas</p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed text-muted-foreground">
                    Se quiser, informe agora a O.S. e/ou o Build / Server. É opcional e a subatividade pode ser criada normalmente sem esses dados.
                  </p>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {missingLinkedOs && (
                  <div className="space-y-1.5">
                    <label className="text-[0.68rem] font-medium text-muted-foreground">Número da O.S.</label>
                    <input
                      value={activityLinkedOs}
                      onChange={(event) => setActivityLinkedOs(event.target.value)}
                      placeholder="Ex: 15482"
                      maxLength={120}
                      className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
                    />
                  </div>
                )}
                {missingBuild && (
                  <div className="space-y-1.5">
                    <label className="text-[0.68rem] font-medium text-muted-foreground">Build / Server</label>
                    <input
                      value={activityBuild}
                      onChange={(event) => setActivityBuild(event.target.value)}
                      placeholder="Ex: 2026.09.16.1 ou SERVER-PROD"
                      maxLength={120}
                      className="h-9 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
                    />
                  </div>
                )}
              </div>
            </section>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Descrição</label>
            <textarea
              autoFocus
              rows={5}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Descreva o que precisa ser feito..."
              className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring sm:min-h-32"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Estimativa (HH:mm)</label>
              <DurationField
                value={hours}
                onChange={(value) => {
                  setHours(value)
                  if (estimateError) setEstimateError(null)
                }}
                invalid={Boolean(estimateError)}
                errorMessage={estimateError}
                placeholder="HH:mm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Situação</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Status)}
                className="h-10 rounded-xl border border-border bg-card px-2 text-sm outline-none focus:border-ring"
              >
                {statusOrder.map((item) => (
                  <option
                    key={item}
                    value={item}
                    disabled={(!canSetInitialStatus && item !== "backlog") || (aqsRequired && (item === "done" || item === "cancelled"))}
                  >
                    {statusMeta[item].label}
                  </option>
                ))}
              </select>
              {aqsRequired ? (
                <span className="text-[0.68rem] leading-snug text-primary">
                  OS vinculada: Concluída/Cancelada não podem ser escolhidas diretamente. Ao terminar, envie para Aguardando AQS.
                </span>
              ) : !canSetInitialStatus ? (
                <span className="text-[0.68rem] leading-snug text-muted-foreground">
                  Como você está criando para outro responsável, a subatividade começa no Backlog. O responsável poderá iniciar o fluxo normalmente.
                </span>
              ) : status === "in-progress" ? (
                <span className="text-[0.68rem] leading-snug text-primary">
                  O cronômetro inicia automaticamente. Se este responsável já estiver executando outra subatividade, ela será pausada.
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className="h-10 rounded-xl border border-border bg-card px-2 text-sm outline-none focus:border-ring"
              >
                <option value="">Sem tipo</option>
                {workItemTypes.filter((item) => item.active).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Responsável</label>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="h-10 rounded-xl border border-border bg-card px-2 text-sm outline-none focus:border-ring"
            >
              {executionMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            {assignee && assignee !== currentUserId && (
              <span className="text-[0.68rem] leading-relaxed text-primary">
                O usuário selecionado receberá uma notificação. Como Desenvolvedor, você só pode iniciar suas próprias tarefas; um Administrador pode iniciar tarefas de qualquer responsável.
              </span>
            )}
          </div>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button type="submit" form="add-sub-form" disabled={!title.trim() || !assignee} loading={saving} loadingText="Adicionando...">Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={terminalConfirmOpen} onOpenChange={setTerminalConfirmOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {status === "cancelled" ? "Criar como cancelada?" : "Criar como concluída?"}
          </DialogTitle>
          <DialogDescription>
            A nova subatividade “{title.trim()}” será criada diretamente com status final {statusMeta[status].label}. {currentUserRole === "admin"
              ? "Como administrador, alterações posteriores continuarão exigindo confirmação."
              : "Depois de salvar, um Desenvolvedor não poderá reabrir esse status final. Somente um Administrador poderá alterá-lo."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setTerminalConfirmOpen(false)}>
            Voltar
          </Button>
          <Button
            type="button"
            variant={status === "cancelled" ? "destructive" : "default"}
            onClick={() => { void saveSubactivity() }}
            loading={saving}
            loadingText="Salvando..."
          >
            {status === "cancelled" ? "Sim, criar cancelada" : "Sim, criar concluída"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  )
}
