# COFFEE — Operação em lista com progresso e consulta somente-leitura

**Data:** 2026-08-18

**Status:** aprovado pelo usuário em 2026-08-18 (discussão + canvas de design)

**Canvas de referência:** explorado interativamente com o usuário via Claude
Design (3 estruturas comparadas — tabela+filtros, abas+lista, lista com
progresso por nota — a terceira escolhida e refinada em 3 rodadas: volume
realista de 24 notas, passo de saída "Concluída", e integração com o
composer redesenhado). Este documento é o registro textual das decisões
tomadas nesse processo.

## Contexto

O spec anterior (`2026-07-24-coffee-operacao-kanban-design.md`) introduziu a
página **Operação** como um Kanban de 4 colunas (`Fila`, `Pronta`,
`Processando`, `Aguardando SAP`). Em uso real, dois problemas surgiram:

1. **O Kanban é contra-intuitivo para este fluxo.** As colunas não são
   posições que o usuário escolhe (não há drag-and-drop — o spec original já
   deixava isso explícito), então o Kanban se comporta como uma tabela
   particionada em 4 blocos fixos, sem comunicar a jornada de uma nota
   específica nem o que acontece depois de `Aguardando SAP`. Notas com SAP
   real somem do quadro sem explicação visual — o usuário só descobre que
   foram concluídas ao visitar a página `Concluídas` separadamente.

2. **"Adicionar notas" confunde consulta com enfileiramento.** O botão
   único `Consultar` do composer chama `POST /operacao/consultar`, que
   **sempre** roda `operation_service.adicionar_entradas()` antes de buscar
   os dados — ou seja, toda consulta enfileira a nota na Operação, mesmo
   quando o usuário só queria checar se ela já tem SAP real (para copiar o
   número, por exemplo). Existe uma consulta de verdade somente-leitura no
   backend (`GET /coffee/consultar/{id}`, `routes.py:197`), mas ela hoje só
   é usada pela página Verificar — não está disponível na Operação. Essa
   distinção existia em versões anteriores do fluxo e foi perdida ao longo
   das entregas.

Este documento cobre a correção dos dois problemas. Não é uma reescrita da
arquitetura de informação do módulo COFFEE — `Operação` continua sendo a
mesma aba do hub (`coffee-hub.tsx`), a máquina de estados do backend
(`operation_service.py`) não muda, e a tabela `coffee_fila_operacao`
continua com as mesmas 4 etapas.

## Objetivos

1. Substituir o Kanban de 4 colunas por uma **lista única, ordenável**, onde
   cada linha mostra a jornada da própria nota (`Fila → Pronta →
   Processando → Aguardando SAP → Concluída`) num mini-stepper, em vez de a
   etapa ser "em qual bloco a nota está".
2. Tornar `Consultar` **de fato somente-leitura**: reaproveitar a mesma
   lógica de `GET /coffee/consultar/{id}` para lote, sem tocar em
   `coffee_fila_operacao`. Nenhuma nota é enfileirada até o usuário pedir
   explicitamente.
3. Separar as duas intenções do composer em duas ações visíveis: **Consultar**
   (somente leitura) e **Adicionar à fila** (o enfileiramento que hoje existe
   sob o nome `Consultar`).
4. Tornar o composer **sempre visível** (hoje fica atrás de um botão que
   precisa ser expandido a cada uso) e dar feedback exato sobre tokens
   inválidos/repetidos (hoje só mostra contagem).
5. Fazer os dois fluxos conviverem na mesma tela sem navegação: o resultado
   da consulta abre como painel recolhível acima do quadro; "Adicionar à
   fila" a partir do resultado atualiza o quadro sem sair da página.
6. Suportar lotes grandes na consulta (dezenas de notas) sem quebrar layout:
   lista de resultado com altura travada e rolagem própria, resumo por
   contagem, e ação "Selecionar todas elegíveis".

## Decisões confirmadas

- A lista substitui o Kanban por completo; `OperacaoKanban` e
  `OperacaoColumn` são removidos.
- Não há filtro por etapa nesta entrega (nem abas, nem chips) — foi
  avaliado e descartado em favor da lista simples com legenda informativa.
  Fica registrado como possível trabalho futuro, não como requisito.
