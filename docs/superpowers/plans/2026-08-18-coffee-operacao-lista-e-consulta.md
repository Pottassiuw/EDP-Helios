# COFFEE — Operação em lista com progresso e consulta somente-leitura Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the COFFEE Operação Kanban with a sortable list where each
note shows its own progress (mini-stepper), and split "Adicionar notas" into
a true read-only consult and an explicit "add to generation queue" action.

**Architecture:** A new backend job type (`consulta_leitura`) reuses the
existing thread-pool job runner and the exact read-only lookup logic that
`GET /coffee/consultar/{id}` already uses, but batched and without writing
to `coffee_fila_operacao`. The frontend gets a new list-based board
component (replacing the 4-column Kanban), an always-visible composer with
two distinct actions, and a dismissible "Resultado da consulta" panel that
bridges "just looked it up" into "added to the queue" without navigation.

**Tech Stack:** FastAPI, Python (backend); React 18, TypeScript, Tailwind
v4, React Query (frontend). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-18-coffee-operacao-lista-e-consulta-design.md`

## Global Constraints

- No drag-and-drop, no WebSocket, no new npm/pip dependency (spec, "Fora de
  escopo").
- `POST /operacao/consultar`, `/operacao/gerar`, `/operacao/atualizar-sap`
  keep their exact current contract — only the new `/operacao/consultar-lote`
  is added (spec, "Decisões confirmadas").
- The read-only consult path must never write to `notas_coffee` or
  `coffee_fila_operacao` (spec, "Novo job").
- No TypeScript `any`; export types separately from implementations; never
  invent a severity/color mapping for `prioridade` that isn't already
  established in the code (spec, "Lista da Operação").
- Tailwind: use only the project's bridged design tokens
  (`bg-indigo`, `text-tint-red`, `border-line-2`, etc. from `app.css`'s
  `@theme inline` block) — never an arbitrary hex or the raw Tailwind
  palette.
- Every code change that touches a documented module updates the matching
  `docs/dev/*.md` file in the same task (CLAUDE.md, "Documentation").

---

### Task 1: Backend — read-only batch consult job + route

**Files:**
- Modify: `backend/coffee_module/jobs.py` (add `iniciar_consulta_leitura`,
  `_rodar_consulta_leitura`)
- Modify: `backend/coffee_module/routes.py` (add
  `POST /operacao/consultar-lote`)
- Test: `backend/test_coffee_operations.py`

**Interfaces:**
- Consumes: `jobs._novo_job`, `jobs._rodar_em_paralelo`, `jobs._LOCK`,
  `client.buscar_nota(ident) -> dict`, `db.obter_nota(pk) -> dict | None`,
  `db.listar_itens_operacao() -> list[dict]`, `classify.classificar`,
  `config.DELAY_BUSCA`, `config.MAX_WORKERS`, `routes.OperacaoIdsPedido`,
  `routes._validar_ids`, `routes.usuario_coffee`.
- Produces: `jobs.iniciar_consulta_leitura(ids, trace=None, usuario=None) -> str`
  (job id), a job snapshot whose `tipo == "consulta_leitura"` and — once
  `estado != "rodando"` — carries `resultados: list[dict]` with keys `pk`,
  `id_sap`, `classificacao`, `ja_na_operacao`, `elegivel`,
  `local_instalacao`, `erro`. Route `POST /api/coffee/operacao/consultar-lote`
  returning `{"job_id": str}`. Task 2's frontend types mirror this shape
  exactly.

- [ ] **Step 1: Write the failing tests**

```python
# backend/test_coffee_operations.py (add near the other operation_client tests)

def test_rota_consultar_lote_nao_toca_a_fila_operacional(operation_client):
    resposta = operation_client.post(
        "/api/coffee/operacao/consultar-lote",
        json={"ids": [201]},
    )
    assert resposta.status_code == 200
    job = _aguardar(resposta.json()["job_id"])
    assert job["tipo"] == "consulta_leitura"
    assert job["resultados"] == [{
        "pk": 201,
        "id_sap": None,
        "classificacao": "nao_gerada",
        "ja_na_operacao": False,
        "elegivel": True,
        "local_instalacao": None,
        "erro": None,
    }]
    quadro = operation_client.get("/api/coffee/operacao").json()
    assert quadro["itens"] == []


def test_consulta_leitura_marca_nota_ja_na_operacao_como_nao_elegivel(
    operation_client,
):
    operation_service.adicionar_entradas([201], "avulsa", "seed")
    operation_service.aplicar_consulta(
        201, _nota(201, None), "avulsa", "seed"
    )
    resposta = operation_client.post(
        "/api/coffee/operacao/consultar-lote",
        json={"ids": [201]},
    )
    job = _aguardar(resposta.json()["job_id"])
    assert job["resultados"][0]["ja_na_operacao"] is True
    assert job["resultados"][0]["elegivel"] is False


def test_consulta_leitura_marca_sap_real_como_nao_elegivel(operation_client):
    from coffee_module import client as client_module

    def _com_sap(ident):
        return _nota(int(ident), 17259425, alimentador="ABC01")

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(client_module, "buscar_nota", _com_sap)
        resposta = operation_client.post(
            "/api/coffee/operacao/consultar-lote",
            json={"ids": [301]},
        )
        job = _aguardar(resposta.json()["job_id"])

    assert job["resultados"][0]["id_sap"] == 17259425
    assert job["resultados"][0]["classificacao"] == "gerada"
    assert job["resultados"][0]["elegivel"] is False


def test_consulta_leitura_falha_individual_vira_linha_de_erro(
    operation_client, monkeypatch,
):
    from coffee_module import client as client_module

    def _falha(ident):
        if int(ident) == 401:
            raise client_module.NotaNaoEncontradaErro(ident)
        return _nota(int(ident), None)

    monkeypatch.setattr(client_module, "buscar_nota", _falha)
    resposta = operation_client.post(
        "/api/coffee/operacao/consultar-lote",
        json={"ids": [401, 402]},
    )
    job = _aguardar(resposta.json()["job_id"])

    por_pk = {item["pk"]: item for item in job["resultados"]}
    assert por_pk[401]["erro"] is not None
    assert por_pk[401]["elegivel"] is False
    assert por_pk[402]["erro"] is None
    assert por_pk[402]["elegivel"] is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest test_coffee_operations.py -k consulta_leitura -v`
Expected: FAIL — `404` from the route (endpoint doesn't exist yet) / `AttributeError` on `jobs.iniciar_consulta_leitura`.

- [ ] **Step 3: Implement `jobs.iniciar_consulta_leitura` / `_rodar_consulta_leitura`**

Add to `backend/coffee_module/jobs.py` (after `_rodar_consulta_operacao`,
before `def iniciar_geracao`):

```python
from coffee_module import classify  # add to the existing import block at the top


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
    """Consulta somente-leitura em lote: nunca escreve em notas_coffee nem
    em coffee_fila_operacao. Mesma lógica de GET /consultar/{id}
    (routes.py), só que em lote e via job (menos rajada na API externa que
    N requisições paralelas do front)."""
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

- [ ] **Step 4: Add the route**

Add to `backend/coffee_module/routes.py` (right after `consultar_operacao`,
~line 439):

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest test_coffee_operations.py -k consulta_leitura -v`
Expected: PASS (all 4 new tests).

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && python -m pytest -q`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/coffee_module/jobs.py backend/coffee_module/routes.py backend/test_coffee_operations.py
git commit -m "feat(coffee): add read-only batch consult job and route"
```

---

### Task 2: Frontend — types and API for the batch consult endpoint

**Files:**
- Modify: `frontend/src/features/coffee/types.ts`
- Modify: `frontend/src/features/coffee/operacao/operacao-api.ts`

**Interfaces:**
- Consumes: `OperacaoApi.postIds` pattern already in `operacao-api.ts`.
- Produces: `ConsultaLoteItem` type; `CoffeeJob.resultados?: ConsultaLoteItem[]`;
  `OperacaoApi.consultarLeitura(ids: number[]): Promise<{job_id: string}>`.
  Task 7's `use-consulta-leitura.ts` hook consumes both.

- [ ] **Step 1: Add the type and extend `CoffeeJob`**

In `frontend/src/features/coffee/types.ts`, change:

```typescript
export interface CoffeeJob {
  id?: string;
  tipo?: "consulta" | "geracao" | "atualizacao_sap" | string;
```

to:

```typescript
export interface CoffeeJob {
  id?: string;
  tipo?: "consulta" | "geracao" | "atualizacao_sap" | "consulta_leitura" | string;
```

and add, near `CoffeeOperacaoQuadro`:

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

and add to `CoffeeJob`, alongside the other optional result arrays
(`arquivadas`, `corrigidas`, `geradas`, `divergentes`):

```typescript
  /** Só presente em jobs `consulta_leitura`: o resultado somente-leitura
   * de cada nota consultada. */
  resultados?: ConsultaLoteItem[];
