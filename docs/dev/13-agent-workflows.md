# Orquestrador de Entrega por Agentes

## Objetivo

O Helios Delivery Orchestrator transforma uma fotografia de GitHub Project,
Issue e Pull Request em um plano de entrega determinístico. Ele existe para dar
ao Hermes Kanban um grafo de execução explícito sem transformar o backend em um
executor de código ou em uma fonte paralela de regras de produto.

## Fonte de produto e grafo de execução

O **GitHub Project** é a fonte de verdade de produto: nele ficam a prioridade,
sprint, estado de produto e ordenação do trabalho. A Issue preserva o problema,
escopo e critérios de aceite; a Pull Request preserva o diff e a evidência de
revisão. O fluxo geral de desenvolvimento e a organização dos módulos continuam
documentados no
[manual de visão geral](./00-overview.md).

O **Hermes Kanban** é a projeção de execução. O Helios mantém um store local
operável e possui um adaptador opcional para o SQLite real do Hermes, com as
mesmas dependências e IDs determinísticos. O Kanban não substitui o Project,
não redefine prioridade e não atualiza o GitHub nesta fatia.

```text
GitHub Project + Issue/PR snapshot
                |
                v
backend/workflow_module (pure planner)
                |
                v
JSON-friendly delivery plan
                |
                v
local Kanban + optional Hermes SQLite projection
```

## Contrato atual

O pacote `backend/workflow_module/` usa somente a biblioteca padrão do Python.
Ele não importa `main.py`, `coffee_module`, `input_module` nem módulos de
banco.

| Arquivo | Responsabilidade |
|---|---|
| `models.py` | Modelos imutáveis `GitHubWorkItem` e `ExistingPullRequest`, enums e serialização de dados. |
| `labels.py` | Parsing das convenções de labels da Issue. |
| `planner.py` | IDs estáveis, tarefas do workflow e função pura `plan_delivery()`. |

`GitHubWorkItem` recebe número, título, corpo, URL, labels, sprint, prioridade,
área, riscos, `needs_decision` e uma Pull Request existente opcional. A Pull
Request tipada inclui número, título, URL e estado.

### Labels reconhecidas

| Convenção | Resultado |
|---|---|
| `sprint:<valor>` | Sprint da classificação. |
| `priority:P0` até `priority:P3` | Prioridade tipada. |
| `area:<valor>` | Área da entrega. |
| `risk:<valor>` | Risco informado. |
| `needs-decision` | Indica bloqueio de implementação. |
| `bug`, `enhancement`, `documentation` | Tipo de trabalho. |

Labels desconhecidas não levantam erro nem mudam o roteamento. Elas são
preservadas em `unknown_labels` para observação pelo adaptador futuro.

### Roteamento determinístico

A precedência é deliberada e fixa:

1. `needs-decision` no modelo ou nas labels cria `decision-packet` e uma tarefa
   `implementation` com estado `blocked`. A implementação depende do pacote
   de decisão; nenhuma implementação duplicada é iniciada antes dela.
2. Uma Pull Request existente com estado `open` cria apenas `validation` e
   `review` após a tarefa raiz. Não cria uma segunda tarefa de implementação.
3. Trabalho normal, incluindo `bug`, `enhancement` e `documentation`, cria a
   cadeia `analysis -> implementation -> tests -> documentation -> review`.

Todo plano contém a tarefa raiz `delivery`. As dependências são IDs de tarefas
e não inferências implícitas. Um ID tem a forma
`issue-<numero>:<task-key>`; assim, a mesma Issue e a mesma chave sempre geram
o mesmo ID.

A tarefa `delivery` usa `execution_mode: "human-gate"`. Ela representa a revisão
humana do plano contextual e não pode ser reivindicada por worker ou agente.
As demais etapas usam `execution_mode: "worker"`. A aprovação explícita da raiz
libera a tarefa `analysis` e as etapas seguintes:

```bat
workflow.bat --approve-plan issue-15:delivery --approval-actor Thiago
```

A aprovação grava uma evidência `human-approval` no Kanban local. O comando não
faz mutation no GitHub, não cria branch e não executa agente.

`DeliveryPlan.to_dict()` produz somente dicionários, listas, strings, números,
booleanos e `null`, prontos para `json.dumps()` e para um futuro adaptador do
Hermes Kanban.

## Não objetivos desta fatia

