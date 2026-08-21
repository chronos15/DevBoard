"use client"

import type { Status } from "@/lib/types"
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

const isTerminalStatus = (status: Status) => status === "done" || status === "cancelled"

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
  onConfirm: () => void
  loading?: boolean
  projectId?: string
}) {
  const enteringTerminal = isTerminalStatus(toStatus)
  const leavingTerminal = isTerminalStatus(fromStatus) && fromStatus !== toStatus
  const isCancelling = toStatus === "cancelled"
  const sendingToAqs = toStatus === "waiting-aqs"

  let title = "Confirmar alteração de status?"
  let description = `A subatividade “${subactivityTitle}” será alterada de ${statusMeta[fromStatus].label} para ${statusMeta[toStatus].label}.`
  let confirmLabel = "Confirmar alteração"

  if (enteringTerminal) {
    title = isCancelling ? "Cancelar subatividade?" : "Concluir subatividade?"
    confirmLabel = isCancelling ? "Sim, cancelar" : "Sim, concluir"
    description = isAdmin
      ? `A subatividade “${subactivityTitle}” ficará com status final ${statusMeta[toStatus].label}. Como administrador, você poderá alterá-la depois, mas qualquer nova mudança também exigirá confirmação.`
      : `A subatividade “${subactivityTitle}” ficará com status final ${statusMeta[toStatus].label}. Depois de confirmar, você não poderá mudar o status novamente. Somente um administrador poderá reabrir ou alterar esta subatividade.`
  } else if (sendingToAqs) {
    title = "Enviar subatividade para AQS?"
    confirmLabel = "Sim, enviar para AQS"
    description = `A subatividade “${subactivityTitle}” será enviada para análise AQS. Antes de continuar, confira se as alterações locais relacionadas já foram commitadas.`
  } else if (leavingTerminal && isAdmin) {
    title = "Alterar status final?"
    confirmLabel = "Sim, alterar status"
    description = `A subatividade “${subactivityTitle}” está ${statusMeta[fromStatus].label}. Como administrador, você pode sobrescrever esse estado final e movê-la para ${statusMeta[toStatus].label}. Deseja continuar?`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <DeveloperVcsCompletionWarning projectId={projectId} enabled={enteringTerminal || sendingToAqs} />

        {(enteringTerminal || leavingTerminal) && (
          <div className="rounded-xl border border-border bg-muted/45 px-3 py-2.5 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Regra de segurança:</span>{" "}
            status concluído ou cancelado é terminal para usuários não administradores. Administradores podem alterá-lo somente após nova confirmação.
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Voltar
          </Button>
          <Button
            type="button"
            variant={isCancelling ? "destructive" : "default"}
            onClick={onConfirm}
            loading={loading}
            loadingText="Salvando..."
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
