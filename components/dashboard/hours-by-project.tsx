"use client"

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useAnalyticsScope } from "@/lib/use-analytics-scope"
import { projectTracked } from "@/lib/project-utils"

const palette = [
  "var(--chart-1)",
  "var(--chart-4)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-5)",
]

function TooltipContent({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium">{p.fullName}</p>
      <p className="font-mono tabular-nums text-muted-foreground">
        <span className="text-foreground">{p.horas}h</span> registradas
      </p>
    </div>
  )
}

export function HoursByProject() {
  const { projects } = useAnalyticsScope()

  const data = projects.map((p, i) => ({
    name: p.name.length > 12 ? p.name.slice(0, 11) + "…" : p.name,
    fullName: p.name,
    horas: Number((projectTracked(p) / 3600).toFixed(1)),
    color: palette[i % palette.length],
  }))

  return (
    <div className="flex flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <h2 className="text-base font-semibold">Horas por projeto</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        Esforço distribuído entre projetos
      </p>

      <div className="mt-4 h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="4 4"
            />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              dy={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              width={40}
            />
            <Tooltip
              content={<TooltipContent />}
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            />
            <Bar dataKey="horas" radius={[6, 6, 0, 0]} maxBarSize={44}>
              {data.map((d) => (
                <Cell key={d.fullName} fill={d.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
