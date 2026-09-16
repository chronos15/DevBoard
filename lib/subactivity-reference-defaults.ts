import type { Activity, Subactivity } from "@/lib/types"

function createdAtTime(subactivity: Subactivity) {
  if (!subactivity.createdAt) return Number.NEGATIVE_INFINITY
  const parsed = new Date(subactivity.createdAt).getTime()
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

export function getSubactivityReferenceDefaults(activity?: Activity) {
  if (!activity) return { linkedOs: "", build: "", inheritedFrom: null as "subactivity" | "activity" | null }

  let latestSubactivity: Subactivity | undefined
  let latestTime = Number.NEGATIVE_INFINITY

  activity.subactivities.forEach((subactivity, index) => {
    const time = createdAtTime(subactivity)
    if (time > latestTime || (time === latestTime && index === activity.subactivities.length - 1)) {
      latestTime = time
      latestSubactivity = subactivity
    }
  })

  if (!latestSubactivity && activity.subactivities.length > 0) {
    latestSubactivity = activity.subactivities[activity.subactivities.length - 1]
  }

  const latestLinkedOs = latestSubactivity?.linkedOs?.trim() ?? ""
  const latestBuild = latestSubactivity?.build?.trim() ?? ""
  const activityLinkedOs = activity.linkedOs?.trim() ?? ""
  const activityBuild = activity.build?.trim() ?? ""

  const linkedOs = latestLinkedOs || activityLinkedOs
  const build = latestBuild || activityBuild
  const inheritedFrom = latestLinkedOs || latestBuild
    ? "subactivity"
    : activityLinkedOs || activityBuild
      ? "activity"
      : null

  return { linkedOs, build, inheritedFrom }
}
