# Componentes e infraestrutura compartilhada

## Seção default e navegação (App.tsx)

`AppSection` (`types.ts`) é `"relatorios" | "coffee" | "input" |
"configuracoes"`. `AppContent` inicializa `section` com
`useState<AppSection>("relatorios")` — a home do app é o dashboard de
Relatórios (`features/relatorios/relatorios-section.tsx`), não mais o
COFFEE. `RelatoriosPage` persiste a subaba em `edp_relatorios_page`, e o
item expansível "Relatórios" no `app-sidebar.tsx` espelha Dashboard geral,
Carteira por regional, Mensalização, Financeiro, Postergações e Exportar.
Os detalhes do módulo estão em [09-frontend-relatorios.md](./09-frontend-relatorios.md).
O `app-sidebar.tsx` também tem o grupo **Carteira** (Databricks) com as
sub-abas de `features/carteira/subs.ts` — ver [11-frontend-carteira.md](./11-frontend-carteira.md).

### Handoff de filtros pro Input

`RelatoriosSection` não navega diretamente — devolve callbacks
(`onVerNotasDoMes`, `onVerPlano`, `onIrParaCoffee`) que o `App.tsx`
resolve via `irParaInputFiltrado(filtros: Filtro[])`:

```tsx
const [filtrosHandoff, setFiltrosHandoff] =
  React.useState<{ estado: FiltersState; id: number } | null>(null);

function irParaInputFiltrado(filtros: Filtro[]): void {
  setFiltrosHandoff((prev) => ({ estado: { busca: "", filtros }, id: (prev?.id ?? 0) + 1 }));
  setInputSub("visao");
  changeSection("input");
}
```

O `id` incremental força o `Overview` do Input a remontar
(`key={filtrosHandoff?.id}`) mesmo quando os filtros mudam para o
mesmo conjunto de valores duas vezes seguidas — ver
[03-frontend-input.md](./03-frontend-input.md#handoff-de-filtros).
`onIrParaCoffee` abre `coffeeSub` em `"concluidas"`, cria um handoff com o
filtro `"corrigida"` e troca a seção para `"coffee"`. Assim, o relatório
leva o usuário diretamente ao histórico filtrado de notas corrigidas fora do
plano.

## Dashboard de Relatórios (features/relatorios/)

A seção home (`relatorios-section.tsx`) tem o título fixo "Dashboard
Geral" com subtítulo "Plano de Recomposição \<ano>" (`PageHeader`,
`relatorios-section.tsx:54`) e organiza o conteúdo em duas partes:
uma barra de resumo fixa mais uma navegação por três sub-abas
(`SegTabs`, ligada ao estado de sub-aba que vem de `App.tsx`/
`AppSidebar` — ver seção anterior).

**Filtros no cabeçalho** (`relatorios-section.tsx:59-90`) — dois
`Select` lado a lado:
- **Mês** — "Mês atual" (sentinel `'atual'`, mapeado para `mes: null`)
  ou um dos 12 meses do ano corrente. Vira o parâmetro `mes` de
  `InputApi.dashboardRelatorios({ regional, mes })`
  (`features/input/api.ts`), repassado ao backend como querystring
  (`GET /relatorios/dashboard?mes=`, ver `06-backend-input-module.md`).
  Selecionar um mês passado/futuro re-projeta o hero e os cards de
  regional para aquele mês, sem sair da sub-aba atual.
- **Regional** — inalterado (SP/todas ou uma das 6 regionais).

`useDashboardRelatorios(regional, mes)` (`use-dashboard.ts`) inclui
`mes` na `queryKey` (`['relatorios-dashboard', regional, mes]`) —
trocar de mês gera uma entrada de cache própria no React Query, sem
invalidar as demais combinações já buscadas.

**Resumo fixo** (`resumo-fixo.tsx:22-46`) — barra sempre visível
mostrando resumo do mês (o mês de referência escolhido, `data.mes_referencia`
— campo renomeado de `mes_corrente`): rótulo do mês, %Disp (com cor de
farol `farol()`, `resumo-fixo.tsx:29`), Exec (% execução), Gap R$
extraído do `financeiroAno` (`resumo-fixo.tsx:36`) e botão para
alertas.

