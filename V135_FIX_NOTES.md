# TaskBoard V135 — envio múltiplo paralelo controlado

## Motivo
Na V134, a seleção múltipla funcionava, porém cada destino era processado em sequência (`destino 1 -> destino 2 -> destino 3`). Em compartilhamentos com vários destinos isso fazia o tempo total crescer quase linearmente.

## Alteração
- Mantidas as mesmas funções de envio, RPCs, permissões e estrutura de anexos.
- O envio múltiplo agora utiliza um pool de concorrência controlada.
- Concorrência adaptativa conforme o volume preparado:
  - menos de 20 MB: até 4 destinos simultâneos;
  - de 20 MB a menos de 75 MB: até 3 destinos simultâneos;
  - 75 MB ou mais: até 2 destinos simultâneos.
- Um destino que falha não cancela os demais.
- Ao final, somente os destinos com falha permanecem selecionados para nova tentativa, preservando a regra da V134.
- O contador de envio representa quantos destinos já terminaram (`concluídos/total`).

## Compatibilidade
- Nenhuma migration nova.
- Nenhuma mudança de banco.
- Nenhuma mudança nas regras de permissão.
- O preparo de vídeo continua sendo realizado uma única vez antes do fan-out.

## Observação
A V135 melhora principalmente o tempo de espera causado por latência de upload/RPC. O binário ainda precisa ser enviado para cada destino conforme a estrutura atual de Storage. Uma futura arquitetura de fan-out server-side poderia reduzir também os bytes reenviados, mas exigiria uma mudança maior na estratégia de armazenamento e exclusão de anexos.
