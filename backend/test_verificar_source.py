import sqlite3

from coffee_module import db as coffee_db
from coffee_module import config
from verificar_module.source import carregar_fonte


def criar_fonte(tmp_path):
    caminho = tmp_path / "Verificar.clone.db"
    conn = sqlite3.connect(caminho)
    conn.execute(
        """
        CREATE TABLE ids_verificacao (
            id TEXT, tipo_nota TEXT, referencia_fisica TEXT, prioridade TEXT,
            uf TEXT, REGIAO TEXT, colaborador TEXT, chk_regra_Coordenada TEXT,
            chk_duplicada TEXT
        )
        """
    )
    conn.execute(
        """
        INSERT INTO ids_verificacao VALUES
        ('123456', 'DD', 'REF-01', '2', 'SP', 'Centro', '100', 'Coordenada inválida', 'ok')
        """
    )
    conn.commit()
    conn.close()
    return caminho


def test_fonte_le_clone_sem_alterar_schema(tmp_path, monkeypatch):
    caminho = criar_fonte(tmp_path)
    monkeypatch.setenv("VERIFICAR_DB_PATH", str(caminho))

    fonte = carregar_fonte()
    registros = fonte.registros

    assert registros["id"].tolist() == ["123456"]
    assert fonte.arquivo == "Verificar.clone.db"
    assert fonte.schema_version > 0
    assert fonte.atualizado_em is not None
    conn = sqlite3.connect(caminho)
    try:
        tabelas = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
        ).fetchall()
    finally:
        conn.close()
    assert tabelas == [("ids_verificacao",)]


def test_api_oculta_da_triagem_nota_corrigida_no_coffee(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient
    import main

    caminho = criar_fonte(tmp_path)
    monkeypatch.setenv("VERIFICAR_DB_PATH", str(caminho))
    monkeypatch.setenv("COFFEE_DATA_DIR", str(tmp_path / "coffee"))
    monkeypatch.setattr(main, "RECORDS", [])
    monkeypatch.setattr(main, "COMPLETED", set())
    coffee_db.inicializar_banco()
    coffee_db.upsert_nota(900001, config.SAP_PENDENTE, {"id": 900001})
    coffee_db.registrar_origem_verificar(900001, 123456)
    coffee_db.upsert_nota(900001, 17200001, {"id": 900001})

    response = TestClient(main.app).get("/api/data")

    assert response.status_code == 200
    body = response.json()
    assert body["records"] == []
    assert body["fonte"]["arquivo"] == "Verificar.clone.db"
    assert body["fonte"]["schema_version"] > 0


def test_resumo_triagem_separa_encaminhadas_de_falhas_e_usuarios_do_dia(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("COFFEE_DATA_DIR", str(tmp_path))
    coffee_db.inicializar_banco()
    try:
        coffee_db.definir_usuario("ana")
        coffee_db.upsert_nota(900001, config.SAP_PENDENTE, {"id": 900001})
        coffee_db.registrar_origem_verificar(900001, 123456)

        coffee_db.definir_usuario("bruno")
        coffee_db.upsert_nota(900002, config.SAP_PENDENTE, {"id": 900002})
        coffee_db.registrar_origem_verificar(900002, 123457)
        coffee_db.upsert_item_operacao(
            entrada_id=900002,
            nota_pk=900002,
            etapa="aguardando_sap",
            origem="verificar",
            erro="Falha ao consultar SAP.",
        )

        resumo = coffee_db.resumo_triagem_verificar()

        assert resumo["encaminhamentos"]["123456"]["situacao"] == "encaminhada"
        assert resumo["encaminhamentos"]["123457"]["situacao"] == "falha_operacional"
        assert resumo["encaminhamentos"]["123457"]["erro"] == "Falha ao consultar SAP."
        assert resumo["encaminhadas_hoje"] == [
            {"usuario": "ana", "total": 1},
            {"usuario": "bruno", "total": 1},
        ]
    finally:
        coffee_db.definir_usuario(None)


def test_retorno_da_operacao_mantem_justificativa_ate_novo_encaminhamento(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("COFFEE_DATA_DIR", str(tmp_path))
    coffee_db.inicializar_banco()
    try:
        coffee_db.definir_usuario("ana")
        coffee_db.upsert_nota(900001, config.SAP_PENDENTE, {"id": 900001})
        coffee_db.registrar_origem_verificar(900001, 123456)
        coffee_db.definir_usuario("bruno")
        coffee_db.registrar_retorno_verificar(900001, "Dados insuficientes.")

        retorno = coffee_db.resumo_triagem_verificar()["encaminhamentos"]["123456"]

        assert retorno["situacao"] == "retornada"
        assert retorno["retorno_justificativa"] == "Dados insuficientes."
        assert retorno["retornada_por"] == "bruno"

        coffee_db.registrar_origem_verificar(900001, 123456)
        novo_encaminhamento = coffee_db.resumo_triagem_verificar()["encaminhamentos"]["123456"]
        assert novo_encaminhamento["situacao"] == "encaminhada"
        assert novo_encaminhamento["retorno_justificativa"] is None
    finally:
        coffee_db.definir_usuario(None)


def test_rastreia_chave_da_fonte_mesmo_quando_pk_coffee_e_diferente(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setenv("COFFEE_DATA_DIR", str(tmp_path))
    coffee_db.inicializar_banco()
    coffee_db.definir_usuario("ana")
    try:
        coffee_db.upsert_nota(900001, config.SAP_PENDENTE, {"id": 900001})
        coffee_db.registrar_origem_verificar(900001, 123456)

        assert coffee_db.ids_verificar_em_correcao() == {"123456"}

        coffee_db.upsert_nota(900001, 17200001, {"id": 900001})
        nota = coffee_db.obter_nota(900001)

        assert nota["classificacao"] == "corrigida"
        assert nota["verificar_id"] == 123456
        assert nota["verificar_por"] == "ana"
        assert nota["corrigida_por"] == "ana"
        assert nota["verificar_em"] is not None
        assert nota["corrigida_em"] is not None
        assert coffee_db.ids_verificar_corrigidos() == {"123456"}
    finally:
        coffee_db.definir_usuario(None)
