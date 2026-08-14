# Frontend — features/carteira

Seção da Carteira de Notas: dashboard executivo, exploração da projeção
local (Databricks → `carteira_module`), movimentação para o plano,
divergências e estado da sincronização. Quatro abas: **Dashboard**
(landing), **Explorador**, **Divergências** e **Sincronização**.

## Dashboard (Fase 3b)

Aba landing (`dashboard/`), consome `GET /api/carteira/dashboard`.

- **KPIs** (`kpis-dashboard.tsx`): Meta, Planejado, Base disponível, Gap,
  Cobertura (farol reusando `features/relatorios/fmt`). Somam sobre os
  planos **com meta** (o backend já separa OPEX/sem-meta).
- **Heatmap por regional** (`heatmap.tsx`): grade de cards, % cobertura da
  regional colorida por farol; clique dá drill-down. (MVP: cobertura por
  regional, não a matriz regional×plano completa.)
- **Evolução** (`evolucao.tsx`): `ComposedChart` (Recharts via `ui/chart`) —
  barras meta/planejado/executado por mês + linha de executado acumulado.
- **Distribuição** (`distribuicao.tsx`): tabelas por plano e por regional
  (meta/planejado/base/gap/cobertura com farol), clicáveis para drill-down.
- **Drill-down interno**: clicar plano/regional troca para a aba Explorador
  com o filtro aplicado — coordenado por `carteira-section.tsx` (estado
  `drill`), sem tocar `App.tsx`. O landing default (`edp_carteira_sub`) é
  `dashboard` (App.tsx).

Dois ajustes de backend surgiram na validação visual real: (1) o dashboard
só compara meta×base para conjuntos com **meta>0** (senão a base OPEX enorme
— PODA 500k — inflava a cobertura para milhares de %); (2) o filtro
`conjunto` do Explorador passou a casar o código **OU** a `descricao_conjunto`
(o drill do dashboard passa a descrição = `Plano`, não o código).

**Convergência (Fase 4a):** `/api/carteira/dashboard` virou **superset** do
contrato de Relatórios (fonte única — ver `docs/dev/10`). Os componentes do
dashboard da Carteira passaram a ler `data.visao_anual` (filtrando `meta>0`)
e `data.regionais` — onde a base agora vive fundida — em vez das antigas
estruturas `por_plano`/`por_regional` (removidas). `DashboardCarteira` é
`DashboardRelatorios & {base_por_plano_sem_meta, versao}`. Refatoração de
fonte, não de regra: números e visual idênticos à Fase 3b.

## Movimentação (Fase 2b)

- **Seleção de linhas** no Explorador: TanStack Table `enableRowSelection`
  + `getRowId=id_onr`; checkbox por linha (com `stopPropagation` para não
  abrir o Sheet de detalhe ao marcar) + checkbox de "selecionar página".
- **Barra de ação**: aparece quando há seleção → "Mover para o plano" +
  "Limpar".
- **`mover/mover-modal.tsx`**: espelha o modal do COFFEE
  (`features/coffee/mover-plano-modal.tsx`). `POST /mover/preview` valida a
  seleção (movível/bloqueada + avisos); `MesExecucaoPicker` +
  `Status_Obra` aplicados ao lote todo; `POST /mover-para-plano` (X-User via
  `getUsuario()`) → invalida `INPUT_DADOS_KEY` + keys da carteira. A nota
  movida some do `fora_do_plano` e vira `no_plano` na próxima leitura
  (situação derivada, sem sync).
- **All-or-nothing na UI**: o botão "Mover" fica desabilitado se houver
  nota bloqueada **ou** duplicata de nº SAP na seleção (o `id_sap` não é
  único na base — 1.548 duplicatas no subset SP; dois `id_onr` virariam o
  mesmo `Numero_Nota`). O backend também recusa o lote (all-or-nothing);
  a guarda no cliente evita o clicar-e-tomar-409.
- **`DialogContent`** portalizado não precisa de classe de escopo: desde a
  Fase 4c os tokens vivem em `:root` e o portal os herde direto do `<html>`.
- **Aba Divergências** (`divergencias/divergencias.tsx`): consome
  `GET /divergencias`; badge por tipo (`cancelada`/`ausente_na_origem`).
  Só alerta; nada é alterado automaticamente.
- **Atalho**: o card "fora do plano" dos Relatórios ganhou "Ver na
  carteira" → abre o Explorador filtrado por `situacao=fora_do_plano`
  (handoff via `App.tsx`, padrão `filtrosHandoff`).

## Estrutura

