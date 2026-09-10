"use client"

import * as React from "react"
import { AlertTriangle, FileArchive, FolderOpen, GitBranch, X } from "lucide-react"
import type { Status, SubactivityReleaseDraft } from "@/lib/types"
import { statusMeta } from "@/lib/project-utils"
import { Button } from "@/components/ui/button"
import { DeveloperVcsCompletionWarning } from "@/components/developer/developer-vcs-completion-warning"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

const MAX_RELEASE_ZIP_BYTES = 50 * 1024 * 1024
const isTerminalStatus = (status: Status) => status === "done" || status === "cancelled"

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`
}

export function SubactivityStatusConfirmDialog({
  open,
  onOpenChange,
  subactivityTitle,
  fromStatus,
  toStatus,
  isAdmin,
  onConfirm,
  loading = false,
  projectId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  subactivityTitle: string
  fromStatus: Status
  toStatus: Status
  isAdmin: boolean
  onConfirm: (release: SubactivityReleaseDraft) => void
  loading?: boolean
  projectId?: string
}) {
  const [folderPath, setFolderPath] = React.useState("")
  const [version, setVersion] = React.useState("")
  const [build, setBuild] = React.useState("")
  const [zipFile, setZipFile] = React.useState<File | undefined>()
  const [fileError, setFileError] = React.useState("")
  const fileRef = React.useRef<HTMLInputElement>(null)

  const enteringTerminal = isTerminalStatus(toStatus)
  const leavingTerminal = isTerminalStatus(fromStatus) && fromStatus !== toStatus
  const isCancelling = toStatus === "cancelled"
  const sendingToAqs = toStatus === "waiting-aqs"
  const captureRelease = sendingToAqs || (toStatus === "done" && fromStatus !== "done")
  const hasReleaseInfo = Boolean(folderPath.trim() || version.trim() || build.trim() || zipFile)

  let title = "Confirmar alteração de status?"
  let description = `A subatividade “${subactivityTitle}” será alterada de ${statusMeta[fromStatus].label} para ${statusMeta[toStatus].label}.`
  let confirmLabel = "Confirmar alteração"

  if (enteringTerminal) {
    title = isCancelling ? "Cancelar subatividade?" : "Concluir subatividade?"
    confirmLabel = isCancelling ? "Sim, cancelar" : "Concluir subatividade"
    description = isAdmin
      ? `A subatividade “${subactivityTitle}” ficará com status final ${statusMeta[toStatus].label}. Como administrador, você poderá alterá-la depois, mas qualquer nova mudança também exigirá confirmação.`
      : `A subatividade “${subactivityTitle}” ficará com status final ${statusMeta[toStatus].label}. Depois de confirmar, você não poderá mudar o status novamente. Somente um administrador poderá reabrir ou alterar esta subatividade.`
  } else if (sendingToAqs) {
    title = "Enviar subatividade para AQS?"
    confirmLabel = "Enviar para AQS"
    description = `A subatividade “${subactivityTitle}” será enviada para análise AQS. Você pode registrar abaixo onde está a versão entregue, o número da versão/build ou anexar o ZIP.`
  } else if (leavingTerminal && isAdmin) {
    title = "Alterar status final?"
    confirmLabel = "Sim, alterar status"
    description = `A subatividade “${subactivityTitle}” está ${statusMeta[fromStatus].label}. Como administrador, você pode sobrescrever esse estado final e movê-la para ${statusMeta[toStatus].label}. Deseja continuar?`
  }

  function pickZip(file?: File) {
    setFileError("")
    if (!file) {
      setZipFile(undefined)
      return
    }
    if (!file.name.toLocaleLowerCase("pt-BR").endsWith(".zip")) {
      setFileError("Selecione um arquivo compactado no formato .zip.")
      if (fileRef.current) fileRef.current.value = ""
      return
    }
    if (file.size <= 0 || file.size > MAX_RELEASE_ZIP_BYTES) {
      setFileError("O arquivo ZIP deve ter até 50 MB.")
      if (fileRef.current) fileRef.current.value = ""
      return
    }
    setZipFile(file)
  }

  function confirm() {
    if (fileError || loading) return
    onConfirm({
      folderPath: folderPath.trim() || undefined,
      version: version.trim() || undefined,
      build: build.trim() || undefined,
      zipName: zipFile?.name,
      zipFile,
    })
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !loading && onOpenChange(value)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DeveloperVcsCompletionWarning projectId={projectId} enabled={enteringTerminal || sendingToAqs} />

        {captureRelease && (
          <section className="rounded-2xl border border-border bg-muted/15 p-3.5 sm:p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <GitBranch className="size-4 shrink-0 text-primary" />
                  <p className="text-xs font-semibold">Entrega da versão</p>
                </div>
                <p className="mt-1 text-[0.65rem] leading-relaxed text-muted-foreground">Nenhum campo é obrigatório. Preencha somente o que fizer sentido para esta entrega.</p>
              </div>
              <span className="shrink-0 rounded-full border border-border bg-background px-2 py-1 text-[0.58rem] font-medium text-muted-foreground">Opcional</span>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="min-w-0 space-y-1.5">
                <span className="block text-[0.65rem] font-medium text-muted-foreground">Número da versão</span>
                <input
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  maxLength={120}
                  placeholder="Ex: 7.4.12"
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
                />
              </label>
              <label className="min-w-0 space-y-1.5">
                <span className="block text-[0.65rem] font-medium text-muted-foreground">Build</span>
                <input
                  value={build}
                  onChange={(event) => setBuild(event.target.value)}
                  maxLength={120}
                  placeholder="Ex: 2026.09.10.1842"
                  className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-ring"
                />
              </label>
            </div>

            <label className="mt-3 block min-w-0 space-y-1.5">
              <span className="flex items-center gap-1.5 text-[0.65rem] font-medium text-muted-foreground"><FolderOpen className="size-3.5" /> Caminho da pasta da versão</span>
              <input
                value={folderPath}
                onChange={(event) => setFolderPath(event.target.value)}
                maxLength={1000}
                placeholder={String.raw`Ex: \\servidor\versoes\TaskBoard\7.4.12`}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 font-mono text-xs outline-none transition-colors placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-ring"
              />
            </label>

            <div className="my-3 flex items-center gap-2" aria-hidden="true">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[0.58rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">ou anexe o pacote</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={(event) => pickZip(event.target.files?.[0])}
            />

            {zipFile ? (
              <div className="flex min-w-0 items-center gap-3 rounded-xl border border-primary/20 bg-primary/[0.04] p-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileArchive className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{zipFile.name}</span>
                  <span className="mt-0.5 block text-[0.6rem] text-muted-foreground">{formatFileSize(zipFile.size)} · será anexado à subatividade</span>
                </span>
                <button type="button" disabled={loading} onClick={() => { setZipFile(undefined); if (fileRef.current) fileRef.current.value = "" }} className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive" title="Remover ZIP" aria-label="Remover ZIP"><X className="size-3.5" /></button>
              </div>
            ) : (
              <button type="button" disabled={loading} onClick={() => fileRef.current?.click()} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-background px-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.03] hover:text-primary">
                <FileArchive className="size-4" /> Selecionar arquivo ZIP <span className="font-normal opacity-70">· até 50 MB</span>
              </button>
            )}

            {fileError && <p className="mt-2 text-[0.62rem] font-medium text-destructive">{fileError}</p>}

            {!hasReleaseInfo && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning/20 bg-warning/[0.05] px-3 py-2.5 text-[0.65rem] leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span><strong className="font-semibold text-foreground">Nenhuma informação preenchida.</strong> Você pode continuar normalmente; o histórico registrará que a etapa foi avançada sem pasta, versão, build ou ZIP informado.</span>
              </div>
            )}
          </section>
        )}

        {(enteringTerminal || leavingTerminal) && (
          <div className="rounded-xl border border-border bg-muted/45 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Regra de segurança:</span>{" "}
            status concluído ou cancelado é terminal para usuários não administradores. Administradores podem alterá-lo somente após nova confirmação.
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            type="button"
            variant={isCancelling ? "destructive" : "default"}
            onClick={confirm}
            disabled={Boolean(fileError)}
            loading={loading}
            loadingText={sendingToAqs ? "Enviando..." : "Salvando..."}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
