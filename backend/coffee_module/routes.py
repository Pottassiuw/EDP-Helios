"""Rotas /api/coffee/* -- fundacao do hub COFFEE."""
import os
import re
import time
from contextlib import contextmanager
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import BaseModel

from coffee_module import (
    alimentadores, classify, client, config, db, exportacao, jobs,
    municipios, operation_service, tipos_equipamento,
)

_PERF_ATIVO = os.environ.get("EDP_PERF", "").strip() not in ("", "0", "false")
_LOCAL_INSTALACAO_RE = re.compile(r"^\d{3}[A-Z0-9]{2}\d{8}$")


@contextmanager
def _medir(etapa: str):
    """Mede uma etapa do handler (consulta ao banco) quando EDP_PERF=1.

    O middleware de main.py já mede a requisição inteira; isto separa o tempo
    de banco do tempo de serialização/rede.
    """
    if not _PERF_ATIVO:
        yield
        return
    inicio = time.perf_counter()
    try:
        yield
    finally:
        print(f"[COFFEE-PERF]   {etapa}: {(time.perf_counter() - inicio) * 1000:.0f}ms")

async def usuario_coffee(x_user: Optional[str] = Header(default=None, alias="X-User")) -> Optional[str]:
    """Identidade do dono das notas: header X-User quando presente, senão None (fallback local).

    PRECISA ser async: dependency síncrona roda em run_in_threadpool numa cópia
    de contexto descartada — o set da contextvar nunca chegaria ao corpo da
    rota. Async roda no task do request; o endpoint sync herda o contexto
    (copy_context) e _usuario_atual() enxerga o valor.
    """
    usuario = x_user.strip() if x_user and x_user.strip() else None
    db.definir_usuario(usuario)
    return usuario


# dependencies= garante a identidade em TODA rota do módulo (rota nova incluída);
# rotas que precisam do valor declaram Depends(usuario_coffee) — o FastAPI
# cacheia a dependency por request, então ela não roda duas vezes.
router = APIRouter(prefix="/api/coffee", dependencies=[Depends(usuario_coffee)])

_estado = {"inicializado": False}


def _garantir_banco() -> None:
    if not _estado["inicializado"]:
        db.inicializar_banco()
        _estado["inicializado"] = True


class BuscaPedido(BaseModel):
    ids: list[str]


class SapPedido(BaseModel):
    id: int
    sap: int


class IdPedido(BaseModel):
    id: int


class ExportarConcluidasPedido(BaseModel):
    pks: list[int]


class LocalPedido(BaseModel):
    id: int
    local: str


class AlimentadorPedido(BaseModel):
    id: int
    alimentador: str


class OperacaoIdsPedido(BaseModel):
    ids: list[int]


class OperacaoRemoverPedido(BaseModel):
    ids: list[int]
    justificativa: str


class ArquivarPedido(BaseModel):
    id: int
    justificativa: str


class MarcarGerarPedido(BaseModel):
    id: int
    a_gerar: bool = True
    justificativa: Optional[str] = None


class RegerarPedido(BaseModel):
    id: int
    justificativa: Optional[str] = None


class GerarLotePedido(BaseModel):
    ids: list[int]
    justificativa: Optional[str] = None


class CorrigirLocalItem(BaseModel):
    id: int
    local: str


class CorrigirLocalPedido(BaseModel):
    itens: list[CorrigirLocalItem]
    gerar_apos: bool = False


def _validar_ids(ids: list[int]) -> list[int]:
    unicos = list(dict.fromkeys(ids))
    if not unicos:
        raise HTTPException(status_code=400, detail="Lista de IDs vazia.")
    if any(ident <= 0 for ident in unicos):
        raise HTTPException(status_code=400, detail="IDs devem ser positivos.")
    return unicos


@router.post("/buscar")
def buscar(pedido: BuscaPedido, usuario: Optional[str] = Depends(usuario_coffee)):
    _garantir_banco()
    if not pedido.ids:
        raise HTTPException(status_code=400, detail="Lista de IDs vazia.")
    db.registrar_log("acao_usuario", "busca_lote", None,
                     {"ids": pedido.ids, "total": len(pedido.ids)}, True)
    return {"job_id": jobs.iniciar_busca(pedido.ids, trace=db.trace_atual(), usuario=usuario)}