```
frontend/src/features/carteira/
  api.ts                     CarteiraApi (fetch, padrão req<T> do InputApi)
  types.ts                   espelho dos tipos de resposta do backend
  situacao.ts                mapa SituacaoCarteira -> {rotulo, variant}
  subs.ts                    abas (import-light, não puxa a seção)
  use-carteira-notas.ts      página paginada (keepPreviousData)
  use-carteira-enriquecimento.ts consulta SAP por número, sob demanda, sem estado local
  carteira-enriquecimento-card.tsx card read-only compartilhado pelos inspectors de Input e COFFEE
  use-carteira-resumo.ts     KPIs (seeded via Dexie)
  use-carteira-sync.ts       estado + mutação de sincronização
  carteira-section.tsx       shell: PageHeader + SegTabs
  explorador/
    filtros.tsx              busca + Select regional/situação
    kpis.tsx                 StatTiles do resumo
    colunas.tsx               ColumnDef<NotaCarteira> (TanStack Table)
    tabela.tsx                tabela paginada + navegação
    detalhe-sheet.tsx         Sheet lateral com o detalhe da nota
    explorador.tsx            composição da aba
  sincronizacao/
    sincronizacao.tsx         estado, histórico, botão "Sincronizar agora"
```

## Estado servidor

React Query em tudo. `useCarteiraNotas` usa `keepPreviousData` (evita
flicker na paginação). `useCarteiraResumo` usa o hook compartilhado
`useSeededQuery` (`frontend/src/hooks/use-seeded-query.ts`) — extraído
por Rule of Three a partir do padrão seed→revalidate já usado em
`useInputData`/`useRamalData`.

`useCarteiraEnriquecimento(numeroSap, enabled)` busca
`GET /api/carteira/notas/por-sap/{numeroSap}` somente quando o inspector
consumidor está aberto e recebe um inteiro seguro positivo. A query usa a chave
`['carteira', 'enriquecimento', numeroSap]`, com `staleTime=300_000` e
`retry=1`. O contrato discriminado preserva os estados do backend e seus campos
anuláveis; o hook não persiste dados nem renderiza UI.

## Card de enriquecimento SAP

`CarteiraEnriquecimentoCard` é o wrapper do React Query e delega a renderização
para `CarteiraEnriquecimentoContent`, componente puro usado nos testes SSR. É a
apresentação read-only compartilhada pelos inspectors de Input e COFFEE. O card
preserva a hierarquia da base: `descricao_conjunto` é a rubrica, `conjunto` é o
contexto e o `dl` responsivo mostra os outros sete campos, totalizando os nove
campos do contrato. Valores `null` ou vazios aparecem como travessão; nenhuma
PII entra no tipo ou na UI.

O sync valida o esquema recebido por blocos de enriquecimento e persiste em
`carteira_meta` avisos estruturados com código, bloco, campos públicos, mensagem
e ação fixos. O contrato de `GET /api/carteira/notas/por-sap/{numeroSap}` expõe
esses avisos sem copiar valores, exceções, caminhos ou identificadores da fonte.
Como o metadado acompanha a versão da projeção, o ETag continua usando a mesma
moeda de revalidação.

Quando há aviso, o card mantém os campos válidos e apresenta um banner de status
com ação para a aba Sincronização. Campos pertencentes ao bloco incompatível
aparecem como `Indisponível`; valores válidos iguais a zero continuam aparecendo
como `0`, sem serem confundidos com ausência.

Os estados são intencionalmente distintos: carregamento é local ao card;
erro real de consulta (ou resposta incompatível) mostra alerta com retry;
`sem_correspondencia` é uma ausência neutra sem retry; e
`base_nao_sincronizada` explica a pré-condição e oferece a ação de navegação.
Em `ausente_na_origem` (tombstone), os dados preservados continuam visíveis
junto do aviso e da data. Nenhum outro estado oferece retry.

Durante uma atualização gradual, o card também trata `avisos` ausente como uma
lista vazia. Assim, um corpo legado em cache não quebra o inspector; o ETag da
nova representação obriga sua revalidação antes da próxima resposta normal.

## Direção visual — Supabaze (DESIGN.md)

A Carteira foi a primeira feature construída na direção visual do
DESIGN.md. **Desde a fundação da Fase 4c-0 ela deixou de ser exceção:**
os tokens Supabaze são o padrão global em `:root` e a Carteira virou o
**ponto de não-regressão** da migração — se ela mudar de aparência,
a fundação está errada.

**`.carteira-scope` não existe mais.** A classe foi removida na 4c-fim: a
Carteira herda a paleta de `:root` como qualquer outra seção e **acompanha o
tema do app** — canvas branco no claro, `canvas-night` no escuro. O canvas
branco continua sendo o compromisso autoritativo do DESIGN.md para o tema
claro, mas deixou de ser imposto à força sobre um app escuro.

