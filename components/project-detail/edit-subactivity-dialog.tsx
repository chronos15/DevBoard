"use client"

import * as React from "react"
import { Pencil } from "lucide-react"
import type { Subactivity } from "@/lib/types"
import { useStore } from "@/lib/store"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { formatDecimalHoursAsHHMM, normalizeHHMMOnBlur, parseHHMMToDecimalHours } from "@/lib/duration-input"
import { DurationField } from "@/components/ui/duration-field"
import { normalizeSubactivityDescription } from "@/lib/subactivity-description"

export function EditSubactivityDialog({
  subactivity,
  compact = false,
  className,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  subactivity: Subactivity
  compact?: boolean
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const {
    members,
    currentUserRole,
    workItemTypes,
    updateSubactivity,
  } = useStore()
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = React.useCallback((value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value)
    onOpenChange?.(value)
  }, [controlledOpen, onOpenChange])
  const [title, setTitle] = React.useState(subactivity.title)
  const [hours, setHours] = React.useState(formatDecimalHoursAsHHMM(subactivity.estimatedHours))
  const [assigneeId, setAssigneeId] = React.useState(subactivity.assigneeId)
  const [typeId, setTypeId] = React.useState(subactivity.typeId ?? "")
  const [linkedOs, setLinkedOs] = React.useState(subactivity.linkedOs ?? "")
  const [build, setBuild] = React.useState(subactivity.build ?? "")
  const [saving, setSaving] = React.useState(false)

  const executionMembers = React.useMemo(
    () => members.filter((member) => member.role === "developer" || member.role === "admin"),
    [members],
  )

  const activeTypes = React.useMemo(() => {
    const active = workItemTypes.filter((item) => item.active)
    const current = subactivity.typeId
      ? workItemTypes.find((item) => item.id === subactivity.typeId)
      : undefined
    return current && !active.some((item) => item.id === current.id) ? [current, ...active] : active
  }, [subactivity.typeId, workItemTypes])

  const reset = React.useCallback(() => {
    setTitle(subactivity.title)
    setHours(formatDecimalHoursAsHHMM(subactivity.estimatedHours))
    setAssigneeId(subactivity.assigneeId)
    setTypeId(subactivity.typeId ?? "")
    setLinkedOs(subactivity.linkedOs ?? "")
    setBuild(subactivity.build ?? "")
  }, [subactivity.assigneeId, subactivity.build, subactivity.estimatedHours, subactivity.linkedOs, subactivity.title, subactivity.typeId])

  React.useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  if (currentUserRole !== "admin") return null

  const running = subactivity.status === "in-progress"
  const assigneeChanged = assigneeId !== subactivity.assigneeId
  const normalizedEstimate = normalizeHHMMOnBlur(hours)
  const parsedEstimate = parseHHMMToDecimalHours(normalizedEstimate)
  const valid = Boolean(title.trim() && assigneeId && parsedEstimate)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || saving || (running && assigneeChanged)) return
    if (normalizedEstimate !== hours) setHours(normalizedEstimate)
    setSaving(true)
    try {
      const ok = await updateSubactivity(subactivity.id, {
        title: title.trim(),
        estimatedHours: parsedEstimate?.hours ?? 0,
        assigneeId,
        typeId: typeId || null,
        linkedOs: linkedOs.trim(),
        build: build.trim(),
      })
      if (ok) setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (value) reset()
        setOpen(value)
      }}
    >
      {!hideTrigger && (
        <Button
          type="button"
          variant="ghost"
          size={compact ? "icon-sm" : "icon"}
          className={cn(className)}
          onClick={() => setOpen(true)}
          title="Editar subatividade"
          aria-label={`Editar subatividade ${subactivity.title}`}
        >
          <Pencil className="size-3.5" />
        </Button>
      )}

      <DialogContent className="w-[calc(100vw-1rem)] max-w-xl sm:max-w-xl md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar subatividade</DialogTitle>
          <DialogDescription>
            Alteração administrativa de descrição, estimativa, referências, tipo e responsável. O status continua sendo controlado pelo fluxo normal da subatividade.
          </DialogDescription>
        </DialogHeader>

        <form id={`edit-subactivity-${subactivity.id}`} onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
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
              className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-ring sm:min-h-32"
              placeholder="Descreva o que precisa ser feito..."
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Número da O.S.</label>
              <input
                value={linkedOs}
                onChange={(event) => setLinkedOs(event.target.value)}
                maxLength={120}
                placeholder="Ex: 15482"
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Versão / Build</label>
              <input
                value={build}
                onChange={(event) => setBuild(event.target.value)}
                maxLength={120}
                placeholder="Ex: 2026.09.16.1 ou v1.7.0"
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Estimativa (HH:mm)</label>
              <DurationField
                value={hours}
                onChange={setHours}
                invalid={hours.trim().length > 0 && !parsedEstimate}
                errorMessage={hours.trim().length > 0 && !parsedEstimate ? "Informe uma estimativa válida no formato HH:mm." : null}
                placeholder="HH:mm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <select
                value={typeId}
                onChange={(event) => setTypeId(event.target.value)}
                className="h-10 rounded-xl border border-border bg-card px-2 text-sm outline-none focus:border-ring"
              >
                <option value="">Sem tipo</option>
                {activeTypes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.active ? "" : " (inativo)"}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Responsável</label>
            <select
              value={assigneeId}
              disabled={running}
              onChange={(event) => setAssigneeId(event.target.value)}
              className="h-10 rounded-xl border border-border bg-card px-2 text-sm outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {executionMembers.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </select>
            {running ? (
              <span className="text-[0.68rem] leading-relaxed text-warning">
                A subatividade está em execução. Pause-a antes de trocar o responsável para preservar o cronômetro e a sessão de trabalho em andamento.
              </span>
            ) : (
              <span className="text-[0.68rem] leading-relaxed text-muted-foreground">
                Ao trocar o responsável, o novo usuário será associado à subatividade e receberá uma notificação.
              </span>
            )}
          </div>
        </form>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
          <Button
            type="submit"
            form={`edit-subactivity-${subactivity.id}`}
            disabled={!valid || (running && assigneeChanged)}
            loading={saving}
            loadingText="Salvando..."
          >
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
