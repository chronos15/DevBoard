"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
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
    name: p.name.length > 14 ? p.name.slice(0, 13) + "…" : p.name,
    fullName: p.name,
    horas: Number((projectTracked(p) / 3600).toFixed(1)),
    color: palette[i % palette.length],
  }))

  const chartWidth = Math.max(520, data.length * 86)

  return (
    <div className="flex h-[390px] min-h-0 flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">Horas por projeto</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Esforço distribuído entre projetos
          </p>
        </div>
        <Link
          href="/horas"
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Ver horas <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1 [scrollbar-width:thin]">
        {data.length > 0 ? (
          <div className="h-full" style={{ width: chartWidth, minWidth: "100%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 12, right: 12, left: -18, bottom: 8 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="4 4"
                />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                  dy={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  width={40}
                />
                <Tooltip
                  content={<TooltipContent />}
                  cursor={{ fill: "var(--muted)", opacity: 0.35 }}
                />
                <Bar dataKey="horas" radius={[6, 6, 2, 2]} maxBarSize={42}>
                  {data.map((d) => (
                    <Cell key={d.fullName} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-full min-h-48 items-center justify-center text-sm text-muted-foreground">
            Nenhuma hora registrada por projeto.
          </div>
        )}
      </div>
    </div>
  )
}
