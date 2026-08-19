"use client"

import { Download } from "lucide-react"
import { useStore } from "@/lib/store"
import { projectEstimated, projectProgress, projectTracked } from "@/lib/project-utils"

export function ExportReportsButton() {
  const { projects } = useStore()

  function exportCsv() {
    const rows = [
      ["Projeto", "Cliente", "Prioridade", "Horas registradas", "Horas estimadas", "Progresso"],
      ...projects.map((project) => [
        project.name,
        project.client,
        project.priority,
        (projectTracked(project) / 3600).toFixed(2),
        (projectEstimated(project) / 3600).toFixed(2),
        `${projectProgress(project)}%`,
      ]),
    ]
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(";"))
      .join("\n")
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `devboard-relatorio-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <button onClick={exportCsv} className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-semibold transition-colors hover:bg-muted">
      <Download className="size-4" />
      Exportar
    </button>
  )
}
