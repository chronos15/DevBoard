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
  const [hours, setHours] = React.useState(String(subactivity.estimatedHours ?? 0))
  const [assigneeId, setAssigneeId] = React.useState(subactivity.assigneeId)
  const [typeId, setTypeId] = React.useState(subactivity.typeId ?? "")
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
    setHours(String(subactivity.estimatedHours ?? 0))
    setAssigneeId(subactivity.assigneeId)
    setTypeId(subactivity.typeId ?? "")
  }, [subactivity.assigneeId, subactivity.estimatedHours, subactivity.title, subactivity.typeId])

  React.useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  if (currentUserRole !== "admin") return null

  const running = subactivity.status === "in-progress"
  const assigneeChanged = assigneeId !== subactivity.assigneeId
  const valid = Boolean(title.trim() && assigneeId && Number.isFinite(Number(hours)) && Number(hours) >= 0)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!valid || saving || (running && assigneeChanged)) return
    setSaving(true)
    try {
      const ok = await updateSubactivity(subactivity.id, {
        title: title.trim(),
        estimatedHours: Math.max(0, Number(hours) || 0),
        assigneeId,
        typeId: typeId || null,
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
            Alteração administrativa de descrição, estimativa, tipo e responsável. O status continua sendo controlado pelo fluxo normal da subatividade.
          </DialogDescription>
        </DialogHeader>

        <form id={`edit-subactivity-${subactivity.id}`} onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Descrição</label>
            <textarea
              autoFocus
              rows={5}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="min-h-28 w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-sm leading-relaxed outline-none transition-colors focus:border-ring sm:min-h-32"
              placeholder="Descreva o que precisa ser feito..."
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Estimativa (h)</label>
              <input
                type="number"
                min={0}
                step={0.25}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
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
