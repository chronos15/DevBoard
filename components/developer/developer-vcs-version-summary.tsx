"use client"

import * as React from "react"
import { GitBranch, GitCommitHorizontal } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Project } from "@/lib/types"

export function DeveloperVcsVersionSummary({ project, active }: { project: Project; active: boolean }) {
  const supabase = React.useMemo(() => createClient(), [])
  const [rows, setRows] = React.useState<Array<{ id: string; provider: string; revision: string; branch: string; message: string; committed_at: string }>>([])
  const [schemaReady, setSchemaReady] = React.useState(true)

  React.useEffect(() => {
    if (!active) return
    let alive = true
    const latestVersionAt = (project.versions ?? [])
      .map((item) => item.createdAt)
      .filter(Boolean)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null
    let query = supabase
      .from("developer_vcs_changes")
      .select("id,provider,revision,branch,message,committed_at")
      .eq("devboard_project_id", project.id)
      .order("committed_at", { ascending: false })
      .limit(20)
    if (latestVersionAt) query = query.gt("committed_at", latestVersionAt)
    void query.then(({ data, error }) => {
      if (!alive) return
      if (error) {
        setSchemaReady(!/developer_vcs_changes|does not exist|schema cache/i.test(error.message ?? ""))
        return
      }
      setRows((data ?? []) as typeof rows)
    })
    return () => { alive = false }
  }, [active, project.id, project.versions, supabase])

  if (!schemaReady || rows.length === 0) return null

  return (
    <div className="col-span-2 rounded-xl border border-border bg-muted/25 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 text-xs font-semibold">Código desde a última versão</p>
        <span className="rounded-full bg-background px-2 py-0.5 font-mono text-[0.6rem] font-semibold text-muted-foreground">{rows.length}</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {rows.slice(0, 4).map((row) => (
          <div key={row.id} className="flex min-w-0 items-center gap-2 text-[0.64rem]">
            <span className="shrink-0 rounded-md bg-background px-1.5 py-0.5 font-mono font-semibold uppercase text-muted-foreground">{row.provider}</span>
            <span className="shrink-0 font-mono font-semibold">{row.revision}</span>
            {row.branch && <span className="inline-flex min-w-0 items-center gap-1 truncate text-muted-foreground"><GitBranch className="size-3 shrink-0" /><span className="truncate">{row.branch}</span></span>}
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.message || "Sem mensagem"}</span>
          </div>
        ))}
      </div>
      {rows.length > 4 && <p className="mt-2 text-[0.61rem] text-muted-foreground">+ {rows.length - 4} alteração(ões) vinculada(s) que também entrarão neste versionamento.</p>}
    </div>
  )
}
