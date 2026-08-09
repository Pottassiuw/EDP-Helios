"""Persistência local do módulo COFFEE (SQLite) com snapshot de id_sap."""
import contextvars
import datetime
import getpass
import json
import os
import sqlite3

from coffee_module import config
from coffee_module.classify import classificar


_usuario_req: contextvars.ContextVar = contextvars.ContextVar("coffee_usuario", default=None)


def definir_usuario(usuario: str | None) -> None:
    """Define o usuário da operação atual (por requisição / por thread de job)."""
    _usuario_req.set(usuario)


def _usuario_atual() -> str:
    """Usuário identificado (contextvar via X-User) ou fallback da máquina (best-effort)."""
    usuario_req = _usuario_req.get()
    if usuario_req:
        return usuario_req
    try:
        nome = getpass.getuser()
        if nome:
            return nome
    except Exception:  # noqa: BLE001
        pass
    return os.environ.get("USERNAME") or os.environ.get("USER") or "desconhecido"

_trace_atual: contextvars.ContextVar = contextvars.ContextVar("coffee_trace", default=None)
_ETAPAS_OPERACAO = {"fila", "pronta", "processando", "aguardando_sap"}


def definir_trace(trace_id) -> None:
    """Define o trace_id da operação atual (por requisição / por thread de job)."""
    _trace_atual.set(trace_id)


def trace_atual():
    return _trace_atual.get()


_COLUNAS = ["pk", "id_sap", "id_sap_anterior", "arquivado",
            "classificacao", "dados_json", "buscado_em", "erro", "a_gerar", "origem",
            "classificacao_em", "usuario", "verificar_id", "verificar_ativa",
            "verificar_em", "verificar_por", "encaminhada_em", "encaminhada_por",
            "retornada_em", "retornada_por", "retorno_justificativa",
            "corrigida_em", "corrigida_por"]


def _linha_para_dict(row: tuple) -> dict:
    d = dict(zip(_COLUNAS, row))
    d["arquivado"] = bool(d["arquivado"]) if d["arquivado"] is not None else None
    d["a_gerar"] = bool(d["a_gerar"])
    d["verificar_ativa"] = bool(d["verificar_ativa"])
    d["dados_json"] = json.loads(d["dados_json"]) if d["dados_json"] else None
    return d


def obter_caminho_banco() -> str:
    return str(config.data_dir() / "coffee.db")


def get_db_connection() -> sqlite3.Connection:
    config.data_dir().mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(obter_caminho_banco(), timeout=30, check_same_thread=False)
    # WAL fica persistido no arquivo e deve ser configurado apenas na
    # inicialização. Reexecutar esse PRAGMA ao abrir conexões concorrentes
    # exige lock exclusivo e pode bloquear jobs em andamento.
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    return conn


