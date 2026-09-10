# TaskBoard V82 — Brainstorm + criação rápida de projeto

## 1. Primeiro item da barra de projetos no Modo Resumido

- Administrador e Desenvolvedor passam a ver um card com `+` antes dos projetos.
- O card abre o formulário real de criação de projeto dentro de um modal, sem sair do Modo Resumido.
- O formulário reaproveita `ProjectForm` e `create_project`; não existe fluxo paralelo nem duplicação de regra.
- Depois de criar, o modal fecha e o novo projeto é aberto no próprio Modo Resumido.
- Perfis sem permissão não recebem esse botão.

## 2. Modo Brainstorm por subatividade

- Novo icon button `BrainCircuit` ao lado do checklist no cabeçalho da subatividade.
- Também há acesso rápido no item da subatividade na tela de atividades/projeto.
- O estado ativo fica visualmente destacado e também aparece na árvore do Modo Resumido.
- Só pode ser ativado enquanto a subatividade estiver `Em execução`.
- Administrador pode alternar qualquer subatividade; Desenvolvedor somente a própria execução.

## 3. Atalho global

- `Ctrl + Shift + B` alterna Brainstorm na subatividade atualmente em execução do usuário.
- Primeiro acionamento: ativa.
- Segundo acionamento: desativa e retorna à regra normal de inatividade.

## 4. Regra dos 5 minutos

Enquanto Brainstorm estiver ativo:

- o `TimerIdleGuard` do navegador/PWA não mostra alerta nem pausa a execução;
- o painel/automação do Desenvolvedor não dispara o fluxo de ausência;
- o TaskBoard Agent do Windows recebe a execução como `intermittent` e não inicia auto-pausa;
- a RPC de pausa por inatividade também revalida `brainstorm_mode` no backend e recusa a pausa.

O cronômetro continua contando normalmente.

## 5. Logs e encerramento seguro

- Ativar Brainstorm gera log `Brainstorm ativado`.
- Desativar manualmente gera log `Brainstorm encerrado`.
- Ao sair de `Em execução`, o banco remove o Brainstorm automaticamente e registra o encerramento.
- Isso também protege clientes antigos que alterem o status sem conhecer o novo campo.

## 6. Banco

Executar depois da migration 070:

```text
supabase/migrations/071_taskboard_brainstorm_mode_and_quick_project.sql
```

A migration adiciona somente o estado necessário para o Brainstorm e atualiza as RPCs do Agent que já existem. A criação rápida de projeto não cria nova tabela nem nova RPC.
