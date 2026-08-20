# Módulo COFFEE

## O que faz

COFFEE concentra a triagem de notas, a operação de geração e o histórico das
notas concluídas. A operação é uma fila persistida: a pessoa consulta IDs,
acompanha a situação das notas e executa geração ou atualização do SAP sem
perder o progresso ao atualizar o navegador.

## Navegação

`coffee-hub.tsx` é a casca da feature. Ele recebe a subpágina de `App.tsx` e
renderiza uma de cinco seções por `SegTabs`:

- **Verificar** — lê a triagem diretamente do `Verificar.db` e encaminha notas para a fila COFFEE.
- **Abrir** — abre IDs manualmente no COFFEE; a lista fica no navegador.
- **Operação** — o Kanban da fila ativa.
- **Concluídas** — histórico separado de notas geradas e corrigidas.
- **Logs** — auditoria filtrável das ações e chamadas de integração.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `coffee-hub.tsx` | Cabeçalho, navegação das cinco subseções e handoffs de Verificar/Relatórios. |
| `operacao/coffee-operacao.tsx` | Orquestra quadro, seleção em lote, confirmações, inspector e ações da fila. |
| `operacao/use-coffee-operacao.ts` | Query do quadro e mutations de consultar, gerar, atualizar SAP e remover. |
| `operacao/components/operacao-composer.tsx` | Barra sempre visível (sem expandir/recolher) com dois botões — `Consultar` (somente leitura) e `Adicionar à fila` (enfileira); mostra chips com o token exato de repetidos/inválidos, não só a contagem. |
| `operacao/components/operacao-lista.tsx` | Lista ordenável (Atualização/Prioridade); cada linha mostra a jornada da nota via `operacao-stepper.tsx`, sem colunas fixas. |
| `operacao/components/operacao-stepper.tsx` | Mini-stepper de 5 nós (Fila/Pronta/Processando/Aguardando SAP + nó fantasma "Concluída"), reutilizado por `nota-operacao-row.tsx`. |
| `operacao/components/operacao-consulta-resultado.tsx` | Painel recolhível com o resultado da consulta somente-leitura: resumo por contagem, lista com altura travada, `+ Fila` por linha e "Selecionar todas elegíveis". |
| `components/coffee-nota-inspector.tsx` | Ficha lateral da nota com resumo, card read-only da Carteira, atividade, edição de local e ações contextuais. |
| `concluidas/coffee-concluidas.tsx` | Histórico, filtros, arquivamento de geradas e movimento de corrigidas para o Plano. |
| `concluidas/concluidas-api.ts` | Consulta e exportação do conjunto filtrado de concluídas. |
| `concluidas/components/concluidas-list.tsx` | Lista responsiva de concluídas e seleção restrita às corrigidas. |
| `coffee-abrir.tsx` | Lista local de IDs e abertura escalonada no COFFEE. |
| `coffee-logs.tsx` e `coffee-log-table.tsx` | Filtros e linha do tempo de auditoria por `trace_id`. |
| `confirm-modal.tsx` | Confirmação com justificativa obrigatória quando a ação exige auditoria. |
| `mover-plano-modal.tsx` | Formulário de integração com o Plano do Input. |

## Operação: Kanban persistido

O **composer** é uma barra sempre visível no topo da página (`operacao-composer.tsx`):
textarea compacta (2 linhas) com dois botões de ação. IDs são separados por espaço,
vírgula, ponto e vírgula ou linha; enquanto o usuário digita, aparecem chips mostrando
o token exato de cada ID repetido ou inválido (não apenas uma contagem). Números
positivos e únicos são validados localmente; **Ctrl+Enter** ou clicar em **Adicionar à fila**
enfileira os IDs; clicar em **Consultar** abre o painel de consulta somente-leitura.

O botão **Consultar** dispara uma consulta somente-leitura (`POST /api/coffee/operacao/consultar-lote`),
que abre um painel recolhível de resultado (`operacao-consulta-resultado.tsx`) abaixo do
composer. O painel mostra um resumo por contagem (elegiveis, concluídas, já na operação,
erros) e uma lista com altura travada (`max-h-[336px]`) — cada linha exibe o ID, local
de instalação e status. IDs elegíveis mostram um botão "+ Fila"; concluídas mostram o
SAP com um botão de copiar; em operação mostram um badge de confirmação. Um checkbox
"Selecionar todas elegíveis" permite bulk-select, com um botão "Adicionar à fila de
geração" que enfileira os selecionados via `POST /api/coffee/operacao/consultar`.

O botão **Adicionar à fila** (sempre visível no composer) enfileira IDs digitados
diretamente sem abrir o painel de consulta somente-leitura — equivale ao comportamento
anterior de `consulta é aceita` que limpava e fechava. Uma falha mantém o texto no
composer e mostra o erro embutido, sem fechar silenciosamente.

A **lista operacional** (`operacao-lista.tsx`) ordena itens por Atualização (padrão) ou
Prioridade (via dropdown). Cada linha é uma `nota-operacao-row.tsx` que mostra o ID,
local, um mini-stepper (`operacao-stepper.tsx`) e seleção/ações. O mini-stepper de 5 nós
mostra a jornada da nota: **Fila** → **Pronta** → **Processando** → **Aguardando SAP**
(todos reais) + um nó tracejado fantasma **Concluída** (inerte, sai do quadro ao gerar).
A API e a máquina de estados definem a etapa de cada item; não há drag-and-drop. Ações
por linha: gerar, reconsultar, atualizar SAP, remover (com justificativa).

