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

export function scopeFollowUpProjects(
  projects: Project[],
  userId: string,
  role?: AccessRole,
): Project[] {
  if (role === "admin") return projects
  if (!userId) return []

  // No Acompanhamento/Modo Resumido, desenvolvedores enxergam toda a estrutura do workspace.
  // A permissão de interação continua sendo decidida no detalhe da subatividade:
  // fora de uma subatividade o DEV entra como observador (somente leitura, com
  // direito a responder/comentar e reagir).
  if (role === "developer") return projects

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
