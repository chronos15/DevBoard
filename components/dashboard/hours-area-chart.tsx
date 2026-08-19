"use client"

import * as React from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useStore } from "@/lib/store"
import { cn } from "@/lib/utils"

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function dayKey(value: Date) {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, "0")
  const day = String(value.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function dayLabel(value: Date, range: "7d" | "30d") {
  return new Intl.DateTimeFormat("pt-BR", range === "7d"
    ? { weekday: "short" }
    : { day: "2-digit", month: "short" })
    .format(value)
    .replace(".", "")
}

function TooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium capitalize">{label}</p>
      <p className="flex items-center gap-2 text-muted-foreground">
        <span className="size-2 rounded-full bg-primary" />
        <span className="font-mono tabular-nums text-foreground">
          {Number(payload[0].value || 0).toFixed(1)}h
        </span>
        registradas
      </p>
    </div>
  )
}

export function HoursAreaChart() {
  const { workSessions } = useStore()
  const [range, setRange] = React.useState<"7d" | "30d">("7d")
  const [now, setNow] = React.useState(() => Date.now())

  React.useEffect(() => {
    if (!workSessions.some((session) => !session.endedAt)) return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [workSessions])

  const data = React.useMemo(() => {
    const days = range === "7d" ? 7 : 30
    const today = startOfLocalDay(new Date(now))
    const rows = Array.from({ length: days }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (days - 1 - index))
      return { key: dayKey(date), day: dayLabel(date, range), horas: 0 }
    })
    const byKey = new Map(rows.map((row) => [row.key, row]))

    for (const session of workSessions) {
      const started = new Date(session.startedAt)
      const row = byKey.get(dayKey(started))
      if (!row) continue
      const seconds = session.endedAt
        ? session.durationSeconds
        : Math.max(session.durationSeconds, Math.floor((now - started.getTime()) / 1000))
      row.horas += Math.max(0, seconds) / 3600
    }

    return rows.map((row) => ({ ...row, horas: Number(row.horas.toFixed(2)) }))
  }, [now, range, workSessions])

  const total = React.useMemo(() => data.reduce((sum, item) => sum + item.horas, 0), [data])

  return (
    <div className="flex flex-col rounded-2xl bg-card p-5 ring-1 ring-foreground/8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Horas registradas</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="font-mono font-semibold text-foreground tabular-nums">
              {total.toFixed(1)}h
            </span>{" "}
            {range === "7d" ? "nos últimos 7 dias" : "nos últimos 30 dias"}
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(["7d", "30d"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setRange(item)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                range === item
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item === "7d" ? "7 dias" : "30 dias"}
            </button>
          ))}
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="hoursFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="4 4" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              minTickGap={range === "30d" ? 24 : 8}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              dy={8}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              width={40}
            />
            <Tooltip content={<TooltipContent />} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="horas"
              stroke="var(--chart-1)"
              strokeWidth={2.5}
              fill="url(#hoursFill)"
              dot={false}
              activeDot={{ r: 5, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