- Não há endpoint FastAPI, alteração em `backend/main.py` ou banco operacional.
- A leitura opcional do GitHub usa somente `gh api graphql`; não há autenticação
  própria, secret, webhook, criação de Issue/PR ou alteração de GitHub Project.
- Runtimes de agentes são processos locais explícitos; quando configurados, o
  worker pode invocar os CLIs Codex ou Claude no worktree.
- A projeção no Hermes SQLite existe, mas exige um banco já criado pelo gateway.
- Não há resolução automática de decisões bloqueantes, merge, push, deploy ou
  modificação de `coffee_module` e `input_module`.

## Testes

Os testes puros ficam em `backend/test_workflow_module.py` e não usam
credenciais ou rede:

```bash
python -m pytest backend/test_workflow_module.py -q
```

Eles cobrem parsing de labels, IDs determinísticos, o desvio por Pull Request
aberta, bloqueio por decisão e a cadeia normal serializável.

## Segunda fatia: snapshot para grafo do Hermes

O pipeline executável desta fatia é:

```text
data.user.projectV2 (arquivo ou gh api graphql somente leitura)
  -> snapshot.py (Project/Issue/PR normalizados)
  -> planner.py (um DeliveryPlan por Issue)
  -> hermes_graph.py (tarefas ordenadas e JSON-friendly)
  -> stdout (dry-run)
```

Os novos módulos mantêm responsabilidades estreitas:

| Arquivo | Responsabilidade |
|---|---|
| `snapshot.py` | Parsing defensivo do JSON GraphQL e normalização de itens de Project. |
| `hermes_graph.py` | Projeção imutável e determinística dos planos no grafo do Hermes. |
| `github_client.py` | Consulta somente leitura via `gh api graphql`, com runner injetável. |
| `cli.py` | Entrada dry-run por arquivo ou fetch e saída JSON formatada em stdout. |

Valores de `Status`, `Sprint` e `Priority` são indexados pelo nome do campo.
Single-select (`name`), texto (`text`) e iteração (`title`) são aceitos.
Prioridades como `P1 - High` viram `P1`. Itens que não são Issues e valores
opcionais malformados são ignorados. A primeira Pull Request vinculada, aberta
e válida é anexada ao `GitHubWorkItem`, acionando o roteamento já definido no
planner.

### CLI dry-run

Com uma fotografia local:

```bash
cd backend
python -m workflow_module.cli --input SNAPSHOT.json
```

Com leitura de um GitHub Project de usuário:

```bash
cd backend
python -m workflow_module.cli --owner OWNER --project-number 7
```

As duas formas imprimem o mesmo contrato de grafo em JSON. A ordem dos itens é
determinada pelo número da Issue e pelo ID do item; dentro de cada item, as
tarefas preservam a ordem das dependências. Cada tarefa preserva chave, título,
dependências, estado, `execution_mode`, número da Issue, ID e estado do item do
Project, sprint, prioridade, área e riscos.

### Limite não mutável

O único comando externo é `gh api graphql`. A query contém somente campos de
leitura para Project, itens, campos, Issues, labels e Pull Requests vinculadas.
Ela não contém `mutation` e o CLI não executa `gh issue`, `gh pr` ou comandos de
edição de Project. Owner e número são variáveis da query, nunca secrets.
`snapshot.py`, `planner.py` e `hermes_graph.py` não fazem chamadas de rede.

Continuam fora de escopo: webhooks, autenticação própria, mutations no GitHub,
execução de agentes remotos, merge, push e deploy. Não há endpoint FastAPI nem
alteração de banco operacional nesta fatia.

## Terceira fatia: Kanban local persistente

`kanban_store.py` torna o grafo operável como uma fila local. O launcher gera o
grafo, sincroniza `.helios/kanban.json`, grava `delivery-graph.json` e continua
imprimindo o grafo em stdout. A sincronização usa o ID estável da tarefa;
executar o mesmo grafo outra vez não duplica registros.

### Execução no Windows e no Git Bash

Depois de abrir o terminal na raiz do repositório:

```bat
workflow.bat
```

No Git Bash:

```bash
./workflow.sh
```

Os dois launchers resolvem a raiz do repositório, adicionam `backend` ao
`PYTHONPATH` e encaminham argumentos adicionais. `HELIOS_GITHUB_OWNER` recebe
`Pottassiuw` e `HELIOS_PROJECT_NUMBER` recebe `2` somente quando a variável
correspondente não está definida.

Para consultar outro Project:

