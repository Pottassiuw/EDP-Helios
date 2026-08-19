"""Rotas /api/input/* — módulo de Gestão de Notas (Input)."""
from fastapi import Body
import datetime
import io
import json
import os
import re as _re
import tempfile
import threading
from typing import Optional
from input_module.status10_service import (
    obter_resumo_status10,
    gerar_email_outlook_status10,
    extrair_sap_status10,
)
from input_module.notificacoes_service import (
    obter_resumo_alteracoes_diarias,
    gerar_email_outlook_engenheiro,
    gerar_todos_emails_outlook,
)

import pandas as pd
from fastapi import (APIRouter, BackgroundTasks, Depends, File, Header,
                     HTTPException, Query, Request, Response, UploadFile)
from fastapi.responses import FileResponse
from pydantic import BaseModel

from input_module import config, db, engine, metas, relatorios, sap_sync
from input_module.service import (NotasDuplicadasErro, NovaNota, criar_notas,
                                  garantir_banco, pos_escrita, resetar_migracao,
                                  executar_correcao_medidas)

router = APIRouter(prefix="/api/input")


def _df_para_registros(df: pd.DataFrame) -> list:
    return json.loads(df.to_json(orient="records", force_ascii=False))


@router.get("/me")
def quem_sou_eu():
    return {"usuario": config.usuario_windows()}


def usuario_atual(x_user: Optional[str] = Header(default=None, alias="X-User")) -> str:
    """Identidade explícita de quem chamou — sem cair no usuário do servidor.

    Toda operação que deixa rastro (escrita ou exportação) depende disto. O
    fallback para `config.usuario_windows()` não serve aqui: em produção o
    processo roda com o mesmo login para todo mundo, e a trilha deixaria de
    responder "quem fez".
    """
    if not x_user or not x_user.strip():
        raise HTTPException(status_code=400,
                            detail="Header X-User obrigatório para escrita.")
    return x_user.strip()


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
            "sap": sap_sync.estado(),
        },
    }


