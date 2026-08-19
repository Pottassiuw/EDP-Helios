# Módulo Input

## O que faz

Input é a visão consolidada e editável das notas de manutenção
importadas do SAP (IW28/IW38/IW66): mostra todos os registros num
grid tipo planilha, permite edição rápida ou em lote, filtros
avançados, exportação para Excel, relatórios de auditoria de prazo
(DDPM vs SAP) e histórico de alterações. Também dispara e acompanha a
sincronização com o SAP e alerta quando outra sessão altera a base
enquanto o usuário está com a tela aberta.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `frontend/src/features/input/input-section.tsx` | Casca da feature: cabeçalho, `SegTabs` das sub-abas (`INPUT_SUBS`), banners de aviso (dados desatualizados, importação inicial pendente, bases ausentes), roteamento condicional para o componente de cada sub-aba e renderização do bloco unificado de filtros avançados no topo. |
| `frontend/src/features/input/overview.tsx` | Sub-aba "Visão Geral": absorveu a antiga sub-aba "Gerenciar" (`manage.tsx`, removida) como o modo interno `modo` (`visao`/`rapida`/`lote`/`colagem`) sobre `NotesTable`/`DataGrid`; abre `InputNotaInspector` por ação acessível e reúne os botões "Sincronizar SAP", "Inserir em Massa" e "Exportar Excel". Cadastro, notificação, exclusão e ocultação de notas viraram modais dedicados (`cadastro-modal.tsx`, `notificacao-modal.tsx`, `exclusao-modal.tsx`, `ocultacao-modal.tsx`) — não documentados em detalhe aqui ainda. |
| `frontend/src/features/input/ramal.tsx` | Equivalente a `manage.tsx` para a base "Ramal" (dataset separado, `useRamalData`), com um modo "Visão Geral" a mais (via `DataGrid`). |
| `frontend/src/features/input/filters.tsx` | Componente `Filters`: busca global por número de nota, switch rápido para o ano de 2026 e filtros avançados por campo (texto, faixa numérica, multi-seleção), unificado no nível de `input-section.tsx` e compartilhado entre as abas. |
| `frontend/src/features/input/empty-state.tsx` | Contrato compartilhado de estados vazios para base sem registros ou resultado sem correspondências após filtros, incluindo ação opcional de limpar filtros. |
| `frontend/src/features/input/reports.tsx` | Sub-aba "Relatórios" (Painel Executivo): Permite navegar entre três relatórios interativos: "Auditoria de Prazos" (KPIs, cronograma, gráfico de rosca SVG), "Visão Financeira (Custos)" (totais, regional e status em barras de progresso) e "Em Planejamento (Status 10)" (backlog de planejamento, priorização e distribuição regional). Todos usam filtros avançados via `MultiSelect` e exportação customizada para Excel. |
| `frontend/src/features/input/reports-lib.ts` | Regras puras compartilhadas pela tela de relatórios para interpretar o ano de encerramento e calcular a aderência ao cronograma (SLA), isoladas da renderização para permitir testes focados. |
| `frontend/src/features/input/rateio.tsx` | Sub-aba de rateio SAP: mantém o fluxo hierárquico/individual, validações e execução do robô; as regras puras de status, normalização de nota-mãe e unidade foram extraídas para `rateio-lib.ts`. |
| `frontend/src/features/input/rateio-lib.ts` | Regras puras testáveis do rateio: identifica notas ativas, valida/normaliza notas-mãe e extrai quantidade/unidade de medidas SAP. |
| `frontend/src/features/input/logs.tsx` | Sub-aba "Logs": três sub-abas (Alterações nas Notas, Arquivos, Linha do Tempo), cada uma consumindo um endpoint próprio via `useQuery`. "Arquivos" (`GET /logs/arquivos`) lista substituições de base e também exportações — por isso o rótulo deixou de ser "Bases de Apoio". |
| `frontend/src/features/input/settings.tsx` | Sub-aba "Configurações": nome do usuário (log de auditoria), responsáveis por conjunto, status/substituição das bases de apoio, lista de backups locais para download. |
| `frontend/src/features/input/notes-table.tsx` | Tabela windowed (virtualização manual por `scrollTop`, `ALTURA_LINHA = 40`) usada dentro de `overview.tsx`/`ramal.tsx`: seleção por checkbox, edição inline por duplo clique, ordenação por coluna, suporte à navegação por teclado (Setas Cima/Baixo para focar linha, Esquerda/Direita para recolher/expandir gavetinhas e Enter para inspecionar) e proteção contra ciclos circulares na árvore de hierarquia mãe/filha. Se recebe `bloqueios`/`onIniciarEdicao`, mostra um badge de cadeado na linha travada por outro usuário e intercepta o clique de edição para travar a nota antes de abrir a célula. O indicador de gavetinha (Nota Mãe → Filhas) é um botão de 18×18px com chevron + contador mono (`×N`) na linha-mãe; as filhas recebem uma linha-guia de árvore (traço vertical + conector horizontal) em vez de um ícone por linha. |
| `frontend/src/features/input/notes-table-skeleton.tsx` | `NotesTableSkeleton`: linhas-fantasma (`animate-pulse`) na largura aproximada das colunas reais, usada como estado de carregamento em `input-section.tsx` e `ramal.tsx` no lugar de um spinner genérico. |
| `frontend/src/features/input/rateio.tsx` | Sub-aba "Rateio de Medidas": módulo dedicado para visualização e distribuição balanceada de medidas físicas (km / un) entre grupos hierárquicos de Notas Mães e Filhas com divergência, ações rápidas (Ratear Proporcionalmente, Concentrar na Mãe, Restaurar Original), conferência matemática de saldos e gravação direta no SAP via robô SAP. |
| `frontend/src/features/input/use-bloqueios.ts` | `useBloqueios`: polling React Query de `GET /bloqueios` a cada 60s em repouso e 15s enquanto há edição com lock ativo. Sem cache em disco; devolve um `Map<Numero_Nota, Bloqueio>` e `recarregar` para invalidar imediatamente após travar/destravar. |
| `frontend/src/features/input/hierarquia-card.tsx` | Card de vínculo manual de hierarquia (nota-mãe/notas-filhas): busca a hierarquia de uma nota, lista candidatas órfãs do mesmo conjunto e aplica o vínculo (`InputApi.vincularHierarquia`). |
| `frontend/src/features/input/data-grid.tsx` | Grid somente-leitura estilo Excel sobre `react-datasheet-grid`: ordenação, redimensionamento/autofit de colunas por arraste, barra de status com soma/média/contagem da seleção e a ação de detalhes fixa criada por `stickyRightColumn`, fora de `COLUNAS` e da exportação. |
| `frontend/src/features/input/input-nota-inspector.tsx` | `InputNotaInspector`: `Sheet` read-only aberto pela ação fixa da grade; mostra primeiro dez campos presentes em `NotaInput` e depois reutiliza `CarteiraEnriquecimentoCard` por `Numero_Nota`, sem persistir ou criar colunas enriquecidas no Input. |
| `frontend/src/features/input/use-input-data.ts` | Hooks de dados da base principal: `useInputData` (React Query + snapshot IndexedDB, exporta `INPUT_DADOS_KEY`) e `useRecarregarInput` (invalidação). |
| `frontend/src/features/input/use-input-sync.ts` | Fonte única de polling de `GET /sync` por aba Input montada: 60s em repouso e 3s somente quando `sincronizando=true`; detecta mudança de versão, invalida o dataset, expõe erro/retry ao cabeçalho e mantém o aviso de fechamento durante operação ativa. |
| `frontend/src/features/input/network-sync-status.tsx` | Card apresentacional do cabeçalho para os quatro estados da rede: verificando, sincronizando, sincronizada e indisponível. |
| `frontend/src/features/input/cache.ts` | Snapshots do dataset em IndexedDB via Dexie (tabela `snapshots`, uma linha por dataset: `input-dados`, `ramal-dados`). Best-effort: falha de IndexedDB equivale a cache vazio. |
| `frontend/src/components/branded/mes-execucao-picker.tsx` | `MesExecucaoPicker`: dropdown do campo "Mês de Execução Planejado", movido para `components/branded/` para reutilização entre features (Input e futura integração COFFEE). Continua declarando sua própria fonte mono internamente (`CLASSE_SELECT_MONO` local) — não foi alterado pela revisão de consistência abaixo, por ser compartilhado com COFFEE/Carteira. |
| `frontend/src/features/input/colagem-planilha.tsx` | `ColagemPlanilha`: bloco presentacional do modo "Colar Planilha" (cabeçalho de colunas + textarea + preview), reaproveitado por `manage.tsx` e `ramal.tsx`. |

