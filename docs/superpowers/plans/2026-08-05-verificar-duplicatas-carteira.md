# Cruzamento de Duplicatas Externas com a Carteira de Notas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enriquecer candidatas duplicatas externas do Verificar (fora da planilha) com dados reais da Carteira de Notas (espelho local da base COFFEE/Databricks), com fallback de busca ao vivo no COFFEE para os 2 campos que a Carteira não tem (poste, referência).

**Architecture:** Backend faz um lookup em lote (uma query `IN`) na Carteira ao montar `/api/data`, sem nenhuma chamada de rede síncrona. Frontend ganha um componente novo (`ExternalCandidateCard`) com 2 sub-estados (match na Carteira / sem match), e um botão por card que dispara uma busca ao vivo no COFFEE sob demanda (nunca em lote) para completar poste/referência.

**Tech Stack:** FastAPI, SQLite (`carteira_module`), React 18 + TypeScript, React Query (`useMutation`), Vitest (testes com `renderToStaticMarkup`, sem jsdom/testing-library — este projeto não tem essas libs).

## Global Constraints

- Nunca usar `any` em TypeScript — `unknown` ou tipo próprio (CLAUDE.md).
- Nenhuma chamada de rede em lote/automática à API COFFEE — só sob demanda, um candidato por vez, disparada por clique do usuário (spec, seção "Objetivo" item 3).
- Zero escrita nova em banco além da que `POST/GET /api/coffee/consultar/{id}` já faz hoje (spec, "Out of scope").
- Componentes de UI só renderizam — lógica de merge de campos fica em função pura testável sem DOM (`mergeConsultaCampos`).
- Todo código novo em português nos identificadores de domínio (nomes de função, variáveis), consistente com o resto do repositório.
- Toda mudança de arquitetura/comportamento documentada em `docs/dev/` no mesmo commit (CLAUDE.md, seção Documentation).

---

## Contexto de arquivos existentes (não mexer, só referência)

- `backend/carteira_module/repository.py:240` — `obter_muitos(conn, id_onrs: list[int]) -> dict[int, dict]` já existe, devolve `{id_onr: row}` com todas as colunas de `nota_carteira` (`local_instalacao`, `sintoma`, `componente_novo`, `status_sap`, `prioridade_sap`, `descricao_conjunto`, `conjunto`, `latitude`, `longitude`, `ausente_na_origem_em`, entre outras). Não precisa de nenhuma mudança.
- `backend/carteira_module/db.py:12` — `conectar() -> sqlite3.Connection` (row_factory já é `sqlite3.Row`). Não precisa de mudança.
- `backend/coffee_module/client.py:41` — `buscar_nota(id) -> dict` já devolve `fields` bruto da API COFFEE (`json_all/{id}`). Não precisa de mudança.
- `backend/main.py:334-349` — loop que monta `record["duplicates"]` a partir de `parse_duplicate_ids`/`enrich_candidate`. Ponto de inserção da nova função.
- `frontend/src/features/verificar/duplicate-compare.tsx` — componente que hoje renderiza in-sheet + genérico "Externo". Vai ganhar um branch novo delegando pro componente do Task 5.
- `frontend/src/api.ts:221` — `consultarNota(id: number): Promise<CoffeeConsulta>`, já existe, chama `GET /api/coffee/consultar/{id}`. Não precisa de mudança (só o tipo de retorno ganha campos no Task 2/3).

---

### Task 1: Backend — enriquecer candidatas externas com a Carteira

**Files:**
- Modify: `backend/main.py`
- Test: `backend/test_upload.py`

**Interfaces:**
- Consumes: `carteira_module.db.conectar()`, `carteira_module.repository.obter_muitos(conn, id_onrs: list[int]) -> dict[int, dict]` (já existem, não mudam).
- Produces: `enriquecer_candidatos_externos(records: list[dict]) -> None` — muta `records` in-place. Consumida pelo Task 2 indiretamente não; é chamada só dentro de `montar_registros_triagem`, nenhuma outra task depende dela diretamente.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final de `backend/test_upload.py`:

