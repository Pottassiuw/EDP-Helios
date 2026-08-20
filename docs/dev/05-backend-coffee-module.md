# Backend: coffee_module

## O que faz

`backend/coffee_module/` integra o backend com o sistema externo COFFEE
(que por sua vez fala com o SAP) para gerar notas reais, consultar seu
status e corrigir dados como o local de instalação. As buscas e gerações
em lote rodam como jobs em background (thread + polling), e cada nota
consultada é classificada localmente (`nao_gerada` / `pendente` /
`corrigida` / `gerada`) a partir do histórico de `id_sap` salvo em SQLite.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `backend/coffee_module/client.py` | Cliente HTTP (httpx) para a API externa COFFEE: busca de nota e as 3 escritas (`sap`, `desarquivar`, `local_instalacao`), com logging de cada chamada. |
| `backend/coffee_module/jobs.py` | Workers em threads com snapshots persistidos de consulta, geração e atualização SAP. |
| `backend/coffee_module/classify.py` | Função pura `classificar()` que deriva o status de uma nota (`nao_gerada`/`pendente`/`corrigida`/`gerada`) a partir de `id_sap` atual, anterior e origem. |
| `backend/coffee_module/db.py` | Persistência local em SQLite (`coffee.db`): notas, logs, snapshots de jobs e fila operacional. |
| `backend/coffee_module/exportacao.py` | Gera a planilha XLSX de notas concluídas a partir do espelho local filtrado. |
| `backend/coffee_module/routes.py` | Router FastAPI `/api/coffee/*`: expõe Operação, Concluídas, local, arquivamento, triagem e logs. |
| `backend/coffee_module/config.py` | Configuração: chave da API COFFEE, URL base, diretório de dados, delays entre chamadas e os sentinels de `id_sap` `SAP_PENDENTE` (`10000000`) e `SAP_DUPLICATA` (`99999999`). |
| `backend/coffee_module/alimentadores.py` | Lookup estático de alimentadores (`data/alimentadores.csv`, 1199 linhas `id`/`cidade`), carregado 1x e cacheado (`functools.lru_cache`). |

## client.py — integração externa

Todas as chamadas usam `httpx` síncrono contra `config.base_url()`
(`https://coffee.edp.gpti.com.br/api/{COFFEE_API_KEY}/deolhonarede`), com
timeout de 120s, e cada chamada é logada em `coffee_logs` via
`db.registrar_log("api_call", ...)`, sucesso ou falha.

A verificação TLS é controlada por `config.ssl_verify()` (env
`COFFEE_SSL_VERIFY`) e passada como `verify=` em toda chamada `httpx`. A
rede corporativa injeta um CA raiz auto-assinado na cadeia, que o bundle
público rejeita (`CERTIFICATE_VERIFY_FAILED`); por isso o padrão é
`"false"` (verificação desligada, host interno da EDP). Aceita também
`"true"` (bundle padrão) ou o caminho de um CA bundle `.pem` — recomendado
em produção. Sem essa configuração, toda `buscar_nota` falha no handshake
e a rota `/marcar-gerar` responde 502 "Nao foi possivel buscar a nota".

- `buscar_nota(id)` (`client.py:41`) — `GET json_all/{id}`. A API COFFEE
  devolve uma string JSON duplamente codificada (`json.loads` sobre o
  corpo já decodificado pelo `httpx`), de onde é extraído o primeiro
  registro (`bruto[0]`). Para um id inexistente a API responde 200 com
  lista vazia; nesse caso `buscar_nota` levanta
  `NotaNaoEncontradaErro` (`client.py:12`), que as rotas `/consultar` e
  `/marcar-gerar` convertem em 404 (qualquer outra exceção vira 502).
  Retorna um dict com `pk`, `id_sap`, `arquivado`, `local_instalacao`
  (montado por `compor_local_instalacao`) e os `fields` brutos.
  A rota síncrona `GET /api/coffee/consultar/{id}` é somente leitura para a
  busca sob demanda de duplicatas: ela não faz `upsert` em `notas_coffee`,
  mas calcula `classificacao` a partir do estado local já existente. Além de
  `poste`/`referencia`, projeta `problema` (junção não vazia de
  `componente`/`componente_novo`, `sintoma`, `causa`) e `observacao`
  (`observacao` ou `observacoes`). A ausência de `fields` ou desses aliases
  produz `null`, não erro nem escrita.
