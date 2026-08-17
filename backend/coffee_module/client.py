"""Cliente da API externa COFFEE (httpx). Encapsula as 4 chamadas, com logging."""
import json
import time

import httpx

from coffee_module import config, db

_TIMEOUT = config.TIMEOUT


class NotaNaoEncontradaErro(Exception):
    """json_all respondeu 200 com lista vazia: o id nao existe no COFFEE."""

    def __init__(self, id):
        super().__init__(f"Nota {id} nao encontrada no COFFEE.")
        self.id = id


def _status_de(exc: Exception):
    resp = getattr(exc, "response", None)
    return getattr(resp, "status_code", None)


def compor_local_instalacao(fields: dict):
    """Compoe o local de instalacao a partir dos campos decompostos da API COFFEE.

    A API nao devolve um campo 'local_instalacao' pronto: ele e cidade(3) +
    tipo_local_instalacao(2 letras) + local_instalacao_numero(8, zero a esquerda).
    Ex.: cidade='718', tipo='ET', numero=26773 -> '718ET00026773'.
    Retorna None se faltar algum componente.
    """
    cidade = fields.get("cidade")
    tipo = fields.get("tipo_local_instalacao")
    numero = fields.get("local_instalacao_numero")
    if not (cidade and tipo and numero):
        return None
    return f"{str(cidade).zfill(3)}{tipo}{str(numero).zfill(8)}"


def buscar_nota(id) -> dict:
    """GET json_all/{id}. Faz o duplo-parse e retorna campos-chave + fields."""
    inicio = time.perf_counter()
    try:
        resp = httpx.get(f"{config.base_url()}/json_all/{id}", timeout=_TIMEOUT,
                         verify=config.ssl_verify())
        resp.raise_for_status()
        bruto = resp.json()
        if isinstance(bruto, str):
            bruto = json.loads(bruto)
        if not bruto:
            raise NotaNaoEncontradaErro(id)
        registro = bruto[0]
        fields = registro.get("fields", {})
        tempo_ms = round((time.perf_counter() - inicio) * 1000)
        db.registrar_log("api_call", "buscar_nota", registro.get("pk"),
                         {"id": id, "status_http": resp.status_code, "tempo_ms": tempo_ms}, True)
        return {
            "pk": registro.get("pk"),
            "id_sap": fields.get("id_sap"),
            "arquivado": bool(fields.get("arquivado")),
            "local_instalacao": compor_local_instalacao(fields),
            "fields": fields,
        }
    except Exception as exc:  # noqa: BLE001
        tempo_ms = round((time.perf_counter() - inicio) * 1000)
        db.registrar_log("api_call", "buscar_nota", None,
                         {"id": id, "status_http": _status_de(exc),
                          "tempo_ms": tempo_ms, "erro": str(exc)}, False)
        raise


def _get_logado(acao: str, url: str, nota_pk, detalhes: dict) -> bool:
    inicio = time.perf_counter()
    try:
        resp = httpx.get(url, timeout=_TIMEOUT, verify=config.ssl_verify())
        resp.raise_for_status()
        tempo_ms = round((time.perf_counter() - inicio) * 1000)
        db.registrar_log("api_call", acao, nota_pk,
                         {**detalhes, "status_http": resp.status_code, "tempo_ms": tempo_ms}, True)
        return True
    except Exception as exc:  # noqa: BLE001
        tempo_ms = round((time.perf_counter() - inicio) * 1000)
        db.registrar_log("api_call", acao, nota_pk,
                         {**detalhes, "status_http": _status_de(exc),
                          "tempo_ms": tempo_ms, "erro": str(exc)}, False)
        raise


def definir_sap(id, sap) -> bool:
    return _get_logado("definir_sap", f"{config.base_url()}/sap/{id}/{sap}", id, {"id": id, "sap": sap})


def desarquivar(id) -> bool:
    return _get_logado("desarquivar", f"{config.base_url()}/desarquivar/{id}", id, {"id": id})


def alterar_local(id, local) -> bool:
    return _get_logado("alterar_local", f"{config.base_url()}/local_instalacao/{id}/{local}",
                       id, {"id": id, "local": local})


def alterar_alimentador(id, alimentador) -> bool:
    return _get_logado("alterar_alimentador", f"{config.base_url()}/alimentador/{id}/{alimentador}",
                       id, {"id": id, "alimentador": alimentador})
