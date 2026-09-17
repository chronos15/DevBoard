# TaskBoard V186 — Picker de estimativa compacto e confirmação sempre acessível

## Ajustes

O seletor de estimativa (`HH:mm`) usado em **Nova subatividade** foi redesenhado para ficar mais limpo e funcional.

- removido o bloco grande de `00:00` que ocupava espaço demais;
- a duração atual agora aparece de forma compacta no cabeçalho;
- controles de **Horas** e **Minutos** permanecem lado a lado e mais compactos;
- atalhos rápidos (`00:30`, `01:00`, `02:00`, `04:00`, `08:00`) foram mantidos;
- ação principal agora é **Confirmar**, com ícone de check;
- rodapé com **Limpar** e **Confirmar** fica sempre visível;
- o popup passa a detectar o espaço disponível na tela e, quando não cabe abaixo do campo, abre acima dele automaticamente;
- o conteúdo interno pode rolar sem esconder o rodapé de confirmação.

## Estrutura

Nenhuma regra de criação de subatividade, persistência de estimativa ou banco de dados foi alterada.
Não há migration nova nesta versão.