- `compor_local_instalacao(fields)` (`client.py:25`) — a API não devolve
  um campo pronto de local de instalação: ele é montado a partir de
  `cidade` (3 dígitos, zero-padded) + `tipo_local_instalacao` (2 letras) +
  `local_instalacao_numero` (8 dígitos, zero-padded). Retorna `None` se
  faltar qualquer componente.
- `definir_sap(id, sap)` (`client.py:89`) — `GET sap/{id}/{sap}`, atribui
  (ou reseta, com `SAP_PENDENTE`) o campo `id_sap` da nota no COFFEE.
- `desarquivar(id)` (`client.py:93`) — `GET desarquivar/{id}`.
- `alterar_local(id, local)` (`client.py:97`) — `GET
  local_instalacao/{id}/{local}`.
- `alterar_alimentador(id, alimentador)` — `GET alimentador/{id}/{alimentador}`.

As três escritas (`definir_sap`, `desarquivar`, `alterar_local`)
compartilham o helper interno `_get_logado()` (`client.py:72`), que faz o
GET, loga e propaga a exceção em caso de erro — não há retry.

## jobs.py — geração em background

Jobs continuam executando em threads do processo, mas o snapshot de cada
operação agora é persistido no SQLite e identificado por `job_id` (`uuid4().hex`).
`iniciar_consulta_operacao()`, `iniciar_geracao_operacao()` e
`iniciar_atualizacao_sap()` alimentam a página Operação; os caminhos antigos
`iniciar_busca()`, `iniciar_geracao()` e `iniciar_correcao_local()` são
mantidos para compatibilidade de API. Cada atualização grava estado, total,
progresso, erros e resultados. Na inicialização, operações que ficaram
`rodando` são interrompidas e seus cards em processamento retornam à etapa
recuperável.

### Paralelismo limitado (`_rodar_em_paralelo`)

`iniciar_consulta_operacao()`, `iniciar_geracao_operacao()` e
`iniciar_atualizacao_sap()` processam suas notas por `_rodar_em_paralelo()`
(`jobs.py`), um `ThreadPoolExecutor(max_workers=config.MAX_WORKERS)` — antes
era estritamente sequencial (1 nota por vez). Com fila grande, sequencial não
escalava: cada nota que precisa gerar faz até 3 chamadas HTTP bloqueantes
pra API COFFEE (`buscar_nota` → `definir_sap` → `desarquivar` → `buscar_nota`
de novo), e uma nota lenta/travada prendia **todo o resto atrás dela** no
mesmo job. `COFFEE_MAX_WORKERS` (padrão 4) e `COFFEE_TIMEOUT` (padrão 30s,
era 120s fixo — cortando o pior caso de ~360s pra ~90s numa nota-problema)
são configuráveis por env var.

Cada `processar_um(ident)` passado pro helper trata seu próprio erro de
domínio (`aplicar_falha` com a etapa de retorno certa pro fluxo) e relança a
exceção — `_rodar_em_paralelo` só cuida da contabilização (`feitas`/`erros`)
de forma segura entre threads via `_LOCK` (sem essa proteção, incrementos
concorrentes em `snapshot["feitas"]` se perdem). O ganho real de throughput
é menor que o teórico 4×: `operation_service.aplicar_consulta`/
`_executar_geracao` abrem várias conexões SQLite por nota (cada
`get_db_connection()` é `sqlite3.connect()` novo, sem pool), e escritas
concorrentes no mesmo arquivo SQLite serializam parcialmente — throughput
melhor ainda depende de reduzir esse número de round-trips por nota, não
feito aqui (fora de escopo desta rodada).

O `X-User` é capturado na rota e passado explicitamente a todos esses jobs.
No início de cada thread (e de cada tarefa do pool, que roda em thread
própria), o job chama `db.definir_usuario(usuario)`: uma
`ContextVar` definida na requisição não atravessa `threading.Thread`. Assim,
os logs assíncronos de consulta, geração, atualização SAP e correção de local
mantêm o usuário informado, em vez do fallback do usuário da máquina. O
`trace_id` segue o mesmo padrão de propagação explícita.

A regra central de `_rodar_geracao()` (`jobs.py:70-110`) é: **o COFFEE só
processa notas desarquivadas** — ele atribui o SAP real e arquiva sozinho
ao concluir. Por isso, forçar a geração sempre chama `client.definir_sap(id,
config.SAP_PENDENTE)` **e** `client.desarquivar(id)` juntos
(`jobs.py:97-98`), nunca só um dos dois — mandar só o SAP placeholder sem
desarquivar deixaria a nota arquivada e o COFFEE nunca a pegaria. Notas já
com SAP real (arquivadas ou não) são puladas em vez de re-geradas. Detalhe
completo da regra, das exceções e do histórico do bug de classificação
associado (nota 356322) em
[`docs/coffee/fluxo-transicao-notas.md`](../coffee/fluxo-transicao-notas.md).