```

- [ ] **Step 2: Add the API call**

In `frontend/src/features/coffee/operacao/operacao-api.ts`, add to the
`OperacaoApi` object, next to `consultar`:

```typescript
  consultarLeitura: (ids: number[]): Promise<JobResponse> =>
    postIds('consultar-lote', ids),
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS, no new errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/coffee/types.ts frontend/src/features/coffee/operacao/operacao-api.ts
git commit -m "feat(coffee): add types and API call for batch read-only consult"
```

---

### Task 3: Frontend — `parseCoffeeIds` exposes the exact repeated IDs

**Files:**
- Modify: `frontend/src/features/coffee/operacao/components/operacao-composer.tsx`
- Test: `frontend/src/features/coffee/operacao/components/operacao-composer.test.ts`

**Interfaces:**
- Produces: `ParsedIds.repetidos` changes from `number` (count) to
  `number[]` (the distinct IDs that appeared more than once). Task 6's
  composer rewrite renders one chip per entry.

- [ ] **Step 1: Update the failing test**

In `operacao-composer.test.ts`, replace:

```typescript
  it('deduplica e conta repetidos separadamente dos válidos', () => {
    const parsed = parseCoffeeIds('10 10 20 20 20');
    expect(parsed.ids).toEqual([10, 20]);
    expect(parsed.repetidos).toBe(3);
  });
```

with:

```typescript
  it('deduplica e lista os IDs repetidos separadamente dos válidos', () => {
    const parsed = parseCoffeeIds('10 10 20 20 20 30');
    expect(parsed.ids).toEqual([10, 20, 30]);
    expect(parsed.repetidos).toEqual([10, 20]);
  });
