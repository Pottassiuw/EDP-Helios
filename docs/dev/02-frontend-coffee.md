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
| `operacao/components/operacao-composer.tsx` | Entrada de IDs; informa válidos, repetidos e inválidos antes da consulta. |
| `operacao/components/operacao-kanban.tsx` | Quatro colunas responsivas, sem drag and drop: Fila, Prontas, Processando e Aguardando SAP. |
| `components/coffee-nota-inspector.tsx` | Ficha lateral da nota com resumo, card read-only da Carteira, atividade, edição de local e ações contextuais. |
| `concluidas/coffee-concluidas.tsx` | Histórico, filtros, arquivamento de geradas e movimento de corrigidas para o Plano. |
| `concluidas/concluidas-api.ts` | Consulta e exportação do conjunto filtrado de concluídas. |
| `concluidas/components/concluidas-list.tsx` | Lista responsiva de concluídas e seleção restrita às corrigidas. |
| `coffee-abrir.tsx` | Lista local de IDs e abertura escalonada no COFFEE. |
| `coffee-logs.tsx` e `coffee-log-table.tsx` | Filtros e linha do tempo de auditoria por `trace_id`. |
| `confirm-modal.tsx` | Confirmação com justificativa obrigatória quando a ação exige auditoria. |
| `mover-plano-modal.tsx` | Formulário de integração com o Plano do Input. |

## Operação: Kanban persistido

O botão **Adicionar notas** abre o composer na própria página
(`operacao-composer.tsx`): textarea grande (8 linhas, `resize-y`,
`overflow-y-auto` até a altura máxima), texto auxiliar sobre o formato e
contadores de válidos/repetidos/inválidos/já-na-operação enquanto o usuário
digita. IDs separados por espaço, vírgula, ponto e vírgula ou linha são
analisados antes de enviar; somente números positivos e únicos seguem para
`POST /api/coffee/operacao/consultar`. O composer só limpa o texto e fecha
depois que a consulta é *aceita* pelo backend — uma falha mantém o conteúdo
e mostra o erro embutido no painel, sem fechar silenciosamente. Ctrl+Enter
consulta; Enter sozinho só quebra linha (é uma textarea).

Depois que o job de consulta termina, um toast resume o resultado real
(`resumo-job.ts: resumoJobConsulta`) — quantas notas ficaram prontas,
aguardando SAP, em processamento, foram ignoradas (já em estado final) ou
falharam — em vez de só "Consulta iniciada". O backend expõe essa contagem
em `por_etapa` no snapshot do job de consulta (`jobs.py:
_rodar_consulta_operacao`).

O Kanban não permite arrastar cards. A API e a máquina de estados definem a
etapa de cada item:

| Coluna | Significado | Ações principais |
|---|---|---|
| Fila | Consulta em andamento ou nota que precisa de nova tentativa. | Reconsultar ou remover. |
| Prontas para gerar | Nota elegível e sem SAP real. | Gerar, editar local, remover. |
| Processando | Geração em andamento. | Acompanhar no card e no inspector. |
| Aguardando SAP | Placeholder `10000000`; falta consultar o SAP real. | Atualizar SAP ou remover. |

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
