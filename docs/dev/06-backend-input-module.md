# Backend: input_module

## O que faz

`backend/input_module/` gerencia o cadastro de notas de engenharia
(DDPM) e as enriquece cruzando três extrações SAP (IW28 status/datas,
IW38 custo de ordens, IW66 medidas realizadas) com bases de apoio
(indicador de continuidade, clientes por conjunto, custos modulares,
sazonalidade, ganhos, históricos). O cadastro em si vive num SQLite
local; as bases de cruzamento também foram migradas para SQLite (ver
"Cache SQLite" abaixo). O resultado consolidado é exposto ao frontend
via `/api/input/*`.

## Perfil de execução: onde o banco de notas vive

O banco de notas é resolvido em `config.caminho_banco_notas()`, nesta ordem:

1. `INPUT_DB_PATH` — override explícito (é também a variável que
   `_rotina_sap_background` passa para o `Sap_Robot.py`);
2. perfil `producao` (`EDP_PERFIL=producao`) — o banco **é** o arquivo
   compartilhado `config.REDE_DB_ORIGEM`; leituras e escritas caem direto
   nele, então notas criadas por outra pessoa aparecem sem nenhuma cópia;
3. perfil `local` (padrão) — `backend/data/notas_departamento.db`, com a
   migração de primeira execução copiando o banco da rede.

| Variável | Efeito |
|---|---|
| `EDP_PERFIL` | `local` (padrão) ou `producao`. |
| `INPUT_REDE_RAIZ` | Raiz do compartilhamento; todos os `config.CAMINHO_*` derivam dela. |
| `INPUT_DB_PATH` | Caminho absoluto do banco de notas; vence o perfil. |
| `INPUT_MIGRAR_STATUS_OBRA` | Sem efeito: o perfil de produção retorna antes de qualquer DDL/DML de esquema. Para aplicar a migração de propósito no banco compartilhado, rode uma vez com `EDP_PERFIL=local` + `INPUT_DB_PATH` apontando para ele. |

## Quem mais escreve no banco compartilhado

O arquivo da rede **não é exclusivo deste backend**. O `log_arquivos` dele
registra escritas do robô SAP (`Usuario = "robo-sap"`, ação `Sync SAP`), que
grava as tabelas `base_iw28`/`base_iw38`/`base_iw66` diretamente lá — foi o
robô, não este app, que levou o arquivo de ~14 MB para ~59 MB. O app legado
(origem do porte) também escreve no mesmo arquivo.

Consequência prática: **não faz sentido manter uma cópia local das bases do
SAP para "proteger" o banco da rede**. Elas já vivem lá e são atualizadas pelo
robô; ler de uma cópia local reintroduziria exatamente a defasagem que o
perfil de produção existe para eliminar. Por isso há uma conexão só
(`db.get_db_connection()`) e todas as tabelas seguem o perfil ativo.

**O esquema da rede é somente-leitura para este app.** Em `producao`,
`db.inicializar_banco()` chama apenas `_conferir_esquema_compartilhado()`, que
*inspeciona* e registra o que falta. Nenhum `CREATE TABLE`/`ALTER TABLE` é
aplicado no arquivo do setor — alterar o esquema de todo mundo não pode ser
efeito colateral de um restart. Como consequência, `salvar_em_massa()` filtra
as colunas do upsert pelo `PRAGMA table_info(notas)` real: colunas que este app
usa mas que porventura não existam lá simplesmente não são gravadas.

**Undo é por usuário.** Com o banco compartilhado, `reverter_ultima_alteracao`
recebe o usuário e filtra o log por ele — sem isso o botão "Reverter Última
Alteração" de uma pessoa desfaria o trabalho de outra, já que o agrupamento é
por `MAX(Data_Hora)`. Além disso, cada campo só é revertido se ainda tiver o
valor que *aquele* usuário gravou; se alguém editou depois, o campo é pulado e
contabilizado como sobrescrito na mensagem de retorno.

**Bloqueios por nota (edição concorrente).** A tabela `bloqueios` já existia
no schema real do banco da rede (legado, nunca portada por falta de uso) —
`Numero_Nota` PK, `Usuario`, `Data_Hora`. Ela agora trava a edição inline:

- `db.travar_nota(numero, usuario)` reivindica a edição. Se a nota já está
  travada por OUTRO usuário e o lock não expirou, devolve `{"ok": False,
  "usuario": ..., "desde": ...}` em vez de lançar erro — mesmo padrão de
  `reverter_ultima_alteracao` (conflito no corpo da resposta, não em HTTP 409).
  Se o lock já é do próprio usuário, é um upsert que renova o `Data_Hora`.
- **Sem heartbeat dedicado.** Cada clique numa célula de uma nota já travada
  pelo mesmo usuário chama `travar_nota` de novo, renovando o TTL
  (`BLOQUEIO_TTL_MINUTOS = 20`) como efeito colateral. Se o usuário fecha a
  aba no meio de uma edição, o lock expira sozinho — não existe liberação
  automática no fechamento da aba, só o TTL.
