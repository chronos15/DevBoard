"use client"

import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts"
import { useStore } from "@/lib/store"
import { statusCounts } from "@/lib/project-utils"

export function StatusDonut() {
  const { projects } = useStore()
  const counts = statusCounts(projects)
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0)

  const data = [
    { name: "Concluídas", value: counts.done, color: "var(--chart-5)" },
    { name: "Em execução", value: counts["in-progress"], color: "var(--chart-3)" },
    { name: "Aguardando AQS", value: counts["waiting-aqs"], color: "var(--chart-1)" },
    { name: "Pausadas", value: counts.paused, color: "var(--chart-4)" },
    { name: "Aguardando", value: counts.waiting, color: "var(--chart-2)" },
    { name: "Backlog", value: counts.backlog, color: "var(--muted-foreground)" },
    { name: "Canceladas", value: counts.cancelled, color: "var(--destructive)" },
  ]

  return (
    <div className="flex flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <h2 className="text-base font-semibold">Status das tarefas</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Distribuição de subatividades</p>

      <div className="relative mx-auto my-2 h-44 w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={58} outerRadius={80} paddingAngle={3} cornerRadius={6} stroke="none">
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums">{total}</span>
          <span className="text-xs text-muted-foreground">tarefas</span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="truncate">{d.name}</span>
            </span>
            <span className="font-mono font-medium tabular-nums">{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
