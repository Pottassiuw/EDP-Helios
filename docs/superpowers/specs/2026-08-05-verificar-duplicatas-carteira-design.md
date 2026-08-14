# Design: Cruzamento de Duplicatas Externas com a Carteira de Notas — Verificar

**Date:** 2026-08-05
**Scope:** Fase 2 do design de duplicatas (2026-06-08), antes adiada por falta de fonte. Enriquece candidatas externas via Carteira de Notas + completa Poste/Referência sob demanda via COFFEE ao vivo.
**Out of scope:** Sincronização automática da Carteira disparada por este fluxo (usa o snapshot local já existente); alterar o schema de `nota_carteira`; qualquer escrita nova em banco além da que `POST/GET /api/coffee/consultar/{id}` já faz hoje.

---

## Contexto

O design de 2026-06-08 (`2026-06-08-duplicate-fix-design.md`) implementou a comparação lado a lado de duplicatas **dentro da planilha/fonte Verificar** (`in_sheet: true`), mas deixou como Fase 2, fora de escopo, o enriquecimento de candidatas **externas** — 233 de 239 IDs candidatos no levantamento original, a maioria dos casos reais. Até hoje elas só mostram um aviso genérico:

> "Nota fora desta planilha. Verifique os campos direto no COFFEE ou aguarde a integração com o BI."

A "integração com o BI" mencionada ali já existe: a **Carteira de Notas** (`backend/carteira_module/`, `carteira.db`), um espelho local somente-leitura da base COFFEE via Databricks (`sandbox_uc.ddpm.coffee_onr_es_sp`, ~98k notas). A tabela `nota_carteira` é indexada por `id_onr`, que é o **mesmo espaço de ID** usado nas candidatas de `chk_duplicada` — não é preciso nenhum de-para.

`nota_carteira` já tem `local_instalacao`, `latitude`/`longitude`, `sintoma`, `componente_novo` (equivalentes ao `problema` do Verificar, que já é `componente + sintoma + causa` concatenados), além de `status_sap`, `prioridade_sap`, `conjunto`/`descricao_conjunto` — dados de contexto que a fonte Verificar nunca teve para candidatas externas. Ela **não tem** `poste` nem `referencia` (física/elétrica): esses só existem na API COFFEE ao vivo (`json_all/{id}`, já usada por `coffee_module/client.py: buscar_nota`).

## Objetivo

1. Para toda candidata externa com match na Carteira: mostrar uma grade de comparação real (Local instalação + Problema) e dados de contexto (Status SAP, Prioridade SAP, Conjunto), sem nenhuma chamada de rede — tudo local, batelada única por request de `/api/data`.
2. Para candidata externa sem match na Carteira: estado dedicado, distinto do "match" — mensagem explícita de que a nota não está na Carteira (pode nunca ter sido sincronizada, ou não ser uma nota COFFEE real).
3. Para completar Poste/Referência (ausentes na Carteira): botão por card que busca ao vivo na API COFFEE, sob demanda — nunca em lote, para não travar o carregamento da tela com N chamadas de até 120s cada.

---

## 1. Backend — enriquecimento em lote via Carteira

### 1a. `main.py` — nova função, uma chamada por request

```python
from carteira_module import db as _carteira_db
from carteira_module import repository as _carteira_repo

def enriquecer_candidatos_externos(records: list[dict]) -> None:
    """Preenche candidatas externas (in_sheet=False) com dados da Carteira, em lote."""
    ids_externos = {
        int(c["id"])
        for r in records for c in r["duplicates"]
        if not c["in_sheet"] and str(c["id"]).isdigit()
    }
    if not ids_externos:
        return

    conn = _carteira_db.conectar()
    try:
        encontrados = _carteira_repo.obter_muitos(conn, list(ids_externos))  # já existe
    finally:
        conn.close()

    for r in records:
        for c in r["duplicates"]:
            if c["in_sheet"]:
                continue
            nota = encontrados.get(int(c["id"])) if str(c["id"]).isdigit() else None
            c["carteira_match"] = nota is not None
            if nota is None:
                continue
            c["local_instalacao"] = nota.get("local_instalacao") or ""
            c["problema"] = " · ".join(filter(None, [
                nota.get("componente_novo"), nota.get("sintoma"),
            ])) or ""
            c["status_sap"] = nota.get("status_sap")
            c["prioridade_sap"] = nota.get("prioridade_sap")
            c["conjunto"] = nota.get("descricao_conjunto") or nota.get("conjunto")
            c["latitude"] = nota.get("latitude")
            c["longitude"] = nota.get("longitude")
            c["carteira_ausente_em"] = nota.get("ausente_na_origem_em")
```

Chamada em `montar_registros_triagem`, uma vez, depois do loop que monta `duplicates` (mesmo ponto onde hoje roda `enriquecer_gerador`).

`obter_muitos(conn, id_onrs)` já existe em `carteira_module/repository.py:240` — devolve `{id_onr: dict}` com todas as colunas de `nota_carteira`. Reaproveitado tal como está, sem alteração.

Import cross-module (`main.py` → `carteira_module`) segue o mesmo padrão já usado para `coffee_module` (`from coffee_module import db as _coffee_db`) no topo do arquivo.

### 1b. `coffee_module/routes.py: consultar()` — poste/referência sob demanda

