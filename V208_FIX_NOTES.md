# TaskBoard V208

## Mural da reunião — visualização local e painel real da subatividade

- O botão **Mural** continua disponível no topo somente quando a reunião possui contexto de origem.
- O modo Mural agora é **local para cada participante**: abrir ou fechar não altera a tela dos demais usuários e não usa Broadcast para sincronizar layout.
- Em reuniões vinculadas a uma subatividade (inclusive quando a origem é uma análise AQS com subatividade), o Mural reutiliza a própria visualização central do **Acompanhamento** da subatividade, preservando o layout, timeline, anexos, comentários e composer já existentes.
- Dentro da reunião, a visualização embutida remove apenas os painéis duplicados de navegação/equipe do Acompanhamento para caber corretamente no modal.
- No desktop, ao abrir o Mural, a lateral direita passa a mostrar **Participantes** por padrão. O **Chat da reunião** fica disponível pelo icon button no topo e pode ser aberto/fechado sem sair do Mural.
- Fora do modo Mural, a grade de vídeo, WebRTC, controles de áudio/câmera, gravação e fluxo atual da reunião permanecem inalterados.
- Nenhuma migration ou alteração de banco foi adicionada.