**Navegação por sub-abas** (`SegTabs<RelatoriosSubPage>`,
`relatorios-section.tsx:111`) — três visões mutuamente exclusivas;
a aba ativa (`sub`) e sua persistência vêm de fora (`App.tsx`, ver
seção anterior), não de `useState` local:

- **Aba Mês** (`aba-mes.tsx`) — padrão ao carregar. Exibe: hero
  do mês (KPIs executado/meta), alertas de carteiras abaixo da meta
  (`AlertasCarteira`) e cards de saldo por regional (`RegionaisCards`).
  O botão de atalho para o COFFEE mudou de "N corrigidas no COFFEE
  fora do plano →" para **"N nota(s) fora do plano →"**
  (`relatorios-section.tsx:124`) — o contador em si
  (`useForaDoPlano`/`GET /integracao/resumo-fora-do-plano`) agora é
  por usuário (ver `08-integracao-coffee-input.md`), então o rótulo
  genérico evita insinuar que é uma contagem global.
- **Aba Planos** (`aba-planos.tsx`) — tabela anual (visão de
  todos os planos da carteira, `TabelaAnual`) mais financeiro
  completo do ano (Carteira/Meta/Gap RS).
- **Aba Mensalização** (`aba-mensalizacao.tsx`) — gráfico de
  evolução mensal (`MensalizacaoChart`) mais tabela de detalhes
  mensais (`TabelaMensal`), ambos recebendo `data.mes_referencia`.

**Relocação do Financeiro do ano:** mudou de feature integrada no hero
(antes) para feature específica da aba Planos (agora). A barra resumo
exibe apenas o Gap R$ como métrica rápida.

**Rótulo "qtd DDPM":** todo número de quantidade planejada (hero,
`StatTile`s, `RegionaisCards`, `TabelaMensal`, `MensalizacaoChart`) traz
o sufixo "qtd DDPM" no texto ou em `title`/`aria-label` — deixa
explícito que aqueles números vêm do campo `Planejado_DDPM` (unidade
por plano) e não são contagem de notas nem valor em R$ (esse último só
aparece nos blocos "financeiro"/Gap R$).

**Gráfico de mensalização (`mensalizacao-chart.tsx`):** reescrito de
SVG artesanal para `recharts` (`BarChart`) sobre a composição
`ChartContainer`/`ChartTooltip`/`ChartLegend` de `components/ui/chart.tsx`
(shadcn "chart"), com `CHART_CONFIG` mapeando `meta`/`carteira`/
`executado` para os tokens `--surface-2`/`--accent`/`--green-2`. Mantém
o comportamento anterior (mês de referência destacado via
`ReferenceArea`, executado zerado para meses futuros) mas ganha
tooltip/legenda acessíveis "de fábrica" via Radix/recharts em vez de
`<title>` de SVG. Nova dependência: `recharts` (`package.json`).

## Configurações (features/configuracoes/)

`configuracoes.tsx` é a tela "Configurações" da sidebar: três `Card`
(Aparência, Exibição, Logs) que leem e escrevem em `useSettings()`
(`configuracoes.tsx:23`). Tema, densidade e cor de destaque (accent)
usam `ToggleGroup`/paleta de botões; "Mostrar KPIs" e "Habilitar logs
de Dev" usam `Switch`.

O estado central mora em `context/settings-context.tsx`: um único
objeto `Settings` (`theme`, `density`, `accent`, `showKpis`, `devLogs`,
`settings-context.tsx:4-10`) com valores padrão em `DEFAULTS`
(`settings-context.tsx:18-24`, tema `"system"`, densidade `"cozy"`).
`setSetting` (`settings-context.tsx:60-66`) faz merge imutável e grava
em `localStorage` sob a chave `edp_settings`
(`saveSettings`/`loadSettings`, `settings-context.tsx:26-38`) a cada
mudança — não é `usePersistedState` (que usa `sessionStorage` e serve
para estado efêmero de navegação, ver "Hooks compartilhados" abaixo);
`settings-context.tsx` implementa sua própria leitura/escrita porque
precisa persistir entre sessões (fecha o navegador, preferência
continua) e faz merge com `DEFAULTS` para tolerar chaves novas
adicionadas depois que o usuário já tinha algo salvo.

