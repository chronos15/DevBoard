import { PageHeading } from "@/components/page-heading"
import { ReportsView } from "@/components/reports/reports-view"

export default function RelatoriosPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5">
      <PageHeading
        eyebrow="Gestão"
        title="Administrativo"
        subtitle="Relatórios, auditoria de horas, produtividade e acompanhamento administrativo em um único módulo."
      />
      <ReportsView />
    </div>
  )
}