## Contrato de estado vazio e feedback dinâmico

`empty-state.tsx` define o contrato tipado compartilhado por Visão Geral,
Gerenciar e Ramal. `getInputEmptyState(sourceCount, visibleCount)` retorna
exatamente `'dataset'` quando `sourceCount === 0`, `'filter'` quando a base tem
registros mas `visibleCount === 0`, e `null` quando há linhas visíveis. Visão
Geral e Gerenciar usam `dados.registros.length` como `sourceCount`; Ramal usa a
quantidade da base Ramal antes de aplicar os filtros compartilhados.

`InputEmptyStateProps` é uma união discriminada: `{ state: 'dataset';
onClearFilters?: never }` ou `{ state: 'filter'; onClearFilters?: () => void }`.
Assim, o estado de base realmente vazia nunca oferece uma ação de filtros. O
estado filtrado mostra "Limpar filtros" somente quando o pai fornece o callback.
`InputSection` é o dono dessa ação e redefine o estado para
`FILTROS_INICIAIS`; os consumidores apenas a repassam. Quando o helper retorna
`null`, as instâncias existentes de `NotesTable`/`DataGrid` continuam montadas
sem alteração em seleção ou navegação por teclado.

Feedback dinâmico usa o live region implícito do próprio papel, sem
`aria-live` redundante: carregamento e sincronização usam `role="status"`;
falhas de carregamento/backend e `Banner tipo="err"` usam `role="alert"`;
`Banner tipo="ok"` usa `role="status"`.

