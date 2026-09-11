"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowUpRight,
  FilePlus2,
  LoaderCircle,
  NotebookPen,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MemberAvatar } from "@/components/member-avatar"
import { createClient } from "@/lib/supabase/client"
import { toUserFacingError } from "@/lib/user-facing-error"
import { followUpHref } from "@/lib/follow-up-launcher"
import { useStore } from "@/lib/store"
import { canPerformAction } from "@/lib/access-control"
import type { Activity, Project } from "@/lib/types"
import { cn } from "@/lib/utils"

type ActivityNote = {
  id: string
  activityId: string
  content: string
  createdBy: string
  createdAt: string
  convertedSubactivityId?: string
  convertedAt?: string
  convertedBy?: string
}

function mapActivityNote(row: Record<string, unknown>): ActivityNote {
  return {
    id: String(row.id ?? ""),
    activityId: String(row.activity_id ?? ""),
    content: String(row.content ?? ""),
    createdBy: String(row.created_by ?? ""),
    createdAt: String(row.created_at ?? ""),
    convertedSubactivityId: typeof row.converted_subactivity_id === "string" ? row.converted_subactivity_id : undefined,
    convertedAt: typeof row.converted_at === "string" ? row.converted_at : undefined,
    convertedBy: typeof row.converted_by === "string" ? row.converted_by : undefined,
  }
}

