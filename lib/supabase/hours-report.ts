import type { SupabaseClient } from '@supabase/supabase-js'

export type HoursReportSession = {
  id: string
  subactivityId: string
  userId: string
  projectId: string
  projectName: string
  activityId: string
  activityTitle: string
  subactivityTitle: string
  subactivityStatus: string
  estimatedHours: number
  startedAt: string
  endedAt?: string
  reportedSeconds: number
}

export async function loadHoursReport(
  supabase: SupabaseClient,
  input: {
    start: string
    endExclusive: string
    projectId?: string
    userId?: string
  },
): Promise<HoursReportSession[]> {
  const { data, error } = await supabase.rpc('hours_report', {
    p_start: input.start,
    p_end: input.endExclusive,
    p_project_id: input.projectId || null,
    p_user_id: input.userId || null,
  })

  if (error) throw error

  return (data ?? []).map((row: any) => ({
    id: row.session_id,
    subactivityId: row.subactivity_id,
    userId: row.user_id,
    projectId: row.project_id,
    projectName: row.project_name,
    activityId: row.activity_id,
    activityTitle: row.activity_title,
    subactivityTitle: row.subactivity_title,
    subactivityStatus: row.subactivity_status,
    estimatedHours: Number(row.estimated_hours || 0),
    startedAt: row.started_at,
    endedAt: row.ended_at ?? undefined,
    reportedSeconds: Number(row.reported_seconds || 0),
  }))
}