- O passo "Concluída" no stepper é **puramente informativo** (tracejado,
  sem link, sem interação): comunica que a nota sai da Operação ao receber
  SAP real, mas nenhuma nota do quadro chega visualmente a esse estado —
  ela desaparece da lista antes disso (mesma regra de hoje,
  `etapa_da_classificacao` retorna `None` para `gerada`/`corrigida`).
- `POST /operacao/consultar` (o endpoint que enfileira) **não muda de
  nome nem de contrato** — é reaproveitado como está para a ação
  "Adicionar à fila". Só o rótulo na UI muda.
- A consulta somente-leitura em lote roda como **job no backend**
  (mesmo padrão de thread + `_rodar_em_paralelo` já usado por
  `_rodar_consulta_operacao`), não como N requisições paralelas do
  front — decisão do usuário para minimizar carga simultânea na API
  externa do COFFEE.
- Nenhuma regra de classificação, arquivamento ou origem muda.

## Lista da Operação (substitui o Kanban)

### Estrutura visual

Uma lista de uma coluna, uma nota por linha, com uma barra de ferramentas
acima contendo:

- **legenda estática** (não interativa): 4 pontos coloridos com os nomes das
  etapas — `Fila` (índigo), `Pronta` (verde), `Processando` (âmbar,
  pulsante), `Aguardando SAP` (azul);
- **ordenação**: seletor "Ordenar por: Atualização | Prioridade" (client-side,
  sobre o array `itens` já carregado — sem novo endpoint). Padrão:
  `Atualização`, mais recente primeiro (`atualizado_em` decrescente) — mesma
  ordem que o usuário já vê hoje ao abrir a página.

Cada linha mostra, da esquerda para a direita: checkbox de seleção, ID COFFEE
(mono) + origem (`Avulsa`/`Verificar`), local + alimentador, prioridade
(texto simples, como hoje — o valor de `prioridade` não tem uma escala de
severidade confirmada no código atual, então esta entrega não inventa uma
classificação visual pra ele), o mini-stepper, tempo desde a última
atualização (ou erro, com `AlertCircle`), e um chevron pra abrir o
inspector — mesma informação que o card do Kanban expõe hoje, reorganizada
em linha.

### Mini-stepper