- `db.destravar_notas(numeros, usuario)` só apaga locks que pertencem a
  `usuario` — um release tardio (TTL já expirou, outra pessoa já travou a
  mesma nota) nunca derruba o lock de quem assumiu o lugar.
- **Defesa em profundidade**, não só sinalização de UI: `aplicar_edicoes` e
  `deletar_notas` conferem o lock de novo no momento da escrita e pulam
  qualquer nota travada por outro usuário — cobre o caso raro de alguém
  editar por fora da UI (outra aba, chamada direta à API) ou o TTL expirar
  entre o clique e o salvamento. `aplicar_edicoes` devolve as notas puladas em
  `bloqueadas`, para a UI manter a edição pendente em vez de descartá-la.
- Escopo desta fase: só a tabela `notas` (Gerenciar → Geral → Edição
  Rápida/Lote/Exclusão). `notas_ramal` não trava — não há evidência de que o
  Numero_Nota colida entre as duas tabelas, mas a tabela `bloqueios` não tem
  coluna para discriminar "qual tabela", então extensão futura precisa disso.

**Sem fallback silencioso.** Em `producao`, se o banco compartilhado não
estiver acessível, `db.migrar_da_rede_se_preciso()` levanta
`BancoRedeIndisponivelErro` e a requisição falha com a causa provável
(rede, caminho, permissão). Servir a cópia local nesse cenário esconderia
notas desatualizadas de todo o setor — por isso o erro é explícito e é
reavaliado a cada requisição.

**Perfil local não publica na rede.** Ele ainda pode ler a rede durante a
migração inicial descrita acima, mas suas escritas ficam na máquina:
`gerar_copia_excel_rede()` sai logo no começo quando `config.em_producao()`
é falso — antes de enriquecer os dados, antes de checar/remover locks `~$` e
antes de gravar `Base_Notas_Sincronizada.xlsx` ou `Input Nota.xlsx`. Só o
perfil `producao` publica essas planilhas. `garantir_banco()` e
`gerar_copia_excel_rede()` avisam isso no log.
A sincronização por `sqlite3.Connection.backup()` que existia até `ef19f4f`
**não pode voltar**: ela sobrescreve o arquivo inteiro da rede e
apaga o que os outros usuários gravaram. Se o perfil local algum dia
precisar publicar, o caminho é UPSERT por `Numero_Nota`.

## Origem das extrações SAP

IW28, IW38 e IW66 são lidas e gravadas sob a raiz única
`\\ebeat-fp1\Documentos\Diretoria Tecnica\Engenharia\DSPM\Planejamento Distribuição 2016\Estrutura BI - DDPM\INPUT SQL\Arquivos_SAP`.
`config.REDE_ARQUIVOS_SAP` é a fonte dos três caminhos; não monte caminhos
SAP diretamente a partir de `REDE_INPUT_SQL`.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `backend/input_module/engine.py` | Motor de enriquecimento: carrega o cadastro do SQLite e cruza com IW28/IW38/IW66 e as bases de apoio; auditoria de prazo (`avaliar_prazo_sap`); cache em memória validado por versão do dataset (TTL como fallback). |
| `backend/input_module/db.py` | Persistência SQLite local: schema/migração do banco de notas, CRUD com diff/log/undo, backups rotativos, e o cache de bases externas (`salvar_base_dataframe`/`carregar_base_dataframe`). |
| `backend/input_module/iw28.py` | Contrato de leitura somente-consulta da `base_iw28` por número de nota (`obter_por_nota`, `extraida_em`), sem duplicar o SQL de `engine.py`. |
| `backend/input_module/service.py` | Caminho canônico de escrita (criação de notas + migração/init do banco), reusado por `routes.py` e por outros módulos que precisem escrever no Input (ex.: integração Coffee→Input). |
| `backend/input_module/routes.py` | Router FastAPI `/api/input/*`: leitura/escrita de notas, configuração (responsáveis, bases, backups), sincronização SAP, ramal e hierarquia. |
| `backend/input_module/config.py` | Dicionários de domínio (status, cidades, regionais, prioridades), caminhos de rede e locais, e as constantes de colunas/nomes do painel. |

## engine.py — cruzamento de bases

`enriquecer_dados()` (`engine.py:170`) é a função central: parte de
`carregar_dados()` (o cadastro em `notas`, via `db.py`) e vai
adicionando colunas em blocos sucessivos, cada um isolado em
`try/except` para não derrubar o restante do enriquecimento se uma base
faltar ou vier com formato inesperado:

- **Geográfico** — mapeia `Cidade`/`CJ_Aneel` a partir dos 3 primeiros
  caracteres de `Local_Instalacao`/`Circuito` (`config.DE_PARA_CIDADES`,
  `config.DE_PARA_CJ_ANEEL`).
