"""Rotas /api/input/* — módulo de Gestão de Notas (Input)."""
from fastapi import Body
import datetime
import io
import json
import os
import re as _re
from typing import Optional
from input_module.status10_service import obter_resumo_status10, gerar_email_outlook_status10
from input_module.notificacoes_service import (
    obter_resumo_alteracoes_diarias,
    gerar_email_outlook_engenheiro,
    gerar_todos_emails_outlook,
)

import pandas as pd
from fastapi import (APIRouter, BackgroundTasks, Depends, File, Header,
                     HTTPException, Request, Response, UploadFile)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from input_module import config, db, engine, metas, relatorios
from input_module.service import (NotasDuplicadasErro, NovaNota, criar_notas,
                                  garantir_banco, pos_escrita, resetar_migracao,
                                  executar_correcao_medidas)

router = APIRouter(prefix="/api/input")


def _df_para_registros(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records", force_ascii=False))


@router.get("/me")
def quem_sou_eu():
    return {"usuario": config.usuario_windows()}


def usuario_atual(x_user: Optional[str] = Header(None)) -> str:
    """Extrai o usuário do header X-User ou fallback para config.usuario_windows()."""
    if x_user and x_user.strip():
        return x_user.strip()
    return config.usuario_windows()


# ── Responsáveis e E-mails ───────────────────────────────────────────────────
@router.get("/responsaveis")
def obter_responsaveis():
    garantir_banco()
    return db.carregar_responsaveis()


@router.put("/responsaveis")
def gravar_responsaveis(novo: dict[str, str], usuario: str = Depends(usuario_atual)):
    garantir_banco()
    db.salvar_responsaveis(novo)
    return {"ok": True}


@router.get("/responsaveis/emails")
def obter_emails_responsaveis():
    garantir_banco()
    return db.carregar_emails_responsaveis()


@router.put("/responsaveis/emails")
def gravar_emails_responsaveis(novo: dict[str, str], usuario: str = Depends(usuario_atual)):
    garantir_banco()
    db.salvar_emails_responsaveis(novo)
    return {"ok": True}


# ── Notificações Diárias aos Engenheiros ───────────────────────────────────────
class PedidoNotificacao(BaseModel):
    engenheiro: str = "__todos__"
    data: Optional[str] = None


@router.get("/notificacoes/resumo-diario")
def notificacoes_resumo_diario(data: Optional[str] = None):
    garantir_banco()
    return obter_resumo_alteracoes_diarias(data_referencia=data)


@router.post("/notificacoes/enviar-email")
def notificacoes_enviar_email(pedido: PedidoNotificacao, usuario: str = Depends(usuario_atual)):
    garantir_banco()
    if pedido.engenheiro == "__todos__":
        resultado = gerar_todos_emails_outlook(data_referencia=pedido.data, usuario=usuario)
    else:
        resultado = gerar_email_outlook_engenheiro(
            engenheiro=pedido.engenheiro,
            data_referencia=pedido.data,
            usuario=usuario,
        )
    if not resultado.get("ok"):
        raise HTTPException(400, detail=resultado.get("mensagem", "Falha ao gerar e-mail"))
    return resultado


@router.get("/notas")
def listar_notas(request: Request, response: Response):
    migracao = garantir_banco()
    versao = db.obter_versao_dataset()
    etag = f'W/"{versao}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    df = engine.get_dataset()
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return {
        "registros": _df_para_registros(df),
        "meta": {
            "status_opcoes": list(config.STATUS_MAP.values()),
            "prioridade_opcoes": config.PRIORIDADES,
            "bases": engine.status_bases(),
            "ultima_alteracao": db.obter_data_ultima_alteracao(),
            "migracao": migracao,
            "colunas": config.COLUNAS_PAINEL,
            "versao": versao,
            "sincronizando": engine.esta_sincronizando_rede(),
        },
    }


@router.get("/sync")
def sync():
    garantir_banco()
    return {
        "ultima_alteracao": db.obter_data_ultima_alteracao(),
        "versao": db.obter_versao_dataset(),
        "sincronizando": engine.esta_sincronizando_rede(),
    }


@router.get("/relatorios/dashboard")
def relatorios_dashboard(request: Request, response: Response,
                         regional: Optional[str] = None,
                         mes: Optional[int] = None):
    if mes is not None and not (1 <= mes <= 12):
        raise HTTPException(status_code=422, detail="mes deve estar entre 1 e 12")
    garantir_banco()
    estado_metas = metas.sincronizar_se_preciso()
    versao = db.obter_versao_dataset()
    agora = datetime.datetime.now()
    mes_referencia = mes or agora.month
    etag = f'W/"{versao}-{mes_referencia}-{regional}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    corpo = relatorios.montar_dashboard(
        engine.get_dataset(), db.carregar_dados_ramal(),
        db.carregar_metas(agora.year), db.carregar_planos_depara(),
        db.carregar_postergacoes(agora.year),
        ano=agora.year, mes_referencia=mes_referencia, regional=regional)
    corpo["regionais_disponiveis"] = relatorios.REGIONAIS_CSD
    corpo["metas_info"] = {
        "atualizadas_em": estado_metas.get("atualizadas_em"),
        "arquivo_mtime": estado_metas.get("arquivo_mtime"),
        "erro": estado_metas.get("erro"),
    }
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return corpo