```bat
set "HELIOS_GITHUB_OWNER=outro-owner"
set "HELIOS_PROJECT_NUMBER=7"
workflow.bat
```

```bash
HELIOS_GITHUB_OWNER=outro-owner HELIOS_PROJECT_NUMBER=7 ./workflow.sh
```

Para consultar as tarefas prontas sem acessar o GitHub:

```bat
set "PYTHONPATH=%CD%\backend"
python -m workflow_module.cli --ready --store "%CD%\.helios\kanban.json"
```

No Git Bash:

```bash
PYTHONPATH="$PWD/backend" python -m workflow_module.cli \
  --ready --store "$PWD/.helios/kanban.json"
```

### Esquema e estados

O arquivo usa JSON com `version: 1` e um objeto `tasks` indexado pelo ID estável.
Cada tarefa guarda os metadados do grafo, `planned_status`, `state`,
`execution_mode`, `depends_on`, `claim` e `evidence`. Uma nova tarefa começa no
estado planejado.
Sincronizações posteriores atualizam metadados e dependências, preservando
estado, claim e evidências existentes.

| Estado | Semântica local |
|---|---|
| `ready` | Está desbloqueada; gates humanos aguardam aprovação e tarefas worker podem ser reivindicadas. |
| `pending` | Aguarda dependências; muda para `ready` quando elas terminam. |
| `blocked` | Exige mudança no grafo ou decisão externa; não é reivindicada. |
| `claimed` | Pertence ao agente identificado em `claim.agent_id`. |
| `done` | Terminou e não pode ser reivindicada novamente. |
| `failed` | Estado terminal reservado para falha registrada. |

`claim()` exige uma tarefa pronta ou pendente com todas as dependências em
`done`. `complete()` e `release()` aceitam somente o agente que detém o claim.
Uma conclusão grava `done`; uma liberação volta para `ready` ou `pending`,
conforme as dependências. Evidências e motivos vazios não são gravados.

As escritas usam um arquivo temporário no mesmo diretório e `os.replace()`. Um
lock curto criado com `O_CREAT|O_EXCL` impede duas mutações simultâneas. Quando o
lock já existe, a operação informa que o store está ocupado e orienta a tentar
novamente.

### Aprovação humana e ordenação segura

`--ready` lista tarefas desbloqueadas, incluindo gates humanos, sem executar
nada. O resultado é ordenado por prioridade (`P0` antes de `P1`, `P2` e `P3`),
severidade de risco (`security`, `data-integrity`, `external-api`, `release`) e
ID determinístico. Isso evita que a escolha dependa apenas da ordem alfabética
do ID.

O dispatcher filtra `human-gate` antes de seleção de agente, claim, worktree ou
subprocesso. Assim, um `--dispatch-once` em um Project recém-sincronizado não
entrega automaticamente uma Issue inteira a Codex/Claude; ele aguarda a
aprovação explícita do plano:

```bat
workflow.bat --ready
workflow.bat --approve-plan issue-15:delivery --approval-actor Thiago
workflow.bat --dispatch-once --max-tasks 1
```

Somente depois da aprovação a etapa `analysis` aparece como worker-ready.

### Limite seguro e não objetivos

O launcher consulta o GitHub somente com a query GraphQL de leitura já
documentada. A sincronização grava `.helios/kanban.json` e
`delivery-graph.json`, ambos ignorados pelo Git. Com `--hermes-db`, também
projeta explicitamente no SQLite local do Hermes; sem essa opção, nenhum board
externo é tocado.

## Reconciliação de progresso

O grafo de execução e o GitHub Project são sinais diferentes. Uma branch não
prova que existe Pull Request, um PR aberto não prova que o CI passou e o
estado `Done` do Project não substitui a evidência do SHA entregue. Para
acompanhar os lotes já existentes, o launcher oferece um relatório read-only:

```bat
workflow.bat --progress
```

No Git Bash:

```bash
./workflow.sh --progress
```

O comando reconcilia, por Issue:

```text
Project Batch/status
  + tarefas e evidências do .helios/kanban.json
  + branches feat/sprint1-<issue>
  + PRs abertas, fechadas ou merged
  + estado agregado do CI
```

A saída JSON contém `project_status`, `batch`, `kanban`, `branches`,
`pull_requests`, `evidence`, `assessment` e `next_action`. A avaliação não
promove silenciosamente um sinal isolado a entrega:

| Assessment | Significado |
|---|---|
| `done` | Há PR merged e o Project está `Done`/`Closed`. |
| `in-progress` | Há PR aberta; revisão e CI ainda precisam ser acompanhados. |
| `branch-only` | Há branch identificada, mas não há PR correspondente. |
| `blocked` | O Project está bloqueado sem branch ou PR. |
| `divergent` | Project, PR e/ou Kanban discordam sobre o estado. |
| `not-started` | Não há evidência de branch ou PR para o item. |

O relatório consulta `gh pr list` e `gh pr view` apenas para leitura. Não
publica comentários, move Issues, altera campos do Project, cria PR, faz push,
merge ou deploy. Se o Project disser `Done` sem PR merged, o resultado é
`divergent`, exigindo reconciliação humana.

## Quarta fatia: worker local seguro

O pacote agora também possui um worker local com registry de capacidades:

```text
ready task
  → política de risco
  → seleção de AgentSpec
  → claim
  → worktree isolado
  → comando explícito
  → evidências
  → done ou failed
```

O modo padrão é dry-run e não altera o store:

```bash
./workflow.sh --run-ready
```

No Windows:

```bat
workflow.bat --run-ready
```

Para executar de fato, é obrigatório informar o comando e a raiz dos worktrees:

```bash
./workflow.sh --run-ready \
  --execute \
  --command "python -m pytest" \
  --worktree-root .helios/worktrees
```

O worker processa uma tarefa por vez por padrão. Para limitar explicitamente:

```bash
./workflow.sh --run-ready --max-tasks 2
```

A execução real:

- exige `--store`, `--command` e `--worktree-root`;
- não aceita tarefas bloqueadas;
- recusa riscos por padrão;
- aceita riscos somente com `--allow-risks`;
- preserva o worktree para revisão;
- registra stdout, stderr, exit code, comando e caminho do worktree;
- marca `done` em exit code `0`;
- marca `failed` em qualquer exit code diferente de `0` ou exceção;
- não abre PR, não faz push, não faz merge e não altera GitHub.

A seleção de agente ainda é local e declarativa. Cada `AgentSpec` funciona como
um perfil com o seguinte contrato:

| Campo | Contrato |
|---|---|
| `agent_id` | Identificador único no `AgentRegistry`. |
| `task_keys` | Chaves de tarefa aceitas; `"*"` continua disponível como capacidade explícita. |
| `command_prefix` | Prefixo permitido como tupla de argumentos, por exemplo `("python", "-m", "pytest")`. |
| `allow_any_command` | Escape hatch explícito usado apenas pelo perfil local compatível do CLI. |
| `runtime` | `local`, `codex` ou `claude`; o padrão retrocompatível é `local`. |
| `timeout_seconds` | Limite positivo do subprocesso externo; padrão de 900 segundos. |
| `max_turns` | Limite positivo enviado ao Claude; padrão de 20 turnos. |

O prefixo é comparado depois de separar o comando em argumentos. Portanto,
`python -m pytest backend/test_worker.py` corresponde ao prefixo do exemplo,
mas `python -m pytestevil` e `git push` não correspondem. Perfis novos não
aceitam nenhum comando quando `command_prefix` está vazio; eles precisam
declarar um prefixo seguro. `command_prefix` e `allow_any_command=True` são
mutuamente exclusivos. `allow_any_command` também é exclusivo do runtime local.

Antes de executar, o worker valida risco, capacidade da tarefa e comando. Um
agente não registrado ou um comando fora do perfil produz `AgentPolicyError` e
é reportado como `rejected` antes de claim, criação de worktree ou subprocesso.
Dry-runs continuam selecionando pela capacidade sem exigir comando executável.

Para preservar o contrato atual do CLI, o perfil embutido `local-agent` mantém
capacidade curinga e `allow_any_command=True`. Essa permissão é uma exceção
local explícita; agentes especializados registrados são deny-by-default e
devem informar seu `command_prefix`.

Perfis especializados são carregados com `--agent-profile PATH` nos modos
`--run-ready`, `--dispatch-once` e `--dispatch`. O arquivo contém exatamente um
objeto JSON neste formato:

```json
{
  "agent_id": "test-agent",
  "task_keys": ["tests", "review"],
  "command_prefix": ["python", "-m", "pytest"],
  "allow_any_command": false,
  "runtime": "local"
}
```

