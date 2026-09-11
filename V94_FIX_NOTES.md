# TaskBoard V94 — Correção de Configurações: Notificações e Aparência

## Correção

A V93 perdeu acidentalmente três helpers compartilhados do arquivo `components/config/config-view.tsx` durante a evolução da tela de Equipe:

- `PreferenceToggle`
- `usePreferenceEditor`
- `BrowserNotificationSettings`

As abas **Notificações** e **Aparência** continuavam referenciando esses helpers. Como eles só eram executados quando a respectiva aba era aberta, a tela inicial de Configurações carregava normalmente, mas ao clicar em **Notificações** ou **Aparência** ocorria uma exceção de runtime e o boundary do Next.js mostrava `This page couldn’t load`.

A V94 restaura os helpers originais sem alterar a lógica da V93, a tela de Equipe, jornada semanal, perfis personalizados, banco ou permissões.

## Banco

Nenhuma migration nova é necessária. A última migration continua sendo a **077** da V93.
