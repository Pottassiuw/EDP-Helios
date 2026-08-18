# Plano de Migração — SQLite → MySQL

> **Status: proposta. Nada aqui foi implementado.**
> Documento de planejamento para a fase pós-sprints. Descreve o estado
> atual da persistência, o modelo alvo em MySQL, as incompatibilidades
> concretas e o roteiro de migração. As decisões marcadas como
> **DECISÃO NECESSÁRIA** precisam de resposta antes de escrever código.

---

## 1. Por que migrar

O SQLite atende bem o estágio atual, mas três limites já aparecem no
código de hoje e vão piorar com escala:

**Um escritor por vez.** O SQLite serializa escritas no arquivo inteiro.
O código compensa isso com camadas de trava em Python — `_banco_lock`
(`input_module/service.py:15`), `_BACKUP_LOCK` (`input_module/db.py:349`),
`_LOCK` em `coffee_module/jobs.py:10` e `carteira_module/sync.py:10`,
`_travas_de_base` (`input_module/routes.py:370`) — além de `BEGIN
IMMEDIATE` em cinco caminhos de escrita do Input. Nenhuma dessas travas
protege contra outro **processo** (o robô SAP, o app legado): elas só
serializam threads do próprio backend.

**WAL indisponível em produção.** O banco de produção vive num
compartilhamento SMB, e WAL exige memória compartilhada. O código
desliga o WAL explicitamente nesse perfil (`input_module/db.py:48-56`) e
depende apenas do `timeout=30`. Isso significa: em produção, leituras e
escritas concorrentes se bloqueiam mutuamente, sem o paralelismo
leitor/escritor que o WAL daria.

**Tipagem dinâmica mascarando divergências.** `Status_Nota` é `INTEGER`
em `notas` e `TEXT` em `notas_ramal` — a mesma informação, dois tipos.
Datas são gravadas como texto ISO. O SQLite aceita tudo; qualquer banco
estrito recusaria e obrigaria a decidir.

Somando: concorrência real entre usuários, robô SAP e jobs de background
é hoje resolvida por convenção e sorte, não pelo banco.

---

## 2. Estado atual — inventário completo

### 2.1 Quatro bancos independentes

| Banco | Arquivo | Módulo | Dono |
|---|---|---|---|
| Notas do departamento | `notas_departamento.db` | `input_module` | **Compartilhado** — este backend, `Sap_Robot.py` e um app legado |
| COFFEE | `coffee.db` | `coffee_module` | Só este backend |
| Carteira | `carteira.db` | `carteira_module` | Só este backend |
| Verificar (triagem) | `Verificar.db` | `verificar_module` | **Terceiros** — somente leitura, gerado por outra ferramenta |

Não há chave estrangeira entre bancos (são arquivos separados) nem,
salvo uma exceção, dentro deles. `PRAGMA foreign_keys = ON` aparece
apenas em `coffee_module/db.py:74` — e mesmo lá nenhuma FK é declarada,
então o pragma não tem efeito prático hoje.

### 2.2 `notas_departamento.db` (input_module)

Criado/migrado em `inicializar_banco()` (`input_module/db.py:166`).
**Só no perfil local** — em produção o backend apenas inspeciona o
esquema e nunca aplica DDL (`_conferir_esquema_compartilhado`,
`input_module/db.py:148`), porque o arquivo pertence ao setor inteiro.

| Tabela | Chave | Observações |
|---|---|---|
| `notas` | `Numero_Nota` INTEGER PK | Tabela principal do plano. 16 colunas no `CREATE` + 4 adicionadas por `ALTER` condicional: `Check`, `Status_Anterior`, `Nota_Mae`, `origem` |
| `notas_ramal` | `Numero_Nota` INTEGER PK | Base paralela ("Ramal"), 16 colunas. `Status_Nota` é **TEXT** aqui e **INTEGER** em `notas` |
| `log_alteracoes` | `ID_Log` AUTOINCREMENT | Auditoria campo a campo. Índices em `Numero_Nota` e `Data_Hora DESC` |
| `log_arquivos` | `ID_Log` AUTOINCREMENT | Auditoria de importação de bases. Índice em `Data_Hora DESC` |
| `metas_plano` | PK composta `(Ano, Mes, Regional, Plano)` | Metas do Plano de Recomposição |
| `metas_postergadas` | PK composta `(Ano, Mes, Regional, Plano)` | Postergações |
| `planos_depara` | `Plano` TEXT PK | De-para de planos + custo modular |
| `metas_sync_estado` | `id` INTEGER PK `CHECK (id = 1)` | Singleton — estado da última sincronização de metas |
| `bloqueios` | `Numero_Nota` INTEGER PK | Trava pessimista de edição, TTL de 20 min em Python (`BLOQUEIO_TTL_MINUTOS`, `input_module/db.py:824`) |