@router.get("/job/{job_id}")
def job(job_id: str):
    j = jobs.obter_job(job_id)
    if j is None:
        raise HTTPException(status_code=404, detail="Job nao encontrado.")
    return j


@router.get("/notas")
def notas(status: Optional[str] = None, usuario: Optional[str] = Depends(usuario_coffee)):
    _garantir_banco()
    with _medir("db.listar_notas"):
        registros = db.listar_notas(status, usuario=usuario)
    return {"registros": registros}


@router.post("/notas/concluidas/exportar")
def exportar_concluidas(
    pedido: ExportarConcluidasPedido,
    usuario: Optional[str] = Depends(usuario_coffee),
):
    """Exporta apenas as notas concluídas ainda visíveis ao usuário atual."""
    _garantir_banco()
    pks = _validar_ids(pedido.pks)
    por_pk = {
        nota["pk"]: nota
        for nota in db.listar_notas("concluida", usuario=usuario)
    }
    selecionadas = [por_pk[pk] for pk in pks if pk in por_pk]
    if not selecionadas:
        raise HTTPException(
            status_code=404,
            detail="Nenhuma das notas selecionadas continua concluída e disponível para exportação.",
        )
    db.registrar_log(
        "acao_usuario",
        "exportar_concluidas",
        None,
        {"total": len(selecionadas)},
        True,
    )
    return Response(
        content=exportacao.gerar_planilha_concluidas(selecionadas),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="notas_concluidas.xlsx"'},
    )


@router.get("/consultar/{id}")
def consultar(id: int):
    _garantir_banco()
    try:
        nota = client.buscar_nota(id)
        estado_local = db.obter_nota(nota["pk"])
        classe = classify.classificar(
            nota["id_sap"],
            None if estado_local is None else estado_local["id_sap"],
            None if estado_local is None else estado_local["origem"],
        )
    except client.NotaNaoEncontradaErro as exc:
        db.registrar_log("acao_usuario", "consultar", id, {"id": id}, False)
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception:
        db.registrar_log("acao_usuario", "consultar", id, {"id": id}, False)
        raise HTTPException(status_code=502,
                            detail="Nao foi possivel consultar a nota na API COFFEE.")
    fields = nota.get("fields") or {}
    problema_partes = [
        parte.strip()
        for parte in [
            fields.get("componente") or fields.get("componente_novo"),
            fields.get("sintoma"),
            fields.get("causa"),
        ]
        if isinstance(parte, str) and parte.strip()
    ]
    observacao = next(
        (
            parte.strip()
            for parte in [fields.get("observacao"), fields.get("observacoes")]
            if isinstance(parte, str) and parte.strip()
        ),
        None,
    )
    db.registrar_log("acao_usuario", "consultar", nota["pk"], {"id": id}, True)
    return {
        "pk": nota["pk"],
        "id_sap": nota["id_sap"],
        "local_instalacao": nota["local_instalacao"],
        "classificacao": classe,
        "arquivado": nota["arquivado"],
        "poste": fields.get("postes") or fields.get("poste"),
        "referencia": fields.get("referencia_fisica") or fields.get("referencia_eletrica"),
        "referencia_fisica": fields.get("referencia_fisica"),
        "referencia_eletrica": fields.get("referencia_eletrica"),
        "alimentador": fields.get("alimentador"),
        "problema": " · ".join(problema_partes) or None,
        "observacao": observacao,
        # Indicadores completos: repassa os campos crus do json_all pra tela
        # de ficha mostrar tudo, sem o backend ter que projetar campo a campo.
        "campos": fields,
    }


@router.post("/sap")
def sap(pedido: SapPedido):
    client.definir_sap(pedido.id, pedido.sap)
    return {"ok": True}


@router.post("/desarquivar")
def desarquivar(pedido: IdPedido):
    client.desarquivar(pedido.id)
    return {"ok": True}