```python
def test_enriquecer_candidatos_externos_com_match(tmp_path, monkeypatch):
    """Candidata externa com id_onr presente na Carteira ganha os campos reais."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path))
    from carteira_module import db as carteira_db
    carteira_db.inicializar_banco()
    conn = carteira_db.conectar()
    conn.execute(
        "INSERT INTO nota_carteira (id_onr, local_instalacao, sintoma, componente_novo, "
        "status_sap, prioridade_sap, descricao_conjunto, conjunto, latitude, longitude, "
        "ausente_na_origem_em) VALUES (171153, '718ET00026773', 'queda', 'chave', "
        "'Pendente', 3, 'POSTE DEMANDA', 'POSTE', '-23.1', '-45.2', NULL)"
    )
    conn.commit()
    conn.close()

    from main import enriquecer_candidatos_externos
    records = [{
        "id": "100",
        "duplicates": [{"id": "171153", "in_sheet": False}],
    }]
    enriquecer_candidatos_externos(records)

    cand = records[0]["duplicates"][0]
    assert cand["carteira_match"] is True
    assert cand["local_instalacao"] == "718ET00026773"
    assert cand["problema"] == "chave · queda"
    assert cand["status_sap"] == "Pendente"
    assert cand["prioridade_sap"] == 3
    assert cand["conjunto"] == "POSTE DEMANDA"
    assert cand["carteira_ausente_em"] is None


def test_enriquecer_candidatos_externos_sem_match(tmp_path, monkeypatch):
    """Candidata externa sem linha na Carteira só ganha carteira_match=False."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path))
    from carteira_module import db as carteira_db
    carteira_db.inicializar_banco()

    from main import enriquecer_candidatos_externos
    records = [{"id": "100", "duplicates": [{"id": "999999", "in_sheet": False}]}]
    enriquecer_candidatos_externos(records)

    cand = records[0]["duplicates"][0]
    assert cand["carteira_match"] is False
    assert "local_instalacao" not in cand


def test_enriquecer_candidatos_externos_ignora_in_sheet(tmp_path, monkeypatch):
    """Candidata in_sheet=True não é tocada (já veio enriquecida por enrich_candidate)."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path))
    from carteira_module import db as carteira_db
    carteira_db.inicializar_banco()

    from main import enriquecer_candidatos_externos
    original = {"id": "200", "in_sheet": True, "local_instalacao": "SER-11"}
    records = [{"id": "100", "duplicates": [dict(original)]}]
    enriquecer_candidatos_externos(records)

    assert records[0]["duplicates"][0] == original


def test_enriquecer_candidatos_externos_lote_vazio_no_op(tmp_path, monkeypatch):
    """Sem candidatas externas, a função não deve nem abrir conexão com a Carteira."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path / "carteira-nao-existe"))
    from main import enriquecer_candidatos_externos
    records = [{"id": "100", "duplicates": []}]
    enriquecer_candidatos_externos(records)  # não deve levantar (banco nem existe)
    assert records[0]["duplicates"] == []
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && venv/Scripts/python -m pytest test_upload.py -k enriquecer_candidatos_externos -v`
Expected: FAIL com `ImportError: cannot import name 'enriquecer_candidatos_externos' from 'main'`

- [ ] **Step 3: Implementar `enriquecer_candidatos_externos` em `backend/main.py`**

No topo do arquivo, junto aos imports existentes de módulos internos (perto de `from coffee_module import db as _coffee_db`, linha 18), adicionar:

```python
from carteira_module import db as _carteira_db
from carteira_module import repository as _carteira_repo
```

Adicionar a função logo depois de `enrich_candidate` (antes de `montar_registros_triagem`):

```python
def enriquecer_candidatos_externos(records: list[dict]) -> None:
    """Preenche candidatas externas (in_sheet=False) com dados da Carteira, em lote.

    Uma única query IN para todas as candidatas externas do request inteiro —
    nunca uma chamada por candidata. Candidatas in_sheet=True não são tocadas
    (já vieram enriquecidas por enrich_candidate a partir da própria planilha).
    """
    ids_externos = {
        int(cand["id"])
        for record in records for cand in record["duplicates"]
        if not cand["in_sheet"] and str(cand["id"]).isdigit()
    }
    if not ids_externos:
        return

    conn = _carteira_db.conectar()
    try:
        encontrados = _carteira_repo.obter_muitos(conn, list(ids_externos))
    finally:
        conn.close()

    for record in records:
        for cand in record["duplicates"]:
            if cand["in_sheet"]:
                continue
            nota = encontrados.get(int(cand["id"])) if str(cand["id"]).isdigit() else None
            cand["carteira_match"] = nota is not None
            if nota is None:
                continue
            cand["local_instalacao"] = nota.get("local_instalacao") or ""
            cand["problema"] = " · ".join(
                parte for parte in [nota.get("componente_novo"), nota.get("sintoma")] if parte
            ) or ""
            cand["status_sap"] = nota.get("status_sap")
            cand["prioridade_sap"] = nota.get("prioridade_sap")
            cand["conjunto"] = nota.get("descricao_conjunto") or nota.get("conjunto")
            cand["latitude"] = nota.get("latitude")
            cand["longitude"] = nota.get("longitude")
            cand["carteira_ausente_em"] = nota.get("ausente_na_origem_em")
```