**Tabelas dinâmicas.** Oito tabelas não são declaradas em lugar nenhum:
são criadas e recriadas por `salvar_base_dataframe()`
(`input_module/db.py:1273`), que chama `df.to_sql(..., if_exists="replace")`
— ou seja, `DROP TABLE` + `CREATE TABLE` com o esquema inferido do
DataFrame a cada importação:

`base_iw28`, `base_iw38`, `base_iw66`, `base_clientes`,
`base_indicador_continuidade`, `base_custo_modular`, `base_sazonal`,
`base_ganhos`

O esquema dessas tabelas é, literalmente, o que o Excel daquele dia
tinha. Isso é o ponto mais frágil da migração (§6.8).

### 2.3 `coffee.db` (coffee_module)

| Tabela | Chave | Observações |
|---|---|---|
| `notas_coffee` | `pk` INTEGER PK | 9 colunas no `CREATE` + **15** adicionadas por `ALTER` condicional. `dados_json` guarda o payload da API COFFEE como TEXT |
| `coffee_logs` | `id` AUTOINCREMENT | Índices em `nota_pk`, `tipo`, `timestamp`. Recriada defensivamente dentro de `registrar_log` (`coffee_module/db.py:753`) |
| `coffee_operacoes` | `id` TEXT PK (UUID) | Estado de operações em lote; `resultado_json` TEXT |
| `coffee_fila_operacao` | `id` AUTOINCREMENT | `entrada_id` UNIQUE, `nota_pk` UNIQUE. Índices em `etapa` e `operacao_id` |

### 2.4 `carteira.db` (carteira_module)

| Tabela | Chave | Observações |
|---|---|---|
| `nota_carteira` | `id_onr` INTEGER PK | 31 colunas. **~98 mil linhas** (volume real, citado em `repository.py:44,97,182`). Sete índices, incluindo o composto `ix_nc_lookup_sap` |
| `carteira_sync_execucoes` | `id` AUTOINCREMENT | Histórico de sincronizações |
| `carteira_logs` | `id` AUTOINCREMENT | |
| `carteira_meta` | `chave` TEXT PK | Chave-valor; guarda `versao` (contador de invalidação de cache) |
| `plano_movimentacoes` | `id` AUTOINCREMENT | Índices em `id_onr` e `lote_id` |
| `nota_carteira_staging` | `id_onr` PK | **Efêmera** — `DROP` + `CREATE` a cada sincronização (`repository.py:38-60`) |
| `plano_atual` | `numero` PK | **`CREATE TEMP TABLE`** por requisição (`repository.py:131-137`) |

### 2.5 `Verificar.db` (verificar_module)

Somente leitura, aberto com URI `?mode=ro` + `PRAGMA query_only = ON`
(`verificar_module/source.py:56-58`). Uma tabela: `ids_verificacao`,
lida inteira via `pd.read_sql_query`. Caminho padrão:
`//fscoc10/dep/DDPM/COFFEE/Gerador de Notas/Verificar.db`.

**Este banco não é nosso e não deve ser migrado** — ver §4.2.

### 2.6 Relações implícitas (hoje sem FK)

Nenhuma dessas relações é declarada no banco. Todas são mantidas por
convenção no código:

```
notas.Numero_Nota  ←──  notas.Nota_Mae            (auto-relação, hierarquia "gavetinha")
                            └─ armazenada como TEXT, comparada como número
notas.Numero_Nota  ←──  log_alteracoes.Numero_Nota
notas.Numero_Nota  ←──  bloqueios.Numero_Nota
notas.Numero_Nota  ←──  notas_coffee.id_sap        (banco diferente — integracao_module)
notas.Numero_Nota  ←──  nota_carteira.id_sap       (banco diferente, quando sap_real = 1)

notas_coffee.pk    ←──  coffee_logs.nota_pk
notas_coffee.pk    ←──  coffee_fila_operacao.nota_pk
coffee_operacoes.id ←── coffee_fila_operacao.operacao_id

nota_carteira.id_onr ←── plano_movimentacoes.id_onr
```

A auto-relação `Nota_Mae` merece destaque: é a hierarquia mãe/filha
exibida na `NotesTable` do frontend, guardada como **texto** numa coluna
com default `'-'`. O frontend precisa converter e validar em toda
leitura (`Number(maeStr)`, checagem contra `'-'`, `'None'`, `'null'`).

### 2.7 Camada de acesso

**Não existe ORM.** Nenhuma dependência de SQLAlchemy, Peewee, Tortoise
ou Alembic em `requirements.txt`. O acesso é `sqlite3` puro + pandas:

- ~2.850 linhas de SQL bruto distribuídas em `input_module/db.py`
  (1.554), `coffee_module/db.py` (834), `carteira_module/repository.py`
  (286) e `carteira_module/db.py` (173).
- **Sem pool de conexões.** Cada função abre e fecha a própria conexão
  (`get_db_connection()` / `conectar()`). Em SQLite isso é barato — abrir
  um arquivo. Em MySQL é um handshake TCP + autenticação por chamada,
  e vira o gargalo dominante se não for resolvido (§6.3).