**Duas armadilhas reais encontradas na implementação** (continuam
valendo para quem mexer em token):

1. **Cascade layers.** Os blocos de token são CSS *sem layer*
   (unlayered). CSS sem layer sempre vence CSS dentro de `@layer`,
   **independente de especificidade do seletor** — mesmo padrão usado
   por `[data-slot="sidebar-container"]` no rodapé do arquivo. Um
   override de token colocado dentro de `@layer components` perde
   silenciosamente: sem erro, sem warning, só o valor errado.
2. **Bridge parcial.** Uma custom property herdada (`--background:
   var(--bg)`) já resolveu seu valor *no ancestral* — mudar `--bg` num
   descendente não a recalcula. Todo escopo que redefina token cru
   precisa redeclarar a ponte shadcn inteira junto. É por isso que a
   ponte mora no bloco do tema claro, e não no bloco do tema escuro — este
   pinta o mesmo elemento que `:root` e por isso recalcula sozinho.

**Conteúdo portalizado** (Sheet, Select) renderiza fora da árvore DOM da
seção e resolve os tokens direto de `:root`. Não é preciso replicar escopo
nenhum no call site — as classes que faziam isso à mão em `detalhe-sheet.tsx`,
`explorador/filtros.tsx` e `mover/mover-modal.tsx` saíram na 4c-fim.

**Correção de acessibilidade:** o padrão herdado do tema escuro
(`bg-tint-green` + `text-green`) usa o verde-esmeralda como cor de
*texto* — falha AA (1.96:1) em canvas branco. O badge `situPlano`
(situação "no_plano") foi corrigido para o padrão real do DESIGN.md
(`pill-tag-green`): preenchimento sólido + texto quase-preto. Os
outros três tons de status (`indigo`/`amber`/`red`) foram escurecidos
a partir dos valores literais do DESIGN.md para passar AA como texto
pequeno sobre a própria tinta — os valores puros do doc (ex.:
`accent-yellow #ffdb13`) são claros demais para isso.

**Ainda em aberto:** a mesma convenção tint+texto-colorido vale para as
outras 11 variantes de `ui/badge.tsx` (`tagOk`, `tagErr`, `tagDone`,
`tagDup`, `prio*`, `situExec`, `situFora`, `situCancel`), que só o
`situPlano` corrigiu. Com o canvas branco global desde a 4c-0, elas
falhavam AA. Corrigido: as três variantes verdes passaram ao padrão
`pill-tag-green` do DESIGN.md (verde sólido + tipo quase-preto) e `prioNone`
trocou a tinta terciária pela secundária. No tema escuro os tons são
clareados por `:root[data-theme="dark"]` e o problema não ocorria.

## Sync dot — a assinatura da tela

Um indicador de frescor (`--carteira-sync-dot`, em `app.css`): verde
= projeção sincronizada, âmbar pulsante = sincronizando. É a mesma
linguagem do "dot" que o DESIGN.md repete como único evento cromático
da marca (wordmark, CTA) — aqui carrega informação real, já que a
tela inteira é sobre a frescor dos dados vindos do Databricks.

## Bugs reais encontrados na validação visual (e corrigidos)

A validação visual (screenshot real via Puppeteer/Chrome, com backend
+ dados reais da sincronização) encontrou dois defeitos que os testes
unitários (com origem mockada) não pegavam:

1. **`"nan"` literal em colunas de texto.** `DataFrame.to_dict("records")`
   preserva `float('nan')` para células vazias; `mapping._texto`
   checava só `valor is None`, que não captura NaN. Corrigido com
   `valor != valor` (truque IEEE754: NaN é o único valor que não é
   igual a si mesmo — evita importar pandas num módulo de domínio
   puro). Coberto por teste (`test_normalizar_linha_trata_nan_do_pandas_como_ausente`).
2. **UPDATE de reconciliação inviável em escala.** A versão original
   usava uma subquery correlacionada *por coluna* (23 subqueries × 98k
   linhas) — rápido quando é 100% INSERT (primeira sync), mas travou
   por minutos quando a maioria das linhas precisa de UPDATE (o caso
   comum de uma sync completa noturna). Reescrito como um único
   `UPDATE ... FROM` (JOIN real) + `id_onr INTEGER PRIMARY KEY` na
   tabela de staging (dá um índice de graça). 63.841 UPDATEs em 45s,
   antes travava indefinidamente.

## Fora de escopo (fases seguintes)

Mover-para-plano em lote, `plano_movimentacoes`, coluna `origem` no
Input, aba Divergências → Fase 2. Dashboard completo (evolução
mensal/acumulada, heatmap, drill-down), filtros salvos, command
palette → Fase 3.