@router.get("/sync")
def sync():
    garantir_banco()
    return {
        "ultima_alteracao": db.obter_data_ultima_alteracao(),
        "versao": db.obter_versao_dataset(),
        "sincronizando": engine.esta_sincronizando_rede(),
        "espelho": engine.estado_espelho(),
        "sap": sap_sync.estado(),
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


def _termos_de_nota(busca: Optional[str]) -> list[str]:
    """Quebra a busca colada da tela (vírgula, espaço, quebra de linha)."""
    if not busca:
        return []
    return [termo for termo in _re.split(r"[\s,;\n\t]+", busca.strip()) if termo]


@router.get("/logs")
def listar_logs(nota: Optional[str] = None, usuario: Optional[str] = None,
                tipo: Optional[str] = None,
                limite: Optional[int] = Query(None, ge=1),
                offset: int = Query(0, ge=0)):
    """Log de alterações paginado e filtrado no banco.

    Sem parâmetros o contrato antigo continua valendo (histórico inteiro em
    `registros`); `paginacao`, `resumo` e `usuarios` são acréscimos.
    """
    garantir_banco()
    if tipo and tipo not in db.CONDICOES_TIPO_LOG:
        raise HTTPException(
            422, f"Tipo de evento desconhecido: {tipo}. "
                 f"Use um de: {', '.join(sorted(db.CONDICOES_TIPO_LOG))}.")

    termos = _termos_de_nota(nota)
    limite_efetivo = min(limite, db.LIMITE_MAXIMO_LOGS) if limite else None
    df = db.carregar_logs(termos, usuario, tipo, limite_efetivo, offset)
    total = db.contar_logs(termos, usuario, tipo)
    return {
        "registros": _df_para_registros(df),
        "paginacao": {
            "total": total,
            "limite": limite_efetivo,
            "offset": offset,
            "tem_mais": limite_efetivo is not None and offset + len(df) < total,
        },
        "resumo": db.resumo_logs(),
        "usuarios": db.usuarios_dos_logs(),
    }


@router.get("/logs/arquivos")
def listar_logs_arquivos():
    garantir_banco()
    return {"registros": _df_para_registros(db.carregar_log_arquivos())}


@router.get("/logs/nota/{numero}")
def timeline_nota(numero: int, limite: Optional[int] = Query(None, ge=1)):
    """Timeline da nota consultada direto no SQLite (sem varrer o histórico)."""
    garantir_banco()
    limite_efetivo = min(limite, db.LIMITE_MAXIMO_LOGS) if limite else None
    return {"registros": _df_para_registros(
        db.carregar_logs_da_nota(numero, limite_efetivo))}


# ── Escrita ──────────────────────────────────────────────────────────────
class EdicaoPedido(BaseModel):
    linhas: list[dict]


class LotePedido(BaseModel):
    notas: list[NovaNota]


class ExclusaoPedido(BaseModel):
    numeros: list[int]
    motivo: Optional[str] = None


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
    excluidas = db.deletar_notas(pedido.numeros, usuario=usuario, motivo=pedido.motivo)
    if excluidas:
        pos_escrita(tasks)
    return {"excluidas": excluidas}


# ── Bloqueios (edição concorrente) ──────────────────────────────────────────
class DestravarPedido(BaseModel):
    numeros: list[int]


@router.get("/bloqueios")
def listar_bloqueios():
    garantir_banco()
    ativos = db.obter_bloqueios()
    return {"bloqueios": [
        {"Numero_Nota": numero, "Usuario": info["usuario"], "Data_Hora": info["desde"]}
        for numero, info in ativos.items()
    ]}


@router.post("/notas/{numero}/travar")
def travar_nota(numero: int, usuario: str = Depends(usuario_atual)):
    garantir_banco()
    return db.travar_nota(numero, usuario)


@router.post("/notas/destravar")
def destravar_notas(pedido: DestravarPedido, usuario: str = Depends(usuario_atual)):
    garantir_banco()
    return {"liberadas": db.destravar_notas(pedido.numeros, usuario)}


@router.post("/desfazer")
def desfazer(tasks: BackgroundTasks, usuario: str = Depends(usuario_atual)):
    garantir_banco()
    ok, mensagem = db.reverter_ultima_alteracao(usuario)
    if ok:
        pos_escrita(tasks)
    return {"ok": ok, "mensagem": mensagem}


NOME_ARQUIVO_EXPORT = "export_notas.xlsx"


@router.post("/export")
def exportar(pedido: ExportPedido, usuario: str = Depends(usuario_atual)):
    garantir_banco()
    desconhecidas = [c for c in pedido.colunas if c not in config.COLUNAS_PAINEL]
    if desconhecidas:
        raise HTTPException(
            422, "Coluna(s) fora do contrato de exportação: "
                 f"{', '.join(desconhecidas)}. Use as colunas do painel.")
    df = engine.get_dataset()
    df = df[df["Numero_Nota"].isin(pedido.numeros)]
    # `reindex` preserva a ordem pedida e entrega a coluna vazia quando ela
    # existe no contrato mas não no dataset (base de apoio ausente, por
    # exemplo) — a planilha nunca sai com menos colunas do que a tela ofereceu.
    df = df.reindex(columns=pedido.colunas).rename(columns=config.NOMES_AMIGAVEIS)
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Selecao_Filtrada")
    # Só metadado operacional: quem, quando e o volume levado — nunca o
    # conteúdo exportado. Sem o registro o arquivo não sai: uma exportação
    # sem rastro é exatamente o que esta trilha existe para impedir.
    auditoria_gravada = db.salvar_log_arquivo(
        NOME_ARQUIVO_EXPORT, usuario, datetime.datetime.now(),
        f"{db.ACAO_EXPORTACAO} ({len(df)} notas, {len(pedido.colunas)} colunas)")
    if not auditoria_gravada:
        raise HTTPException(
            500, "Exportação cancelada: não foi possível registrar a auditoria. "
                 "Tente de novo; se persistir, avise o suporte do sistema.")
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition":
                 f'attachment; filename="{NOME_ARQUIVO_EXPORT}"'},
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