## Fluxo: Overview e sub-navegação

As sub-abas do módulo vivem em `INPUT_SUBS`
(`features/input/subs.ts`, módulo leve que o `app-sidebar.tsx` importa
sem puxar a feature pro bundle inicial): Notas Gerais, Rateio de Medidas, Ramal,
Relatórios, Logs e Configurações, renderizadas pelo `SegTabs`
(`input-section.tsx:86`). O estado da aba ativa (`sub`/`setSub`) chega
via props — quem decide e persiste a aba ativa é o componente pai, o
mesmo padrão do hub COFFEE documentado em `02-frontend-coffee.md`.
`InputSection` em si só busca os dados (`useInputData`,
`input-section.tsx:30`) e faz um `switch` condicional
(`input-section.tsx:85-90`) que renderiza um dos seis componentes de
sub-aba, todos recebendo o mesmo `dados: InputDataset` já carregado
(exceto `Logs`, que não depende dele).

O `PageHeader` fica dentro de uma barra `shrink-0 bg-surface border-b
border-b-line pt-[13px] px-[22px] pb-[11px]` — o mesmo recuo do cabeçalho
do hub COFFEE (`coffee-hub.tsx:42-43`). O recuo precisa morar na barra, e
não no `PageHeader`: sem ele o cabeçalho encosta na sidebar, porque
`InputSection` usa uma casca de scroll própria (`flex flex-col
overflow-hidden h-full`) em vez do `SectionPage`
(`components/branded/section.tsx`) que dá o `padding: var(--pad)` a Carteira
e Relatórios.

Acima do conteúdo da sub-aba, `input-section.tsx` mostra até dois
banners independentes: aviso de importação inicial pendente por rede
indisponível (com botão "Tentar importar de novo" que chama
`InputApi.migrar()`), e contagem de bases da rede EDP indisponíveis
(`basesAusentes`, `input-section.tsx:65-69`). Não há mais um banner de
"dados desatualizados por outra sessão" — ver "Sincronização SAP"
abaixo, que agora revalida em background sem intervenção do usuário.

### Inspector da nota e enriquecimento da Carteira

Na Visão Geral, cada linha tem a ação semântica "Abrir detalhes da nota
{número}" em uma coluna utilitária de 44px fixa à direita. Ela é criada
separadamente por `stickyRightColumn` em `data-grid.tsx`; não entra em
`COLUNAS` nem em `cols`, para que os índices usados por `calcularSelecao`
e a soma/média/contagem continuem representando apenas colunas de dados. Por
ficar fora dessa coleção, a ação também não aparece na exportação.
O alvo clicável ocupa 44×44px, interrompe a seleção somente no próprio
botão e segue acessível por teclado. Como a DSG registra a seleção em
`mousedown` no documento, o botão interrompe `pointerdown` e `mousedown`;
ao fechar o Sheet, `onCloseAutoFocus` devolve o foco à referência concreta
do botão que o abriu. O Sheet também interrompe a propagação de `Escape`:
isso preserva a seleção porque o listener de teclado da DSG está no
`document`, sem cancelar o fechamento padrão do Radix.

