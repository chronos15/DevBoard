import type { AccessRole, Project, Subactivity } from "@/lib/types"

export function canAccessFollowUpSubactivity(
  subactivity: Subactivity,
  userId: string,
  role?: AccessRole,
) {
  if (role === "admin") return true
  if (!userId) return false
  return subactivity.assigneeId === userId || Boolean(subactivity.memberIds?.includes(userId))
}

function isProjectRelatedToUser(project: Project, userId: string) {
  if (project.memberIds.includes(userId)) return true

  return project.activities.some((activity) =>
    Boolean(activity.assigneeIds?.includes(userId))
    || activity.subactivities.some((subactivity) =>
      subactivity.assigneeId === userId || Boolean(subactivity.memberIds?.includes(userId)),
    ),
  )
}

export function scopeFollowUpProjects(
  projects: Project[],
  userId: string,
  role?: AccessRole,
): Project[] {
  if (role === "admin") return projects
  if (!userId) return []

  // DEV não deve receber projetos sem qualquer vínculo pessoal. Uma vez
  // integrado ao projeto (membro, responsável de atividade/subatividade ou
  // participante), preservamos a árvore que já veio filtrada pela RLS. Isso
  // permite visualizar atividades sem responsável sem transformar esse tipo de
  // atividade em porta de entrada para projetos de terceiros.
  if (role === "developer") {
    return projects.filter((project) => isProjectRelatedToUser(project, userId))
  }

  return projects.flatMap((project) => {
    const activities = project.activities.flatMap((activity) => {
      const subactivities = activity.subactivities.filter((subactivity) =>
        canAccessFollowUpSubactivity(subactivity, userId, role),
      )
      const activityRelated = Boolean(activity.assigneeIds?.includes(userId)) || subactivities.length > 0
      return activityRelated ? [{ ...activity, subactivities }] : []
    })

    return activities.length > 0 ? [{ ...project, activities }] : []
  })
}

export function scopeMyWorkProjects(
  projects: Project[],
  userId: string,
): Project[] {
  if (!userId) return []

  return projects.flatMap((project) => {
    const activities = project.activities.flatMap((activity) => {
      const activityOwned = Boolean(activity.assigneeIds?.includes(userId))
      const subactivities = activityOwned
        ? activity.subactivities
        : activity.subactivities.filter((subactivity) =>
            subactivity.assigneeId === userId || Boolean(subactivity.memberIds?.includes(userId)),
          )

      return activityOwned || subactivities.length > 0
        ? [{ ...activity, subactivities }]
        : []
    })

    return activities.length > 0 ? [{ ...project, activities }] : []
  })
}