def inicializar_banco() -> None:
    conn = get_db_connection()
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notas_coffee (
            pk              INTEGER PRIMARY KEY,
            id_sap          INTEGER,
            id_sap_anterior INTEGER,
            arquivado       INTEGER,
            classificacao   TEXT,
            dados_json      TEXT,
            buscado_em      TEXT,
            erro            TEXT,
            a_gerar         INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    cols_notas = [r[1] for r in conn.execute("PRAGMA table_info(notas_coffee)").fetchall()]
    if "a_gerar" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN a_gerar INTEGER NOT NULL DEFAULT 0")
    if "origem" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN origem TEXT")
    if "classificacao_em" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN classificacao_em TEXT")
    if "usuario" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN usuario TEXT")
    if "verificar_id" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN verificar_id INTEGER")
    if "verificar_ativa" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN verificar_ativa INTEGER NOT NULL DEFAULT 0")
    if "verificar_em" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN verificar_em TEXT")
    if "verificar_por" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN verificar_por TEXT")
    if "encaminhada_em" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN encaminhada_em TEXT")
    if "encaminhada_por" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN encaminhada_por TEXT")
    if "retornada_em" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN retornada_em TEXT")
    if "retornada_por" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN retornada_por TEXT")
    if "retorno_justificativa" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN retorno_justificativa TEXT")
    if "corrigida_em" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN corrigida_em TEXT")
    if "corrigida_por" not in cols_notas:
        conn.execute("ALTER TABLE notas_coffee ADD COLUMN corrigida_por TEXT")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS coffee_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   TEXT NOT NULL,
            tipo        TEXT NOT NULL,
            acao        TEXT NOT NULL,
            nota_pk     INTEGER,
            detalhes    TEXT,
            sucesso     INTEGER NOT NULL,
            usuario     TEXT,
            trace_id    TEXT
        )
        """
    )
    cols_logs = [r[1] for r in conn.execute("PRAGMA table_info(coffee_logs)").fetchall()]
    if "usuario" not in cols_logs:
        conn.execute("ALTER TABLE coffee_logs ADD COLUMN usuario TEXT")
    if "trace_id" not in cols_logs:
        conn.execute("ALTER TABLE coffee_logs ADD COLUMN trace_id TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_nota_pk ON coffee_logs(nota_pk)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_tipo ON coffee_logs(tipo)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON coffee_logs(timestamp)")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS coffee_operacoes (
            id              TEXT PRIMARY KEY,
            tipo            TEXT NOT NULL,
            estado          TEXT NOT NULL,
            total           INTEGER NOT NULL,
            feitas          INTEGER NOT NULL DEFAULT 0,
            resultado_json  TEXT NOT NULL DEFAULT '{"erros":[]}',
            iniciado_em     TEXT NOT NULL,
            atualizado_em   TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS coffee_fila_operacao (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            entrada_id     INTEGER NOT NULL UNIQUE,
            nota_pk        INTEGER UNIQUE,
            etapa          TEXT NOT NULL,
            origem         TEXT,
            operacao_id    TEXT,
            erro           TEXT,
            criado_em      TEXT NOT NULL,
            atualizado_em  TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fila_etapa "
        "ON coffee_fila_operacao(etapa)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_fila_operacao "
        "ON coffee_fila_operacao(operacao_id)"
    )
    conn.commit()
    conn.close()
    interromper_operacoes_em_andamento()


def criar_operacao(operacao_id: str, tipo: str, total: int) -> dict:
    agora = datetime.datetime.now().isoformat()
    snapshot = {
        "id": operacao_id,
        "tipo": tipo,
        "estado": "rodando",
        "total": total,
        "feitas": 0,
        "erros": [],
        "iniciado_em": agora,
        "atualizado_em": agora,
    }
    conn = get_db_connection()
    conn.execute(
        """
        INSERT INTO coffee_operacoes
            (id, tipo, estado, total, feitas, resultado_json,
             iniciado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            operacao_id, tipo, "rodando", total, 0,
            json.dumps({"erros": []}, ensure_ascii=False),
            agora, agora,
        ),
    )
    conn.commit()
    conn.close()
    return snapshot


def salvar_operacao(operacao_id: str, snapshot: dict) -> None:
    agora = datetime.datetime.now().isoformat()
    extras = {
        chave: valor
        for chave, valor in snapshot.items()
        if chave not in {
            "id", "tipo", "estado", "total", "feitas",
            "iniciado_em", "atualizado_em",
        }
    }
    conn = get_db_connection()
    conn.execute(
        """
        UPDATE coffee_operacoes
        SET estado = ?, feitas = ?, resultado_json = ?, atualizado_em = ?
        WHERE id = ?
        """,
        (
            snapshot["estado"],
            snapshot["feitas"],
            json.dumps(extras, ensure_ascii=False, default=str),
            agora,
            operacao_id,
        ),
    )
    conn.commit()
    conn.close()


