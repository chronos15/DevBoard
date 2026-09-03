import type { AccessRole, ServiceRequest, ServiceRequestAttachmentCategory, ServiceRequestStatus, ServiceRequestType } from "@/lib/types"

export const SERVICE_REQUEST_TYPE_LABELS: Record<ServiceRequestType, string> = {
  failure: "Falha",
  development: "Desenvolvimento",
  adjustment: "Ajuste",
  improvement: "Melhoria",
  "structured-triage": "Triagem Estruturada (DEV)",
}

export const SERVICE_REQUEST_STATUS_LABELS: Record<ServiceRequestStatus, string> = {
  received: "Recebida",
  "aqs-analysis": "Em análise AQS",
  "waiting-info": "Aguardando informações",
  "waiting-dev": "Aguardando DEV",
  "waiting-executor": "Aguardando executor",
  "in-dev": "Em execução DEV",
  "waiting-aqs": "Aguardando AQS",
  rework: "Reavaliar DEV",
  "waiting-build": "Aguardando versão",
  completed: "Concluída",
  rejected: "Recusada",
  cancelled: "Cancelada",
}

export const SERVICE_REQUEST_ATTACHMENT_LABELS: Record<ServiceRequestAttachmentCategory, string> = {
  "order-pdf": "Ordem de serviço (PDF)",
  "analysis-video": "Vídeo / evidência da análise",
  database: "Banco de dados atualizado",
  certificate: "Certificado digital",
  other: "Outro arquivo",
}

export const SERVICE_REQUEST_FINAL_STATUSES = new Set<ServiceRequestStatus>(["completed", "rejected", "cancelled"])
export const SERVICE_REQUEST_AQS_STATUSES = new Set<ServiceRequestStatus>(["received", "aqs-analysis", "waiting-info", "waiting-aqs", "waiting-build"])
export const SERVICE_REQUEST_DEV_STATUSES = new Set<ServiceRequestStatus>(["waiting-dev", "waiting-executor", "in-dev", "rework"])

export type ServiceRequestScope = "inbox" | "mine" | "aqs" | "dev" | "completed"

export function serviceRequestStatusTone(status: ServiceRequestStatus) {
  if (status === "completed") return "border-success/25 bg-success/10 text-success"
  if (status === "rejected" || status === "cancelled") return "border-destructive/25 bg-destructive/10 text-destructive"
  if (status === "waiting-aqs" || status === "waiting-build") return "border-chart-3/25 bg-chart-3/10 text-chart-3"
  if (status === "in-dev" || status === "rework") return "border-primary/25 bg-primary/10 text-primary"
  if (status === "waiting-info") return "border-warning/25 bg-warning/10 text-warning"
  return "border-border bg-muted/70 text-foreground"
}

export function serviceRequestTypeTone(type: ServiceRequestType) {
  if (type === "failure") return "border-destructive/20 bg-destructive/8 text-destructive"
  if (type === "development") return "border-primary/20 bg-primary/8 text-primary"
  if (type === "structured-triage") return "border-chart-4/20 bg-chart-4/10 text-chart-4"
  if (type === "improvement") return "border-success/20 bg-success/8 text-success"
  return "border-border bg-muted/60 text-muted-foreground"
}

export function serviceRequestMatchesScope(
  request: ServiceRequest,
  scope: ServiceRequestScope,
  currentUserId: string,
  role: AccessRole,
) {
  if (scope === "mine") return request.createdBy === currentUserId
  if (scope === "completed") return SERVICE_REQUEST_FINAL_STATUSES.has(request.status)
  if (scope === "aqs") return role === "admin" || role === "aqs" ? SERVICE_REQUEST_AQS_STATUSES.has(request.status) : false
  if (scope === "dev") return role === "admin" || role === "developer" ? SERVICE_REQUEST_DEV_STATUSES.has(request.status) : false

  if (SERVICE_REQUEST_FINAL_STATUSES.has(request.status)) return false
  if (role === "admin") return true
  if (role === "aqs") return SERVICE_REQUEST_AQS_STATUSES.has(request.status)
  if (role === "developer") return SERVICE_REQUEST_DEV_STATUSES.has(request.status) || request.responsibleDevId === currentUserId || request.executorId === currentUserId
  return request.createdBy === currentUserId
}

export function serviceRequestScopeTitle(scope: ServiceRequestScope) {
  if (scope === "mine") return { eyebrow: "Solicitações", title: "Minhas solicitações", subtitle: "Acompanhe as solicitações abertas por você e todo o histórico do protocolo." }
  if (scope === "aqs") return { eyebrow: "Solicitações", title: "Fila AQS", subtitle: "Triagem, análise, retorno do desenvolvimento e validação final em uma única fila." }
  if (scope === "dev") return { eyebrow: "Solicitações", title: "Fila DEV", subtitle: "Solicitações liberadas pelo AQS para designação, execução e reavaliação." }
  if (scope === "completed") return { eyebrow: "Solicitações", title: "Concluídas", subtitle: "Histórico encerrado de solicitações, recusas e cancelamentos do processo." }
  return { eyebrow: "Solicitações", title: "Caixa de entrada", subtitle: "Centralize o protocolo entre solicitante, AQS e DEV sem depender do Discord." }
}