As rotas de Operação retornam o `job_id` imediatamente. O frontend recebe os
snapshots ativos junto de `GET /api/coffee/operacao` e atualiza o quadro a cada
800 ms enquanto houver trabalho. `GET /api/coffee/job/{job_id}` continua
disponível para consulta direta e compatibilidade. Com `gerar_apos=true` na
correção de local, o job encadeia a geração apenas para os locais corrigidos,
seguindo a mesma regra de `_rodar_geracao` (placeholder + desarquivamento para
SAP ausente ou `SAP_PENDENTE`; pula notas com SAP real).

## classify.py

`classificar(id_sap_atual, id_sap_anterior, origem=None)` (`classify.py:5`)
é uma função pura que deriva o status local da nota a partir de três
valores: sem `id_sap` → `nao_gerada`; `id_sap == SAP_DUPLICATA` →
`duplicada` (checado antes de `SAP_PENDENTE`, senão o sentinel de duplicata
cairia no ramo de SAP real e viraria `corrigida`/`gerada` por engano);
`id_sap == SAP_PENDENTE` → `pendente`; transição de `SAP_PENDENTE` para um
SAP real → `gerada` (se `origem == "avulsa"`) ou `corrigida` (origem
desconhecida/`"verificar"`, mantido por compatibilidade retroativa);
qualquer outro caso → `gerada`. O campo `arquivado` **não** entra nessa
classificação — é tratado à parte (ver `db.py`). `origem` é o que distingue
geração avulsa (via COFFEE, fila "a gerar") de correção de erro vinda da
triagem Verificar.

### Marcar duplicata (consumidor: Verificar)

`backend/main.py: mark_duplicata()`/`desfazer_duplicata()` (rotas
`POST /api/duplicata/{note_id}` e `POST /api/duplicata/{note_id}/desfazer`,
fora do router `coffee_module`, mas reusando suas funções) marcam uma nota da
triagem Verificar como duplicata reaproveitando o mecanismo real de SAP: como
`SAP_PENDENTE`, o sentinel `SAP_DUPLICATA` é escrito **ao vivo** via
`client.definir_sap`, não é um campo local isolado. Marcar também arquiva
localmente (`db.arquivar_nota`) e limpa qualquer item pendente de geração
(`remover_item_operacao` + `marcar_gerar(False)`); desfazer restaura
`SAP_PENDENTE` ao vivo e desarquiva localmente (`db.desarquivar_nota()`,
espelho de `arquivar_nota()`). Justificativa é opcional e só alimenta
`registrar_log`, diferente de `POST /arquivar` (que a exige).

## db.py

SQLite local em `config.data_dir() / "coffee.db"` (WAL habilitado), com
tabelas criadas/migradas em `inicializar_banco()`. O `journal_mode=WAL` é
negociado somente nessa inicialização (modo persistido no arquivo); cada nova
conexão apenas habilita `foreign_keys`, usa `synchronous=NORMAL` e recebe
`busy_timeout=5000`. Isso evita que jobs concorrentes disputem um lock
exclusivo ao renegociar WAL. As operações do módulo mantêm conexões curtas:
executam, fazem `commit` e fecham a conexão antes de retornar.

- **`notas_coffee`** — uma linha por `pk` de nota, com `id_sap`,
  `id_sap_anterior` (snapshot para a classificação), `arquivado`,
  `classificacao`, `dados_json` (fields brutos), `a_gerar` (flag da fila),
  `origem` (`"avulsa"` | `"verificar"` | `NULL`), `classificacao_em` e a
  rastreabilidade da triagem: `verificar_id` (não assume que o ID da fonte é o
  PK COFFEE), `verificar_ativa`, `verificar_em`/`verificar_por`, o último
  encaminhamento `encaminhada_em`/`encaminhada_por`, o retorno justificado da
  Operação (`retornada_em`/`retornada_por`/`retorno_justificativa`) e
  `corrigida_em`/`corrigida_por`. `resumo_triagem_verificar()` cruza essa
  origem com a fila operacional para expor encaminhadas, falhas operacionais,
  retornadas e o total diário separado por usuário. Os timestamps são preservados entre
  re-buscas que não mudam a classe.
