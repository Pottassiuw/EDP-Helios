"""Rotas da Carteira (FastAPI). Endpoints finos: validam e chamam o service."""
from fastapi import (APIRouter, BackgroundTasks, Depends, HTTPException, Query,
                     Request, Response)
from pydantic import BaseModel, Field

from carteira_module import db, movimentacao, service
from input_module.routes import usuario_atual
from input_module.service import NotasDuplicadasErro, pos_escrita

router = APIRouter(prefix="/api/carteira", tags=["carteira"])

_REPRESENTACAO_ENRIQUECIMENTO = "enriquecimento-v2"


@router.get("/notas")
def listar_notas(
    regional: str | None = None,
    conjunto: str | None = None,
    status_sap: str | None = None,
    situacao: str | None = None,
    sap_real: int | None = None,
    q: str | None = None,
    incluir_ausentes: bool = False,
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=500),
    ordenar_por: str = "id_onr",
    ordem: str = "asc",
):
    filtros = {
        "regional": regional, "conjunto": conjunto, "status_sap": status_sap,
        "situacao": situacao, "sap_real": sap_real, "q": q,
        "incluir_ausentes": incluir_ausentes,
    }
    return service.pagina_notas(filtros, page, size, ordenar_por, ordem)


@router.get("/notas/por-sap/{numero}")
def obter_enriquecimento_por_sap(
    numero: int,
    request: Request,
    response: Response,
):
    corpo = service.enriquecimento_por_sap(numero)
    etag = f'W/"{_REPRESENTACAO_ENRIQUECIMENTO}-{corpo["versao"]}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    response.headers.update(headers)
    return corpo


@router.get("/notas/{id_onr}")
def obter_nota(id_onr: int):
    nota = service.detalhe(id_onr)
    if nota is None:
        raise HTTPException(status_code=404, detail="Nota nao encontrada na carteira.")
    return nota


@router.get("/resumo")
def resumo():
    return service.resumo()


@router.get("/dashboard")
def dashboard(request: Request, response: Response,
              ano: int | None = None, mes: int | None = None,
              regional: str | None = None):
    etag = f'W/"{service.versao_dashboard()}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    corpo = service.dashboard(ano, mes, regional)
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return corpo


@router.get("/sincronizacao")
def sincronizacao():
    return service.estado_sincronizacao()


@router.post("/sincronizar")
def sincronizar():
    return service.disparar_sincronizacao()


class PreviewPedido(BaseModel):
    id_onrs: list[int] = Field(min_length=1)


class MoverPedido(BaseModel):
    id_onrs: list[int] = Field(min_length=1)
    mes_execucao: str
    status_obra: str = "-"
    observacao: str | None = None
    check: str | None = None


@router.post("/mover/preview")
def mover_preview(pedido: PreviewPedido):
    return movimentacao.preview(pedido.id_onrs)


@router.post("/mover-para-plano")
def mover(pedido: MoverPedido, tasks: BackgroundTasks,
          usuario: str = Depends(usuario_atual)):
    campos = {"Mes_Execucao_Planejado": pedido.mes_execucao,
              "Status_Obra": pedido.status_obra}
    if pedido.observacao is not None:
        campos["Observacao"] = pedido.observacao
    if pedido.check is not None:
        campos["Check"] = pedido.check
    try:
        resultado = movimentacao.mover_para_plano(pedido.id_onrs, campos, usuario)
    except movimentacao.MovimentacaoBloqueadaErro as e:
        raise HTTPException(422, str(e))
    except NotasDuplicadasErro as e:
        raise HTTPException(409, str(e))
    pos_escrita(tasks)
    return resultado


@router.get("/movimentacoes")
def movimentacoes(id_onr: int | None = None):
    conn = db.conectar()
    try:
        if id_onr is not None:
            linhas = conn.execute(
                "SELECT * FROM plano_movimentacoes WHERE id_onr = ? "
                "ORDER BY id DESC", (id_onr,)).fetchall()
        else:
            linhas = conn.execute(
                "SELECT * FROM plano_movimentacoes ORDER BY id DESC LIMIT 200"
            ).fetchall()
    finally:
        conn.close()
    return [dict(l) for l in linhas]


@router.get("/divergencias")
def divergencias():
    return movimentacao.listar_divergencias()