- **Indicador de continuidade** (`db.carregar_base_dataframe("base_indicador_continuidade")`)
  — calcula `Conj.critico` (`regra_conjunto_critico`, `engine.py:78`) e
  `ranking` por conjunto, casando pela chave normalizada (maiúscula,
  sem acento) de `CJ_Aneel`.
- **IW28** (`db.carregar_base_dataframe("base_iw28")`) — chave `Nota` →
  `Numero_Nota`: preenche `Export_status` (status SAP da nota),
  `Centro_SAP`, `Ordem` (usada depois para casar com IW38) e
  `Encerram.por data`. `Status_Final` cai para `Status_Nota` local
  quando a nota está "Fora SAP".
- **Clientes por conjunto** (`db.carregar_base_dataframe("base_clientes")`)
  — `N_Clientes_Conjunto`, denominador de DEC/FEC.
- **IW38** (`db.carregar_base_dataframe("base_iw38")`) — chave `Ordem`
  (a mesma extraída do IW28): `Status_Usuário_Ordem`,
  `Status_Sistema`, `Total_planejado_ordem`, `Total_real_ordem`,
  `Exec_percentagem_ordem` e `Ordem_Executada` (via
  `config.MAP_ORDEM_EXECUTADA`).
- **Custo modular / sazonalidade** (`base_custo_modular`, `base_sazonal`)
  — multiplica custos unitários (`CHI`, `CI`, `Ocorrencia`,
  `DEC_PROG_CHI`) pelo volume planejado (`Planejado_DDPM`), chave
  `Conjunto`.
- **DEC/FEC** — calculado localmente (`CHI`/`N_Clientes_Conjunto`,
  `CI`/`N_Clientes_Conjunto`), sem base externa.
- **Ganhos** (`base_ganhos`) — chave composta `Conjunto + "_" + CJ_Aneel`
  para `CHI_Conj`.
- **Históricos 12M/3M** — descontinuado (fonte Table1 fora de uso);
  colunas `CI_12M`/`CHI_12M`/`OCO_12M`/`OCO_3M` seguem no schema,
  sempre `"-"`.
- **IW66** (`_ler_export_medidas()` → `db.carregar_base_dataframe("base_iw66")`)
  — agrupa medidas por `Nota`, classifica cada linha em metros ou
  unidades (`_classificar`, `engine.py:554`) e monta `Medida_SAP`
  (ex.: `"1.2 km / 3 un"`); `Medida_vs_Planejado`
  (`_comparar_medida_planejado`, `engine.py:35`) compara com
  `Planejado_DDPM`.
- **Auditoria de prazo** — `avaliar_prazo_sap` (`engine.py:88`) compara
  o mês/ano planejado (`Mes_Execucao_Planejado`) contra a data real de
  encerramento SAP (`Encerram.por data`), produzindo
  `Auditoria_Cronograma` (`🟢 Adiantado`, `🔵 No Prazo`, `🔴 Com Atraso`,
  etc.).

`get_dataset(forcar=False)` (`engine.py:602`) envelopa
`enriquecer_dados()` num cache em memória protegido por
`threading.Lock`. A partir da Tarefa 14, a revalidação é primariamente
por **versão**: a cada chamada compara a versão em cache com
`db.obter_versao_dataset()` (Tarefa 13) e refaz `enriquecer_dados()`
se ela mudou — captura escritas de qualquer processo/worker, não só
as feitas pelo processo que preencheu o cache. `_CACHE_TTL_SEGUNDOS =
600` continua existindo como rede de segurança para escritas que não
passem pelos logs/contagem que `obter_versao_dataset()` cobre (ver
"Limitação conhecida" abaixo). `invalidar_cache()` segue disponível e
é chamado após qualquer escrita (ver `routes.py`), mas deixou de ser o
único gatilho de atualização.

`status_bases()` (`engine.py:626`) — que faz 7 `os.path.exists`/
`os.path.getmtime` (uma por caminho SMB em `config.BASES_REDE`) — tem
memo próprio de 60s (`_status_bases_cache`), independente do cache do
dataset: como é chamado a cada `GET /notas` só para popular metadados,
o memo evita bater no filesystem de rede a cada request. Diferente do
cache do dataset, este memo não é revalidado por versão (os arquivos
de rede não passam por `obter_versao_dataset()`) — por isso
`substituir_base()` e `_rotina_sap_background()` chamam
`engine.invalidar_status_bases()` explicitamente depois de trocar um
arquivo, para não deixar `meta.bases` desatualizado por até 60s.

## Cache SQLite (db.py)