Em `montar_registros_triagem`, logo antes do `for record in records: enriquecer_gerador(record, membros)` (perto da linha 350), adicionar a chamada:

```python
    enriquecer_candidatos_externos(records)

    for record in records:
        enriquecer_gerador(record, membros)
    return records
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && venv/Scripts/python -m pytest test_upload.py -k enriquecer_candidatos_externos -v`
Expected: PASS (4 testes)

- [ ] **Step 5: Rodar a suíte inteira do backend pra garantir zero regressão**

Run: `cd backend && venv/Scripts/python -m pytest test_upload.py test_verificar_source.py -v`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/test_upload.py
git commit -m "feat(verificar): enriquece duplicatas externas via Carteira de Notas"
```

---

### Task 2: Backend — `consultar()` devolve poste/referência

**Files:**
- Modify: `backend/coffee_module/routes.py`
- Test: `backend/test_coffee_module.py`

**Interfaces:**
- Consumes: `client.buscar_nota(id) -> dict` (campo `fields`, já existe).
- Produces: resposta JSON de `GET /api/coffee/consultar/{id}` ganha `poste: str | None` e `referencia: str | None`. Consumida pelo Task 3 (tipo `CoffeeConsulta`) e pelo Task 5 (frontend).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `backend/test_coffee_module.py`, logo depois de `test_rota_consultar_retorna_campos` (perto da linha 613):

```python
def test_rota_consultar_retorna_poste_e_referencia(coffee_cliente, monkeypatch):
    from coffee_module import client
    monkeypatch.setattr(
        client, "buscar_nota",
        lambda i: {"pk": int(i), "id_sap": 17247854, "arquivado": False,
                   "local_instalacao": "718ET00026773",
                   "fields": {"id_sap": 17247854, "postes": "TR-088",
                              "referencia_fisica": "SER-11"}},
    )
    r = coffee_cliente.get("/api/coffee/consultar/355617")
    assert r.status_code == 200
    body = r.json()
    assert body["poste"] == "TR-088"
    assert body["referencia"] == "SER-11"


def test_rota_consultar_poste_referencia_ausentes_vira_none(coffee_cliente, monkeypatch):
    from coffee_module import client
    monkeypatch.setattr(
        client, "buscar_nota",
        lambda i: {"pk": int(i), "id_sap": 17247854, "arquivado": False,
                   "local_instalacao": None, "fields": {"id_sap": 17247854}},
    )
    r = coffee_cliente.get("/api/coffee/consultar/355617")
    body = r.json()
    assert body["poste"] is None
    assert body["referencia"] is None
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `cd backend && venv/Scripts/python -m pytest test_coffee_module.py -k "poste_e_referencia or poste_referencia_ausentes" -v`
Expected: FAIL — `KeyError: 'poste'`

- [ ] **Step 3: Implementar em `backend/coffee_module/routes.py`**

Localizar o corpo de `consultar()` (perto da linha 164):

```python
    db.registrar_log("acao_usuario", "consultar", nota["pk"], {"id": id}, True)
    return {
        "pk": nota["pk"],
        "id_sap": nota["id_sap"],
        "local_instalacao": nota["local_instalacao"],
        "classificacao": classe,
        "arquivado": nota["arquivado"],
    }
```

Substituir por:

```python
    fields = nota["fields"]
    db.registrar_log("acao_usuario", "consultar", nota["pk"], {"id": id}, True)
    return {
        "pk": nota["pk"],
        "id_sap": nota["id_sap"],
        "local_instalacao": nota["local_instalacao"],
        "classificacao": classe,
        "arquivado": nota["arquivado"],
        "poste": fields.get("postes") or fields.get("poste"),
        "referencia": fields.get("referencia_fisica") or fields.get("referencia_eletrica"),
    }
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `cd backend && venv/Scripts/python -m pytest test_coffee_module.py -v`
Expected: PASS (suíte inteira do módulo, sem regressão nos testes de `consultar` já existentes)

- [ ] **Step 5: Commit**

```bash
git add backend/coffee_module/routes.py backend/test_coffee_module.py
git commit -m "feat(coffee): consultar devolve poste e referencia da API COFFEE"
```

---

### Task 3: Frontend — tipos

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/features/coffee/types.ts`