def _importar_base_para_sqlite(nome_arquivo: str, caminho: str,
                               tabelas_tocadas: Optional[list] = None) -> None:
    """Lê o Excel em `caminho` e grava as tabelas da base no SQLite nativo.

    Levanta em qualquer falha (arquivo ilegível, aba ausente, erro de escrita) —
    quem precisa do resultado como booleano usa `_processar_upload_base`.

    A leitura do arquivo inteiro vem antes da primeira gravação, inclusive nas
    bases multi-tabela: uma planilha inválida é recusada sem tocar o SQLite.

    Uma tabela entra em `tabelas_tocadas` quando a gravação chegou a começar:
    `salvar_base_dataframe` usa `to_sql(if_exists="replace")`, que dropa a tabela
    antiga, então um `to_sql` que levanta já pode ter mexido no SQLite. Banco que
    nem abriu (`db.GravacaoNaoIniciadaErro`) fica de fora: não há o que desfazer,
    e quem trata o erro não pode confundir "nem começou" com "parou no meio"."""
    tocadas = [] if tabelas_tocadas is None else tabelas_tocadas

    def gravar(nome_tabela: str, df) -> None:
        try:
            db.salvar_base_dataframe(nome_tabela, df)
        except db.GravacaoNaoIniciadaErro:
            raise
        except Exception:
            tocadas.append(nome_tabela)
            raise
        tocadas.append(nome_tabela)

    map_simples = {
        "Indicador base conjunto - Limite Aneel.xlsx": "base_indicador_continuidade",
        "Gerada_base_IW28.XLSX": "base_iw28",
        "Gerada_custo_ord_IW38.XLSX": "base_iw38",
        "Gerada_ord_IW38.XLSX": "base_iw38",
        "Gerada_medidas_IW66.XLSX": "base_iw66",
        "Clientes_Conjunto.xlsx": "base_clientes",
    }
    if nome_arquivo in map_simples:
        df = pd.read_excel(caminho)
        gravar(map_simples[nome_arquivo], df)
    elif nome_arquivo == "Ganhos.xlsx":
        df = pd.read_excel(caminho, sheet_name='Ganhos')
        gravar("base_ganhos", df)
    elif nome_arquivo == "Custo_Modular.xlsx":
        # As duas abas são lidas ANTES da primeira gravação: uma planilha que só
        # revela o defeito na segunda leitura é recusada sem ter tocado o SQLite.
        df_mod = pd.read_excel(caminho, sheet_name='Modulares')
        df_saz = pd.read_excel(caminho, sheet_name='Modulares', skiprows=1, nrows=4)
        gravar("base_custo_modular", df_mod)
        gravar("base_sazonal", df_saz)
    else:
        raise ValueError(f"'{nome_arquivo}' não tem importador para o SQLite nativo.")


def _processar_upload_base(nome_arquivo: str, caminho: str) -> bool:
    """Importa o arquivo para o SQLite nativo. Retorna se a importação teve sucesso —
    o chamador usa isso para decidir se registra o import em log_arquivos."""
    try:
        _importar_base_para_sqlite(nome_arquivo, caminho)
        return True
    except Exception as e:
        print(f"Aviso: Não foi possível importar {nome_arquivo} para o SQLite nativo: {e}")
        return False


def _descartar_temporario(caminho: str) -> None:
    """Remove o temporário de upload sem mascarar o erro que levou ao descarte."""
    try:
        os.remove(caminho)
    except FileNotFoundError:
        pass
    except OSError as e:
        print(f"Aviso: temporário de upload não removido ({caminho}): {e}")


_travas_de_base: dict[str, threading.Lock] = {}
_trava_do_registro = threading.Lock()