@router.post("/metas/sincronizar")
def metas_sincronizar():
    garantir_banco()
    return metas.sincronizar_se_preciso(forcar=True)


@router.get("/logs")
def listar_logs():
    garantir_banco()
    return {"registros": _df_para_registros(db.carregar_logs())}


@router.get("/logs/arquivos")
def listar_logs_arquivos():
    garantir_banco()
    return {"registros": _df_para_registros(db.carregar_log_arquivos())}


@router.get("/logs/nota/{numero}")
def timeline_nota(numero: int):
    garantir_banco()
    df = db.carregar_logs()
    if not df.empty:
        df = df[df["Numero_Nota"] == numero]
    return {"registros": _df_para_registros(df)}


# ── Escrita ──────────────────────────────────────────────────────────────
def usuario_atual(x_user: Optional[str] = Header(default=None, alias="X-User")) -> str:
    if not x_user or not x_user.strip():
        raise HTTPException(status_code=400, detail="Header X-User obrigatório para escrita.")
    return x_user.strip()


class EdicaoPedido(BaseModel):
    linhas: list[dict]


class LotePedido(BaseModel):
    notas: list[NovaNota]


class ExclusaoPedido(BaseModel):
    numeros: list[int]


class ExportPedido(BaseModel):
    numeros: list[int]
    colunas: list[str]


@router.patch("/notas")
def editar_notas(pedido: EdicaoPedido, tasks: BackgroundTasks,
                 usuario: str = Depends(usuario_atual)):
    garantir_banco()
    try:
        resultado = db.aplicar_edicoes(pedido.linhas, usuario=usuario)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if resultado["alteradas"]:
        pos_escrita(tasks)
    return {**resultado, "ultima_alteracao": db.obter_data_ultima_alteracao()}


@router.post("/notas")
def criar_nota(nota: NovaNota, tasks: BackgroundTasks,
               usuario: str = Depends(usuario_atual)):
    garantir_banco()
    try:
        inseridas = criar_notas([nota], usuario=usuario)
    except NotasDuplicadasErro as e:
        raise HTTPException(409, str(e))
    pos_escrita(tasks)
    return {"inseridas": inseridas}


@router.post("/notas/bulk")
def criar_lote(pedido: LotePedido, tasks: BackgroundTasks,
               usuario: str = Depends(usuario_atual)):
    garantir_banco()
    if not pedido.notas:
        raise HTTPException(400, "Lote vazio.")
    try:
        inseridas = criar_notas(pedido.notas, usuario=usuario)
    except NotasDuplicadasErro as e:
        raise HTTPException(409, str(e))
    pos_escrita(tasks)
    return {"inseridas": inseridas}


