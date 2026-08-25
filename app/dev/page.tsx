import { PageHeading } from "@/components/page-heading"
import { DeveloperPanel } from "@/components/developer/developer-panel"

export default function DeveloperPage() {
  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-5">
      <PageHeading
        eyebrow="Developer workspace"
        title="Painel do desenvolvedor"
        subtitle="Seu cockpit pessoal para continuar de onde parou, acompanhar a sessão atual, automatizar foco/IDE, revisar o dia e iniciar seus contextos de trabalho."
      />
      <DeveloperPanel />
    </div>
  )
}
