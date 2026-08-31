import { PageHeading } from "@/components/page-heading"
import { ReportsView } from "@/components/reports/reports-view"
import { ExportReportsButton } from "@/components/reports/export-reports-button"

export default function RelatoriosPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Análises"
        title="Relatórios"
        subtitle="Horas, carga e desempenho dos projetos respeitando o seu nível de acesso."
        action={<ExportReportsButton />}
      />
      <ReportsView />
    </div>
  )
}