def obter_operacao(operacao_id: str) -> dict | None:
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT id, tipo, estado, total, feitas, resultado_json,
               iniciado_em, atualizado_em
        FROM coffee_operacoes WHERE id = ?
        """,
        (operacao_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return None
    extras = json.loads(row[5]) if row[5] else {}
    return {
        "id": row[0],
        "tipo": row[1],
        "estado": row[2],
        "total": row[3],
        "feitas": row[4],
        **extras,
        "iniciado_em": row[6],
        "atualizado_em": row[7],
    }


def listar_operacoes_ativas() -> list[dict]:
    conn = get_db_connection()
    ids = conn.execute(
        "SELECT id FROM coffee_operacoes WHERE estado = 'rodando' "
        "ORDER BY iniciado_em"
    ).fetchall()
    conn.close()
    return [
        operacao
        for (operacao_id,) in ids
        if (operacao := obter_operacao(operacao_id)) is not None
    ]


def upsert_item_operacao(
    entrada_id: int,
    etapa: str,
    origem: str | None,
    nota_pk: int | None = None,
    operacao_id: str | None = None,
    erro: str | None = None,
) -> dict:
    if etapa not in _ETAPAS_OPERACAO:
        raise ValueError(f"Etapa inválida: {etapa}")
    agora = datetime.datetime.now().isoformat()
    conn = get_db_connection()
    existentes = conn.execute(
        """
        SELECT id, entrada_id, nota_pk, origem, criado_em
        FROM coffee_fila_operacao
        WHERE entrada_id = ?
           OR (? IS NOT NULL AND entrada_id = ?)
           OR (? IS NOT NULL AND nota_pk = ?)
        ORDER BY CASE WHEN nota_pk IS NOT NULL THEN 0 ELSE 1 END, id
        """,
        (entrada_id, nota_pk, nota_pk, nota_pk, nota_pk),
    ).fetchall()
    if existentes:
        alvo = existentes[0]
        ids_duplicados = [row[0] for row in existentes[1:]]
        if ids_duplicados:
            marcadores = ",".join("?" for _ in ids_duplicados)
            conn.execute(
                f"DELETE FROM coffee_fila_operacao WHERE id IN ({marcadores})",
                tuple(ids_duplicados),
            )
        entrada_final = alvo[1]
        origem_final = alvo[3] or origem
        conn.execute(
            """
            UPDATE coffee_fila_operacao
            SET entrada_id = ?, nota_pk = COALESCE(?, nota_pk),
                etapa = ?, origem = ?, operacao_id = ?,
                erro = ?, atualizado_em = ?
            WHERE id = ?
            """,
            (
                entrada_final, nota_pk, etapa, origem_final, operacao_id,
                erro, agora, alvo[0],
            ),
        )
    else:
        conn.execute(
            """
            INSERT INTO coffee_fila_operacao
                (entrada_id, nota_pk, etapa, origem, operacao_id, erro,
                 criado_em, atualizado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                entrada_id, nota_pk, etapa, origem, operacao_id, erro,
                agora, agora,
            ),
        )
    conn.commit()
    conn.close()
    return next(
        item for item in listar_itens_operacao()
        if item["entrada_id"] == entrada_id or item["nota_pk"] == nota_pk
    )


