"use client"

import * as React from "react"
import { Check, ChevronRight, FileText, Plus, SlidersHorizontal } from "lucide-react"
import {
  Dialog,
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
import { cn } from "@/lib/utils"
import { getSubactivityReferenceDefaults } from "@/lib/subactivity-reference-defaults"
import { normalizeSubactivityDescription } from "@/lib/subactivity-description"

type AddSubactivityStep = "identification" | "extras"

export function AddSubactivityDialog({
  projectId,
  activityId,
  aqsRequired = false,
}: {
  projectId: string
  activityId: string
  aqsRequired?: boolean
}) {
  const { projects, members, addSubactivity, currentUserId, currentUserRole, currentAccessPolicy, workItemTypes } = useStore()
  const executionMembers = members.filter((member) => member.role === "developer" || member.role === "admin")
  const canCreateSubactivity = canPerformAction(currentUserRole, currentAccessPolicy, "createSubactivities")
  const activity = projects.find((project) => project.id === projectId)?.activities.find((item) => item.id === activityId)
  const [open, setOpen] = React.useState(false)
  const [step, setStep] = React.useState<AddSubactivityStep>("identification")
  const [title, setTitle] = React.useState("")
  const [hours, setHours] = React.useState("")
  const [estimateError, setEstimateError] = React.useState<string | null>(null)
  const [assignee, setAssignee] = React.useState(
    executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "",
  )
  const [status, setStatus] = React.useState<Status>("backlog")
  const [typeId, setTypeId] = React.useState("")
  const [linkedOs, setLinkedOs] = React.useState("")
  const [build, setBuild] = React.useState("")
  const [terminalConfirmOpen, setTerminalConfirmOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const tabRefs = React.useRef<Record<AddSubactivityStep, HTMLButtonElement | null>>({
    identification: null,
    extras: null,
  })
  const canSetInitialStatus = currentUserRole === "admin" || (currentUserRole === "developer" && assignee === currentUserId)

  React.useEffect(() => {
    if (!assignee) setAssignee(executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "")
    const canChooseStatus = currentUserRole === "admin" || (currentUserRole === "developer" && assignee === currentUserId)
    if (!canChooseStatus && status !== "backlog") setStatus("backlog")
    if (aqsRequired && (status === "done" || status === "cancelled")) setStatus("backlog")
  }, [aqsRequired, assignee, currentUserId, currentUserRole, executionMembers, status])

  function resetForm() {
    const defaults = getSubactivityReferenceDefaults(activity)
    setStep("identification")
    setTitle("")
    setHours("")
    setEstimateError(null)
    setAssignee(executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id || "")
    setStatus("backlog")
    setTypeId("")
    setLinkedOs(defaults.linkedOs)
    setBuild(defaults.build)
    setTerminalConfirmOpen(false)
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const nextStep: AddSubactivityStep = step === "identification" ? "extras" : "identification"
    setStep(nextStep)
    window.setTimeout(() => tabRefs.current[nextStep]?.focus(), 0)
  }

  function validateIdentification() {
    const normalizedEstimate = normalizeHHMMOnBlur(hours)
    const parsedEstimate = parseHHMMToDecimalHours(normalizedEstimate)
    if (!title.trim() || !assignee) return false
    if (!parsedEstimate || parsedEstimate.totalMinutes <= 0) {
      setEstimateError(!hours.trim()
        ? "Informe a estimativa da subatividade."
        : parsedEstimate?.totalMinutes === 0
          ? "A estimativa deve ser maior que 00:00."
          : "Informe uma estimativa válida no formato HH:mm.")
      return false
    }
    setEstimateError(null)
    if (normalizedEstimate !== hours) setHours(normalizedEstimate)
    return true
  }

  async function saveSubactivity() {
    const normalizedEstimate = normalizeHHMMOnBlur(hours)
    const parsedEstimate = parseHHMMToDecimalHours(normalizedEstimate)
    if (!title.trim() || !assignee || saving) return
    if (!parsedEstimate || parsedEstimate.totalMinutes <= 0) {
      setStep("identification")
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
      const ok = await addSubactivity(projectId, activityId, {
        title: title.trim(),
        estimatedHours: parsedEstimate.hours,
        assigneeId: assignee,
        status,
        typeId: typeId || null,
        linkedOs: linkedOs.trim(),
        build: build.trim(),
      })
      if (!ok) return
      resetForm()
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!validateIdentification()) {
      setStep("identification")
      return
    }
    if (!aqsRequired && (status === "done" || status === "cancelled")) {
      setTerminalConfirmOpen(true)
      return
    }
    await saveSubactivity()
  }

  if (!canCreateSubactivity) return null

  const identificationReady = Boolean(title.trim() && assignee && parseHHMMToDecimalHours(normalizeHHMMOnBlur(hours))?.totalMinutes)
  const hasReferences = Boolean(linkedOs.trim() || build.trim())

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (saving) return
          setOpen(value)
          if (value) resetForm()
        }}
      >
        <button
          onClick={() => {
            resetForm()
            setOpen(true)
          }}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          <Plus className="size-3.5" />
          Nova subatividade
        </button>

        <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="gap-1.5 border-b border-border px-5 pb-4 pt-5 pr-12">
            <DialogTitle className="text-lg">Nova subatividade</DialogTitle>
            <DialogDescription className="max-w-2xl text-xs leading-relaxed">
              {aqsRequired
                ? "Esta atividade pertence a uma solicitação. Crie a etapa técnica normalmente; a conclusão será feita somente após envio e aprovação AQS."
                : "Descreva a etapa, defina a execução e complemente as referências quando necessário."}
            </DialogDescription>
          </DialogHeader>

          <div className="border-b border-border bg-muted/20 px-5 py-2.5">
            <div
              role="tablist"
              aria-label="Etapas da nova subatividade"
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
                  <span className="block truncate text-[0.62rem] text-muted-foreground">Descrição, tipo, responsável e estimativa</span>
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
                  <span className="block truncate text-[0.62rem] text-muted-foreground">O.S. e Versão / Build</span>
                </span>
                {hasReferences ? (
                  <Check className="size-3.5 shrink-0 text-success" />
                ) : (
                  <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[0.58rem] font-medium text-muted-foreground">Opcional</span>
                )}
              </button>
            </div>
          </div>

          <form id="add-sub-form" onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {step === "identification" ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-medium text-muted-foreground">Descrição</label>
                    <button
                      type="button"
                      onClick={() => setTitle((current) => normalizeSubactivityDescription(current))}
                      disabled={!title.trim()}
                      className="rounded-md px-2 py-1 text-[0.64rem] font-medium text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
                      title="Converter o texto para frase normal, preservando trechos entre aspas"
                    >
                      Normalizar texto
                    </button>
                  </div>
                  <textarea
                    autoFocus
                    rows={5}
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Descreva o que precisa ser feito..."
                    className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-ring sm:min-h-32"
                  />
                  <div className="flex items-start justify-between gap-3 text-[0.64rem] leading-relaxed">
                    {title.length > 500 ? (
                      <p className="max-w-xl text-warning">
                        Descrição longa ({title.length} caracteres). Para facilitar a leitura, prefira deixar um resumo aqui e publicar o detalhamento no corpo da subatividade. Você ainda pode salvar normalmente.
                      </p>
                    ) : (
                      <span className="text-muted-foreground">Use “Normalizar texto” se o conteúdo vier todo em CAIXA ALTA.</span>
                    )}
                    <span className="shrink-0 tabular-nums text-muted-foreground">{title.length}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Situação</label>
                    <select
                      value={status}
                      onChange={(event) => setStatus(event.target.value as Status)}
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
                    >
                      {statusOrder.filter((item) => item !== "waiting").map((item) => (
                        <option
                          key={item}
                          value={item}
                          disabled={(!canSetInitialStatus && item !== "backlog") || (aqsRequired && (item === "done" || item === "cancelled"))}
                        >
                          {statusMeta[item].label}
                        </option>
                      ))}
                    </select>
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

                {aqsRequired ? (
                  <p className="text-[0.68rem] leading-snug text-primary">
                    OS vinculada: Concluída/Cancelada não podem ser escolhidas diretamente. Ao terminar, envie para Aguardando AQS.
                  </p>
                ) : !canSetInitialStatus ? (
                  <p className="text-[0.68rem] leading-snug text-muted-foreground">
                    Como você está criando para outro responsável, a subatividade começa no Backlog.
                  </p>
                ) : status === "in-progress" ? (
                  <p className="text-[0.68rem] leading-snug text-primary">
                    O cronômetro inicia automaticamente. Se este responsável já estiver executando outra subatividade, ela será pausada.
                  </p>
                ) : null}

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Responsável</label>
                  <select
                    value={assignee}
                    onChange={(event) => setAssignee(event.target.value)}
                    className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
                  >
                    {executionMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                  {assignee && assignee !== currentUserId && (
                    <p className="text-[0.68rem] leading-relaxed text-muted-foreground">
                      O usuário selecionado receberá uma notificação ao criar a subatividade.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">Referências</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Campos opcionais. Quando existir valor na última subatividade, ele é reaproveitado; caso contrário, usamos o valor configurado na atividade.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Número da O.S.</label>
                    <input
                      value={linkedOs}
                      onChange={(event) => setLinkedOs(event.target.value)}
                      placeholder="Ex: 15482"
                      maxLength={120}
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Versão / Build</label>
                    <input
                      value={build}
                      onChange={(event) => setBuild(event.target.value)}
                      placeholder="Ex: 1.7.0 ou 2026.09.16.1"
                      maxLength={120}
                      className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
                    />
                  </div>
                </div>
              </div>
            )}
          </form>

          <DialogFooter className="m-0 rounded-none border-t border-border bg-popover/95 px-5 py-3 sm:items-center sm:justify-between">
            <div className="hidden text-[0.62rem] text-muted-foreground sm:block">Tab navega · ←/→ troca guia · Esc fecha</div>
            <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              {step === "identification" ? (
                <Button
                  type="button"
                  onClick={() => {
                    if (validateIdentification()) setStep("extras")
                  }}
                  disabled={!title.trim() || !assignee}
                >
                  Continuar para extras <ChevronRight className="size-4" />
                </Button>
              ) : (
                <>
                  <Button type="button" variant="ghost" onClick={() => setStep("identification")} disabled={saving}>Voltar</Button>
                  <Button type="submit" form="add-sub-form" disabled={!title.trim() || !assignee} loading={saving} loadingText="Adicionando...">
                    <Plus className="size-4" /> Criar subatividade
                  </Button>
                </>
              )}
            </div>
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
