"""Jobs em lote do COFFEE, persistidos para sobreviver a reinicializacoes."""
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from coffee_module import client, config, db, operation_service

_LOCK = threading.Lock()


def _novo_job(tipo: str, total: int) -> tuple[str, dict]:
    job_id = uuid.uuid4().hex
    with _LOCK:
        snapshot = db.criar_operacao(job_id, tipo, total)
    return job_id, snapshot


def _salvar(job_id: str, snapshot: dict) -> None:
    with _LOCK:
        db.salvar_operacao(job_id, snapshot)


def _concluir(job_id: str, snapshot: dict) -> None:
    snapshot["estado"] = "parcial" if snapshot["erros"] else "concluida"
    _salvar(job_id, snapshot)


def _rodar_em_paralelo(
    job_id: str,
    snapshot: dict,
    ids: list,
    trace: str | None,
    usuario: str | None,
    processar_um: Callable[[object], None],
    delay: float,
) -> None:
    """Processa `ids` com paralelismo limitado (`config.MAX_WORKERS`).

    Sequencial (1 nota por vez) não escala com filas grandes: uma nota
    lenta/travada prendia o worker inteiro atrás dela. `processar_um` trata
    seus próprios erros de domínio (ex.: `aplicar_falha` com a etapa de
    retorno certa) e deve relançar a exceção — este helper só cuida da
    contabilização (feitas/erros) de forma segura entre threads.
    """
    def _tarefa(ident: object) -> None:
        db.definir_trace(trace)
        db.definir_usuario(usuario)
        try:
            processar_um(ident)
        except Exception as exc:  # noqa: BLE001 - uma falha nao derruba o lote
            with _LOCK:
                snapshot["erros"].append({"pk": ident, "msg": str(exc)})
        finally:
            with _LOCK:
                snapshot["feitas"] += 1
                db.salvar_operacao(job_id, snapshot)
            time.sleep(delay)

    with ThreadPoolExecutor(max_workers=config.MAX_WORKERS) as pool:
        list(pool.map(_tarefa, ids))
    _concluir(job_id, snapshot)


def obter_job(job_id: str) -> dict | None:
    operacao = db.obter_operacao(job_id)
    if operacao is None:
        return None
    estado_api = {
        "concluida": "concluido",
        "parcial": "concluido",
        "interrompida": "interrompido",
    }.get(operacao["estado"], operacao["estado"])
    return {**operacao, "estado": estado_api}


def iniciar_busca(
    ids: list,
    trace: str | None = None,
    usuario: str | None = None,
) -> str:
    job_id, snapshot = _novo_job("busca", len(ids))
    threading.Thread(
        target=_rodar,
        args=(job_id, snapshot, list(ids), trace, usuario),
        daemon=True,
    ).start()
    return job_id


def _rodar(
    job_id: str,
    snapshot: dict,
    ids: list,
    trace: str | None = None,
    usuario: str | None = None,
) -> None:
    db.definir_trace(trace)
    db.definir_usuario(usuario)
    for ident in ids:
        try:
            nota = client.buscar_nota(ident)
            db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
        except Exception as exc:  # noqa: BLE001 - uma falha nao derruba o lote
            try:
                db.registrar_erro(int(ident), str(exc))
            except (ValueError, TypeError):
                pass
            snapshot["erros"].append({"pk": ident, "msg": str(exc)})
        finally:
            snapshot["feitas"] += 1
            _salvar(job_id, snapshot)
        time.sleep(config.DELAY_BUSCA)
    _concluir(job_id, snapshot)


def iniciar_consulta_operacao(
    ids: list[int],
    origem: str = "avulsa",
    trace: str | None = None,
    usuario: str | None = None,
) -> str:
    job_id = uuid.uuid4().hex
    ids_a_consultar = operation_service.adicionar_entradas(
        ids,
        origem,
        job_id,
    )
    with _LOCK:
        snapshot = db.criar_operacao(job_id, "consulta", len(ids_a_consultar))
    threading.Thread(
        target=_rodar_consulta_operacao,
        args=(job_id, snapshot, ids_a_consultar, origem, trace, usuario),
        daemon=True,
    ).start()
    return job_id


def _rodar_consulta_operacao(
    job_id: str,
    snapshot: dict,
    ids: list[int],
    origem: str,
    trace: str | None,
    usuario: str | None,
) -> None:
    snapshot["por_etapa"] = {"pronta": 0, "aguardando_sap": 0, "processando": 0, "ignorada": 0}

    def processar(ident: int) -> None:
        try:
            nota = client.buscar_nota(ident)
            etapa = operation_service.aplicar_consulta(int(ident), nota, origem, job_id)
        except Exception as exc:  # noqa: BLE001 - relançada pro _rodar_em_paralelo contabilizar
            operation_service.aplicar_falha(int(ident), "fila", str(exc))
            raise
        chave = etapa if etapa in snapshot["por_etapa"] else "ignorada"
        with _LOCK:
            snapshot["por_etapa"][chave] += 1

    _rodar_em_paralelo(job_id, snapshot, ids, trace, usuario, processar, config.DELAY_BUSCA)