Tema "Sistema" é resolvido via `window.matchMedia("(prefers-color-scheme:
dark)")` (`getSystemTheme`, `settings-context.tsx:40-42`), com um
listener de mudança (`settings-context.tsx:50-55`) para acompanhar o
SO em tempo real; `resolvedTheme` (`settings-context.tsx:57-58`)
resolve `"system"` para `"dark"`/`"light"` e é o valor exposto pelo
contexto — nenhum consumidor downstream precisa saber sobre
`"system"`.

A aplicação de fato acontece no **`<html>`**, não no container do App:
um efeito no `SettingsProvider` (`settings-context.tsx:75-88`) escreve
`data-theme={resolvedTheme}`, `data-density={settings.density}` e as
três custom properties de accent em `document.documentElement`. Os
seletores correspondentes em `app.css` são `:root[data-theme="dark"]`
e `:root[data-density="compact"]` — CSS puro reagindo a um atributo do
DOM, sem re-render de componente.

O motivo de morar no `<html>` e não no `<div>` raiz é o Radix:
`Select`, `Sheet`, `Dialog`, `Tooltip` e o Sonner portalizam no
`<body>`, fora da árvore do App. Com o tema em `:root` eles herdam os
tokens certos sem que cada call site precise replicar o escopo à mão.

Antes da Fase 4c isso era compensado manualmente por **três** mecanismos
paralelos: a classe raiz replicada em 18 conteúdos portalizados, o hook
`useCoffeePortalTheme` e sua cópia byte-a-byte
`useRelatoriosPortalTheme`. Os três foram removidos na 4c-fim — não
existe mais nenhum lugar no código que precise propagar tema, densidade
ou accent para um portal. Se um portal aparecer com a cor errada, o bug
está em `:root`, não no call site.

O container raiz (`App.tsx`) mantém `data-theme` e `data-density` (hoje
redundantes com o `<html>`, mas é onde o `accentStyle` inline vive) e a
classe `triage`, que ancora as regras injetadas por
`features/verificar/dashboard.tsx`.

**Presets de accent:** `ACCENT_PRESETS` (`settings-context.tsx`) é a
fonte única, consumida por `configuracoes.tsx`. Só valores do DESIGN.md
(esmeralda, `accent-indigo`, `accent-violet`). Como o accent é aplicado
inline e estilo inline vence `:root`, `loadSettings()` valida o valor
salvo no `localStorage` contra a lista e cai no padrão se não
reconhecer — sem isso, quem tivesse a paleta EDP legada gravada
continuaria vendo a marca antiga sobre o canvas Supabaze.

Cada preset é uma **quádrupla** `[sólido, hover, tint, tipo-sobre-o-sólido]`.
O quarto valor existe porque o pareamento não é derivável do tema: o
esmeralda `#3ecf8e` exige tipo quase-preto (8,98:1; com branco daria
2,0:1) e os acentos escuros exigem branco (6,0:1; com quase-preto
daria 2,9:1). Ele vira `--accent-fg`, que a ponte mapeia para
`--primary-foreground` — ou seja, é o que decide a cor do texto de
**todo botão primário do app**. `src/tokens.test.ts` afere o contraste
de cada preset.

## components/branded/

`section.tsx` concentra as composições visuais do app — "compositions
built on top of ui/", na definição do CLAUDE.md. **Desde os lotes 4c-1
a 4c-5 nenhuma delas depende de classe `.edp-*`:** a anatomia que
morava em CSS virou utilities Tailwind dentro dos próprios
componentes, que passaram a ser o único lugar onde essas decisões
visuais existem.

Três exports novos, criados na 4c porque as classes que substituem
estavam espalhadas soltas pelas features:

- **`Eyebrow`** — rótulo técnico (mono, 10px, caixa alta, tracking
  largo). Substitui `.edp-eyebrow`, que tinha 55 usos em 34 arquivos.
  Aceita **`asChild`**: o rótulo aparece em `dt`, `label`, `h2` e
  `li`, e trocar a tag por `span` quebraria `htmlFor`,
  `aria-labelledby` e a hierarquia de headings. Sempre use `asChild`
  quando o elemento não for um `span`.
- **`StatNumber`** — número display tabular com tracking negativo.
  Substitui `.edp-num`.
- **`SectionPage`** — casca padrão de subseção (coluna com
  `--gap`/`--pad` e rolagem própria). Substitui `.edp-page`. Os dois
  tokens ficam como arbitrary value de propósito: são reativos a
  `data-density` em runtime.

Os quatro que já existiam:

- **`PageHeader`** — cabeçalho de seção: eyebrow opcional + título +
  subtítulo + slot de ação à direita.
- **`StatTile`** — tile de KPI, hoje composto de `Eyebrow` +
  `StatNumber`.
- **`Banner`** — banner de status inline (`ok`/`err`), `role="status"`.
- **`SegTabs`** — envolve o `ToggleGroup` do shadcn e troca a pele
  padrão (caixa) por sublinhado, preservando a acessibilidade Radix
  (roving tabindex, navegação por setas). É o padrão de sub-navegação
  usado por `input-section.tsx` e pelo hub COFFEE. As utilities da
  pele levam `!` para vencer as da variant `outline` do primitivo.
- **`MesExecucaoPicker`** (`mes-execucao-picker.tsx`) — ver abaixo.
- **`MesExecucaoPicker`** (`mes-execucao-picker.tsx:40-69`) — dropdown
  do campo "Mês de Execução Planejado" que resolve o valor sempre em
  formato `MMM-YYYY` minúsculo (ex.: `jan-2026`). Recebe
  `value`/`onChange`/`valorNeutro`/`rotuloNeutro`/`id?`/`className?` —
  exporta também `construirOpcoesMes(anoAtual)` para gerar as 12 opções
  do ano corrente mais dois futuros fixos (janeiro do ano seguinte,
  janeiro de 2050). Usado pelo módulo Input em `manage.tsx` e
  `ramal.tsx` (Cadastrar Nota, Edição em Lote); será consumido também
  pela integração COFFEE.

## components/ui/ (shadcn)

Por decisão registrada em CLAUDE.md desde o SP1, `src/components/ui/`
é vendorizado mas é código do projeto — editável diretamente para
tematizar, redimensionar ou ajustar comportamento padrão de um
primitivo, em vez de mantido intocado como em outros projetos shadcn.

`chart.tsx` foi adicionado via `npx shadcn@latest add chart` (dependência
`recharts`) para o gráfico de mensalização de Relatórios — stock, sem
customização própria; ver "Dashboard de Relatórios" acima.

Dois componentes têm customização real, ambas adicionadas no SP2b
(`docs/superpowers/specs/2026-07-08-sp2b-shadcn-component-swaps-design.md`)
para reproduzir exatamente um padrão visual que antes era CSS/JSX
manual:

- **`badge.tsx`** — além das 6 variantes stock do CLI
  (`default`, `secondary`, `destructive`, `outline`, `ghost`, `link`),
  tem 8 variantes específicas do projeto: `tagOk`, `tagErr`, `tagDone`,
  `tagDup` (`badge.tsx:21-24`, substituem `.edp-tag.ok/err/done/dup`) e
  `prioHigh`, `prioMed`, `prioLow`, `prioNone` (`badge.tsx:25-28`,
  substituem `.edp-prio.high/med/low/none`). Cada variante reproduz
  pixel a pixel o tom/tint/formato do CSS manual anterior (mono
  uppercase para as `tag*`, `min-width: 26px` para as `prio*`) — a spec
  SP2b as descreve como reprodução exata dos antigos `.edp-tag`/`.edp-prio`
  para os 8 call sites conhecidos em `shared.tsx` e `dashboard.tsx`.