Para Enter e Espaço, a célula chama explicitamente o callback de detalhes em
`keydown`, depois de interromper a propagação e prevenir o clique nativo. O
uso explícito evita tanto a interferência dos atalhos da DSG quanto uma
abertura duplicada quando o botão está dentro da grade.

`overview.tsx` mantém somente a nota aberta como estado (`notaDetalhe`) e
monta `DataGrid` e `InputNotaInspector` como irmãos. O Sheet exibe os
dez campos já disponíveis no dataset do Input e depois delega a consulta por
`Numero_Nota` ao `CarteiraEnriquecimentoCard` compartilhado. Nenhum campo
enriquecido vira coluna ou é persistido no Input. Quando a Carteira ainda não
está sincronizada, a ação chega por props até `App.tsx`, que seleciona a
sub-aba `sincronizacao` e navega para `carteira`; não há Context ou evento
global para esse handoff.

Os hooks `useInputData`/`useRamalData` hidratam o React Query com o
snapshot do IndexedDB no mount (`use-input-data.ts:22-32`,
`use-ramal-data.ts:19-29`): `lerSnapshot` (`cache.ts:27-38`) busca a
linha salva e, se a query ainda não tiver dado, um `setQueryData` com
`updatedAt` do snapshot marca o dado como stale — o próprio React
Query dispara a revalidação em background, sem estado manual. Cada
resposta boa da rede regrava o snapshot dentro do `queryFn`
(`gravarSnapshot`, `cache.ts:40-48`, chamado em `use-input-data.ts:12`
e `use-ramal-data.ts:12`). O banner "Backend indisponível — mostrando
dados salvos de {data}" usa `dataUpdatedAt` do próprio `useQuery` — não
um state paralelo — porque esse campo já reflete tanto o `updatedAt`
do seed quanto o de cada fetch bem-sucedido; `input-section.tsx:120-124`
mostra esse banner para a base principal, e `ramal.tsx:201-205` replica
o mesmo padrão na aba Ramal (erro bloqueante só quando
`error != null && !dadosRamal`, `ramal.tsx:196-200`), que antes não
tinha essa paridade. O cache não participa de escrita de notas (edições
continuam exigindo backend); o poll unificado de `/sync` segue sendo o
invalidador entre sessões. A estratégia de polling não altera nem apaga o dado
semeado: uma falha de `/sync` aparece no cabeçalho enquanto o dataset salvo
permanece disponível no cache do React Query.

## Fluxo: Edição em lote (manage.tsx)

`manage.tsx` organiza cinco modos via `SegTabs` (`MODOS`,
`manage.tsx:22-28`); trocar de modo (`trocarModo`, `manage.tsx:161-163`)
limpa a mensagem de status e a seleção atual. Os modos "Edição em
Lote" e "Exclusão" compartilham a flag `comSelecao`
(`manage.tsx:159`), que ativa as props de seleção (`selecionados`,
`onToggleSelecionado`, `onToggleTodos`) na `NotesTable` renderizada
mais abaixo (`manage.tsx:251-262`) — a mesma tabela também atende o
modo "Edição Rápida" trocando essas props pelas de edição inline
(`edicoes`/`onEditar`), nunca as duas ao mesmo tempo.

No modo "Edição em Lote" (`manage.tsx:186-221`), dois `Select`
(status e prioridade) e um `MesExecucaoPicker` (mês de execução)
definem os novos valores; como o primitivo `Select` do shadcn/Radix
não aceita `value=""`, "manter valor atual" é representado por um
valor sentinela `"__manter"` que é convertido de volta para string
vazia em `onValueChange` (`manage.tsx:191-210`). `aplicarLote`
(`manage.tsx:104-120`) monta uma linha por nota selecionada só com os
campos preenchidos e recusa a operação (mensagem de erro) se nenhuma
nota estiver selecionada ou nenhum campo tiver sido escolhido. O
`Select` customizado em si (`@/components/ui/select`) não tem doc
próprio ainda — não está documentado em `04-frontend-shared.md`.

### Bloqueio por nota (edição concorrente)