- `pandas.read_sql` / `to_sql` em 15 pontos, com placeholders `?`.
- `sqlite3.Row` como row factory apenas em `carteira_module/db.py:22`.

### 2.8 Modelo de concorrência atual

| Mecanismo | Onde | O que protege |
|---|---|---|
| `timeout=30` / `busy_timeout=5000` | Todas as conexões | Espera o arquivo destravar |
| WAL | Só perfil local | Leitor/escritor paralelos |
| `BEGIN IMMEDIATE` | 5 caminhos de escrita do Input | Toma o lock de escrita no início da transação |
| `threading.Lock` (6 instâncias) | Vários módulos | Serializa threads do próprio processo |
| Tabela `bloqueios` + TTL 20 min | Input, edição inline | Trava **lógica** por nota, entre usuários |

A tabela `bloqueios` é o único mecanismo que atravessa processos e
sessões — e ela é aplicativo puro, não uma trava do banco.

---

## 3. Modelo alvo em MySQL

### 3.1 Consolidação: um servidor, quantos schemas?

**Recomendação: um schema único (`helios`), com as tabelas prefixadas por
domínio.**

Os três bancos nossos (`notas`, `coffee`, `carteira`) descrevem o mesmo
negócio e já se cruzam por `Numero_Nota`/`id_sap` — hoje esse cruzamento
é feito em Python porque não dá para fazer `JOIN` entre arquivos SQLite.
Unificar num schema torna essas relações declaráveis, indexáveis e
verificáveis. Três schemas separados replicariam a limitação atual sem
ganho.

### 3.2 Convenções

- **Charset/collation:** `utf8mb4` / `utf8mb4_0900_ai_ci`. Obrigatório —
  os dados têm acentos ("PLANO RECOMPOSIÇÃO", "Programável", nomes de
  municípios) e `latin1` corromperia.
- **Engine:** InnoDB (row-level locking e transações — a razão da migração).
- **`sql_mode`:** `STRICT_TRANS_TABLES` ligado. Isso vai **expor** as
  divergências de tipo do §1; é desejável, mas exige o saneamento do §6.9.
- **Timezone:** definir `time_zone` explicitamente no servidor e na
  conexão. Hoje o código usa `datetime.datetime.now()` (hora local, sem
  tz) em todos os logs.
- **Nomenclatura:** manter os nomes atuais de tabela e coluna na primeira
  migração. Renomear e migrar ao mesmo tempo dobra o risco e impede
  comparar origem e destino linha a linha. Renomeações ficam para depois
  do corte — **exceto `Check`** (§6.1), que é obrigatória.

### 3.3 Tipos — de/para

| Hoje (SQLite) | MySQL | Nota |
|---|---|---|
| `INTEGER PRIMARY KEY` | `INT UNSIGNED` / `BIGINT UNSIGNED` PK | `Numero_Nota` e `id_onr` são números SAP, não sequências — **não** usar `AUTO_INCREMENT` neles |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | `BIGINT UNSIGNED AUTO_INCREMENT` | Logs e filas |
| `TEXT` (curto, categórico) | `VARCHAR(n)` | Dimensionar por domínio; `VARCHAR(255)` como default seguro |
| `TEXT` (livre — `Observacao`, `detalhes`) | `TEXT` | |
| `TEXT` com data ISO | `DATETIME(0)` ou `DATE` | `sincronizado_em`, `criado_em`, `buscado_em`, `timestamp`, `Data_Hora`… |
| `TEXT` com JSON | `JSON` | `dados_json`, `resultado_json`, `snapshot`, `detalhes` — ganha validação e `->>` para consulta |
| `REAL` | `DECIMAL(12,2)` | `Planejado_DDPM`, `Meta`, `Qtd`, `Modular_RS` — dinheiro e metas não devem ser float binário |
| `INTEGER` booleano | `TINYINT(1)` | `arquivado`, `a_gerar`, `sucesso`, `verificar_ativa`, `sap_real`, `quantidade_valida` |
| `latitude`/`longitude` TEXT | `DECIMAL(10,7)` | Hoje texto em `nota_carteira` |
| `Status_Nota` (INT em `notas`, TEXT em `notas_ramal`) | **Decidir** — `SMALLINT` nas duas | Ver §6.9 |

### 3.4 Chaves estrangeiras propostas

Declarar as relações do §2.6 como FK reais, dentro do schema unificado:

```sql
-- Auto-relação da hierarquia (exige sanear Nota_Mae para INT — §6.9)
ALTER TABLE notas
  ADD CONSTRAINT fk_notas_mae FOREIGN KEY (Nota_Mae)
      REFERENCES notas (Numero_Nota) ON DELETE SET NULL;

ALTER TABLE log_alteracoes
  ADD CONSTRAINT fk_log_nota FOREIGN KEY (Numero_Nota)
      REFERENCES notas (Numero_Nota) ON DELETE CASCADE;

ALTER TABLE bloqueios
  ADD CONSTRAINT fk_bloq_nota FOREIGN KEY (Numero_Nota)
      REFERENCES notas (Numero_Nota) ON DELETE CASCADE;

ALTER TABLE coffee_fila_operacao
  ADD CONSTRAINT fk_fila_nota FOREIGN KEY (nota_pk)
      REFERENCES notas_coffee (pk) ON DELETE CASCADE,
  ADD CONSTRAINT fk_fila_op   FOREIGN KEY (operacao_id)
      REFERENCES coffee_operacoes (id) ON DELETE SET NULL;

ALTER TABLE plano_movimentacoes
  ADD CONSTRAINT fk_mov_nota FOREIGN KEY (id_onr)
      REFERENCES nota_carteira (id_onr) ON DELETE CASCADE;
```

**Deliberadamente sem FK:**

- `notas_coffee.id_sap → notas.Numero_Nota` e
  `nota_carteira.id_sap → notas.Numero_Nota`. Uma nota pode existir no
  COFFEE ou na Carteira **antes** de entrar no plano do Input — é o fluxo
  normal do negócio. Uma FK aqui inverteria a regra e quebraria a
  ingestão. Manter índice para o JOIN, sem constraint.
- `coffee_logs.nota_pk`: log de auditoria deve sobreviver à exclusão da
  nota que o originou.

### 3.5 Índices a preservar

Todos os índices atuais têm equivalente direto. Dois merecem atenção:

- `ix_nc_lookup_sap ON nota_carteira(id_sap, sap_real, sincronizado_em DESC, id_onr ASC)`
  — MySQL 8.0 suporta índice descendente de verdade; em versões
  anteriores o `DESC` era ignorado silenciosamente. **Requer MySQL 8.0+.**
- `idx_log_alteracoes_data ON log_alteracoes(Data_Hora DESC)` — mesma
  observação.

---

## 4. Bloqueadores — resolver antes de escrever código

### 4.1 O banco de notas é escrito por outros programas

**Este é o maior risco da migração, e não é técnico.**

`notas_departamento.db` não é nosso. Em produção ele é escrito por:

1. este backend FastAPI;
2. `Sap_Robot.py`, que abre o arquivo direto (`sqlite3.connect` em
   `Sap_Robot.py:676`, caminho de `INPUT_DB_PATH`);
3. um app legado do setor, mencionado explicitamente em
   `input_module/db.py:148-155` como motivo para nunca aplicar DDL em
   produção.

Migrar só o backend para MySQL **quebra os outros dois**. Não existe
migração parcial aqui.

> **DECISÃO NECESSÁRIA #1.** Para cada consumidor do arquivo:
> migra junto, ganha um adaptador, ou é aposentado?
> `Sap_Robot.py` está no nosso repositório e migra junto sem drama.
> O app legado é a incógnita — **antes de qualquer estimativa, é preciso
> saber quem o mantém, o que ele escreve e se pode ser desligado.**

### 4.2 `Verificar.db` fica fora

É gerado por outra equipe, lido em modo somente-leitura de um
compartilhamento de rede. Não temos autoridade para migrá-lo.

**Recomendação:** manter o `verificar_module` lendo SQLite. Ele já é um
adaptador isolado (`source.py`, 1 tabela, leitura completa via pandas) e
não participa de nenhuma transação. Conviver com as duas tecnologias
nesse ponto custa quase nada.

### 4.3 Perfil local × produção

Hoje `EDP_PERFIL` alterna entre banco local (`backend/data/`) e o da rede,
com toda a lógica de cópia/restauração de `migrar_da_rede_se_preciso()`
(`input_module/db.py:83`).

Com MySQL isso muda de natureza: não se "copia o banco da rede" — se
aponta para outra instância. `migrar_da_rede_se_preciso()`,
`realizar_backup()` (que usa a API `conn.backup()` do SQLite) e todo o
fluxo de backups rotativos em `.db` **deixam de existir** e são
substituídos por instâncias separadas (dev/homologação/produção) e
`mysqldump` agendado.

> **DECISÃO NECESSÁRIA #2.** Onde a instância MySQL vai rodar? Servidor
> do setor, VM de TI corporativa, ou serviço gerenciado? Isso define
> backup, retenção, acesso de rede e quem administra — e não é uma
> escolha de desenvolvimento.

---

## 5. Tecnologias

### 5.1 Driver

| Opção | Prós | Contras |
|---|---|---|
| **PyMySQL** *(recomendado)* | Puro Python, instala sem compilador — relevante num backend que já roda em Windows (`pywin32` no `requirements.txt`) | ~2× mais lento que o C em cargas muito altas |
| `mysqlclient` | Mais rápido (binding em C) | Precisa de toolchain de build no Windows |
| `mysql-connector-python` | Oficial da Oracle | Mais pesado, licença GPL com exceção |