`salvar_base_dataframe(nome_tabela, df)` e
`carregar_base_dataframe(nome_tabela)` (`db.py:722` e `db.py:734`)
substituem o que antes era leitura direta de Excel via
`pd.read_excel(config.CAMINHO_*)` a cada cruzamento em `engine.py`.
Essa mudança **não fez parte do plano do SP1** — veio de uma feature de
sincronização SAP construída separadamente pelo usuário (robô RPA que
extrai IW28/IW38/IW66 do SAP) e foi integrada a este código durante a
fase de merge do SP1 (commit `6a6ea7b Merge origin/develop (SAP sync
feature) into develop`). O upload manual de bases de apoio
(`routes.py`, `_processar_upload_base`) também grava no SQLite pelo
mesmo par de funções, então tanto a extração automática quanto o
upload manual convergem para a mesma origem de dados lida por
`engine.py`.

Cada base vira uma tabela própria (`base_iw28`, `base_iw38`,
`base_iw66`, `base_indicador_continuidade`, `base_clientes`,
`base_custo_modular`, `base_sazonal`, `base_ganhos`, `base_table1`),
sempre substituída por inteiro (`if_exists="replace"`) — não há
schema fixo por tabela: as colunas seguem exatamente o que veio do
Excel de origem, e `engine.py` lida com nomes de coluna variáveis
(ex.: fallback entre `DELTA_INDICADOR _12MM_CONJUNTO` com espaço e sem
espaço, `engine.py:194`). `carregar_base_dataframe` devolve `None` (não
levanta) se a tabela ainda não existir, o que `engine.py` trata como
"base pendente de extração".

O cadastro de notas (tabela `notas`, schema fixo — ver
`inicializar_banco()`, `db.py:46`) é uma persistência SQLite diferente
e mais antiga, não relacionada a essa migração: é o CRUD principal do
módulo (upsert, diff/log, undo, backups rotativos).

## Versão do dataset (`db.obter_versao_dataset`)

`obter_versao_dataset() -> str` (`db.py`) é uma versão barata do
dataset, montada sem tabela nova nem migração de schema — só compõe um
string a partir de colunas que já existem:

```
f"{max_alt}|{qtd_alt}|{max_arq}|{qtd_notas}"
```

onde `max_alt`/`qtd_alt` vêm de `MAX(Data_Hora)`/`COUNT(*)` em
`log_alteracoes`, `max_arq` de `MAX(Data_Hora)` em `log_arquivos`, e
`qtd_notas` de `COUNT(*)` em `notas`.

O que essa string cobre:

- **Edição/exclusão/undo** — qualquer escrita que passa por
  `log_alteracoes` (`aplicar_edicoes`, `deletar_notas`,
  `reverter_ultima_alteracao`) muda `max_alt`/`qtd_alt`.
- **Criação de nota** — `service.criar_notas` não grava em
  `log_alteracoes` (é um INSERT puro via `salvar_em_massa`), então é
  pega pelo `COUNT(*)` de `notas` (`qtd_notas`), não pelos logs.
- **Importação de base** (upload manual em `POST /bases/{nome}` e a
  sincronização SAP noturna, `_rotina_sap_background` em
  `routes.py`) — ambas chamam `db.salvar_log_arquivo(...)`, o que muda
  `max_arq`. Antes desta versão, o scheduler noturno **não** chamava
  `salvar_log_arquivo` — a extração SAP atualizava as tabelas
  `base_iw28`/`base_iw38`/`base_iw66` mas não deixava rastro em
  `log_arquivos`, então essa versão (e o cache/ETag que depende dela)
  não mudava depois de uma sincronização automática. `routes.py` agora
  grava um `salvar_log_arquivo` por arquivo gerado (`Gerada_base_IW28.XLSX`,
  `Gerada_custo_ord_IW38.XLSX`, `Gerada_medidas_IW66.XLSX`), mas só para o
  arquivo cujo `_processar_upload_base` retornou sucesso — `_processar_upload_base`
  agora devolve `bool` em vez de engolir a falha em silêncio; um import
  que falhar (ex.: coluna renomeada pelo robô SAP) não bumpa a versão do
  dataset nem dispara o aviso de "dados atualizados" no frontend para uma
  base que na prática não mudou.

Limitação conhecida: uma escrita direta no `.db` (fora do CRUD deste
módulo — ex.: script manual tocando `notas`/`log_*` no arquivo SQLite)
não passa por nenhuma dessas funções e não é detectada por
`obter_versao_dataset()`. O cache do `engine.py` (TTL de 600s) segue
como rede de segurança para esse caso.

É consumida pelo cache de `engine.get_dataset()` (Tarefa 14 —
revalida sozinho quando a versão muda, em vez de depender só do TTL)
e pelo `ETag` de `GET /notas` e pelo `versao` de `GET /sync` (Tarefa
15 — ver "routes.py" abaixo).

## iw28.py — contrato de leitura

`input_module/iw28.py` isola o acesso de leitura à tabela `base_iw28`
por número de nota, para que outros módulos não dupliquem o SQL de
`engine.py` nem precisem conhecer o schema flutuante da extração SAP:

- `obter_por_nota(numero) -> dict | None` — busca a linha da
  `base_iw28` para a nota (`CAST(Nota AS INTEGER) = ?`), convertendo
  `NaN` para `None` (JSON-safe). Degrada para `None` (não levanta) se a
  tabela não existir ou a coluna `Nota` tiver sido renomeada pelo
  robô — mesma postura defensiva de `carregar_base_dataframe`.
- `extraida_em() -> str | None` — data da última importação da IW28,
  lida de `log_arquivos` (`Nome_Arquivo LIKE '%IW28%'`); `None` se não
  houver registro ou a tabela de log estiver ausente.

Quem consome hoje: a integração Coffee→Input (nota gerada pelo Coffee
é revisada contra o status real da IW28 antes de virar registro no
Input). O contrato foi desenhado para ser extensível a enriquecimentos
futuros que precisem de uma única linha da IW28 sem montar o
`enriquecer_dados()` completo.

## service.py — caminho canônico de escrita

`input_module/service.py` concentra o caminho de escrita que antes
vivia dentro de `routes.py`, para que outros módulos (ex.: a
integração Coffee→Input) possam reusar exatamente a mesma lógica sem
importar internals de rotas:

- `garantir_banco() -> str` — resolve o banco do perfil ativo
  (`db.migrar_da_rede_se_preciso()`) e roda `db.inicializar_banco()` uma
  única vez por processo (protegido por `threading.Lock`); retorna
  `"rede"` (produção), `"ja-existe"`, `"migrado"` ou `"rede-indisponivel"`.
  Loga um resumo seguro da conexão (`db.descrever_conexao()`).
  `resetar_migracao()` zera esse estado (usado por `POST /migrar`).
- `NovaNota` (Pydantic) — schema de uma nota nova, mesmos campos/defaults
  usados pelos endpoints `POST /notas` e `POST /notas/bulk`.
- `criar_notas(notas: list[NovaNota], usuario: str, origem: str = "manual")
  -> int` — valida duplicatas (no lote e contra o banco), completa
  `Regional` (derivado de `Local_Instalacao[:3]` via
  `config.DE_PARA_REGIONAL`), `ID_Cronologia` e `origem`, grava via
  `db.salvar_em_massa()` e retorna a quantidade inserida. Levanta
  `NotasDuplicadasErro` em conflito.

`routes.py` apenas delega para essas funções e traduz
`NotasDuplicadasErro` em `HTTPException(409, ...)`.

### Coluna `origem` (Fase 2 da Carteira)

A tabela `notas` tem uma coluna `origem` que rastreia como a nota entrou
no plano: `"manual"` (rotas `POST /notas` e `/notas/bulk`, default de
`criar_notas`), `"coffee"` (`integracao_module` — ponte COFFEE→plano),
`"carteira"` (`carteira_module` — mover-para-plano da Carteira de Notas).
Notas legadas (anteriores à coluna) ficam `NULL`. Migração aditiva
idempotente em `inicializar_banco` (checa `PRAGMA table_info(notas)`
antes do `ALTER TABLE ... ADD COLUMN`), no mesmo padrão de `Check`/
`Status_Anterior`/`Nota_Mae`. `salvar_em_massa` inclui `origem` na lista
`colunas_upsert`.

## routes.py

Router `/api/input` (prefixo). Todo endpoint de leitura/escrita chama
`garantir_banco()` (`service.py`), que roda a migração da rede e
`db.inicializar_banco()` uma única vez por processo.