**Interfaces:**
- Consumes: nada (só tipos).
- Produces: `DuplicateCandidate` com os campos novos opcionais; `CoffeeConsulta` com `poste`/`referencia`. Consumidos pelo Task 5.

- [ ] **Step 1: `frontend/src/types.ts`**

Localizar (perto da linha 80):

```typescript
export interface DuplicateCandidate extends ComparableFields {
  id: string;
  in_sheet: boolean;
  match: DuplicateField[];
  latitude: string | null;
  longitude: string | null;
}
```

Substituir por:

```typescript
export interface DuplicateCandidate extends ComparableFields {
  id: string;
  in_sheet: boolean;
  match: DuplicateField[];
  latitude: string | null;
  longitude: string | null;
  /** Presente só para candidatas externas (in_sheet=false): achou linha na Carteira? */
  carteira_match?: boolean;
  status_sap?: string | null;
  prioridade_sap?: number | null;
  conjunto?: string | null;
  /** Data em que a nota saiu da última sincronização da Carteira (tombstone), se aplicável. */
  carteira_ausente_em?: string | null;
}
```

- [ ] **Step 2: `frontend/src/features/coffee/types.ts`**

Localizar (perto da linha 75):

```typescript
export interface CoffeeConsulta {
  pk: number;
  id_sap: number | null;
  local_instalacao: string | null;
  classificacao: string;
  arquivado: boolean | null;
}
```

Substituir por:

```typescript
export interface CoffeeConsulta {
  pk: number;
  id_sap: number | null;
  local_instalacao: string | null;
  classificacao: string;
  arquivado: boolean | null;
  poste: string | null;
  referencia: string | null;
}
```

- [ ] **Step 3: Checar tipos**

Run: `cd frontend && npx tsc -b`
Expected: sem erros novos (os campos são opcionais/aditivos, nenhum consumidor existente quebra).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/features/coffee/types.ts
git commit -m "feat(verificar): tipos pros campos da Carteira em DuplicateCandidate"
```

---

### Task 4: Frontend — expor `CompareRow`/`dupcEq` pro componente novo

**Files:**
- Modify: `frontend/src/features/verificar/duplicate-compare.tsx`

**Interfaces:**
- Consumes: nada novo.
- Produces: `export function CompareRow(...)`, `export const dupcEq`, `export const dupcNorm` — consumidos pelo Task 5 (`duplicate-compare-externa.tsx`).

Esse task é um refactor puro (sem mudança de comportamento) pra evitar duplicar a lógica de comparação — `CompareRow` hoje é uma função aninhada dentro do componente, mas não usa nenhuma variável do escopo pai (só as próprias props), então hoisting pra module scope é seguro.

- [ ] **Step 1: Rodar os testes existentes antes de mexer, pra ter uma baseline**

Run: `cd frontend && npx vitest run dashboard.test.tsx`
Expected: PASS (nenhum teste cobre `duplicate-compare.tsx` diretamente ainda — é só baseline de que nada mais quebrou no projeto)

- [ ] **Step 2: Hoistar `CompareRow` e exportar `dupcEq`/`dupcNorm`**

Localizar (linhas 48-72):

```tsx
const dupcNorm = (s: string): string => String(s ?? "").trim().toLowerCase();
const dupcEq = (a: string, b: string): boolean => dupcNorm(a) !== "" && dupcNorm(a) === dupcNorm(b);