- **`progress.tsx`** — a prop `indicatorClassName`
  (`progress.tsx:9,25`) não existe no output padrão do CLI; foi
  adicionada no SP2b para que call sites possam colorir o indicador via
  `className` em vez de cor hardcoded. Hoje `upload-screen.tsx`,
  `kpi-drawer.tsx` e `coffee-abrir.tsx` usam a prop; o painel de malha fina
  usa o indicador padrão.

Dois outros ganharam customização na Fase 4c:

- **`table.tsx`** — a pele de tabela do projeto (header mono uppercase
  com hairline, zebra sutil, corpo 12,5px) era **duas classes CSS
  paralelas**: `.edp-table` nas 7 tabelas de Relatórios e
  `.carteira-table` nas 4 da Carteira. Toda tabela do app usava uma das
  duas. A pele passou para dentro do primitivo, então `<Table>` já vem
  com ela e os call sites não carregam mais classe de skin.
- **`badge.tsx`** — as variantes verdes (`tagOk`, `prioLow`,
  `situPlano`) usavam a convenção `bg-tint-green` + `text-green`,
  herdada do tema escuro. Sobre o canvas branco global isso dá 1,86:1.
  Passaram ao padrão `pill-tag-green` do DESIGN.md: preenchimento
  sólido + tipo quase-preto (`text-on-green`), 8,98:1. A variante
  `prioNone` trocou `text-text-mute` (2,7:1) por `text-text-dim`
  (4,95:1). As demais (`tagErr`, `tagDone`, `situExec`, `situFora`,
  `situCancel`) já passavam AA e ficaram como estavam.
- **Tokens de texto cromático** — superfícies verdes usam `text-on-green`
  (quase-preto, o `on-primary` do DESIGN.md); a `tagDup` índigo usa
  `text-on-dark` (branco por token). `Button` e a variante destrutiva de
  `Badge` usam respectivamente `text-primary-foreground` e
  `text-destructive-foreground`: nenhum primitivo carrega `text-white`
  literal. Como o vermelho fica claro no tema escuro, esse foreground
  troca para quase-preto nesse tema e mantém AA. Os `rounded-full` de
  badges, chips e barras de progresso são
  semânticos e não são botões; `Button` continua em `rounded-md`, mapeado ao
  raio de 6px de `--radius`.

Os demais componentes lidos para esta doc — `select.tsx`, `sheet.tsx`,
`dialog.tsx`, `alert-dialog.tsx` — são majoritariamente stock: mesma
estrutura de sub-componentes, mesmas classes utilitárias e mesmos
`data-slot` que o `npx shadcn add` gera por padrão, sem variante ou
prop além do que o primitivo Radix já expõe. São consumidos como
vieram do CLI, com o wiring de call sites feito nas features (não
dentro do próprio arquivo `ui/`).

## Sistema de tokens (app.css)

O arquivo abre com a ordem de camadas do Tailwind v4
(`app.css:2`, `@layer theme, base, components, utilities;`) e os
imports de `theme.css`, `utilities.css`, `preflight.css` e
`tw-animate-css` (`app.css:3-6`). Essa ordem importa porque, na mesma
especificidade, **utilities sempre vence components**. Foi a regra que
motivou, no SP2a
(`docs/superpowers/specs/2026-07-06-sp2a-preflight-tailwind-utilities-design.md`),
mover o antigo bloco de classes de anatomia para dentro de `@layer
components`, para que utilities Tailwind aplicadas na mesma tag
voltassem a vencer. Esse bloco não existe mais: a Fase 4c dissolveu a
anatomia dentro de `components/ui/` e `components/branded/`, e o que
sobrou em `@layer components` é só o escopo do módulo Input.

### Os três blocos de token

A paleta é a Supabaze do `DESIGN.md`. **Nenhum token é escopado por
classe** — não existe mais `.edp`, `.carteira-scope` nem qualquer escopo
local de paleta. `app.css` tem três blocos:

1. **`:root`** — tipografia, tracking, geometria, densidade `cozy` e o
   tema **claro** completo, incluindo a ponte shadcn inteira. É o
   canvas branco autoritativo, herdado por toda seção — a Carteira
   inclusive, que deixou de ser exceção.