| Rota | O que faz |
|---|---|
| `GET /notas` | Lista o dataset enriquecido (`engine.get_dataset()`) + metadados (opções de status/prioridade, status das bases, última alteração, colunas do painel, `versao`). Responde `ETag: W/"<versao>"` (`db.obter_versao_dataset()`) e `Cache-Control: no-cache`; se `If-None-Match` bater com o ETag atual, devolve `304` sem chamar `engine.get_dataset()` — o navegador serve o corpo do cache HTTP local ao `fetch`, sem re-enviar o dataset pela rede. |
| `GET /sync` | Retorna `ultima_alteracao` e `versao` (`db.obter_versao_dataset()`), usado para polling leve — o frontend compara `versao` a cada 60s para saber se precisa revalidar (ver `03-frontend-input.md`). |
| `GET /relatorios/dashboard?regional=<opcional>&mes=<opcional, 1-12>` | Home do app. `mes` seleciona o mês de referência do hero/regionais (padrão: mês corrente do servidor); fora de `1..12` retorna `422`. Chama `metas.sincronizar_se_preciso()` (no-op se o mtime não mudou), monta o payload via `relatorios.montar_dashboard(..., mes_referencia=...)` a partir de `engine.get_dataset()` + `db.carregar_dados_ramal()` + `db.carregar_metas()` + `db.carregar_planos_depara()` + `db.carregar_postergacoes()`, e anexa `regionais_disponiveis`/`metas_info`. O payload traz `mes_referencia` (renomeado de `mes_corrente`), `hero.postergadas` (soma do mês de referência) e `visao_anual[].postergado` (soma do ano por plano) — ambos respeitam o filtro de `regional`. Mesmo contrato de ETag/304 de `GET /notas`, mas o ETag agora inclui `versao-mes-regional` (`routes.py:79`) — cada combinação de filtro tem sua própria entidade cacheável, então trocar de mês/regional nunca serve payload de outra combinação. Como o sync de metas grava em `log_arquivos`, a versão computada logo depois já reflete uma reimportação — o ETag nunca serve payload velho pós-sync. |
| `POST /metas/sincronizar` | Força `metas.sincronizar_se_preciso(forcar=True)` (ignora mtime) e devolve o estado; usado pelo botão "Sincronizar agora" em Configurações. |
| `GET /logs`, `GET /logs/arquivos`, `GET /logs/nota/{numero}` | Log de alterações e de substituição de arquivos. |
| `PATCH /notas` | Edição parcial (`db.aplicar_edicoes`), com diff campo a campo e log; exige header `X-User`. Pula notas travadas por outro usuário e devolve os números em `bloqueadas`. |
| `POST /notas`, `POST /notas/bulk` | Criação de notas (unitária/lote), validando duplicatas contra o lote e contra o banco. |
| `DELETE /notas` | Exclusão em lote, com log de auditoria. Pula notas travadas por outro usuário (contagem real de `excluidas` reflete isso). |
| `GET /bloqueios` | Lista os bloqueios ATIVOS (não expirados) — `[{Numero_Nota, Usuario, Data_Hora}]`. Sem `X-User`, como `/sync`. |
| `POST /notas/{numero}/travar` | Reivindica a edição da nota (`db.travar_nota`). Conflito volta no corpo (`{"ok": false, "usuario", "desde"}`, HTTP 200), não como erro — mesmo padrão de `/desfazer`. |
| `POST /notas/destravar` | Libera os bloqueios de `numeros` que pertencem ao usuário do header. |
| `POST /desfazer` | Reverte a última transação de edição (`db.reverter_ultima_alteracao`). |
| `POST /export` | Gera um `.xlsx` filtrado (linhas/colunas selecionadas) com nomes amigáveis. |
| `GET /responsaveis`, `PUT /responsaveis` | Mapa Regional → responsável (JSON local). |
| `GET /bases`, `GET /bases/{nome}/download`, `POST /bases/{nome}` | Lista/baixa/substitui as bases de apoio na rede (`config.BASES_APOIO`); todo upload dispara `_processar_upload_base` para gravar também no SQLite. |
| `POST /bases/sync-sap` | Dispara a extração SAP em background — é o que o botão **"Sincronizar SAP"** do frontend chama (`InputApi.syncSap()`, ver [`03-frontend-input.md`](03-frontend-input.md)). Roda `Sap_Robot.py` num subprocesso, depois importa os três Excel gerados (IW28/IW38/IW66) para o SQLite via `_processar_upload_base` e invalida o cache do engine. |
| `GET /backups`, `GET /backups/{nome}/download` | Lista/baixa backups rotativos do banco de notas. |
| `GET /ramal`, `POST /ramal/bulk`, `DELETE /ramal` | CRUD da tabela `notas_ramal` (obras de ramal, schema paralelo ao de `notas`). |
| `POST /hierarquia`, `GET /hierarquia/{numero_nota}` | Vínculo nota-mãe/nota-filha (`Nota_Mae`). |
| `POST /migrar` | Força nova tentativa de migração do banco a partir da rede. |

### Regra de executado em Relatórios

Executado reconhece o código exato 99 em `Status_Final`; `Status_Nota` só é
fallback quando o consolidado está ausente, e `ENCE EXEC` continua válido.
Sem `Encerram.por data`, a execução usa `Mes_Execucao_Planejado` e o payload
incrementa `avisos.executadas_sem_data`, contado por nota no ano e no filtro
regional ativo.

Toda escrita bem-sucedida chama `service.pos_escrita()`, que
invalida o cache do engine e agenda `engine.gerar_copia_excel_rede()`
em background para manter o Excel espelhado na rede atualizado. Em perfil
local a tarefa agendada retorna sem tocar em nenhum caminho de rede; o banco
em si não é copiado por essa rotina — ver "Perfil de execução" acima.

### Ramal: `ID_Cronologia`

`db.salvar_ramal_em_massa()` resolve o `ID_Cronologia` sozinho
(`_resolver_id_cronologia_ramal`): quem já existe mantém o valor gravado e
só as notas novas continuam a numeração a partir do máximo. Antes disso,
`POST /ramal/bulk` renumerava o lote inteiro para `1..n`, então uma edição
parcial (a Edição Rápida manda só as notas alteradas) colidia com as
demais linhas e embaralhava o `ORDER BY ID_Cronologia` da aba Ramal.

## Robô SAP (`backend/Sap_Robot.py`) — setup

