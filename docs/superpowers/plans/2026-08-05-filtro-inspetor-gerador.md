# Filtro por inspetor(es) e exibição do gerador na fila — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o filtro "Gerada por" da triagem Verificar isolar um ou mais inspetores de ES/SP específicos (hoje é só um alternador Todas/Inspetores), mostrar sempre na fila quem gerou cada nota (hoje só aparece com o filtro de inspetor ativo), e distinguir quando a matrícula do gerador não tem registro no De-Para.

**Architecture:** Backend acrescenta um campo `cadastrado: bool` ao dict `gerador` já anexado a toda nota (`main.py`). Frontend troca o estado do filtro de uma string binária para um array de matrículas selecionadas, persistido via `usePersistedState` (que usa `sessionStorage`), com as opções do multi-select derivadas das notas do lote atual — mesmo padrão já usado para `ufOpts`/`setorOpts`. A linha "Gerada por" na fila e no painel de detalhe passam a aparecer sempre que a nota tiver `gerador`, com um sufixo condicional quando `cadastrado` for `false`.

**Tech Stack:** FastAPI + pandas (backend), React 18 + TypeScript + Radix `ToggleGroup` (frontend), pytest (backend tests), vitest (frontend tests).

## Global Constraints

- Nunca usar `any` em TypeScript — tipos explícitos ou `unknown` (CLAUDE.md).
- Sem novas dependências: `ToggleGroup type="multiple"` já é suportado pelo primitive Radix existente (`components/ui/toggle-group.tsx`), sem precisar de popover/checkbox novos.
- `usePersistedState` grava em `sessionStorage`, não `localStorage` — confirmado em `frontend/src/hooks/use-persisted-state.ts:1-24`.
- Toda mudança de comportamento documentada precisa atualizar `docs/dev/01-frontend-verificar.md` no mesmo PR (regra do CLAUDE.md raiz do projeto).
- Backend nunca expõe senha ou outros campos do De-Para além de `matricula`, `nome`, `uf`, `inspetor` (e agora `cadastrado`) — não adicionar mais colunas ao dict `gerador`.

---

### Task 1: Backend — flag `cadastrado` no gerador

**Files:**
- Modify: `backend/main.py:130-158` (`carregar_membros`, `enriquecer_gerador`)
- Modify: `backend/test_upload.py:100-128` (`test_upload_enriquece_gerador_com_de_para`)
- Test: `backend/test_upload.py` (novo teste de matrícula não cadastrada)

**Interfaces:**
- Consumes: nada de tasks anteriores (primeira task).
- Produces: dict `gerador` (tanto em `RECORDS` quanto no JSON de `/api/data`) com a chave adicional `cadastrado: bool` — `true` quando a matrícula existe no De-Para, `false` no fallback. Tasks 2 e 3 (frontend) consomem esse campo via `NoteGenerator.cadastrado`.

- [ ] **Step 1: Atualizar o teste existente pra esperar `cadastrado: True`**

Em `backend/test_upload.py`, dentro de `test_upload_enriquece_gerador_com_de_para`, trocar o assert final:

```python
    gerador = cliente.get("/api/data").json()["records"][0]["gerador"]
    assert gerador == {
        "matricula": "204565", "nome": "Fabricio Dias", "uf": "ES", "inspetor": True,
        "cadastrado": True,
    }
```

- [ ] **Step 2: Adicionar teste para matrícula sem registro no De-Para**

Adicionar logo depois de `test_upload_enriquece_gerador_com_de_para` (antes de `test_upload_nao_devolve_colunas_extras_em_raw`), em `backend/test_upload.py`:

```python
def test_upload_gerador_sem_registro_no_de_para(tmp_path, monkeypatch):
    """Matrícula da nota sem linha correspondente no De-Para vira gerador não cadastrado."""
    import io
    import pandas as pd
    from fastapi.testclient import TestClient
    import main

    de_para = tmp_path / "membros.xlsx"
    pd.DataFrame([{
        "Matrícula": 204565, "Nome": "Fabricio", "Sobrenome": "Dias",
        "Uf": "ES", "Permissoes": "colaborador, inspetor_planejamento",
    }]).to_excel(de_para, sheet_name="Colaboradores", index=False)
    monkeypatch.setenv("DE_PARA_MEMBROS_PATH", str(de_para))

    planilha = io.BytesIO()
    pd.DataFrame([{
        "id": 100728802, "prioridade": 1, "tipo_nota": "Poda",
        "referencia_fisica": "SER-12", "uf": "ES", "setor": "Centro",
        "colaborador": 999999, "chk_coordenada": "ok",
    }]).to_excel(planilha, index=False)

    cliente = TestClient(main.app)
    resposta = cliente.post("/api/upload", files={"file": ("p.xlsx", planilha.getvalue())})
    assert resposta.status_code == 200

    gerador = cliente.get("/api/data").json()["records"][0]["gerador"]
    assert gerador == {
        "matricula": "999999", "nome": "999999", "uf": "", "inspetor": False,
        "cadastrado": False,
    }
```

- [ ] **Step 3: Rodar os testes e confirmar que falham (campo `cadastrado` ainda não existe)**

Run: `cd backend && python -m pytest test_upload.py -k gerador -v`
Expected: FAIL — `AssertionError` nos dois testes (dict devolvido não tem a chave `cadastrado`).

- [ ] **Step 4: Implementar o campo `cadastrado`**

Em `backend/main.py`, dentro de `carregar_membros()` (por volta da linha 141), acrescentar a chave no dict de cada colaborador encontrado:

```python
        resultado[matricula] = {
            "matricula": matricula,
            "nome": nome or matricula,
            "uf": uf,
            "inspetor": uf in {"ES", "SP"} and "inspetor_planejamento" in permissoes,
            "cadastrado": True,
        }
```

E em `enriquecer_gerador()` (por volta da linha 150-158), no fallback:

```python
def enriquecer_gerador(registro: dict, membros: dict[str, dict[str, object]]) -> None:
    """Acrescenta o gerador identificado pelo campo colaborador da nota."""
    matricula = normalizar_matricula(registro.get("raw", {}).get("colaborador"))
    registro["gerador"] = membros.get(matricula, {
        "matricula": matricula,
        "nome": matricula or "Não informado",
        "uf": "",
        "inspetor": False,
        "cadastrado": False,
    })
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `cd backend && python -m pytest test_upload.py -v`
Expected: PASS — todos os testes de `test_upload.py`, incluindo os dois de gerador.

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/test_upload.py
git commit -m "feat(verificar): marca gerador sem registro no De-Para como não cadastrado"
```

---

### Task 2: Frontend — filtro multi-select de inspetores

**Files:**
- Modify: `frontend/src/types.ts:88-93` (`NoteGenerator`)
- Modify: `frontend/src/features/verificar/dashboard.tsx` (estado, derivação de opções, UI do filtro, lógica de `matches`, chips, `clearAll`)
- Test: `frontend/src/features/verificar/dashboard.test.tsx` (novo arquivo)

**Interfaces:**
- Consumes: `NoteGenerator.cadastrado` produzido na Task 1 (via `raw`/`gerador` do backend — o teste desta task não depende do backend rodando, monta `Note[]` fixture direto).
- Produces: `NoteGenerator` com `cadastrado: boolean` (tipo TS); estado `geradorInspetores: string[]` e setter `setGeradorInspetores` dentro de `Dashboard` — consumidos só internamente, não vazam pra outros componentes. Task 3 reaproveita o mesmo `n.gerador`/`sel.gerador` já tipado.

- [ ] **Step 1: Adicionar `cadastrado` ao tipo `NoteGenerator`**

Em `frontend/src/types.ts:88-93`:

```ts
export interface NoteGenerator {
  matricula: string;
  nome: string;
  uf: string;
  inspetor: boolean;
  cadastrado: boolean;
}
```

