# Decision Packet — Issue #15: Reconciliar o baseline canônico e recuperar o estado real da Sprint 1

- **Issue:** [#15](https://github.com/Pottassiuw/EDP-Helios/issues/15) — `[P0] Reconciliar o baseline canônico e recuperar o estado real da Sprint 1`
- **Milestone:** `Sprint 1 — Input: integridade e operação`
- **Data da investigação:** 2026-08-14
- **Status deste documento:** proposta de decisão, aguardando aprovação humana
- **Escopo desta etapa:** investigação read-only e produção do packet. Nenhum código de aplicação foi alterado, nenhum commit, push, PR, merge ou deploy foi realizado.

Cada afirmação abaixo está marcada como **FATO** (verificado por comando reproduzível nesta sessão), **HIPÓTESE** (não verificável com os acessos atuais) ou **DECISÃO PROPOSTA** (julgamento, requer aprovação).

---

## 1. Contexto

A Issue #15 registra que um diagnóstico externo descreveu uma baseline e um "lote L1 já implementado", mas que a inspeção do repositório não localizou essa branch nem esse commit. Enquanto isso não for reconciliado, nenhum resultado de teste citado no diagnóstico pode ser atribuído a uma árvore conhecida, e a Sprint 1 do módulo Input permanece bloqueada: o épico #14 lista #15 como primeiro item, e o Project marca #15, #16 e #18 como `Blocked`.

Este packet responde às seis perguntas exigidas: fonte canônica, recuperabilidade do L1, opções, recomendação, critérios de aceite e tratamento da falha pré-existente de integração.

---

## 2. Evidências observadas

### 2.1 Topologia do repositório

**FATO F1 — Existe um único remote.**

```
$ git remote -v
origin  https://github.com/Pottassiuw/EDP-Helios.git (fetch)
origin  https://github.com/Pottassiuw/EDP-Helios.git (push)
```

**FATO F2 — A linha ativa de integração é `develop`, não `main`.**
`docs/dev/13-github-delivery-workflow.md` (presente em `origin/develop`) declara: *"A branch default do GitHub é `main`, enquanto a linha ativa de integração do desenvolvimento é `develop` (...) entregas normais do aplicativo devem ter `develop` como base"*. Isso é corroborado pelos PRs: dos 28 PRs existentes, 26 têm `develop` como base; apenas #1 e #52 apontam para `main`.

**FATO F3 — Ponta de `origin/develop` após `git fetch --prune`:**

```
$ git rev-parse origin/develop
9802ebb7bba8d9b22dbee04af046012e1912a03d

$ git log -1 --format='%H%n%an%n%ad%n%s' origin/develop
9802ebb7bba8d9b22dbee04af046012e1912a03d
James N.
Fri Aug 14 11:09:11 2026 -0300
feat(carteira): expose enrichment warnings (#46)
```

**FATO F4 — O working tree local NÃO é a baseline canônica.**
A branch `develop` local está em `b1bcfe5fdb5883402ef87e1143a3df5b4b2fdfaa`, **25 commits atrás** de `origin/develop`, com **112 arquivos divergentes** (9.121 inserções, 530 remoções). Qualquer gate executado na cópia local sem atualização mede outra árvore.

```
$ git rev-parse develop
b1bcfe5fdb5883402ef87e1143a3df5b4b2fdfaa
$ git rev-list --count develop..origin/develop
25
$ git diff --stat b1bcfe5 9802ebb | tail -1
112 files changed, 9121 insertions(+), 530 deletions(-)
```

**FATO F5 — Estado do milestone:** `Sprint 1 — Input: integridade e operação` (milestone #1) tem 20 issues abertas e 3 fechadas.

### 2.2 Identificação do "L1"

**FATO F6 — "L1" é um valor do campo `Batch` do GitHub Project privado `EDP-Helios — Delivery`, e corresponde à Issue #18.**
`docs/dev/13-github-delivery-workflow.md` define o campo **Batch** como "lote técnico, decisão ou etapa de rollout que ordena a execução". A listagem do Project resolve o mapa de lotes:

| Batch | Issue | Status no Project | Título |
|---|---|---|---|
| `Sprint 1 · Epic` | #14 | In Progress | Épico da Sprint 1 |
| `L0 · Baseline reconciliation` | #15 | Blocked | **Esta issue** |
| `D2–D9 · Product and operations decisions` | #16 | Blocked | Decisões de produto/operação |
| `Workflow · Templates, CI, and review gate` | #17 | Done | Templates e gate de revisão |
| **`L1 · Baseline reconciliation`** | **#18** | **Blocked** | **Tornar a criação de notas atômica e impedir sobrescrita concorrente** |
| `L2 · D5 decision` | #19 | Blocked | Vínculo de Nota Mãe como sugestão |
| `L3` | #20 | In Review | Publicar IW66 atomicamente |
| `L4` | #21 | Backlog | Centralizar SLA no backend |
| `L5 · D8/D9 decisions` | #22 | Blocked | JSON válido no Status 10 |
| `L6` … `L19` | #23 … #36 | — | demais lotes |
| `Governance · D10` | #37 | Blocked | Remediação de artefatos sensíveis |
| `Baseline · Regression follow-up` | #38 | Backlog | Regressão pré-existente (ver §7) |

Comando: `gh project item-list 2 --owner Pottassiuw --limit 100 --format json`.

**FATO F7 — A Issue #18 (L1) define o escopo:** validação de duplicidade dentro de `BEGIN IMMEDIATE`, inserção que não atualize registros existentes no caminho de criação, preservação do contrato de `criar_notas`, e conflito HTTP 409 sem falso sucesso.

### 2.3 O trabalho L1 é recuperável?

Foram esgotadas as fontes acessíveis. Nenhuma delas contém o L1.

**FATO F8 — Não existe branch para a Issue #18.**
A convenção observada é `feat/sprint1-<número da issue>` (existem `sprint1-20/21/22/23/28/31/32/34/35/38`). Não existe `feat/sprint1-18` em nenhum ref local ou remoto.

```
$ git branch -a --list "*18*"
(sem saída)
$ git for-each-ref --format='%(refname)' | grep sprint1
refs/heads/feat/sprint1-20 … 38   (nenhum 18)
refs/remotes/origin/feat/sprint1-20 … 38   (nenhum 18)
```

**FATO F9 — Não existe PR para a Issue #18.**
Varredura dos 28 PRs (`gh pr list --state all --limit 100`): nenhum tem `feat/sprint1-18` como head, e nenhum corpo referencia `#18`.

**FATO F10 — A timeline da Issue #18 não registra commit algum.**
`gh api repos/Pottassiuw/EDP-Helios/issues/18/timeline` retorna apenas `milestoned`, `labeled` (×5), `cross-referenced` (do épico #14), `added_to_project_v2` e `project_v2_item_status_changed`. Nenhum evento `referenced`, `committed` ou `connected`.

**FATO F11 — Não há trabalho não publicado no clone local.**

```
$ git stash list
stash@{0}: On feat/verificar-duplicatas-carteira: backup: partial final-review fixes before clean wave
```
Única stash, ancorada em `feat/verificar-duplicatas-carteira` (área Verificar/COFFEE), sem relação com o Input L1. Não foi tocada.

```
$ git fsck --no-progress --dangling | grep -i "dangling commit"
(sem saída)
$ git reflog --all | grep -iE "sprint1-18|atomic|criar_notas"
(apenas o commit de #20, "publish IW66 atomically" — outro lote)
```

**FATO F12 — O código na baseline canônica demonstravelmente NÃO satisfaz os critérios de aceite da #18.**
Em `9802ebb`, `criar_notas` decide duplicidade a partir de uma leitura feita **fora** do limite transacional de escrita, e a gravação usa upsert cego:

`backend/input_module/service.py:104`
```python
def criar_notas(notas: list[NovaNota], usuario: str, origem: str = "manual") -> int:
    """Insere notas novas no plano; levanta NotasDuplicadasErro em conflito."""
    df_novas = _preparar_novas(notas, db.carregar_dados(), origem)   # leitura fora da transação
    db.salvar_em_massa(df_novas)
    return len(df_novas)
```

`backend/input_module/db.py:626` (`salvar_em_massa`) — sem `BEGIN IMMEDIATE`, e com `DO UPDATE`, que converte criação concorrente em atualização silenciosa:
```sql
INSERT INTO notas (...)
VALUES (...)
ON CONFLICT(Numero_Nota) DO UPDATE SET
    <todas as colunas> = excluded.<coluna>;
```

Isto é exatamente o defeito descrito na #18. **Conclusão: o L1 não está presente na baseline canônica.**

**FATO F13 — Por que `HELIOS_TASK.md` não existe.**
`.helios/kanban.json`, tarefa `issue-15:decision-packet`, registra três tentativas de execução automatizada. A primeira falhou com `"stdout": "Failed to authenticate: OAuth session expired and could not be refreshed", "exit_code": 1`, e o próprio orquestrador removeu o brief: `"task_brief": {"path": ".helios\\worktrees\\issue-15-decision-packet\\HELIOS_TASK.md", "removed": true}`. As demais falharam com `worktree path already exists`. O brief foi, portanto, apagado pela automação — não está faltando por erro humano, e seu conteúdo não é recuperável a partir do kanban.

### 2.4 Gates executados na baseline canônica

Executados em worktree limpo, com `HEAD` destacado exatamente em `9802ebb7bba8d9b22dbee04af046012e1912a03d`, conforme os jobs de `.github/workflows/validation.yml`.

| Gate (job da CI) | Comando | Resultado |
|---|---|---|
| `Backend / Input regression suite` | `python -m pytest test_upload.py test_input_module.py` | **183 passed**, 3 warnings, 14,58s |
| `Frontend / Input validation and build` (testes) | `npx vitest run src/features/input` | **7 passed** (5 arquivos), 1,42s |
| `Frontend / Input validation and build` (build) | `npm run build` | **✓ built in 8.09s** |
| `Frontend / …` (whitespace) | `git diff-tree --no-commit-id --check -r HEAD` | **sem saída = aprovado** |
| `Pull request metadata` | — | **N/A** — só roda em evento `pull_request`; não há PR nesta etapa |

**FATO F14 — Os quatro gates automatizáveis estão verdes na baseline canônica `9802ebb`.**

### 2.5 Alterações locais não relacionadas (não tocadas)

**FATO F15 — O working tree principal contém trabalho não relacionado à Issue #15**, que foi deliberadamente preservado e não deve ser incorporado à branch da Sprint:

- Modificados: `.gitignore`, `backend/input_module/db.py`, `docs/dev/00-overview.md`, `docs/dev/06-backend-input-module.md`
- Não rastreados: `backend/workflow_module/`, 11 arquivos `backend/test_*.py`, `docs/dev/13-agent-workflows.md`, `workflow.bat`, `workflow.sh`

**FATO F16 — Colisão de numeração de documento.** O arquivo local não rastreado `docs/dev/13-agent-workflows.md` ocupa o mesmo prefixo `13-` que `docs/dev/13-github-delivery-workflow.md`, já mesclado em `origin/develop` pelo PR #39. Fora do escopo desta issue, mas precisa ser resolvido antes de publicar o trabalho local.

---

## 3. Fonte canônica identificada

**DECISÃO PROPOSTA — a fonte canônica da Sprint 1 é:**

| Item | Valor |
|---|---|
| **Repositório** | `https://github.com/Pottassiuw/EDP-Helios.git` (remote `origin`) |
| **Branch** | `develop` |
| **Commit/SHA** | `9802ebb7bba8d9b22dbee04af046012e1912a03d` |
| **Assunto** | `feat(carteira): expose enrichment warnings (#46)` |
| **Autor / data** | James N., 2026-08-14 11:09:11 -0300 |
| **Milestone** | `Sprint 1 — Input: integridade e operação` |

Base: F1–F5 e F14. Toda branch de lote da Sprint 1 deve ser criada a partir de `origin/develop` e sofrer rebase antes do merge — o que já é imposto pelo workflow `update-delivery-branches.yml` e pela proteção de branch descrita em `docs/dev/13-github-delivery-workflow.md`.

> Ressalva: `9802ebb` é a **ponta atual** de `origin/develop`, que avança a cada merge. O SHA é o baseline verificável no momento desta investigação; o contrato duradouro é "`origin/develop` no momento de criar a branch do lote", com o SHA registrado no PR.

---

## 4. O L1 pode ser recuperado?

**DECISÃO PROPOSTA — Não. Declara-se explicitamente que o trabalho L1 não é recuperável a partir de nenhuma fonte acessível.**

Fundamento: F8 (sem branch), F9 (sem PR), F10 (sem commit na timeline), F11 (sem stash, sem objeto dangling, sem reflog) e F12 (o defeito que o L1 deveria corrigir continua presente no código canônico).

F12 é a evidência decisiva: mesmo que um artefato aparecesse depois, ele não está mesclado em lugar algum que afete a baseline. Do ponto de vista da Sprint, o L1 **não existe**.

**HIPÓTESE H1 — Origem provável da alegação do diagnóstico.** O diagnóstico pode ter descrito trabalho feito em ambiente não versionado/nunca enviado, ou confundido o L1 com os PRs pré-Sprint #10 (`fix/input-transaction-lost-update`) e #11 (`fix/input-atomic-base-upload`), que já foram mesclados e tocam área e vocabulário semelhantes ("atômico", "lost update") sem cobrir `criar_notas`. **Não verificável** com os acessos atuais; permanece hipótese.

**HIPÓTESE H2 — Ambiguidade de rótulo.** O Project rotula a #15 como `L0 · Baseline reconciliation` e a #18 como `L1 · Baseline reconciliation`. A leitura adotada aqui é que o sufixo em #18 indica **dependência** de #15, não que #18 seja a reconciliação. Confirmar com o autor do Project (ver §10, Q1).

---

## 5. Opções consideradas

### Opção A — Recuperar o L1 existente
Localizar branch, commit ou PR e reaplicar sobre o baseline canônico.
**Inviável.** F8–F11 esgotaram as fontes acessíveis: não há artefato para recuperar. Mantida no registro apenas para documentar que foi avaliada e descartada por evidência, não por conveniência.

### Opção B — Recriar o L1 a partir do baseline canônico, com TDD
Criar `feat/sprint1-18` a partir de `origin/develop@9802ebb`, escrever primeiro os testes de corrida exigidos pela #18, depois implementar, e abrir PR contra `develop` com evidência dos gates.
**Viável.** É o caminho já previsto no escopo da própria #15 ("Se o patch não for recuperável, reimplementar L1 com TDD a partir do baseline canônico") e no ciclo de entrega documentado.

### Opção C — Solicitar o patch ao autor do diagnóstico antes de recriar
Pedir bundle, diff ou referência de commit; se chegar, aplicar; se não, cair na Opção B.
**Viável, mas não deve bloquear.** Custo baixo, chance de retorno desconhecida. Deve rodar **em paralelo**, com timebox, nunca como pré-condição.

### Opção D — Ampliar o escopo da #15 para também implementar o L1
Fechar #15 e #18 juntas, numa branch só.
**Rejeitada.** Viola o critério de aceite "nenhum trabalho não relacionado é incorporado à branch da Sprint" e apaga a rastreabilidade issue → branch → PR que o #17 instituiu. #15 entrega a reconciliação; #18 entrega o código.

---

## 6. Recomendação

**DECISÃO PROPOSTA — Adotar a Opção B (recriar o L1 do baseline canônico com TDD), executando a Opção C em paralelo, sem bloquear.**

### Justificativa
A Opção A está factualmente encerrada (F8–F12). Entre B e C, apenas B tem prazo previsível e resultado auditável. Recriar sobre `9802ebb` também garante que o L1 nasça já compatível com os 25 commits que a cópia local ainda não tinha (F4) — reaplicar um patch antigo, se ele aparecesse, exigiria essa mesma reconciliação.

### Sequência proposta
1. Registrar esta decisão como comentário na Issue #15 (fonte canônica + conclusão de não recuperabilidade) e fechá-la. Requer aprovação humana; **não foi executado nesta etapa**.
2. Mover #18 de `Blocked` para `Ready` no Project, já que sua dependência declarada ("não fechar antes de reconciliar o baseline canônico da Sprint") passa a estar satisfeita.
3. Criar worktree/branch `feat/sprint1-18` a partir de `origin/develop` atualizado.
4. TDD: teste de corrida no caminho de persistência (`salvar_em_massa`) e no caminho público de serviço (`criar_notas`), ambos falhando primeiro.
5. Implementar: duplicidade decidida dentro de `BEGIN IMMEDIATE`; `INSERT` sem `DO UPDATE` no caminho de criação; resposta 409 no conflito.
6. Rodar os gates no commit final da branch e colar o resultado no corpo do PR (o job `Pull request metadata` reprova o PR sem isso).
7. Abrir PR contra `develop` com `Closes #18`.

### Consequências
- **Aceitas:** o esforço de implementação do L1 é refeito do zero; a Sprint 1 perde o tempo já investido no trabalho descrito pelo diagnóstico.
- **Positivas:** #15 e #18 saem de `Blocked`, desbloqueando a fila L2…L19; a Sprint passa a ter um SHA de baseline citável; toda alegação futura de "já implementado" passa a ser checável contra branch, PR e gates.
- **Neutras:** nenhuma mudança de comportamento da aplicação nesta etapa; o working tree local não relacionado (F15) permanece intocado.

### Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| O patch original aparece depois e diverge da recriação | Baixa | Médio | Opção C com timebox; se chegar, tratar como revisão de diff sobre a branch nova, não como merge concorrente |
| `criar_notas` é chamada por integrações não mapeadas e o 409 quebra um consumidor | Média | **Alto** (integridade de dados) | Mapear chamadores antes de implementar; a #18 exige explicitamente preservar contratos públicos; cobrir com teste de integração |
| Baseline move durante a implementação (novos merges em `develop`) | Alta | Baixo | `update-delivery-branches.yml` já rebaseia PRs abertos; reexecutar gates após rebase |
| Gates locais divergem da CI por versão de runtime | Média | Médio | Ver H3 abaixo; tratar CI como autoridade |
| Trabalho local não relacionado (F15/F16) contamina a branch da Sprint | Média | Médio | Criar a branch em worktree separado a partir de `origin/develop`, nunca a partir do `develop` local |

**HIPÓTESE H3 — Divergência de ambiente.** Os gates de backend foram executados com **Python 3.11.15** local, enquanto `validation.yml` fixa **Python 3.13** em `windows-latest`. Os 183 testes passaram em 3.11, mas isso não prova paridade com a CI. Pendente até que a CI rode no mesmo commit.

### Pré-condições
- Aprovação humana desta recomendação (a #15 tem label `needs-decision` e o Project a marca como `Blocked`).
- `origin/develop` atualizado no momento de criar a branch; registrar o SHA usado.
- Confirmação de Q1 (§10) sobre o rótulo `L0`/`L1`.
- Nenhuma das decisões pendentes da #16 bloqueia a #18 — o Project não associa nenhuma decisão `D*` ao lote L1.

### Rollback
- Esta etapa: nada a reverter — nenhum commit, push, PR ou merge foi feito. O único efeito colateral local é `node_modules/` e `dist/` gerados no worktree descartável `.helios/worktrees/issue-15-decision-packet` (ambos ignorados pelo git); apagar o worktree remove tudo.
- Etapa seguinte (L1): trabalho isolado em `feat/sprint1-18`; abandono = deletar branch e worktree. Após merge, reversão pelo `git revert` do commit de squash — `develop` é protegida contra force-push, então revert é o único caminho, e ele é suficiente porque o L1 não altera schema.

---

## 7. Tratamento separado da falha pré-existente de integração

**FATO F17 — A falha foi reproduzida e é pré-existente.**
Executada no worktree limpo, primeiro em `9802ebb` e depois em `b1bcfe5`:

```
$ python -m pytest test_integracao_module.py -q          # em 9802ebb
.............F.........                                    [100%]

__________________ test_mover_ja_no_plano_recusa_e_atualiza ___________________
    resultado = service.mover_para_plano(
        [4242], {**CAMPOS, "Status_Obra": "Linha Morta"},
        usuario="teste", atualizar_existente=True)
>   assert resultado["atualizadas"] == 1
E   assert 0 == 1
test_integracao_module.py:183: AssertionError

1 failed, 22 passed
```

```
$ python -m pytest test_integracao_module.py::test_mover_ja_no_plano_recusa_e_atualiza -q   # em b1bcfe5
1 failed
```

Falha idêntica nos dois commits ⇒ **não é regressão introduzida pela Sprint 1**, confirmando a premissa da Issue #38.

**FATO F18 — A falha está fora dos gates da CI.** `validation.yml` executa apenas `test_upload.py test_input_module.py`. `test_integracao_module.py` não é executado por nenhum workflow, o que explica como a falha persistiu sem barrar merges.

**FATO F19 — Existe um PR fechado sem merge sobre exatamente este comportamento.** PR [#6](https://github.com/Pottassiuw/EDP-Helios/pull/6) — `fix: atualizar status da obra ao mover para o plano`, head `fix/integracao-atualizar-plano` → base `develop`, **CLOSED** em 2026-08-09, `mergedAt: null`. A branch `origin/fix/integracao-atualizar-plano` ainda existe.

**DECISÃO PROPOSTA — Tratamento separado:**

1. A falha permanece na Issue **#38** (`Baseline · Regression follow-up` no Project), fora do compromisso do milestone, exatamente como o épico #14 já determina.
2. **Não** corrigi-la na branch do L1. Ela não afeta os gates da Sprint (F18) e misturá-la violaria o critério "nenhum trabalho não relacionado".
3. Ponto de partida da triagem: revisar o PR #6 e a branch `origin/fix/integracao-atualizar-plano` antes de escrever qualquer correção nova — pode conter a análise ou a correção já feita, e entender por que foi fechado sem merge é parte da causa raiz.
4. A triagem deve decidir entre as três hipóteses da própria #38: expectativa incorreta no teste, regressão de serviço, ou fixture desatualizada. **Não determinado nesta investigação** — exigiria ler `integracao_module/service.py` e alterar código, fora do escopo desta etapa.
5. Decisão separada e explícita a tomar: **incluir ou não `test_integracao_module.py` no gate de CI** depois da correção. Enquanto estiver fora, falhas nessa suíte continuam invisíveis para o processo de merge. Recomendado incluir, como parte do fechamento da #38.

---

## 8. Critérios de aceite

Mapeados um a um contra os critérios da Issue #15.

| # | Critério (Issue #15) | Como verificar | Estado |
|---|---|---|---|
| 1 | Fonte canônica documentada (repo, branch e SHA) | §3 deste documento + comentário na Issue #15 | **Atendido neste packet**; falta publicar na issue (requer aprovação) |
| 2 | Estado de L1 verificável por commit acessível e PR/issue vinculada, **ou explicitamente recriado** | §4 declara a não recuperabilidade com base em F8–F12; a recriação se conclui com o merge do PR de #18 | **Parcial** — a declaração está feita; a recriação é a etapa seguinte |
| 3 | Gates executados no mesmo commit que será usado pela Sprint | §2.4: quatro gates verdes em `9802ebb` | **Atendido para o baseline**; devem ser reexecutados no commit final de `feat/sprint1-18` |
| 4 | Nenhum trabalho não relacionado é incorporado à branch da Sprint | F15/F16 inventariam o trabalho local não relacionado; nada dele foi tocado; branch do L1 deve nascer de `origin/develop` | **Atendido nesta etapa** |

Critérios adicionais para considerar o L1 (Issue #18) concluído — reproduzidos da própria issue:

- [ ] Duas criações concorrentes para o mesmo identificador resultam em exatamente uma vencedora.
- [ ] A tentativa perdedora recebe conflito explícito (HTTP 409) e não grava nem sobrescreve campos.
- [ ] Há teste de corrida real no caminho de persistência e no caminho público de serviço.
- [ ] Os testes de integração dependentes de criação continuam verdes.

---

## 9. Gates que precisam ser executados

Definidos por `.github/workflows/validation.yml` em `origin/develop`. Devem ser reexecutados no commit final da branch do L1 e o resumo colado no corpo do PR (o job `Pull request metadata` reprova o PR sem `Closes #<n>`, sem gate marcado e sem resultado resumido).

| Job | Ambiente na CI | Comando |
|---|---|---|
| `Pull request metadata` | ubuntu-latest | validação do corpo do PR (`Closes #18`, gate marcado, resultado resumido) |
| `Backend / Input regression suite` | windows-latest, Python 3.13 | `cd backend && python -m pytest test_upload.py test_input_module.py` |
| `Frontend / Input validation and build` | ubuntu-latest, Node 24 | `cd frontend && npm ci && npx vitest run src/features/input && npm run build` |
| whitespace (mesmo job) | ubuntu-latest | `git diff --check <base>...HEAD` |
| `delivery-sync-contract.yml` | — | valida a lógica pura do sincronizador; roda automaticamente |

Gate adicional recomendado ao trabalhar no L1, ainda que não exigido pela CI: `python -m pytest test_integracao_module.py`, para garantir que a falha conhecida da #38 continua sendo a **única** falha e que o L1 não introduziu outras (critério 4 da #18).

---

## 10. Questões em aberto

| # | Questão | Bloqueia? | Dono sugerido |
|---|---|---|---|
| Q1 | O rótulo `L1 · Baseline reconciliation` na #18 significa "lote 1, depende da reconciliação" (leitura adotada) ou outra coisa? Confirmar antes de agir sobre a #18. | Sim, para a etapa seguinte | Autor do Project |
| Q2 | O autor do diagnóstico consegue fornecer bundle, diff ou SHA do L1 alegado? (Opção C) | Não — roda em paralelo | Operador |
| Q3 | Qual foi o resultado de teste citado no diagnóstico e a que árvore pertencia? Sem isso, nenhum número do diagnóstico pode ser reconciliado. | Não | Autor do diagnóstico |
| Q4 | `test_integracao_module.py` deve entrar no gate de CI após o fechamento da #38? | Não | Dono da #38 |
| Q5 | Confirmar paridade de runtime: gates locais rodaram em Python 3.11.15, a CI fixa 3.13 (H3). | Não | CI |
| Q6 | Como resolver a colisão `docs/dev/13-*` (F16) antes de publicar o trabalho local? Fora do escopo da #15. | Não | Autor do trabalho local |
| Q7 | Por que o PR #6 foi fechado sem merge? Entra na triagem da #38 (F19). | Não | Dono da #38 |

---

## 11. Comandos executados e resultados

Todos read-only sobre serviços externos. Nenhuma escrita em GitHub, SAP, Telegram, credenciais ou segredos.

### Inspeção do repositório
| Comando | Resultado |
|---|---|
| `git status --porcelain=v1` | 4 modificados, 14 não rastreados — todos não relacionados (F15) |
| `git remote -v` | um remote: `origin` → `Pottassiuw/EDP-Helios.git` |
| `git fetch origin --prune` | refs atualizadas; `origin/develop` = `9802ebb` |
| `git branch -vv --all` | `develop` local em `b1bcfe5`, 25 atrás; sem `feat/sprint1-18` |
| `git worktree list` | 18 worktrees; nenhuma para a #18 |
| `git rev-list --count develop..origin/develop` | `25` |
| `git diff --stat b1bcfe5 9802ebb` | `112 files changed, 9121 insertions(+), 530 deletions(-)` |
| `git branch -a --list "*18*"` | sem saída |
| `git stash list` | 1 stash, de `feat/verificar-duplicatas-carteira` (não relacionada) |
| `git fsck --no-progress --dangling` | nenhum dangling commit |
| `git reflog --all \| grep -iE "sprint1-18\|atomic\|criar_notas"` | só o commit de #20 (outro lote) |
| `git ls-tree -r --name-only origin/develop -- .github` | 10 arquivos, incl. `workflows/validation.yml` |
| `git show origin/develop:.github/workflows/validation.yml` | definição dos gates (§9) |
| `git grep -n "def criar_notas" origin/develop -- backend` | `service.py:104` |
| `git grep -n "ON CONFLICT" origin/develop -- backend/input_module/db.py` | `db.py:688`, `886`, `1008`, `1521` |

### GitHub (leitura)
| Comando | Resultado |
|---|---|
| `gh auth status` | autenticado como `Pottassiuw`; escopos `gist, project, read:org, repo, workflow` |
| `gh issue view 15 / 14 / 16 / 18 / 38` | corpos e labels obtidos |
| `gh issue list --label "sprint:1" --state all` | 23 issues (#14–#36) |
| `gh pr list --state all --limit 100` | 28 PRs; 26 com base `develop` |
| `gh api .../issues/18/timeline` | nenhum evento de commit/PR (F10) |
| `gh project field-list 2 --owner Pottassiuw` | 16 campos, incl. `Batch` (texto livre) |
| `gh project item-list 2 --owner Pottassiuw --limit 100` | 25 itens; mapa de lotes L0–L19 (F6) |
| `gh api .../milestones` | `Sprint 1 — Input: integridade e operação`: 20 abertas, 3 fechadas |
| `gh pr view 6` | `CLOSED`, `mergedAt: null`, head `fix/integracao-atualizar-plano` (F19) |

### Gates, em worktree limpo com `HEAD` = `9802ebb`
| Comando | Resultado |
|---|---|
| `git checkout --detach 9802ebb` | `HEAD is now at 9802ebb`; `git status` limpo |
| `python -m pytest test_upload.py test_input_module.py -q` | **183 passed**, 3 warnings, 14,58s |
| `npm ci` | `found 0 vulnerabilities` |
| `npx vitest run src/features/input` | **7 passed** (5 arquivos), 1,42s |
| `npm run build` | **✓ built in 8.09s** |
| `git diff-tree --no-commit-id --check -r HEAD` | sem saída = aprovado |
| `python -m pytest test_integracao_module.py -q` | **1 failed, 22 passed** — `test_mover_ja_no_plano_recusa_e_atualiza` (F17) |
| `git checkout --detach b1bcfe5` + mesmo teste | **1 failed** — falha idêntica ⇒ pré-existente (F17) |
| `git checkout --detach b1bcfe5` (restauração final) | worktree devolvida ao commit original, `git status` limpo |

O worktree usado foi `.helios/worktrees/issue-15-decision-packet` — descartável, criado pela automação Helios para esta tarefa, sem branch associada (HEAD destacado) e restaurado ao seu commit original ao final.

### Verificação do próprio artefato
| Comando | Resultado |
|---|---|
| `git diff --check` | sem saída = sem erros de espaço em branco |
| `git status --porcelain=v1` | somente `?? docs/dev/decisions/` adicionado aos itens pré-existentes de F15 |

---

## 12. Resumo das conclusões

| Pergunta | Resposta | Tipo |
|---|---|---|
| Fonte canônica da Sprint 1 | `Pottassiuw/EDP-Helios` · `develop` · `9802ebb7bba8d9b22dbee04af046012e1912a03d` | FATO + DECISÃO PROPOSTA |
| L1 é recuperável? | **Não.** Sem branch, sem commit, sem PR, sem stash, sem objeto dangling; e o defeito-alvo continua presente no código canônico | FATO |
| O que é o L1 | Issue #18 — criação atômica de notas (campo `Batch` do Project) | FATO |
| Recomendação | Recriar com TDD a partir do baseline canônico (Opção B); pedir o patch em paralelo, sem bloquear (Opção C) | DECISÃO PROPOSTA |
| Gates na baseline | 4 de 4 verdes em `9802ebb`; o de metadados de PR não se aplica sem PR | FATO |
| Falha pré-existente | Reproduzida em `9802ebb` **e** em `b1bcfe5`; permanece isolada na Issue #38; ponto de partida da triagem é o PR #6 | FATO + DECISÃO PROPOSTA |