O gargalo desta aplicação é o volume por consulta (98k linhas
paginadas), não a latência por statement. **PyMySQL é suficiente e é o
caminho de menor atrito operacional.**

### 5.2 ORM — precisa?

**Recomendação: SQLAlchemy *Core*, não o ORM. Mais Alembic para
migrações.**

Justificativa:

- **Contra o ORM completo:** reescrever ~2.850 linhas de SQL bem
  entendido como modelos e sessões é um projeto grande com pouco
  retorno. A aplicação é de relatório e grade — consultas analíticas,
  agregações, paginação sobre 98k linhas — onde SQL explícito é mais
  claro e mais rápido que o gerado. O `CLAUDE.md` do projeto pede
  exatamente isso ("Avoid unnecessary abstractions", "Prefer boring
  solutions", "Keep SQL separated from business rules").

- **A favor do Core:** ele entrega o que falta hoje sem exigir reescrita
  conceitual —
  - **pool de conexões** pronto (§5.3), que é o problema mais urgente;
  - `text()` com parâmetros nomeados, eliminando o de/para `?` → `%s`;
  - `pandas.read_sql`/`to_sql` já são feitos para receber um Engine do
    SQLAlchemy (com DBAPI cru fora sqlite3, o pandas emite aviso);
  - abstração de dialeto onde ela é barata, mantendo SQL literal onde
    ela custaria clareza.

- **A favor do Alembic:** a migração de esquema hoje é uma sequência de
  `PRAGMA table_info` + `if coluna not in colunas: ALTER TABLE` — **25
  `ALTER TABLE`** no total (6 em `input_module`, 17 em `coffee_module`, 2
  em `carteira_module`). Isso é um sistema de migração caseiro, sem
  versão, sem ordem garantida e sem rollback. O Alembic resolve isso e é
  pré-requisito para o esquema estrito do MySQL.

**Se o time preferir zero dependências novas:** dá para migrar com
PyMySQL puro + `DBUtils.PooledDB` para o pool, e versionar o esquema com
arquivos `.sql` numerados. Funciona, mas transfere para o time o
trabalho que o Alembic já faz.

### 5.3 Pool de conexões — não é opcional

Hoje cada função de acesso abre e fecha a própria conexão. Em SQLite,
abrir é abrir um arquivo. Em MySQL, é TCP + handshake de autenticação.
Rotas que hoje chamam três ou quatro funções de `db.py` pagariam esse
custo três ou quatro vezes por requisição.

Adotar um Engine único por processo, com `pool_size` e `pool_recycle`
(abaixo do `wait_timeout` do servidor), e passar a conexão adiante nas
funções que hoje abrem a sua. É a mudança estrutural mais importante do
lado do código — e a que dá para **começar já, ainda em SQLite** (§7,
Fase 1).

---

## 6. Catálogo de incompatibilidades

Cada item abaixo foi localizado no código atual. É a lista de trabalho
concreta da migração.

### 6.1 `Check` é palavra reservada no MySQL — **bloqueante**

A coluna `"Check"` de `notas` (criada em `input_module/db.py:190` e
adicionada por `ALTER` na linha 289) usa aspas duplas, sintaxe do SQLite.
No MySQL, `CHECK` é palavra reservada e identificadores usam crase.

Duas saídas: escapar com crase em **todo** ponto de uso, ou renomear a
coluna. **Renomear é preferível** — é a única renomeação que vale fazer
junto com a migração, porque o custo de conviver com um identificador
reservado é permanente. A coluna aparece no frontend (`columns.ts`,
`NOTA_VAZIA` em `manage.tsx`), na exportação Excel e no de-para do
`integracao_module` (`CAMPOS_MANUAIS`).

### 6.2 `PRAGMA` — 25 ocorrências

| Pragma | Onde | Substituto |
|---|---|---|
| `journal_mode = WAL` | `input`, `coffee`, `carteira` | Nada. InnoDB já é MVCC |
| `synchronous`, `busy_timeout`, `foreign_keys` | idem | Configuração do servidor / `innodb_lock_wait_timeout` |
| `table_info(x)` | 3 módulos, migração de esquema | `information_schema.COLUMNS` — ou, melhor, sumir com o padrão via Alembic |
| `schema_version` | `obter_versao_dataset()` (`db.py:1448`) | **Sem equivalente** — ver §6.7 |
| `query_only = ON` | `verificar_module` | Usuário MySQL somente-leitura (mas este módulo fica em SQLite, §4.2) |

### 6.3 Upsert — `ON CONFLICT` → `ON DUPLICATE KEY UPDATE`

Sete ocorrências: `input_module/db.py:688,886,1008,1531`,
`coffee_module/db.py:436,465`, `carteira_module/db.py:149`.

```sql
-- SQLite (hoje)
INSERT INTO carteira_meta(chave, valor) VALUES(?, ?)
  ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor;

-- MySQL 8.0.20+
INSERT INTO carteira_meta(chave, valor) VALUES(%s, %s) AS novo
  ON DUPLICATE KEY UPDATE valor = novo.valor;
```

Atenção: o `excluded.` do SQLite vira o alias de linha (`AS novo`) no
MySQL 8.0.20+. Em versões anteriores é `VALUES(valor)`, hoje depreciado.
Mais uma razão para exigir **MySQL 8.0.20 ou superior**.

### 6.4 `UPDATE ... FROM` — reconciliação da Carteira

`carteira_module/repository.py:99-106` usa `UPDATE ... FROM staging`
(sintaxe SQLite 3.33+, herdada do PostgreSQL). O comentário no código
registra que essa forma substituiu uma subconsulta correlacionada que
era inviável em 98k linhas — ou seja, **o desempenho aqui é sensível**.

```sql
-- MySQL
UPDATE nota_carteira n
  JOIN nota_carteira_staging s ON n.id_onr = s.id_onr
   SET n.col = s.col, ..., n.sincronizado_em = %s
 WHERE n.hash_conteudo <> s.hash_conteudo;
```

A tradução é direta e o MySQL a executa bem, desde que a staging mantenha
a PK em `id_onr` (o código já cria assim, deliberadamente).

### 6.5 Tabelas efêmeras e DDL transacional — **armadilha**

No MySQL, **DDL provoca commit implícito**. Dois pontos quebram:

1. **`nota_carteira_staging`** — `DROP` + `CREATE` a cada sincronização
   (`repository.py:38-50`). Hoje isso convive com a transação de
   reconciliação. No MySQL, o `CREATE TABLE` encerraria a transação
   aberta silenciosamente. **Correção:** criar a staging uma vez, no
   esquema versionado, e usar `TRUNCATE`/`DELETE` entre execuções.

2. **`plano_atual`** — `CREATE TEMP TABLE` por requisição
   (`repository.py:131-137`). No MySQL, `TEMPORARY TABLE` tem escopo de
   **conexão** — e com pool de conexões (§5.3) a mesma conexão é
   reutilizada por requisições diferentes, deixando resíduo entre elas.
   **Correção:** `DROP TEMPORARY TABLE IF EXISTS` no início de cada uso e
   garantir que criação e consumo aconteçam na **mesma** conexão
   emprestada do pool — ou substituir por CTE (`WITH`), disponível no
   MySQL 8.

3. **`salvar_base_dataframe`** — `to_sql(if_exists="replace")` também é
   DROP+CREATE, oito tabelas, a cada importação de base (§6.8).

### 6.6 Sintaxe pontual

| Padrão | Onde | MySQL |
|---|---|---|
| `AUTOINCREMENT` | 8 tabelas | `AUTO_INCREMENT` |
| `INSERT OR IGNORE` | `carteira_module/repository.py:136` | `INSERT IGNORE` |
| `INSERT OR REPLACE` | `perf_coffee.py:71` | `REPLACE INTO` |
| `BEGIN IMMEDIATE` | 5 pontos no Input | `START TRANSACTION` + `SELECT … FOR UPDATE` na linha disputada |
| Placeholder `?` | Todo o código e `pd.read_sql` | `%s` (ou parâmetros nomeados via SQLAlchemy `text()`) |
| `sqlite3.Row` | `carteira_module/db.py:22` | `pymysql.cursors.DictCursor` |
| `conn.backup()` | `input_module/db.py:403` | `mysqldump` / snapshot da instância |
| `sqlite_master` | `verificar_module/source.py:61` | `information_schema.TABLES` (módulo fica em SQLite) |
| `CHECK (id = 1)` | `metas_sync_estado` | MySQL 8.0.16+ aplica `CHECK` de verdade — funciona |

### 6.7 `obter_versao_dataset()` precisa de outra fonte

`input_module/db.py:1428` monta a versão do dataset — usada como **ETag
HTTP** de `GET /notas` e como moeda de invalidação do cache do frontend
— concatenando cinco valores, entre eles `PRAGMA schema_version`.

Esse pragma existe para detectar as trocas de tabela de base do §6.8, que
não passam pelo log de arquivos. **No MySQL não há equivalente.**

**Correção proposta:** uma tabela `dataset_versao` (ou uma chave em
`carteira_meta`, generalizada) incrementada explicitamente por todo
caminho de escrita, inclusive pela importação de bases. É mais correto
que o pragma — hoje a versão depende de um efeito colateral do formato
de arquivo — mas exige cobrir **todos** os caminhos de escrita, sob pena
de o navegador receber `304` e servir dado velho.

### 6.8 As oito tabelas dinâmicas

`salvar_base_dataframe()` deixa o pandas inferir o esquema a partir do
Excel do dia. Num banco estrito isso é insustentável: uma coluna que
mudou de nome no Excel viraria uma tabela com esquema diferente, e
`carregar_base_dataframe()` faz `SELECT *` sem validar nada.

**Correção proposta:** declarar as oito tabelas no esquema versionado,
com colunas e tipos explícitos, e trocar o `if_exists="replace"` por
`TRUNCATE` + `INSERT` dentro de transação. Ganha-se validação na
importação — uma planilha fora do formato falha na hora, com mensagem,
em vez de corromper o relatório silenciosamente três telas adiante.

Isso exige levantar o esquema real de cada uma das oito bases a partir
de um arquivo de produção. **É o item de maior esforço da migração** e
o mais fácil de subestimar.

### 6.9 Saneamento de dados

| Item | Situação | Ação |
|---|---|---|
| `Status_Nota` | `INTEGER` em `notas`, `TEXT` em `notas_ramal` | Unificar em `SMALLINT`, com `STATUS_MAP`/`INV_STATUS_MAP` (`input_module/config.py:147`) como única tradução |
| `Nota_Mae` | `TEXT` com default `'-'`, sentinelas `'None'`/`'null'` | Converter para `INT UNSIGNED NULL`; `'-'`, `''`, `'None'`, `'null'` → `NULL`. Pré-requisito da FK do §3.4 |
| Datas | TEXT ISO em quase tudo | `DATETIME`; validar que não há formato divergente antes de converter |
| `Mes_Execucao_Planejado` | TEXT `mmm-aaaa` (ex.: `ago-2026`) | **Manter TEXT.** É um rótulo de planejamento com valores especiais (`jan-2050`), não uma data |
| Booleanos | `INTEGER` 0/1, alguns `NULL` | `TINYINT(1)`; decidir o significado de `arquivado IS NULL` |
| `latitude`/`longitude` | TEXT | `DECIMAL(10,7)`; verificar separador decimal |

### 6.10 O que a tabela `bloqueios` vira

Com InnoDB, boa parte do que a `bloqueios` compensa (`SELECT … FOR
UPDATE` resolve a corrida de escrita) some. **Mas ela não deve ser
removida:** ela também é *interface* — o frontend mostra o cadeado com o
nome de quem está editando (`NotesTable`, `use-bloqueios.ts`), e uma
trava de banco não sobrevive ao fim da transação nem tem nome de usuário
associado.

**Recomendação:** manter `bloqueios` como trava lógica de longa duração
(a sessão de edição do usuário, TTL de 20 min), e usar `FOR UPDATE`
apenas para a atomicidade da escrita em si. Os dois mecanismos passam a
ter responsabilidades distintas, em vez de um substituir o outro.

---

## 7. Plano de migração por fases

As fases 1 e 2 rodam **sobre o SQLite atual**, sem migrar nada. Elas
reduzem o risco do corte e podem ser feitas em paralelo com as sprints,
em incrementos pequenos.

### Fase 0 — Decisões e provisionamento *(não escreve código)*

- Resolver as **DECISÕES NECESSÁRIAS #1 e #2** (§4.1, §4.3).
- Provisionar a instância MySQL 8.0.20+ de desenvolvimento.
- Levantar o esquema real das oito tabelas de base (§6.8) a partir de um
  banco de produção.
- Medir o baseline: tamanho de cada tabela, tempo das rotas mais lentas.

**Saída:** decisões registradas, instância de dev no ar, esquema das
bases levantado.

### Fase 1 — Pool e camada de acesso *(ainda em SQLite)*

- Introduzir SQLAlchemy Core com Engine único por processo.
- Converter `get_db_connection()` / `conectar()` para entregar conexão do
  pool.
- Propagar conexão nas funções que hoje abrem a sua — as transações
  passam a ter fronteira explícita.
- Manter o dialeto SQLite. Nada muda para o usuário.

**Por que primeiro:** é a mudança de maior alcance no código e a que mais
se beneficia de ser feita isoladamente, com os testes atuais como rede.

### Fase 2 — Esquema versionado *(ainda em SQLite)*

- Introduzir Alembic; gerar a migração inicial a partir do esquema atual.
- Substituir os 25 blocos `PRAGMA table_info` + `ALTER` por migrações.
- Declarar as oito tabelas de base explicitamente; trocar
  `to_sql(replace)` por `TRUNCATE` + `INSERT` validado.
- Criar a tabela `dataset_versao` e passar a incrementá-la nos caminhos
  de escrita, ainda **em paralelo** com o `PRAGMA schema_version` — para
  comparar os dois e provar que nenhum caminho ficou de fora antes de
  remover o pragma.

### Fase 3 — Saneamento de dados *(ainda em SQLite)*

- Aplicar o §6.9: `Nota_Mae` para inteiro, `Status_Nota` unificado,
  datas normalizadas, booleanos consistentes.
- Renomear a coluna `Check` (§6.1) — toca backend, frontend e exportação.
- Cada item vira uma migração Alembic reversível, com teste.

**Ao fim da Fase 3 o sistema ainda roda em SQLite, mas já com um esquema
que o MySQL aceitaria.** Este é o marco que torna o corte previsível.

### Fase 4 — Compatibilidade de dialeto

- Traduzir os itens do §6.3 a §6.6.
- Criar a staging da Carteira no esquema; substituir a TEMP TABLE
  `plano_atual` por CTE ou uso na mesma conexão.
- Rodar a suíte de testes contra MySQL (contêiner no CI) **e** contra
  SQLite, até o corte.

> **Nota de esforço:** a suíte atual (`test_input_module.py`,
> `test_carteira_module.py`, `test_coffee_module.py`) cria bancos SQLite
> temporários direto. Rodá-la contra MySQL exige parametrizar as fixtures
> por dialeto — trabalho não trivial, a orçar junto com esta fase.

### Fase 5 — Carga inicial e validação

- ETL: ler cada tabela do SQLite, aplicar de/para de tipos, gravar no
  MySQL em lote.
- **Validação obrigatória, por tabela:** contagem de linhas; soma de
  colunas numéricas; hash do conteúdo ordenado por PK; amostragem manual
  das 20 notas mais recentes.
- Ensaiar o ETL pelo menos duas vezes em homologação, com dado real de
  produção, cronometrando — o tempo de carga define a janela do corte.

### Fase 6 — Corte

- Janela com o sistema fora do ar (o caminho mais simples e seguro; a
  alternativa de escrita dupla dobra a complexidade e só se justifica se
  a indisponibilidade for inaceitável).
- Congelar escritas → ETL final → validar → apontar a aplicação → testes
  de fumaça → liberar.
- **Rollback:** manter o `.db` congelado intacto e a versão anterior da
  aplicação pronta para subir. O critério de rollback e o prazo máximo da
  janela devem estar escritos **antes** de começar.

### Fase 7 — Pós-corte

- Remover as travas em Python que só existiam por causa do escritor único
  (§2.8), **uma de cada vez**, com teste de concorrência.
- Remover `migrar_da_rede_se_preciso()`, `realizar_backup()` e o fluxo de
  backups `.db`; substituir por `mysqldump` agendado.
- Ativar as FKs do §3.4 (depois de confirmar que os dados as respeitam).
- Atualizar `docs/dev/00-overview.md`, `06-backend-input-module.md`,
  `05-backend-coffee-module.md` e `10-backend-carteira-module.md`.
- Revisar o rótulo "Rede EDP · SQLite Local" no cabeçalho do frontend
  (`input-section.tsx:81`).

---

## 8. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| App legado escreve no banco compartilhado | **Bloqueante** — migração parcial corrompe dados | DECISÃO #1 na Fase 0; sem ela, não começar |
| Esquema real das bases de apoio desconhecido | Alto — retrabalho na Fase 2 | Levantar de produção na Fase 0 |
| Suíte de testes só roda em SQLite | Alto — migração sem rede de segurança | Parametrizar fixtures na Fase 4, orçado à parte |
| Regressão de desempenho na Carteira (98k linhas) | Médio | Baseline na Fase 0; comparar as mesmas rotas depois |
| `dataset_versao` incompleta → navegador serve `304` com dado velho | Médio, silencioso | Rodar em paralelo com o pragma na Fase 2 antes de remover |
| Corrupção de acento por charset errado | Alto, irreversível sem restore | `utf8mb4` da criação; validar acentuação no ETL de ensaio |
| Janela de corte maior que o previsto | Médio | Dois ensaios cronometrados; prazo e critério de rollback definidos antes |

---

## 9. Checklist de "pronto para começar"

- [ ] DECISÃO #1 — destino de `Sap_Robot.py` e do app legado
- [ ] DECISÃO #2 — onde a instância MySQL vai rodar, e quem administra
- [ ] MySQL 8.0.20+ confirmado (§6.3, §3.5)
- [ ] Esquema real das 8 tabelas de base levantado de produção
- [ ] Baseline de volume e desempenho medido
- [ ] Estratégia de backup e retenção definida com quem administra
- [ ] Esforço da parametrização dos testes por dialeto estimado
- [ ] Janela de corte, critério de rollback e responsável acordados

---

## 10. Referências no código

| Assunto | Arquivo |
|---|---|
| Esquema e escrita do Input | `backend/input_module/db.py` |
| Perfis e caminhos de banco | `backend/input_module/config.py` |
| Esquema e escrita do COFFEE | `backend/coffee_module/db.py` |
| Esquema da Carteira | `backend/carteira_module/db.py` |
| SQL da Carteira (staging, reconciliação) | `backend/carteira_module/repository.py` |
| Fonte somente-leitura da triagem | `backend/verificar_module/source.py` |
| Cruzamento COFFEE ↔ Input | `backend/integracao_module/mapping.py` |
| Escritor externo do banco compartilhado | `backend/Sap_Robot.py` |