- [ ] **Step 2: Escrever o teste do filtro (vai falhar — o multi-select ainda não existe)**

Criar `frontend/src/features/verificar/dashboard.test.tsx`:

```tsx
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { Note } from '../../types';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
  });
});

import { Dashboard } from './dashboard';

function nota(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? '1',
    local_instalacao: 'ABC-10', poste: 'P1', referencia: 'REF-1', problema: 'Problema',
    tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
    latitude: null, longitude: null, colaborador: null,
    imagens_totais: null, imagens_recebidas: null,
    errors: [], status: 'ok', duplicates: [],
    raw: {
      id: overrides.id ?? '1', tipo_nota: 'Poda', referencia_fisica: 'REF-1', prioridade: 3,
      setor: 'Centro', uf: 'ES', local_instalacao: 'ABC-10', alimentador: '', colaborador: '',
      executor: '', imagens_totais: 0, imagens_recebidas: 0, latitude: '', longitude: '',
      id_sap: '', descricao: '', poste: 'P1',
    },
    ...overrides,
  };
}

const notes: Note[] = [
  nota({
    id: '100', gerador: { matricula: '204565', nome: 'Fabricio Dias', uf: 'ES', inspetor: true, cadastrado: true },
  }),
  nota({
    id: '200', gerador: { matricula: '111', nome: 'Outro Inspetor', uf: 'SP', inspetor: true, cadastrado: true },
  }),
  nota({
    id: '300', gerador: { matricula: '999999', nome: '999999', uf: '', inspetor: false, cadastrado: false },
  }),
];

const noop = (): void => {};

describe('Dashboard — filtro por inspetor', () => {
  it('sem seleção, mostra notas de todos os geradores', () => {
    const html = renderToStaticMarkup(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('100');
    expect(html).toContain('200');
    expect(html).toContain('300');
  });

  it('com inspetor selecionado (via sessionStorage persistido), mostra só notas daquele inspetor', () => {
    sessionStorage.setItem('edp_verify_gerador_insp', JSON.stringify(['204565']));
    const html = renderToStaticMarkup(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('100');
    expect(html).not.toContain('200');
    expect(html).not.toContain('300');
  });

  it('lista as opções de inspetor derivadas do lote, uma por matrícula distinta', () => {
    const html = renderToStaticMarkup(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('aria-label="Filtrar por inspetor de planejamento ES/SP"');
    expect(html).toContain('Fabricio Dias');
    expect(html).toContain('Outro Inspetor');
  });
});
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `cd frontend && npx vitest run src/features/verificar/dashboard.test.tsx`
Expected: FAIL — o segundo teste falha porque `edp_verify_gerador_insp` ainda não é lido (o filtro atual usa a chave `edp_verify_gerador` com valores `"all"/"inspectors"`), então a nota `200`/`300` continuam aparecendo mesmo com a seleção setada.

- [ ] **Step 4: Trocar o estado do filtro por um array de matrículas**

Em `frontend/src/features/verificar/dashboard.tsx`, importar o tipo do gerador no topo (linha 2):

```ts
import type { Note, NoteGenerator, UrgBand, RuleKey } from '../../types';
```

Trocar a linha do estado (linha 38):

```ts
  const [geradorInspetores, setGeradorInspetores] = usePersistedState<string[]>("edp_verify_gerador_insp", []);
```

- [ ] **Step 5: Derivar as opções de inspetor do lote atual**

Logo depois de `setorOpts` (linha 54), acrescentar:

```ts
  const inspetorOpts = React.useMemo(() => {
    const porMatricula = new Map<string, NoteGenerator>();
    notes.forEach((n) => { if (n.gerador?.inspetor) porMatricula.set(n.gerador.matricula, n.gerador); });
    return [...porMatricula.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [notes]);
```

- [ ] **Step 6: Atualizar a lógica de filtro em `matches`**

Trocar a linha 66:

```ts
    if (geradorInspetores.length && !geradorInspetores.includes(n.gerador?.matricula ?? "")) return false;
```

E a dependência do `useEffect` de reposicionamento de `selId` (linha 81) — trocar `gerador` por `geradorInspetores` no array de deps (o array continua só documentativo, o lint já está suprimido, mas precisa existir a variável certa):

```ts
  }, [q, uf, geradorInspetores, setor, urg, status, situacao, rules]); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 7: Atualizar chips e `clearAll`**

