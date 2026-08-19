"use client"

import * as React from "react"
import { Headphones, Mic2, UserPlus, Video, UsersRound } from "lucide-react"
import type { ChatConversation, MeetingMode, Member } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar } from "@/components/member-avatar"
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
import { primeCallAudio } from "@/lib/webrtc/audio-playback"

function conversationName(conversation: ChatConversation | undefined, currentUserId: string, members: Member[]) {
  if (!conversation) return ""
  if (conversation.kind === "group") return conversation.name || "Grupo"
  const otherId = conversation.memberIds.find((id) => id !== currentUserId)
  return members.find((member) => member.id === otherId)?.name ?? "Conversa"
}

export function MeetingDialog({
  conversation,
  compact = false,
  onCreated,
}: {
  conversation?: ChatConversation
  compact?: boolean
  onCreated?: (meetingId: string) => void
}) {
  const { members, currentUserId, createMeeting } = useStore()
  const [open, setOpen] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [mode, setMode] = React.useState<MeetingMode>("video")
  const [selected, setSelected] = React.useState<string[]>([currentUserId])
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    const baseMembers = conversation?.memberIds ?? [currentUserId]
    const name = conversationName(conversation, currentUserId, members)
    setSelected(Array.from(new Set([currentUserId, ...baseMembers])))
    setTitle(conversation ? (conversation.kind === "group" ? name : `Reunião com ${name}`) : "")
    setMode("video")
  }, [open, conversation, currentUserId, members])

  function toggleMember(memberId: string) {
    if (memberId === currentUserId) return
    setSelected((current) =>
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId],
    )
  }

  async function save() {
    if (saving) return
    void primeCallAudio()
    setSaving(true)
    try {
      const id = await createMeeting({
        title: title.trim() || "Reunião",
        memberIds: selected,
        mode,
        conversationId: conversation?.id,
      })
      if (!id) return
      setOpen(false)
      onCreated?.(id)
    } finally {
      setSaving(false)
    }
  }

  const canSave = selected.length >= 2

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          compact
            ? "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            : "inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90",
        )}
        title="Criar reunião"
      >
        <Video className="size-3.5" />
        {!compact && "Nova reunião"}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-4 py-4 pr-12 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Video className="size-4" />
              </span>
              <div>
                <DialogTitle>Criar reunião</DialogTitle>
                <DialogDescription className="mt-1">
                  Monte uma sala de áudio ou vídeo e escolha quem poderá participar.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="max-h-[62dvh] space-y-5 overflow-y-auto px-4 py-4 sm:px-5">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Nome da reunião</span>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Ex.: Daily do projeto"
                maxLength={80}
                className="h-10"
              />
            </label>

            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Tipo de chamada</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("audio")}
                  className={cn(
                    "flex min-h-20 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                    mode === "audio" ? "border-primary bg-primary/8" : "border-border hover:bg-muted/40",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Headphones className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">Somente áudio</span>
                    <span className="mt-0.5 block text-[0.65rem] text-muted-foreground">Microfone e compartilhamento</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("video")}
                  className={cn(
                    "flex min-h-20 items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors",
                    mode === "video" ? "border-primary bg-primary/8" : "border-border hover:bg-muted/40",
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted">
                    <Video className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">Vídeo</span>
                    <span className="mt-0.5 block text-[0.65rem] text-muted-foreground">Câmera, microfone e tela</span>
                  </span>
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium">Participantes</p>
                  <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                    {selected.length} pessoa{selected.length === 1 ? "" : "s"} na reunião
                  </p>
                </div>
                <UserPlus className="size-4 text-muted-foreground" />
              </div>

              <div className="overflow-hidden rounded-xl border border-border">
                {members.map((member) => {
                  const checked = selected.includes(member.id)
                  const locked = member.id === currentUserId
                  return (
                    <button
                      key={member.id}
                      type="button"
                      disabled={locked}
                      onClick={() => toggleMember(member.id)}
                      className={cn(
                        "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0",
                        !locked && "hover:bg-muted/50",
                      )}
                    >
                      <MemberAvatar member={member} className="size-8 ring-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{member.name}</span>
                        <span className="block text-[0.65rem] text-muted-foreground">
                          {locked ? "Você · obrigatório" : checked ? "Convidado" : "Fora da reunião"}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-lg px-2 py-1 text-[0.62rem] font-medium",
                          locked
                            ? "bg-muted text-muted-foreground"
                            : checked
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground",
                        )}
                      >
                        {locked ? "Obrigatório" : checked ? "Incluído" : "Adicionar"}
                      </span>
                    </button>
                  )
                })}
              </div>
              {!canSave && (
                <p className="mt-2 text-[0.65rem] text-destructive">Selecione pelo menos mais um usuário.</p>
              )}
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/25 px-3 py-3 text-[0.68rem] leading-relaxed text-muted-foreground">
              <Mic2 className="mt-0.5 size-3.5 shrink-0" />
              Câmera, microfone e compartilhamento usam as permissões do navegador. O convite e a sinalização usam Supabase; a mídia é WebRTC e cada convidado só entra depois de atender.
            </div>
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-none">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void save()} disabled={!canSave} loading={saving} loadingText="Criando sala..." className="gap-1.5">
              <UsersRound className="size-3.5" />
              Criar e entrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
