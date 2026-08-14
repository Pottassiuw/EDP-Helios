"""SQL da projecao da Carteira: staging, reconciliacao, leitura, agregados.

A situacao e derivada em SQL (via TEMP TABLE plano_atual + CASE) para
permitir filtragem e paginacao corretas. As regras batem com
situacao.derivar (funcao pura de referencia).
"""
import sqlite3

from carteira_module import db as cdb

# Colunas de negocio de nota_carteira (as produzidas por mapping.normalizar_linha).
_COLUNAS_NEGOCIO = (
    "id_onr", "id_sap", "sap_real", "conjunto", "descricao_conjunto",
    "regional", "csd_origem", "empresa", "quantidade", "quantidade_valida",
    "prioridade", "prioridade_sap", "status_sap", "data_encerramento_exec",
    "local_instalacao", "alimentador", "executor", "sintoma",
    "componente_novo", "kit", "n_trafo", "dispositivo_protecao",
    "latitude", "longitude", "observacao", "referencia_eletrica",
)

_ORDENAVEIS = {
    "id_onr", "id_sap", "regional", "conjunto", "status_sap",
    "quantidade", "data_encerramento_exec",
}

# Expressao de situacao (espelha situacao.derivar). p = LEFT JOIN plano_atual.
_SITUACAO_SQL = """
    CASE
        WHEN n.status_sap = 'Cancelado' THEN 'cancelada'
        WHEN n.status_sap = 'Encerrado' OR n.data_encerramento_exec IS NOT NULL
            THEN 'executada'
        WHEN n.sap_real = 1 AND p.numero IS NOT NULL THEN 'no_plano'
        ELSE 'fora_do_plano'
    END
"""


def carregar_staging(conn: sqlite3.Connection, notas: list[dict]) -> None:
    from carteira_module import mapping
    conn.execute("DROP TABLE IF EXISTS nota_carteira_staging")
    colunas = ", ".join(_COLUNAS_NEGOCIO) + ", hash_conteudo"
    # id_onr como PK: da um indice a staging de graca, essencial para o
    # UPDATE...FROM de reconciliar() nao virar table scan por linha em
    # bases grandes (achado real: sem indice, ~98k linhas travou por
    # minutos com o UPDATE anterior baseado em subquery correlacionada).
    definicao = ", ".join(
        f"{c} INTEGER PRIMARY KEY" if c == "id_onr" else c
        for c in _COLUNAS_NEGOCIO
    ) + ", hash_conteudo"
    conn.execute(f"CREATE TABLE nota_carteira_staging ({definicao})")
    marcadores = ", ".join(["?"] * (len(_COLUNAS_NEGOCIO) + 1))
    linhas = [
        tuple(nota.get(c) for c in _COLUNAS_NEGOCIO) + (mapping.hash_conteudo(nota),)
        for nota in notas
    ]
    conn.executemany(
        f"INSERT INTO nota_carteira_staging ({colunas}) VALUES ({marcadores})",
        linhas,
    )
    conn.commit()


def reconciliar(conn: sqlite3.Connection, agora: str) -> dict:
    cols = ", ".join(_COLUNAS_NEGOCIO)
    novas = conn.execute(
        "SELECT COUNT(*) FROM nota_carteira_staging s "
        "WHERE s.id_onr NOT IN (SELECT id_onr FROM nota_carteira)"
    ).fetchone()[0]
    atualizadas = conn.execute(
        "SELECT COUNT(*) FROM nota_carteira_staging s "
        "JOIN nota_carteira n ON n.id_onr = s.id_onr "
        "WHERE n.hash_conteudo <> s.hash_conteudo"
    ).fetchone()[0]
    inalteradas = conn.execute(
        "SELECT COUNT(*) FROM nota_carteira_staging s "
        "JOIN nota_carteira n ON n.id_onr = s.id_onr "
        "WHERE n.hash_conteudo = s.hash_conteudo"
    ).fetchone()[0]
    ausentes = conn.execute(
        "SELECT COUNT(*) FROM nota_carteira n "
        "WHERE n.ausente_na_origem_em IS NULL "
        "AND n.id_onr NOT IN (SELECT id_onr FROM nota_carteira_staging)"
    ).fetchone()[0]

    conn.execute("BEGIN")
    try:
        # INSERT novas
        conn.execute(
            f"INSERT INTO nota_carteira ({cols}, hash_conteudo, sincronizado_em, "
            f"criado_em, atualizado_em) "
            f"SELECT {cols}, hash_conteudo, ?, ?, ? FROM nota_carteira_staging s "
            f"WHERE s.id_onr NOT IN (SELECT id_onr FROM nota_carteira)",
            (agora, agora, agora),
        )
        # UPDATE alteradas: um unico UPDATE...FROM (JOIN real via indice
        # PK de staging), nao uma subquery correlacionada por coluna —
        # a versao anterior era O(linhas x colunas), inviavel em ~98k linhas.
        sets = ", ".join(f"{c} = s.{c}" for c in _COLUNAS_NEGOCIO if c != "id_onr")
        conn.execute(
            f"UPDATE nota_carteira SET {sets}, "
            f"hash_conteudo = s.hash_conteudo, "
            f"sincronizado_em = ?, atualizado_em = ?, ausente_na_origem_em = NULL "
            f"FROM nota_carteira_staging s "
            f"WHERE nota_carteira.id_onr = s.id_onr "
            f"AND nota_carteira.hash_conteudo <> s.hash_conteudo",
            (agora, agora),
        )
        # limpar tombstone de quem reapareceu inalterado
        conn.execute(
            "UPDATE nota_carteira SET ausente_na_origem_em = NULL, sincronizado_em = ? "
            "WHERE ausente_na_origem_em IS NOT NULL "
            "AND id_onr IN (SELECT id_onr FROM nota_carteira_staging)",
            (agora,),
        )
        # tombstone dos ausentes
        conn.execute(
            "UPDATE nota_carteira SET ausente_na_origem_em = ? "
            "WHERE ausente_na_origem_em IS NULL "
            "AND id_onr NOT IN (SELECT id_onr FROM nota_carteira_staging)",
            (agora,),
        )
        cdb.bump_versao(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"novas": novas, "atualizadas": atualizadas,
            "inalteradas": inalteradas, "ausentes": ausentes}


