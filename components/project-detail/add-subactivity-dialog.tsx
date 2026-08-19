"use client"

import * as React from "react"
import { Plus } from "lucide-react"
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
import { statusMeta, statusOrder } from "@/lib/project-utils"
import type { Status } from "@/lib/types"

export function AddSubactivityDialog({
  projectId,
  activityId,
}: {
  projectId: string
  activityId: string
}) {
  const { members, addSubactivity, currentUserId, currentUserRole } = useStore()
  const executionMembers = members.filter((member) => member.role === "developer" || member.role === "admin")
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [hours, setHours] = React.useState("4")
  const [assignee, setAssignee] = React.useState(currentUserId || executionMembers[0]?.id || "")
  const [status, setStatus] = React.useState<Status>("backlog")
  const [terminalConfirmOpen, setTerminalConfirmOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!assignee && currentUserId) setAssignee(currentUserId)
    if (assignee && assignee !== currentUserId && currentUserRole !== "admin" && (status === "in-progress" || status === "waiting-aqs")) {
      setStatus("backlog")
    }
  }, [assignee, currentUserId, currentUserRole, status])

  async function saveSubactivity() {
    if (!title.trim() || !assignee || saving) return
    setSaving(true)
    try {
      const ok = await addSubactivity(projectId, activityId, {
        title: title.trim(),
        estimatedHours: Math.max(0, Number(hours) || 0),
        assigneeId: assignee,
        status,
      })
      if (!ok) return
      setTitle("")
      setHours("4")
      setStatus("backlog")
      setTerminalConfirmOpen(false)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !assignee) return
    if (status === "done" || status === "cancelled") {
      setTerminalConfirmOpen(true)
      return
    }
    await saveSubactivity()
  }

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) setAssignee(currentUserId || executionMembers[0]?.id || "")
      }}
    >
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
      >
        <Plus className="size-3.5" />
        Nova subatividade
      </button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova subatividade</DialogTitle>
          <DialogDescription>
            Adicione uma tarefa com situação, estimativa e responsável.
          </DialogDescription>
        </DialogHeader>

        <form id="add-sub-form" onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">Título</label>
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Revisar wireframes"
              className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Estimativa (h)</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm outline-none focus:border-ring"
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
                    disabled={(item === "in-progress" || item === "waiting-aqs") && assignee !== currentUserId && currentUserRole !== "admin"}
                  >
                    {statusMeta[item].label}
                  </option>
                ))}
              </select>
              {status === "in-progress" && (
                <span className="text-[0.68rem] leading-snug text-primary">
                  O cronômetro inicia automaticamente. Se este responsável já estiver executando outra subatividade, ela será pausada.
                </span>
              )}
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
          <Button type="submit" form="add-sub-form" loading={saving} loadingText="Adicionando...">Adicionar</Button>
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
