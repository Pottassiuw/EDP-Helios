import asyncio
import re
import threading
from concurrent.futures import ThreadPoolExecutor

import pandas as pd
import pytest

from main import enrich_candidate, montar_registros_triagem, parse_coord, parse_duplicate_ids


def test_ok_returns_empty():
    assert parse_duplicate_ids("ok", "100", set()) == []

def test_empty_returns_empty():
    assert parse_duplicate_ids("", "100", set()) == []
    assert parse_duplicate_ids(None, "100", set()) == []

def test_nan_returns_empty():
    assert parse_duplicate_ids("nan", "100", set()) == []


def test_parse_coord_descarta_nan_e_infinito():
    assert parse_coord("nan") is None
    assert parse_coord("inf") is None
    assert parse_coord("-20,3") == -20.3

def test_non_numeric_sentinel_returns_empty():
    assert parse_duplicate_ids("coordenada_invalida", "100", set()) == []

def test_single_external():
    result = parse_duplicate_ids("171153", "100", set())
    assert result == [{"id": "171153", "in_sheet": False}]

def test_single_in_sheet():
    result = parse_duplicate_ids("200", "100", {"200", "300"})
    assert result == [{"id": "200", "in_sheet": True}]

def test_multiple_with_dedup():
    result = parse_duplicate_ids("229482 / 229482 / 229482", "100", set())
    assert result == [{"id": "229482", "in_sheet": False}]

def test_multiple_distinct():
    result = parse_duplicate_ids("278801 / 278802", "100", set())
    assert len(result) == 2
    assert result[0]["id"] == "278801"
    assert result[1]["id"] == "278802"

def test_self_reference_discarded():
    result = parse_duplicate_ids("100 / 200", "100", set())
    assert len(result) == 1
    assert result[0]["id"] == "200"

def test_mixed_in_sheet_and_external():
    id_set = {"200"}
    result = parse_duplicate_ids("200 / 300", "100", id_set)
    assert result[0] == {"id": "200", "in_sheet": True}
    assert result[1] == {"id": "300", "in_sheet": False}

def test_enrich_candidate():
    cand = {"id": "200", "in_sheet": True}
    source = {
        "local_instalacao": "SER-11",
        "poste": "TR-088",
        "referencia": "SER-11 · TR-088",
        "problema": "COND · AFRO · IN",
        "latitude": -20.3,
        "longitude": -40.3,
    }
    result = enrich_candidate(cand, source)
    assert result["local_instalacao"] == "SER-11"
    assert result["poste"] == "TR-088"
    assert result["referencia"] == "SER-11 · TR-088"
    assert result["problema"] == "COND · AFRO · IN"
    assert result["latitude"] == -20.3

def test_enrich_candidate_empty_fields():
    cand = {"id": "200", "in_sheet": True}
    source = {"local_instalacao": None, "poste": "", "referencia": None, "problema": None, "latitude": None, "longitude": None}
    result = enrich_candidate(cand, source)
    assert result["local_instalacao"] == ""
    assert result["poste"] == ""
    assert result["problema"] == ""


def test_montar_triagem_mapeia_erros_e_propaga_contexto_para_candidata(monkeypatch):
    monkeypatch.setattr("main.carregar_membros", lambda: {})
    registros = montar_registros_triagem(pd.DataFrame([
        {
            "id": "100", "chk_duplicada": "200", "observacoes": "Conferir no campo",
            "chk_componente": "diverge", "chk_local_instalacao": "diverge",
            "chk_postes": "diverge", "chk_referencia_fisica": "diverge",
        },
        {"id": "200", "observacao": "Nota relacionada"},
    ]))

    origem, candidata = registros[0], registros[0]["duplicates"][0]
    assert origem["observacao"] == "Conferir no campo"
    assert origem["campos_com_erro"] == ["problema", "local_instalacao", "poste", "referencia"]
    assert candidata["observacao"] == "Nota relacionada"
    assert candidata["campos_com_erro"] == []