@router.delete("/notas")
def excluir_notas(pedido: ExclusaoPedido, tasks: BackgroundTasks,
                  usuario: str = Depends(usuario_atual)):
    garantir_banco()
    excluidas = db.deletar_notas(pedido.numeros, usuario=usuario)
    if excluidas:
        pos_escrita(tasks)
    return {"excluidas": excluidas}


@router.post("/desfazer")
def desfazer(tasks: BackgroundTasks, usuario: str = Depends(usuario_atual)):
    garantir_banco()
    ok, mensagem = db.reverter_ultima_alteracao()
    if ok:
        pos_escrita(tasks)
    return {"ok": ok, "mensagem": mensagem}


@router.post("/export")
def exportar(pedido: ExportPedido):
    garantir_banco()
    df = engine.get_dataset()
    df = df[df["Numero_Nota"].isin(pedido.numeros)]
    colunas = [c for c in pedido.colunas if c in df.columns]
    df = df[colunas].rename(columns=config.NOMES_AMIGAVEIS)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Selecao_Filtrada")
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="export_notas.xlsx"'},
    )


# ── Tarefa 7: configuração (bases, backups, migração) ─────────────────────────
def _achar_base(nome_arquivo: str) -> str:
    for caminho in config.BASES_APOIO.values():
        if os.path.basename(caminho) == nome_arquivo:
            return caminho
    raise HTTPException(404, f"Base '{nome_arquivo}' não é gerenciada pelo sistema.")


@router.get("/bases")
def listar_bases():
    bases = []
    for nome, caminho in config.BASES_APOIO.items():
        existe = os.path.exists(caminho)
        bases.append({
            "nome": nome, "arquivo": os.path.basename(caminho),
            "encontrada": existe,
            "modificada": datetime.datetime.fromtimestamp(
                os.path.getmtime(caminho)).isoformat() if existe else None,
        })
    return {"bases": bases}


@router.get("/bases/{nome_arquivo}/download")
def baixar_base(nome_arquivo: str):
    caminho = _achar_base(nome_arquivo)
    if not os.path.exists(caminho):
        raise HTTPException(404, "Arquivo não encontrado na rede.")
    return FileResponse(caminho, filename=nome_arquivo)


def _processar_upload_base(nome_arquivo: str, caminho: str) -> bool:
    """Importa o arquivo para o SQLite nativo. Retorna se a importação teve sucesso —
    o chamador usa isso para decidir se registra o import em log_arquivos."""
    map_simples = {
        "Indicador base conjunto - Limite Aneel.xlsx": "base_indicador_continuidade",
        "Gerada_base_IW28.XLSX": "base_iw28",
        "Gerada_custo_ord_IW38.XLSX": "base_iw38",
        "Gerada_medidas_IW66.XLSX": "base_iw66",
        "Clientes_Conjunto.xlsx": "base_clientes",
    }
    try:
        if nome_arquivo in map_simples:
            df = pd.read_excel(caminho)
            db.salvar_base_dataframe(map_simples[nome_arquivo], df)
        elif nome_arquivo == "Ganhos.xlsx":
            df = pd.read_excel(caminho, sheet_name='Ganhos')
            db.salvar_base_dataframe("base_ganhos", df)
        elif nome_arquivo == "Custo_Modular.xlsx":
            df_mod = pd.read_excel(caminho, sheet_name='Modulares')
            db.salvar_base_dataframe("base_custo_modular", df_mod)
            df_saz = pd.read_excel(caminho, sheet_name='Modulares', skiprows=1, nrows=4)
            db.salvar_base_dataframe("base_sazonal", df_saz)
        else:
            return False
        return True
    except Exception as e:
        print(f"Aviso: Não foi possível importar {nome_arquivo} para o SQLite nativo: {e}")
        return False