def _trava_da_base(caminho: str) -> threading.Lock:
    """Trava exclusiva de UMA base de apoio.

    Uploads da mesma base serializam (troca do Excel e import para o SQLite
    formam um bloco só); uploads de bases diferentes continuam em paralelo."""
    with _trava_do_registro:
        return _travas_de_base.setdefault(caminho, threading.Lock())


def _realinhar_sqlite_com_o_alvo(nome_arquivo: str, caminho: str) -> bool:
    """Reimporta o arquivo que está no alvo, desfazendo gravações parciais de um
    upload que falhou depois de já ter mexido no SQLite.

    Devolve se o SQLite ficou comprovadamente igual ao alvo. Se a base ainda não
    existe na rede — primeiro upload — não há de onde realinhar, e isso também é
    um `False`: as tabelas gravadas ficam sem arquivo correspondente."""
    if not os.path.exists(caminho):
        print(f"Aviso: o SQLite pode ter dados parciais de '{nome_arquivo}': "
              f"a base ainda não existe em '{caminho}' para realinhar.")
        return False
    return _processar_upload_base(nome_arquivo, caminho)


def _exigir_sqlite_realinhado(nome_arquivo: str, caminho: str, causa: Exception) -> None:
    """Realinha o SQLite com o alvo depois de um upload que já gravou tabelas.

    Se o realinhamento não passar, o banco pode ter ficado com dados de um
    arquivo que nunca entrou na rede. Engolir isso faria o usuário ler o erro
    como "só a planilha foi recusada": a rota corta aqui, invalida os caches
    (que seguiriam servindo o estado anterior) e diz que a consistência não pôde
    ser confirmada."""
    if _realinhar_sqlite_com_o_alvo(nome_arquivo, caminho):
        return
    engine.invalidar_cache()
    engine.invalidar_status_bases()
    raise HTTPException(
        500, f"Upload de '{nome_arquivo}' falhou ({causa}) e o banco não pôde ser realinhado "
             "com o arquivo da rede: a consistência entre os dois NÃO pôde ser confirmada. "
             "O arquivo na rede não foi alterado. Reenvie a base; se o erro repetir, "
             "acione o suporte antes de usar os dados desta base.")


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
        raise



@router.post("/bases/sync-sap")
def sync_sap(tasks: BackgroundTasks, x_user: Optional[str] = Header(default="Sistema", alias="X-User"), payload: dict = Body(None)):
    """Inicia a extração SAP em background."""
    garantir_banco()
    try:
        estado = sap_sync.reservar()
    except sap_sync.SapSyncEmAndamento as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    tasks.add_task(sap_sync.executar, _rotina_sap_background)
    return {
        "mensagem": "Sincronização SAP iniciada em background.",
        "sap": estado,
    }


@router.get("/bases/sync-sap/status")
def sync_sap_status():
    """Estado exclusivo da execução SAP, sem inferir estado por outra operação."""
    garantir_banco()
    return {"sap": sap_sync.estado()}