@router.post("/local-instalacao")
def local_instalacao(pedido: LocalPedido):
    _garantir_banco()
    if not _LOCAL_INSTALACAO_RE.fullmatch(pedido.local):
        raise HTTPException(
            status_code=400,
            detail=(
                "Local de instalação deve ter 13 caracteres: "
                "3 dígitos da cidade, 2 do tipo e 8 do número."
            ),
        )
    try:
        client.alterar_local(pedido.id, pedido.local)
    except Exception as exc:  # noqa: BLE001
        db.registrar_log(
            "acao_usuario",
            "alterar_local",
            pedido.id,
            {"id": pedido.id, "local": pedido.local},
            False,
        )
        raise HTTPException(
            status_code=502,
            detail="Não foi possível alterar o local na API COFFEE.",
        ) from exc
    try:
        nota = client.buscar_nota(pedido.id)
    except Exception as exc:  # noqa: BLE001
        db.registrar_log(
            "acao_usuario",
            "alterar_local",
            pedido.id,
            {"id": pedido.id, "local": pedido.local},
            False,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "O local foi alterado na API COFFEE, mas a nota não pôde "
                "ser reconsultada. Tente consultar novamente."
            ),
        ) from exc

    if nota["local_instalacao"] != pedido.local:
        db.registrar_log(
            "acao_usuario",
            "alterar_local",
            nota["pk"],
            {
                "id": pedido.id,
                "solicitado": pedido.local,
                "confirmado": nota["local_instalacao"],
            },
            False,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "O COFFEE não confirmou o local solicitado. "
                "Consulte a nota novamente antes de tentar outra alteração."
            ),
        )

    item = next(
        (
            atual
            for atual in db.listar_itens_operacao()
            if atual["nota_pk"] == nota["pk"]
            or atual["entrada_id"] == pedido.id
        ),
        None,
    )
    if item is None:
        db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
    else:
        origem = item.get("origem") or db.origem_atual(nota["pk"]) or "avulsa"
        operation_service.aplicar_consulta(pedido.id, nota, origem, None)
    db.registrar_log(
        "acao_usuario",
        "alterar_local",
        nota["pk"],
        {"id": pedido.id, "local": pedido.local},
        True,
    )
    return {"ok": True, "local_instalacao": nota["local_instalacao"]}


@router.get("/alimentadores")
def listar_alimentadores():
    return {"registros": alimentadores.listar()}


@router.get("/municipios")
def listar_municipios():
    return {"registros": municipios.listar()}


@router.get("/tipos-equipamento")
def listar_tipos_equipamento():
    return {"registros": tipos_equipamento.listar()}


@router.post("/alimentador")
def alimentador(pedido: AlimentadorPedido):
    _garantir_banco()
    if not alimentadores.alimentador_valido(pedido.alimentador):
        raise HTTPException(status_code=400, detail="Alimentador não reconhecido.")
    try:
        client.alterar_alimentador(pedido.id, pedido.alimentador)
    except Exception as exc:  # noqa: BLE001
        db.registrar_log(
            "acao_usuario", "alterar_alimentador", pedido.id,
            {"id": pedido.id, "alimentador": pedido.alimentador}, False,
        )
        raise HTTPException(
            status_code=502, detail="Não foi possível alterar o alimentador na API COFFEE.",
        ) from exc
    try:
        nota = client.buscar_nota(pedido.id)
    except Exception as exc:  # noqa: BLE001
        db.registrar_log(
            "acao_usuario", "alterar_alimentador", pedido.id,
            {"id": pedido.id, "alimentador": pedido.alimentador}, False,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                "O alimentador foi alterado na API COFFEE, mas a nota não pôde "
                "ser reconsultada. Tente consultar novamente."
            ),
        ) from exc

    confirmado = nota["fields"].get("alimentador")
    if confirmado != pedido.alimentador:
        db.registrar_log(
            "acao_usuario", "alterar_alimentador", nota["pk"],
            {"id": pedido.id, "solicitado": pedido.alimentador, "confirmado": confirmado}, False,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "O COFFEE não confirmou o alimentador solicitado. "
                "Consulte a nota novamente antes de tentar outra alteração."
            ),
        )

    db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
    db.registrar_log(
        "acao_usuario", "alterar_alimentador", nota["pk"],
        {"id": pedido.id, "alimentador": pedido.alimentador}, True,
    )
    return {"ok": True, "alimentador": confirmado}


@router.get("/operacao")
def obter_operacao():
    _garantir_banco()
    with _medir("operation_service.listar_quadro"):
        return operation_service.listar_quadro()


