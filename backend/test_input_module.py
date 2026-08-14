"""Testes do módulo Input (backend)."""
import os
import tempfile
import io

# Blindagem global: impede que a execução de testes afete o banco de dados real
_tmp_test_dir = tempfile.mkdtemp(prefix="edp_input_test_")
os.environ.setdefault("INPUT_DATA_DIR", _tmp_test_dir)

from input_module import config


def test_config_dicionarios_completos():
    assert config.STATUS_MAP[99] == "99 Encerrado"
    assert config.STATUS_MAP[0] == "00 Pendente"
    assert config.INV_STATUS_MAP["99 Encerrado"] == 99
    assert config.DE_PARA_REGIONAL["045"] == "Guarulhos"
    assert config.DE_PARA_CIDADES["130"] == "Mogi das Cruzes - SP"
    assert config.DE_PARA_CJ_ANEEL["POA"] == "POA"
    assert config.MAP_FILTROS["Status"] == "Status_Nota"
    assert config.MAP_ORDEM_EXECUTADA["JAND INVE"] == "SIM"
    assert config.MAP_REGIONAL_CSD["POA"] == "Poa/Suzano"
    assert len(config.BASES_REDE) == 7
    assert len(config.BASES_APOIO) == 4
    assert "Emergente" in config.PRIORIDADES
    assert config.NOMES_AMIGAVEIS["Numero_Nota"] == "Nº Nota (ID)"
    assert "Numero_Nota" in config.COLUNAS_PAINEL


def test_extracoes_sap_compartilham_raiz_arquivos_sap():
    arquivos = {
        config.CAMINHO_BASE_IW28: "Gerada_base_IW28.XLSX",
        config.CAMINHO_CUSTO_ORD_IW38: "Gerada_custo_ord_IW38.XLSX",
        config.CAMINHO_BASE_IW66: "Gerada_medidas_IW66.XLSX",
    }

    for caminho, arquivo in arquivos.items():
        assert caminho == config.REDE_ARQUIVOS_SAP + f"\\{arquivo}"


def test_data_dir_respeita_env(monkeypatch, tmp_path):
    monkeypatch.setenv("INPUT_DATA_DIR", str(tmp_path))
    assert config.data_dir() == tmp_path


import sqlite3

import pytest


@pytest.fixture
def banco_temporario(monkeypatch, tmp_path):
    """Aponta o módulo para um diretório de dados temporário e inicializa o banco."""
    monkeypatch.setenv("INPUT_DATA_DIR", str(tmp_path))
    from input_module import db
    db.inicializar_banco()
    return tmp_path


def test_inicializar_banco_cria_tabelas(banco_temporario):
    from input_module import db
    conn = db.get_db_connection()
    tabelas = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    conn.close()
    assert {"notas", "log_alteracoes", "log_arquivos"} <= tabelas
    assert "bloqueios" not in tabelas  # fora do escopo (spec)


def test_inicializar_banco_cria_indices(banco_temporario):
    from input_module import db
    conn = db.get_db_connection()
    indices = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
    conn.close()
    assert {"idx_log_alteracoes_nota", "idx_log_alteracoes_data",
            "idx_log_arquivos_data"} <= indices


def test_migracao_copia_banco_da_rede(monkeypatch, tmp_path):
    from input_module import config, db
    # Simula o banco "da rede" como um sqlite real noutro tmp
    origem = tmp_path / "rede.db"
    conn = sqlite3.connect(origem)
    conn.execute("CREATE TABLE notas (Numero_Nota INTEGER PRIMARY KEY)")
    conn.execute("INSERT INTO notas VALUES (123)")
    conn.commit(); conn.close()
    monkeypatch.setenv("INPUT_DATA_DIR", str(tmp_path / "dados"))
    monkeypatch.setattr(config, "REDE_DB_ORIGEM", str(origem))
    resultado = db.migrar_da_rede_se_preciso()
    assert resultado == "migrado"
    conn = db.get_db_connection()
    assert conn.execute("SELECT COUNT(*) FROM notas").fetchone()[0] == 1
    conn.close()
    # Segunda chamada: banco já existe, não migra de novo
    assert db.migrar_da_rede_se_preciso() == "ja-existe"


def test_migracao_sem_rede_retorna_indisponivel(monkeypatch, tmp_path):
    from input_module import config, db
    monkeypatch.setenv("INPUT_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "REDE_DB_ORIGEM", str(tmp_path / "nao_existe.db"))
    assert db.migrar_da_rede_se_preciso() == "rede-indisponivel"


# ── Tarefa 3: CRUD, logs, undo, backups, responsáveis e edição com diff ──
import pandas as pd


def _nota(numero=1000, **extras):
    base = {
        "ID_Cronologia": 1, "Numero_Nota": numero, "Status_Obra": "-",
        "Conjunto": "POA", "Circuito": "POA 123", "Local_Instalacao": "045 RL TESTE",
        "Regional": "Guarulhos", "Planejado_DDPM": 2.0,
        "Mes_Execucao_Planejado": "jun-2026", "Data_Envio_Projeto": "01/06/2026",
        "Status_Nota": "10 Em planejamento", "Prioridade_Nota": "Programável",
        "Observacao": "", "Check": "-", "Status_Anterior": "-",
        "Centro_Responsavel": "-",
    }
    base.update(extras)
    return base


def test_upsert_e_carregar(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(1000), _nota(1001, Conjunto="SUZANO")]))
    df = db.carregar_dados()
    assert len(df) == 2
    linha = df[df["Numero_Nota"] == 1000].iloc[0]
    assert linha["Status_Nota"] == "10 Em planejamento"
    assert linha["Cidade"] == "Guarulhos"
    db.salvar_em_massa(pd.DataFrame([_nota(1000, Observacao="editada")]))
    df = db.carregar_dados()
    assert len(df) == 2
    assert df[df["Numero_Nota"] == 1000].iloc[0]["Observacao"] == "editada"


def test_aplicar_edicoes_gera_diff_log_e_status_anterior(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    resultado = db.aplicar_edicoes(
        [{"Numero_Nota": 2000, "Status_Nota": "99 Encerrado", "Observacao": "feita"}],
        usuario="tester")
    assert resultado["alteradas"] == 1
    assert resultado["campos"] == 2
    df = db.carregar_dados()
    linha = df[df["Numero_Nota"] == 2000].iloc[0]
    assert linha["Status_Nota"] == "99 Encerrado"
    assert str(linha["Status_Anterior"]).startswith("10")  # status antigo preservado (numérico)
    logs = db.carregar_logs()
    assert set(logs["Campo_Alterado"]) == {"Status_Nota", "Observacao"}
    assert logs.iloc[0]["Usuario"] == "tester"
    resultado = db.aplicar_edicoes([{"Numero_Nota": 2000, "Observacao": "feita"}], usuario="tester")
    assert resultado["alteradas"] == 0


def test_aplicar_edicoes_nota_inexistente_da_erro(banco_temporario):
    from input_module import db
    with pytest.raises(ValueError):
        db.aplicar_edicoes([{"Numero_Nota": 999999, "Observacao": "x"}], usuario="t")


def test_reverter_ultima_alteracao(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(3000)]))
    db.aplicar_edicoes([{"Numero_Nota": 3000, "Status_Nota": "99 Encerrado"}], usuario="t")
    ok, _msg = db.reverter_ultima_alteracao()
    assert ok
    df = db.carregar_dados()
    assert df[df["Numero_Nota"] == 3000].iloc[0]["Status_Nota"] == "10 Em planejamento"
    ok, _msg = db.reverter_ultima_alteracao()
    assert not ok


def test_deletar_notas(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(4000), _nota(4001)]))
    assert db.deletar_notas([4000]) == 1
    assert list(db.carregar_dados()["Numero_Nota"]) == [4001]


def test_carregar_dados_qualidade(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([
        _nota(4300, Prioridade_Nota="Programavel", Mes_Execucao_Planejado="jun-2026"),
        _nota(4301, Prioridade_Nota="Prioritario", Mes_Execucao_Planejado="2026-12-01 00:00:00"),
    ]))
    df = db.carregar_dados()
    assert len(df) == 2
    pri = dict(zip(df["Numero_Nota"], df["Prioridade_Nota"]))
    assert pri[4300] == "Programável"
    assert pri[4301] == "Prioritário"