2. **`:root[data-theme="dark"]`** — o tema **escuro**, traduzido para
   `canvas-night` (`#1c1c1c`/`#202020`). A paleta EDP legada (navy,
   índigo `#6b5ce6`, ciano `#1f9fd6`) não existe mais.
3. **`:root[data-density="compact"]`** — densidade.

Duas coisas não óbvias, que quebram silenciosamente se desfeitas:

- **A ponte shadcn mora só no bloco claro.** Uma custom property
  herdada já resolveu seu valor no ancestral e não recalcula quando um
  **descendente** troca o token cru — por isso qualquer escopo local
  que redefina `--bg` precisaria redeclarar `--background` junto (a
  armadilha da Fase 1b). O bloco escuro é imune: pinta o **mesmo
  elemento** que `:root`, então `--background: var(--bg)` recalcula
  sozinho lá. Isso vale para o dia em que alguém quiser escopar uma
  tela de novo.
- **A densidade fica num bloco separado.** Os quatro tokens precisam
  reagir ao atributo em runtime, então não podem ser reescritos por um
  escopo que só queira mudar cor.

O bridge `@theme inline` (`app.css:12-75`) expõe as variáveis
semânticas como utilities reais do Tailwind (`bg-surface`,
`text-text-mute`, `rounded-app-md` etc.) — sem o bridge, esses tokens
só existiam como CSS custom properties, inacessíveis a className. A
escala de raio do app é prefixada
(`--radius-app-sm/--radius-app/--radius-app-md/--radius-app-lg`,
mapeada de `--r-sm/--r/--r-md/--r-lg`) para não colidir com
`--radius-sm/md/lg` do shadcn, mapeada de `--radius`. **Os dois
sistemas são independentes desde a 4c-0:** `--radius` é `6px` fixo — o
raio-assinatura de botão do DESIGN.md — e a escala `--r-*` é
6/8/12/16px. Mexer em `--r` não move o `--radius` do shadcn.

Além de cores de preenchimento/texto, `app.css` centraliza
`--status-*-border` e as sombras `--shadow-floating`/`--shadow-drawer`.
Verify e Input usam esses tokens em CSS-in-JS, SVG e dados de gráfico, em vez
de repetir hex/RGBA literais nos componentes. Assim os feedbacks de status
continuam cromáticos, mas acompanham tema e contraste pela fonte única.

`components/ui/design-tokens.test.ts` trava o contrato dos primitivos: CTA
primário com `text-primary-foreground`, botão com `rounded-md` (não pill),
destrutivo com foreground semântico e badge índigo com `text-on-dark`.

**Exceção deliberada:** `--pad`, `--gap`, `--row-py` e `--tile-py`
ficam fora do bridge. A spec SP2a é explícita sobre o motivo: esses
quatro tokens são reativos ao atributo de densidade — "virar Tailwind
spacing scale estática quebraria essa alternância em runtime". Onde
usados, seguem como estão: inline ou como arbitrary value
(`p-[var(--pad)]`), nunca como uma classe Tailwind gerada em
build-time, porque uma classe assim não teria como reagir à troca de
`data-density` no cliente.

**Guarda automatizada:** `src/tokens.test.ts` lê `app.css`, extrai os
hexes dos blocos claro e escuro e afere contraste WCAG dos pares que
carregam texto, nos dois temas. Afere também o pareamento de cada
preset de accent. E trava a estrutura: que a paleta é declarada uma vez
só e sem escopo por classe, que tema e densidade são atributos de
`:root`, que nenhum hex legado ressuscitou e que nenhuma classe de
anatomia legada voltou a aparecer em `.tsx`.

Preflight global (`@import "tailwindcss/preflight.css" layer(base);`,
`app.css:5`) foi ligado no SP2a e substituiu o hack `.ui-reset`
aplicado manualmente em ~13 raízes de tela — antes do SP2a, o restante
da árvore só tinha reset escopado a `[data-sidebar="sidebar"]`, então
qualquer tela nova precisava lembrar de aplicar `.ui-reset` para não
herdar margin/list-style/appearance nativos do browser. Com preflight
global, esse reset é automático em toda a árvore e o hack virou no-op
(removido dos ~13 arquivos que o usavam).

