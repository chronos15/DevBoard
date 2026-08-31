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