No modo "Edição Rápida", `manage.tsx` passa `bloqueios` (de `useBloqueios`),
`usuarioAtual` (`getUsuario()`) e `onIniciarEdicao` para a `NotesTable`.
`onIniciarEdicao` chama `InputApi.travarNota` antes de abrir a célula para
edição; se outra pessoa já está editando a nota, a `NotesTable` mostra um
`toast.warning` e nunca chama `onIniciarEdicao` (checagem local pelo mapa já
carregado) — `onIniciarEdicao` só é chamado, e só falha, na corrida rara em
que o mapa local está desatualizado e o backend recusa o lock. O poll usa 60s
em repouso e volta ao intervalo de 15s enquanto `edicoes.size > 0`; travar e
destravar continuam invalidando a query imediatamente.
As notas travadas por outro usuário ganham um badge de cadeado na coluna
"Nº Nota" e uma borda âmbar na linha inteira.

Como o backend confere o lock de novo no momento de salvar
(`aplicar_edicoes`), `salvarRapida` (`manage.tsx`) trata a resposta:
notas que vieram em `resultado.bloqueadas` permanecem em `edicoes` (a
digitação do usuário não é descartada) e as demais têm o lock liberado via
`InputApi.destravarNotas`. O botão "Descartar" libera o lock de todas as
notas pendentes antes de limpar `edicoes`. Não há liberação no fechamento da
aba — o TTL do backend (`BLOQUEIO_TTL_MINUTOS`, ver `06-backend-input-module.md`)
é o único mecanismo de limpeza para uma edição abandonada.

### Registro de notas — `MesExecucaoPicker` e `ColagemPlanilha`

`MesExecucaoPicker` (`mes-execucao-picker.tsx`) resolve o campo "Mês
de Execução Planejado" como dropdown em vez de texto livre, gravando
sempre `MMM-YYYY` minúsculo. `construirOpcoesMes(anoAtual)`
(`mes-execucao-picker.tsx`) gera os 12 meses do ano corrente (ano via
`new Date().getFullYear()`, nunca hardcoded) mais dois futuros fixos —
`jan-<anoAtual+1>` e `jan-2050` — sempre em janeiro. O componente
recebe `valorNeutro`/`rotuloNeutro` porque o significado de "nenhum
mês" muda por modo: no Cadastrar Nota é `'-'` (o default de
`NOTA_VAZIA`/`NOTA_RAMAL_VAZIA`); na Edição em Lote é `''` ("manter
atual", mesma convenção do sentinela `"__manter"` dos `Select` de
status/prioridade). Usado em `manage.tsx:213,289` e
`ramal.tsx:255,322`.

`ColagemPlanilha` (`colagem-planilha.tsx`) substitui o antigo bloco
"Colar Planilha" (`Card` + `Textarea` cru) por um container com uma
linha de cabeçalho fixa mostrando os rótulos das colunas esperadas
(mesmo estilo mono/uppercase do header da `NotesTable`) *antes* de
colar qualquer coisa — o formato esperado fica visível de antemão. É
puramente presentacional: recebe texto/preview/callbacks do pai
(`manage.tsx:308`, `ramal.tsx:342`) e não guarda estado próprio nem
chama a API diretamente.

## Exportação para Excel

`InputApi.exportar` (`POST /input/export`) manda o header `X-User` como
qualquer escrita — o backend audita quem exportou e recusa a chamada com `400`
sem identidade (ver `06-backend-input-module.md`). Na prática o usuário já está
definido: `input-section.tsx` resolve o nome pelo `GET /me` na montagem da aba
quando o `localStorage` ainda não tem um. Se o backend recusar, a mensagem dele
é propagada para o `toast` em vez do corpo bruto da resposta.

## Handoff de filtros {#handoff-de-filtros}

`InputSection` recebe `filtrosHandoff?: { estado: FiltersState; id: number } | null`
do `App.tsx` (ver [04-frontend-shared.md](./04-frontend-shared.md)) e
repassa ao `Overview` como `key={filtrosHandoff?.id ?? 0}` +
`filtrosIniciais={filtrosHandoff?.estado}`. `Overview` inicializa seu
estado com `React.useState<FiltersState>(filtrosIniciais ?? FILTROS_INICIAIS)`
— a `key` força a remontagem do componente a cada novo handoff (mesmo
que o usuário navegue duas vezes para o mesmo mês/plano), o que reseta
o `useState` para os novos `filtrosIniciais`. Depois de montado, os
filtros voltam a ser edição livre do usuário — o handoff só define o
estado inicial.

## Fluxo: Filtros (filters.tsx)