export const DuplicateCompare: React.FC<DuplicateCompareProps> = ({ note, resolved, onMarkDuplicate, onSendToCoffee }) => {
  const cands = note.duplicates;
  if (!cands.length) return null;
  const api = EDPApi;
  const allIds = cands.map((c) => c.id);

  function CompareRow({ label, open, cand, keyField }: {
    label: string; open: string; cand: string; keyField: boolean;
  }): React.JSX.Element {
    const same = keyField ? dupcEq(open, cand) : false;
    const cls = keyField ? (same ? " same" : " diff") : "";
    return (
      <React.Fragment>
        <div className="dupc-lbl">{label}</div>
        <div className="dupc-val">{open || "—"}</div>
        <div className={"dupc-val" + cls}>
          {keyField && <span className={"dupc-mk" + (same ? " same" : " diff")}>{same ? "✓" : "≠"}</span>}
          {cand || "—"}
        </div>
      </React.Fragment>
    );
  }
```

Substituir por:

```tsx
export const dupcNorm = (s: string): string => String(s ?? "").trim().toLowerCase();
export const dupcEq = (a: string, b: string): boolean => dupcNorm(a) !== "" && dupcNorm(a) === dupcNorm(b);

export function CompareRow({ label, open, cand, keyField }: {
  label: string; open: string; cand: string; keyField: boolean;
}): React.JSX.Element {
  const same = keyField ? dupcEq(open, cand) : false;
  const cls = keyField ? (same ? " same" : " diff") : "";
  return (
    <React.Fragment>
      <div className="dupc-lbl">{label}</div>
      <div className="dupc-val">{open || "—"}</div>
      <div className={"dupc-val" + cls}>
        {keyField && <span className={"dupc-mk" + (same ? " same" : " diff")}>{same ? "✓" : "≠"}</span>}
        {cand || "—"}
      </div>
    </React.Fragment>
  );
}

export const DuplicateCompare: React.FC<DuplicateCompareProps> = ({ note, resolved, onMarkDuplicate, onSendToCoffee }) => {
  const cands = note.duplicates;
  if (!cands.length) return null;
  const api = EDPApi;
  const allIds = cands.map((c) => c.id);
```

O resto do componente (o `.map((c) => { ... })` mais abaixo, que já chama `<CompareRow .../>` pro grid in-sheet) fica igual — só a definição migrou de posição, as chamadas continuam funcionando porque `CompareRow` agora é uma closure de módulo em vez de closure de componente.

Adicionar ao final da string `DUPC_STYLE` (perto da linha 31), antes do fechamento da template string:

```css
  .dupc-warn{display:flex;align-items:center;gap:8px;padding:8px 14px;
    background:var(--tint-amber);border-bottom:1px solid rgba(240,169,59,.25);
    font-size:12px;color:var(--text-dim)}
```

- [ ] **Step 3: Checar tipos e build**

Run: `cd frontend && npx tsc -b`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/verificar/duplicate-compare.tsx
git commit -m "refactor(verificar): expoe CompareRow/dupcEq pro card de candidata externa"
```

---

### Task 5: Frontend — `ExternalCandidateCard` (Carteira match / sem match + busca ao vivo)

**Files:**
- Create: `frontend/src/features/verificar/duplicate-compare-externa.tsx`
- Test: `frontend/src/features/verificar/duplicate-compare-externa.test.tsx`
- Modify: `frontend/src/features/verificar/duplicate-compare.tsx`

**Interfaces:**
- Consumes: `CompareRow`, `dupcEq` (Task 4); `DuplicateCandidate`, `Note`, `DuplicateField` (`../../types`); `CoffeeConsulta` (`../coffee/types`, Task 3); `EDPApi.consultarNota` (`../../api`, já existe).
- Produces: `export function mergeConsultaCampos(candidate: DuplicateCandidate, consulta: CamposBuscados): DuplicateCandidate` (pura, testada sem DOM); `export function ExternalCandidateCard({ note, candidate }: { note: Note; candidate: DuplicateCandidate }): React.JSX.Element`. Consumida por `duplicate-compare.tsx` no branch externo.

- [ ] **Step 1: Escrever o teste que falha**

Criar `frontend/src/features/verificar/duplicate-compare-externa.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

import type { DuplicateCandidate, Note } from '../../types';
import { ExternalCandidateCard, mergeConsultaCampos } from './duplicate-compare-externa';

function nota(overrides: Partial<Note>): Note {
  return {
    id: '100',
    local_instalacao: 'ABC-10', poste: 'P1', referencia: 'REF-1', problema: 'chave · queda',
    tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
    latitude: null, longitude: null, colaborador: null,
    imagens_totais: null, imagens_recebidas: null,
    errors: [], status: 'erro', duplicates: [],
    raw: {
      id: '100', tipo_nota: 'Poda', referencia_fisica: 'REF-1', prioridade: 3,
      setor: 'Centro', uf: 'ES', local_instalacao: 'ABC-10', alimentador: '', colaborador: '',
      executor: '', imagens_totais: 0, imagens_recebidas: 0, latitude: '', longitude: '',
      id_sap: '', descricao: '', poste: 'P1',
    },
    ...overrides,
  };
}

function candidataMatch(overrides: Partial<DuplicateCandidate>): DuplicateCandidate {
  return {
    id: '171153', in_sheet: false, match: [], latitude: null, longitude: null,
    local_instalacao: '718ET00026773', poste: '', referencia: '', problema: 'chave · queda',
    tipo_nota: '', setor: '', uf: '', prioridade: 0,
    carteira_match: true, status_sap: 'Pendente', prioridade_sap: 3,
    conjunto: 'POSTE DEMANDA', carteira_ausente_em: null,
    ...overrides,
  };
}

function renderCard(note: Note, candidate: DuplicateCandidate): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ExternalCandidateCard note={note} candidate={candidate} />
    </QueryClientProvider>,
  );
}

describe('mergeConsultaCampos', () => {
  it('preenche poste/referencia buscados, sem mexer no resto da candidata', () => {
    const candidate = candidataMatch({ poste: '', referencia: '' });
    const resultado = mergeConsultaCampos(candidate, { poste: 'TR-088', referencia: 'SER-11' });
    expect(resultado.poste).toBe('TR-088');
    expect(resultado.referencia).toBe('SER-11');
    expect(resultado.local_instalacao).toBe('718ET00026773');
  });

  it('campos nulos da busca caem pro que já existia na candidata', () => {
    const candidate = candidataMatch({ poste: 'ja-tinha', referencia: '' });
    const resultado = mergeConsultaCampos(candidate, { poste: null, referencia: null });
    expect(resultado.poste).toBe('ja-tinha');
    expect(resultado.referencia).toBe('');
  });
});

describe('ExternalCandidateCard', () => {
  it('com match na Carteira, mostra grid de 2 campos-chave e contexto SAP', () => {
    const html = renderCard(nota({}), candidataMatch({}));
    expect(html).toContain('718ET00026773');
    expect(html).toContain('Pendente');
    expect(html).toContain('POSTE DEMANDA');
    expect(html).toContain('2/2 campos-chave');
    expect(html).toContain('Buscar poste/referência no COFFEE');
  });

  it('tombstoned mostra aviso de ausencia mas ainda mostra os dados', () => {
    const html = renderCard(nota({}), candidataMatch({ carteira_ausente_em: '2026-07-01T00:00:00' }));
    expect(html).toContain('Ausente da Carteira desde');
    expect(html).toContain('718ET00026773');
  });

  it('sem match na Carteira, mostra estado dedicado sem grid', () => {
    const html = renderCard(nota({}), candidataMatch({ carteira_match: false }));
    expect(html).toContain('Não encontrada na Carteira de Notas');
    expect(html).not.toContain('campos-chave');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd frontend && npx vitest run duplicate-compare-externa.test.tsx`
Expected: FAIL — `Failed to resolve import "./duplicate-compare-externa"`

- [ ] **Step 3: Criar `frontend/src/features/verificar/duplicate-compare-externa.tsx`**

```tsx
import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { DuplicateCandidate, DuplicateField, Note } from '../../types';
import { EDPApi } from '../../api';
import { Button } from '@/components/ui/button';
import { CompareRow, dupcEq } from './duplicate-compare';

interface KeyFieldDef { key: DuplicateField; label: string; }
interface CtxFieldDef { label: string; get: (c: DuplicateCandidate) => string; }

const CHAVE_BASE: KeyFieldDef[] = [
  { key: 'local_instalacao', label: 'Local instal.' },
  { key: 'problema', label: 'Problema' },
];
const CHAVE_EXTRA: KeyFieldDef[] = [
  { key: 'poste', label: 'Poste(s)' },
  { key: 'referencia', label: 'Referência' },
];
const CONTEXTO: CtxFieldDef[] = [
  { label: 'Status SAP', get: (c) => c.status_sap ?? '' },
  { label: 'Prioridade SAP', get: (c) => (c.prioridade_sap != null ? String(c.prioridade_sap) : '') },
  { label: 'Conjunto', get: (c) => c.conjunto ?? '' },
];

export interface CamposBuscados {
  poste: string | null;
  referencia: string | null;
}

/** Funde poste/referência buscados ao vivo no COFFEE na candidata da Carteira. Pura — sem I/O. */
export function mergeConsultaCampos(
  candidate: DuplicateCandidate,
  consulta: CamposBuscados,
): DuplicateCandidate {
  return {
    ...candidate,
    poste: consulta.poste ?? candidate.poste ?? '',
    referencia: consulta.referencia ?? candidate.referencia ?? '',
  };
}

interface ExternalCandidateCardProps {
  note: Note;
  candidate: DuplicateCandidate;
}

export function ExternalCandidateCard({ note, candidate }: ExternalCandidateCardProps): React.JSX.Element {
  const [buscados, setBuscados] = React.useState<CamposBuscados | null>(null);
  const buscar = useMutation({
    mutationFn: () => EDPApi.consultarNota(Number(candidate.id)),
    onSuccess: (resposta) => {
      setBuscados({ poste: resposta.poste, referencia: resposta.referencia });
    },
    onError: (error: unknown) => {
      toast.error(`Não foi possível consultar a nota ${candidate.id} no COFFEE`, {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const display = buscados ? mergeConsultaCampos(candidate, buscados) : candidate;
  const chave = buscados ? [...CHAVE_BASE, ...CHAVE_EXTRA] : CHAVE_BASE;

  const botaoBuscar = (
    <Button
      variant="outline" size="sm"
      disabled={buscar.isPending}
      onClick={() => buscar.mutate()}
    >
      ⌕ {buscar.isPending ? 'Buscando…' : 'Buscar poste/referência no COFFEE'}
    </Button>
  );

  if (!candidate.carteira_match) {
    return (
      <div className="py-[14px] px-[16px]">
        <div className="dupc-ext">
          <span className="text-[16px] shrink-0 leading-none">⧉</span>
          <div>
            <strong className="text-text">Não encontrada na Carteira de Notas</strong><br />
            Essa candidata não está no espelho local da base COFFEE — pode não ter sido
            sincronizada ainda. {buscados ? 'Dados abaixo vieram direto do COFFEE.' : 'Busque direto no COFFEE para conferir.'}
          </div>
        </div>
        <div className="mt-[10px]">{botaoBuscar}</div>
        {buscados && (
          <div className="dupc-grid mt-[10px]">
            <div className="dupc-colh" />
            <div className="dupc-colh">Esta nota · {note.id}</div>
            <div className="dupc-colh">Candidata · {candidate.id}</div>
            {CHAVE_EXTRA.map((f) => (
              <CompareRow key={f.key} label={f.label} open={note[f.key]} cand={display[f.key]} keyField={true} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const matches = chave.filter((f) => dupcEq(note[f.key], display[f.key])).length;
  const strong = matches === chave.length;

  return (
    <React.Fragment>
      {candidate.carteira_ausente_em && (
        <div className="dupc-warn">
          ⚠ Ausente da Carteira desde {candidate.carteira_ausente_em} — dados podem estar desatualizados.
        </div>
      )}
      <div className="flex items-center justify-end gap-[8px] px-[14px] py-[8px] border-b border-line">
        <span className="dupc-badge" style={{
          color: strong ? "var(--green)" : "var(--amber)",
          background: strong ? "var(--tint-green)" : "var(--tint-amber)",
          border: "1px solid " + (strong ? "rgba(0,168,89,.3)" : "rgba(240,169,59,.3)"),
        }}>
          {strong ? "●" : "◐"} {matches}/{chave.length} campos-chave · Carteira
        </span>
      </div>
      <div className="dupc-grid">
        <div className="dupc-colh" />
        <div className="dupc-colh">Esta nota · {note.id}</div>
        <div className="dupc-colh">Candidata · {candidate.id}</div>
        {chave.map((f) => (
          <CompareRow key={f.key} label={f.label} open={note[f.key]} cand={display[f.key]} keyField={true} />
        ))}
        {CONTEXTO.map((f) => (
          <CompareRow key={f.label} label={f.label} open="" cand={f.get(display)} keyField={false} />
        ))}
      </div>
      {!buscados && <div className="px-[14px] py-[10px]">{botaoBuscar}</div>}
    </React.Fragment>
  );
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd frontend && npx vitest run duplicate-compare-externa.test.tsx`
Expected: PASS (5 testes)

- [ ] **Step 5: Ligar o componente novo em `duplicate-compare.tsx`**

Adicionar o import no topo (perto da linha 6, depois do import de `Coffee` do lucide-react):

```tsx
import { ExternalCandidateCard } from './duplicate-compare-externa';
```

Localizar o branch externo (perto da linha 152-163):

```tsx
            ) : (
              <div className="py-[14px] px-[16px]">
                <div className="dupc-ext">
                  <span className="text-[16px] shrink-0 leading-none">⧉</span>
                  <div>
                    <strong className="text-text">Nota fora desta planilha</strong><br />
                    Verifique os campos direto no COFFEE. A comparação automática ficará disponível
                    após a integração com o BI.
                  </div>
                </div>
              </div>
            )}
```

Substituir por:

```tsx
            ) : (
              <ExternalCandidateCard note={note} candidate={c} />
            )}
```

- [ ] **Step 6: Checar tipos e rodar toda a suíte de frontend**

Run: `cd frontend && npx tsc -b && npx vitest run`
Expected: sem erros de tipo, todos os testes passam (incluindo `dashboard.test.tsx`, `coffee-nota-inspector.test.tsx`, e os 2 arquivos deste plano).

- [ ] **Step 7: Build de produção**

Run: `cd frontend && npm run build`
Expected: build conclui sem erros.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/features/verificar/duplicate-compare-externa.tsx \
        frontend/src/features/verificar/duplicate-compare-externa.test.tsx \
        frontend/src/features/verificar/duplicate-compare.tsx
git commit -m "feat(verificar): card de duplicata externa com dados da Carteira + busca COFFEE sob demanda"
```

---

### Task 6: Documentação

**Files:**
- Modify: `docs/dev/01-frontend-verificar.md`
- Modify: `docs/dev/10-backend-carteira-module.md`

**Interfaces:**
- Consumes: nada (só prosa).
- Produces: nada consumido por outro task — é o último.

- [ ] **Step 1: `docs/dev/01-frontend-verificar.md`**

Adicionar uma seção nova depois de "## Fluxo COFFEE" (antes de "## Interface"):

```markdown
## Duplicatas externas × Carteira de Notas

Candidatas de `chk_duplicada` fora da planilha Verificar (`in_sheet: false`,
maioria dos casos reais) são cruzadas em lote com a Carteira de Notas
(`carteira_module`, espelho local da base COFFEE/Databricks) por `id_onr` —
mesmo espaço de ID das duplicatas. O cruzamento roda uma única query `IN`
por request de `/api/data` (`main.py: enriquecer_candidatos_externos`),
nunca uma chamada por candidata.

Candidata com linha na Carteira ganha comparação real de Local de instalação
e Problema (`sintoma` + `componente_novo`), além de contexto (Status SAP,
Prioridade SAP, Conjunto). A Carteira não tem Poste/Referência — um botão por
card busca esses 2 campos ao vivo na API COFFEE (`GET
/api/coffee/consultar/{id}`), sob demanda, nunca em lote (evita travar o
carregamento da tela com N chamadas de até 120s). Candidata sem linha na
Carteira mostra um estado dedicado ("não encontrada na Carteira") com o mesmo
botão de busca ao vivo em destaque.
```

- [ ] **Step 2: `docs/dev/10-backend-carteira-module.md`**

Adicionar ao final da seção "## Lookup SAP interno (Fase 4B)" (antes de "## Movimentação (Fase 2)"):

```markdown
### Consumidor: duplicatas externas do Verificar

`backend/main.py: enriquecer_candidatos_externos()` usa `repository.obter_muitos`
(não `obter_por_id_sap`) pra cruzar candidatas duplicatas externas do Verificar
com `nota_carteira` por `id_onr` — o ID das duplicatas do Verificar é o mesmo
`id_onr` da Carteira, não o `id_sap`. Diferente do enriquecimento por SAP
(Fase 4B), aqui não há filtro `PII`: o consumidor é interno (mesma equipe que
já vê `local_instalacao`/coordenadas na planilha Verificar), então a projeção
inclui `local_instalacao`/`latitude`/`longitude`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/dev/01-frontend-verificar.md docs/dev/10-backend-carteira-module.md
git commit -m "docs(verificar): documenta cruzamento de duplicatas externas com a Carteira"
```

---

## Self-Review Notes

- **Spec coverage:** Objetivo 1 (match → grid + contexto) → Tasks 1, 5. Objetivo 2 (sem match → estado dedicado) → Task 5. Objetivo 3 (poste/referência sob demanda, nunca em lote) → Tasks 2, 5. Seção "Erros e estados de borda" do spec (lote vazio, ID não numérico, falha de `consultarNota`) → cobertos nos testes de Task 1 (`lote_vazio_no_op`) e no `onError` do Task 5.
- **Placeholder scan:** nenhum "TBD"/"implementar depois" — todo step tem código completo.
- **Type consistency:** `DuplicateCandidate` (Task 3) → usado em `mergeConsultaCampos`/`ExternalCandidateCard` (Task 5) com os mesmos nomes de campo (`carteira_match`, `status_sap`, `prioridade_sap`, `conjunto`, `carteira_ausente_em`) definidos no Task 3. `CoffeeConsulta.poste`/`.referencia` (Task 3) → usados em `EDPApi.consultarNota` (Task 5) e devolvidos por `consultar()` (Task 2) com os mesmos nomes. `CompareRow`/`dupcEq` exportados no Task 4 com as mesmas assinaturas usadas no Task 5.