def _preparar_plano(conn: sqlite3.Connection, numeros_no_plano: set[int]) -> None:
    conn.execute("DROP TABLE IF EXISTS plano_atual")
    conn.execute("CREATE TEMP TABLE plano_atual (numero INTEGER PRIMARY KEY)")
    if numeros_no_plano:
        conn.executemany(
            "INSERT OR IGNORE INTO plano_atual(numero) VALUES (?)",
            [(int(n),) for n in numeros_no_plano],
        )


def _where_base(filtros: dict) -> tuple[str, list]:
    clausulas, params = [], []
    if not filtros.get("incluir_ausentes"):
        clausulas.append("n.ausente_na_origem_em IS NULL")
    for coluna, chave in (("regional", "regional"), ("status_sap", "status_sap")):
        if filtros.get(chave):
            clausulas.append(f"n.{coluna} = ?")
            params.append(filtros[chave])
    # 'conjunto' casa o código OU a descrição — o drill do dashboard passa a
    # descrição (descricao_conjunto == Plano), o filtro manual pode passar o código.
    if filtros.get("conjunto"):
        clausulas.append("(n.conjunto = ? OR n.descricao_conjunto = ?)")
        params += [filtros["conjunto"], filtros["conjunto"]]
    if filtros.get("sap_real") in (0, 1):
        clausulas.append("n.sap_real = ?")
        params.append(filtros["sap_real"])
    if filtros.get("q"):
        termo = f"%{filtros['q']}%"
        clausulas.append("(n.id_sap LIKE ? OR n.conjunto LIKE ? "
                         "OR n.local_instalacao LIKE ?)")
        params += [termo, termo, termo]
    where = (" WHERE " + " AND ".join(clausulas)) if clausulas else ""
    return where, params


def listar(conn, *, numeros_no_plano, filtros, page, size, ordenar_por, ordem,
           total_cache=None):
    _preparar_plano(conn, numeros_no_plano)
    where, params = _where_base(filtros)
    coluna_ordem = ordenar_por if ordenar_por in _ORDENAVEIS else "id_onr"
    direcao = "DESC" if str(ordem).lower() == "desc" else "ASC"

    base = (f"SELECT n.*, ({_SITUACAO_SQL}) AS situacao FROM nota_carteira n "
            f"LEFT JOIN plano_atual p ON p.numero = CAST(n.id_sap AS INTEGER) "
            f"AND n.sap_real = 1 {where}")
    filtro_sit, sit_params = "", []
    if filtros.get("situacao"):
        filtro_sit = " WHERE situacao = ?"
        sit_params = [filtros["situacao"]]

    # O COUNT (com situação derivada) é o custo dominante do request (~166 ms
    # em 98k). O service cacheia por versão composta e o repassa aqui — só
    # recomputa em cache miss (Fase 4d).
    total = total_cache
    if total is None:
        total = conn.execute(
            f"SELECT COUNT(*) FROM ({base}){filtro_sit}", params + sit_params
        ).fetchone()[0]
    offset = max(0, (page - 1) * size)
    linhas = conn.execute(
        f"SELECT * FROM ({base}){filtro_sit} "
        f"ORDER BY {coluna_ordem} {direcao} LIMIT ? OFFSET ?",
        params + sit_params + [size, offset],
    ).fetchall()
    return [dict(l) for l in linhas], total


