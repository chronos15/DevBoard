# TaskBoard V114 — Correção definitiva da apuração de horas

## Problema

`Controle de horas` e `Relatórios gerenciais` falhavam com `HTTP 400` na RPC `hours_report` e erro PostgreSQL `42702`:

- `column reference "subactivity_id" is ambiguous`
- `It could refer to either a PL/pgSQL variable or a table column.`

A função `hours_report()` retornava uma tabela com nomes (`subactivity_id`, `user_id`, `started_at`, etc.) que, em `LANGUAGE plpgsql`, também passam a existir como variáveis OUT. A migration 087 qualificou o SELECT final, mas a versão procedural continuava sujeita a essa classe de colisão dependendo da função efetivamente instalada no banco.

## Correção

Nova migration:

`supabase/migrations/088_taskboard_hours_report_unambiguous.sql`

A RPC foi recriada como `LANGUAGE sql`, removendo completamente variáveis procedurais OUT da execução. Todos os campos internos usam aliases exclusivos (`r_subactivity_id`, `r_user_id`, etc.).

## Regras de acesso preservadas

- Admin: pode apurar todos os registros do workspace.
- Admin: pode filtrar por usuário e/ou projeto.
- Usuário comum: recebe somente os próprios registros (`auth.uid()`).
- Um usuário comum não consegue ampliar o escopo manipulando `p_user_id`.
- Ajustes administrativos de horas da migration 086 continuam aparecendo nos relatórios.

## Impacto

A mesma RPC abastece:

- Controle de horas;
- Relatórios gerenciais.

Por isso a migration 088 corrige as duas telas simultaneamente.

## Observação sobre `VM154 ... startTime`

Esse erro não é a causa do problema de apuração. O erro funcional do TaskBoard é o `POST /rest/v1/rpc/hours_report 400` acompanhado do PostgreSQL `42702`.
