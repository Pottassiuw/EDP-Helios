# Baseline canônico da Sprint 1 (Input)

Documento de reconciliação da issue #15. Registra qual árvore é a fonte da
verdade da Sprint 1, o que existe de fato no código (não o que as issues
prometem), o resultado dos gates no commit entregue e as divergências
encontradas entre as branches.

## Fonte canônica

| Item | Valor |
|---|---|
| Repositório | `Pottassiuw/EDP-Helios` (único remoto `origin`) |
| Branch base da sprint | `develop` |
| SHA de `develop` na reconciliação | `5b5ba0f` |
| Branch de trabalho da sprint | `claude/sprint-issues-features-wumh6k` |
| Commit dos gates registrados abaixo | `30770a5` |
| Ancestral comum com `develop` | `5b5ba0f` (a branch da sprint parte de `develop`, sem merges de terceiros) |

`main` é a branch de release: recebe `develop` por PR. Todo PR da Sprint 1
tem `develop` como base.

## Divergência entre `main` e `develop`

No momento desta reconciliação, `main` tinha **7 commits ausentes de
`develop`** e `develop` tinha 40 ausentes de `main`. Dos 7, quatro são ruído
(um PR de design e seu revert, que se anulam) e três são limpeza de linhas em
branco. Sobra um de conteúdo:

- **`4eb2e25` — "Fix/metas caminho recomposicao dinamico" (PR #52)**: mudou
  `config.caminho_controle_recomposicao()` para procurar a planilha do Plano
  de Recomposição em várias pastas candidatas do OneDrive/perfil do usuário,
  em vez de um caminho fixo em `C:/Users/<usuário>/EDP/...`. **Esse PR foi
  mesclado só em `main`.** Quem roda a partir de `develop` — inclusive a
  Sprint 1 — ainda tem a versão antiga, de caminho único.

Isso não foi corrigido aqui de propósito: a issue #15 pede explicitamente que
nenhum trabalho não relacionado entre na branch da sprint. A recomendação é um
PR de sincronização `main` → `develop` tratado à parte, antes de a sprint
integrar.

## Estado real por issue

Verificado no código do commit `30770a5`, não pelo texto das issues.

| Issue | Estado verificado | Evidência |
|---|---|---|
| #17 | Entregue | `.github/workflows/validation.yml`, `docs/dev/13-github-delivery-workflow.md` |
| #18 | Entregue | `db.inserir_notas_novas` decide duplicidade e grava no mesmo `BEGIN IMMEDIATE` |
| #19 | **Parcial** | O vínculo automático foi *desligado* (o detetive `varrerVinculos` não é chamado por nenhum componente), mas o fluxo de "sugestão com confirmação" não existe. Depende de D5 |
| #20 | Entregue | publicação IW66 atômica + hierarquia sob lock |
| #21 | Entregue | `input_module/sla.py` canônico, colunas materializadas, exportação estrita |
| #22 | Entregue | `status10_service` com JSON válido |
| #23 | Entregue | `sap_sync` impede execução concorrente |
| #24 | **Aberta** | `main.py` agenda a extração num laço `asyncio` do próprio processo; o lock é em memória (`sap_sync`), não sobrevive a reinício nem cobre múltiplos workers. Depende de D4 |
| #25 | **Aberta** | `POST /rateio/executar` recebe `login_sap`/`senha_sap` no corpo e roda o robô SAP dentro da request. Depende de D3 |
| #26 | Entregue | trilha de criação, ramal e exportação; identidade obrigatória |
| #27 | Entregue | `GET /logs` paginado e filtrado no banco; timeline em SQL |
| #28 | Entregue | polling de sincronização unificado |
| #29 | **Aberta** | leituras integrais em caminhos quentes seguem (ex.: `carregar_dados()` em `obter_hierarquia`) |
| #30 | Entregue | publicação do espelho coalescida, sem tocar lock de terceiro |
| #31 | Entregue | busca global com debounce e índice |
| #32 | Entregue | estados vazios acessíveis |
| #33 | **Aberta** | há código morto conhecido (`varrerVinculos` só é usado por testes). Depende de D7 para o inspector |
| #34 | **Parcial** | o PR #42 extraiu as regras puras para `reports-lib.ts`/`rateio-lib.ts`, mas `reports.tsx` (1484 linhas) e `rateio.tsx` (1111) continuam acima do alvo de componente |
| #35 | Entregue | avisos de enriquecimento expostos no contrato |
| #36 | **Aberta** | manual atualizado a cada entrega; falta a revisão de fechamento |

Itens fora do compromisso do milestone:

- **#37 / D10** — remediação de artefato sensível versionado. Há material que
  não deve ser descrito em tracker público; tratar fora dele (ver
  `16-decisoes-sprint-1.md`).
- **#38** — a correção já está em `develop` (`Status_Obra` na whitelist
  `CAMPOS_EDITAVEIS`, `db.py`). O PR #51 ficou com diff vazio: pode ser
  fechado junto com a issue.

## Gates no commit entregue

Executados em worktree limpo (`git worktree add --detach`) no commit
`30770a5`, com as mesmas suítes que o `validation.yml` roda:

| Gate | Comando | Resultado |
|---|---|---|
| Backend (escopo do CI) | `pytest test_upload.py test_input_module.py` | 234 passed, 1 skipped |
| Backend (suíte completa) | `pytest` | 467 passed, 1 skipped |
| Frontend (escopo do CI) | `npx vitest run src/features/input` | 48 passed |
| Frontend (suíte completa) | `npx vitest run` | 198 passed |
| Build | `npm run build` | ok |
| Espaços em branco | `git diff --check origin/develop...HEAD` | sem erros |

O `skipped` é o teste de UNC, específico do Windows — ver abaixo.

**Matriz do CI:** o job de backend roda em `windows-latest` e o de frontend em
`ubuntu-latest` (`.github/workflows/validation.yml`). Uma execução local em
Linux não é equivalente à do CI para o backend; é por isso que a diferença de
plataforma precisa estar explícita nos testes.

## Triagem da falha pré-existente

`test_conexao_backup_converte_unc_para_uri_sem_authority` falhava em qualquer
máquina Linux/macOS, inclusive antes das mudanças desta sprint.

- **Causa**: o teste fixa a semântica de UNC do Windows. Em POSIX a barra
  invertida é caractere comum de nome de arquivo, então
  `Path("\\\\servidor\\share\\x.db").absolute().as_uri()` produz outra coisa —
  o código está certo, o teste é que só vale numa plataforma.
- **Impacto no CI**: nenhum. O job de backend roda em Windows, onde o teste
  passa.
- **Ação**: marcado com `skipif(os.name != "nt")` e acompanhado de uma
  contraparte multiplataforma (`test_conexao_backup_abre_caminho_local_somente_leitura`).
  A suíte fica verde em qualquer plataforma sem perder a cobertura onde ela
  importa.

## O que falta para fechar a #15

1. Decidir o destino do PR #52 (sincronizar `main` → `develop`).
2. Fechar #38 e o PR #51, cuja correção já está em `develop`.
3. Reabrir ou reescopar #34, entregue só em parte.
4. Resolver as decisões de `16-decisoes-sprint-1.md` que ainda travam #19,
   #24, #25 e #33.