O `Select` "+ Adicionar campo de filtro…" (`filters.tsx`) não recebe `value` — ele é não controlado do ponto de vista do React. O efeito de "voltar para vazio depois de cada escolha" não vem de um reset explícito: `camposDisponiveis` filtra do `SelectContent` qualquer campo que já esteja em `estado.filtros`, e `onValueChange` adiciona o campo escolhido a `estado.filtros` imediatamente. Como o campo recém-escolhido some da lista de `SelectItem` no próximo render, o `SelectValue` interno do Radix não encontra mais um item correspondente ao valor selecionado e volta a exibir o `placeholder`.

Cada filtro adicionado renderiza um controle conforme o tipo (`tipoDoCampo`):
* Campo de texto livre (`"texto"`): Permite busca parcial ou busca negativa (se digitado entre asteriscos, ex: `*termo*`, o motor de filtragem em `lib.ts` reverte a lógica para ocultar os registros que contêm o termo).
* Faixa numérica mín/máx (`"faixa"`).
* Dropdown múltiplo customizado (`"multi"`): Implementado como um combobox (`MultiSelect`) premium que oferece:
  * Caixa de pesquisa com suporte a negação via asteriscos (`*termo*`).
  * Opções de **"Selecionar tudo"** (aplica-se aos itens visíveis de acordo com a pesquisa atual) e **"Limpar filtro"**.
  * Checkboxes e contador dinâmico de itens ativos.

O botão de limpar filtros zera a busca global, o seletor "Planejado 2026" e os filtros avançados ativos de uma só vez.

A busca global mantém o texto do campo responsivo e propaga `estado.busca`
após 300ms sem novas teclas, usando o helper tipado de
`src/lib/debounce.ts`. `buscarPorTextoGlobal` (`lib.ts`) memoiza o índice pela
identidade do array de registros: consultas numéricas continuam casando
`Numero_Nota` ou `Nota_Mae`, enquanto consultas textuais verificam cada campo
individualmente, sem criar correspondências artificiais entre campos vizinhos.
Os filtros avançados, inclusive a negação `*termo*`, são aplicados depois da
busca global e conservam a semântica anterior.

## Card de status das metas (settings.tsx)

`Settings` mostra o card "Metas do Plano de Recomposição" acima dos
demais (`settings.tsx`). O estado exibido (`atualizadas_em`, `erro`)
vem de `useDashboardRelatorios(null)` (`features/relatorios/use-dashboard.ts`,
query já cacheada com `staleTime` de 60s) — **nunca** do
`POST /metas/sincronizar`, porque esse endpoint tem efeito colateral
(força reimportação do Excel). O botão "Sincronizar agora" chama
`InputApi.sincronizarMetas()` dentro de um `toast.promise` e, no
sucesso, invalida `['relatorios-dashboard']` via `useQueryClient` —
o dashboard de Relatórios (se montado) refaz o fetch automaticamente.

## Relatórios Executivos (reports.tsx)

O painel de Relatórios (`reports.tsx`) oferece 3 visões consolidadas:

1. **Aderência ao Plano (`prazos`)**:
   - Consolidação unificada de auditoria de datas de encerramento SAP com índice de aderência ao plano/cronograma.
   - **Regra de Tolerância (+1 mês)**: notas com encerramento até 1 mês após o planejado são contabilizadas como **No Prazo**. Notas concluídas antes são sempre **Adiantadas**, e com 2+ meses são **Com Atraso**. A regra mora no backend (`input_module/sla.py`, ver `06-backend-input-module.md`): a tela lê `Status_SLA`, `Desvio_SLA` e `Desvio_SLA_Meses` já materializados no dataset e **não recalcula prazo** — foi assim que a tela e a exportação passaram a mostrar sempre o mesmo número.
   - **Passível de Encerramento** é um status de SLA próprio (ordem executada em campo com a nota ainda aberta), disponível no filtro "Status de SLA" e na distribuição de desvios. Antes essas notas caíam em "Dados Insuficientes".
   - **Atraso Acumulado**: Exibe a métrica total somada de todos os meses em atraso real (inclusive o 1º mês) para gestão transparente de dívida temporal.
   - **Guia de Flags**: Banner informativo integrado explicando as regras de cada status e tolerâncias.
   - KPIs consolidados: Total Auditadas, Índice de Aderência (%), Atraso Acumulado (meses), Média de Desvio Real, Adiantadas, No Prazo (+1m), Com Atraso (≥2m), Pendentes Atrasadas e Passíveis de Encerramento.
   - Gráfico de rosca de status geral lado a lado com barras de progresso de distribuição de desvios em meses.
   - Filtros avançados combinados (Filtro Rápido, Ano de Encerramento, Mês Planejado, Resultado da Auditoria, Status SLA e Regional).
   - Tabela e exportação Excel unificadas (`Aderencia_ao_Plano_{data}.xlsx`).