- **`coffee_logs`** — log de auditoria (`api_call` / `acao_usuario` /
  `transicao`), com `usuario` (best-effort via `getpass.getuser()`, nunca
  levanta) e `trace_id` (correlaciona um lote e suas chamadas filhas,
  setado via `contextvars` em `definir_trace()`/`trace_atual()`).
- **`coffee_operacoes`** — snapshots persistidos dos jobs, incluindo estado,
  progresso, erro e resultado.
- **`coffee_fila_operacao`** — cards da fila com entrada original, PK
  resolvida, etapa, origem, job associado e erro recuperável.

O startup do FastAPI chama `inicializar_banco()` antes de atender a triagem,
para que `GET /api/data` sempre encontre o schema de rastreabilidade mesmo se
nenhuma rota `/api/coffee/*` tiver sido acessada nesta execução.

`upsert_nota()` é o ponto único de escrita de notas: lê o
`id_sap`/`classificacao`/`origem` anteriores, chama `classify.classificar()`
e grava, registrando uma entrada `transicao` em `coffee_logs` quando a
classificação muda. Na transição para `corrigida`, fixa também o usuário e o
horário da conclusão; a rota `/marcar-gerar` fixa o vínculo e o usuário de
entrada da triagem. Nota: `arquivado` é intencionalmente **excluído** do
upsert (comentário `ponytail`, `db.py:103-104`) — representa uma ação do
usuário no app (via `arquivar_nota()`), não o estado do COFFEE, que arquiva
como parte do seu próprio workflow normal ao gerar.

`obter_nota(pk)` (`db.py:188`) — leitura passiva de uma nota única por
primary key, retorna um dict com a mesma forma de `listar_notas` (todos os
campos em `_COLUNAS`, `dados_json` parseado, booleans coercidos), ou `None`
se a nota não existe **ou está arquivada localmente** — mesmo filtro
`(arquivado IS NULL OR arquivado = 0)` de `listar_notas`, para que uma nota
que o usuário arquivou (ação local, distinta do arquivamento do próprio
COFFEE) não fique acessível para revisão/movimentação por outros módulos.
`integracao_module` consome essa função para revisar e mover notas para o
plano do Input.

## routes.py

Router `/api/coffee` (prefixo). Mapeamento para o frontend
(`02-frontend-coffee.md`):