def test_carregar_logs_fallback_em_erro(banco_temporario, monkeypatch):
    from input_module import db

    def boom(*args, **kwargs):
        raise RuntimeError("falha simulada de leitura")

    monkeypatch.setattr(db.pd, "read_sql", boom)
    logs = db.carregar_logs()
    assert logs.empty
    assert "Campo_Alterado" in logs.columns
    arquivos = db.carregar_log_arquivos()
    assert arquivos.empty
    assert "Nome_Arquivo" in arquivos.columns


def test_deletar_notas_gera_log(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(4100)]))
    assert db.deletar_notas([4100], usuario="tester") == 1
    logs = db.carregar_logs()
    linha = logs[logs["Numero_Nota"] == 4100].iloc[0]
    assert linha["Campo_Alterado"] == "EXCLUSÃO DE NOTA"
    assert linha["Usuario"] == "tester"


def test_backup_rotativo(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(5000)]))
    pasta = config_backups_dir()
    for f in pasta.glob("notas_departamento_*.db"):
        try:
            os.remove(f)
        except Exception:
            pass
    db.realizar_backup(limite=20, intervalo_horas=0)
    arquivos = list(pasta.glob("notas_departamento_*.db"))
    assert len(arquivos) == 1
    db.realizar_backup(limite=20, intervalo_horas=2)
    assert len(list(pasta.glob("notas_departamento_*.db"))) == 1


def config_backups_dir():
    from input_module import config
    return config.data_dir() / "backups"


def test_responsaveis_roundtrip(banco_temporario):
    from input_module import db
    padrao = db.carregar_responsaveis()
    assert padrao["Poa"] == "Danilo"
    db.salvar_responsaveis({"Poa": "Maria"})
    assert db.carregar_responsaveis() == {"Poa": "Maria"}


# ── Task 2 (integração Coffee↔Input): service.py — caminho canônico ──────
def test_service_criar_notas(banco_temporario):
    from input_module import db, service
    nota = service.NovaNota(
        Numero_Nota=555001, Status_Nota="00 Pendente",
        Prioridade_Nota="Programável", Local_Instalacao="045RL00000001",
    )
    assert service.criar_notas([nota], usuario="teste") == 1
    df = db.carregar_dados()
    linha = df[df["Numero_Nota"] == 555001].iloc[0]
    assert linha["Regional"] == "Guarulhos"          # derivada de Local_Instalacao[:3]
    assert linha["ID_Cronologia"] == 1

    logs = db.carregar_logs()
    assert (logs["Numero_Nota"] == 555001).any()
    log_criacao = logs[logs["Numero_Nota"] == 555001].iloc[0]
    assert log_criacao["Usuario"] == "teste"
    assert log_criacao["Campo_Alterado"] == "CRIAÇÃO DE NOTA"

    with pytest.raises(service.NotasDuplicadasErro):
        service.criar_notas([nota], usuario="teste")


def test_service_criar_notas_duplicata_no_lote(banco_temporario):
    from input_module import service
    n = service.NovaNota(Numero_Nota=7, Status_Nota="00 Pendente", Prioridade_Nota="Programável")
    with pytest.raises(service.NotasDuplicadasErro):
        service.criar_notas([n, n], usuario="teste")


def test_service_criar_nota_filha_diretamente(banco_temporario):
    from input_module import db, service
    mae = service.NovaNota(
        Numero_Nota=555100, Status_Nota="00 Pendente",
        Prioridade_Nota="Programável", Planejado_DDPM=5.0,
    )
    filha = service.NovaNota(
        Numero_Nota=555101, Status_Nota="00 Pendente",
        Prioridade_Nota="Programável", Planejado_DDPM=1.0,
        Nota_Mae="555100",
    )
    assert service.criar_notas([mae, filha], usuario="teste") == 2
    df = db.carregar_dados()
    linha_filha = df[df["Numero_Nota"] == 555101].iloc[0]
    assert str(linha_filha["Nota_Mae"]) == "555100"
    logs = db.carregar_logs()
    log_filha = logs[logs["Numero_Nota"] == 555101].iloc[0]
    assert "Mãe: 555100" in log_filha["Valor_Novo"]


# ── Task 13: versão do dataset (cache/ETag de GET /notas) ────────────────
def test_versao_dataset_muda_com_escritas(banco_temporario):
    from input_module import db, service
    import datetime
    v0 = db.obter_versao_dataset()
    nota = service.NovaNota(Numero_Nota=777001, Status_Nota="00 Pendente", Prioridade_Nota="Programável")
    service.criar_notas([nota], usuario="teste")           # criação não loga: pega pelo COUNT(notas)
    v1 = db.obter_versao_dataset()
    assert v1 != v0
    db.aplicar_edicoes([{"Numero_Nota": 777001, "Observacao": "editada"}], usuario="teste")
    v2 = db.obter_versao_dataset()
    assert v2 != v1
    db.salvar_log_arquivo("Gerada_base_IW28.XLSX", "robo-sap", datetime.datetime.now(), "Sync SAP")
    assert db.obter_versao_dataset() != v2


# ── Task 14: cache do engine revalidado por versão do dataset ───────────
def test_get_dataset_revalida_por_versao(banco_temporario, monkeypatch):
    from input_module import db, engine, service
    engine.invalidar_cache()
    df1 = engine.get_dataset()
    chamadas = {"n": 0}
    original = engine.enriquecer_dados
    def contando():
        chamadas["n"] += 1
        return original()
    monkeypatch.setattr(engine, "enriquecer_dados", contando)
    engine.get_dataset()                      # versão igual: serve do cache
    assert chamadas["n"] == 0
    nota = service.NovaNota(Numero_Nota=888001, Status_Nota="00 Pendente", Prioridade_Nota="Programável")
    service.criar_notas([nota], usuario="teste")   # muda a versão (sem invalidar_cache manual)
    df2 = engine.get_dataset()
    assert chamadas["n"] == 1
    assert 888001 in df2["Numero_Nota"].values


# ── Tarefa 4: motor de enriquecimento, auditoria, cache e cópia Excel ────
def _excel_iw28(caminho):
    pd.DataFrame({
        "Nota": [2000], "Status usuário": ["LIBE"],
        "CenTrabalho princ.": ["CT-01"], "Ordem": [777],
        "Encerram.por data": [pd.Timestamp("2026-05-10")],
    }).to_excel(caminho, index=False)


def _excel_iw38(caminho):
    pd.DataFrame({
        "Ordem": [777], "Status usuário": ["JAND INVE"],
        "Status do sistema": ["ENTE"], "Total planejado": [1000.0],
        "Total real": [800.0],
    }).to_excel(caminho, index=False)


# engine.py lê IW28/IW38/IW66 do SQLite nativo (base_iw28/base_iw38/base_iw66),
# não mais do Excel de rede — os helpers acima continuam servindo test_status_bases
# (que checa existência do arquivo, não o carregamento dos dados).
def _sqlite_iw28():
    from input_module import db
    db.salvar_base_dataframe("base_iw28", pd.DataFrame({
        "Nota": [2000], "Status usuário": ["LIBE"],
        "CenTrabalho princ.": ["CT-01"], "Ordem": [777],
        "Encerram.por data": [pd.Timestamp("2026-05-10")],
    }))


def _sqlite_iw38():
    from input_module import db
    db.salvar_base_dataframe("base_iw38", pd.DataFrame({
        "Ordem": [777], "Status usuário": ["JAND INVE"],
        "Status do sistema": ["ENTE"], "Total planejado": [1000.0],
        "Total real": [800.0],
    }))


@pytest.fixture
def engine_isolado(banco_temporario, monkeypatch, tmp_path):
    """Banco temporário + caminhos de rede apontando para tmp (inexistentes por padrão)."""
    from input_module import config, engine
    for attr in ["CAMINHO_INDICADOR_CONTINUIDADE", "CAMINHO_BASE_IW28",
                 "CAMINHO_CUSTO_ORD_IW38", "CAMINHO_CLIENTES_CONJUNTO",
                 "CAMINHO_CUSTO_MODULAR", "CAMINHO_GANHOS",
                 "CAMINHO_PROJETO_CONSTRUCAO", "CAMINHO_BASE_IW66"]:
        monkeypatch.setattr(config, attr, str(tmp_path / f"{attr}.xlsx"))
    monkeypatch.setattr(config, "BASES_REDE", {
        "IW28": config.CAMINHO_BASE_IW28, "IW38": config.CAMINHO_CUSTO_ORD_IW38})
    engine.invalidar_cache()
    return tmp_path


