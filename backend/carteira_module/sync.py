"""Servico de sincronizacao da Carteira: completo + skip-signal, idempotente."""
import datetime
import hashlib
import json
import threading

from carteira_module import config, db, mapping, repository
from databricks_module import client

_LOCK = threading.Lock()


def _agora_iso() -> str:
    return datetime.datetime.now().isoformat(timespec="seconds")


def _ler_marker_databricks() -> str:
    sql = (f"SELECT MAX(Atualizacao) AS m FROM "
           f"{config.CATALOGO}.{config.SCHEMA}.{config.TABELA}")
    valor = client.consultar(sql).iloc[0]["m"]
    return "" if valor is None else str(valor)


def _ler_origem_databricks() -> list[dict]:
    marcadores = ", ".join(["?"] * len(config.REGIONAIS_SP))
    sql = (f"SELECT * FROM {config.CATALOGO}.{config.SCHEMA}.{config.TABELA} "
           f"WHERE CSD IN ({marcadores})")
    df = client.consultar(sql, list(config.REGIONAIS_SP))
    return df.to_dict("records")


def _assinatura_esquema(colunas: list[str]) -> str:
    material = json.dumps(sorted(colunas), ensure_ascii=False)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _ler_assinatura_esquema_databricks() -> str:
    sql = (f"SELECT * FROM {config.CATALOGO}.{config.SCHEMA}.{config.TABELA} "
           "LIMIT 0")
    return _assinatura_esquema(list(client.consultar(sql).columns))


def _registrar(execucao: dict) -> None:
    conn = db.conectar()
    conn.execute(
        "INSERT INTO carteira_sync_execucoes (estrategia, iniciado_em, "
        "finalizado_em, status, refresh_marker, novas, atualizadas, "
        "inalteradas, ausentes, erro, versao_resultante) "
        "VALUES (:estrategia,:iniciado_em,:finalizado_em,:status,:refresh_marker,"
        ":novas,:atualizadas,:inalteradas,:ausentes,:erro,:versao_resultante)",
        {**{k: execucao.get(k) for k in (
            "estrategia", "iniciado_em", "finalizado_em", "status",
            "refresh_marker", "novas", "atualizadas", "inalteradas",
            "ausentes", "erro", "versao_resultante")}},
    )
    conn.commit()
    conn.close()


def sincronizar(*, ler_origem=None, ler_marker=None,
                ler_assinatura_esquema=None, agora=None) -> dict:
    origem_injetada = ler_origem is not None
    ler_origem = ler_origem or _ler_origem_databricks
    ler_marker = ler_marker or _ler_marker_databricks
    if ler_assinatura_esquema is None and not origem_injetada:
        ler_assinatura_esquema = _ler_assinatura_esquema_databricks
    iniciado = agora or _agora_iso()
    execucao = {"iniciado_em": iniciado, "refresh_marker": None,
                "novas": 0, "atualizadas": 0, "inalteradas": 0, "ausentes": 0,
                "erro": None, "versao_resultante": None}
    if not _LOCK.acquire(blocking=False):
        execucao.update(estrategia="ignorada", status="em_andamento",
                        finalizado_em=iniciado)
        return execucao
    try:
        marker = ler_marker()
        execucao["refresh_marker"] = marker
        assinatura_esquema = (
            ler_assinatura_esquema()
            if ler_assinatura_esquema is not None else None
        )
        if (
            marker
            and marker == db.obter_meta("ultimo_refresh_marker")
            and (
                assinatura_esquema is None
                or assinatura_esquema == db.obter_meta("assinatura_esquema")
            )
        ):
            execucao.update(estrategia="skip", status="ok",
                            finalizado_em=_agora_iso(),
                            versao_resultante=db.obter_versao())
            _registrar(execucao)
            return execucao

        notas, avisos = mapping.normalizar_linhas(ler_origem())
        conn = db.conectar()
        try:
            repository.carregar_staging(conn, notas)
            contagens = repository.reconciliar(conn, iniciado)
            db.definir_meta(conn, "ultimo_refresh_marker", marker)
            db.definir_meta(
                conn,
                "avisos_enriquecimento",
                json.dumps(avisos, ensure_ascii=False),
            )
            if assinatura_esquema is not None:
                db.definir_meta(conn, "assinatura_esquema", assinatura_esquema)
            conn.commit()
        finally:
            conn.close()
        execucao.update(estrategia="completa", status="ok",
                        finalizado_em=_agora_iso(),
                        versao_resultante=db.obter_versao(), **contagens)
        _registrar(execucao)
        return execucao
    except Exception as exc:  # noqa: BLE001
        execucao.update(estrategia="completa", status="erro",
                        finalizado_em=_agora_iso(), erro=str(exc))
        _registrar(execucao)
        raise
    finally:
        _LOCK.release()


def estado() -> dict:
    conn = db.conectar()
    execucoes = [dict(r) for r in conn.execute(
        "SELECT * FROM carteira_sync_execucoes ORDER BY id DESC LIMIT 20"
    ).fetchall()]
    conn.close()
    return {"ultimo_refresh_marker": db.obter_meta("ultimo_refresh_marker"),
            "execucoes": execucoes}