2. **Visão Financeira (`financas`)**:
   - Diferencia explicitamente **volume físico** (`Planejado_DDPM` em unidades/postes) de **valores monetários em R$** (`Total_planejado_modular`, `Total_planejado_ordem` e `Total_real_ordem`).
   - Apresenta KPIs e barras de progresso por Regional e por Status em R$ Modular e unidades físicas.
   - Tabela analítica completa com custos unitários modulares e ordens SAP.
3. **Em Planejamento - Status 10 (`planejamento`)**:
   - Integração com automação SAP: botão **"Extrair do SAP (Status 10)"** dispara a extração em lote no SAP GUI (`POST /api/input/status10/extrair-sap`) cruzando IW28 (status 10) e IW38 (custos de ordem).
   - Botão **"Disparar E-mail Status 10"** abre rascunho formatado no Outlook para envio aos engenheiros.
   - Tabela analítica detalhada com colunas enriquecidas (`Ordem`, `Status_Usuario`, `PEP`, `Custo_Plan`, `Modular`, `Modular_Obra`, `Criado_Por`, `Data_Nota`, etc.).

## Sincronização SAP

O botão "Sincronizar SAP" em `overview.tsx:58-66` chama
`InputApi.syncSap()` (`POST /bases/sync-sap`, `api.ts:63`) dentro de um
`toast.promise`, disparando a extração no backend em background (ver
`06-backend-input-module.md` para o que o backend faz com esse
endpoint). O botão não guarda estado de "rodando" — não fica desabilitado
enquanto a sincronização está em andamento (ver "Pontos de atenção").

Como a sincronização roda em background e pode ser disparada por
qualquer sessão, `use-input-sync.ts` mantém uma única query React Query por
aba Input montada. Ela chama `InputApi.sync()` a cada 60s em repouso e a cada
3s somente enquanto a resposta informa `sincronizando=true`, e compara
`s.versao` (`db.obter_versao_dataset()`,
Tarefa 13) com o valor conhecido (`dados?.meta.versao`, passado por
`input-section.tsx`); se mudou, dispara um `toast.info` avisando o
usuário e invalida `INPUT_DADOS_KEY` (`qc.invalidateQueries`) — a
tabela é revalidada em segundo plano automaticamente, sem exigir
clique. A Tarefa 15 trocou a comparação de `ultima_alteracao` para
`versao`: na época `service.criar_notas` não passava por
`log_alteracoes`, então criações de nota não mudavam `ultima_alteracao`
e não eram detectadas pelo polling; `versao` cobre também o `COUNT(*)`
de notas, então criações passaram a disparar o aviso (hoje a criação
também grava auditoria — ver `06-backend-input-module.md`).
Isso substituiu o antigo `useAvisoSincronizacao`, que só marcava um
flag `desatualizado` e dependia de um banner com botão "Recarregar
dados" (`useRecarregarInput`) para o usuário buscar os dados novos
manualmente.

`GET /notas` (`InputApi.dados`) também usa essa versão como `ETag`
HTTP (`W/"<versao>"`, `Cache-Control: no-cache`) — o navegador cuida
sozinho da revalidação condicional (`If-None-Match`) a cada `fetch`,
sem nenhum código extra no cliente: se a versão não mudou, o backend
responde `304` e o corpo vem do cache HTTP local em vez de trafegar o
dataset inteiro de novo.