def listar_itens_operacao() -> list[dict]:
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT entrada_id, nota_pk, etapa, origem, operacao_id, erro,
               criado_em, atualizado_em
        FROM coffee_fila_operacao
        ORDER BY atualizado_em DESC
        """
    ).fetchall()
    conn.close()
    chaves = [
        "entrada_id", "nota_pk", "etapa", "origem",
        "operacao_id", "erro", "criado_em", "atualizado_em",
    ]
    return [dict(zip(chaves, row)) for row in rows]


def remover_item_operacao(nota_pk: int) -> None:
    conn = get_db_connection()
    conn.execute(
        "DELETE FROM coffee_fila_operacao "
        "WHERE nota_pk = ? OR entrada_id = ?",
        (nota_pk, nota_pk),
    )
    conn.commit()
    conn.close()


def interromper_operacoes_em_andamento() -> None:
    agora = datetime.datetime.now().isoformat()
    mensagem = (
        "Operação interrompida; reconsulte antes de tentar novamente."
    )
    conn = get_db_connection()
    conn.execute(
        """
        UPDATE coffee_operacoes
        SET estado = 'interrompida', atualizado_em = ?
        WHERE estado = 'rodando'
        """,
        (agora,),
    )
    conn.execute(
        """
        UPDATE coffee_fila_operacao
        SET etapa = 'pronta', erro = ?, operacao_id = NULL,
            atualizado_em = ?
        WHERE etapa = 'processando'
        """,
        (mensagem, agora),
    )
    conn.commit()
    conn.close()


def upsert_nota(pk: int, id_sap: int, dados_json: dict) -> str:
    # ponytail: arquivado intencionalmente excluído — representa ação do usuário no nosso
    # app (via arquivar_nota), não o estado do COFFEE (que arquiva como workflow normal).
    conn = get_db_connection()
    row = conn.execute(
        "SELECT id_sap, classificacao, origem FROM notas_coffee WHERE pk = ?", (pk,)
    ).fetchone()
    id_sap_anterior = row[0] if row is not None else None
    classe_anterior = row[1] if row is not None else None
    origem = row[2] if row is not None else None
    classe = classificar(id_sap, id_sap_anterior, origem)
    agora = datetime.datetime.now().isoformat()
    conn.execute(
        """
        INSERT INTO notas_coffee
            (pk, id_sap, id_sap_anterior, arquivado, classificacao, dados_json,
             buscado_em, erro, classificacao_em, usuario)
        VALUES (?, ?, ?, 0, ?, ?, ?, NULL, ?, ?)
        ON CONFLICT(pk) DO UPDATE SET
            id_sap=excluded.id_sap, id_sap_anterior=excluded.id_sap_anterior,
            classificacao=excluded.classificacao,
            dados_json=excluded.dados_json, buscado_em=excluded.buscado_em, erro=NULL,
            classificacao_em=CASE
                WHEN notas_coffee.classificacao IS excluded.classificacao
                THEN notas_coffee.classificacao_em
                ELSE excluded.classificacao_em END,
            usuario=COALESCE(notas_coffee.usuario, excluded.usuario)
        """,
        (pk, id_sap, id_sap_anterior, classe,
         json.dumps(dados_json, ensure_ascii=False), agora, agora, _usuario_atual()),
    )
    conn.commit()
    conn.close()
    if row is not None and classe_anterior is not None and classe != classe_anterior:
        registrar_log("transicao", "classificar", pk,
                      {"anterior": classe_anterior, "novo": classe,
                       "id_sap_anterior": id_sap_anterior, "id_sap_atual": id_sap}, True)
        if classe == "corrigida":
            registrar_correcao(pk)
    return classe


def registrar_erro(pk: int, mensagem: str) -> None:
    conn = get_db_connection()
    conn.execute(
        """
        INSERT INTO notas_coffee (pk, erro, buscado_em, usuario) VALUES (?, ?, ?, ?)
        ON CONFLICT(pk) DO UPDATE SET
            erro=excluded.erro, buscado_em=excluded.buscado_em,
            usuario=COALESCE(notas_coffee.usuario, excluded.usuario)
        """,
        (pk, mensagem, datetime.datetime.now().isoformat(), _usuario_atual()),
    )
    conn.commit()
    conn.close()


def arquivar_nota(pk: int) -> None:
    conn = get_db_connection()
    conn.execute("UPDATE notas_coffee SET arquivado = 1 WHERE pk = ?", (pk,))
    conn.commit()
    conn.close()


def listar_notas(status: str | None = None, usuario: str | None = None) -> list:
    conn = get_db_connection()
    sql = f"SELECT {', '.join(_COLUNAS)} FROM notas_coffee"
    clausulas: list[str] = []
    params: list = []
    if status == "a_gerar":
        clausulas.append("a_gerar = 1")
    elif status == "concluida":
        clausulas.append("classificacao IN ('gerada', 'corrigida')")
    elif status in {"gerada", "corrigida", "pendente", "nao_gerada"}:
        clausulas.append("classificacao = ?")
        params.append(status)
    elif status:
        clausulas.append("1 = 0")
    clausulas.append("(arquivado IS NULL OR arquivado = 0)")
    if usuario:
        clausulas.append("(usuario = ? OR usuario IS NULL)")
        params.append(usuario)
    sql += " WHERE " + " AND ".join(clausulas)
    rows = conn.execute(sql, tuple(params)).fetchall()
    conn.close()
    return [_linha_para_dict(r) for r in rows]


def obter_nota(pk: int) -> dict | None:
    """Linha única de notas_coffee com dados_json parseado (mesma forma de listar_notas).

    Respeita o mesmo filtro de arquivamento local que listar_notas — uma nota
    arquivada pelo usuário (arquivar_nota) não deve ficar acessível para
    revisão/movimentação por outros módulos.
    """
    conn = get_db_connection()
    row = conn.execute(
        f"SELECT {', '.join(_COLUNAS)} FROM notas_coffee "
        "WHERE pk = ? AND (arquivado IS NULL OR arquivado = 0)", (pk,)
    ).fetchone()
    conn.close()
    return _linha_para_dict(row) if row is not None else None


def marcar_gerar(pk: int, a_gerar: bool) -> None:
    """Liga/desliga a flag a_gerar de uma nota existente."""
    conn = get_db_connection()
    conn.execute("UPDATE notas_coffee SET a_gerar = ? WHERE pk = ?",
                 (1 if a_gerar else 0, pk))
    conn.commit()
    conn.close()


def definir_origem(pk: int, origem: str) -> None:
    """Marca a origem da nota ('avulsa' | 'verificar')."""
    conn = get_db_connection()
    conn.execute("UPDATE notas_coffee SET origem = ? WHERE pk = ?", (origem, pk))
    conn.commit()
    conn.close()


def registrar_origem_verificar(pk: int, verificar_id: int) -> None:
    """Registra a primeira entrada da nota na triagem, sem perder o histórico."""
    agora = datetime.datetime.now().isoformat()
    conn = get_db_connection()
    conn.execute(
        """
        UPDATE notas_coffee
        SET origem = 'verificar', verificar_id = ?, verificar_ativa = 1,
            verificar_em = COALESCE(verificar_em, ?),
            verificar_por = COALESCE(verificar_por, ?),
            encaminhada_em = ?, encaminhada_por = ?,
            retornada_em = NULL, retornada_por = NULL,
            retorno_justificativa = NULL
        WHERE pk = ?
        """,
        (verificar_id, agora, _usuario_atual(), agora, _usuario_atual(), pk),
    )
    conn.commit()
    conn.close()


def desativar_verificar(verificar_id: int) -> None:
    """Torna a nota novamente visível na triagem após remoção da fila."""
    conn = get_db_connection()
    conn.execute(
        "UPDATE notas_coffee SET verificar_ativa = 0 WHERE verificar_id = ?",
        (verificar_id,),
    )
    conn.commit()
    conn.close()


def desativar_verificar_por_pk(pk: int) -> None:
    """Torna novamente visível uma nota removida da fila pelo seu PK COFFEE."""
    conn = get_db_connection()
    conn.execute(
        "UPDATE notas_coffee SET verificar_ativa = 0 WHERE pk = ?",
        (pk,),
    )
    conn.commit()
    conn.close()


def registrar_retorno_verificar(pk: int, justificativa: str) -> None:
    """Registra o retorno justificado da Operação para a triagem."""
    conn = get_db_connection()
    conn.execute(
        """
        UPDATE notas_coffee
        SET verificar_ativa = 0, retornada_em = ?, retornada_por = ?,
            retorno_justificativa = ?
        WHERE pk = ? AND origem = 'verificar'
        """,
        (datetime.datetime.now().isoformat(), _usuario_atual(), justificativa, pk),
    )
    conn.commit()
    conn.close()


def resumo_triagem_verificar() -> dict:
    """Retorna o estado operacional e os encaminhamentos de Verificar no dia."""
    conn = get_db_connection()
    try:
        ativos = conn.execute(
            """
            SELECT n.verificar_id, n.verificar_ativa, n.encaminhada_em,
                   n.encaminhada_por, n.retornada_em, n.retornada_por,
                   n.retorno_justificativa, f.etapa, f.erro
            FROM notas_coffee n
            LEFT JOIN coffee_fila_operacao f ON f.nota_pk = n.pk
            WHERE n.verificar_id IS NOT NULL
              AND (n.verificar_ativa = 1 OR n.retorno_justificativa IS NOT NULL)
            """
        ).fetchall()
        hoje = conn.execute(
            """
            SELECT COALESCE(encaminhada_por, 'Desconhecido'), COUNT(*)
            FROM notas_coffee
            WHERE verificar_id IS NOT NULL
              AND date(encaminhada_em) = date('now', 'localtime')
            GROUP BY encaminhada_por
            ORDER BY COUNT(*) DESC, encaminhada_por COLLATE NOCASE
            """
        ).fetchall()
    except sqlite3.OperationalError:
        return {"encaminhamentos": {}, "encaminhadas_hoje": []}
    finally:
        conn.close()

    encaminhamentos = {
        str(verificar_id): {
            "situacao": (
                "retornada" if not verificar_ativa
                else "falha_operacional" if erro else "encaminhada"
            ),
            "etapa": etapa,
            "erro": erro,
            "encaminhada_em": encaminhada_em,
            "encaminhada_por": encaminhada_por,
            "retornada_em": retornada_em,
            "retornada_por": retornada_por,
            "retorno_justificativa": retorno_justificativa,
        }
        for (
            verificar_id,
            verificar_ativa,
            encaminhada_em,
            encaminhada_por,
            retornada_em,
            retornada_por,
            retorno_justificativa,
            etapa,
            erro,
        ) in ativos
    }
    return {
        "encaminhamentos": encaminhamentos,
        "encaminhadas_hoje": [
            {"usuario": usuario, "total": total} for usuario, total in hoje
        ],
    }


def ids_verificar_em_correcao() -> set[str]:
    """IDs da fonte que seguem em tratamento no COFFEE."""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT verificar_id FROM notas_coffee
            WHERE verificar_ativa = 1 AND verificar_id IS NOT NULL
              AND classificacao IN ('nao_gerada', 'pendente')
            """
        ).fetchall()
    except sqlite3.OperationalError:
        return set()
    finally:
        conn.close()
    return {str(row[0]) for row in rows}