4 nós reais (`Fila`, `Pronta`, `Processando`, `Aguardando SAP`) + 1 nó
fantasma tracejado (`Concluída`, sempre no fim, nunca "atual"). Nós antes da
etapa atual ficam preenchidos de verde (`done`); o nó da etapa atual usa a
cor semântica da etapa (índigo/verde/âmbar/azul) com um anel de destaque;
nós futuros ficam cinza. O nó fantasma usa borda tracejada e cor neutra. Uma
legenda textual abaixo do stepper nomeia a etapa atual (ex.: "Aguardando
SAP"); para notas em `aguardando_sap`, o texto ganha o sufixo "· sai ao
concluir" pra reforçar que dali a nota vai para `Concluídas`.

### Fora de escopo da lista

- filtro por etapa (chips ou abas);
- reordenar/agrupar por origem;
- paginação — a lista carrega o quadro inteiro como hoje o Kanban já faz.

## Adicionar Notas (composer redesenhado)

### Composer sempre visível

O botão `Adicionar notas` que hoje expande/recolhe um painel é substituído
por uma barra fixa no topo da página (abaixo do cabeçalho), sempre
renderizada — sem estado `open`/`fechado`. Contém:

- um `<textarea>` (mesma sintaxe de hoje: espaço, vírgula, ponto e vírgula
  ou quebra de linha separam IDs);
- feedback de validação **com o token exato**, não só a contagem: chips
  `repetido: 48287` (âmbar) e `inválido: abc` (vermelho) ao lado da
  contagem de válidos. `parseCoffeeIds` já devolve `invalidos` como lista
  de tokens exatos (`ParsedIds.invalidos: string[]`) — só falta usá-la na
  UI. `repetidos` hoje é só uma contagem (`number`); vira
  `repetidos: number[]` (os IDs distintos que apareceram mais de uma vez),
  mudança de tipo que atualiza `operacao-composer.test.ts` junto;
- dois botões: **Consultar** (outline) e **Adicionar à fila** (primário).

### Consultar (somente leitura)

Chama o novo endpoint em lote (seção Backend abaixo). Abre um painel
**Resultado da consulta** entre o composer e a lista, com:

- nota de aviso fixa: "Isso só busca os dados — nada aqui entra na fila de
  geração até você clicar em 'Adicionar à fila'.";
- **resumo por contagem**: quantas notas em cada categoria (`ainda não
  geradas`, `já concluídas`, `já na Operação`, `erros`);
- lista de resultado com **altura travada** (rolagem própria — nunca
  empurra a lista da Operação para fora da tela, não importa quantas notas
  vieram);
- por linha: ID, local, e o estado real —
  - **já concluída** (tem SAP real): valor do SAP + botão copiar;
  - **já na Operação**: badge da etapa atual, sem ação (evita duplicar);
  - **ainda não gerada** (elegível): badge neutro + botão `+ Fila` que
    enfileira só aquela nota;
  - **erro** (nota não encontrada / falha na consulta): texto de erro,
    sem checkbox;
- checkbox por linha elegível + **"Selecionar todas elegíveis (N)"** +
  botão de lote "Adicionar à fila de geração" que chama o endpoint de
  enfileiramento existente com os IDs selecionados;
- botão "Recolher"/"Fechar" — o painel é dispensável a qualquer momento
  sem perder o estado da lista da Operação abaixo.

### Adicionar à fila

Continua chamando `OperacaoApi.consultar` (o mutation existente,
renomeado só na camada de UI) — nenhuma mudança de contrato ou de máquina
de estados. Pode ser disparado de três lugares: o botão do composer (lote
inteiro pastado), o botão `+ Fila` de uma linha do resultado, ou o botão de
lote do painel de resultado (linhas selecionadas).

## Backend

### Novo endpoint: `POST /coffee/operacao/consultar-lote`

Reaproveita `OperacaoIdsPedido` (`{ids: list[int]}`, já existe em
`routes.py:90`). Handler simétrico ao de `/operacao/consultar`, mas chama
`jobs.iniciar_consulta_leitura` em vez de `jobs.iniciar_consulta_operacao` —
**não** passa por `operation_service.adicionar_entradas`.

```python
@router.post("/operacao/consultar-lote")
def consultar_operacao_lote(
    pedido: OperacaoIdsPedido,
    usuario: Optional[str] = Depends(usuario_coffee),
):
    _garantir_banco()
    ids = _validar_ids(pedido.ids)
    job_id = jobs.iniciar_consulta_leitura(
        ids,
        trace=db.trace_atual(),
        usuario=usuario,
    )
    return {"job_id": job_id}
```

### Novo job: `jobs.iniciar_consulta_leitura` / `jobs._rodar_consulta_leitura`

Reaproveita `_novo_job`, `_rodar_em_paralelo` e `config.DELAY_BUSCA` — o
mesmo padrão de todos os outros jobs em lote do módulo (thread +
`ThreadPoolExecutor(max_workers=config.MAX_WORKERS)`, sem rajada
descontrolada de chamadas simultâneas à API externa). Tipo de operação:
`"consulta_leitura"`.

Cada nota processada vira uma entrada em `snapshot["resultados"]` — **sem
nenhuma escrita** em `notas_coffee` ou `coffee_fila_operacao` (mesma
garantia de somente-leitura que `GET /coffee/consultar/{id}` já tem hoje).
`db.salvar_operacao` já mescla qualquer chave extra do snapshot no
`resultado_json` persistido (`db.py:225-233`) — nenhuma migração de schema
é necessária.

```python
def iniciar_consulta_leitura(
    ids: list[int],
    trace: str | None = None,
    usuario: str | None = None,
) -> str:
    job_id, snapshot = _novo_job("consulta_leitura", len(ids))
    threading.Thread(
        target=_rodar_consulta_leitura,
        args=(job_id, snapshot, list(ids), trace, usuario),
        daemon=True,
    ).start()
    return job_id


def _rodar_consulta_leitura(
    job_id: str,
    snapshot: dict,
    ids: list[int],
    trace: str | None,
    usuario: str | None,
) -> None:
    snapshot["resultados"] = []
    ids_na_operacao = {
        identificador
        for item in db.listar_itens_operacao()
        for identificador in (item["entrada_id"], item["nota_pk"])
        if identificador is not None
    }

    def processar(ident: int) -> None:
        try:
            nota = client.buscar_nota(ident)
        except Exception as exc:  # noqa: BLE001 - vira linha de erro, nao derruba o lote
            with _LOCK:
                snapshot["resultados"].append({
                    "pk": int(ident),
                    "id_sap": None,
                    "classificacao": None,
                    "ja_na_operacao": False,
                    "elegivel": False,
                    "local_instalacao": None,
                    "erro": str(exc),
                })
            raise
        estado_local = db.obter_nota(nota["pk"])
        classificacao = classify.classificar(
            nota["id_sap"],
            None if estado_local is None else estado_local["id_sap"],
            None if estado_local is None else estado_local["origem"],
        )
        ja_na_operacao = (
            nota["pk"] in ids_na_operacao or int(ident) in ids_na_operacao
        )
        with _LOCK:
            snapshot["resultados"].append({
                "pk": nota["pk"],
                "id_sap": nota["id_sap"],
                "classificacao": classificacao,
                "ja_na_operacao": ja_na_operacao,
                "elegivel": classificacao == "nao_gerada" and not ja_na_operacao,
                "local_instalacao": nota["local_instalacao"],
                "erro": None,
            })

    _rodar_em_paralelo(job_id, snapshot, ids, trace, usuario, processar, config.DELAY_BUSCA)
```

O `raise` depois do `append` do caso de erro segue o mesmo padrão de
`_rodar_consulta_operacao.processar` (`jobs.py:150-156`): o helper genérico
`_rodar_em_paralelo` também conta o erro em `snapshot["erros"]` e incrementa
`feitas` — a linha de resultado é o detalhe pra UI, `erros`/`feitas` mantêm a
contabilidade que o resto do sistema já espera de um job.

### Fora de escopo do backend

- mudar `classify.classificar`, `client.buscar_nota` ou as regras de
  arquivamento/origem;
- mudar o contrato de `/operacao/consultar`, `/operacao/gerar` ou
  `/operacao/atualizar-sap`;
- persistir os resultados da consulta somente-leitura além da vida do job
  (mesma política atual — `coffee_operacoes` não tem TTL/expurgo nesta
  entrega).

## Frontend

### Arquivos afetados

```text
frontend/src/features/coffee/operacao/
  coffee-operacao.tsx                    — remove estado de inspector/etc. que dependia do Kanban; monta composer fixo + painel de resultado + lista
  operacao-api.ts                        — + consultarLeitura()
  use-coffee-operacao.ts                 — + mutation consultarLeitura
  components/
    operacao-composer.tsx                — reescrito: sempre visível, chips de token exato, 2 botões
    operacao-kanban.tsx                  — removido
    operacao-column.tsx                  — removido
    nota-operacao-card.tsx               — removido
    operacao-lista.tsx                   — novo: lista ordenável (substitui operacao-kanban.tsx)
    nota-operacao-row.tsx                — novo: linha da lista (substitui nota-operacao-card.tsx)
    operacao-stepper.tsx                 — novo: mini-stepper de 5 nós, usado por nota-operacao-row
    operacao-consulta-resultado.tsx      — novo: painel "Resultado da consulta"
    operacao-batch-bar.tsx               — rótulo "Selecionar coluna" -> "Selecionar etapa" (lógica inalterada)
../types.ts                              — + ConsultaLoteItem; CoffeeJob.tipo e .resultados ampliados
```

### Tipos novos/alterados (`types.ts`)

```typescript
export interface ConsultaLoteItem {
  pk: number;
  id_sap: number | null;
  classificacao: string | null;
  ja_na_operacao: boolean;
  elegivel: boolean;
  local_instalacao: string | null;
  erro: string | null;
}
```

Em `CoffeeJob`:

```typescript
tipo?: "consulta" | "geracao" | "atualizacao_sap" | "consulta_leitura" | string;
resultados?: ConsultaLoteItem[];
```

### API (`operacao-api.ts`)

```typescript
consultarLeitura: (ids: number[]): Promise<JobResponse> =>
  postIds('consultar-lote', ids),
```

### Hook (`use-coffee-operacao.ts`)

```typescript
const consultarLeitura = useMutation({
  mutationFn: (ids: number[]) => OperacaoApi.consultarLeitura(ids),
});
```

Sem `onSuccess: invalidate` — a consulta somente-leitura não muda o quadro,
então não há razão pra invalidar `['coffee', 'operacao']`. O resultado é
consumido via `aguardarJobOperacao` (já genérico, reaproveitado sem
alteração) direto no componente que dispara a consulta.

### `operacao-stepper.tsx`

Componente puro, recebe `etapa: OperacaoEtapa` e renderiza os 5 nós/4 barras
descritos na seção "Mini-stepper" acima. Sem estado próprio.

### `operacao-consulta-resultado.tsx`

Recebe `resultados: ConsultaLoteItem[]`, `selecionados: Set<number>`,
`onToggle`, `onSelecionarTodasElegiveis`, `onAdicionarFila(ids: number[])`,
`onFechar`. Computa o resumo por contagem localmente (`reduce` sobre
`resultados`, sem novo estado de servidor). Lista interna com
`max-height` + `overflow-y-auto`.

### Fora de escopo do frontend

- drag-and-drop (já era fora de escopo no spec do Kanban e continua sendo);
- WebSocket ou qualquer transporte além do polling de job já existente;
- alterar `CoffeeNotaInspector` ou os fluxos de gerar/atualizar SAP/remover;
- alterar `coffee-concluidas.tsx` — a lista da Operação só reflete melhor um
  comportamento que já existe, não muda o que aparece em Concluídas.

## Erros e recuperação

- Falha ao buscar uma nota individual na consulta somente-leitura vira uma
  linha de resultado com `erro` preenchido — não derruba o lote nem some
  silenciosamente (mesmo princípio do resto do módulo).
- Se o job de consulta somente-leitura for interrompido (reinício do
  backend), `obter_job` já traduz `"interrompida"` para `"interrompido"`
  como qualquer outro job — o painel de resultado mostra o que tiver
  chegado e o usuário pode consultar de novo.
- A ação "Adicionar à fila" a partir do painel de resultado usa a mesma
  mutation e tratamento de erro (toast) que o composer já usa hoje.

## Verificação

### Backend

- teste de `POST /operacao/consultar-lote` retornando `job_id`;
- teste de `_rodar_consulta_leitura`: nota sem SAP real → `elegivel=true`;
  nota com SAP real → `elegivel=false`, `classificacao` correta; nota já em
  `coffee_fila_operacao` → `ja_na_operacao=true`, `elegivel=false`; falha de
  rede → linha de erro, resto do lote continua;
- teste confirmando que `_rodar_consulta_leitura` **não** escreve em
  `notas_coffee` nem `coffee_fila_operacao` (a garantia central deste spec);
- suíte completa com `pytest`.

### Frontend

Componentes React são testados com `renderToStaticMarkup` (de
`react-dom/server`, já uma dependência) + asserção em string — o padrão já
usado em todo o projeto (`verificar/dashboard-detail.test.tsx`,
`nota-ficha-completa.test.tsx`). Esta entrega não adiciona
`@testing-library/react`, `happy-dom` nem qualquer outra dependência de
teste de DOM interativo — isso seria uma decisão de ferramental do projeto
inteiro, fora do escopo deste spec. Consequência prática: testes
automatizados cobrem o que cada componente renderiza dado um conjunto de
props, não cliques/digitação simulados; interação (digitar no composer,
clicar em `+ Fila`) é coberta por verificação manual.

- `operacao-composer.test.ts`: parsing continua idêntico; novo teste dos
  chips de token exato (repetido/inválido nomeando o valor, não só a
  contagem);
- teste de `operacao-stepper.tsx`: nó correto marcado como atual por etapa,
  nós anteriores `done`, nó fantasma sempre presente e nunca "atual";
- teste de `operacao-consulta-resultado.tsx`: resumo por contagem bate com
  os `resultados`; "Selecionar todas elegíveis" marca só as elegíveis;
  `+ Fila` de uma linha chama `onAdicionarFila` com um único id;
- `npm run build`; sem `any`, imports mortos ou `console.log`.

## Critérios de aceite

1. A página Operação não usa mais Kanban/colunas — é uma lista ordenável
   com stepper por linha.
2. Nenhuma nota é enfileirada em `coffee_fila_operacao` só por ter sido
   consultada via "Consultar" — apenas "Adicionar à fila" enfileira.
3. O composer está sempre visível, sem estado de expandir/recolher.
4. Tokens inválidos/repetidos aparecem nomeados, não só contados.
5. O painel de resultado nunca cresce sem limite — lista interna com
   rolagem própria, independente do tamanho do lote consultado.
6. "Adicionar à fila" a partir do painel de resultado atualiza a lista da
   Operação sem navegação nem reload de página.
7. Build, testes backend e checklist de qualidade do repositório passam.
