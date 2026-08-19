"use client"

import * as React from "react"
import { Settings2, Trash2, UserPlus, UsersRound } from "lucide-react"
import type { ChatConversation } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export function GroupDialog({
  group,
  onSaved,
  triggerClassName,
  compact = false,
}: {
  group?: ChatConversation
  onSaved?: (conversationId: string | null) => void
  triggerClassName?: string
  compact?: boolean
}) {
  const {
    members,
    currentUserId,
    currentUserRole,
    createChatGroup,
    updateChatGroup,
    deleteChatGroup,
  } = useStore()
  const [open, setOpen] = React.useState(false)
  const [name, setName] = React.useState(group?.name ?? "")
  const [selected, setSelected] = React.useState<string[]>(group?.memberIds ?? [currentUserId])
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false)

  const editing = Boolean(group)
  const canManage = !group || currentUserRole === "admin" || group.createdBy === currentUserId
  const canSave = Boolean(name.trim()) && selected.length >= 2

  React.useEffect(() => {
    if (!open) return
    setName(group?.name ?? "")
    setSelected(group?.memberIds ?? [currentUserId])
  }, [open, group, currentUserId])

  function toggleMember(memberId: string) {
    if (memberId === currentUserId || memberId === group?.createdBy) return
    setSelected((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    )
  }

  async function save() {
    if (!canSave || saving) return
    setSaving(true)
    try {
      if (group) {
        const ok = await updateChatGroup(group.id, { name: name.trim(), memberIds: selected })
        if (!ok) return
        setOpen(false)
        onSaved?.(group.id)
        return
      }
      const id = await createChatGroup(name.trim(), selected)
      if (!id) return
      setOpen(false)
      onSaved?.(id)
    } finally {
      setSaving(false)
    }
  }

  async function removeGroup() {
    if (!group || deleting) return
    setDeleting(true)
    try {
      if (await deleteChatGroup(group.id)) {
        setConfirmDeleteOpen(false)
        setOpen(false)
        onSaved?.(null)
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          compact
            ? "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            : "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90",
          triggerClassName,
        )}
        title={editing ? "Gerenciar grupo" : "Criar grupo"}
      >
        {editing ? <Settings2 className="size-3.5" /> : <UsersRound className="size-3.5" />}
        {!compact && (editing ? "Gerenciar" : "Novo grupo")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88dvh] overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="border-b border-border px-4 py-4 pr-12 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UsersRound className="size-4" />
              </span>
              <div>
                <DialogTitle>{editing ? "Gerenciar grupo" : "Criar novo grupo"}</DialogTitle>
                <DialogDescription className="mt-1">
                  {editing
                    ? "Altere o nome e adicione ou remova participantes do grupo."
                    : "Defina um nome e selecione os usuários que participarão da conversa."}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[58dvh] overflow-y-auto px-4 py-4 sm:px-5">
            {!canManage ? (
              <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
                Apenas quem criou o grupo ou um administrador pode alterar os participantes.
              </div>
            ) : (
              <div className="space-y-5">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome do grupo</span>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Ex.: Time Marketplace"
                    maxLength={60}
                    className="h-10"
                  />
                </label>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium">Participantes</p>
                      <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                        {selected.length} usuário{selected.length === 1 ? "" : "s"} selecionado{selected.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <UserPlus className="size-4 text-muted-foreground" />
                  </div>

                  <div className="overflow-hidden rounded-xl border border-border">
                    {members.map((member) => {
                      const checked = selected.includes(member.id)
                      const locked = member.id === currentUserId || member.id === group?.createdBy
                      return (
                        <button
                          key={member.id}
                          type="button"
                          aria-disabled={locked}
                          onClick={() => {
                            if (!locked) toggleMember(member.id)
                          }}
                          className={cn(
                            "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0",
                            !locked && "hover:bg-muted/50",
                          )}
                        >
                          <MemberAvatar member={member} className="size-8 ring-0" />
                          <span className="min-w-0 flex-1">
                            <MemberName member={member} className="block truncate text-sm font-medium" />
                            <span className="block text-[0.65rem] text-muted-foreground">
                              {member.id === currentUserId
                                ? "Você · obrigatório"
                                : member.id === group?.createdBy
                                  ? "Criador do grupo · obrigatório"
                                  : checked
                                    ? "Participando"
                                    : "Fora do grupo"}
                            </span>
                          </span>
                          <span
                            className={cn(
                              "shrink-0 rounded-lg px-2 py-1 text-[0.62rem] font-medium",
                              locked
                                ? "bg-muted text-muted-foreground"
                                : checked
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-primary/10 text-primary",
                            )}
                          >
                            {locked ? "Obrigatório" : checked ? "Remover" : "Adicionar"}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {selected.length < 2 && (
                    <p className="mt-2 text-[0.65rem] text-destructive">
                      Selecione pelo menos mais um usuário para manter uma conversa em grupo.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="mx-0 mb-0 justify-between rounded-none sm:justify-between">
            {editing && canManage ? (
              <Button type="button" variant="destructive" onClick={() => setConfirmDeleteOpen(true)} loading={deleting} loadingText="Excluindo..." className="gap-1.5">
                <Trash2 className="size-3.5" />
                Excluir grupo
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              {canManage && (
                <Button type="button" onClick={() => void save()} disabled={!canSave} loading={saving} loadingText={editing ? "Salvando..." : "Criando..."}>
                  {editing ? "Salvar alterações" : "Criar grupo"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteOpen} onOpenChange={(next) => !deleting && setConfirmDeleteOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir grupo permanentemente?</DialogTitle>
            <DialogDescription>
              O grupo “{group?.name ?? "Grupo"}”, as mensagens e as mídias serão removidos para todos os participantes. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={deleting} onClick={() => setConfirmDeleteOpen(false)}>Cancelar</Button>
            <Button type="button" variant="destructive" loading={deleting} loadingText="Excluindo..." onClick={() => void removeGroup()}>
              <Trash2 className="size-3.5" /> Excluir permanentemente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