def ids_verificar_corrigidos() -> set[str]:
    """IDs da fonte que receberam SAP real após serem tratados no COFFEE."""
    conn = get_db_connection()
    try:
        rows = conn.execute(
            """
            SELECT verificar_id FROM notas_coffee
            WHERE verificar_id IS NOT NULL AND classificacao = 'corrigida'
              AND id_sap IS NOT NULL AND id_sap != ?
            """,
            (config.SAP_PENDENTE,),
        ).fetchall()
    except sqlite3.OperationalError:
        return set()
    finally:
        conn.close()
    return {str(row[0]) for row in rows}


def registrar_correcao(pk: int) -> None:
    """Fixa quando e por quem a nota de Verificar recebeu SAP real."""
    agora = datetime.datetime.now().isoformat()
    conn = get_db_connection()
    conn.execute(
        """
        UPDATE notas_coffee
        SET corrigida_em = COALESCE(corrigida_em, ?),
            corrigida_por = COALESCE(corrigida_por, ?)
        WHERE pk = ? AND origem = 'verificar'
        """,
        (agora, _usuario_atual(), pk),
    )
    conn.commit()
    conn.close()


def origem_atual(pk: int) -> str | None:
    """Retorna a origem registrada da nota, ou None."""
    conn = get_db_connection()
    row = conn.execute("SELECT origem FROM notas_coffee WHERE pk = ?", (pk,)).fetchone()
    conn.close()
    return row[0] if row is not None else None


