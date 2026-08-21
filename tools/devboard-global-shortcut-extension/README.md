# Devboard — atalho global do Painel Dev

Esta extensão Manifest V3 adiciona um atalho global no Chrome/Edge para trazer o Devboard para frente e abrir `/dev#dev-session`.

## Instalação no Chrome / Edge

1. Abra a página de extensões do navegador e ative o **Modo do desenvolvedor**.
2. Use **Carregar sem compactação** e selecione esta pasta `tools/devboard-global-shortcut-extension`.
3. Abra o Devboard em uma aba, clique no ícone da extensão e escolha **Usar esta aba como Devboard**.
4. O atalho padrão é **Ctrl + Shift + 7**.
5. Se quiser trocar a combinação, abra a tela de atalhos das extensões e mantenha o comando como **Global** para que funcione quando outro programa do Windows estiver em foco.

## Comportamento

- Se já existir uma aba do Devboard, a extensão reutiliza essa aba, navega para `/dev` e foca a janela do navegador.
- Se não existir uma aba, abre uma nova.
- Se o navegador estiver minimizado, tenta restaurar a janela.
- O Devboard continua aplicando a própria regra de acesso: somente `developer` pode entrar em `/dev`.

O próprio frontend também reconhece **Ctrl + Shift + 7** enquanto a aba do Devboard está em foco, mesmo sem a extensão instalada.