`agent_id` é uma string não vazia e `task_keys` é uma lista não vazia de
strings não vazias. `command_prefix` é obrigatório e não vazio para runtimes
`codex` e `claude`; no runtime local ele é opcional. Quando presente, deve ser
uma lista de argumentos sem itens vazios. `allow_any_command` é opcional e
aceita somente booleano; o padrão é `false`. Campos desconhecidos, valores
duplicados, JSON inválido e a combinação de `command_prefix` com
`allow_any_command: true` são rejeitados.

### Runtimes Codex e Claude

Perfis externos podem omitir `--command`: com `--execute`, o adapter monta um
prompt determinístico a partir de ID, chave, título e dependências da tarefa.
Cada `HermesTask` também preserva o título, o corpo e a URL da Issue de origem.
Esse contexto é incluído no brief delimitado como material de referência não
confiável; ele não pode substituir as regras de segurança do Helios. O corpo é
limitado determinísticamente a 12.000 caracteres Unicode e recebe um marcador
explícito quando é truncado.

Os títulos das etapas também são contextuais — por exemplo, `Implement: <título
da Issue>` — e cada etapa possui uma descrição determinística do seu papel
(análise, implementação, testes, documentação ou revisão). A chave da tarefa e
suas dependências permanecem estáveis, então a melhoria não recria o histórico
do Kanban.

O prompt restringe o trabalho ao worktree e proíbe explicitamente commit, push,
merge, deploy e qualquer mutation externa.

Imediatamente antes de iniciar Codex ou Claude, o worker grava esse prompt
completo em `HELIOS_TASK.md` na raiz do worktree. O arquivo instrui o agente a
implementar a tarefa, editar o worktree e executar as verificações relevantes.
A remoção ocorre em um bloco `finally`, inclusive após timeout, exceção ou exit
code não zero, para que o brief temporário não entre no diff nem vaze para uma
Pull Request. O worker não sobrescreve um arquivo de mesmo nome já presente.

Os dois CLIs recebem somente uma instrução curta de uma linha para ler
`HELIOS_TASK.md`. Isso evita perder corpo multilinha no transporte de argumentos
por shims Windows como `codex.cmd`.

```json
{
  "agent_id": "codex-builder",
  "task_keys": ["implementation", "tests"],
  "runtime": "codex",
  "command_prefix": ["codex", "exec"],
  "timeout_seconds": 900
}
```

O Codex usa `codex exec --sandbox workspace-write --ephemeral` com os flags
headless `--ignore-user-config --ignore-rules` e a instrução curta para ler o
brief. O corpo da Issue não é colocado na linha de comando.

```json
{
  "agent_id": "claude-reviewer",
  "task_keys": ["review"],
  "runtime": "claude",
  "command_prefix": ["claude", "-p"],
  "timeout_seconds": 900,
  "max_turns": 20
}
```

O Claude usa
`claude -p INSTRUCAO_CURTA --max-turns 20 --no-session-persistence`. Nenhum
adapter usa flags de bypass de segurança.

Para ambos os runtimes, `--worktree-root` continua obrigatório. Um `--command`
explícito substitui o comando gerado, mas precisa corresponder ao
`command_prefix` do perfil. O comando gerado pelo adapter passa pela mesma
validação antes do claim. Prefixo incompatível ou prompt malformado produz
`rejected` com evidência sem criar worktree. Comandos aceitos ainda executam com
`timeout_seconds`. Timeout,
exceção ou exit code diferente de zero grava evidência, marca a tarefa como
`failed` e libera o claim. O runtime `local` preserva o contrato anterior e
continua exigindo `--command` em execução real.

A evidência de uma execução externa inclui `task_brief.path` e
`task_brief.removed`. O segundo campo é calculado depois da tentativa de limpeza;
ele só é `true` quando `HELIOS_TASK.md` já não existe. Execuções locais conservam
o formato anterior e não criam nem registram task brief.

No Windows, o runner externo resolve somente o primeiro argumento pelo `PATH`
antes de criar o subprocesso. Assim, um comando lógico como `codex` pode usar
`codex.cmd` (e `claude`, `claude.exe`) sem `shell=True`; a evidência continua
registrando o comando lógico canônico gerado ou informado pelo operador.

O operador precisa instalar e autenticar/configurar o CLI escolhido antes de
executar o workflow. O Helios não instala esses CLIs, não armazena credenciais e
não realiza mutations no GitHub, Telegram ou SAP. Também não cria commit, PR,
push, merge ou deploy.

```bash
./workflow.sh --run-ready --execute \
  --agent-profile .helios/agents/codex-builder.json \
  --worktree-root .helios/worktrees
```

