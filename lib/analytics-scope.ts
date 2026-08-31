import type { AccessRole, Member, Project, WorkSession } from "@/lib/types"

function projectBelongsToUser(project: Project, userId: string) {
  if (project.memberIds.includes(userId)) return true
  return project.activities.some(
    (activity) =>
      activity.assigneeIds?.includes(userId) ||
      activity.subactivities.some((subactivity) => subactivity.assigneeId === userId),
  )
}

function scopeProjectToUser(project: Project, userId: string): Project {
  return {
    ...project,
    // No modo pessoal, cards analíticos não exibem integrantes ou tarefas de terceiros.
    memberIds: [userId],
    activities: project.activities
      .map((activity) => {
        const assignedToUser = activity.assigneeIds?.includes(userId) ?? false
        const subactivities = activity.subactivities.filter(
          (subactivity) => subactivity.assigneeId === userId,
        )

        if (!assignedToUser && subactivities.length === 0) return null

        return {
          ...activity,
          assigneeIds: activity.assigneeIds?.filter((id) => id === userId),
          subactivities,
        }
      })
      .filter((activity): activity is Project["activities"][number] => Boolean(activity)),
  }
}

export function scopeProjectsForAnalytics(
  projects: Project[],
  currentUserId: string | undefined,
  currentUserRole: AccessRole,
) {
  if (currentUserRole === "admin") return projects
  if (!currentUserId) return []

  return projects
    .filter((project) => projectBelongsToUser(project, currentUserId))
    .map((project) => scopeProjectToUser(project, currentUserId))
}

export function scopeWorkSessionsForAnalytics(
  workSessions: WorkSession[],
  currentUserId: string | undefined,
  currentUserRole: AccessRole,
) {
  if (currentUserRole === "admin") return workSessions
  if (!currentUserId) return []
  return workSessions.filter((session) => session.userId === currentUserId)
}

export function scopeMembersForAnalytics(
  members: Member[],
  currentUserId: string | undefined,
  currentUserRole: AccessRole,
) {
  if (currentUserRole === "admin") return members
  if (!currentUserId) return []
  return members.filter((member) => member.id === currentUserId)
}
