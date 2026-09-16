"use client"

import * as React from "react"
import { Check, Search, UserCheck } from "lucide-react"
import type { Member } from "@/lib/types"
import { MemberAvatar, MemberName } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export function SubactivityApprovalDialog({
  open,
  onOpenChange,
  members,
  currentUserId,
  subactivityTitle,
  loading = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  members: Member[]
  currentUserId: string
  subactivityTitle: string
  loading?: boolean
  onConfirm: (userId: string) => void | Promise<void>
}) {
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState("")

  React.useEffect(() => {
    if (!open) return
    setQuery("")
    setSelectedId("")
  }, [open, subactivityTitle])

  const candidates = React.useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR")
    return members
      .filter((member) => member.id !== currentUserId)
      .filter((member) => !needle || `${member.name} ${member.email ?? ""}`.toLocaleLowerCase("pt-BR").includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
  }, [currentUserId, members, query])

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 pb-4 pt-5 text-left">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserCheck className="size-4.5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">Solicitar aprovação</DialogTitle>
              <DialogDescription className="mt-1 text-xs leading-relaxed">
                Escolha quem deve revisar “{subactivityTitle}”. A pessoa será notificada e poderá aprovar ou devolver para Backlog.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="px-5 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar usuário"
              className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/55 focus:border-ring"
            />
          </div>

          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
            {candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">Nenhum usuário encontrado.</div>
            ) : candidates.map((member) => {
              const selected = selectedId === member.id
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedId(member.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
                    selected ? "border-primary/30 bg-primary/[0.07]" : "border-transparent hover:bg-muted/60",
                  )}
                >
                  <MemberAvatar member={member} profileEnabled={false} className="size-8 shrink-0 text-[0.55rem]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold"><MemberName member={member} fallback="Usuário" /></span>
                    <span className="mt-0.5 block truncate text-[0.62rem] text-muted-foreground">{member.email || member.role || "Membro"}</span>
                  </span>
                  <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent")}>
                    <Check className="size-3" />
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <DialogFooter className="border-t border-border bg-muted/20 px-5 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button type="button" onClick={() => selectedId && onConfirm(selectedId)} disabled={!selectedId || loading} loading={loading} loadingText="Solicitando...">
            Solicitar aprovação
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