@router.post("/operacao/consultar")
def consultar_operacao(
    pedido: OperacaoIdsPedido,
    usuario: Optional[str] = Depends(usuario_coffee),
):
    _garantir_banco()
    ids = _validar_ids(pedido.ids)
    job_id = jobs.iniciar_consulta_operacao(
        ids,
        origem="avulsa",
        trace=db.trace_atual(),
        usuario=usuario,
    )
    return {"job_id": job_id}


@router.post("/operacao/consultar-lote")
def consultar_operacao_lote(
    pedido: OperacaoIdsPedido,
    usuario: Optional[str] = Depends(usuario_coffee),
):
    _garantir_banco()
    ids = _validar_ids(pedido.ids)
    job_id = jobs.iniciar_consulta_leitura(
        ids,
        trace=db.trace_atual(),
        usuario=usuario,
    )
    return {"job_id": job_id}


@router.post("/operacao/gerar")
def gerar_operacao(
    pedido: OperacaoIdsPedido,
    usuario: Optional[str] = Depends(usuario_coffee),
):
    _garantir_banco()
    ids = _validar_ids(pedido.ids)
    try:
        job_id = jobs.iniciar_geracao_operacao(
            ids,
            trace=db.trace_atual(),
            usuario=usuario,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"job_id": job_id}


@router.post("/operacao/atualizar-sap")
def atualizar_sap_operacao(
    pedido: OperacaoIdsPedido,
    usuario: Optional[str] = Depends(usuario_coffee),
):
    _garantir_banco()
    ids = _validar_ids(pedido.ids)
    try:
        job_id = jobs.iniciar_atualizacao_sap(
            ids,
            trace=db.trace_atual(),
            usuario=usuario,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"job_id": job_id}


@router.post("/operacao/remover")
def remover_operacao(pedido: OperacaoRemoverPedido):
    _garantir_banco()
    ids = _validar_ids(pedido.ids)
    justificativa = pedido.justificativa.strip()
    if not justificativa:
        raise HTTPException(
            status_code=400,
            detail="Justificativa obrigatória.",
        )
    for pk in ids:
        db.remover_item_operacao(pk)
        db.marcar_gerar(pk, False)
        db.registrar_retorno_verificar(pk, justificativa)
        db.registrar_log(
            "acao_usuario",
            "remover_fila_operacao",
            pk,
            {"justificativa": justificativa},
            True,
        )
    return {"ok": True, "removidas": len(ids)}


@router.get("/logs")
def logs(nota_pk: Optional[int] = None, tipo: Optional[str] = None,
         limit: int = 100, usuario: Optional[str] = None,
         since: Optional[str] = None):
    _garantir_banco()
    return {"logs": db.listar_logs(nota_pk=nota_pk, tipo=tipo, limit=limit,
                                   usuario=usuario, since=since)}


@router.get("/logs/usuarios")
def logs_usuarios():
    _garantir_banco()
    return {"usuarios": db.listar_usuarios_log()}


@router.post("/arquivar")
def arquivar(pedido: ArquivarPedido):
    _garantir_banco()
    if not pedido.justificativa.strip():
        raise HTTPException(status_code=400, detail="Justificativa obrigatoria.")
    if not db.nota_existe(pedido.id):
        raise HTTPException(status_code=404, detail="Nota nao encontrada.")
    db.arquivar_nota(pedido.id)
    db.registrar_log("acao_usuario", "arquivar", pedido.id,
                     {"justificativa": pedido.justificativa.strip()}, True)
    return {"ok": True}