`useCoffeeOperacao` consulta `['coffee', 'operacao']` e faz refetch a cada
800 ms somente enquanto houver operação com estado `rodando`. O quadro vem do
SQLite com cards e snapshots de jobs, portanto recarregar a página preserva o
progresso. Em reinício do backend, jobs pendentes são marcados como
interrompidos e itens que estavam em processamento voltam a Prontas com erro
recuperável.

O estado legado do antigo modal, `sessionStorage['edp_coffee_gerar_rows']`, é
migrado na primeira montagem de Operação. A migração é observável: um toast
avisa que a migração começou e outro confirma quantas notas foram migradas
(ou o erro, se a consulta falhar). A chave só é removida depois de a
consulta ser aceita; se a mutation falhar, os dados ficam na sessão para uma
tentativa futura.

## Inspector da nota

Abrir um card ou uma linha de Concluídas mostra `CoffeeNotaInspector` em um
`Sheet`. Em telas menores que o breakpoint desktop ele ocupa a largura útil;
no desktop fica limitado a `clamp(420px, 38vw, 620px)`. Ao fechar, o foco volta
ao botão que abriu a ficha.

A ficha busca `['coffee', 'revisao', pk]` e
`['coffee', 'nota', pk, 'logs']`, mostra resumo e atividade e indica o próximo
passo. O local de instalação pode ser alterado apenas para cards em Fila ou
Prontas; o valor digitado permanece no campo se a mutation falhar. Conforme a
origem da ficha, os botões oferecem gerar, atualizar SAP, remover, arquivar ou
mover para o Plano. Arquivar só aparece para uma nota gerada em Concluídas.

Nos fluxos **Operação** e **Concluídas**, a ficha também mostra o
`CarteiraEnriquecimentoCard` read-only logo após o resumo. A consulta usa
exclusivamente `revisao.data.coffee.id_sap`; `pk` continua sendo apenas a
chave interna do COFFEE. A query de enriquecimento permanece habilitada somente
enquanto o inspector está aberto e reutiliza a chave
`['carteira', 'enriquecimento', id_sap]` por cinco minutos. Quando a Carteira
ainda não foi sincronizada, o callback sobe por `CoffeeOperacao` ou
`CoffeeConcluidas`, passa pelo `CoffeeHub` e abre a aba Sincronização via
`App.tsx`. O card não interfere na edição de local, atividade nem nas ações
contextuais do inspector.

`Sheet`, `Dialog`, `AlertDialog` e `Select` portalizam fora da raiz do app e
mesmo assim seguem tema, densidade e accent: desde a Fase 4c esses tokens
vivem em `:root`, escritos no `<html>` pelo `SettingsProvider`. O hook
`useCoffeePortalTheme`, que propagava isso à mão em cada call site, foi
removido.

## Concluídas e Plano

`CoffeeConcluidas` consulta `['coffee', 'concluidas']` e separa o histórico
por **Todas**, **Geradas** e **Corrigidas**. A busca cobre ID, SAP e local; o
filtro de período usa `classificacao_em` e indica o fallback para a última
consulta quando esse dado antigo não existir.

Notas geradas podem ser arquivadas após justificativa. Apenas corrigidas podem
ser selecionadas e movidas, individualmente ou em lote, para o Plano. O
`MoverPlanoModal` invalida `INPUT_DADOS_KEY` e a revisão de cada nota movida e
oferece a navegação para a Visão Geral do Input. Para notas vindas de Verificar,
a lista informa a data/hora de entrada e da correção; o inspector mostra também
quem encaminhou e quem concluiu.

O botão **Exportar Excel** envia os PKs do resultado atualmente filtrado (tipo,
busca e período), junto do `X-User` da sessão COFFEE, para o backend e baixa
`notas_concluidas_YYYY-MM-DD.xlsx`.
A planilha contém ID ONR, ID SAP, classificação, local, poste, referência,
componente, sintoma, observação, origem e data de conclusão. Ela não exporta
notas que deixaram de estar concluídas ou de estar disponíveis para o usuário
entre a listagem e o download.

## Logs e timings

| Valor | Onde | O que faz |
|---|---|---|
| `800ms` | `operacao/use-coffee-operacao.ts` | Atualiza o quadro enquanto houver job ativo. |
| `10_000ms` | `coffee-logs.tsx` | Atualiza os logs quando o toggle Ao vivo está ligado. |
| `250ms × índice` | `frontend/src/api.ts` | Escalona abertura de múltiplas abas COFFEE. |

## Pontos de atenção

- `npm test` cobre contratos SSR de componentes e `npm run build` verifica a
  integração tipada. Fluxos visuais e de interação do `Sheet` continuam sendo
  verificação manual quando esse ambiente estiver disponível.
- `CoffeeLogs` ainda usa um hook baseado em `fetch` e estado local para a
  listagem geral. Já o inspector usa React Query para os logs de uma nota.
- A conexão com COFFEE/SAP é externa. Falhas de mutation são exibidas com uma
  próxima ação, mas operações que já alcançaram o sistema externo podem exigir
  uma reconsulta para refletir o estado final.