Script de automação do SAP GUI (via `win32com`, Windows-only) que faz login
no SAP, roda as transações IW28/IW38/IW66 para as notas do banco local e
salva os três Excel exatamente nos caminhos de `input_config.CAMINHO_BASE_IW28`/
`CAMINHO_CUSTO_ORD_IW38`/`CAMINHO_BASE_IW66` (os mesmos que
`_processar_upload_base` depois importa para o SQLite). Não depende mais de
Streamlit — roda como script standalone.

Setup (uma vez por máquina):

```bash
cd backend
venv\Scripts\python.exe -m pip install -r requirements-sap-robot.txt
copy credenciais.json.example credenciais.json
# edite credenciais.json com LOGIN_SAP/SENHA_SAP reais — nunca commitar esse arquivo
```

Duas formas de rodar:
- **Clique duplo em `backend/Rodar_Sap_Robot.bat`** — checa venv/credenciais,
  roda com o Python do venv, pausa no fim mostrando o resultado.
- **Pelo app** — botão "Sincronizar SAP" do frontend chama `POST
  /api/input/bases/sync-sap`, que dispara `_rotina_sap_background` em
  background usando `sys.executable` (o mesmo Python do venv do backend, não
  o `python` genérico do PATH — precisa ser o venv com pywin32/pyperclip
  instalados via `requirements-sap-robot.txt`).

`requirements-sap-robot.txt` fica separado de `requirements.txt` porque
`pywin32`/`pyperclip` são Windows-only e o backend web (FastAPI) não precisa
deles — só quem for rodar a extração local precisa instalá-las.

## Pontos de atenção
- `input_module/engine.py:449-450` e blocos irmãos — praticamente todo
  bloco de cruzamento em `enriquecer_dados()` usa `except Exception:
  print(...)`, sem re-lançar; uma base corrompida ou com coluna
  renomeada é silenciosamente ignorada (o dataset segue com valores
  padrão) e o único sinal é uma linha de log no console do processo.
- `input_module/db.py:722-742` — `salvar_base_dataframe`/
  `carregar_base_dataframe` não têm schema fixo nem validação de
  colunas; um Excel de origem com cabeçalho alterado grava sem erro e
  só quebra mais adiante, dentro de `engine.py`, quando a coluna
  esperada não é encontrada.
- `input_module/routes.py:268` — `from fastapi import Body` está no
  meio do arquivo (não no bloco de imports do topo), import solto
  antes de `sync_sap`.
- `input_module/engine.py:597-598` — o cache de `get_dataset()` é
  global em memória do processo (não por usuário/request); em
  múltiplos workers cada processo mantém sua própria cópia. Desde a
  Tarefa 14 isso diverge só pelo tempo de uma chamada (a próxima
  requisição em qualquer worker já vê `db.obter_versao_dataset()`
  mudar e revalida); `_CACHE_TTL_SEGUNDOS = 600` continua como
  fallback só para as escritas fora do alcance dessa versão (ver
  "Limitação conhecida" na seção de versão do dataset acima).
- `input_module/db.py:298-302` (`proximo_id_cronologia`) —
  `pd.to_numeric(df["ID_Cronologia"], errors="coerce").max()` ignora em
  silêncio qualquer valor não numérico na coluna (vira `NaN`, excluído
  do `max()`); se essa linha ignorada tiver, na verdade, o maior
  `ID_Cronologia` do banco, o próximo ID calculado fica menor do que
  deveria e pode colidir com um `ID_Cronologia` já em uso.

## Metas — sync do Controle Plano de Recomposição

`input_module/metas.py` implementa a sincronização automática das metas
do Plano de Recomposição a partir da cópia local de um Excel hospedado no
SharePoint. O Excel é a fonte de verdade; o app apenas espelha seus dados
no SQLite local.

### Caminho e configuração

A planilha é definida por `config.caminho_controle_recomposicao()`. Por
padrão, ela aponta para a pasta SharePoint sincronizada em cada máquina:

```text
C:\Users\<USER>\EDP\O365_Planejamento_Manutencao_EDP_Brasil - Documentos\PLANO RECOMPOSIÇÃO\SP\2026\Controle Plano de Recomposição 2026.xlsx
```

O nome do perfil vem de `USER`. Em Windows, quando essa variável não existe,
o código usa `USERNAME` e depois o nome de `Path.home()`. Uma configuração
explícita continua vencendo todos os defaults:

```python
CONTROLE_RECOMPOSICAO_PATH=/caminho/alternativo/Controle.xlsx
```

Modo de execução (no app, sem interface no frontend):
- `metas.sincronizar_se_preciso(forcar: bool = False)` — roda automaticamente
  (ou sob demanda se `forcar=True`) quando a timestamp do arquivo (mtime)
  mudou desde a última sincronização bem-sucedida.

### Estratégia de cópia e tratamento de locks

O arquivo Excel vive lockado pelo Excel/OneDrive enquanto em uso. Para
evitar conflicts de acesso:

1. `_importar()` copia o arquivo para um diretório temporário antes de
   lê-lo.
2. A leitura ocorre dentro do temp-dir (seguro, sem concorrência).
3. O arquivo original permanece intocado — quem o estiver editando no
   Excel não vê interrupção.
4. Após a leitura, `xl.close()` explicitamente libera o file handle
   (necessário em Windows para evitar lock permanente do temp file).

### Operação: replace em vez de merge

`db.substituir_metas(df_metas, df_depara, df_postergacoes)` **substitui**
completamente as tabelas `metas_plano`, `planos_depara` e
`metas_postergadas`:

- `metas_plano` — todas as metas importadas do Excel.
- `planos_depara` — mapeamento Plano → Nome_Curto, Unidade, Área
  (com lógica determinística de colisão: plano com nome mais curto fica
  com o apelido; demais em colisão usam o nome longo sem " - CAPEX").
- `metas_postergadas` — quantidade postergada por Ano/Mês/Regional/Plano,
  lida da aba `Postergadas` do mesmo Excel (`metas._postergadas`). O grão
  é o **mês de destino** (`Mês de Execução Planejado - DDPM`, o mês para
  onde a nota foi replanejada) — o arquivo real **não guarda o mês de
  origem**, então a postergada conta no mês destino, não no de onde saiu.
  A quantidade é a **soma de `Planejado-DDPM`**; regional e plano vêm de
  `Regional` e `Projeto Construção`. `df_postergacoes` é opcional (`None`
  mantém a tabela intocada, retrocompatível com o replace de metas puro);
  o sync sempre a passa.

Não há merge/upsert — o que o Excel diz é tudo; dados que saíram do
Excel são apagados (garantindo que o banco reflete fielmente a fonte de
verdade). Se a aba `Postergadas` não existir ou tiver colunas renomeadas,
a exceção cai no mesmo `try/except` de `sincronizar_se_preciso` — a última
sincronização boa (metas **e** postergadas) é preservada, e o erro aparece
em `metas_info.erro` no dashboard.

Os nomes de coluna foram verificados contra o arquivo real. `_postergadas`
resolve cada coluna pelo helper `_coluna`, que casa por nome **normalizado**
(colapsa espaço duplo, quebra de linha e caixa) — o arquivo real usa
cabeçalhos como `Projeto\nConstrução` e `Mês de Execução  Planejado - DDPM`
(espaço duplo), que quebravam o casamento por nome exato. Coluna realmente
ausente vira `KeyError` claro, degradado em aviso no card de metas.

### Versionamento: log_arquivos e obter_versao_dataset

Toda sincronização bem-sucedida registra uma entrada em `log_arquivos`
com `usuario="metas-sync"`, o que automaticamente bumpa a versão do
dataset (`db.obter_versao_dataset()`). Isso dispara:

- Revalidação do cache do engine (TDD Task 14: versão como gatilho).
- Notificação de "dados atualizados" no frontend (Task 15: versão em
  `/api/input/sync`).

### Tratamento de falhas: preserva última sincronização

Falha nunca derruba nada:

1. Arquivo inacessível (rede/OneDrive fora, permissões perdidas):
   `sincronizar_se_preciso()` registra o erro no estado (`obter_estado_metas()`)
   e **preserva** a última importação bem-sucedida.
2. Erro durante a leitura (aba renomeada, formato corrompido, etc.):
   idêntico — registra erro, mantém dados velhos.
3. Retry automático: se `forcar=True`, tenta novamente mesmo que a
   última tentativa tivesse falhado.

O estado é persistido em `metas_sync_estado` (tabela SQLite):

```python
obter_estado_metas() -> {
  "arquivo_mtime": float | 0.0,  # timestamp da última sincronização bem-sucedida
  "atualizadas_em": str,          # ISO 8601
  "erro": str | None              # mensagem de erro, se houver
}
```

### Estrutura de dados

**Tabelas:**

| Tabela | Colunas | Notas |
|---|---|---|
| `metas_plano` | `Ano`, `Mes`, `Regional`, `Plano`, `Meta` | Granularidade: ano/mês/regional/plano. |
| `planos_depara` | `Plano`, `Nome_Curto`, `Unidade`, `Area`, `Modular_RS`, `Ordem_Exibicao` | Mapeamento 1:1 plano → metadata. |
| `metas_sync_estado` | `arquivo_mtime`, `atualizadas_em`, `erro` | Estado da última sincronização (singleton). |

**Formato esperado do Excel:**

- Aba `base` (obrigatória): `Regionais`, `Mês` (timestamp), `Plano`, `Meta` (numérico), `Conjunto`.
- Aba `dexpara` (obrigatória): `Projeto`, `Unidade`, `Área`, `Modular R$`.

Colunas extras/vazias são ignoradas; linhas com valores faltantes em
`Regionais`/`Mês`/`Plano` são descartadas.
