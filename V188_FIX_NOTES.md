# TaskBoard V188 — versão embutida atualizada para servidor físico

## Ajuste

A versão exibida no rodapé/sidebar agora acompanha o pacote entregue sem depender de variável de ambiente no servidor físico.

Nesta entrega, o fallback embutido foi atualizado para **V188** em:

- `next.config.mjs`
- `lib/app-version.ts`

A data/hora da build continua automática e é calculada no momento da compilação.

## Regra para próximas entregas

A partir desta versão, cada novo pacote entregue deve ter também a versão embutida atualizada (`V189`, `V190`, etc.), tanto no ZIP completo quanto no ZIP de arquivos alterados.

Não há migration de banco nesta versão.
