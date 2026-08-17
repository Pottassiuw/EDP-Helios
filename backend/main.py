import io
import json
import math
import os
import pathlib
import re
import sqlite3
import threading
import time
import uuid
from typing import Optional

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv(pathlib.Path(__file__).resolve().parent / ".env")

from coffee_module import client as _coffee_client
from coffee_module import config as _coffee_config
from coffee_module import db as _coffee_db
from carteira_module import db as _carteira_db
from carteira_module import repository as _carteira_repo
from verificar_module.source import FonteVerificarIndisponivelErro, carregar_fonte

app = FastAPI(title="De olho no Problema")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)


# Instrumentação opcional: ligue com EDP_PERF=1 para medir a abertura da seção
# COFFEE em produção sem recompilar nada. Loga só rota, duração e tamanho —
# nunca corpo, header ou identificador de usuário.
_PERF_ATIVO = os.environ.get("EDP_PERF", "").strip() not in ("", "0", "false")
_PERF_ROTAS = ("/api/data", "/api/coffee/")


@app.middleware("http")
async def _trace_middleware(request, call_next):
    _coffee_db.definir_trace(uuid.uuid4().hex[:12])
    if not _PERF_ATIVO or not request.url.path.startswith(_PERF_ROTAS):
        return await call_next(request)
    inicio = time.perf_counter()
    resposta = await call_next(request)
    duracao_ms = (time.perf_counter() - inicio) * 1000
    tamanho = resposta.headers.get("content-length", "?")
    print(f"[COFFEE-PERF] {request.method} {request.url.path} "
          f"status={resposta.status_code} {duracao_ms:.0f}ms bytes={tamanho}")
    return resposta


# ── Scheduler (Extração Noturna do SAP) ──────────────────────────────────────
import asyncio
import datetime
from input_module.routes import _rotina_sap_background

async def _agendador_sap_noturno():
    """Roda infinitamente verificando se é a hora da madrugada (ex: 03:00) para acionar o SAP."""
    while True:
        agora = datetime.datetime.now()
        # Se for 3 da manhã e estivermos no minuto 0 (com margem de erro do sleep)
        if agora.hour == 3 and agora.minute == 0:
            print("🕒 [Scheduler] Iniciando extração noturna do SAP...")
            # Roda em thread para não bloquear o event loop do FastAPI
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _rotina_sap_background)
            print("✅ [Scheduler] Extração noturna finalizada!")
            
            # Dorme por 61 minutos para garantir que não vai rodar de novo hoje às 3h
            await asyncio.sleep(61 * 60)
        else:
            # Verifica a cada 30 segundos
            await asyncio.sleep(30)

@app.on_event("startup")
async def start_scheduler():
    # Verificar lê o estado da fila no coffee.db antes de qualquer rota
    # /api/coffee/*; aplica as migrações também nesse caminho.
    _coffee_db.inicializar_banco()
    asyncio.create_task(_agendador_sap_noturno())



RECORDS = []
COMPLETED = set()
UPLOAD_STATE_LOCK = threading.Lock()

STATE_FILE = pathlib.Path(__file__).parent / "app_state.json"
DE_PARA_MEMBROS_PADRAO = pathlib.Path(__file__).parent.parent / "De-Para Membros.xlsx"

# Colunas que o frontend realmente lê de `raw` (interface NoteRaw em
# frontend/src/types.ts). A planilha de verificação traz dezenas de colunas
# extras: mandar todas era ~76% do corpo de GET /api/data (medido: 4.5 MB para
# 2000 notas, 3.4 MB só de `raw`) sem nenhum consumidor no frontend.
_RAW_UTEIS = frozenset({
    "id", "tipo_nota", "referencia_fisica", "prioridade", "setor", "uf",
    "local_instalacao", "alimentador", "colaborador", "executor",
    "imagens_totais", "imagens_recebidas", "latitude", "longitude",
    "id_sap", "descricao", "poste", "postes", "problema",
})