def iniciar_geracao(
    ids: list,
    justificativa: str | None = None,
    trace: str | None = None,
    usuario: str | None = None,
) -> str:
    job_id, snapshot = _novo_job("geracao_legada", len(ids))
    threading.Thread(
        target=_rodar_geracao,
        args=(job_id, snapshot, list(ids), trace, usuario),
        daemon=True,
    ).start()
    return job_id


def _executar_geracao(ident: int) -> dict:
    nota = client.buscar_nota(ident)
    db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
    pk = nota["pk"]
    sap = nota["id_sap"]
    if nota["arquivado"] and sap and sap != config.SAP_PENDENTE:
        local = nota["local_instalacao"]
        db.registrar_log(
            "acao_usuario",
            "geracao_ignorada_arquivada",
            pk,
            {"id_sap": sap, "local_instalacao": local},
            True,
        )
        db.marcar_gerar(pk, False)
        return {
            "pk": pk,
            "aguardando_sap": False,
            "arquivada": {
                "pk": pk,
                "id_sap": sap,
                "local_instalacao": local,
            },
        }
    if sap and sap != config.SAP_PENDENTE:
        db.registrar_log(
            "acao_usuario",
            "geracao_ignorada_sap_real",
            pk,
            {"id_sap": sap},
            True,
        )
        db.marcar_gerar(pk, False)
        return {"pk": pk, "aguardando_sap": False, "arquivada": None}
    client.definir_sap(ident, config.SAP_PENDENTE)
    client.desarquivar(ident)
    atualizada = client.buscar_nota(ident)
    db.upsert_nota(
        atualizada["pk"],
        atualizada["id_sap"],
        atualizada["fields"],
    )
    db.marcar_gerar(atualizada["pk"], False)
    if db.origem_atual(atualizada["pk"]) is None:
        db.definir_origem(atualizada["pk"], "avulsa")
    return {
        "pk": atualizada["pk"],
        "aguardando_sap": True,
        "arquivada": None,
    }


def _rodar_geracao(
    job_id: str,
    snapshot: dict,
    ids: list,
    trace: str | None = None,
    usuario: str | None = None,
) -> None:
    db.definir_trace(trace)
    db.definir_usuario(usuario)
    for ident in ids:
        try:
            resultado = _executar_geracao(ident)
            if resultado["arquivada"] is not None:
                snapshot.setdefault("arquivadas", []).append(
                    resultado["arquivada"]
                )
        except Exception as exc:  # noqa: BLE001 - uma falha nao derruba o lote
            snapshot["erros"].append({"pk": ident, "msg": str(exc)})
        finally:
            snapshot["feitas"] += 1
            _salvar(job_id, snapshot)
        time.sleep(config.DELAY_GERACAO)
    _concluir(job_id, snapshot)


def iniciar_geracao_operacao(
    pks: list[int],
    trace: str | None = None,
    usuario: str | None = None,
) -> str:
    operation_service.validar_prontas(pks)
    job_id, snapshot = _novo_job("geracao", len(pks))
    try:
        operation_service.marcar_processando(pks, job_id)
        threading.Thread(
            target=_rodar_geracao_operacao,
            args=(job_id, snapshot, list(pks), trace, usuario),
            daemon=True,
        ).start()
    except Exception as exc:
        operation_service.reverter_processando_operacao(
            job_id,
            "Operação interrompida antes de iniciar; tente novamente.",
        )
        snapshot["estado"] = "interrompida"
        snapshot["erros"].append({
            "msg": f"Não foi possível iniciar a geração: {exc}",
        })
        _salvar(job_id, snapshot)
        raise
    return job_id


def _rodar_geracao_operacao(
    job_id: str,
    snapshot: dict,
    pks: list[int],
    trace: str | None,
    usuario: str | None,
) -> None:
    def processar(ident: int) -> None:
        try:
            resultado = _executar_geracao(ident)
            if resultado["aguardando_sap"]:
                operation_service.aplicar_geracao_sucesso(resultado["pk"], job_id)
            else:
                db.remover_item_operacao(resultado["pk"])
            if resultado["arquivada"] is not None:
                with _LOCK:
                    snapshot.setdefault("arquivadas", []).append(resultado["arquivada"])
        except Exception as exc:  # noqa: BLE001 - relançada pro _rodar_em_paralelo contabilizar
            operation_service.aplicar_falha(int(ident), "pronta", str(exc))
            raise

    _rodar_em_paralelo(job_id, snapshot, pks, trace, usuario, processar, config.DELAY_GERACAO)