```python
@router.get("/consultar/{id}")
def consultar(id: int):
    _garantir_banco()
    try:
        nota = client.buscar_nota(id)
        classe = db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
    except client.NotaNaoEncontradaErro as exc:
        ...
    fields = nota["fields"]
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

Mesmo fallback tolerante que `main.py` já usa para a planilha Verificar (`extract_str(row, "postes", "poste")`), aplicado aqui ao dict `fields` bruto da API COFFEE. Sem certeza absoluta do nome exato da chave — se a chamada real devolver `None` para os dois, o frontend trata como "não disponível nesta nota", não como erro.

Nenhuma escrita nova: `db.upsert_nota` já rodava aqui antes.

---

## 2. Frontend

### 2a. Tipos (`src/types.ts`)

```typescript
export interface DuplicateCandidate {
  // ...campos existentes...
  carteira_match?: boolean;
  status_sap?: string | null;
  prioridade_sap?: number | null;
  conjunto?: string | null;
  carteira_ausente_em?: string | null;
}
```

`local_instalacao`/`problema`/`latitude`/`longitude` já existem no tipo (usados hoje por candidatas in-sheet).

### 2b. `duplicate-compare.tsx` — três estados de card

**Estado 1 — In-sheet.** Inalterado.

**Estado 2 — Externo + `carteira_match: true`.**
- Badge muda de "⧉ Externo" (amber neutro) para algo que comunica "achamos, mas fora da planilha" — mesma cor amber, texto "◐ Carteira · X/2 campos-chave" antes da busca completa, "X/4" depois.
- Grid com 2 linhas key-field (Local instal., Problema) usando o mesmo `CompareRow`/`dupcEq` já existentes — sem mudança de lógica de comparação, só menos linhas.
- Linhas de contexto adicionais (mesmo padrão não-key de `DUPC_CTX`): Status SAP, Prioridade SAP, Conjunto.
- Se `carteira_ausente_em` estiver preenchido (tombstone — nota saiu da última sincronização): aviso sutil abaixo do header, "Ausente da Carteira desde {data}" — mostra os dados mesmo assim (podem estar desatualizados), não bloqueia.
- Botão "⌕ Buscar poste/referência no COFFEE" (mesmo estilo `outline` dos botões existentes no card): chama `EDPApi.consultarNota(Number(c.id))`, injeta `poste`/`referencia` na candidata em estado local do componente, grid ganha as 2 linhas que faltavam, badge recalcula para X/4. Erro (404/502) vira toast (Sonner, já é dependência do projeto) — "Não foi possível consultar a nota {id} no COFFEE".

**Estado 3 — Externo + `carteira_match: false`.**
- Mesmo badge amber, texto "⧉ Não encontrada na Carteira".
- Corpo do card: mensagem explicando que a nota não está na base sincronizada (pode não ter sido gerada ainda, ou não sincronizada) — sem grid de comparação (nada pra comparar).
- Mesmo botão de busca ao vivo, mas em destaque (é a única fonte possível pra essa candidata) — sucesso aqui preenche `local_instalacao`/`poste`/`referencia` a partir da resposta de `consultarNota` e a UI passa a mostrar o que foi encontrado (sem virar comparação key-field completa, já que não há uma "Carteira row" pra basear `problema`/contexto — só os campos que a API COFFEE devolveu).

### 2c. `api.ts`

`consultarNota` já existe e será estendida (backend) para devolver `poste`/`referencia` — só o tipo `CoffeeConsulta` (`features/coffee/types.ts`) precisa dos 2 campos novos opcionais.

---

## 3. Erros e estados de borda

- Carteira nunca sincronizada (`carteira.db` vazio/tabela sem linhas): `obter_muitos` devolve `{}` — todo candidato externo cai no Estado 3 ("não encontrada"), comportamento correto sem tratamento especial.
- ID de candidata não numérico (não deveria ocorrer após `parse_duplicate_ids`, mas defensivo): pulado do lookup em lote, tratado como Estado 3.
- `consultarNota` falhando (rede COFFEE fora, nota arquivada/inexistente): toast de erro, card permanece no estado anterior (2 ou 3 sem os campos extras) — nunca quebra a tela.

---

## 4. Testes

**Backend (`pytest`):**
- `enriquecer_candidatos_externos`: candidata com match ativo (preenche todos os campos), match tombstoned (preenche + expõe `carteira_ausente_em`), sem match (`carteira_match=False`, nenhum campo extra), lote vazio (no-op).
- `consultar()`: resposta inclui `poste`/`referencia` quando presentes em `fields`; `None` quando ausentes (sem erro).

**Frontend:** `duplicate-compare.test.tsx` (test file já existe para o dashboard — `dashboard.test.tsx` — segue o mesmo padrão) cobrindo os 3 estados de card + o fluxo de busca sob demanda (mock de `consultarNota`, verifica que o grid ganha as 2 linhas depois do clique). `tsc -b` sem erros, `npm run build`.

---

## File change summary

| File | Change |
|---|---|
| `backend/main.py` | `enriquecer_candidatos_externos()`; chamada em `montar_registros_triagem` |
| `backend/coffee_module/routes.py` | `consultar()` devolve `poste`/`referencia` |
| `frontend/src/types.ts` | `DuplicateCandidate`: `carteira_match`, `status_sap`, `prioridade_sap`, `conjunto`, `carteira_ausente_em` |
| `frontend/src/features/coffee/types.ts` | `CoffeeConsulta`: `poste`, `referencia` |
| `frontend/src/features/verificar/duplicate-compare.tsx` | 3 estados de card, busca sob demanda |
| `docs/dev/01-frontend-verificar.md` | Documenta o cruzamento com a Carteira |
| `docs/dev/10-backend-carteira-module.md` | Documenta o novo consumidor de `obter_muitos` |

Backend test: `backend/test_upload.py` (estende os testes existentes de `montar_registros_triagem`) + `backend/test_coffee_module.py` (estende teste de `consultar`).