def test_engine_fallbacks_sem_rede(engine_isolado):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    df = engine.enriquecer_dados()
    linha = df[df["Numero_Nota"] == 2000].iloc[0]
    assert linha["Export_status"] == "Pendente Extração SAP"
    assert linha["Conj.critico"] == "-"
    assert linha["Cidade"] == "Guarulhos"
    assert "Auditoria_Cronograma" in df.columns


def test_engine_cruza_iw28_iw38(engine_isolado):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(2000, Status_Nota="99 Encerrado")]))
    _sqlite_iw28()
    _sqlite_iw38()
    df = engine.enriquecer_dados()
    linha = df[df["Numero_Nota"] == 2000].iloc[0]
    assert linha["Export_status"] == "LIBE"
    assert linha["Ordem"] == "777"
    assert linha["Ordem_Executada"] == "SIM"
    assert float(linha["Total_real_ordem"]) == 800.0
    assert float(linha["Exec_percentagem_ordem"]) == pytest.approx(80.0)


def test_auditoria_cronograma(engine_isolado):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(2000, Status_Nota="99 Encerrado")]))
    _sqlite_iw28()
    _sqlite_iw38()
    df = engine.enriquecer_dados()
    assert df.iloc[0]["Auditoria_Cronograma"] == "🟢 Adiantado"


def test_engine_totais_numericos_e_modular(engine_isolado):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(2000, Status_Nota="99 Encerrado")]))
    _sqlite_iw28()
    _sqlite_iw38()
    df = engine.enriquecer_dados()
    linha = df[df["Numero_Nota"] == 2000].iloc[0]
    assert isinstance(linha["Total_planejado_ordem"], (int, float))
    assert isinstance(linha["Total_real_ordem"], (int, float))
    assert float(linha["Total_planejado_ordem"]) == 1000.0
    assert float(linha["Total_real_ordem"]) == 800.0
    assert "Total_planejado_modular" in df.columns
    assert float(linha["Total_planejado_modular"]) == 0.0


def test_status_map_grupo_c():
    assert config.STATUS_MAP[53].startswith("53 "), "53 deve ter prefixo numérico"
    assert 997 in config.STATUS_MAP, "997 (SUPR CANC) ausente do STATUS_MAP"
    assert config.STATUS_MAP[997] == "SUPR CANC"
    assert config.INV_STATUS_MAP[config.STATUS_MAP[53]] == 53
    assert config.INV_STATUS_MAP["SUPR CANC"] == 997


def test_status_para_int_grupo_c(banco_temporario):
    from input_module.db import status_para_int
    assert status_para_int("53 Programado Execução") == 53
    assert status_para_int("SUPR CANC") == 997
    assert status_para_int("SUPR") == 998
    assert status_para_int("ENCE EXEC") == 999


def test_converter_para_iso_data(banco_temporario):
    from input_module.db import converter_para_iso_data
    assert converter_para_iso_data("-") == "-"
    assert converter_para_iso_data("") == "-"
    assert converter_para_iso_data("jun-2026") == "2026-06-01"
    assert converter_para_iso_data("junho-2026") == "2026-06-01"
    assert converter_para_iso_data("2026-06-01") == "2026-06-01"
    assert converter_para_iso_data("2026-06-01 00:00:00") == "2026-06-01"
    assert converter_para_iso_data("dez-2025") == "2025-12-01"


def test_salvar_em_massa_preserva_mes_iso(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(9900, Mes_Execucao_Planejado="jun-2026")]))
    conn = db.get_db_connection()
    row = conn.execute("SELECT Mes_Execucao_Planejado FROM notas WHERE Numero_Nota=9900").fetchone()
    conn.close()
    assert row[0] == "2026-06-01", f"DB deve guardar ISO, encontrado: {row[0]}"


def test_config_iw66():
    assert hasattr(config, "CAMINHO_BASE_IW66")
    assert "IW66" in config.CAMINHO_BASE_IW66.upper() or "medidas" in config.CAMINHO_BASE_IW66.lower()
    assert len(config.BASES_REDE) == 7
    assert "Medida_SAP" in config.COLUNAS_PAINEL
    assert "Medida_vs_Planejado" in config.COLUNAS_PAINEL
    assert "Medida SAP" in config.MAP_FILTROS


def _excel_iw66(caminho):
    pd.DataFrame({
        "Nota": [2000, 2000, 2000],
        "Denominação do conjunto": ["REDE", "POSTE", "REDE"],
        "Texto medida": ["CABO", "POSTE", "CONDUTOR"],
        "Descrição": ["", "", ""],
        "Nº de ordenação": [500.0, 2.0, 300.0],
    }).to_excel(caminho, index=False)


def _sqlite_iw66():
    from input_module import db
    db.salvar_base_dataframe("base_iw66", pd.DataFrame({
        "Nota": [2000, 2000, 2000],
        "Denominação do conjunto": ["REDE", "POSTE", "REDE"],
        "Texto medida": ["CABO", "POSTE", "CONDUTOR"],
        "Descrição": ["", "", ""],
        "Nº de ordenação": [500.0, 2.0, 300.0],
    }))


def test_engine_medidas_iw66_sem_arquivo(engine_isolado):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    df = engine.enriquecer_dados()
    assert "Medida_SAP" in df.columns
    assert "Medida_vs_Planejado" in df.columns
    assert df.iloc[0]["Medida_SAP"] == "-"
    assert df.iloc[0]["Medida_vs_Planejado"] == "-"


def test_engine_medidas_iw66_com_dados(engine_isolado):
    from input_module import db, engine
    _sqlite_iw66()
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    engine.invalidar_cache()
    df = engine.enriquecer_dados()
    linha = df[df["Numero_Nota"] == 2000].iloc[0]
    assert "km" in str(linha["Medida_SAP"])
    assert "un" in str(linha["Medida_SAP"])
    assert linha["Medida_vs_Planejado"] in ("Sim", "Não")


def test_comparar_medida_planejado():
    from input_module.engine import _comparar_medida_planejado
    assert _comparar_medida_planejado("-", 2.0) == "-"
    assert _comparar_medida_planejado("0.8 km", float("nan")) == "-"
    assert _comparar_medida_planejado("0.8 km", 800.0) == "Sim"
    assert _comparar_medida_planejado("0.8 km", 900.0) == "Não"
    assert _comparar_medida_planejado("2 un", 2.0) == "Sim"
    assert _comparar_medida_planejado("0.8 km / 2 un", 800.0) == "Sim"


def test_cache_e_invalidacao(engine_isolado):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    df1 = engine.get_dataset()
    assert len(engine.get_dataset()) == len(df1)  # mesma versão: cache segura
    db.salvar_em_massa(pd.DataFrame([_nota(2001)]))
    assert len(engine.get_dataset()) == len(df1) + 1  # nova versão: revalida sozinho
    engine.invalidar_cache()
    assert len(engine.get_dataset()) == len(df1) + 1  # invalidação manual continua funcionando


def test_status_bases(engine_isolado):
    from input_module import config, engine
    engine.invalidar_status_bases()
    _excel_iw28(config.CAMINHO_BASE_IW28)
    bases = engine.status_bases()
    por_nome = {b["nome"]: b for b in bases}
    assert por_nome["IW28"]["encontrada"] is True
    assert por_nome["IW38"]["encontrada"] is False


def test_invalidar_status_bases_forca_releitura(engine_isolado):
    """Sem invalidar_status_bases(), um arquivo criado após o primeiro status_bases()
    fica invisível até o TTL de 60s expirar — a invalidação explícita evita isso."""
    from input_module import config, engine
    engine.invalidar_status_bases()
    bases = engine.status_bases()
    por_nome = {b["nome"]: b for b in bases}
    assert por_nome["IW28"]["encontrada"] is False
    _excel_iw28(config.CAMINHO_BASE_IW28)
    engine.invalidar_status_bases()
    bases = engine.status_bases()
    por_nome = {b["nome"]: b for b in bases}
    assert por_nome["IW28"]["encontrada"] is True


# ── Tarefa 5: endpoints de leitura /api/input/* ──────────────────────────
from fastapi.testclient import TestClient


@pytest.fixture
def cliente(engine_isolado):
    from main import app
    from input_module import service
    service.resetar_migracao()
    return TestClient(app)


