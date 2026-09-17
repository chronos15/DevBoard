# TaskBoard V187 — Preview ampliado da imagem do projeto

## Ajuste

Os cards/cabeçalhos de projeto que exibem **nome + descrição** agora permitem ampliar a imagem personalizada do projeto diretamente pelo ícone.

### Onde foi aplicado
- card de projeto na tela **Projetos**;
- cabeçalho do projeto na tela de **detalhes do projeto**.

### Comportamento
- somente o **ícone/imagem** abre o preview;
- o restante do card mantém exatamente a navegação existente;
- quando o projeto possui imagem personalizada, o cursor indica zoom e o clique abre o mesmo `ImageViewerDialog` usado nas imagens do Acompanhamento;
- o preview mantém zoom, pan/arraste, pinch no mobile, rotação, tela ampliada e demais recursos já existentes no componente;
- projetos que usam apenas ícone padrão continuam sem ação de preview.

## Estrutura
- criado componente reutilizável `components/projects/project-image-preview.tsx`;
- nenhuma regra de projeto, permissão, navegação ou banco foi alterada;
- nenhuma migration nova.
