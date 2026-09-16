# TaskBoard V169 — Estimativa de subatividade profissional

## Ajustes

- Nova subatividade passa a abrir com a estimativa vazia.
- O campo deixou de aplicar máscara agressiva durante a digitação, evitando casos como `04:00` virar `0:40`.
- A digitação manual aceita `HH:mm` normalmente e só normaliza ao sair do campo.
- Entrada compacta também é entendida no blur: `400`/`0400` vira `04:00`, `130` vira `01:30`.
- Adicionado seletor visual de duração com:
  - horas e minutos;
  - botões + / -;
  - edição numérica direta;
  - atalhos 00:30, 01:00, 02:00, 04:00 e 08:00;
  - limpar e aplicar.
- O botão Adicionar/Criar continua disponível e, se a estimativa estiver vazia ou inválida, mostra validação no próprio campo.
- `00:00` não é aceito para criação de nova subatividade.
- O mesmo campo profissional foi reaproveitado na edição de subatividade para manter a experiência consistente.
- A conversão interna continua em horas decimais; banco e RPCs não foram alterados.

## Arquivos alterados

- `components/ui/duration-field.tsx`
- `components/project-detail/add-subactivity-dialog.tsx`
- `components/project-detail/follow-up-structure-dialogs.tsx`
- `components/project-detail/edit-subactivity-dialog.tsx`
- `lib/duration-input.ts`
- `lib/app-version.ts`
- `next.config.mjs`
- `V169_FIX_NOTES.md`

## Banco

Nenhuma migration nova.
