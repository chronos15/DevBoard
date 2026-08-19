import { PageHeading } from "@/components/page-heading"
import { HelpView } from "@/components/help/help-view"

export default function AjudaPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeading
        eyebrow="Suporte"
        title="Ajuda"
        subtitle="Encontre respostas rápidas ou fale com nosso time."
      />
      <HelpView />
    </div>
  )
}