Alguns blocos ficam deliberadamente **fora** de `@layer` (unlayered),
depois do bloco de escopo do Input:

- `[data-slot="sidebar-container"]` zera a
  `border-right`/`border-left` do container fixo da sidebar shadcn —
  precisa vencer a utility `border-r` (que está em `@layer utilities`),
  e CSS sem layer sempre vence CSS com layer, então esse override
  precisa ficar fora de qualquer `@layer` para funcionar.
- O bloco do Sonner (`[data-sonner-toaster]`) mapeia as variáveis do
  toast aos tokens do sistema; herda via `:root` porque o Sonner
  portaliza no `<body>`. Com o tema no `<html>` a partir da 4c-0, o
  toast passou a seguir o tema do usuário — antes resolvia sempre a
  paleta escura, independente da preferência.
- `.carteira-sync-dot` — o indicador de frescor da sincronização,
  também unlayered para vencer utilities. É o único átomo visual que
  sobreviveu como CSS puro; tudo mais virou componente na Fase 4c.

## React Query (main.tsx)

O `QueryClient` único do app é criado em `main.tsx:14-22` com
`defaultOptions.queries`:

- **`staleTime: 60_000`** — por 1 minuto após buscar, uma query é
  considerada "fresca" e React Query não dispara refetch automático
  (nem por remontagem nem por foco de janela). Antes deste default,
  o `QueryClient` não tinha `staleTime` configurado (implícito `0`),
  então **toda** query refazia fetch a cada remontagem/foco — inclusive
  o dataset inteiro do módulo Input, que é grande. Hooks que precisam
  de um frescor diferente sobrescrevem por query (ex.: `useInputData`
  e `useRamalData` usam `staleTime: 300_000`, 5 minutos — ver
  `03-frontend-input.md`).
- **`gcTime: 30 * 60_000`** (30 minutos) — tempo que uma query inativa
  (sem observador montado) fica em cache antes de ser descartada.
  Mantém dados já buscados disponíveis para reexibição instantânea ao
  trocar de aba e voltar, sem refazer o fetch.
- **`retry: 1`** — mesmo valor que já era usado individualmente por
  `useInputData`; virou default global para não exigir repetir a opção
  em cada novo hook de query.

**`refetchOnWindowFocus` não foi alterado** (permanece o default `true`
do React Query): com `staleTime` configurado, o refetch por foco de
janela passa a ser uma revalidação em background — os dados já em
cache continuam na tela normalmente, e são trocados só quando a
resposta nova chega (padrão SWR: "stale-while-revalidate"). Sem
`staleTime`, esse mesmo refetch por foco reexecutava a busca a cada
troca de aba, mesmo com o dado ainda válido.

## COFFEE: operação e conclusões

O hub COFFEE usa as subseções **Verificar**, **Abrir**, **Operação**,
**Concluídas** e **Logs**. Verificar encaminha seleções para a fila de
Operação; Concluídas separa as classificações gerada e corrigida, sem
misturar o histórico com a fila ativa.

As queries React Query do fluxo são `['coffee', 'operacao']` para o quadro
e jobs ativos, `['coffee', 'concluidas']` para o histórico,
`['coffee', 'revisao', pk]` para a ficha da nota e
`['coffee', 'nota', pk, 'logs']` para os últimos logs no inspector. As
mutações invalidam essas chaves pontualmente, em vez de replicar estado de
servidor em Context.

A fila e os jobs de operação são persistidos em SQLite. Por isso o Kanban
continua mostrando a situação da operação depois de atualizar o navegador;
quando o backend reinicia, jobs em execução são marcados como interrompidos
e as notas retornam ao estado recuperável indicado pela API.

Conteúdo portalizado de `Sheet`, `Dialog`, `AlertDialog` e `Select` não
precisa de nenhum repasse de tema: os tokens vivem em `:root` e o portal os
herda do `<html>`. O hook `useCoffeePortalTheme`, que fazia esse repasse à
mão, foi removido na Fase 4c junto com a classe de escopo replicada nos
call sites.
As antigas telas separadas de Geradas, Corrigidas e Pendentes, o modal de
gerar/consultar, a tabela legada, o drawer de logs e a ficha de revisão
foram substituídos pelo Kanban, inspector e página Concluídas.

