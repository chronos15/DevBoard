"use client"

import * as React from "react"
import { AlertTriangle, GitBranch, LoaderCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getDeveloperVcsStatus, developerVcsProviderLabel, type DeveloperVcsStatus } from "@/lib/developer/vcs"
import { cn } from "@/lib/utils"

export function DeveloperVcsCompletionWarning({
  projectId,
  enabled,
}: {
  projectId?: string
  enabled: boolean
}) {
  const supabase = React.useMemo(() => createClient(), [])
  const [status, setStatus] = React.useState<DeveloperVcsStatus | null>(null)
  const [localProjectName, setLocalProjectName] = React.useState("")
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!enabled || !projectId) return
    let alive = true
    setLoading(true)
    ;(async () => {
      let { data: localProject } = await supabase
        .from("developer_local_projects")
        .select("id,name,folder_name,ide_id,legacy_path,devboard_project_id")
        .eq("devboard_project_id", projectId)
        .limit(1)
        .maybeSingle()

      if (!localProject) {
        const { data: context } = await supabase
          .from("developer_contexts")
          .select("local_project_id")
          .eq("devboard_project_id", projectId)
          .not("local_project_id", "is", null)
          .limit(1)
          .maybeSingle()
        if (!alive || !context?.local_project_id) return
        const fallback = await supabase
          .from("developer_local_projects")
          .select("id,name,folder_name,ide_id,legacy_path,devboard_project_id")
          .eq("id", context.local_project_id)
          .maybeSingle()
        localProject = fallback.data
      }
      if (!alive || !localProject) return

      setLocalProjectName(String(localProject.name || localProject.folder_name || "Projeto local"))
      try {
        const next = await getDeveloperVcsStatus({
          id: String(localProject.id),
          name: String(localProject.name || localProject.folder_name || "Projeto local"),
          folderName: String(localProject.folder_name ?? ""),
          ideId: localProject.ide_id ? String(localProject.ide_id) : null,
          legacyPath: String(localProject.legacy_path ?? ""),
        })
        if (alive) setStatus(next)
      } catch {
        // O aviso é complementar. Se o Agent não estiver disponível, não interfere na mudança de status.
      }
    })().finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [enabled, projectId, supabase])

  if (!enabled || (!loading && (!status || status.provider === "none"))) return null

  if (loading && !status) {
    return <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/35 px-3 py-2.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Verificando alterações locais...</div>
  }

  if (!status) return null

  if (status.provider === "svn" && !status.directStatus) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/35 px-3 py-2.5 text-xs text-muted-foreground">
        <GitBranch className="mt-0.5 size-3.5 shrink-0" />
        <span><span className="font-medium text-foreground">{localProjectName}</span> usa SVN via TortoiseSVN. O Agent não encontrou <code className="font-mono">svn.exe</code> para validar alterações pendentes dentro do Devboard.</span>
      </div>
    )
  }

  if (status.changedCount <= 0) return null

  return (
    <div className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-xs", status.conflicted > 0 ? "border-destructive/25 bg-destructive/5" : "border-warning/25 bg-warning/5")}>
      <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", status.conflicted > 0 ? "text-destructive" : "text-warning")} />
      <div className="min-w-0">
        <p className="font-medium text-foreground">{localProjectName} ainda possui {status.changedCount} alteraç{status.changedCount === 1 ? "ão" : "ões"} local{status.changedCount === 1 ? "" : "is"}.</p>
        <p className="mt-0.5 text-muted-foreground">{developerVcsProviderLabel(status.provider)}{status.branch ? ` · ${status.branch}` : status.revision ? ` · ${status.revision}` : ""}{status.conflicted > 0 ? ` · ${status.conflicted} conflito${status.conflicted === 1 ? "" : "s"}` : ""}. Você pode continuar, mas vale revisar/commitar no Painel Dev.</p>
      </div>
    </div>
  )
}
