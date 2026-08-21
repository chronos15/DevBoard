"use client"

import * as React from "react"
import { AlertTriangle, PackageCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useStore } from "@/lib/store"
import { projectHasPendingWork } from "@/lib/project-utils"
import type { Project } from "@/lib/types"
import { DeveloperVcsVersionSummary } from "@/components/developer/developer-vcs-version-summary"

export function VersionProjectDialog({ project }: { project: Project }) {
  const { versionProject } = useStore()
  const [open, setOpen] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [version, setVersion] = React.useState(project.version ?? "1.0.0")
  const [build, setBuild] = React.useState(project.build ?? "")
  const [saving, setSaving] = React.useState(false)

  const hasPending = projectHasPendingWork(project)
  const pendingActivities = project.activities.filter((activity) => {
    if (activity.subactivities.length === 0) return true
    return activity.subactivities.some(
      (sub) => sub.status !== "done" && sub.status !== "cancelled",
    )
  }).length
  const pendingSubactivities = project.activities
    .flatMap((activity) => activity.subactivities)
    .filter((sub) => sub.status !== "done" && sub.status !== "cancelled").length

  React.useEffect(() => {
    if (!open) return
    setVersion(project.version ?? "1.0.0")
    setBuild(project.build ?? "")
    setConfirming(false)
  }, [open, project.version, project.build])

  async function finishVersioning(allowPending = false) {
    if (!version.trim() || !build.trim() || saving) return
    setSaving(true)
    try {
      const ok = await versionProject(project.id, {
        version: version.trim(),
        build: build.trim(),
        allowPending,
      })
      if (!ok) return
      setConfirming(false)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!version.trim() || !build.trim()) return
    if (hasPending) {
      setConfirming(true)
      return
    }
    await finishVersioning()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        <PackageCheck className="size-3.5" />
        Versionar
      </button>

      <DialogContent className="sm:max-w-md">
        {confirming ? (
          <>
            <DialogHeader>
              <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-5" />
              </div>
              <DialogTitle>Confirmar versionamento</DialogTitle>
              <DialogDescription className="leading-relaxed">
                Tem certeza que deseja versionar? Algumas atividades e subatividades não estão finalizadas.
              </DialogDescription>
            </DialogHeader>

            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-3">
                <span>Atividades com pendências</span>
                <strong className="font-mono text-foreground">{pendingActivities}</strong>
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span>Subatividades não finalizadas</span>
                <strong className="font-mono text-foreground">{pendingSubactivities}</strong>
              </div>
              <div className="mt-3 border-t border-amber-500/15 pt-3">
                Será registrada a versão <strong className="font-mono text-foreground">v{version}</strong> · build <strong className="font-mono text-foreground">{build}</strong>.
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                Voltar
              </Button>
              <Button type="button" onClick={() => { void finishVersioning(true) }} loading={saving} loadingText="Versionando...">
                Versionar mesmo assim
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Versionar projeto</DialogTitle>
              <DialogDescription>
                Informe a versão e o build. O registro será adicionado ao histórico do projeto.
              </DialogDescription>
            </DialogHeader>

            <form id="version-project-form" onSubmit={submit} className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Versão</span>
                <input
                  autoFocus
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  placeholder="1.0.0"
                  className="h-10 rounded-xl border border-border bg-background px-3 font-mono text-sm outline-none focus:border-ring"
                  required
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">Build</span>
                <input
                  value={build}
                  onChange={(e) => setBuild(e.target.value)}
                  placeholder="100"
                  className="h-10 rounded-xl border border-border bg-background px-3 font-mono text-sm outline-none focus:border-ring"
                  required
                />
              </label>
              <DeveloperVcsVersionSummary project={project} active={open && !confirming} />
            </form>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" form="version-project-form" loading={saving} loadingText="Registrando...">
                Registrar versão
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
