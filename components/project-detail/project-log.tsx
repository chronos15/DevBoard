"use client"

import * as React from "react"
import {
  CalendarDays,
  Clock3,
  FileDown,
  GitCommitHorizontal,
  History,
  MessageSquare,
  Paperclip,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
} from "lucide-react"
import type { Project, ProjectLogEntry, ProjectLogType } from "@/lib/types"
import { useStore } from "@/lib/store"
import { MemberAvatar } from "@/components/member-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const iconByType: Record<ProjectLogType, typeof History> = {
  created: Plus,
  updated: Pencil,
  versioned: PackageCheck,
  "activity-added": Plus,
  "activity-deleted": Trash2,
  "subactivity-added": Plus,
  "subactivity-status": GitCommitHorizontal,
  "comment-added": MessageSquare,
  "attachment-added": Paperclip,
  "attachment-status": Paperclip,
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function formatLogDate(isoDate: string) {
  const date = new Date(isoDate)
  return {
    date: date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  }
}

function inDateRange(log: ProjectLogEntry, startDate: string, endDate: string) {
  const timestamp = new Date(log.createdAt).getTime()
  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`).getTime()
    if (timestamp < start) return false
  }
  if (endDate) {
    const end = new Date(`${endDate}T23:59:59.999`).getTime()
    if (timestamp > end) return false
  }
  return true
}

export function ProjectLogDialog({ project }: { project: Project }) {
  const { members } = useStore()
  const [open, setOpen] = React.useState(false)
  const [startDate, setStartDate] = React.useState("")
  const [endDate, setEndDate] = React.useState("")
  const logs = project.logs ?? []

  const filteredLogs = React.useMemo(
    () => logs.filter((log) => inDateRange(log, startDate, endDate)),
    [logs, startDate, endDate],
  )

  function clearFilters() {
    setStartDate("")
    setEndDate("")
  }

  function emitPdf() {
    const reportWindow = window.open("", "_blank", "width=1100,height=800")
    if (!reportWindow) {
      window.alert("Não foi possível abrir o relatório. Verifique se o navegador está bloqueando pop-ups.")
      return
    }
    reportWindow.opener = null

    const periodLabel = startDate || endDate
      ? `${startDate ? new Date(`${startDate}T00:00:00`).toLocaleDateString("pt-BR") : "Início"} até ${endDate ? new Date(`${endDate}T00:00:00`).toLocaleDateString("pt-BR") : "Hoje"}`
      : "Todos os registros"

    const rows = filteredLogs
      .map((log) => {
        const actor = members.find((member) => member.id === log.actorId)
        const formatted = formatLogDate(log.createdAt)
        return `
          <tr>
            <td>${escapeHtml(formatted.date)}<br><span>${escapeHtml(formatted.time)}</span></td>
            <td>${escapeHtml(actor?.name ?? "Usuário não identificado")}</td>
            <td><strong>${escapeHtml(log.title)}</strong>${log.description ? `<br><span>${escapeHtml(log.description)}</span>` : ""}</td>
          </tr>
        `
      })
      .join("")

    reportWindow.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Log do projeto - ${escapeHtml(project.name)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #262522; font-family: Arial, Helvetica, sans-serif; font-size: 11px; }
    header { border-bottom: 2px solid #262522; padding-bottom: 12px; margin-bottom: 18px; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; }
    .meta { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 8px; color: #666; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 7px; border-bottom: 1px solid #aaa; font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: #666; }
    td { vertical-align: top; padding: 9px 7px; border-bottom: 1px solid #ddd; line-height: 1.4; }
    td:first-child { width: 90px; font-family: monospace; }
    td:nth-child(2) { width: 145px; }
    td span { color: #666; }
    .empty { padding: 28px 0; text-align: center; color: #777; }
    footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #ddd; color: #777; font-size: 9px; }
  </style>
</head>
<body>
  <header>
    <h1>Log do projeto · ${escapeHtml(project.name)}</h1>
    <div class="meta">
      <span>Período: ${escapeHtml(periodLabel)}</span>
      <span>Registros: ${filteredLogs.length}</span>
      <span>Emitido em: ${escapeHtml(new Date().toLocaleString("pt-BR"))}</span>
    </div>
  </header>
  ${filteredLogs.length > 0 ? `
    <table>
      <thead><tr><th>Data</th><th>Usuário</th><th>Alteração</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  ` : '<div class="empty">Nenhum registro encontrado para o período informado.</div>'}
  <footer>Relatório de auditoria do projeto · Devboard</footer>
  <script>window.addEventListener('load', () => setTimeout(() => { window.focus(); window.print(); }, 150));<\/script>
</body>
</html>`)
    reportWindow.document.close()
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-muted"
      >
        <History className="size-3.5" />
        Logs
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="grid max-h-[90dvh] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="border-b border-border px-4 py-4 pr-12 sm:px-5">
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <History className="size-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle>Log do projeto</DialogTitle>
                <DialogDescription className="mt-1">
                  Histórico de alterações, comentários, arquivos, responsáveis e versionamentos de {project.name}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="border-b border-border bg-muted/25 px-4 py-3 sm:px-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="min-w-0">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground">
                    <CalendarDays className="size-3.5" />
                    Data inicial
                  </span>
                  <Input
                    type="date"
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="h-9 bg-background"
                  />
                </label>
                <label className="min-w-0">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[0.68rem] font-medium text-muted-foreground">
                    <CalendarDays className="size-3.5" />
                    Data final
                  </span>
                  <Input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="h-9 bg-background"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
                <span className="mr-1 text-center font-mono text-[0.68rem] text-muted-foreground sm:text-left">
                  {filteredLogs.length} de {logs.length} registros
                </span>
                {(startDate || endDate) && (
                  <Button type="button" variant="outline" size="lg" onClick={clearFilters} className="gap-1.5">
                    <RotateCcw className="size-3.5" />
                    Limpar filtro
                  </Button>
                )}
                <Button type="button" size="lg" onClick={emitPdf} className="gap-1.5">
                  <FileDown className="size-3.5" />
                  Emitir PDF
                </Button>
              </div>
            </div>
          </div>

          <div className="min-h-0 overflow-y-auto px-4 py-1 sm:px-5">
            {filteredLogs.length === 0 ? (
              <div className="my-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-xs text-muted-foreground">
                {logs.length === 0
                  ? "As próximas alterações deste projeto aparecerão aqui."
                  : "Nenhum registro encontrado no período selecionado."}
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {filteredLogs.map((log) => {
                  const Icon = iconByType[log.type] ?? History
                  const actor = members.find((member) => member.id === log.actorId)
                  const formatted = formatLogDate(log.createdAt)

                  return (
                    <article key={log.id} className="flex gap-3 py-3.5">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <Icon className="size-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{log.title}</p>
                            {log.description && (
                              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{log.description}</p>
                            )}
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-[0.68rem] text-muted-foreground md:justify-end">
                            <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                              {actor ? (
                                <MemberAvatar member={actor} className="size-5 text-[0.48rem] ring-1" />
                              ) : (
                                <span className="flex size-5 items-center justify-center rounded-full bg-muted ring-1 ring-border">
                                  <UserRound className="size-3" />
                                </span>
                              )}
                              {actor?.name ?? "Usuário não identificado"}
                            </span>
                            <span className="flex items-center gap-1 font-mono">
                              <Clock3 className="size-3" />
                              {formatted.date} {formatted.time}
                            </span>
                          </div>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