def test_get_notas_traz_registros_e_meta(cliente):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    from input_module import engine
    engine.invalidar_cache()
    r = cliente.get("/api/input/notas")
    assert r.status_code == 200
    corpo = r.json()
    assert len(corpo["registros"]) == 1
    assert corpo["registros"][0]["Numero_Nota"] == 2000
    meta = corpo["meta"]
    assert "99 Encerrado" in meta["status_opcoes"]
    assert "Emergente" in meta["prioridade_opcoes"]
    assert isinstance(meta["bases"], list)
    assert "ultima_alteracao" in meta
    assert meta["migracao"] in ("ja-existe", "migrado", "rede-indisponivel")


def test_get_sync(cliente):
    r = cliente.get("/api/input/sync")
    assert r.status_code == 200
    assert "ultima_alteracao" in r.json()


def test_notas_etag_304(banco_temporario):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from input_module.routes import router
    app = FastAPI(); app.include_router(router)
    client = TestClient(app)
    r1 = client.get("/api/input/notas")
    assert r1.status_code == 200
    etag = r1.headers["etag"]
    assert r1.json()["meta"]["versao"]
    r2 = client.get("/api/input/notas", headers={"If-None-Match": etag})
    assert r2.status_code == 304
    r3 = client.get("/api/input/sync")
    assert "versao" in r3.json()


def test_get_logs_e_timeline(cliente):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    db.aplicar_edicoes([{"Numero_Nota": 2000, "Observacao": "oi"}], usuario="ana")
    assert len(cliente.get("/api/input/logs").json()["registros"]) == 1
    assert len(cliente.get("/api/input/logs/nota/2000").json()["registros"]) == 1
    assert cliente.get("/api/input/logs/nota/999").json()["registros"] == []
    assert cliente.get("/api/input/logs/arquivos").json()["registros"] == []


# ── Tarefa 6: endpoints de escrita /api/input/* ──────────────────────────
CABECALHO_USER = {"X-User": "ana"}


def test_escrita_exige_x_user(cliente):
    r = cliente.patch("/api/input/notas", json={"linhas": []})
    assert r.status_code == 400
    assert "X-User" in r.json()["detail"]


def test_patch_edita_e_loga(cliente):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(2000)]))
    engine.invalidar_cache()
    r = cliente.patch("/api/input/notas", headers=CABECALHO_USER,
                      json={"linhas": [{"Numero_Nota": 2000, "Observacao": "via api"}]})
    assert r.status_code == 200
    assert r.json()["alteradas"] == 1
    registros = cliente.get("/api/input/notas").json()["registros"]
    assert registros[0]["Observacao"] == "via api"


def test_patch_nota_inexistente_404(cliente):
    r = cliente.patch("/api/input/notas", headers=CABECALHO_USER,
                      json={"linhas": [{"Numero_Nota": 31337, "Observacao": "x"}]})
    assert r.status_code == 404


def test_post_cria_e_rejeita_duplicata(cliente):
    nova = {"Numero_Nota": 6000, "Status_Nota": "00 Pendente",
            "Prioridade_Nota": "Programável", "Local_Instalacao": "045 RL X"}
    r = cliente.post("/api/input/notas", headers=CABECALHO_USER, json=nova)
    assert r.status_code == 200
    from input_module import db
    df = db.carregar_dados()
    linha = df[df["Numero_Nota"] == 6000].iloc[0]
    assert linha["Regional"] == "Guarulhos"
    r = cliente.post("/api/input/notas", headers=CABECALHO_USER, json=nova)
    assert r.status_code == 409


def test_bulk_valida_duplicatas(cliente):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(7000)]))
    lote = {"notas": [
        {"Numero_Nota": 7000, "Status_Nota": "00 Pendente", "Prioridade_Nota": "Programável"},
        {"Numero_Nota": 7001, "Status_Nota": "00 Pendente", "Prioridade_Nota": "Programável"},
    ]}
    r = cliente.post("/api/input/notas/bulk", headers=CABECALHO_USER, json=lote)
    assert r.status_code == 409
    assert "7000" in r.json()["detail"]
    lote = {"notas": [
        {"Numero_Nota": 7002, "Status_Nota": "00 Pendente", "Prioridade_Nota": "Programável"},
        {"Numero_Nota": 7002, "Status_Nota": "00 Pendente", "Prioridade_Nota": "Programável"},
    ]}
    assert cliente.post("/api/input/notas/bulk", headers=CABECALHO_USER, json=lote).status_code == 409
    lote = {"notas": [
        {"Numero_Nota": 7003, "Status_Nota": "00 Pendente", "Prioridade_Nota": "Programável"},
        {"Numero_Nota": 7004, "Status_Nota": "00 Pendente", "Prioridade_Nota": "Programável"},
    ]}
    r = cliente.post("/api/input/notas/bulk", headers=CABECALHO_USER, json=lote)
    assert r.status_code == 200
    assert r.json()["inseridas"] == 2


def test_delete_e_desfazer(cliente):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(8000)]))
    cliente.patch("/api/input/notas", headers=CABECALHO_USER,
                  json={"linhas": [{"Numero_Nota": 8000, "Observacao": "antes do undo"}]})
    r = cliente.post("/api/input/desfazer", headers=CABECALHO_USER, json={})
    assert r.status_code == 200 and r.json()["ok"] is True
    r = cliente.request("DELETE", "/api/input/notas", headers=CABECALHO_USER,
                        json={"numeros": [8000]})
    assert r.status_code == 200 and r.json()["excluidas"] == 1


def test_export_gera_xlsx(cliente):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(9000)]))
    engine.invalidar_cache()
    r = cliente.post("/api/input/export",
                     json={"numeros": [9000], "colunas": ["Numero_Nota", "Status_Nota"]})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    df = pd.read_excel(io.BytesIO(r.content))
    assert list(df.columns) == ["Nº Nota (ID)", "Status Nota"]


# ── Tarefa 7: endpoints de configuração (responsáveis, bases, backups, migração) ──
def test_responsaveis_api(cliente):
    r = cliente.get("/api/input/responsaveis")
    assert r.json()["Poa"] == "Danilo"
    r = cliente.put("/api/input/responsaveis", headers=CABECALHO_USER,
                    json={"Poa": "Maria"})
    assert r.status_code == 200
    assert cliente.get("/api/input/responsaveis").json() == {"Poa": "Maria"}


def test_bases_lista_download_upload(cliente, monkeypatch, tmp_path):
    from input_module import config
    caminho = tmp_path / "Clientes_Conjunto.xlsx"
    pd.DataFrame({"CONJUNTO_DESC": ["POA"], "QTDE_CONJUNTO": [10]}).to_excel(caminho, index=False)
    monkeypatch.setattr(config, "BASES_APOIO", {"Clientes por Conjunto": str(caminho)})
    r = cliente.get("/api/input/bases")
    assert r.json()["bases"][0]["encontrada"] is True
    r = cliente.get("/api/input/bases/Clientes_Conjunto.xlsx/download")
    assert r.status_code == 200
    # Upload substitui o arquivo e registra no log
    conteudo = caminho.read_bytes()
    r = cliente.post("/api/input/bases/Clientes_Conjunto.xlsx",
                     headers=CABECALHO_USER,
                     files={"arquivo": ("novo.xlsx", conteudo)})
    assert r.status_code == 200
    logs = cliente.get("/api/input/logs/arquivos").json()["registros"]
    assert logs[0]["Nome_Arquivo"] == "Clientes_Conjunto.xlsx"
    assert logs[0]["Acao"] == "Substituição"
    # Base desconhecida -> 404
    assert cliente.get("/api/input/bases/nao_existe.xlsx/download").status_code == 404


def test_backups_lista_e_download(cliente):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(9500)]))
    db.realizar_backup(limite=20, intervalo_horas=0)
    r = cliente.get("/api/input/backups")
    backups = r.json()["backups"]
    assert len(backups) >= 1
    nome = backups[0]["arquivo"]
    assert cliente.get(f"/api/input/backups/{nome}/download").status_code == 200
    assert cliente.get("/api/input/backups/..%2Fhack.db/download").status_code in (400, 404)


def test_migrar_endpoint(cliente):
    r = cliente.post("/api/input/migrar", headers=CABECALHO_USER)
    assert r.status_code == 200
    assert r.json()["resultado"] in ("ja-existe", "migrado", "rede-indisponivel")


# ── Fase 4 (Grupo D): Ramal + Nota_Mae + Hierarquia ─────────────────────────
def test_inicializar_banco_cria_notas_ramal(banco_temporario):
    from input_module import db
    conn = db.get_db_connection()
    tabelas = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    colunas_notas = [r[1] for r in conn.execute("PRAGMA table_info(notas)").fetchall()]
    conn.close()
    assert "notas_ramal" in tabelas
    assert "Nota_Mae" in colunas_notas