def _rotina_sap_background():
    import subprocess
    import os
    import sys
    try:
        # Chama o robô SAP forçando UTF-8 para evitar crash com emojis no print.
        # Usa o mesmo Python do venv do backend (com pywin32/pyperclip
        # instalados via requirements-sap-robot.txt) — "python" do PATH do
        # sistema pode não ter essas libs.
        script_path = str(config.caminho_sap_robot())
        python_exe = sys.executable
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        env["INPUT_DB_PATH"] = db.obter_caminho_banco()
        subprocess.run([python_exe, script_path], check=True, env=env)

        # Assim que termina, atualiza o SQLite com os arquivos gerados; só
        # registra em log_arquivos (e portanto bumpa a versão do dataset) os
        # arquivos que realmente foram importados com sucesso.
        arquivos = {
            "Gerada_base_IW28.XLSX": config.CAMINHO_BASE_IW28,
            "Gerada_custo_ord_IW38.XLSX": config.CAMINHO_CUSTO_ORD_IW38,
            "Gerada_medidas_IW66.XLSX": config.CAMINHO_BASE_IW66,
        }
        agora = datetime.datetime.now()
        for nome, caminho in arquivos.items():
            if _processar_upload_base(nome, caminho):
                db.salvar_log_arquivo(nome, "robo-sap", agora, "Sync SAP")

        engine.invalidar_cache()
        engine.invalidar_status_bases()
    except Exception as e:
        print(f"Erro na execução em background do SAP: {e}")



@router.post("/bases/sync-sap")
def sync_sap(tasks: BackgroundTasks, x_user: Optional[str] = Header(default="Sistema", alias="X-User"), payload: dict = Body(None)):
    """Inicia a extração SAP em background."""
    garantir_banco()
    tasks.add_task(_rotina_sap_background)
    return {"mensagem": "Sincronização SAP iniciada em background."}


@router.post("/bases/{nome_arquivo}")
def substituir_base(nome_arquivo: str, arquivo: UploadFile = File(...),
                    usuario: str = Depends(usuario_atual)):
    garantir_banco()
    caminho = _achar_base(nome_arquivo)
    try:
        with open(caminho, "wb") as f:
            f.write(arquivo.file.read())
    except OSError as e:
        raise HTTPException(502, f"Erro ao gravar na rede: {e}")

    if _processar_upload_base(nome_arquivo, caminho):
        db.salvar_log_arquivo(nome_arquivo, usuario, datetime.datetime.now(), "Substituição")
    engine.invalidar_cache()
    engine.invalidar_status_bases()
    return {"ok": True}


@router.get("/backups")
def listar_backups():
    pasta = config.data_dir() / "backups"
    backups = []
    if pasta.exists():
        for arq in sorted(pasta.glob("notas_departamento_*.db"),
                          key=os.path.getmtime, reverse=True):
            backups.append({
                "arquivo": arq.name,
                "tamanho_mb": round(arq.stat().st_size / (1024 * 1024), 2),
                "modificado": datetime.datetime.fromtimestamp(arq.stat().st_mtime).isoformat(),
            })
    return {"backups": backups}


@router.get("/backups/{nome}/download")
def baixar_backup(nome: str):
    if not _re.fullmatch(r"notas_departamento_\d{8}_\d{6}\.db", nome):
        raise HTTPException(400, "Nome de backup inválido.")
    caminho = config.data_dir() / "backups" / nome
    if not caminho.exists():
        raise HTTPException(404, "Backup não encontrado.")
    return FileResponse(str(caminho), filename=nome)


# ── Fase 4: Ramal + Hierarquia ────────────────────────────────────────────────
class RamalNota(BaseModel):
    Numero_Nota: int
    Status_Obra: str = "-"
    Conjunto: str = "-"
    Circuito: str = "-"
    Local_Instalacao: str = "-"
    Planejado_DDPM: float = 0.0
    Mes_Execucao_Planejado: str = "-"
    CenTrab_Respon: str = "-"
    Prioridade_Nota: str = "-"
    Observacao: str = ""
    Extracao_Antiga: str = "-"
    Status_Nota: str = "-"
    Status_Anterior: str = "-"
    Check_Btzero: str = "-"
    Plano: str = "-"


class RamalLotePedido(BaseModel):
    notas: list[RamalNota]


class ExclusaoRamalPedido(BaseModel):
    numeros: list[int]


class HierarquiaPedido(BaseModel):
    dados: dict[str, list[int]]