def test_gzip_comprime_resposta_grande(monkeypatch):
    """Respostas acima do limite saem comprimidas quando o cliente aceita gzip."""
    from fastapi.testclient import TestClient
    import main

    grande = [{"id": str(i), "errors": [], "uf": "SP", "setor": "Centro"}
              for i in range(500)]
    monkeypatch.setattr(main, "RECORDS", grande)
    client = TestClient(main.app)
    r = client.get("/api/data", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    # httpx descomprime transparentemente: o corpo continua íntegro
    assert len(r.json()["records"]) == 500


def test_upload_processa_csv_e_triagem_fora_da_thread_da_event_loop(monkeypatch):
    """A leitura e a triagem do upload não podem bloquear a event loop."""
    from fastapi.testclient import TestClient
    import main

    thread_da_event_loop = []
    threads_do_processamento = []
    to_thread_original = asyncio.to_thread

    async def observar_to_thread(funcao, /, *args, **kwargs):
        thread_da_event_loop.append(threading.get_ident())
        return await to_thread_original(funcao, *args, **kwargs)

    def ler_csv(*args, **kwargs):
        threads_do_processamento.append(threading.get_ident())
        return pd.DataFrame([{"id": 100}])

    def montar_triagem(dataframe):
        threads_do_processamento.append(threading.get_ident())
        assert dataframe.to_dict("records") == [{"id": 100}]
        return [{"id": "100", "raw": {}}]

    monkeypatch.setattr(main.asyncio, "to_thread", observar_to_thread)
    monkeypatch.setattr(main.pd, "read_csv", ler_csv)
    monkeypatch.setattr(main, "montar_registros_triagem", montar_triagem)
    monkeypatch.setattr(main, "save_state", lambda: None)

    resposta = TestClient(main.app).post(
        "/api/upload", files={"file": ("notas.csv", b"id\n100\n")}
    )

    assert resposta.status_code == 200
    assert resposta.json() == {"status": "ok", "total": 1}
    assert thread_da_event_loop
    assert threads_do_processamento
    assert set(threads_do_processamento).isdisjoint(thread_da_event_loop)


def test_upload_mantem_erro_de_leitura_quando_processamento_vai_para_worker(monkeypatch):
    """Erro de leitura continua 400, mesmo quando o helper roda em worker."""
    from fastapi.testclient import TestClient
    import main

    thread_da_event_loop = []
    thread_da_leitura = []
    to_thread_original = asyncio.to_thread

    async def observar_to_thread(funcao, /, *args, **kwargs):
        thread_da_event_loop.append(threading.get_ident())
        return await to_thread_original(funcao, *args, **kwargs)

    def falhar_leitura(*args, **kwargs):
        thread_da_leitura.append(threading.get_ident())
        raise ValueError("arquivo inválido")

    monkeypatch.setattr(main.asyncio, "to_thread", observar_to_thread)
    monkeypatch.setattr(main.pd, "read_csv", falhar_leitura)

    resposta = TestClient(main.app).post(
        "/api/upload", files={"file": ("notas.csv", b"id\n100\n")}
    )

    assert resposta.status_code == 400
    assert resposta.json()["detail"] == "Erro ao ler arquivo: arquivo inválido"
    assert len(thread_da_event_loop) == 1
    assert set(thread_da_leitura).isdisjoint(thread_da_event_loop)


def test_uploads_simultaneos_publicam_e_persistem_o_proprio_estado(monkeypatch):
    """Sem publicação atômica, o primeiro upload responde e salva dados do segundo."""
    from fastapi.testclient import TestClient
    import main

    primeiro_save_iniciado = threading.Event()
    segundo_save_iniciado = threading.Event()
    estados_persistidos = []

    def processar_upload(_filename, content):
        if content == b"primeiro":
            return [{"id": "primeiro", "raw": {}}]
        assert primeiro_save_iniciado.wait(timeout=1)
        return [
            {"id": "segundo-1", "raw": {}},
            {"id": "segundo-2", "raw": {}},
        ]

    def salvar_estado():
        if main.RECORDS[0]["id"] == "primeiro":
            primeiro_save_iniciado.set()
            segundo_save_iniciado.wait(timeout=1)
        else:
            segundo_save_iniciado.set()
        estados_persistidos.append([registro["id"] for registro in main.RECORDS])

    def enviar(cliente, nome, content):
        resposta = cliente.post("/api/upload", files={"file": (nome, content)})
        return nome, resposta

    monkeypatch.setattr(main, "processar_upload", processar_upload)
    monkeypatch.setattr(main, "save_state", salvar_estado)

    with TestClient(main.app) as cliente:
        with ThreadPoolExecutor(max_workers=2) as executor:
            resultados = dict(executor.map(
                lambda args: enviar(cliente, *args),
                [("primeiro.csv", b"primeiro"), ("segundo.csv", b"segundo")],
            ))

    assert resultados["primeiro.csv"].json() == {"status": "ok", "total": 1}
    assert resultados["segundo.csv"].json() == {"status": "ok", "total": 2}
    assert estados_persistidos == [["primeiro"], ["segundo-1", "segundo-2"]]


def test_slim_raw_mantem_so_colunas_consumidas():
    """`raw` era ~76% do corpo de GET /api/data com colunas que o front ignora."""
    from main import slim_raw

    resultado = slim_raw({
        "id": "100", "local_instalacao": "SER-11", "postes": "TR-088",
        "coluna_interna_do_excel": "x" * 500, "chk_coordenada": "ok",
    })
    assert resultado == {"id": "100", "local_instalacao": "SER-11", "postes": "TR-088"}


def test_upload_enriquece_gerador_com_de_para(tmp_path, monkeypatch):
    """O filtro de inspetores usa a matrícula da coluna colaborador da nota."""
    import io
    import pandas as pd
    from fastapi.testclient import TestClient
    import main

    de_para = tmp_path / "membros.xlsx"
    pd.DataFrame([{
        "Matrícula": 204565, "Nome": "Fabricio", "Sobrenome": "Dias",
        "Uf": "ES", "Permissoes": "colaborador, inspetor_planejamento",
    }]).to_excel(de_para, sheet_name="Colaboradores", index=False)
    monkeypatch.setenv("DE_PARA_MEMBROS_PATH", str(de_para))

    planilha = io.BytesIO()
    pd.DataFrame([{
        "id": 100728801, "prioridade": 1, "tipo_nota": "Poda",
        "referencia_fisica": "SER-11", "uf": "ES", "setor": "Centro",
        "colaborador": 204565, "chk_coordenada": "ok",
    }]).to_excel(planilha, index=False)

    cliente = TestClient(main.app)
    resposta = cliente.post("/api/upload", files={"file": ("p.xlsx", planilha.getvalue())})
    assert resposta.status_code == 200

    gerador = cliente.get("/api/data").json()["records"][0]["gerador"]
    assert gerador == {
        "matricula": "204565", "nome": "Fabricio Dias", "uf": "ES", "inspetor": True,
        "cadastrado": True,
    }


def test_upload_gerador_sem_registro_no_de_para(tmp_path, monkeypatch):
    """Matrícula da nota sem linha correspondente no De-Para vira gerador não cadastrado."""
    import io
    import pandas as pd
    from fastapi.testclient import TestClient
    import main

    de_para = tmp_path / "membros.xlsx"
    pd.DataFrame([{
        "Matrícula": 204565, "Nome": "Fabricio", "Sobrenome": "Dias",
        "Uf": "ES", "Permissoes": "colaborador, inspetor_planejamento",
    }]).to_excel(de_para, sheet_name="Colaboradores", index=False)
    monkeypatch.setenv("DE_PARA_MEMBROS_PATH", str(de_para))

    planilha = io.BytesIO()
    pd.DataFrame([{
        "id": 100728802, "prioridade": 1, "tipo_nota": "Poda",
        "referencia_fisica": "SER-12", "uf": "ES", "setor": "Centro",
        "colaborador": 999999, "chk_coordenada": "ok",
    }]).to_excel(planilha, index=False)

    cliente = TestClient(main.app)
    resposta = cliente.post("/api/upload", files={"file": ("p.xlsx", planilha.getvalue())})
    assert resposta.status_code == 200

    gerador = cliente.get("/api/data").json()["records"][0]["gerador"]
    assert gerador == {
        "matricula": "999999", "nome": "999999", "uf": "", "inspetor": False,
        "cadastrado": False,
    }


def test_upload_nao_devolve_colunas_extras_em_raw(tmp_path):
    """Round-trip: colunas fora de NoteRaw não chegam ao cliente."""
    import io
    import pandas as pd
    from fastapi.testclient import TestClient
    import main

    planilha = io.BytesIO()
    pd.DataFrame([{
        "id": 100728801, "prioridade": 1, "tipo_nota": "Poda",
        "referencia_fisica": "SER-11", "uf": "SP", "setor": "Centro",
        "postes": "TR-088", "chk_coordenada": "ok",
        "coluna_gigante_do_excel": "y" * 400,
    }]).to_excel(planilha, index=False)

    cliente = TestClient(main.app)
    r = cliente.post("/api/upload", files={"file": ("p.xlsx", planilha.getvalue())})
    assert r.status_code == 200

    registro = cliente.get("/api/data").json()["records"][0]
    assert "coluna_gigante_do_excel" not in registro["raw"]
    assert "chk_coordenada" not in registro["raw"]
    assert registro["raw"]["postes"] == "TR-088"


def test_enriquecer_candidatos_externos_com_match(tmp_path, monkeypatch):
    """Candidata externa com id_onr presente na Carteira ganha os campos reais."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path))
    from carteira_module import db as carteira_db
    carteira_db.inicializar_banco()
    conn = carteira_db.conectar()
    conn.execute(
        "INSERT INTO nota_carteira (id_onr, local_instalacao, sintoma, componente_novo, "
        "status_sap, prioridade_sap, descricao_conjunto, conjunto, latitude, longitude, "
        "ausente_na_origem_em) VALUES (171153, '718ET00026773', 'queda', 'chave', "
        "'Pendente', 3, 'POSTE DEMANDA', 'POSTE', '-23.1', '-45.2', NULL)"
    )
    conn.commit()
    conn.close()

    from main import enriquecer_candidatos_externos
    records = [{
        "id": "100",
        "duplicates": [{"id": "171153", "in_sheet": False}],
    }]
    enriquecer_candidatos_externos(records)

    cand = records[0]["duplicates"][0]
    assert cand["carteira_match"] is True
    assert cand["local_instalacao"] == "718ET00026773"
    assert cand["problema"] == "chave · queda"
    assert cand["status_sap"] == "Pendente"
    assert cand["prioridade_sap"] == 3
    assert cand["conjunto"] == "POSTE DEMANDA"
    assert cand["carteira_ausente_em"] is None


def test_enriquecer_candidatos_externos_sem_match(tmp_path, monkeypatch):
    """Candidata externa sem linha na Carteira só ganha carteira_match=False."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path))
    from carteira_module import db as carteira_db
    carteira_db.inicializar_banco()

    from main import enriquecer_candidatos_externos
    records = [{"id": "100", "duplicates": [{"id": "999999", "in_sheet": False}]}]
    enriquecer_candidatos_externos(records)

    cand = records[0]["duplicates"][0]
    assert cand["carteira_match"] is False
    assert "local_instalacao" not in cand


def test_enriquecer_candidatos_externos_ignora_in_sheet(tmp_path, monkeypatch):
    """Candidata in_sheet=True não é tocada (já veio enriquecida por enrich_candidate)."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path))
    from carteira_module import db as carteira_db
    carteira_db.inicializar_banco()

    from main import enriquecer_candidatos_externos
    original = {"id": "200", "in_sheet": True, "local_instalacao": "SER-11"}
    records = [{"id": "100", "duplicates": [dict(original)]}]
    enriquecer_candidatos_externos(records)

    assert records[0]["duplicates"][0] == original


def test_enriquecer_candidatos_externos_lote_vazio_no_op(tmp_path, monkeypatch):
    """Sem candidatas externas, a função não deve nem abrir conexão com a Carteira."""
    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path / "carteira-nao-existe"))
    from main import enriquecer_candidatos_externos
    records = [{"id": "100", "duplicates": []}]
    enriquecer_candidatos_externos(records)  # não deve levantar (banco nem existe)
    assert records[0]["duplicates"] == []


def test_load_state_enriquece_candidatas_externas_restauradas(tmp_path, monkeypatch):
    """Estado legado restaurado recebe o mesmo enriquecimento da fonte atual."""
    import json
    import main
    from carteira_module import db as carteira_db

    monkeypatch.setenv("CARTEIRA_DATA_DIR", str(tmp_path / "carteira"))
    carteira_db.inicializar_banco()
    conn = carteira_db.conectar()
    conn.execute(
        "INSERT INTO nota_carteira (id_onr, local_instalacao, sintoma, componente_novo) "
        "VALUES (171153, '718ET00026773', 'queda', 'chave')"
    )
    conn.commit()
    conn.close()

    estado = tmp_path / "app_state.json"
    estado.write_text(json.dumps({
        "records": [{
            "id": "100",
            "raw": {},
            "duplicates": [{"id": "171153", "in_sheet": False}],
        }],
        "completed": [],
    }), encoding="utf-8")
    monkeypatch.setattr(main, "STATE_FILE", estado)
    monkeypatch.setattr(main, "carregar_membros", lambda: {})
    monkeypatch.setattr(main, "RECORDS", [])
    monkeypatch.setattr(main, "COMPLETED", set())

    main.load_state()

    candidata = main.RECORDS[0]["duplicates"][0]
    assert candidata["carteira_match"] is True
    assert candidata["local_instalacao"] == "718ET00026773"


def test_get_data_retorna_503_quando_carteira_indisponivel(monkeypatch):
    """Falha de leitura da Carteira vira dependência indisponível, não 500 cru."""
    import sqlite3
    from types import SimpleNamespace
    import pandas as pd
    from fastapi.testclient import TestClient
    import main

    monkeypatch.setattr(main, "RECORDS", [])
    monkeypatch.setattr(main, "carregar_membros", lambda: {})
    monkeypatch.setattr(main, "carregar_fonte", lambda: SimpleNamespace(
        registros=pd.DataFrame([{"id": "100", "chk_duplicada": "171153"}]),
        arquivo="Verificar.db", schema_version=1, atualizado_em=None,
    ))

    def carteira_falhou():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(main._carteira_db, "conectar", carteira_falhou)

    resposta = TestClient(main.app).get("/api/data")

    assert resposta.status_code == 503
    assert "Carteira" in resposta.json()["detail"]