@router.post("/bases/{nome_arquivo}")
def substituir_base(nome_arquivo: str, arquivo: UploadFile = File(...),
                    usuario: str = Depends(usuario_atual)):
    garantir_banco()
    caminho = _achar_base(nome_arquivo)

    # Grava num temporário no MESMO diretório do alvo: o alvo só é trocado por
    # esse arquivo já completo (os.replace é atômico dentro do mesmo volume).
    # Assim uma queda no meio da gravação nunca deixa a base da rede truncada.
    try:
        descritor, temporario = tempfile.mkstemp(
            dir=os.path.dirname(caminho), prefix=f"{nome_arquivo}.", suffix=".tmp")
    except OSError as e:
        raise HTTPException(502, f"Erro ao gravar na rede: {e}")

    try:
        with os.fdopen(descritor, "wb") as f:
            f.write(arquivo.file.read())
    except OSError as e:
        _descartar_temporario(temporario)
        raise HTTPException(502, f"Erro ao gravar na rede: {e}")

    # O import para o SQLite, a troca do Excel e o log da substituição rodam sob
    # a trava desta base: dois uploads simultâneos da mesma base se enfileiram em
    # vez de intercalar tabelas e arquivo.
    #
    # O alvo só muda no os.replace final, e nunca sai do lugar antes dele: em
    # qualquer queda o Excel da rede continua legível — no conteúdo antigo ou no
    # novo. Se o SQLite já tiver recebido dados quando algo falha, ele é
    # realinhado com o arquivo que ficou no alvo; se nem isso passar, a resposta
    # avisa que a consistência entre os dois não pôde ser confirmada.
    with _trava_da_base(caminho):
        tabelas_tocadas: list = []
        try:
            _importar_base_para_sqlite(nome_arquivo, temporario, tabelas_tocadas)
        except Exception as e:
            _descartar_temporario(temporario)
            # Bases multi-tabela (Custo_Modular) podem falhar já com uma tabela
            # gravada; o realinhamento devolve o SQLite ao conteúdo do alvo. Se
            # nada foi tocado — arquivo ilegível, aba faltando — não há o que
            # realinhar, e reimportar por reimportar só arriscaria uma tabela sã.
            if tabelas_tocadas:
                _exigir_sqlite_realinhado(nome_arquivo, caminho, e)
            raise HTTPException(
                422, f"Arquivo recusado: não foi possível importar '{nome_arquivo}' ({e}). "
                     "A base na rede não foi alterada — confira o layout/abas da planilha e envie de novo.")

        try:
            os.replace(temporario, caminho)
        except OSError as e:
            _descartar_temporario(temporario)
            _exigir_sqlite_realinhado(nome_arquivo, caminho, e)
            raise HTTPException(502, f"Erro ao substituir '{nome_arquivo}' na rede: {e}. "
                                     "A base na rede não foi alterada — tente novamente.")

        # Auditoria é o último passo, e é best-effort: aqui o Excel e o SQLite
        # já estão trocados e consistentes. Falhar a resposta agora faria o
        # usuário reenviar uma base que já entrou — o upload é confirmado, com
        # aviso de que ficou sem rastro em log_arquivos.
        try:
            auditoria_gravada = db.salvar_log_arquivo(
                nome_arquivo, usuario, datetime.datetime.now(), "Substituição")
        except Exception as e:
            print(f"Erro ao salvar log de arquivo: {e}")
            auditoria_gravada = False

    # Invalidação sempre depois da publicação, gravada a auditoria ou não: os
    # caches seguiriam servindo a base anterior.
    engine.invalidar_cache()
    engine.invalidar_status_bases()
    if not auditoria_gravada:
        return {"ok": True, "aviso": f"'{nome_arquivo}' foi substituída na rede e no banco, mas o "
                                     "registro de auditoria não pôde ser gravado: esta substituição "
                                     "não vai aparecer no histórico de arquivos. Avise o suporte."}
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
    padrao_backup = r"notas_departamento_\d{8}_\d{6}(?:_[0-9a-f]{32})?\.db"
    if not _re.fullmatch(padrao_backup, nome):
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
    db.salvar_ramal_em_massa(df, usuario=usuario)
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
        pos_escrita(tasks)
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


# ── Status 10 Relatório, Extração SAP e E-mail ────────────────────────────────
@router.get("/status10/resumo")
def status10_resumo():
    garantir_banco()
    return obter_resumo_status10()


@router.post("/status10/extrair-sap")
def status10_extrair_sap():
    garantir_banco()
    resultado = extrair_sap_status10()
    if not resultado.get("ok", False):
        raise HTTPException(500, detail=resultado.get("mensagem", "Erro na extração SAP"))
    return resultado


@router.post("/status10/enviar-email")
def status10_enviar_email(usuario: str = Depends(usuario_atual)):
    garantir_banco()
    resultado = gerar_email_outlook_status10(usuario=usuario)
    if not resultado["ok"]:
        raise HTTPException(400, detail=resultado["mensagem"])
    return resultado
