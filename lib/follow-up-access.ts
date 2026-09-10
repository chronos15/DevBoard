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

  // Desenvolvedores precisam enxergar a estrutura completa de atividades para
  // poder criar uma subatividade em qualquer atividade. Os canais/subatividades
  // continuam respeitando a participação no acompanhamento, preservando a regra
  // de privacidade do conteúdo já existente.
  if (role === "developer") {
    return projects.map((project) => ({
      ...project,
      activities: project.activities.map((activity) => ({
        ...activity,
        subactivities: activity.subactivities.filter((subactivity) =>
          canAccessFollowUpSubactivity(subactivity, userId, role),
        ),
      })),
    }))
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