| Rota | O que faz | Usado por |
|---|---|---|
| `GET /operacao` | Retorna cards, contagens e snapshots dos jobs ativos da fila persistida. | `operacao/use-coffee-operacao.ts` |
| `POST /operacao/consultar` | Cria cards na Fila e inicia consulta em lote. | `operacao/coffee-operacao.tsx` |
| `POST /operacao/consultar-lote` | Consulta somente leitura em lote (não enfileira, não escreve em `notas_coffee` nem `coffee_fila_operacao`) — mesma lógica de `GET /consultar/{id}`, em job. | `operacao/use-consulta-leitura.ts` |
| `POST /operacao/gerar` | Valida cards Prontos, inicia geração e os marca Processando. | `operacao/coffee-operacao.tsx` |
| `POST /operacao/atualizar-sap` | Reconsulta cards Aguardando SAP. | `operacao/coffee-operacao.tsx` |
| `POST /operacao/remover` | Remove cards da operação; exige justificativa. | `operacao/coffee-operacao.tsx` |
| `GET /job/{job_id}` | Consulta um snapshot de job diretamente. | Compatibilidade e diagnóstico. |
| `GET /notas` | Lista notas; `status=concluida` retorna geradas e corrigidas. | `concluidas/concluidas-api.ts` |
| `POST /notas/concluidas/exportar` | Gera XLSX para os PKs concluídos ainda disponíveis ao usuário; a lista vazia/obsoleta retorna 404. | `concluidas/concluidas-api.ts` |
| `GET /consultar/{id}` | Busca síncrona somente leitura: poste, referência física/elétrica separadas, alimentador, problema, observação e `campos` (fields crus do `json_all`, pra ficha completa mostrar tudo sem o backend projetar campo a campo). | Verificar (ficha completa), duplicatas externas. |
| `POST /sap` | Define `id_sap` de uma nota diretamente. | uso interno/manual |
| `POST /desarquivar` | Desarquiva uma nota diretamente. | uso interno/manual |
| `POST /local-instalacao` | Valida 13 caracteres, corrige e reconsulta. Se não existe card operacional, apenas sincroniza a nota local; se já existe, reclassifica sua ficha. Retorna conflito se o COFFEE não confirmar o valor. | Verificar e `components/coffee-nota-inspector.tsx` |
| `GET /alimentadores` | Lista o lookup estático de alimentadores (`alimentadores.py`, CSV carregado 1x). | `alimentador-correction.tsx` (Verificar) |
| `POST /alimentador` | Valida o ID contra o lookup (nunca texto livre), chama `client.alterar_alimentador`, reconsulta e confirma por releitura — mesmo padrão de `/local-instalacao`, sem a integração com card operacional. | `alimentador-correction.tsx` (Verificar) |
| `GET /logs` | Lista logs, filtrável por `nota_pk`/`tipo`/`usuario`/`since`/`limit`. | `coffee-logs.tsx`, inspector |
| `GET /logs/usuarios` | Lista usuários distintos que aparecem nos logs. | `coffee-logs.tsx` |
| `POST /arquivar` | Arquiva uma nota concluída; exige justificativa. | `concluidas/coffee-concluidas.tsx` |
| `POST /marcar-gerar` | Encaminha ou remove uma nota da fila a partir da triagem Verificar. | `App.tsx`/Verificar |
| `POST /buscar`, `POST /regerar`, `POST /gerar-lote` | Rotas compatíveis com o fluxo anterior de jobs. | Integrações legadas/manual. |
| `POST /corrigir-local-lote` | Malha fina: corrige em lote locais de instalação com "9" extra. Body `{itens: [{id, local}], gerar_apos}`; `local` é o proposto (13 chars). Devolve `{job_id}` (polling via `GET /job/{job_id}`). O job confirma o local atual via `buscar_nota` antes de alterar: igual ao proposto → `ja_corrigidas`; diferente de `local+"9"` → `divergentes` (nunca altera); senão `alterar_local` → `corrigidas`. Com `gerar_apos=true`, encadeia a geração (placeholder SAP + desarquivar, mesma sequência do gerar-lote) apenas para os corrigidos — relatório em `geradas`. | futuro frontend malha fina |

Um middleware de trace (não neste arquivo, mas exercitado pelas rotas)
carimba cada requisição com um `trace_id` propagado às chamadas filhas de
`client.py`/`jobs.py`, usado para agrupar logs de um mesmo lote em
`coffee-log-table.tsx`.

## Pontos de atenção

- `coffee_module/routes.py:107-116` — `POST /sap` e `POST /desarquivar`
  chamam `client.definir_sap`/`client.desarquivar` isoladamente, sem
  passar pela regra de "sempre os dois juntos" de `jobs.py`/`regerar`; são
  rotas de uso manual/interno e não têm proteção contra deixar uma nota
  com SAP placeholder mas ainda arquivada.
- `coffee_module/jobs.py:104-106` e `jobs.py:33-37` — uma falha em um ID
  do lote é capturada com `except Exception` e só grava `erros`/
  `registrar_erro`, sem detalhe do tipo de exceção; um erro de
  configuração (ex.: `COFFEE_API_KEY` ausente) afetaria todos os IDs do
  lote da mesma forma que um timeout pontual, sem diferenciação para o
  usuário.
- `coffee_module/config.py:15-17` — a `COFFEE_API_KEY` tem um valor
  hardcoded como default (não só um placeholder), usado sempre que a
  variável de ambiente não está definida.
- `coffee_module/db.py:154-158` — `arquivar_nota()` faz `UPDATE ... SET
  arquivado = 1` sem checar se o `pk` existe; a rota `POST /arquivar`
  cobre isso checando `db.nota_existe()` antes, mas uma chamada direta à
  função pulando essa checagem falha silenciosamente (0 linhas afetadas,
  sem erro).
- `coffee_module/routes.py:14-17` — `_garantir_banco()` inicializa o banco
  sob demanda na primeira requisição de cada rota que precisa dele
  (`_estado["inicializado"]`, estado de módulo), em vez de uma
  inicialização única no startup do FastAPI; rotas que esquecem de chamar
  `_garantir_banco()` (como `/sap` e `/desarquivar`) simplesmente não
  tocam o banco.
- `coffee_module/jobs.py:9-10` — `_JOBS` é um dict em memória do processo,
  sem TTL/limpeza: jobs concluídos ficam acumulando indefinidamente até o
  processo reiniciar.
