import { PageHeading } from "@/components/page-heading"
import { ReportsView } from "@/components/reports/reports-view"

export default function RelatoriosPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <PageHeading
        eyebrow="Análises"
        title="Relatórios gerenciais"
        subtitle="Auditoria de horas, produtividade e andamento com filtros administrativos e exportação profissional."
      />
      <ReportsView />
    </div>
  )
}