Trocar a linha do chip único (linha 95):

```ts
  geradorInspetores.forEach((matricula) => {
    const nome = inspetorOpts.find((i) => i.matricula === matricula)?.nome ?? matricula;
    chips.push({ k: "Gerada por: " + nome, clear: () => setGeradorInspetores(geradorInspetores.filter((m) => m !== matricula)) });
  });
```

E em `clearAll` (linha 101), trocar `setGerador("all")` por `setGeradorInspetores([])`.

- [ ] **Step 8: Trocar o `ToggleGroup` do filtro por multi-select**

Trocar o bloco `<Field label="Gerada por" accent>...</Field>` (linhas 155-162):

```tsx
          {inspetorOpts.length > 0 && (
            <Field label="Gerada por" accent>
              <ToggleGroup type="multiple" variant="outline" size="sm" value={geradorInspetores}
                           onValueChange={setGeradorInspetores}
                           aria-label="Filtrar por inspetor de planejamento ES/SP">
                {inspetorOpts.map((i) => (
                  <ToggleGroupItem key={i.matricula} value={i.matricula}>
                    <UserRound /> {i.nome} ({i.uf})
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
          )}
```

- [ ] **Step 9: Rodar o teste e confirmar que passa**

Run: `cd frontend && npx vitest run src/features/verificar/dashboard.test.tsx`
Expected: PASS — os três testes.

- [ ] **Step 10: Rodar a suíte completa do frontend pra checar regressão**

