"use client"

import Link from "next/link"
import { Plus } from "lucide-react"
import { PageHeading } from "@/components/page-heading"
import { KpiCards } from "@/components/dashboard/kpi-cards"
import { HoursAreaChart } from "@/components/dashboard/hours-area-chart"
import { StatusDonut } from "@/components/dashboard/status-donut"
import { ProjectsProgress } from "@/components/dashboard/projects-progress"
import { FocusPanel } from "@/components/dashboard/focus-panel"
import { HoursByProject } from "@/components/dashboard/hours-by-project"
import { useStore } from "@/lib/store"

export default function DashboardPage() {
  const { currentUserId, members } = useStore()
  const currentUser = members.find((member) => member.id === currentUserId)
  const firstName = currentUser?.name?.trim().split(/\s+/)[0] || ""

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Painel geral"
        title={firstName ? `Olá, ${firstName}` : "Painel"}
        subtitle="Aqui está o panorama dos seus projetos e do tempo investido."
        action={
          <Link
            href="/projetos/novo"
            className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" />
            Novo projeto
          </Link>
        }
      />

      <KpiCards />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <HoursAreaChart />
        </div>
        <StatusDonut />
        <ProjectsProgress />
        <FocusPanel />
        <HoursByProject />
      </div>
    </div>
  )
}