def slim_raw(raw: dict) -> dict:
    """Projeta um dict `raw` nas colunas que o frontend consome."""
    return {k: v for k, v in raw.items() if k in _RAW_UTEIS}


def normalizar_matricula(valor: object) -> str:
    """Normaliza matrículas vindas do Excel sem perder a chave de cruzamento."""
    if valor is None or pd.isna(valor):
        return ""
    texto = str(valor).strip()
    return texto[:-2] if texto.endswith(".0") else texto


def caminho_de_para_membros() -> pathlib.Path:
    caminho = os.environ.get("DE_PARA_MEMBROS_PATH")
    return pathlib.Path(caminho) if caminho else DE_PARA_MEMBROS_PADRAO


def carregar_membros() -> dict[str, dict[str, object]]:
    """Lê os campos públicos do De-Para necessários à identificação do gerador."""
    caminho = caminho_de_para_membros()
    if not caminho.is_file():
        raise FileNotFoundError(f"Arquivo De-Para de membros não encontrado: {caminho}")

    membros = pd.read_excel(caminho, sheet_name="Colaboradores")
    colunas_necessarias = {"Matrícula", "Nome", "Sobrenome", "Uf", "Permissoes"}
    ausentes = colunas_necessarias - set(membros.columns)
    if ausentes:
        nomes = ", ".join(sorted(ausentes))
        raise ValueError(f"De-Para de membros sem as colunas obrigatórias: {nomes}")

    resultado: dict[str, dict[str, object]] = {}
    for _, membro in membros.iterrows():
        matricula = normalizar_matricula(membro["Matrícula"])
        if not matricula:
            continue
        nome = " ".join(
            parte for parte in (str(membro["Nome"]).strip(), str(membro["Sobrenome"]).strip())
            if parte and parte.lower() != "nan"
        )
        uf = "" if pd.isna(membro["Uf"]) else str(membro["Uf"]).strip()
        permissoes = "" if pd.isna(membro["Permissoes"]) else str(membro["Permissoes"]).lower()
        resultado[matricula] = {
            "matricula": matricula,
            "nome": nome or matricula,
            "uf": uf,
            "inspetor": uf in {"ES", "SP"} and "inspetor_planejamento" in permissoes,
            "cadastrado": True,
        }
    return resultado


def enriquecer_gerador(registro: dict, membros: dict[str, dict[str, object]]) -> None:
    """Acrescenta o gerador identificado pelo campo colaborador da nota."""
    matricula = normalizar_matricula(registro.get("raw", {}).get("colaborador"))
    registro["gerador"] = membros.get(matricula, {
        "matricula": matricula,
        "nome": matricula or "Não informado",
        "uf": "",
        "inspetor": False,
        "cadastrado": False,
    })


# ── Persistência ─────────────────────────────────────────────────────────────