```

and the empty-value case:

```typescript
  it('valor vazio ou só separadores não gera IDs nem inválidos', () => {
    expect(parseCoffeeIds('')).toEqual({ ids: [], invalidos: [], repetidos: [] });
    expect(parseCoffeeIds('   ,;  \n ')).toEqual({ ids: [], invalidos: [], repetidos: [] });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-composer.test.ts`
Expected: FAIL — `repetidos` is still a number.

- [ ] **Step 3: Update `parseCoffeeIds`**

In `operacao-composer.tsx`, replace:

```typescript
export interface ParsedIds {
  ids: number[];
  invalidos: string[];
  repetidos: number;
}

export function parseCoffeeIds(value: string): ParsedIds {
  const tokens = value.split(/[\s,;]+/).filter(Boolean);
  const validos = tokens
    .filter((token) => /^\d+$/.test(token) && Number(token) > 0)
    .map(Number);
  const ids = [...new Set(validos)];

  return {
    ids,
    invalidos: tokens.filter(
      (token) => !/^\d+$/.test(token) || Number(token) <= 0,
    ),
    repetidos: validos.length - ids.length,
  };
}
```

with:

```typescript
export interface ParsedIds {
  ids: number[];
  invalidos: string[];
  repetidos: number[];
}

export function parseCoffeeIds(value: string): ParsedIds {
  const tokens = value.split(/[\s,;]+/).filter(Boolean);
  const validos = tokens
    .filter((token) => /^\d+$/.test(token) && Number(token) > 0)
    .map(Number);
  const ids = [...new Set(validos)];
  const ocorrencias = new Map<number, number>();
  validos.forEach((id) => ocorrencias.set(id, (ocorrencias.get(id) ?? 0) + 1));

  return {
    ids,
    invalidos: tokens.filter(
      (token) => !/^\d+$/.test(token) || Number(token) <= 0,
    ),
    repetidos: [...ocorrencias.entries()]
      .filter(([, vezes]) => vezes > 1)
      .map(([id]) => id),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-composer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/coffee/operacao/components/operacao-composer.tsx frontend/src/features/coffee/operacao/components/operacao-composer.test.ts
git commit -m "refactor(coffee): parseCoffeeIds exposes exact repeated IDs, not just a count"
```

---

### Task 4: Frontend — `OperacaoStepper` component

**Files:**
- Create: `frontend/src/features/coffee/operacao/components/operacao-stepper.tsx`
- Test: `frontend/src/features/coffee/operacao/components/operacao-stepper.test.tsx`

**Interfaces:**
- Consumes: `OperacaoEtapa` from `../../types`.
- Produces: `OperacaoStepper({ etapa: OperacaoEtapa }): React.JSX.Element`,
  a pure presentational component. Task 5's `NotaOperacaoRow` renders it.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/coffee/operacao/components/operacao-stepper.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperacaoStepper } from './operacao-stepper';

describe('OperacaoStepper', () => {
  it('mostra o rótulo da etapa atual', () => {
    render(<OperacaoStepper etapa="processando" />);
    expect(screen.getByText('Processando')).toBeInTheDocument();
  });

  it('acrescenta o aviso de saída só em aguardando_sap', () => {
    render(<OperacaoStepper etapa="aguardando_sap" />);
    expect(screen.getByText(/sai ao concluir/)).toBeInTheDocument();
  });

  it('não mostra o aviso de saída em outras etapas', () => {
    render(<OperacaoStepper etapa="fila" />);
    expect(screen.queryByText(/sai ao concluir/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-stepper.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the component**

```tsx
// frontend/src/features/coffee/operacao/components/operacao-stepper.tsx
import React from 'react';
import type { OperacaoEtapa } from '../../types';

const ETAPAS: OperacaoEtapa[] = ['fila', 'pronta', 'processando', 'aguardando_sap'];

const ROTULOS: Record<OperacaoEtapa, string> = {
  fila: 'Fila',
  pronta: 'Pronta',
  processando: 'Processando',
  aguardando_sap: 'Aguardando SAP',
};

const NODE_ATUAL: Record<OperacaoEtapa, string> = {
  fila: 'bg-indigo ring-4 ring-tint-indigo',
  pronta: 'bg-green ring-4 ring-tint-green',
  processando: 'bg-amber ring-4 ring-tint-amber motion-safe:animate-pulse',
  aguardando_sap: 'bg-blue ring-4 ring-tint-blue',
};

const LABEL_COR: Record<OperacaoEtapa, string> = {
  fila: 'text-indigo',
  pronta: 'text-[var(--green-3)]',
  processando: 'text-amber',
  aguardando_sap: 'text-blue',
};

interface OperacaoStepperProps {
  etapa: OperacaoEtapa;
}

/** Mini-stepper de 5 nós (4 etapas reais + 1 nó fantasma tracejado
 * "Concluída"): mostra a jornada da própria nota em vez de depender de o
 * usuário saber em qual coluna de um Kanban ela está. */
export function OperacaoStepper({ etapa }: OperacaoStepperProps): React.JSX.Element {
  const indiceAtual = ETAPAS.indexOf(etapa);
  const sufixo = etapa === 'aguardando_sap' ? ' · sai ao concluir' : '';

  return (
    <div className="flex w-[222px] shrink-0 flex-col gap-[5px]">
      <div className="flex items-center">
        {ETAPAS.map((passo, indice) => (
          <React.Fragment key={passo}>
            <span
              className={[
                'h-[9px] w-[9px] shrink-0 rounded-full',
                indice < indiceAtual
                  ? 'bg-green'
                  : indice === indiceAtual
                    ? NODE_ATUAL[passo]
                    : 'bg-line-2',
              ].join(' ')}
            />
            <span
              className={[
                'h-[2px] w-[24px] shrink-0',
                indice < indiceAtual ? 'bg-green' : 'bg-line-2',
              ].join(' ')}
            />
          </React.Fragment>
        ))}
        <span className="h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-dashed border-line-2 bg-surface" />
      </div>
      <span className={`font-mono text-[10px] font-medium uppercase tracking-[0.07em] ${LABEL_COR[etapa]}`}>
        {ROTULOS[etapa]}{sufixo}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-stepper.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/coffee/operacao/components/operacao-stepper.tsx frontend/src/features/coffee/operacao/components/operacao-stepper.test.tsx
git commit -m "feat(coffee): add OperacaoStepper — per-note progress mini-stepper"
```

---

### Task 5: Frontend — list replaces the Kanban

**Files:**
- Create: `frontend/src/features/coffee/operacao/components/nota-operacao-row.tsx`
- Create: `frontend/src/features/coffee/operacao/components/operacao-lista.tsx`
- Remove: `frontend/src/features/coffee/operacao/components/operacao-kanban.tsx`
- Remove: `frontend/src/features/coffee/operacao/components/operacao-column.tsx`
- Remove: `frontend/src/features/coffee/operacao/components/nota-operacao-card.tsx`
- Modify: `frontend/src/features/coffee/operacao/components/operacao-batch-bar.tsx`
- Modify: `frontend/src/features/coffee/operacao/coffee-operacao.tsx`
- Test: `frontend/src/features/coffee/operacao/components/operacao-lista.test.tsx`

**Interfaces:**
- Consumes: `OperacaoStepper` (Task 4), `formatRelativeTime` from
  `../../format`, `CoffeeJob`/`CoffeeOperacaoItem`/`OperacaoEtapa` from
  `../../types`.
- Produces: `OperacaoLista(props: { itens, jobs, selected, onToggle, onOpen })`
  — same prop shape as the old `OperacaoKanbanProps`, so
  `coffee-operacao.tsx` swaps the import with no other change to that call
  site.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/features/coffee/operacao/components/operacao-lista.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperacaoLista } from './operacao-lista';
import type { CoffeeOperacaoItem } from '../../types';

function item(overrides: Partial<CoffeeOperacaoItem>): CoffeeOperacaoItem {
  return {
    entrada_id: 1,
    nota_pk: 1,
    etapa: 'fila',
    origem: 'avulsa',
    operacao_id: null,
    erro: null,
    criado_em: '2026-08-18T10:00:00',
    atualizado_em: '2026-08-18T10:00:00',
    nota: null,
    ...overrides,
  };
}

describe('OperacaoLista', () => {
  it('mostra uma linha por nota, sem colunas', () => {
    render(
      <OperacaoLista
        itens={[item({ entrada_id: 1, nota_pk: 1 }), item({ entrada_id: 2, nota_pk: 2, etapa: 'pronta' })]}
        jobs={[]}
        selected={new Set()}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('ordena por atualização mais recente por padrão', () => {
    render(
      <OperacaoLista
        itens={[
          item({ entrada_id: 1, nota_pk: 1, atualizado_em: '2026-08-18T09:00:00' }),
          item({ entrada_id: 2, nota_pk: 2, atualizado_em: '2026-08-18T10:00:00' }),
        ]}
        jobs={[]}
        selected={new Set()}
        onToggle={vi.fn()}
        onOpen={vi.fn()}
      />,
    );
    const ids = screen.getAllByText(/^#\d$/).map((node) => node.textContent);
    expect(ids).toEqual(['#2', '#1']);
  });

  it('mostra estado vazio quando não há notas', () => {
    render(<OperacaoLista itens={[]} jobs={[]} selected={new Set()} onToggle={vi.fn()} onOpen={vi.fn()} />);
    expect(screen.getByText('Nenhuma nota na operação.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-lista.test.tsx`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 3: Create `nota-operacao-row.tsx`**

```tsx
// frontend/src/features/coffee/operacao/components/nota-operacao-row.tsx
import React from 'react';
import { AlertCircle, ChevronRight, Clock3 } from 'lucide-react';
import { formatRelativeTime } from '../../format';
import type { CoffeeJob, CoffeeOperacaoItem } from '../../types';
import { OperacaoStepper } from './operacao-stepper';

interface NotaOperacaoRowProps {
  item: CoffeeOperacaoItem;
  selected: boolean;
  progress?: Pick<CoffeeJob, 'feitas' | 'total'>;
  onSelect: (selected: boolean) => void;
  onOpen: (trigger: HTMLButtonElement) => void;
}

function field(item: CoffeeOperacaoItem, key: string): string | null {
  const value = item.nota?.dados_json?.[key];
  return value == null || value === '' ? null : String(value);
}

export function NotaOperacaoRow({
  item,
  selected,
  progress,
  onSelect,
  onOpen,
}: NotaOperacaoRowProps): React.JSX.Element {
  const id = item.nota_pk ?? item.entrada_id;
  const local = [
    field(item, 'cidade'),
    field(item, 'tipo_local_instalacao'),
    field(item, 'local_instalacao_numero'),
  ].filter(Boolean).join('-');
  const alimentador = field(item, 'alimentador');

  return (
    <div
      className={[
        'flex items-center gap-[14px] border-b border-line px-[22px] py-[11px]',
        'even:bg-bg-2',
        selected ? 'bg-tint-green' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
        aria-label={`Selecionar nota ${id}`}
        className="size-[14px] shrink-0 accent-green"
      />
      <div className="flex w-[110px] shrink-0 flex-col gap-[3px]">
        <span className="font-mono text-[13px] font-semibold">#{id}</span>
        <span className="font-mono text-[10.5px] text-text-mute">
          {item.origem === 'verificar' ? 'Verificar' : 'Avulsa'}
        </span>
      </div>
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        aria-label={`Abrir detalhes da nota ${id}`}
        className="flex min-w-0 flex-1 items-center gap-[14px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-dim">
          {local || 'Local ainda não consultado'}
          {alimentador && (
            <span className="ml-1 font-mono text-[11.5px] text-text-mute">· {alimentador}</span>
          )}
        </span>
        <span className="shrink-0 text-[12px] text-text-dim">
          prioridade {field(item, 'prioridade') ?? '—'}
        </span>
        <OperacaoStepper etapa={item.etapa} />
        {item.erro ? (
          <span className="flex w-[110px] shrink-0 items-center gap-[5px] text-[12px] text-red">
            <AlertCircle className="size-3" /> {item.erro}
          </span>
        ) : (
          <span className="flex w-[110px] shrink-0 items-center gap-[5px] text-[12px] text-text-mute">
            <Clock3 className="size-3" />
            {formatRelativeTime(item.atualizado_em)}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-text-mute" />
      </button>
      {progress && (
        <div className="w-[70px] shrink-0" aria-label={`${progress.feitas} de ${progress.total}`}>
          <div className="h-[6px] overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${progress.total === 0 ? 0 : Math.round((progress.feitas / progress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `operacao-lista.tsx`**

```tsx
// frontend/src/features/coffee/operacao/components/operacao-lista.tsx
import React from 'react';
import type { CoffeeJob, CoffeeOperacaoItem } from '../../types';
import { NotaOperacaoRow } from './nota-operacao-row';

type Ordenacao = 'atualizacao' | 'prioridade';

interface OperacaoListaProps {
  itens: CoffeeOperacaoItem[];
  jobs: CoffeeJob[];
  selected: Set<number>;
  onToggle: (pk: number) => void;
  onOpen: (pk: number, trigger: HTMLButtonElement) => void;
}

function valorPrioridade(item: CoffeeOperacaoItem): number {
  const numero = Number(item.nota?.dados_json?.prioridade);
  return Number.isFinite(numero) ? numero : Number.POSITIVE_INFINITY;
}

function ordenar(itens: CoffeeOperacaoItem[], ordenacao: Ordenacao): CoffeeOperacaoItem[] {
  const copia = [...itens];
  if (ordenacao === 'prioridade') {
    return copia.sort((a, b) => valorPrioridade(a) - valorPrioridade(b));
  }
  return copia.sort((a, b) => (a.atualizado_em < b.atualizado_em ? 1 : -1));
}

const LEGENDA: Array<{ etapa: string; cor: string; rotulo: string }> = [
  { etapa: 'fila', cor: 'bg-indigo', rotulo: 'Fila' },
  { etapa: 'pronta', cor: 'bg-green', rotulo: 'Pronta' },
  { etapa: 'processando', cor: 'bg-amber', rotulo: 'Processando' },
  { etapa: 'aguardando_sap', cor: 'bg-blue', rotulo: 'Aguardando SAP' },
];

export function OperacaoLista(props: OperacaoListaProps): React.JSX.Element {
  const [ordenacao, setOrdenacao] = React.useState<Ordenacao>('atualizacao');
  const ordenados = ordenar(props.itens, ordenacao);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg-2 px-[22px] py-[9px]">
        <div className="flex items-center gap-3 text-[11.5px] text-text-mute">
          {LEGENDA.map((entrada) => (
            <span key={entrada.etapa} className="flex items-center gap-[5px]">
              <span className={`size-[7px] shrink-0 rounded-full ${entrada.cor}`} />
              {entrada.rotulo}
            </span>
          ))}
        </div>
        <label className="flex items-center gap-[6px] text-[12.5px] text-text-dim">
          Ordenar por:
          <select
            value={ordenacao}
            onChange={(event) => setOrdenacao(event.target.value as Ordenacao)}
            className="rounded-app-sm border border-line-2 bg-bg-2 px-[6px] py-[2px] text-[12.5px] text-text"
          >
            <option value="atualizacao">Atualização</option>
            <option value="prioridade">Prioridade</option>
          </select>
        </label>
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto">
        {ordenados.length === 0 ? (
          <div className="grid min-h-28 place-items-center text-center text-xs text-text-mute">
            Nenhuma nota na operação.
          </div>
        ) : ordenados.map((item) => {
          const pk = item.nota_pk ?? item.entrada_id;
          const progress = props.jobs.find((job) => job.id === item.operacao_id);
          return (
            <NotaOperacaoRow
              key={`${item.entrada_id}-${item.nota_pk ?? 'pending'}`}
              item={item}
              selected={props.selected.has(pk)}
              progress={progress}
              onSelect={() => props.onToggle(pk)}
              onOpen={(trigger) => props.onOpen(pk, trigger)}
            />
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Remove the Kanban files**

```bash
git rm frontend/src/features/coffee/operacao/components/operacao-kanban.tsx
git rm frontend/src/features/coffee/operacao/components/operacao-column.tsx
git rm frontend/src/features/coffee/operacao/components/nota-operacao-card.tsx
```

- [ ] **Step 6: Wire `OperacaoLista` into `coffee-operacao.tsx`**

In `coffee-operacao.tsx`, replace the import:

```typescript
import { OperacaoKanban } from './components/operacao-kanban';
```

with:

```typescript
import { OperacaoLista } from './components/operacao-lista';
```

and replace the render call:

```tsx
      <OperacaoKanban
        itens={itens}
        jobs={quadro.data?.operacoes_ativas ?? []}
        selected={selected}
        onToggle={toggle}
        onOpen={openInspector}
      />
```

with:

```tsx
      <OperacaoLista
        itens={itens}
        jobs={quadro.data?.operacoes_ativas ?? []}
        selected={selected}
        onToggle={toggle}
        onOpen={openInspector}
      />
```

- [ ] **Step 7: Rename the batch-bar label**

In `operacao-batch-bar.tsx`, since there are no more columns, only etapas:

```tsx
      {etapa !== null && columnIds.length > itens.length && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelectColumn(columnIds)}
        >
          <ListChecks /> Selecionar coluna
        </Button>
      )}
```

becomes:

```tsx
      {etapa !== null && columnIds.length > itens.length && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelectColumn(columnIds)}
        >
          <ListChecks /> Selecionar etapa
        </Button>
      )}
```

(the `onSelectColumn`/`columnIds` prop and variable names stay — they still
select every item sharing the current etapa, only the visible label changes)

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-lista.test.tsx`
Expected: PASS.

- [ ] **Step 9: Type-check and run the full frontend test suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/features/coffee`
Expected: PASS — confirms nothing else imports the removed Kanban files.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/features/coffee/operacao
git commit -m "feat(coffee): replace Operação Kanban with a sortable list + per-note stepper"
```

---

### Task 6: Frontend — composer always visible, consult vs. enqueue

**Files:**
- Modify: `frontend/src/features/coffee/operacao/components/operacao-composer.tsx`
- Test: `frontend/src/features/coffee/operacao/components/operacao-composer.test.ts`
- Test: `frontend/src/features/coffee/operacao/components/operacao-composer.render.test.tsx` (new)

**Interfaces:**
- Consumes: `ParsedIds` (Task 3).
- Produces: `OperacaoComposer(props: { pendingConsulta, pendingAdicionar,
  idsNaOperacao?, onConsultar: (ids) => Promise<void>, onAdicionarFila:
  (ids) => Promise<void> }): React.JSX.Element` — always rendered, no
  `open`/collapsed state. Task 7 wires `onConsultar` to the new read-only
  job and `onAdicionarFila` to the existing enqueue mutation.

- [ ] **Step 1: Write the failing render test**

```tsx
// frontend/src/features/coffee/operacao/components/operacao-composer.render.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperacaoComposer } from './operacao-composer';

describe('OperacaoComposer', () => {
  it('está sempre visível, sem precisar expandir', () => {
    render(
      <OperacaoComposer
        pendingConsulta={false}
        pendingAdicionar={false}
        onConsultar={vi.fn().mockResolvedValue(undefined)}
        onAdicionarFila={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByPlaceholderText(/Cole IDs/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Consultar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Adicionar à fila/ })).toBeInTheDocument();
  });

  it('mostra chips com o token exato de repetidos e inválidos', () => {
    render(
      <OperacaoComposer
        pendingConsulta={false}
        pendingAdicionar={false}
        onConsultar={vi.fn().mockResolvedValue(undefined)}
        onAdicionarFila={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Cole IDs/), {
      target: { value: '10 10 abc' },
    });
    expect(screen.getByText('repetido: 10')).toBeInTheDocument();
    expect(screen.getByText('inválido: abc')).toBeInTheDocument();
  });

  it('chama onConsultar com os IDs válidos sem limpar o texto', async () => {
    const onConsultar = vi.fn().mockResolvedValue(undefined);
    render(
      <OperacaoComposer
        pendingConsulta={false}
        pendingAdicionar={false}
        onConsultar={onConsultar}
        onAdicionarFila={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Cole IDs/), { target: { value: '10 20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Consultar' }));
    await Promise.resolve();
    expect(onConsultar).toHaveBeenCalledWith([10, 20]);
    expect(screen.getByPlaceholderText(/Cole IDs/)).toHaveValue('10 20');
  });

  it('chama onAdicionarFila e limpa o texto ao concluir', async () => {
    const onAdicionarFila = vi.fn().mockResolvedValue(undefined);
    render(
      <OperacaoComposer
        pendingConsulta={false}
        pendingAdicionar={false}
        onConsultar={vi.fn().mockResolvedValue(undefined)}
        onAdicionarFila={onAdicionarFila}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Cole IDs/), { target: { value: '10 20' } });
    fireEvent.click(screen.getByRole('button', { name: /Adicionar à fila/ }));
    await Promise.resolve();
    await Promise.resolve();
    expect(onAdicionarFila).toHaveBeenCalledWith([10, 20]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-composer.render.test.tsx`
Expected: FAIL — component still has the old `open`/single-`Consultar`-button shape.

- [ ] **Step 3: Rewrite the component**

Replace the component part of `operacao-composer.tsx` (keep the
`parseCoffeeIds`/`ParsedIds` export from Task 3 at the top of the file)
with:

```tsx
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface OperacaoComposerProps {
  pendingConsulta: boolean;
  pendingAdicionar: boolean;
  /** IDs já presentes na Operação, pra avisar antes de enfileirar de novo.
   * Omitido quando o quadro ainda não carregou. */
  idsNaOperacao?: Set<number>;
  onConsultar: (ids: number[]) => Promise<void>;
  onAdicionarFila: (ids: number[]) => Promise<void>;
}

export function OperacaoComposer({
  pendingConsulta,
  pendingAdicionar,
  idsNaOperacao,
  onConsultar,
  onAdicionarFila,
}: OperacaoComposerProps): React.JSX.Element {
  const [value, setValue] = React.useState('');
  const [erro, setErro] = React.useState<string | null>(null);
  const parsed = React.useMemo(() => parseCoffeeIds(value), [value]);
  const jaNaOperacao = idsNaOperacao
    ? parsed.ids.filter((id) => idsNaOperacao.has(id)).length
    : 0;
  const pending = pendingConsulta || pendingAdicionar;

  async function consultar(): Promise<void> {
    if (parsed.ids.length === 0 || pending) return;
    setErro(null);
    try {
      await onConsultar(parsed.ids);
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    }
  }

  async function adicionarFila(): Promise<void> {
    if (parsed.ids.length === 0 || pending) return;
    setErro(null);
    try {
      await onAdicionarFila(parsed.ids);
      setValue('');
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void adicionarFila();
    }
  }

  return (
    <section className="flex flex-col gap-[9px] border-b border-line bg-bg-2 px-[22px] py-[14px]">
      <div className="flex items-start gap-[10px]">
        <Textarea
          value={value}
          onChange={(event) => { setValue(event.target.value); setErro(null); }}
          onKeyDown={onKeyDown}
          placeholder="Cole IDs — espaço, vírgula ou linha"
          rows={2}
          aria-invalid={erro !== null}
          className="min-h-[52px] flex-1 resize-none font-mono text-[12.5px]"
          disabled={pending}
        />
        <div className="flex shrink-0 flex-col gap-[6px]">
          <Button
            variant="outline"
            size="sm"
            disabled={parsed.ids.length === 0 || pending}
            onClick={() => void consultar()}
          >
            <Search /> {pendingConsulta ? 'Consultando…' : 'Consultar'}
          </Button>
          <Button
            size="sm"
            disabled={parsed.ids.length === 0 || pending}
            onClick={() => void adicionarFila()}
          >
            <Plus /> {pendingAdicionar ? 'Adicionando…' : 'Adicionar à fila'}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-[6px] text-xs text-text-mute">
        <span className="font-medium text-text">{parsed.ids.length} válidos</span>
        {parsed.repetidos.map((id) => (
          <span key={`rep-${id}`} className="rounded-full bg-tint-amber px-[9px] py-[3px] font-mono text-[11px] text-amber">
            repetido: {id}
          </span>
        ))}
        {parsed.invalidos.map((token, indice) => (
          <span key={`inv-${indice}-${token}`} className="rounded-full bg-tint-red px-[9px] py-[3px] font-mono text-[11px] text-red">
            inválido: {token}
          </span>
        ))}
        {jaNaOperacao > 0 && (
          <span className="text-amber">{jaNaOperacao} já na operação</span>
        )}
      </div>
      {erro && (
        <p role="alert" className="text-xs text-red">{erro}</p>
      )}
      <span className="text-[11px] text-text-mute">Ctrl+Enter adiciona à fila</span>
    </section>
  );
}
```

Add `import React from 'react';` at the top of the file alongside the
existing `lucide-react` import if it isn't already there.

- [ ] **Step 4: Run both composer test files**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-composer`
Expected: PASS (parsing tests from Task 3 + the new render tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/coffee/operacao/components/operacao-composer.tsx frontend/src/features/coffee/operacao/components/operacao-composer.render.test.tsx
git commit -m "feat(coffee): composer always visible, splits consult from enqueue"
```

---

### Task 7: Frontend — consulta-leitura hook, result panel, final wiring

**Files:**
- Create: `frontend/src/features/coffee/operacao/use-consulta-leitura.ts`
- Create: `frontend/src/features/coffee/operacao/components/operacao-consulta-resultado.tsx`
- Modify: `frontend/src/features/coffee/operacao/coffee-operacao.tsx`
- Test: `frontend/src/features/coffee/operacao/use-consulta-leitura.test.ts`
- Test: `frontend/src/features/coffee/operacao/components/operacao-consulta-resultado.test.tsx`

**Interfaces:**
- Consumes: `OperacaoApi.consultarLeitura` (Task 2), `aguardarJobOperacao`
  from `use-coffee-operacao.ts` (unchanged), `ConsultaLoteItem` (Task 2),
  `OperacaoComposer` (Task 6).
- Produces: `useConsultaLeitura()` returning `{ resultados, selecionados,
  pending, iniciar(ids), toggle(pk), selecionarTodasElegiveis(), fechar(),
  removerDosResultados(ids) }`; `OperacaoConsultaResultado` component.

- [ ] **Step 1: Write the failing hook test**

```typescript
// frontend/src/features/coffee/operacao/use-consulta-leitura.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConsultaLeitura } from './use-consulta-leitura';
import { OperacaoApi } from './operacao-api';
import * as useCoffeeOperacao from './use-coffee-operacao';

describe('useConsultaLeitura', () => {
  beforeEach(() => {
    vi.spyOn(OperacaoApi, 'consultarLeitura').mockResolvedValue({ job_id: 'job-1' });
    vi.spyOn(useCoffeeOperacao, 'aguardarJobOperacao').mockResolvedValue({
      estado: 'concluido',
      total: 2,
      feitas: 2,
      erros: [],
      iniciado_em: '2026-08-18T10:00:00',
      resultados: [
        { pk: 1, id_sap: null, classificacao: 'nao_gerada', ja_na_operacao: false, elegivel: true, local_instalacao: null, erro: null },
        { pk: 2, id_sap: 123, classificacao: 'gerada', ja_na_operacao: false, elegivel: false, local_instalacao: null, erro: null },
      ],
    });
  });

  it('popula resultados após iniciar', async () => {
    const { result } = renderHook(() => useConsultaLeitura());
    await act(async () => { await result.current.iniciar([1, 2]); });
    expect(result.current.resultados).toHaveLength(2);
  });

  it('selecionarTodasElegiveis marca só as notas elegíveis', async () => {
    const { result } = renderHook(() => useConsultaLeitura());
    await act(async () => { await result.current.iniciar([1, 2]); });
    act(() => { result.current.selecionarTodasElegiveis(); });
    expect(result.current.selecionados).toEqual(new Set([1]));
  });

  it('removerDosResultados tira os IDs da lista e da seleção', async () => {
    const { result } = renderHook(() => useConsultaLeitura());
    await act(async () => { await result.current.iniciar([1, 2]); });
    act(() => { result.current.toggle(1); });
    act(() => { result.current.removerDosResultados([1]); });
    expect(result.current.resultados?.map((item) => item.pk)).toEqual([2]);
    expect(result.current.selecionados.has(1)).toBe(false);
  });

  it('fechar limpa resultados e seleção', async () => {
    const { result } = renderHook(() => useConsultaLeitura());
    await act(async () => { await result.current.iniciar([1, 2]); });
    act(() => { result.current.fechar(); });
    expect(result.current.resultados).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/use-consulta-leitura.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the hook**

```typescript
// frontend/src/features/coffee/operacao/use-consulta-leitura.ts
import React from 'react';
import { OperacaoApi } from './operacao-api';
import { aguardarJobOperacao } from './use-coffee-operacao';
import type { ConsultaLoteItem } from '../types';

/** Estado da consulta somente-leitura da Operação: separado de
 * useCoffeeOperacao porque não mexe no quadro (nenhuma invalidação de
 * query) — é um resultado à parte que o usuário decide, linha a linha ou
 * em lote, se quer promover pra fila de geração. */
export function useConsultaLeitura() {
  const [resultados, setResultados] = React.useState<ConsultaLoteItem[] | null>(null);
  const [selecionados, setSelecionados] = React.useState<Set<number>>(new Set());
  const [pending, setPending] = React.useState(false);

  async function iniciar(ids: number[]): Promise<void> {
    setPending(true);
    try {
      const { job_id } = await OperacaoApi.consultarLeitura(ids);
      const job = await aguardarJobOperacao(job_id);
      setResultados(job.resultados ?? []);
      setSelecionados(new Set());
    } finally {
      setPending(false);
    }
  }

  function toggle(pk: number): void {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(pk)) proximo.delete(pk);
      else proximo.add(pk);
      return proximo;
    });
  }

  function selecionarTodasElegiveis(): void {
    const elegiveis = (resultados ?? [])
      .filter((item) => item.elegivel)
      .map((item) => item.pk);
    setSelecionados(new Set(elegiveis));
  }

  function fechar(): void {
    setResultados(null);
    setSelecionados(new Set());
  }

  function removerDosResultados(ids: number[]): void {
    setResultados((atual) => atual?.filter((item) => !ids.includes(item.pk)) ?? null);
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      ids.forEach((id) => proximo.delete(id));
      return proximo;
    });
  }

  return {
    resultados,
    selecionados,
    pending,
    iniciar,
    toggle,
    selecionarTodasElegiveis,
    fechar,
    removerDosResultados,
  };
}
```

- [ ] **Step 4: Run hook test to verify it passes**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/use-consulta-leitura.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing result-panel test**

```tsx
// frontend/src/features/coffee/operacao/components/operacao-consulta-resultado.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperacaoConsultaResultado } from './operacao-consulta-resultado';
import type { ConsultaLoteItem } from '../../types';

const RESULTADOS: ConsultaLoteItem[] = [
  { pk: 1, id_sap: null, classificacao: 'nao_gerada', ja_na_operacao: false, elegivel: true, local_instalacao: 'Itu-PS-05', erro: null },
  { pk: 2, id_sap: 17259425, classificacao: 'gerada', ja_na_operacao: false, elegivel: false, local_instalacao: 'Bauru-PT-08', erro: null },
  { pk: 3, id_sap: 10000000, classificacao: 'pendente', ja_na_operacao: true, elegivel: false, local_instalacao: 'Sorocaba-PT-51', erro: null },
  { pk: 4, id_sap: null, classificacao: null, ja_na_operacao: false, elegivel: false, local_instalacao: null, erro: 'nota não encontrada' },
];

describe('OperacaoConsultaResultado', () => {
  it('mostra o resumo por contagem', () => {
    render(
      <OperacaoConsultaResultado
        resultados={RESULTADOS}
        selecionados={new Set()}
        onToggle={vi.fn()}
        onSelecionarTodasElegiveis={vi.fn()}
        onAdicionarFila={vi.fn()}
        onFechar={vi.fn()}
      />,
    );
    expect(screen.getByText('1 ainda não geradas')).toBeInTheDocument();
    expect(screen.getByText('1 já concluídas')).toBeInTheDocument();
    expect(screen.getByText('1 já na Operação')).toBeInTheDocument();
    expect(screen.getByText('1 erros')).toBeInTheDocument();
  });

  it('só mostra "+ Fila" pra notas elegíveis', () => {
    render(
      <OperacaoConsultaResultado
        resultados={RESULTADOS}
        selecionados={new Set()}
        onToggle={vi.fn()}
        onSelecionarTodasElegiveis={vi.fn()}
        onAdicionarFila={vi.fn()}
        onFechar={vi.fn()}
      />,
    );
    expect(screen.getAllByRole('button', { name: '+ Fila' })).toHaveLength(1);
  });

  it('+ Fila de uma linha chama onAdicionarFila com um único id', () => {
    const onAdicionarFila = vi.fn();
    render(
      <OperacaoConsultaResultado
        resultados={RESULTADOS}
        selecionados={new Set()}
        onToggle={vi.fn()}
        onSelecionarTodasElegiveis={vi.fn()}
        onAdicionarFila={onAdicionarFila}
        onFechar={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '+ Fila' }));
    expect(onAdicionarFila).toHaveBeenCalledWith([1]);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-consulta-resultado.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement the result panel**

```tsx
// frontend/src/features/coffee/operacao/components/operacao-consulta-resultado.tsx
import React from 'react';
import { Copy, ExternalLink, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ConsultaLoteItem } from '../../types';

interface OperacaoConsultaResultadoProps {
  resultados: ConsultaLoteItem[];
  selecionados: Set<number>;
  onToggle: (pk: number) => void;
  onSelecionarTodasElegiveis: () => void;
  onAdicionarFila: (ids: number[]) => void;
  onFechar: () => void;
}

interface Resumo {
  elegiveis: number;
  concluidas: number;
  naOperacao: number;
  erros: number;
}

function resumir(resultados: ConsultaLoteItem[]): Resumo {
  const inicial: Resumo = { elegiveis: 0, concluidas: 0, naOperacao: 0, erros: 0 };
  return resultados.reduce((acc, item) => {
    if (item.erro) return { ...acc, erros: acc.erros + 1 };
    if (item.ja_na_operacao) return { ...acc, naOperacao: acc.naOperacao + 1 };
    if (item.elegivel) return { ...acc, elegiveis: acc.elegiveis + 1 };
    return { ...acc, concluidas: acc.concluidas + 1 };
  }, inicial);
}

export function OperacaoConsultaResultado({
  resultados,
  selecionados,
  onToggle,
  onSelecionarTodasElegiveis,
  onAdicionarFila,
  onFechar,
}: OperacaoConsultaResultadoProps): React.JSX.Element {
  const contagens = resumir(resultados);
  const elegiveis = resultados.filter((item) => item.elegivel);

  return (
    <section className="flex flex-col border-b border-line">
      <div className="flex items-center justify-between border-b border-line px-[22px] py-[10px]">
        <span className="text-[13px] font-semibold">
          Resultado da consulta
          <span className="ml-2 font-mono text-xs font-normal text-text-mute">
            {resultados.length} notas · somente leitura
          </span>
        </span>
        <Button variant="ghost" size="xs" onClick={onFechar}>
          <X /> Fechar
        </Button>
      </div>
      <div className="flex items-center gap-[6px] border-b border-line bg-tint-indigo px-[22px] py-[7px] text-[12px] text-indigo">
        <Info className="size-[13px] shrink-0" />
        Isso só busca os dados — nada aqui entra na fila de geração até você
        clicar em &quot;Adicionar à fila&quot;.
      </div>
      <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[22px] py-[10px] text-xs text-text-dim">
        <span>{contagens.elegiveis} ainda não geradas</span>
        <span>{contagens.concluidas} já concluídas</span>
        <span>{contagens.naOperacao} já na Operação</span>
        <span>{contagens.erros} erros</span>
      </div>
      <div className="max-h-[336px] overflow-y-auto border-b border-line">
        {resultados.map((item) => (
          <div key={item.pk} className="flex items-center gap-[14px] border-b border-line px-[22px] py-[10px] even:bg-bg-2">
            <input
              type="checkbox"
              disabled={!item.elegivel}
              checked={selecionados.has(item.pk)}
              onChange={() => onToggle(item.pk)}
              aria-label={`Selecionar nota ${item.pk}`}
              className="size-[14px] shrink-0 accent-green disabled:opacity-40"
            />
            <span className="w-[70px] shrink-0 font-mono text-[13px] font-semibold">#{item.pk}</span>
            <span className="min-w-[140px] flex-1 truncate text-[12.5px] text-text-dim">
              {item.local_instalacao ?? '—'}
            </span>
            {item.erro ? (
              <span className="text-[12px] text-red">{item.erro}</span>
            ) : item.elegivel ? (
              <div className="flex shrink-0 items-center gap-[8px]">
                <span className="rounded-[5px] bg-surface-3 px-2 py-[3px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-dim">
                  Ainda não gerada
                </span>
                <Button variant="outline" size="xs" onClick={() => onAdicionarFila([item.pk])}>
                  + Fila
                </Button>
              </div>
            ) : item.ja_na_operacao ? (
              <span className="shrink-0 rounded-[5px] bg-tint-blue px-2 py-[3px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-blue">
                Já na Operação
              </span>
            ) : (
              <div className="flex shrink-0 items-center gap-[8px]">
                <span className="font-mono text-[12.5px] font-semibold">SAP {item.id_sap}</span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(String(item.id_sap))}
                  aria-label={`Copiar SAP ${item.id_sap}`}
                  className="flex size-[24px] items-center justify-center rounded-md border border-line text-text-dim"
                >
                  <Copy className="size-[13px]" />
                </button>
                <span className="flex items-center gap-[3px] text-[11.5px] text-text-mute">
                  já concluída <ExternalLink className="size-3" />
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-[12px] px-[22px] py-[9px]">
        <label className="flex items-center gap-[7px] text-xs text-text-mute">
          <input
            type="checkbox"
            onChange={onSelecionarTodasElegiveis}
            disabled={elegiveis.length === 0}
            className="size-[14px] accent-green"
          />
          Selecionar todas elegíveis
          <span className="font-mono opacity-70">({elegiveis.length})</span>
        </label>
        <span className="ml-auto text-[12.5px] font-medium text-text-dim">
          {selecionados.size} selecionadas
        </span>
        <Button size="sm" disabled={selecionados.size === 0} onClick={() => onAdicionarFila([...selecionados])}>
          Adicionar à fila de geração
        </Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/features/coffee/operacao/components/operacao-consulta-resultado.test.tsx`
Expected: PASS.

- [ ] **Step 9: Wire everything into `coffee-operacao.tsx`**

Add the import:

```typescript
import { OperacaoConsultaResultado } from './components/operacao-consulta-resultado';
import { useConsultaLeitura } from './use-consulta-leitura';
```

Inside `CoffeeOperacao`, alongside the existing `useCoffeeOperacao()` call:

```typescript
  const consultaLeitura = useConsultaLeitura();

  function handleConsultar(ids: number[]): Promise<void> {
    return consultaLeitura.iniciar(ids).catch((error: unknown) => {
      mutationError('consultar as notas', error);
      throw error;
    });
  }

  function handleAdicionarFilaDoResultado(ids: number[]): void {
    consultarViaComposer(ids)
      .then(() => consultaLeitura.removerDosResultados(ids))
      .catch(() => { /* consultarViaComposer já mostra o toast de erro */ });
  }
```

The composer moves out of `<header>` — it is no longer part of the header
row, it is its own always-visible bar directly below it. Replace:

```tsx
        <Button
          variant="outline"
          size="sm"
          disabled={waitingSapIds.length === 0 || atualizarSap.isPending}
          onClick={() => updateSap(waitingSapIds)}
        >
          <RefreshCw /> Atualizar pendentes
        </Button>
        <OperacaoComposer
          pending={consultar.isPending}
          idsNaOperacao={idsNaOperacao}
          onConsultar={consultarViaComposer}
        />
      </header>
      {quadro.isError && (
```

with:

```tsx
        <Button
          variant="outline"
          size="sm"
          disabled={waitingSapIds.length === 0 || atualizarSap.isPending}
          onClick={() => updateSap(waitingSapIds)}
        >
          <RefreshCw /> Atualizar pendentes
        </Button>
      </header>
      <OperacaoComposer
        pendingConsulta={consultaLeitura.pending}
        pendingAdicionar={consultar.isPending}
        idsNaOperacao={idsNaOperacao}
        onConsultar={handleConsultar}
        onAdicionarFila={consultarViaComposer}
      />
      {consultaLeitura.resultados && (
        <OperacaoConsultaResultado
          resultados={consultaLeitura.resultados}
          selecionados={consultaLeitura.selecionados}
          onToggle={consultaLeitura.toggle}
          onSelecionarTodasElegiveis={consultaLeitura.selecionarTodasElegiveis}
          onAdicionarFila={handleAdicionarFilaDoResultado}
          onFechar={consultaLeitura.fechar}
        />
      )}
      {quadro.isError && (
```

- [ ] **Step 10: Type-check and run the full frontend coffee test suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run src/features/coffee`
Expected: PASS.

- [ ] **Step 11: Manual verification**

Run: `cd frontend && npm run dev` (or the project's existing dev-server
command), open COFFEE → Operação, and confirm:
- the composer is visible without clicking anything;
- pasting IDs and clicking "Consultar" opens the result panel without any
  new item appearing in the list below;
- clicking "+ Fila" on an eligible result row makes that row disappear from
  the result panel and a new row appear in the list;
- pasting a large batch (30+ IDs) into "Consultar" keeps the result list's
  own scrollbar — the page layout doesn't grow unbounded.

- [ ] **Step 12: Commit**

```bash
git add frontend/src/features/coffee/operacao
git commit -m "feat(coffee): wire read-only consult result panel into Operação"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/dev/02-frontend-coffee.md`
- Modify: `docs/dev/05-backend-coffee-module.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Update the frontend doc**

In `docs/dev/02-frontend-coffee.md`, replace the line describing
`operacao-kanban.tsx`:

```
| `operacao/components/operacao-kanban.tsx` | Quatro colunas responsivas, sem drag and drop: Fila, Prontas, Processando e Aguardando SAP. |
```

with:

```
| `operacao/components/operacao-lista.tsx` | Lista ordenável (Atualização/Prioridade); cada linha mostra a jornada da nota via `operacao-stepper.tsx`, sem colunas fixas. |
| `operacao/components/operacao-stepper.tsx` | Mini-stepper de 5 nós (Fila/Pronta/Processando/Aguardando SAP + nó fantasma "Concluída"), reutilizado por `nota-operacao-row.tsx`. |
| `operacao/components/operacao-consulta-resultado.tsx` | Painel recolhível com o resultado da consulta somente-leitura: resumo por contagem, lista com altura travada, `+ Fila` por linha e "Selecionar todas elegíveis". |
```

and update the composer line:

```
| `operacao/components/operacao-composer.tsx` | Entrada de IDs; informa válidos, repetidos e inválidos antes da consulta. |
```

to:

```
| `operacao/components/operacao-composer.tsx` | Barra sempre visível (sem expandir/recolher) com dois botões — `Consultar` (somente leitura) e `Adicionar à fila` (enfileira); mostra chips com o token exato de repetidos/inválidos, não só a contagem. |
```

Also update the prose section "Operação: Kanban persistido" (~line 39) that
describes the composer closing itself after `Consultar` and the four
columns — rewrite it to describe the always-visible composer, the
`Consultar`/`Adicionar à fila` split, and the list+stepper, matching this
plan's Task 5–7. Keep the persistence/job-recovery paragraphs unchanged —
those didn't change.

- [ ] **Step 2: Update the backend doc**

In `docs/dev/05-backend-coffee-module.md`, add a row to the routes table
(~line 229, right after `POST /operacao/consultar`):

```
| `POST /operacao/consultar-lote` | Consulta somente leitura em lote (não enfileira, não escreve em `notas_coffee` nem `coffee_fila_operacao`) — mesma lógica de `GET /consultar/{id}`, em job. | `operacao/use-consulta-leitura.ts` |
```

- [ ] **Step 3: Proofread against the actual code**

Re-read both edited sections against `coffee-operacao.tsx`,
`operacao-lista.tsx`, `operacao-consulta-resultado.tsx`, and `routes.py` to
confirm no stale filenames or behavior remain from the Kanban description.

- [ ] **Step 4: Commit**

```bash
git add docs/dev/02-frontend-coffee.md docs/dev/05-backend-coffee-module.md
git commit -m "docs(coffee): document the Operação list, stepper, and read-only consult"
```