def nota_existe(pk: int) -> bool:
    conn = get_db_connection()
    row = conn.execute("SELECT 1 FROM notas_coffee WHERE pk = ?", (pk,)).fetchone()
    conn.close()
    return row is not None


# ---------------------------------------------------------------------------
# Sistema de logs (coffee_logs)
# ---------------------------------------------------------------------------

_COLUNAS_LOG = ["id", "timestamp", "tipo", "acao", "nota_pk", "detalhes", "sucesso", "usuario", "trace_id"]


def registrar_log(tipo: str, acao: str, nota_pk: int | None,
                  detalhes: dict | None, sucesso: bool) -> None:
    """Insere um registro em coffee_logs. Best-effort: nunca levanta."""
    try:
        det = json.dumps(detalhes, ensure_ascii=False, default=str) if detalhes is not None else None
        conn = get_db_connection()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS coffee_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
                tipo TEXT NOT NULL, acao TEXT NOT NULL, nota_pk INTEGER,
                detalhes TEXT, sucesso INTEGER NOT NULL, usuario TEXT, trace_id TEXT
            )
            """
        )
        conn.execute(
            "INSERT INTO coffee_logs (timestamp, tipo, acao, nota_pk, detalhes, sucesso, usuario, trace_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (datetime.datetime.now().isoformat(), tipo, acao, nota_pk, det,
             1 if sucesso else 0, _usuario_atual(), _trace_atual.get()),
        )
        conn.commit()
        conn.close()
    except Exception:  # noqa: BLE001 -- log jamais quebra a operacao primaria
        pass


def listar_usuarios_log() -> list[str]:
    conn = get_db_connection()
    rows = conn.execute(
        "SELECT DISTINCT usuario FROM coffee_logs WHERE usuario IS NOT NULL ORDER BY usuario"
    ).fetchall()
    conn.close()
    return [r[0] for r in rows]


def diagnosticar_nota(pk: int) -> dict | None:
    """Estado bruto de uma nota + seus logs, para diagnóstico de transição."""
    conn = get_db_connection()
    row = conn.execute(
        "SELECT pk, id_sap, id_sap_anterior, classificacao, arquivado, buscado_em "
        "FROM notas_coffee WHERE pk = ?", (pk,)
    ).fetchone()
    conn.close()
    if row is None:
        return None
    return {
        "pk": row[0], "id_sap": row[1], "id_sap_anterior": row[2],
        "classificacao": row[3],
        "arquivado": bool(row[4]) if row[4] is not None else None,
        "buscado_em": row[5], "logs": listar_logs(nota_pk=pk, limit=200),
    }


def listar_logs(nota_pk: int | None = None, tipo: str | None = None,
                limit: int = 100, usuario: str | None = None,
                since: str | None = None) -> list:
    conn = get_db_connection()
    sql = f"SELECT {', '.join(_COLUNAS_LOG)} FROM coffee_logs"
    clausulas: list = []
    params: list = []
    if nota_pk is not None:
        clausulas.append(
            "(nota_pk = ? OR (tipo = 'acao_usuario' AND nota_pk IS NULL AND trace_id IN "
            "(SELECT trace_id FROM coffee_logs WHERE nota_pk = ? AND trace_id IS NOT NULL)))"
        )
        params.append(nota_pk)
        params.append(nota_pk)
    if tipo:
        clausulas.append("tipo = ?")
        params.append(tipo)
    if usuario:
        clausulas.append("usuario = ?")
        params.append(usuario)
    if since:
        clausulas.append("timestamp >= ?")
        params.append(since)
    if clausulas:
        sql += " WHERE " + " AND ".join(clausulas)
    sql += " ORDER BY timestamp DESC, id DESC LIMIT ?"
    params.append(limit)
    rows = conn.execute(sql, tuple(params)).fetchall()
    conn.close()
    saida = []
    for r in rows:
        d = dict(zip(_COLUNAS_LOG, r))
        d["sucesso"] = bool(d["sucesso"])
        d["detalhes"] = json.loads(d["detalhes"]) if d["detalhes"] else None
        saida.append(d)
    return saida