def _nota_ramal(numero=5000, **extras):
    base = {
        "ID_Cronologia": 1, "Numero_Nota": numero,
        "Status_Obra": "-", "Conjunto": "POA", "Circuito": "POA 123",
        "Local_Instalacao": "045 RL TESTE", "Planejado_DDPM": 1.0,
        "Mes_Execucao_Planejado": "jun-2026", "CenTrab_Respon": "-",
        "Prioridade_Nota": "Programável", "Observacao": "",
        "Extracao_Antiga": "-", "Status_Nota": "00 Pendente",
        "Status_Anterior": "-", "Check_Btzero": "-", "Plano": "-",
    }
    base.update(extras)
    return base


def test_carregar_dados_ramal_vazio(banco_temporario):
    from input_module import db
    df = db.carregar_dados_ramal()
    assert df.empty
    assert "Numero_Nota" in df.columns


def test_salvar_e_carregar_ramal(banco_temporario):
    from input_module import db
    db.salvar_ramal_em_massa(pd.DataFrame([_nota_ramal(5001), _nota_ramal(5002)]))
    df = db.carregar_dados_ramal()
    assert len(df) == 2
    assert set(df["Numero_Nota"].tolist()) == {5001, 5002}
    db.salvar_ramal_em_massa(pd.DataFrame([_nota_ramal(5001, Observacao="atualizada")]))
    assert len(db.carregar_dados_ramal()) == 2  # upsert, sem duplicata


def test_deletar_notas_ramal(banco_temporario):
    from input_module import db
    db.salvar_ramal_em_massa(pd.DataFrame([_nota_ramal(5010), _nota_ramal(5011)]))
    assert db.deletar_notas_ramal([5010], usuario="tester") == 1
    assert len(db.carregar_dados_ramal()) == 1


def test_vincular_nota_mae(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(6001), _nota(6002)]))
    n = db.vincular_nota_mae_lote({"6001": [6002]}, usuario="tester")
    assert n >= 1
    df = db.carregar_dados()
    assert df[df["Numero_Nota"] == 6002].iloc[0]["Nota_Mae"] == "6001"


def test_nota_mae_nao_sobrescrita_por_salvar(banco_temporario):
    from input_module import db
    db.salvar_em_massa(pd.DataFrame([_nota(6010), _nota(6011)]))
    db.vincular_nota_mae_lote({"6010": [6011]}, usuario="tester")
    db.salvar_em_massa(pd.DataFrame([_nota(6011, Observacao="editada")]))
    df = db.carregar_dados()
    assert df[df["Numero_Nota"] == 6011].iloc[0]["Nota_Mae"] == "6010"


def test_api_ramal_crud(cliente):
    from input_module import db, engine
    ramal_payload = {"notas": [{"Numero_Nota": 5100, "Conjunto": "POA"}]}
    r = cliente.post("/api/input/ramal/bulk", headers=CABECALHO_USER, json=ramal_payload)
    assert r.status_code == 200
    assert r.json()["inseridas"] == 1
    r = cliente.get("/api/input/ramal")
    assert r.status_code == 200
    assert len(r.json()["registros"]) == 1
    r = cliente.request("DELETE", "/api/input/ramal", headers=CABECALHO_USER,
                        json={"numeros": [5100]})
    assert r.status_code == 200
    assert r.json()["excluidas"] == 1
    assert cliente.get("/api/input/ramal").json()["registros"] == []


def test_api_hierarquia(cliente):
    from input_module import db, engine
    db.salvar_em_massa(pd.DataFrame([_nota(7010), _nota(7011)]))
    engine.invalidar_cache()
    r = cliente.post("/api/input/hierarquia", headers=CABECALHO_USER,
                     json={"dados": {"7010": [7011]}})
    assert r.status_code == 200
    assert r.json()["atualizadas"] >= 1
    r = cliente.get("/api/input/hierarquia/7011")
    assert r.status_code == 200
    assert r.json()["nota_mae"] == "7010"


# ── Tarefa 3: contrato de leitura IW28 + consulta de nota do plano ──
def test_iw28_obter_por_nota(banco_temporario):
    from input_module import db, iw28
    assert iw28.obter_por_nota(12345678) is None  # tabela ainda não existe
    db.salvar_base_dataframe("base_iw28", pd.DataFrame([{
        "Nota": 12345678.0, "Status usuário": "PLAN",
        "CenTrabalho princ.": "POA", "Ordem": 900001, "Encerram.por data": None,
    }]))
    registro = iw28.obter_por_nota(12345678)
    assert registro is not None
    assert registro["Status usuário"] == "PLAN"
    assert registro["Encerram.por data"] is None      # NaN vira None (JSON-safe)
    assert iw28.obter_por_nota(99999999) is None


def test_obter_nota_plano(banco_temporario):
    from input_module import db
    assert db.obter_nota_plano(1000) is None
    db.salvar_em_massa(pd.DataFrame([_nota(1000)]))
    registro = db.obter_nota_plano(1000)
    assert registro is not None
    assert registro["Status_Nota"] == "10 Em planejamento"   # formatado, não int


