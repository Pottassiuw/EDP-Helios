# Fluxo de entrega no GitHub

## Objetivo

O EDP-Helios usa GitHub para transformar diagnóstico técnico em entrega rastreável: **Issue → branch isolada → Pull Request → revisão → merge → validação**. O [Project de entrega](https://github.com/users/Pottassiuw/projects/2) é privado e concentra contexto operacional; as Issues e Pull Requests continuam no repositório público com conteúdo sanitizado.

## Fontes de verdade

| Artefato | Responsabilidade |
|---|---|
| GitHub Issue | problema, escopo, critérios de aceite, risco e dependências. |
| Milestone | compromisso de uma sprint. A Sprint 1 usa `Sprint 1 — Input: integridade e operação`. |
| GitHub Project | ordem de execução: `Status`, `Sprint`, `Priority` e `Batch`, além de PRs e revisão vinculados. |
| Branch | implementação isolada de uma Issue ou lote explicitamente aprovado. |
| Pull Request | diff revisável, evidência dos gates, riscos e vínculo que fecha a Issue. |
| `docs/dev/` | manual vivo do comportamento e arquitetura realmente entregues. |

A branch default do GitHub é `main`, enquanto a linha ativa de integração do desenvolvimento é `develop`. Por isso a automação valida Pull Requests destinados a ambas; entregas normais do aplicativo devem ter `develop` como base até que uma mudança formal de política altere esse arranjo.

## Project: EDP-Helios — Delivery

O Project privado `EDP-Helios — Delivery` é vinculado a `Pottassiuw/EDP-Helios` e tem estes estados:

| Status | Quando usar |
|---|---|
| **Backlog** | trabalho conhecido, ainda não selecionado. |
| **Ready** | escopo, critérios de aceite, dono e dependências claros; pode receber branch. |
| **In Progress** | implementação ou validação em andamento. |
| **In Review** | PR e evidências estão disponíveis para revisão. |
| **Blocked** | aguarda decisão, acesso, dependência ou reconciliação do baseline. |
| **Done** | merge em `develop` e checks declarados aprovados. |

Os campos customizados são:

- **Sprint** — ciclo de entrega, inicialmente `Sprint 1`;
- **Priority** — `P0 - Critical`, `P1 - High`, `P2 - Performance`, `P3 - Quality`, `Decision` ou `Coordination`;
- **Batch** — lote técnico, decisão ou etapa de rollout que ordena a execução.

A Sprint 1 do Input inicia com `#15` bloqueada para reconciliação do baseline e `#16` bloqueada para decisões de produto/operação. Nenhuma Issue de implementação deve ser declarada pronta apenas com base em um relatório: confirme branch, commit, diff, testes e merge no estado vivo do repositório.

## Ciclo de uma Issue

1. **Triage**: validar que não há duplicata, classificar labels/milestone e registrar critérios de aceite testáveis.
2. **Ready**: eliminar bloqueios explícitos. Decisões de produto, infraestrutura ou segurança ficam em Issues de decisão, não escondidas no PR.
3. **Implementação**: criar branch/worktree a partir de `origin/develop`; para mudança de comportamento, seguir teste primeiro e adicionar regressão.
4. **Revisão local**: revisar o diff, verificar escopo, segredos, arquivos gerados, testes e documentação.
5. **PR**: abrir contra `develop`, usar `Closes #<número>`, preencher o template e mover o item para **In Review**.
6. **Merge**: somente depois de evidência dos gates e revisão; o vínculo fecha a Issue. Então mover o Project para **Done**.

O procedimento operacional e os comandos de worktree estão em [`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## Gates automatizados

`.github/workflows/validation.yml` executa sem segredos e com permissões mínimas (`contents: read`):

| Job | Ambiente | Gate |
|---|---|---|
| `Pull request metadata` | Ubuntu | exige `Closes #<Issue>`, ao menos um gate marcado e resultado resumido no corpo do PR. |
| `Backend / Input regression suite` | Windows + Python 3.13 | instala `backend/requirements.txt` e executa `test_upload.py test_input_module.py`. |
| `Frontend / Input validation and build` | Ubuntu + Node 24 | `npm ci`, testes de `src/features/input`, build TypeScript/Vite e `git diff --check`. |

Os testes de backend já forçam perfil local, diretório temporário e raiz de rede inexistente em `backend/conftest.py`; a CI não deve receber caminhos, bases ou credenciais de produção.

A workflow ainda não é uma proteção remota enquanto esta branch não for revisada, commitada e enviada. Depois de seu primeiro run verde, configure proteção em `develop` para exigir Pull Request, revisão e os três checks acima. Fazer isso antes de existirem checks registrados pode bloquear merges sem oferecer uma rota de recuperação clara.

## Templates do GitHub

- `.github/ISSUE_TEMPLATE/bug-report.yml` coleta reprodução, impacto e regressão esperada.
- `.github/ISSUE_TEMPLATE/feature-request.yml` coleta escopo, não escopo e critérios de aceite.
- `.github/ISSUE_TEMPLATE/decision.yml` registra alternativas, trade-offs, responsável e Issues desbloqueadas.
- `.github/pull_request_template.md` exige vínculo da Issue, gates, riscos, rollback e checklist de dados sensíveis.

Os templates não substituem investigação técnica: uma Issue bem preenchida ainda precisa ser validada contra a implementação atual antes de iniciar código.

## Segurança e privacidade do tracker

O repositório é público. Não publicar:

- tokens, senhas, chaves ou conteúdo de `.env`/arquivos de credenciais;
- dados pessoais de colaboradores;
- caminhos internos, endereços de rede, planilhas internas ou dumps de banco;
- detalhes suficientes para explorar vulnerabilidades antes de remediação.

Use descrições anonimizadas e mantenha evidência sensível fora do tracker público. Uma correção de segurança pode usar uma Issue pública de coordenação com escopo minimizado e registrar os detalhes de remediação em canal privado autorizado.

## Governança de Sprint 1

A Sprint 1 prioriza integridade de dados e operação do módulo Input. O épico `#14` agrega o backlog; o Project registra a sequência por lotes L0–L19. Itens que dependem de decisões (perfil de execução, credenciais SAP, scheduler, vínculo automático, paginação de logs, Inspector, semântica e destinatários do Status 10, e retenção de artefatos sensíveis) ficam em **Blocked** até decisão explícita.

Essa regra previne que um PR aparente “resolver” um problema técnico ao mesmo tempo em que escolhe silenciosamente uma política de produto ou infraestrutura.
