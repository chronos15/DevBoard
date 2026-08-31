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
import { Input } from "@/components/ui/input"
import { useStore } from "@/lib/store"
import { statusMeta, statusOrder } from "@/lib/project-utils"
import type { Status } from "@/lib/types"

function executionMembersOnly<T extends { role?: string }>(members: T[]) {
  return members.filter((member) => member.role === "developer" || member.role === "admin")
}

export function FollowUpAddActivityDialog({ projectId }: { projectId: string }) {
  const { members, currentUserId, currentUserRole, addActivity } = useStore()
  const executionMembers = executionMembersOnly(members)
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [assigneeId, setAssigneeId] = React.useState(currentUserId || executionMembers[0]?.id || "")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!assigneeId && currentUserId) setAssigneeId(currentUserId)
  }, [assigneeId, currentUserId])

  if (currentUserRole !== "admin") return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      const ok = await addActivity(projectId, title.trim(), assigneeId ? [assigneeId] : [])
      if (!ok) return
      setTitle("")
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
        if (next) setAssigneeId(currentUserId || executionMembers[0]?.id || "")
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

      <DialogContent className="w-[calc(100vw-1rem)] max-w-xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nova atividade</DialogTitle>
          <DialogDescription>
            Crie uma atividade usando as mesmas regras do modo Lista e Kanban.
          </DialogDescription>
        </DialogHeader>

        <form id="followup-add-activity" onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Título</label>
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Ex.: Implementar integração de pagamentos"
              maxLength={300}
            />
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
  const { members, addSubactivity, currentUserId, currentUserRole } = useStore()
  const executionMembers = executionMembersOnly(members)
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [hours, setHours] = React.useState("4")
  const [assigneeId, setAssigneeId] = React.useState(currentUserId || executionMembers[0]?.id || "")
  const [status, setStatus] = React.useState<Status>("backlog")
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!assigneeId && currentUserId) setAssigneeId(currentUserId)
  }, [assigneeId, currentUserId])

  if (currentUserRole !== "admin") return null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim() || !assigneeId || saving) return
    if ((status === "done" || status === "cancelled") && !window.confirm(`Criar esta subatividade já como “${statusMeta[status].label}”?`)) return

    setSaving(true)
    try {
      const ok = await addSubactivity(projectId, activityId, {
        title: title.trim(),
        estimatedHours: Math.max(0, Number(hours) || 0),
        assigneeId,
        status,
      })
      if (!ok) return
      setTitle("")
      setHours("4")
      setStatus("backlog")
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
        if (next) setAssigneeId(currentUserId || executionMembers[0]?.id || "")
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
            Mesmas regras de criação, responsável, situação e estimativa usadas em Lista/Kanban.
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

          <div className="grid gap-3 sm:grid-cols-2">
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
                {statusOrder.map((item) => <option key={item} value={item}>{statusMeta[item].label}</option>)}
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
