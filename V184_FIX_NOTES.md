# TaskBoard V184 — Compatibilidade de logs antigos + vínculo exato por ID

## Ajuste

A V183 passou a usar `project_logs.subactivity_id` como vínculo exato dos logs com a subatividade. Na V184, essa regra permanece como prioridade absoluta para todos os logs novos, mas o histórico já existente em produção continua compatível.

### Regra aplicada

1. Se o log possui `subactivity_id`, ele pertence **somente** à subatividade cujo UUID é exatamente igual. O título/descrição nunca é usado como fallback nesse caso.
2. Se o log é antigo e `subactivity_id` está `NULL`/ausente, mantém-se o fallback legado da aplicação:
   - logs comuns: referência pelo título completo da subatividade entre aspas;
   - reuniões antigas: UUID exato já gravado no marcador `[[meeting-subactivity:...]]`.

Assim, logs novos não vazam entre subatividades com nomes iguais ou parecidos, enquanto os logs históricos de produção continuam aparecendo como antes.

## Banco

Não há migration nova na V184. A migration `095_taskboard_project_logs_subactivity_id.sql` da V183 continua sendo a responsável por adicionar e preencher o novo `subactivity_id` nos logs gerados daqui para frente.