`INPUT_DADOS_KEY` (`use-input-data.ts:6`) é a `queryKey` de
`useInputData`, exportada para que qualquer código fora do hook — o
próprio polling, `use-auto-vinculos.ts` e a integração COFFEE
(`mover-plano-modal.tsx`, ver `02-frontend-coffee.md`, fluxo "Revisar
Nota e Mover para o Plano") — invalide o mesmo cache sem duplicar o
array literal `['input-dados']`.

### Status da rede no cabeçalho

`useInputSync` alimenta o status a partir da mesma query que detecta mudanças;
não há um segundo timer para o cabeçalho. O
retorno é um estado discriminado: `verificando`, `sincronizando`,
`sincronizada` ou `indisponivel`. Apenas uma resposta bem-sucedida com
`sincronizando=false` produz o card verde "Sincronizada". Enquanto a
sincronização está ativa, o hook mantém o aviso de `beforeunload` existente.

Falhas da consulta não exibem toast repetitivo: o cabeçalho mostra "Rede
indisponível" e disponibiliza o botão acessível "Tentar novamente", que faz
uma consulta imediata. O polling continua ativo, portanto uma recuperação da
rede atualiza o card sem exigir uma ação do usuário. Os cards e o botão usam
os tokens existentes; o botão `outline` do shadcn mantém raio padrão de 6px.

### Notas vindas do COFFEE

Quando uma nota é movida do COFFEE para o plano
(`POST /api/integracao/mover-para-plano`, documentado em
`08-integracao-coffee-input.md`), o registro criado é uma linha comum
da base principal do Input — não existe nenhum campo, flag ou coluna
que marque a origem "veio do COFFEE". Na `overview.tsx`/`manage.tsx`,
uma nota assim é visualmente indistinguível de uma cadastrada
manualmente pelo modo "Cadastrar Nota"; a única forma de rastrear a
origem é do lado do COFFEE (o `revisao.ja_no_plano`/`revisao.plano` do
`GET /api/integracao/nota/{pk}/revisao`, ou o histórico de logs do
COFFEE). Vale ter isso em mente ao investigar divergências no plano —
o Input em si não guarda essa informação.

## Timings (tabela consolidada desta feature)

| Valor | Onde | O que faz |
|---|---|---|
| `60_000ms` | `use-input-sync.ts` | Intervalo de repouso da única query de `InputApi.sync()`; compara `versao`, atualiza o status e invalida `INPUT_DADOS_KEY` quando necessário. |
| `3_000ms` | `use-input-sync.ts` | Intervalo curto de `/sync`, usado somente enquanto o backend informa `sincronizando=true`. |
| `300_000ms` | `use-input-data.ts:12` | `staleTime` da query `useInputData` (React Query): por 5 minutos os dados carregados são considerados "frescos" e não disparam refetch automático em background (o default global de 60s do `QueryClient`, ver `04-frontend-shared.md`, não se aplica aqui). |
| `300_000ms` | `use-ramal-data.ts:8` | `staleTime` da query `useRamalData`, mesmo racional do `useInputData` acima — dataset separado (base "Ramal"), mesma cadência de frescor. |
| `60_000ms` / `15_000ms` | `use-bloqueios.ts` | Polling de `GET /bloqueios`: repouso / edição inline com lock ativo. Invalidações de travar/destravar continuam imediatas. |

## Pontos de atenção

- `filters.tsx:84-105` — o `Select` de "Adicionar campo de filtro" é
  não controlado; o "reset" visual depende de `camposDisponiveis`
  (`filters.tsx:48-52`) sempre excluir o campo recém-escolhido do
  `SelectContent`. Se essa lista algum dia parar de excluir campos já
  ativos (ex.: permitir múltiplos filtros no mesmo campo), o `Select`
  passa a reter a última seleção visualmente, quebrando o padrão atual
  sem nenhum aviso em tempo de compilação.
- `manage.tsx:191-210` (e o mesmo padrão em `ramal.tsx:233-252`) — o
  valor sentinela `"__manter"` para "manter valor atual" nos `Select`
  de edição em lote é uma convenção implícita: qualquer novo `Select`
  de edição em lote precisa lembrar de repetir esse mapeamento
  manualmente, não há um wrapper compartilhado que resolva isso uma
  vez.
- `app.css` (bloco `.input-scope`) — os cards do módulo Input usam
  `border-color: var(--line-2)`, igual ao resto do app. O `Select`
  interno voltou à fonte padrão (Inter) em `filters.tsx`, `manage.tsx`
  e `ramal.tsx` — a fonte mono (`CLASSE_SELECT_MONO`, revisão de
  consistência visual) saiu tanto do CSS quanto de `ui.ts` (arquivo
  removido). `MesExecucaoPicker` (`components/branded/`) é a única
  exceção: mantém sua própria mono internamente por ser compartilhado
  com COFFEE/Carteira, então o campo "Mês de Execução Planejado" ainda
  mostra o trigger em Inter com o popup em mono quando usado dentro do
  Input.
