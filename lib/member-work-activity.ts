import type { Project, Status, Subactivity } from "@/lib/types"

export type MemberWorkRef = {
  project: Project
  activityId: string
  activityTitle: string
  subactivity: Subactivity
}

export type WorkMovementKind = "comment" | "attachment" | "updated" | "created"

export type WorkMovement = {
  at: number
  kind: WorkMovementKind
  label: string
}

// O painel Equipe deve representar trabalho realmente movimentado.
// Backlog fica fora porque é usado como caixa de lembranças/planejamento futuro.
// Canceladas também ficam fora para não competir com trabalho operacional recente.
export const MEMBER_MOVEMENT_STATUSES = new Set<Status>([
  "waiting",
  "waiting-aqs",
  "in-progress",
  "paused",
  "done",
])

export function workForMember(projects: Project[], memberId: string) {
  const work: MemberWorkRef[] = []
  for (const project of projects) {
    for (const activity of project.activities) {
      for (const subactivity of activity.subactivities) {
        if (!MEMBER_MOVEMENT_STATUSES.has(subactivity.status)) continue
        // Responsabilidade real: menções/comentários não transformam a tarefa
        // em responsabilidade de quem participou do acompanhamento.
        if (subactivity.assigneeId !== memberId) continue
        work.push({ project, activityId: activity.id, activityTitle: activity.title, subactivity })
      }
    }
  }
  return work
}

export function workLastMovement(item: MemberWorkRef): WorkMovement {
  const movements: WorkMovement[] = []
  const push = (value: string | undefined, kind: WorkMovementKind, label: string) => {
    if (!value) return
    const timestamp = new Date(value).getTime()
    if (Number.isFinite(timestamp)) movements.push({ at: timestamp, kind, label })
  }

  push(item.subactivity.createdAt, "created", "Criada")
  push(item.subactivity.updatedAt, "updated", "Atualizada")
  for (const comment of item.subactivity.comments ?? []) push(comment.createdAt, "comment", "Comentada")
  for (const attachment of item.subactivity.attachments ?? []) {
    push(attachment.createdAt, "attachment", "Arquivo enviado")
    push(attachment.statusChangedAt, "attachment", "Arquivo atualizado")
  }

  return movements.sort((a, b) => b.at - a.at)[0] ?? { at: 0, kind: "created", label: "Criada" }
}

export function workLastChangedAt(item: MemberWorkRef) {
  return workLastMovement(item).at
}

export function recentWork(items: MemberWorkRef[], limit = 3) {
  return [...items]
    .sort((a, b) => workLastChangedAt(b) - workLastChangedAt(a))
    .slice(0, limit)
}