def save_state():
    # Escrita atômica: sem o temporário, uma falha no meio da gravação
    # (acentos + codec locale do Windows) trunca o arquivo bom para 0 byte
    # e a triagem carregada se perde no próximo start do backend.
    tmp = STATE_FILE.with_name(STATE_FILE.name + ".tmp")
    try:
        tmp.write_text(
            json.dumps(
                {"records": RECORDS, "completed": list(COMPLETED)},
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        tmp.replace(STATE_FILE)
    except Exception as e:
        tmp.unlink(missing_ok=True)
        print(
            f"Falha ao salvar {STATE_FILE.name}: {e}. "
            "A triagem continua em memória, mas será perdida ao reiniciar "
            "o backend — reimporte a planilha em COFFEE > Verificar."
        )


def load_state():
    global RECORDS, COMPLETED
    if not STATE_FILE.exists() or STATE_FILE.stat().st_size == 0:
        return
    try:
        state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        RECORDS = state.get("records", [])
        COMPLETED = set(state.get("completed", []))
        # Estado gravado antes do enxugamento do `raw` continua no disco com
        # todas as colunas da planilha. Projeta uma vez na carga em vez de a
        # cada GET /api/data.
        membros = carregar_membros()
        for registro in RECORDS:
            if isinstance(registro.get("raw"), dict):
                registro["raw"] = slim_raw(registro["raw"])
                enriquecer_gerador(registro, membros)
        enriquecer_candidatos_externos(RECORDS)
    except CarteiraIndisponivelErro:
        raise
    except Exception as e:
        print(
            f"Falha ao ler {STATE_FILE.name}: {e}. "
            "Iniciando com a triagem vazia — reimporte a planilha em "
            "COFFEE > Verificar."
        )


# A triagem agora vem do Verificar.db. O estado em JSON é mantido apenas para
# compatibilidade do endpoint legado de upload e não é restaurado no startup.


# ── Helpers ──────────────────────────────────────────────────────────────────


def parse_coord(v):
    if v is None or pd.isna(v):
        return None
    s = str(v).strip().replace(",", ".")
    try:
        coordenada = float(s)
    except ValueError:
        return None
    return coordenada if math.isfinite(coordenada) else None


def extract_str(row, *keys):
    for key in keys:
        v = row.get(key)
        if v is not None and pd.notna(v):
            s = str(v).strip()
            if s:
                return s
    return None


# Columns excluded from the generic chk_* error loop
_IGNORED_CHK = {"chk_duplicada", "chk_trafo"}


def parse_duplicate_ids(value, own_id: str, id_set: set) -> list:
    """Parse a chk_duplicada cell → deduplicated list of {id, in_sheet} dicts."""
    if not value or str(value).strip().lower() in ("", "ok", "nan", "none"):
        return []
    raw = str(value).strip()
    if not re.search(r"\d", raw):          # non-numeric sentinels: coordenada_invalida etc.
        return []
    seen, result = set(), []
    for token in raw.split("/"):
        t = token.strip()
        if not t or not re.search(r"\d", t):
            continue
        if t == own_id or t in seen:       # discard self-reference and duplicates
            continue
        seen.add(t)
        result.append({"id": t, "in_sheet": t in id_set})
    return result


def enrich_candidate(cand: dict, source: dict) -> dict:
    return {
        **cand,
        "local_instalacao": source.get("local_instalacao") or "",
        "poste":            source.get("poste") or "",
        "referencia":       source.get("referencia") or "",
        "referencia_eletrica": source.get("referencia_eletrica") or "",
        "problema":         source.get("problema") or "",
        "observacao":       source.get("observacao") or "",
        "campos_com_erro":  source.get("campos_com_erro") or [],
        "latitude":         source.get("latitude"),
        "longitude":        source.get("longitude"),
    }


class CarteiraIndisponivelErro(RuntimeError):
    """A projeção local da Carteira não pôde ser lida para a triagem."""


def enriquecer_candidatos_externos(records: list[dict]) -> None:
    """Preenche candidatas externas (in_sheet=False) com dados da Carteira, em lote.

    Uma única query IN para todas as candidatas externas do request inteiro —
    nunca uma chamada por candidata. Candidatas in_sheet=True não são tocadas
    (já vieram enriquecidas por enrich_candidate a partir da própria planilha).
    """
    ids_externos = {
        int(cand["id"])
        for record in records for cand in record["duplicates"]
        if not cand["in_sheet"] and str(cand["id"]).isdigit()
    }
    if not ids_externos:
        return

    try:
        conn = _carteira_db.conectar()
        try:
            encontrados = _carteira_repo.obter_muitas(conn, list(ids_externos))
        finally:
            conn.close()
    except (sqlite3.Error, OSError) as exc:
        raise CarteiraIndisponivelErro(
            "Carteira de Notas indisponível para enriquecer duplicatas externas."
        ) from exc

    for record in records:
        for cand in record["duplicates"]:
            if cand["in_sheet"]:
                continue
            cand["campos_com_erro"] = cand.get("campos_com_erro") or []
            nota = encontrados.get(int(cand["id"])) if str(cand["id"]).isdigit() else None
            cand["carteira_match"] = nota is not None
            if nota is None:
                continue
            cand["local_instalacao"] = nota.get("local_instalacao") or ""
            cand["problema"] = " · ".join(
                parte for parte in [nota.get("componente_novo"), nota.get("sintoma")] if parte
            ) or ""
            cand["status_sap"] = nota.get("status_sap")
            cand["prioridade_sap"] = nota.get("prioridade_sap")
            cand["conjunto"] = nota.get("descricao_conjunto") or nota.get("conjunto")
            cand["latitude"] = nota.get("latitude")
            cand["longitude"] = nota.get("longitude")
            cand["carteira_ausente_em"] = nota.get("ausente_na_origem_em")


def montar_registros_triagem(df: pd.DataFrame) -> list[dict]:
    """Converte a fonte Verificar no contrato já consumido pelo frontend."""
    membros = carregar_membros()
    chk_cols = [
        coluna for coluna in df.columns
        if re.match(r"^chk_", str(coluna).strip(), re.IGNORECASE)
        and str(coluna).strip().lower() not in _IGNORED_CHK
    ]
    records = []

    for _, row in df.iterrows():
        errors = []
        campos_com_erro = []
        for coluna in chk_cols:
            valor = str(row[coluna]).strip().lower()
            if valor and valor not in ["ok", "nan", "none", ""]:
                errors.append({
                    "rule": coluna,
                    "rule_name": coluna.replace("chk_", "").replace("_", " ").title(),
                    "value": str(row[coluna]),
                })
                tokens = str(coluna).strip().lower().replace("chk_", "").split("_")
                if any(token in {"componente", "sintoma", "causa", "problema"} for token in tokens):
                    campo = "problema"
                elif "local" in tokens and "instalacao" in tokens:
                    campo = "local_instalacao"
                elif any(token in {"poste", "postes"} for token in tokens):
                    campo = "poste"
                elif "referencia" in tokens:
                    campo = "referencia"
                else:
                    campo = None
                if campo and campo not in campos_com_erro:
                    campos_com_erro.append(campo)

        prioridade_raw = row.get("prioridade")
        try:
            prioridade = int(prioridade_raw) if pd.notna(prioridade_raw) else 99
        except (TypeError, ValueError):
            prioridade = 99

        problema_parts = [
            extract_str(row, "componente"),
            extract_str(row, "sintoma"),
            extract_str(row, "causa"),
        ]
        records.append({
            "id": str(row.get("id", "")).strip(),
            "prioridade": prioridade,
            "tipo_nota": str(row.get("tipo_nota", "-")),
            "referencia": str(
                row.get("referencia_fisica") or row.get("referencia_eletrica") or "-"
            ).strip(),
            "uf": extract_str(row, "uf"),
            "setor": extract_str(row, "setor", "REGIAO"),
            "latitude": parse_coord(row.get("latitude")),
            "longitude": parse_coord(row.get("longitude")),
            "precisao": extract_str(row, "precisao"),
            "poste": extract_str(row, "postes", "poste"),
            "problema": " · ".join(parte for parte in problema_parts if parte) or None,
            "observacao": extract_str(row, "observacao", "observacoes") or "",
            "referencia_eletrica": extract_str(row, "referencia_eletrica") or "",
            "campos_com_erro": campos_com_erro,
            "errors": errors,
            "status": "erro" if errors else "ok",
            "_dup_raw": str(row.get("chk_duplicada", "") or "").strip(),
            "raw": {
                str(chave): str(valor) if pd.notna(valor) else "-"
                for chave, valor in row.items() if str(chave) in _RAW_UTEIS
            },
        })

    ids = {record["id"] for record in records}
    por_id = {record["id"]: record for record in records}
    for record in records:
        candidates = parse_duplicate_ids(record.pop("_dup_raw", ""), record["id"], ids)
        if not candidates:
            record["duplicates"] = []
            continue
        record["duplicates"] = [
            enrich_candidate(candidate, por_id[candidate["id"]])
            if candidate["in_sheet"] else candidate
            for candidate in candidates
        ]
        record["errors"].append({
            "rule": "chk_duplicata",
            "rule_name": "Duplicata",
            "value": f"{len(candidates)} candidata{'s' if len(candidates) != 1 else ''}",
        })
        record["status"] = "erro"

    enriquecer_candidatos_externos(records)

    for record in records:
        enriquecer_gerador(record, membros)
    return records


# ── Endpoints ─────────────────────────────────────────────────────────────────


class ErroLeituraUpload(Exception):
    """Representa falhas de parsing que devem manter o contrato HTTP 400."""


def processar_upload(filename: str, content: bytes) -> list[dict]:
    """Lê a planilha e monta a triagem fora da thread da event loop."""
    try:
        if filename.endswith(".csv"):
            dataframe = pd.read_csv(io.StringIO(content.decode("utf-8-sig")))
        else:
            dataframe = pd.read_excel(io.BytesIO(content))
    except Exception as erro:
        raise ErroLeituraUpload(str(erro)) from erro

    return montar_registros_triagem(dataframe)


def publicar_upload(records: list[dict]) -> int:
    """Publica e persiste um upload sem intercalar o estado global."""
    global RECORDS, COMPLETED

    with UPLOAD_STATE_LOCK:
        RECORDS = records
        COMPLETED = set()
        save_state()
        return len(records)


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(
            status_code=400, detail="Formato inválido. Use .xlsx, .xls ou .csv"
        )

    try:
        content = await file.read()
        records = await asyncio.to_thread(processar_upload, file.filename, content)
    except ErroLeituraUpload as erro:
        raise HTTPException(status_code=400, detail=f"Erro ao ler arquivo: {erro}") from erro
    except CarteiraIndisponivelErro as erro:
        raise HTTPException(status_code=503, detail=str(erro)) from erro
    except (FileNotFoundError, ValueError, OSError) as erro:
        raise HTTPException(
            status_code=500,
            detail=f"Não foi possível identificar quem gerou as notas: {erro}",
        ) from erro
    total = await asyncio.to_thread(publicar_upload, records)

    return {"status": "ok", "total": total}


@app.get("/api/data")
def get_data():
    completed = COMPLETED
    encaminhamentos: dict = {}
    encaminhadas_hoje: list[dict] = []
    fonte = None
    if RECORDS:
        records = RECORDS
    else:
        try:
            fonte = carregar_fonte()
            records = montar_registros_triagem(fonte.registros)
        except FonteVerificarIndisponivelErro as erro:
            raise HTTPException(status_code=503, detail=str(erro)) from erro
        except CarteiraIndisponivelErro as erro:
            raise HTTPException(status_code=503, detail=str(erro)) from erro
        except (FileNotFoundError, ValueError, OSError) as erro:
            raise HTTPException(
                status_code=500,
                detail=f"Não foi possível preparar a triagem: {erro}",
            ) from erro
        corrigidos = _coffee_db.ids_verificar_corrigidos()
        records = [record for record in records if record["id"] not in corrigidos]
        resumo_triagem = _coffee_db.resumo_triagem_verificar()
        encaminhamentos = resumo_triagem["encaminhamentos"]
        encaminhadas_hoje = resumo_triagem["encaminhadas_hoje"]
        completed = {
            identificar for identificar, estado in encaminhamentos.items()
            if estado["situacao"] != "retornada"
        }

    rule_stats = {}
    uf_set = set()
    setor_set = set()

    for r in records:
        for e in r["errors"]:
            rule_stats[e["rule"]] = rule_stats.get(e["rule"], 0) + 1
        if r["uf"]:
            uf_set.add(r["uf"])
        if r["setor"]:
            setor_set.add(r["setor"])

    return {
        "records": records,
        "completed": list(completed),
        "encaminhamentos": encaminhamentos,
        "encaminhadas_hoje": encaminhadas_hoje,
        "rule_stats": rule_stats,
        "uf_options": sorted(uf_set),
        "setor_options": sorted(setor_set),
        "fonte": None if fonte is None else {
            "arquivo": fonte.arquivo,
            "schema_version": fonte.schema_version,
            "atualizado_em": fonte.atualizado_em,
        },
    }


@app.post("/api/complete/{note_id}")
def toggle_complete(note_id: str):
    if note_id in COMPLETED:
        COMPLETED.remove(note_id)
    else:
        COMPLETED.add(note_id)
    save_state()
    return {"status": "ok", "completed": note_id in COMPLETED}


class DuplicataPedido(BaseModel):
    justificativa: Optional[str] = None


@app.post("/api/duplicata/{note_id}")
def mark_duplicata(note_id: str, pedido: DuplicataPedido | None = None):
    """Marca a nota como duplicata: id_sap vira o sentinel 99999999 no COFFEE
    ao vivo (mesmo mecanismo real do SAP_PENDENTE=10000000), a nota é
    arquivada localmente (some da fila do COFFEE) e sai de qualquer item de
    operação pendente. Justificativa é opcional, só vai pro log de auditoria.
    """
    try:
        _coffee_client.definir_sap(note_id, _coffee_config.SAP_DUPLICATA)
        nota = _coffee_client.buscar_nota(note_id)
    except _coffee_client.NotaNaoEncontradaErro as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail="Não foi possível marcar a nota como duplicata no COFFEE."
        ) from exc
    _coffee_db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
    _coffee_db.arquivar_nota(nota["pk"])
    _coffee_db.remover_item_operacao(nota["pk"])
    _coffee_db.marcar_gerar(nota["pk"], False)
    _coffee_db.registrar_log(
        "acao_usuario", "marcar_duplicata", nota["pk"],
        {"id": note_id, "justificativa": (pedido.justificativa if pedido else None) or ""}, True,
    )
    COMPLETED.add(note_id)
    save_state()
    return {"status": "ok"}


@app.post("/api/duplicata/{note_id}/desfazer")
def desfazer_duplicata(note_id: str):
    """Reverte a marcação de duplicata: id_sap volta a 10000000 (SAP_PENDENTE,
    ao vivo) e a nota é desarquivada localmente.
    """
    try:
        _coffee_client.definir_sap(note_id, _coffee_config.SAP_PENDENTE)
        _coffee_client.desarquivar(note_id)
        nota = _coffee_client.buscar_nota(note_id)
    except _coffee_client.NotaNaoEncontradaErro as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail="Não foi possível desfazer a duplicata no COFFEE."
        ) from exc
    _coffee_db.upsert_nota(nota["pk"], nota["id_sap"], nota["fields"])
    _coffee_db.desarquivar_nota(nota["pk"])
    _coffee_db.registrar_log("acao_usuario", "desfazer_duplicata", nota["pk"], {"id": note_id}, True)
    COMPLETED.discard(note_id)
    save_state()
    return {"status": "ok"}


from input_module.routes import router as input_router

app.include_router(input_router)

from coffee_module.routes import router as coffee_router

app.include_router(coffee_router)

from integracao_module.routes import router as integracao_router

app.include_router(integracao_router)

from carteira_module.routes import router as carteira_router
from carteira_module import db as _carteira_db

_carteira_db.inicializar_banco()
app.include_router(carteira_router)


DIST = pathlib.Path(__file__).parent.parent / "frontend" / "dist"
if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="static")