def obter(conn, id_onr: int, numeros_no_plano: set[int]) -> dict | None:
    _preparar_plano(conn, numeros_no_plano)
    row = conn.execute(
        f"SELECT n.*, ({_SITUACAO_SQL}) AS situacao FROM nota_carteira n "
        f"LEFT JOIN plano_atual p ON p.numero = CAST(n.id_sap AS INTEGER) "
        f"AND n.sap_real = 1 WHERE n.id_onr = ?",
        (id_onr,),
    ).fetchone()
    return dict(row) if row else None


def obter_por_id_sap(conn: sqlite3.Connection, numero: int) -> dict | None:
    row = conn.execute(
        "SELECT id_onr, descricao_conjunto, conjunto, sintoma, "
        "componente_novo, kit, n_trafo, dispositivo_protecao, "
        "status_sap, prioridade_sap, sincronizado_em, ausente_na_origem_em "
        "FROM nota_carteira "
        "WHERE id_sap = ? AND sap_real = 1 "
        "ORDER BY sincronizado_em DESC, id_onr ASC LIMIT 1",
        (str(numero),),
    ).fetchone()
    return dict(row) if row else None


def resumo(conn, numeros_no_plano: set[int]) -> dict:
    _preparar_plano(conn, numeros_no_plano)
    base = (f"SELECT n.regional AS regional, ({_SITUACAO_SQL}) AS situacao "
            f"FROM nota_carteira n "
            f"LEFT JOIN plano_atual p ON p.numero = CAST(n.id_sap AS INTEGER) "
            f"AND n.sap_real = 1 WHERE n.ausente_na_origem_em IS NULL")
    por_situacao, por_regional, total = {}, {}, 0
    for linha in conn.execute(f"SELECT situacao, COUNT(*) c FROM ({base}) "
                              f"GROUP BY situacao").fetchall():
        por_situacao[linha["situacao"]] = linha["c"]
        total += linha["c"]
    for linha in conn.execute(f"SELECT regional, COUNT(*) c FROM ({base}) "
                              f"GROUP BY regional").fetchall():
        por_regional[linha["regional"]] = linha["c"]
    return {"total": total, "por_situacao": por_situacao,
            "por_regional": por_regional}


def obter_muitas(conn, id_onrs: list[int]) -> dict:
    if not id_onrs:
        return {}
    marcadores = ", ".join(["?"] * len(id_onrs))
    linhas = conn.execute(
        f"SELECT * FROM nota_carteira WHERE id_onr IN ({marcadores})",
        [int(i) for i in id_onrs],
    ).fetchall()
    return {linha["id_onr"]: dict(linha) for linha in linhas}


def listar_divergencias(conn, numeros_no_plano: set[int]) -> list[dict]:
    _preparar_plano(conn, numeros_no_plano)
    linhas = conn.execute(
        "SELECT n.*, CASE WHEN n.status_sap = 'Cancelado' THEN 'cancelada' "
        "ELSE 'ausente_na_origem' END AS tipo_divergencia "
        "FROM nota_carteira n "
        "JOIN plano_atual p ON p.numero = CAST(n.id_sap AS INTEGER) "
        "WHERE n.sap_real = 1 AND "
        "(n.status_sap = 'Cancelado' OR n.ausente_na_origem_em IS NOT NULL)"
    ).fetchall()
    return [dict(l) for l in linhas]


def base_por_plano(conn: sqlite3.Connection, numeros_no_plano: set[int]) -> list[dict]:
    """Base disponível (situação fora_do_plano) por regional x descricao_conjunto.

    Espelha a precedência de situacao.derivar: exclui cancelada, executada e
    o que já está no plano; só sap_real e quantidade válida; nunca tombstone.
    Devolve a quantidade BRUTA (a conversão para DDPM é feita em dashboard.py,
    que tem o Unidade de planos_depara).
    """
    _preparar_plano(conn, numeros_no_plano)
    linhas = conn.execute(
        "SELECT n.regional AS regional, n.descricao_conjunto AS plano, "
        "SUM(n.quantidade) AS quantidade_bruta, COUNT(*) AS n_notas "
        "FROM nota_carteira n "
        "LEFT JOIN plano_atual p ON p.numero = CAST(n.id_sap AS INTEGER) "
        "AND n.sap_real = 1 "
        "WHERE n.ausente_na_origem_em IS NULL AND n.sap_real = 1 "
        "AND n.quantidade_valida = 1 "
        "AND (n.status_sap IS NULL OR n.status_sap NOT IN ('Cancelado','Encerrado')) "
        "AND n.data_encerramento_exec IS NULL "
        "AND p.numero IS NULL "
        "GROUP BY n.regional, n.descricao_conjunto"
    ).fetchall()
    return [dict(l) for l in linhas]