@router.post("/marcar-gerar")
def marcar_gerar(pedido: MarcarGerarPedido):
    _garantir_banco()
    if not pedido.a_gerar and not (pedido.justificativa and pedido.justificativa.strip()):
        raise HTTPException(status_code=400,
                            detail="Justificativa obrigatoria para remover da fila.")
    pk = pedido.id
    if pedido.a_gerar:
        # Resolve o pk real via API e garante nota no DB com arquivado=0.
        try:
            nota = client.buscar_nota(pedido.id)
            pk = nota["pk"]
            classificacao = db.upsert_nota(
                pk,
                nota["id_sap"],
                nota["fields"],
            )
        except client.NotaNaoEncontradaErro as exc:
            db.registrar_log("acao_usuario", "marcar_gerar", pedido.id,
                             {"id": pedido.id, "a_gerar": pedido.a_gerar,
                              "justificativa": pedido.justificativa}, False)
            raise HTTPException(status_code=404, detail=str(exc))
        except Exception:
            db.registrar_log("acao_usuario", "marcar_gerar", pedido.id,
                             {"id": pedido.id, "a_gerar": pedido.a_gerar,
                              "justificativa": pedido.justificativa}, False)
            raise HTTPException(status_code=502,
                                detail="Nao foi possivel buscar a nota na API COFFEE.")
        db.registrar_origem_verificar(pk, pedido.id)
        etapa = operation_service.etapa_da_classificacao(classificacao)
        if etapa is None:
            db.remover_item_operacao(pk)
            db.marcar_gerar(pk, False)
        else:
            db.upsert_item_operacao(
                entrada_id=pk,
                nota_pk=pk,
                etapa=etapa,
                origem="verificar",
            )
            db.marcar_gerar(pk, etapa == "pronta")
    else:
        db.remover_item_operacao(pk)
        db.marcar_gerar(pk, False)
        db.desativar_verificar(pedido.id)
    db.registrar_log("acao_usuario", "marcar_gerar", pk,
                     {"id": pedido.id, "a_gerar": pedido.a_gerar,
                      "justificativa": pedido.justificativa}, True)
    return {"ok": True}


@router.post("/regerar")
def regerar(pedido: RegerarPedido):
    _garantir_banco()
    try:
        nota = client.buscar_nota(pedido.id)
        if nota["id_sap"] and nota["id_sap"] != config.SAP_PENDENTE and not nota["arquivado"]:
            db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
            db.marcar_gerar(nota["pk"], False)
            db.registrar_log("acao_usuario", "geracao_ignorada_sap_real", nota["pk"],
                             {"id_sap": nota["id_sap"]}, True)
            return {"ok": True, "nota": nota}
        # Define o placeholder e desarquiva: o COFFEE so gera notas
        # DESARQUIVADAS — ele atribui o SAP real e arquiva sozinho ao
        # concluir; a nota tem que sair desarquivada daqui.
        client.definir_sap(pedido.id, config.SAP_PENDENTE)
        client.desarquivar(pedido.id)
        nota = client.buscar_nota(pedido.id)
        db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
        if db.origem_atual(nota["pk"]) is None:
            db.definir_origem(nota["pk"], "avulsa")
    except Exception:
        db.registrar_log("acao_usuario", "regerar", pedido.id,
                         {"id": pedido.id, "origem": "ui",
                          "justificativa": pedido.justificativa}, False)
        raise
    db.marcar_gerar(nota["pk"], False)
    db.registrar_log("acao_usuario", "regerar", pedido.id,
                     {"id": pedido.id, "origem": "ui",
                      "justificativa": pedido.justificativa}, True)
    return {"ok": True, "nota": nota}


@router.post("/gerar-lote")
def gerar_lote(pedido: GerarLotePedido, usuario: Optional[str] = Depends(usuario_coffee)):
    _garantir_banco()
    if not pedido.ids:
        raise HTTPException(status_code=400, detail="Lista de IDs vazia.")
    db.registrar_log("acao_usuario", "geracao_lote", None,
                     {"ids": pedido.ids, "total": len(pedido.ids),
                      "justificativa": pedido.justificativa}, True)
    return {"job_id": jobs.iniciar_geracao(pedido.ids, pedido.justificativa,
                                           trace=db.trace_atual(), usuario=usuario)}


@router.post("/corrigir-local-lote")
def corrigir_local_lote(pedido: CorrigirLocalPedido, usuario: Optional[str] = Depends(usuario_coffee)):
    _garantir_banco()
    if not pedido.itens:
        raise HTTPException(status_code=400, detail="Lista de itens vazia.")
    invalidos = [item.id for item in pedido.itens if len(item.local) != 13]
    if invalidos:
        raise HTTPException(
            status_code=400,
            detail=f"Local proposto deve ter 13 caracteres (ids: {invalidos}).")
    db.registrar_log("acao_usuario", "correcao_local_lote", None,
                     {"total": len(pedido.itens),
                      "gerar_apos": pedido.gerar_apos}, True)
    return {"job_id": jobs.iniciar_correcao_local(
        [item.model_dump() for item in pedido.itens],
        pedido.gerar_apos, trace=db.trace_atual(), usuario=usuario)}