@router.get("/ramal")
def listar_ramal():
    garantir_banco()
    return {"registros": _df_para_registros(db.carregar_dados_ramal())}


@router.post("/ramal/bulk")
def importar_ramal(pedido: RamalLotePedido, tasks: BackgroundTasks,
                   usuario: str = Depends(usuario_atual)):
    garantir_banco()
    if not pedido.notas:
        raise HTTPException(400, "Lote vazio.")
    # ID_Cronologia é resolvido no db (preserva o de quem já existe).
    df = pd.DataFrame([n.model_dump() for n in pedido.notas])
    db.salvar_ramal_em_massa(df)
    pos_escrita(tasks)
    return {"inseridas": len(df)}


@router.delete("/ramal")
def excluir_ramal(pedido: ExclusaoRamalPedido, tasks: BackgroundTasks,
                  usuario: str = Depends(usuario_atual)):
    garantir_banco()
    excluidas = db.deletar_notas_ramal(pedido.numeros, usuario=usuario)
    if excluidas:
        pos_escrita(tasks)
    return {"excluidas": excluidas}


@router.post("/hierarquia")
def vincular_hierarquia(pedido: HierarquiaPedido, tasks: BackgroundTasks,
                        usuario: str = Depends(usuario_atual)):
    garantir_banco()
    atualizadas = db.vincular_nota_mae_lote(
        {k: v for k, v in pedido.dados.items()}, usuario=usuario
    )
    if atualizadas:
        engine.invalidar_cache()
    return {"atualizadas": atualizadas}


@router.get("/hierarquia/{numero_nota}")
def obter_hierarquia(numero_nota: int):
    garantir_banco()
    df = db.carregar_dados()
    if df.empty or numero_nota not in df["Numero_Nota"].values:
        raise HTTPException(404, f"Nota {numero_nota} não encontrada.")
    nota_row = df[df["Numero_Nota"] == numero_nota].iloc[0]
    nota_mae = str(nota_row.get("Nota_Mae", "-"))
    filhas_df = df[df["Nota_Mae"].astype(str) == str(numero_nota)]
    return {
        "nota_mae": nota_mae,
        "filhas": _df_para_registros(filhas_df[["Numero_Nota", "Status_Nota", "Conjunto"]]),
    }


@router.post("/migrar")
def migrar_novamente(usuario: str = Depends(usuario_atual)):
    resetar_migracao()
    resultado = garantir_banco()
    engine.invalidar_cache()
    return {"resultado": resultado}


class CorrecaoItem(BaseModel):
    nota: int
    quantidade: float
    unidade: str


class RateioExecutarPedido(BaseModel):
    correcoes: list[CorrecaoItem]
    login_sap: Optional[str] = None
    senha_sap: Optional[str] = None
    modo_teste: bool = True


@router.post("/rateio/executar")
def rateio_executar(
    pedido: RateioExecutarPedido,
    tasks: BackgroundTasks,
    usuario: str = Depends(usuario_atual)
):
    garantir_banco()
    if not pedido.correcoes:
        raise HTTPException(400, "Lista de correções vazia.")
    try:
        lista_dicts = [item.model_dump() for item in pedido.correcoes]
        relatorio = executar_correcao_medidas(
            correcoes=lista_dicts,
            login_sap=pedido.login_sap,
            senha_sap=pedido.senha_sap,
            modo_teste=pedido.modo_teste,
            usuario=usuario
        )
        if not pedido.modo_teste:
            pos_escrita(tasks)
        return {"relatorio": relatorio}
    except Exception as e:
        raise HTTPException(500, f"Erro ao executar robô SAP: {e}")


# ── Status 10 Relatório e E-mail ──────────────────────────────────────────────
@router.get("/status10/resumo")
def status10_resumo():
    garantir_banco()
    return obter_resumo_status10()


@router.post("/status10/enviar-email")
def status10_enviar_email(usuario: str = Depends(usuario_atual)):
    garantir_banco()
    resultado = gerar_email_outlook_status10(usuario=usuario)
    if not resultado["ok"]:
        raise HTTPException(400, detail=resultado["mensagem"])
    return resultado
