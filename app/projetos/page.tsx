"use client"

import Link from "next/link"
import { Plus } from "lucide-react"
import { PageHeading } from "@/components/page-heading"
import { ProjectsView } from "@/components/projects/projects-view"
import { useStore } from "@/lib/store"
import { canPerformAction } from "@/lib/access-control"

export default function ProjetosPage() {
  const { currentUserRole, currentAccessPolicy } = useStore()
  const canCreateProject = canPerformAction(currentUserRole, currentAccessPolicy, "createProjects")
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Portfólio"
        title="Projetos"
        subtitle="Gerencie todos os seus projetos, atividades e horas em um só lugar."
        action={canCreateProject ? (
          <Link href="/projetos/novo" className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90">
            <Plus className="size-4" />
            Novo projeto
          </Link>
        ) : undefined}
      />
      <ProjectsView />
    </div>
  )
}