```bash
./workflow.sh --run-ready \
  --agent-profile .helios/agents/test-agent.json
```

Sem `--agent-profile`, somente o perfil compatível `local-agent` é criado com
`task_keys: ["*"]` e `allow_any_command: true`. `--agent-id local-agent` ainda é
aceito por compatibilidade. Qualquer outro `--agent-id` é rejeitado: agentes
não locais devem vir do arquivo de perfil. `--agent-id` e `--agent-profile` são
mutuamente exclusivos.

### Dispatcher persistente

O dispatcher adiciona reclaim de leases expirados antes de cada rodada. Uma
rodada única pode ser executada sem loop:

```bash
./workflow.sh --dispatch-once --store .helios/kanban.json
```

Para execução contínua, o intervalo é explícito. `--max-cycles` é opcional e
serve para automação/testes; sem ele, o processo continua até `Ctrl+C`:

```bash
./workflow.sh --dispatch \
  --store .helios/kanban.json \
  --interval-seconds 30 \
  --execute \
  --command "python -m pytest" \
  --worktree-root .helios/worktrees
```

O modo contínuo emite um objeto JSON por ciclo (JSONL), preserva os mesmos
limites do worker e não faz retry automático de tarefas `failed`.

### Limites atuais

Ainda permanecem fora de escopo: API HTTP para o store, abertura de PR e
mutations no GitHub, comentários/merge/push, Telegram, deploy, SAP e alterações
no banco operacional. Status de PR/CI já existe em modo read-only.

## Quinta fatia: status de PR e gates read-only

O módulo `github_delivery` consulta uma PR sem mutations usando:

```bash
PYTHONPATH=backend python -m workflow_module.cli \
  --repo Pottassiuw/EDP-Helios \
  --pull-request 51
```

O relatório normaliza estado da PR, draft, decisão de revisão, mergeability e
checks. O campo `merge_ready` só fica verdadeiro quando todos os gates passam:

- PR aberta;
- PR não é draft;
- revisão `APPROVED`;
- todos os checks concluídos com `SUCCESS`, `NEUTRAL` ou `SKIPPED`;
- `--human-approval` informado explicitamente.

Sem aprovação humana, mesmo uma PR com CI e revisão aprovados permanece bloqueada:

```bash
PYTHONPATH=backend python -m workflow_module.cli \
  --repo Pottassiuw/EDP-Helios \
  --pull-request 51 \
  --human-approval
```

Essa etapa não executa merge, push, comentário ou qualquer mutation. Ela produz
somente um relatório JSON auditável e transforma falhas de `gh` em mensagens
acionáveis. O worker usa leases, retries e recuperação de claims expirados; a abertura de PR,
CI e Telegram permanecem gates externos explícitos.

## Hermes SQLite real

Quando o gateway Hermes já estiver configurado, a mesma sincronização pode
projetar o grafo no board SQLite real:

```bash
PYTHONPATH=backend python -m workflow_module.cli \
  --input snapshot.json \
  --store .helios/kanban.json \
  --hermes-db "$HOME/.hermes/kanban.db"
```

O adaptador usa o schema do template (`tasks`, `task_links`, `task_events`),
preserva estados runtime `running`/`done`, grava IDs determinísticos e
transforma dependências em parent links. Ele não cria o banco nem o schema; se
o arquivo não existir, falha explicitamente. A sincronização é idempotente e
registra eventos de criação ou atualização.

## Sexta fatia: leases e retomada

Claims agora carregam `claimed_at` e `expires_at`. O worker usa lease padrão de
15 minutos; a duração pode ser ajustada explicitamente:

```bash
./workflow.sh --run-ready --execute \
  --lease-seconds 1800 \
  --command "python -m pytest" \
  --worktree-root .helios/worktrees
```

Um lease expirado não é liberado silenciosamente. A recuperação é uma operação
explícita e grava evidência `lease-expired`:

```bash
./workflow.sh --reclaim-expired
```

Claims ainda válidos não são tocados. Tarefas recuperadas retornam a `ready` ou
`pending`, conforme suas dependências. Isso permite retry manual ou reexecução
de worker sem duplicar a tarefa enquanto o agente original estiver ativo.

Falhas ficam em estado `failed` até uma decisão explícita de retry:

```bash
./workflow.sh --retry issue-42:implementation
```

O retry registra uma evidência `retry` e retorna a tarefa a `ready` ou `pending`.
Não há retry automático, para evitar loops silenciosos em tarefas com risco.