# ── Relatórios Home: schema e helpers de metas do Plano de Recomposição ──
def test_metas_schema_e_helpers(banco_temporario):
    from input_module import db
    conn = db.get_db_connection()
    tabelas = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    conn.close()
    assert {"metas_plano", "planos_depara", "metas_sync_estado"} <= tabelas

    metas = pd.DataFrame([
        {"Ano": 2026, "Mes": 1, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Meta": 17.0},
        {"Ano": 2026, "Mes": 2, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Meta": 19.0},
    ])
    depara = pd.DataFrame([
        {"Plano": "POSTES - CAPEX", "Nome_Curto": "POSTE", "Unidade": "Und.",
         "Area": "Construção", "Modular_RS": 6921.0, "Ordem_Exibicao": 1},
    ])
    db.substituir_metas(metas, depara)
    assert len(db.carregar_metas(2026)) == 2
    assert db.carregar_metas(2025).empty
    dp = db.carregar_planos_depara()
    assert dp.iloc[0]["Nome_Curto"] == "POSTE"

    # replace: segunda chamada substitui, não acumula
    db.substituir_metas(metas.head(1), depara)
    assert len(db.carregar_metas(2026)) == 1

    # estado de sync sobrevive e guarda erro
    assert db.obter_estado_metas() is None
    db.gravar_estado_metas(arquivo_mtime=1234.5, erro=None)
    estado = db.obter_estado_metas()
    assert estado["arquivo_mtime"] == 1234.5 and estado["erro"] is None
    db.gravar_estado_metas(arquivo_mtime=1234.5, erro="lock")
    assert db.obter_estado_metas()["erro"] == "lock"


def test_postergadas_schema_e_helpers(banco_temporario):
    from input_module import db
    conn = db.get_db_connection()
    tabelas = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    conn.close()
    assert "metas_postergadas" in tabelas

    metas = pd.DataFrame([
        {"Ano": 2026, "Mes": 1, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Meta": 17.0},
    ])
    depara = pd.DataFrame([
        {"Plano": "POSTES - CAPEX", "Nome_Curto": "POSTE", "Unidade": "Und.",
         "Area": "Construção", "Modular_RS": 6921.0, "Ordem_Exibicao": 1},
    ])
    post = pd.DataFrame([
        {"Ano": 2026, "Mes": 7, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Qtd": 3.0},
        {"Ano": 2026, "Mes": 8, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Qtd": 2.0},
    ])
    db.substituir_metas(metas, depara, post)
    p = db.carregar_postergacoes(2026)
    assert len(p) == 2
    assert db.carregar_postergacoes(2025).empty
    assert p["Qtd"].sum() == 5.0

    # replace: segunda chamada substitui, não acumula
    db.substituir_metas(metas, depara, post.head(1))
    assert len(db.carregar_postergacoes(2026)) == 1

    # df_postergacoes omitido (None) não mexe na tabela de postergadas
    db.substituir_metas(metas, depara)
    assert len(db.carregar_postergacoes(2026)) == 1


# ── Task 2: Sincronização de Metas do Controle Plano de Recomposição ───────
def _xlsx_controle(caminho, meta_jan=17.0, com_postergadas=True):
    """Planilha sintética mínima com abas base, dexpara e (opcional) Postergadas."""
    import gc
    base = pd.DataFrame([
        {"Regionais": "Guarulhos", "Mês": pd.Timestamp(2026, 1, 1),
         "Plano": "POSTES - CAPEX", "Meta": meta_jan, "Conjunto": "POSTE"},
        {"Regionais": "Guarulhos", "Mês": pd.Timestamp(2026, 2, 1),
         "Plano": "POSTE DEMANDA - CAPEX", "Meta": 5.0, "Conjunto": "POSTE"},
        {"Regionais": "Poa/Suzano", "Mês": pd.Timestamp(2026, 1, 1),
         "Plano": "RAMAL", "Meta": 100.0, "Conjunto": "RAMAL"},
    ])
    dexpara = pd.DataFrame([
        {"Projeto": "POSTES - CAPEX", "Unidade": "Und.", "Área": "Projeto", "Modular R$": 6921.0},
        {"Projeto": "POSTE DEMANDA - CAPEX", "Unidade": "Und.", "Área": "Projeto", "Modular R$": 6921.0},
        {"Projeto": "RAMAL", "Unidade": "Ponto", "Área": "CSD", "Modular R$": 694.5},
    ])
    postergadas = pd.DataFrame([
        {"Regional": "Guarulhos", "Mês de Execução Planejado - DDPM": pd.Timestamp(2026, 7, 1),
         "Projeto\nConstrução": "POSTES - CAPEX", "Planejado-DDPM": 3.0},
        {"Regional": "Guarulhos", "Mês de Execução Planejado - DDPM": pd.Timestamp(2026, 8, 1),
         "Projeto\nConstrução": "POSTES - CAPEX", "Planejado-DDPM": 2.0},
    ])
    w = pd.ExcelWriter(caminho, engine="openpyxl")
    try:
        base.to_excel(w, sheet_name="base", index=False)
        dexpara.to_excel(w, sheet_name="dexpara", index=False)
        if com_postergadas:
            postergadas.to_excel(w, sheet_name="Postergadas", index=False)
    finally:
        w.close()
        del w
        gc.collect()


def test_metas_sincronizar(banco_temporario, monkeypatch, tmp_path):
    from input_module import config, db, metas
    arquivo = tmp_path / "Controle.xlsx"
    _xlsx_controle(arquivo)
    monkeypatch.setenv("CONTROLE_RECOMPOSICAO_PATH", str(arquivo))

    estado = metas.sincronizar_se_preciso()
    assert estado["sincronizou"] is True and estado["erro"] is None
    m = db.carregar_metas(2026)
    assert len(m) == 3
    assert m[(m["Regional"] == "Poa/Suzano") & (m["Plano"] == "RAMAL")].iloc[0]["Meta"] == 100.0
    dp = db.carregar_planos_depara().set_index("Plano")
    assert dp.loc["POSTES - CAPEX", "Nome_Curto"] == "POSTE"
    # colisão de nome curto: POSTE DEMANDA - CAPEX não pode virar "POSTE" também
    assert dp.loc["POSTE DEMANDA - CAPEX", "Nome_Curto"] == "POSTE DEMANDA"
    assert dp.loc["POSTES - CAPEX", "Area"] == "Construção"   # "Projeto" -> exibição
    assert dp.loc["RAMAL", "Area"] == "CSD"

    # mtime igual: no-op
    assert metas.sincronizar_se_preciso()["sincronizou"] is False
    # arquivo mudou: reimporta
    import time as _t; _t.sleep(0.05)
    _xlsx_controle(arquivo, meta_jan=99.0)
    estado = metas.sincronizar_se_preciso()
    assert estado["sincronizou"] is True
    m = db.carregar_metas(2026)
    assert m[(m["Plano"] == "POSTES - CAPEX") & (m["Mes"] == 1)].iloc[0]["Meta"] == 99.0
    # sync registra em log_arquivos (bumpa a versão do dataset)
    logs = db.carregar_log_arquivos()
    assert (logs["Usuario"] == "metas-sync").any()


def test_metas_sincronizar_falha_preserva(banco_temporario, monkeypatch, tmp_path):
    from input_module import db, metas
    arquivo = tmp_path / "Controle.xlsx"
    _xlsx_controle(arquivo)
    monkeypatch.setenv("CONTROLE_RECOMPOSICAO_PATH", str(arquivo))
    metas.sincronizar_se_preciso()
    assert len(db.carregar_metas(2026)) == 3

    arquivo.unlink()  # arquivo some (rede/OneDrive fora)
    estado = metas.sincronizar_se_preciso(forcar=True)
    assert estado["erro"] is not None
    assert len(db.carregar_metas(2026)) == 3  # última sync preservada


def test_metas_sincronizar_postergadas(banco_temporario, monkeypatch, tmp_path):
    from input_module import db, metas
    arquivo = tmp_path / "Controle.xlsx"
    _xlsx_controle(arquivo)
    monkeypatch.setenv("CONTROLE_RECOMPOSICAO_PATH", str(arquivo))
    metas.sincronizar_se_preciso()
    p = db.carregar_postergacoes(2026)
    assert p["Qtd"].sum() == 5.0
    jul = p[(p["Mes"] == 7) & (p["Plano"] == "POSTES - CAPEX")]
    assert jul.iloc[0]["Qtd"] == 3.0


def test_metas_sincronizar_sem_aba_postergadas_preserva(banco_temporario, monkeypatch, tmp_path):
    from input_module import db, metas
    arquivo = tmp_path / "Controle.xlsx"
    _xlsx_controle(arquivo)
    monkeypatch.setenv("CONTROLE_RECOMPOSICAO_PATH", str(arquivo))
    metas.sincronizar_se_preciso()
    assert len(db.carregar_postergacoes(2026)) == 2

    import time as _t; _t.sleep(0.05)
    _xlsx_controle(arquivo, com_postergadas=False)  # aba Postergadas some
    estado = metas.sincronizar_se_preciso(forcar=True)
    assert estado["erro"] is not None
    assert len(db.carregar_postergacoes(2026)) == 2   # última sync preservada
    assert len(db.carregar_metas(2026)) == 3          # metas também intactas


@pytest.mark.parametrize("valor", [99, 99.0, "99", "99.0", "99 Encerrado"])
def test_relatorios_reconhece_codigo_99_exato(valor):
    from input_module import relatorios

    assert relatorios._status_99(valor) is True


@pytest.mark.parametrize("valor", [None, "-", 9, 98, 999, "999", "99A"])
def test_relatorios_nao_confunde_outros_status_com_99(valor):
    from input_module import relatorios

    assert relatorios._status_99(valor) is False


def test_relatorios_status_final_preenchido_prevalece_sobre_status_nota():
    from input_module import relatorios

    row = pd.Series({
        "Status_Final": "10 Em planejamento",
        "Status_Nota": "99 Encerrado",
        "Export_status": "-",
    })

    assert relatorios._executada(row) is False


def test_relatorios_preserva_fallbacks_existentes():
    from input_module import relatorios

    status_local = pd.Series({
        "Status_Final": "-",
        "Status_Nota": "99 Encerrado",
        "Export_status": "-",
    })
    status_textual_sap = pd.Series({
        "Status_Final": "ENCE EXEC",
        "Status_Nota": "10 Em planejamento",
        "Export_status": "ENCE EXEC",
    })

    assert relatorios._executada(status_local) is True
    assert relatorios._executada(status_textual_sap) is True


def _dashboard_nota_status_final(
    status_final,
    encerramento,
    regional="Guarulhos",
):
    from input_module import relatorios

    df_notas = pd.DataFrame([{
        "Numero_Nota": 9001,
        "Conjunto": "POSTES - CAPEX",
        "Planejado_DDPM": 2.0,
        "Mes_Execucao_Planejado": "jul-2026",
        "Regional": regional,
        "Regional_CSD": regional,
        "Status_Final": status_final,
        "Status_Nota": "10 Em planejamento",
        "Export_status": "-",
        "Encerram.por data": encerramento,
    }])
    _, df_ramal, df_metas, df_depara, df_postergacoes = _fx_relatorios()

    return relatorios.montar_dashboard(
        df_notas,
        df_ramal.iloc[0:0],
        df_metas,
        df_depara,
        df_postergacoes.iloc[0:0],
        ano=2026,
        mes_referencia=7,
        regional=None,
    )


def test_dashboard_status_final_99_usa_mes_real():
    dashboard = _dashboard_nota_status_final(99, "2026-08-03")

    julho = dashboard["mensalizacao"][6]
    agosto = dashboard["mensalizacao"][7]
    assert julho["executado"] == 0.0
    assert agosto["executado"] == 2.0
    assert dashboard["avisos"]["executadas_sem_data"] == 0


def test_dashboard_status_final_99_sem_data_usa_mes_planejado_e_avisa():
    dashboard = _dashboard_nota_status_final("99 Encerrado", None)

    julho = dashboard["mensalizacao"][6]
    assert julho["executado"] == 2.0
    assert dashboard["avisos"]["executadas_sem_data"] == 1


def test_dashboard_aviso_sem_data_respeita_filtro_regional():
    dashboard = _dashboard_nota_status_final(
        "99 Encerrado",
        None,
        regional="Mogi das Cruzes",
    )
    from input_module import relatorios
    _, df_ramal, df_metas, df_depara, df_postergacoes = _fx_relatorios()
    nota_sem_data = pd.DataFrame([{
        "Numero_Nota": 9002,
        "Conjunto": "POSTES - CAPEX",
        "Planejado_DDPM": 1.0,
        "Mes_Execucao_Planejado": "jul-2026",
        "Regional": "Mogi das Cruzes",
        "Regional_CSD": "Mogi das Cruzes",
        "Status_Final": "99",
        "Status_Nota": "10 Em planejamento",
        "Export_status": "-",
        "Encerram.por data": None,
    }])
    filtrado = relatorios.montar_dashboard(
        nota_sem_data,
        df_ramal.iloc[0:0],
        df_metas,
        df_depara,
        df_postergacoes.iloc[0:0],
        ano=2026,
        mes_referencia=7,
        regional="Guarulhos",
    )

    assert dashboard["avisos"]["executadas_sem_data"] == 1
    assert filtrado["avisos"]["executadas_sem_data"] == 0


def _fx_relatorios():
    """Fixtures mínimas para o dashboard: 2 notas + 1 ramal + metas/depara."""
    df_notas = pd.DataFrame([
        # carteira jul/2026, Guarulhos (via Regional_CSD), POSTES: 2 und, uma executada (99)
        {"Numero_Nota": 1, "Conjunto": "POSTES - CAPEX", "Planejado_DDPM": 1.0,
         "Mes_Execucao_Planejado": "jul-2026", "Regional": "Mogi das Cruzes",
         "Regional_CSD": "Guarulhos", "Status_Nota": "99 Encerrado",
         "Export_status": "-", "Encerram.por data": "2026-07-10"},
        {"Numero_Nota": 2, "Conjunto": "POSTES - CAPEX", "Planejado_DDPM": 1.0,
         "Mes_Execucao_Planejado": "jul-2026", "Regional": "Guarulhos",
         "Regional_CSD": "-", "Status_Nota": "10 Em planejamento",
         "Export_status": "ENCE EXEC", "Encerram.por data": "2026-08-02"},
        # conjunto fora do de-para -> balde Outros
        {"Numero_Nota": 3, "Conjunto": "MISTERIOSO", "Planejado_DDPM": 2.0,
         "Mes_Execucao_Planejado": "jan-2026", "Regional": "Guarulhos",
         "Regional_CSD": "Guarulhos", "Status_Nota": "01 Sem providência",
         "Export_status": "-", "Encerram.por data": None},
    ])
    df_ramal = pd.DataFrame([
        # prefixo 160 (Poá) -> Poa/Suzano
        {"Numero_Nota": 9, "Local_Instalacao": "160RL00000001", "Planejado_DDPM": 1.0,
         "Mes_Execucao_Planejado": "jul-2026", "Status_Nota": "ENCE EXEC"},
    ])
    df_metas = pd.DataFrame([
        {"Ano": 2026, "Mes": 7, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Meta": 4.0},
        {"Ano": 2026, "Mes": 7, "Regional": "Poa/Suzano", "Plano": "RAMAL", "Meta": 2.0},
    ])
    df_depara = pd.DataFrame([
        {"Plano": "POSTES - CAPEX", "Nome_Curto": "POSTE", "Unidade": "Und.",
         "Area": "Construção", "Modular_RS": 10.0, "Ordem_Exibicao": 1},
        {"Plano": "RAMAL", "Nome_Curto": "RAMAL", "Unidade": "Ponto",
         "Area": "CSD", "Modular_RS": 2.0, "Ordem_Exibicao": 2},
    ])
    df_postergacoes = pd.DataFrame([
        {"Ano": 2026, "Mes": 7, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Qtd": 2.0},
        {"Ano": 2026, "Mes": 3, "Regional": "Guarulhos", "Plano": "POSTES - CAPEX", "Qtd": 5.0},
        {"Ano": 2026, "Mes": 7, "Regional": "Poa/Suzano", "Plano": "RAMAL", "Qtd": 9.0},
    ])
    return df_notas, df_ramal, df_metas, df_depara, df_postergacoes


def test_dashboard_agregacao_basica(banco_temporario):
    from input_module import relatorios
    d = relatorios.montar_dashboard(*_fx_relatorios(), ano=2026, mes_referencia=7, regional=None)

    # hero de julho: carteira POSTES 2 + RAMAL 1 = 3; meta 4+2=6; executado jul = 1 (nota 1; a nota 2 encerra em ago)
    assert d["hero"]["carteira"] == 3.0
    assert d["hero"]["meta"] == 6.0
    assert d["hero"]["executado"] == 1.0
    assert round(d["hero"]["pct_disp"], 3) == 0.5
    assert d["hero"]["carteira_rs"] == 2 * 10.0 + 1 * 2.0
    assert d["hero"]["postergadas"] == 11.0            # jul: POSTES 2 + RAMAL 9

    anual = {l["plano"]: l for l in d["visao_anual"]}
    assert anual["POSTES - CAPEX"]["area"] == "Construção"
    assert anual["POSTES - CAPEX"]["carteira"] == 2.0
    assert anual["POSTES - CAPEX"]["saldo"] == -2.0
    assert anual["POSTES - CAPEX"]["postergado"] == 7.0  # ano: 2 + 5
    assert anual["RAMAL"]["carteira"] == 1.0
    assert anual["RAMAL"]["postergado"] == 9.0
    assert anual["MISTERIOSO"]["area"] == "Outros"        # nunca some silenciosamente
    assert anual["MISTERIOSO"]["pct_disp"] is None        # meta 0 -> null

    assert len(d["mensalizacao"]) == 12
    jul = next(m for m in d["mensalizacao"] if m["mes"] == 7)
    assert jul["carteira"] == 3.0 and jul["executado"] == 1.0

    regs = {r["regional"]: r for r in d["regionais"]}
    assert len(regs) == 6
    assert regs["Guarulhos"]["carteira"] == 2.0           # Regional_CSD + fallback Regional
    assert regs["Poa/Suzano"]["carteira"] == 1.0          # ramal 160 -> Poa/Suzano


def test_dashboard_filtro_regional(banco_temporario):
    from input_module import relatorios
    d = relatorios.montar_dashboard(*_fx_relatorios(), ano=2026, mes_referencia=7,
                                    regional="Guarulhos")
    assert d["hero"]["carteira"] == 2.0                   # só POSTES; ramal era Poa/Suzano
    assert d["hero"]["meta"] == 4.0
    assert d["hero"]["postergadas"] == 2.0                # só Guarulhos, jul
    regs = {r["regional"]: r for r in d["regionais"]}
    assert len(regs) == 6                                 # bloco regionais não filtra


def test_dashboard_mes_referencia_muda_hero(banco_temporario):
    from input_module import relatorios
    d = relatorios.montar_dashboard(*_fx_relatorios(), ano=2026, mes_referencia=3, regional=None)
    assert d["hero"]["mes_nome"] == "março"
    assert d["hero"]["carteira"] == 0.0                    # nenhuma carteira em março
    assert d["mes_referencia"] == 3


def test_api_relatorios_dashboard(banco_temporario, monkeypatch, tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from input_module.routes import router
    arquivo = tmp_path / "Controle.xlsx"
    _xlsx_controle(arquivo)
    monkeypatch.setenv("CONTROLE_RECOMPOSICAO_PATH", str(arquivo))
    app = FastAPI(); app.include_router(router)
    client = TestClient(app)

    r = client.get("/api/input/relatorios/dashboard")
    assert r.status_code == 200
    corpo = r.json()
    assert {"hero", "visao_anual", "mensalizacao", "regionais",
            "financeiro_ano", "metas_info", "regionais_disponiveis"} <= set(corpo)
    assert corpo["metas_info"]["erro"] is None
    assert len(corpo["regionais_disponiveis"]) == 6
    assert "postergadas" in corpo["hero"]
    assert all("postergado" in l for l in corpo["visao_anual"])
    etag = r.headers["etag"]
    assert client.get("/api/input/relatorios/dashboard",
                      headers={"If-None-Match": etag}).status_code == 304
    # filtro por regional aceito
    assert client.get("/api/input/relatorios/dashboard?regional=Guarulhos").status_code == 200

    # mes fora do intervalo 1..12 -> 422
    r_invalido = client.get("/api/input/relatorios/dashboard?mes=13")
    assert r_invalido.status_code == 422

    # mes=3 muda o hero para março e o ETag reflete o mes
    r_marco = client.get("/api/input/relatorios/dashboard?mes=3")
    assert r_marco.status_code == 200
    assert r_marco.json()["hero"]["mes_nome"] == "março"
    assert r_marco.headers["etag"] != etag

    r = client.post("/api/input/metas/sincronizar")
    assert r.status_code == 200 and "sincronizou" in r.json()


def test_criar_notas_grava_origem(banco_temporario):
    from input_module import db, service
    nota = service.NovaNota(Numero_Nota=778001, Status_Nota="01 Sem providência",
                            Prioridade_Nota="Programável", Local_Instalacao="045BF00000123")
    service.criar_notas([nota], usuario="teste", origem="carteira")
    conn = db.get_db_connection()
    row = conn.execute("SELECT origem FROM notas WHERE Numero_Nota=778001").fetchone()
    conn.close()
    assert row[0] == "carteira"


def test_criar_notas_origem_default_manual(banco_temporario):
    from input_module import db, service
    nota = service.NovaNota(Numero_Nota=778002, Status_Nota="01 Sem providência",
                            Prioridade_Nota="Programável")
    service.criar_notas([nota], usuario="teste")
    conn = db.get_db_connection()
    row = conn.execute("SELECT origem FROM notas WHERE Numero_Nota=778002").fetchone()
    conn.close()
    assert row[0] == "manual"


# ── Perfil de execução: local x produção ─────────────────────────────────────
def test_perfil_padrao_e_local(monkeypatch):
    monkeypatch.delenv("EDP_PERFIL", raising=False)
    assert config.perfil() == config.PERFIL_LOCAL
    assert config.em_producao() is False


def test_perfil_producao_reconhecido(monkeypatch):
    monkeypatch.setenv("EDP_PERFIL", "PRODUCAO")
    assert config.perfil() == config.PERFIL_PRODUCAO
    assert config.em_producao() is True


def test_perfil_local_usa_banco_do_data_dir(monkeypatch, tmp_path):
    monkeypatch.delenv("EDP_PERFIL", raising=False)
    monkeypatch.delenv("INPUT_DB_PATH", raising=False)
    monkeypatch.setenv("INPUT_DATA_DIR", str(tmp_path))
    assert config.caminho_banco_notas() == str(tmp_path / "notas_departamento.db")


def test_perfil_producao_usa_banco_da_rede(monkeypatch, tmp_path):
    monkeypatch.setenv("EDP_PERFIL", "producao")
    monkeypatch.delenv("INPUT_DB_PATH", raising=False)
    monkeypatch.setenv("INPUT_DATA_DIR", str(tmp_path))
    assert config.caminho_banco_notas() == config.REDE_DB_ORIGEM


def test_input_db_path_vence_o_perfil(monkeypatch, tmp_path):
    alvo = tmp_path / "compartilhado.db"
    monkeypatch.setenv("EDP_PERFIL", "producao")
    monkeypatch.setenv("INPUT_DB_PATH", str(alvo))
    assert config.caminho_banco_notas() == str(alvo)


def test_producao_sem_banco_acessivel_falha_alto(monkeypatch, tmp_path):
    """Produção sem rede levanta erro — jamais cai no banco local silenciosamente."""
    from input_module import db
    monkeypatch.setenv("EDP_PERFIL", "producao")
    monkeypatch.setenv("INPUT_DB_PATH", str(tmp_path / "inexistente.db"))
    with pytest.raises(db.BancoRedeIndisponivelErro) as erro:
        db.migrar_da_rede_se_preciso()
    mensagem = str(erro.value)
    assert "EDP_PERFIL=producao" in mensagem
    assert "inexistente.db" in mensagem          # nome lógico do banco: útil
    assert str(tmp_path) not in mensagem         # diretório completo: não vaza


def test_producao_com_banco_acessivel_nao_copia_nada(monkeypatch, tmp_path):
    from input_module import db
    compartilhado = tmp_path / "compartilhado.db"
    monkeypatch.setenv("INPUT_DB_PATH", str(compartilhado))
    monkeypatch.delenv("EDP_PERFIL", raising=False)
    db.inicializar_banco()
    monkeypatch.setenv("EDP_PERFIL", "producao")
    assert db.migrar_da_rede_se_preciso() == "rede"
    assert not (tmp_path / "notas_departamento.db").exists()


def test_mascarar_caminho_nao_expoe_host_nem_diretorio():
    mascarado = config.mascarar_caminho(config.REDE_DB_ORIGEM)
    assert "notas_departamento.db" in mascarado
    assert "ebeat-fp1" not in mascarado
    assert "Diretoria Tecnica" not in mascarado
    assert config.mascarar_caminho(r"C:\dados\notas.db").startswith("local:")


def test_descrever_conexao_resume_sem_caminho_completo(monkeypatch, tmp_path):
    from input_module import db
    monkeypatch.delenv("EDP_PERFIL", raising=False)
    monkeypatch.delenv("INPUT_DB_PATH", raising=False)
    monkeypatch.setenv("INPUT_DATA_DIR", str(tmp_path))
    db.inicializar_banco()
    db.salvar_em_massa(pd.DataFrame([_nota(9100)]))
    resumo = db.descrever_conexao()
    assert resumo["ambiente"] == "local"
    assert resumo["tipo"] == "sqlite"
    assert resumo["status"] == "ok"
    assert resumo["qtd_notas"] == 1
    assert str(tmp_path) not in resumo["alvo"]


def test_rede_raiz_respeita_env(monkeypatch):
    """INPUT_REDE_RAIZ redireciona todos os caminhos derivados da rede."""
    import importlib
    monkeypatch.setenv("INPUT_REDE_RAIZ", r"\outro-host\Compartilhado")
    try:
        importlib.reload(config)
        assert config.REDE_RAIZ == r"\outro-host\Compartilhado"
        assert config.REDE_DB_ORIGEM.startswith(r"\outro-host\Compartilhado")
        assert config.CAMINHO_BASE_IW28.startswith(r"\outro-host\Compartilhado")
    finally:
        monkeypatch.delenv("INPUT_REDE_RAIZ", raising=False)
        importlib.reload(config)
    assert "outro-host" not in config.REDE_RAIZ


# ── Ramal: idempotência do ID_Cronologia ─────────────────────────────────────
def test_ramal_lote_parcial_preserva_id_cronologia(banco_temporario):
    """Reprocessar uma nota não renumera a cronologia nem colide com as outras."""
    from input_module import db
    db.salvar_ramal_em_massa(pd.DataFrame(
        [_nota_ramal(5201), _nota_ramal(5202), _nota_ramal(5203)]))
    antes = dict(zip(db.carregar_dados_ramal()["Numero_Nota"],
                     db.carregar_dados_ramal()["ID_Cronologia"]))
    assert len(set(antes.values())) == 3  # cronologias distintas

    db.salvar_ramal_em_massa(pd.DataFrame([_nota_ramal(5203, Observacao="editada")]))
    depois = dict(zip(db.carregar_dados_ramal()["Numero_Nota"],
                      db.carregar_dados_ramal()["ID_Cronologia"]))
    assert depois == antes
    assert len(db.carregar_dados_ramal()) == 3


def test_ramal_nota_nova_continua_a_numeracao(banco_temporario):
    from input_module import db
    db.salvar_ramal_em_massa(pd.DataFrame([_nota_ramal(5301), _nota_ramal(5302)]))
    db.salvar_ramal_em_massa(pd.DataFrame([_nota_ramal(5303)]))
    df = db.carregar_dados_ramal()
    cronologias = sorted(int(x) for x in df["ID_Cronologia"])
    assert cronologias == [1, 2, 3]