function noteDate(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return "agora"
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ActivityNotesDialog({
  activity,
  project,
  compact = false,
  triggerClassName,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
}: {
  activity: Activity
  project: Project
  compact?: boolean
  triggerClassName?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const {
    members,
    currentUserId,
    currentUserRole,
    currentAccessPolicy,
    refreshAll,
  } = useStore()
  const supabase = React.useMemo(() => createClient(), [])
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = React.useCallback((nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [controlledOpen, onOpenChange])

  const [notes, setNotes] = React.useState<ActivityNote[]>([])
  const [draft, setDraft] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const [savingId, setSavingId] = React.useState<string | null>(null)
  const [error, setError] = React.useState("")
  const [convertNote, setConvertNote] = React.useState<ActivityNote | null>(null)
  const [convertTitle, setConvertTitle] = React.useState("")
  const [convertHours, setConvertHours] = React.useState("4")
  const executionMembers = React.useMemo(
    () => members.filter((member) => member.role === "developer" || member.role === "admin"),
    [members],
  )
  const defaultAssignee = React.useMemo(
    () => executionMembers.some((member) => member.id === currentUserId) ? currentUserId : executionMembers[0]?.id ?? "",
    [currentUserId, executionMembers],
  )
  const [convertAssignee, setConvertAssignee] = React.useState(defaultAssignee)

  const canManage = currentUserRole === "admin"
    || currentUserRole === "developer"
    || project.memberIds.includes(currentUserId)
  const canCreateSubactivity = canPerformAction(currentUserRole, currentAccessPolicy, "createSubactivities")

  const loadNotes = React.useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const { data, error: queryError } = await supabase
        .from("activity_notes")
        .select("id,activity_id,content,created_by,created_at,converted_subactivity_id,converted_at,converted_by")
        .eq("activity_id", activity.id)
        .order("created_at", { ascending: true })
      if (queryError) throw queryError
      setNotes((data ?? []).map((row) => mapActivityNote(row as Record<string, unknown>)))
      setError("")
    } catch (queryError) {
      console.error("[TaskBoard/ActivityNotes] Falha ao carregar anotações:", queryError)
      if (!quiet) setError(toUserFacingError(queryError, "Não foi possível carregar as anotações desta atividade."))
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [activity.id, supabase])

  React.useEffect(() => {
    if (!open) return
    void loadNotes()
    const channel = supabase
      .channel(`taskboard-activity-notes-${activity.id}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "activity_notes", filter: `activity_id=eq.${activity.id}` },
        () => { void loadNotes(true) },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [activity.id, loadNotes, open, supabase])

  React.useEffect(() => {
    if (!convertNote) return
    setConvertTitle(convertNote.content)
    setConvertHours("4")
    setConvertAssignee(defaultAssignee)
  }, [convertNote, defaultAssignee])

  async function addNote() {
    const content = draft.trim()
    if (!content || !canManage || savingId) return
    setSavingId("new")
    setError("")
    try {
      const { error: rpcError } = await supabase.rpc("add_activity_note", {
        p_activity_id: activity.id,
        p_content: content,
      })
      if (rpcError) throw rpcError
      setDraft("")
      await Promise.all([loadNotes(true), refreshAll()])
    } catch (rpcError) {
      console.error("[TaskBoard/ActivityNotes] Falha ao adicionar anotação:", rpcError)
      setError(toUserFacingError(rpcError, "Não foi possível adicionar esta anotação."))
    } finally {
      setSavingId(null)
    }
  }

  async function deleteNote(note: ActivityNote) {
    if (!canManage || savingId) return
    setSavingId(note.id)
    setError("")
    try {
      const { error: rpcError } = await supabase.rpc("delete_activity_note", { p_note_id: note.id })
      if (rpcError) throw rpcError
      setNotes((current) => current.filter((item) => item.id !== note.id))
      await refreshAll()
    } catch (rpcError) {
      console.error("[TaskBoard/ActivityNotes] Falha ao excluir anotação:", rpcError)
      setError(toUserFacingError(rpcError, "Não foi possível excluir esta anotação."))
    } finally {
      setSavingId(null)
    }
  }

  async function promoteNote(event: React.FormEvent) {
    event.preventDefault()
    if (!canCreateSubactivity || !convertNote || !convertTitle.trim() || !convertAssignee || savingId) return
    setSavingId(`promote:${convertNote.id}`)
    setError("")
    try {
      const { error: rpcError } = await supabase.rpc("promote_activity_note_to_subactivity", {
        p_note_id: convertNote.id,
        p_title: convertTitle.trim(),
        p_estimated_hours: Math.max(0, Number(convertHours) || 0),
        p_assignee_id: convertAssignee,
      })
      if (rpcError) throw rpcError
      setConvertNote(null)
      await Promise.all([loadNotes(true), refreshAll()])
    } catch (rpcError) {
      console.error("[TaskBoard/ActivityNotes] Falha ao transformar anotação em subatividade:", rpcError)
      setError(toUserFacingError(rpcError, "Não foi possível transformar esta anotação em subatividade."))
    } finally {
      setSavingId(null)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        {!hideTrigger && (
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-xs" : "icon-sm"}
            onClick={() => setOpen(true)}
            className={triggerClassName}
            title="Anotações da atividade"
            aria-label={`Anotações da atividade ${activity.title}`}
          >
            <NotebookPen className="size-3.5" />
          </Button>
        )}
        <DialogContent className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] flex-col overflow-hidden p-0 sm:h-auto sm:max-h-[88dvh] sm:max-w-2xl" showCloseButton>
          <DialogHeader className="border-b border-border px-5 py-5 pr-14 sm:px-6">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <NotebookPen className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-lg leading-snug">Anotações da atividade</DialogTitle>
                <DialogDescription className="mt-1 line-clamp-2 text-xs">{activity.title}</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-6 sm:py-5">
            <div className="rounded-2xl border border-border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Ideias, decisões e lembretes</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Anote livremente. Quando uma ideia virar trabalho, transforme-a em subatividade sem redigitar.</p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-2 py-1 font-mono text-[0.62rem] text-muted-foreground">{notes.length}</span>
              </div>
            </div>

            {canManage && (
              <div className="mt-4 flex items-start gap-2">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault()
                      void addNote()
                    }
                  }}
                  rows={2}
                  maxLength={2000}
                  placeholder="Adicionar uma anotação na atividade..."
                  className="min-h-11 min-w-0 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
                />
                <Button type="button" size="icon" className="mt-0.5 shrink-0" disabled={!draft.trim() || savingId === "new"} onClick={() => void addNote()} title="Adicionar anotação" aria-label="Adicionar anotação">
                  {savingId === "new" ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                </Button>
              </div>
            )}

            {!canManage && (
              <div className="mt-4 rounded-xl border border-border bg-muted/25 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                Você pode consultar as anotações desta atividade, mas não alterá-las.
              </div>
            )}

            {error && <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs font-medium text-destructive">{error}</div>}

            <div className="mt-4">
              {loading ? (
                <div className="flex min-h-44 items-center justify-center text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /></div>
              ) : notes.length === 0 ? (
                <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 text-center">
                  <NotebookPen className="size-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm font-medium">Nenhuma anotação ainda</p>
                  <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">Use este espaço para registrar ideias que ainda não precisam virar uma subatividade.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notes.map((note) => {
                    const author = members.find((member) => member.id === note.createdBy)
                    const convertedSub = note.convertedSubactivityId
                      ? activity.subactivities.find((sub) => sub.id === note.convertedSubactivityId)
                      : undefined
                    const canDelete = canManage && (currentUserRole === "admin" || note.createdBy === currentUserId)
                    const promoting = savingId === `promote:${note.id}`
                    return (
                      <div key={note.id} className={cn("group/note rounded-xl border border-border p-3.5", note.convertedSubactivityId ? "bg-primary/[0.035]" : "bg-card")}> 
                        <div className="flex min-w-0 items-start gap-3">
                          <MemberAvatar member={author} profileEnabled={false} className="mt-0.5 size-7 shrink-0 text-[0.55rem]" />
                          <div className="min-w-0 flex-1">
                            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{note.content}</p>
                            <p className="mt-1.5 text-[0.62rem] text-muted-foreground">{author?.name ?? "Usuário"} · {noteDate(note.createdAt)}</p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                          {note.convertedSubactivityId ? (
                            <div className="flex min-w-0 items-center gap-2 text-[0.68rem] font-medium text-primary">
                              <Sparkles className="size-3.5 shrink-0" />
                              <span className="truncate">Transformada em subatividade</span>
                              {convertedSub && (
                                <Link href={followUpHref({ projectId: project.id, activityId: activity.id, subactivityId: convertedSub.id })} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 hover:bg-primary/10">
                                  Abrir <ArrowUpRight className="size-3" />
                                </Link>
                              )}
                            </div>
                          ) : canManage ? (
                            <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs text-primary" disabled={Boolean(savingId) || !canCreateSubactivity} onClick={() => setConvertNote(note)} title={canCreateSubactivity ? "Transformar em subatividade" : "Sem permissão para adicionar subatividades"}>
                              {promoting ? <LoaderCircle className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" />}
                              Transformar em subatividade
                            </Button>
                          ) : <span />}

                          {canDelete && !note.convertedSubactivityId && (
                            <Button type="button" variant="ghost" size="icon-xs" disabled={Boolean(savingId)} onClick={() => void deleteNote(note)} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Excluir anotação" aria-label="Excluir anotação">
                              {savingId === note.id ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(convertNote)} onOpenChange={(nextOpen) => { if (!nextOpen && !savingId) setConvertNote(null) }}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
          <form onSubmit={promoteNote}>
            <DialogHeader>
              <DialogTitle>Transformar em subatividade</DialogTitle>
              <DialogDescription>A anotação continua no histórico da atividade e passa a apontar para a subatividade criada.</DialogDescription>
            </DialogHeader>
            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium">Título</span>
                <textarea value={convertTitle} onChange={(event) => setConvertTitle(event.target.value)} rows={3} maxLength={1000} className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-ring" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium">Responsável</span>
                  <select value={convertAssignee} onChange={(event) => setConvertAssignee(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring">
                    {executionMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium">Estimativa (horas)</span>
                  <input type="number" min="0" step="0.25" value={convertHours} onChange={(event) => setConvertHours(event.target.value)} className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-ring" />
                </label>
              </div>
              <div className="rounded-xl border border-primary/15 bg-primary/[0.045] px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                A nova subatividade será criada em <strong className="text-foreground">Backlog</strong>. Depois você pode abrir o acompanhamento e ajustar os demais detalhes normalmente.
              </div>
            </div>
            <DialogFooter className="mt-5">
              <Button type="button" variant="outline" onClick={() => setConvertNote(null)} disabled={Boolean(savingId)}>Cancelar</Button>
              <Button type="submit" disabled={!convertTitle.trim() || !convertAssignee || Boolean(savingId)}>
                {savingId?.startsWith("promote:") ? <LoaderCircle className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
                Criar subatividade
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