def iniciar_atualizacao_sap(
    pks: list[int],
    trace: str | None = None,
    usuario: str | None = None,
) -> str:
    operation_service.validar_aguardando_sap(pks)
    job_id, snapshot = _novo_job("atualizacao_sap", len(pks))
    threading.Thread(
        target=_rodar_atualizacao_sap,
        args=(job_id, snapshot, list(pks), trace, usuario),
        daemon=True,
    ).start()
    return job_id


def _rodar_atualizacao_sap(
    job_id: str,
    snapshot: dict,
    pks: list[int],
    trace: str | None,
    usuario: str | None,
) -> None:
    def processar(pk: int) -> None:
        try:
            nota = client.buscar_nota(pk)
            origem = db.origem_atual(nota["pk"]) or "verificar"
            operation_service.aplicar_consulta(pk, nota, origem, job_id)
        except Exception as exc:  # noqa: BLE001 - relançada pro _rodar_em_paralelo contabilizar
            operation_service.aplicar_falha(pk, "aguardando_sap", str(exc))
            raise

    _rodar_em_paralelo(job_id, snapshot, pks, trace, usuario, processar, config.DELAY_BUSCA)


def iniciar_correcao_local(
    itens: list,
    gerar_apos: bool = False,
    trace: str | None = None,
    usuario: str | None = None,
) -> str:
    """Corrige em lote locais de instalacao com '9' extra (malha fina)."""
    job_id, snapshot = _novo_job("correcao_local", len(itens))
    snapshot.update({
        "corrigidas": [],
        "ja_corrigidas": [],
        "divergentes": [],
        "geradas": [],
    })
    _salvar(job_id, snapshot)
    threading.Thread(
        target=_rodar_correcao_local,
        args=(
            job_id,
            snapshot,
            [dict(item) for item in itens],
            gerar_apos,
            trace,
            usuario,
        ),
        daemon=True,
    ).start()
    return job_id


def _rodar_correcao_local(
    job_id: str,
    snapshot: dict,
    itens: list,
    gerar_apos: bool,
    trace: str | None = None,
    usuario: str | None = None,
) -> None:
    db.definir_trace(trace)
    db.definir_usuario(usuario)
    for item in itens:
        ident, local = item["id"], item["local"]
        try:
            nota = client.buscar_nota(ident)
            db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
            atual = nota["local_instalacao"]
            if atual == local:
                snapshot["ja_corrigidas"].append(ident)
                db.registrar_log(
                    "acao_usuario",
                    "correcao_local_ja_corrigida",
                    nota["pk"],
                    {"id": ident, "local": local},
                    True,
                )
            elif atual != local + "9":
                snapshot["divergentes"].append(
                    {"id": ident, "local_atual": atual}
                )
                db.registrar_log(
                    "acao_usuario",
                    "correcao_local_divergente",
                    nota["pk"],
                    {"id": ident, "esperado": local + "9", "atual": atual},
                    False,
                )
            else:
                client.alterar_local(ident, local)
                snapshot["corrigidas"].append(ident)
                db.registrar_log(
                    "acao_usuario",
                    "correcao_local",
                    nota["pk"],
                    {"id": ident, "de": atual, "para": local},
                    True,
                )
                if gerar_apos:
                    try:
                        _gerar_apos_correcao(snapshot, ident, nota)
                    except Exception as exc:  # noqa: BLE001 - corrigida, mas geracao falhou
                        snapshot["erros"].append({
                            "pk": ident,
                            "msg": f"geração após correção: {exc}",
                        })
        except Exception as exc:  # noqa: BLE001 - uma falha nao derruba o lote
            snapshot["erros"].append({"pk": ident, "msg": str(exc)})
        finally:
            snapshot["feitas"] += 1
            _salvar(job_id, snapshot)
        time.sleep(config.DELAY_GERACAO)
    _concluir(job_id, snapshot)


def _gerar_apos_correcao(snapshot: dict, ident: int, nota: dict) -> None:
    """Encadeia a geracao de uma nota recem-corrigida."""
    sap = nota["id_sap"]
    if sap and sap != config.SAP_PENDENTE:
        db.registrar_log(
            "acao_usuario",
            "geracao_ignorada_sap_real",
            nota["pk"],
            {"id_sap": sap},
            True,
        )
        db.marcar_gerar(nota["pk"], False)
        return
    client.definir_sap(ident, config.SAP_PENDENTE)
    client.desarquivar(ident)
    atualizada = client.buscar_nota(ident)
    db.upsert_nota(
        atualizada["pk"],
        atualizada["id_sap"],
        atualizada["fields"],
    )
    db.marcar_gerar(atualizada["pk"], False)
    if db.origem_atual(atualizada["pk"]) is None:
        db.definir_origem(atualizada["pk"], "avulsa")
    snapshot["geradas"].append(ident)