Run: `cd frontend && npm test`
Expected: PASS — nenhum teste existente quebrado.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/types.ts frontend/src/features/verificar/dashboard.tsx frontend/src/features/verificar/dashboard.test.tsx
git commit -m "feat(verificar): filtro multi-select por inspetor de ES/SP"
```

---

### Task 3: Frontend — gerador sempre visível na fila e rótulo de matrícula não cadastrada

**Files:**
- Modify: `frontend/src/features/verificar/dashboard.tsx` (linha da fila, campos do `Detail`)
- Test: `frontend/src/features/verificar/dashboard.test.tsx` (adicionar casos)

**Interfaces:**
- Consumes: `Dashboard` (Task 2), `NoteGenerator.cadastrado` (Task 1/2), fixtures `nota()`/`notes` já definidas no arquivo de teste da Task 2.
- Produces: nada consumido por outra task — última mudança de comportamento antes da doc.

- [ ] **Step 1: Adicionar os casos de teste (vão falhar — linha da fila ainda é condicional ao filtro)**

Acrescentar ao final do `describe` em `frontend/src/features/verificar/dashboard.test.tsx`:

```tsx
  it('mostra "Gerada por" na fila mesmo sem filtro de inspetor ativo, para nota não-inspetor', () => {
    const html = renderToStaticMarkup(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('Gerada por 999999');
    expect(html).toContain('matrícula não cadastrada');
  });

  it('mostra "Gerada por" na fila para nota de inspetor, sem precisar do filtro ativo', () => {
    const html = renderToStaticMarkup(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('Gerada por Fabricio Dias · ES');
  });
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd frontend && npx vitest run src/features/verificar/dashboard.test.tsx`
Expected: FAIL — os dois novos casos, porque a linha "Gerada por" só renderiza com `geradorInspetores` não-vazio hoje.

- [ ] **Step 3: Tornar a linha da fila sempre visível, com rótulo de não cadastrado**

Trocar o bloco em `dashboard.tsx` (linhas 282-286):

```tsx
                    {n.gerador && (
                      <div className="text-[11px] text-text-mute whitespace-nowrap overflow-hidden text-ellipsis">
                        Gerada por {n.gerador.nome}
                        {n.gerador.uf && ` · ${n.gerador.uf}`}
                        {!n.gerador.cadastrado && " (matrícula não cadastrada)"}
                      </div>
                    )}
```

- [ ] **Step 4: Atualizar o mesmo rótulo no painel de detalhe**

Trocar a linha do campo "Gerada por" em `fields` (linha 372):

```tsx
    ["Gerada por", sel.gerador
      ? `${sel.gerador.nome} · ${sel.gerador.matricula}${sel.gerador.cadastrado ? "" : " (não cadastrado)"}`
      : v(sel.colaborador)],
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `cd frontend && npx vitest run src/features/verificar/dashboard.test.tsx`
Expected: PASS — todos os casos, incluindo os da Task 2.

- [ ] **Step 6: Rodar a suíte completa do frontend**

Run: `cd frontend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/verificar/dashboard.tsx frontend/src/features/verificar/dashboard.test.tsx
git commit -m "feat(verificar): mostra gerador de toda nota na fila, sinaliza matrícula não cadastrada"
```

---

### Task 4: Documentação — `docs/dev/01-frontend-verificar.md`

**Files:**
- Modify: `docs/dev/01-frontend-verificar.md:11-12` (resumo do módulo)
- Modify: `docs/dev/01-frontend-verificar.md:59-61` (seção "Fluxo de dados" → descrição do filtro `Gerada por`)

**Interfaces:**
- Consumes: comportamento final implementado nas Tasks 1–3 (nenhuma interface de código — só texto).
- Produces: nada — última task do plano.

- [ ] **Step 1: Atualizar o resumo do módulo (linhas 11-12)**

Trocar:

```markdown
carregado. O filtro **Gerada por** alterna entre todas as notas e as notas
criadas pelos inspetores de planejamento de ES/SP.
```

Por:

```markdown
carregado. O filtro **Gerada por** permite selecionar um ou mais
inspetores de planejamento de ES/SP específicos (multi-select); a fila
sempre mostra quem gerou cada nota, com uma marca quando a matrícula não
tem registro no `De-Para Membros.xlsx`.
```

- [ ] **Step 2: Atualizar a descrição em "Fluxo de dados" (linhas 59-61)**

Trocar:

```markdown
  deriva todo o resto (filtros, fila ordenada, seleção) localmente com
  `useState`/`useMemo`/`usePersistedState`. O filtro persistido `Gerada por`
  usa `note.gerador.inspetor`; no modo de inspetores a fila informa nome e UF
  de quem criou a nota, e o detalhe mostra nome e matrícula. Ações do usuário (concluir,
```

Por:

```markdown
  deriva todo o resto (filtros, fila ordenada, seleção) localmente com
  `useState`/`useMemo`/`usePersistedState`. O filtro persistido `Gerada por`
  (`edp_verify_gerador_insp`) guarda as matrículas de inspetor selecionadas;
  as opções do multi-select são derivadas das notas do lote atual
  (`inspetorOpts`, mesmo padrão de `ufOpts`/`setorOpts`). A fila sempre
  informa nome e UF de quem gerou cada nota — não só quando o filtro de
  inspetor está ativo — e o detalhe mostra nome e matrícula; em ambos, uma
  matrícula sem registro no De-Para aparece com o sufixo "não cadastrada".
  Ações do usuário (concluir,
```

- [ ] **Step 3: Revisar visualmente o arquivo renderizado**

Ler `docs/dev/01-frontend-verificar.md` de novo por inteiro e confirmar que as duas seções batem com o comportamento implementado nas Tasks 1-3 e que nenhuma outra menção ao filtro binário antigo ("alterna entre", `"all"`/`"inspectors"`) ficou esquecida no resto do arquivo.

- [ ] **Step 4: Commit**

```bash
git add docs/dev/01-frontend-verificar.md
git commit -m "docs(verificar): documenta filtro multi-inspetor e gerador sempre visível na fila"
```