## COFFEE: handoff e limites de ações

O handoff de Verificar para Operação não abre modal: ele encaminha a seleção
para a fila persistida e o Kanban acompanha Fila, Prontas para gerar,
Processando e Aguardando SAP. Concluídas mantém o histórico separado; a
seleção em lote é reconciliada aos filtros visíveis, portanto busca, período
ou classificação nunca permitem mover itens ocultos para o plano.

O inspector na Operação é somente operacional (gerar, atualizar SAP e
remover). Arquivar notas geradas e mover notas corrigidas para o plano são
ações exclusivas de Concluídas.

## Hooks compartilhados

- **`use-mobile.ts`** (`useIsMobile`) — hook usado pelo `Sidebar` do
  shadcn para saber se a viewport está abaixo de 768px
  (`MOBILE_BREAKPOINT`, `use-mobile.ts:3`), via `matchMedia` +
  listener de `change`. Retorna sempre um `boolean` (`!!isMobile`,
  `use-mobile.ts:18`), nunca `undefined`, mesmo no primeiro render
  antes do efeito rodar.
- **`use-persisted-state.ts`** (`usePersistedState<T>`) — `useState`
  genérico que hidrata de e grava em `sessionStorage`
  (`use-persisted-state.ts:3`), defensivo a falhas de `JSON.parse`/quota
  (`try/catch` silencioso em ambas as pontas). Diferente de
  `settings-context.tsx` (que usa `localStorage` e persiste entre
  sessões do navegador), este hook é para estado que deve sobreviver a
  reload de página mas não precisa sobreviver ao fechamento da aba —
  usado por `App.tsx` para lembrar a sub-aba ativa de COFFEE/Input
  (`edp_coffee_sub`, `edp_input_sub`, `App.tsx:75-76`).

## Pontos de atenção

- `configuracoes.tsx:69-84` — os botões de accent color são `<button>`
  cru com `style` inline calculando `outline`/`boxShadow` por preset;
  não usam nenhum primitivo `ui/` nem token de foco padrão
  (`focus-visible:ring-*`), então o indicador de foco por teclado
  desses três botões é só o outline nativo do browser, diferente de
  todo o resto da tela que usa `ToggleGroup`/`Switch` com foco
  consistente.
- `settings-context.tsx:32,37` — `loadSettings`/`saveSettings` engolem
  qualquer exceção de `localStorage` (`catch { /* ignore */ }`) sem
  logar nem avisar o usuário; se `localStorage` estiver indisponível
  (modo privado restrito, quota cheia), a preferência silenciosamente
  para de persistir e o usuário não tem indicação de que suas escolhas
  de tema/densidade não vão sobreviver a um reload.
- `app.css:198-203` — `--pad`/`--gap`/`--row-py`/
  `--tile-py` ficam fora do bridge `@theme inline` por design (ver
  seção acima), mas isso significa que qualquer novo componente que
  precise desses valores como className Tailwind não tem como — só
  `style={{ padding: "var(--pad)" }}` ou arbitrary value
  `p-[var(--pad)]`, uma exceção que precisa ser lembrada manualmente a
  cada novo uso, sem checagem em tempo de compilação.
- `docs/superpowers/specs/2026-07-08-sp2b-shadcn-component-swaps-design.md:30-34`
  registra que `features/input/reports.tsx:144`'s `<select multiple
  size={4}>` ficou deliberadamente fora da varredura de `<select>` →
  `Select` do SP2b (shadcn `Select` não cobre multi-select nativo).
  Os `<select>` nativos remanescentes usam utilities Tailwind; a classe
  de campo que os estilizava foi absorvida por `ui/input.tsx` e
  `ui/select.tsx` na Fase 4c.
- `frontend/src/components/branded/` tem `section.tsx` e
  `mes-execucao-picker.tsx`; o brief desta doc referenciava
  `components/section.tsx` (sem `branded/`) — caminho corrigido nesta
  doc para o real, `frontend/src/components/branded/section.tsx`.
