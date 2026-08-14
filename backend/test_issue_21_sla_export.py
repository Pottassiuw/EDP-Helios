"""Regressões da Issue #21: SLA canônico e exportação estrita."""
import io

import pandas as pd
import pytest
from fastapi.testclient import TestClient

pytest_plugins = ["test_input_module"]


@pytest.fixture
def cliente(engine_isolado):
    from main import app
    from input_module import service
    service.resetar_migracao()
    return TestClient(app)


def test_calcular_sla_canonico_materializa_desvio_e_status():
    from input_module.sla import calcular_sla

    resultado = calcular_sla({
        "Mes_Execucao_Planejado": "jul-2026",
        "Status_Nota": "99 Encerrado",
        "Ordem_Executada": "SIM",
        "Encerram.por data": "2026-08-03",
    })

    assert resultado == {"Status_SLA": "Atrasado", "Desvio_SLA": "Atrasado (1m)"}


def test_export_sla_preserva_coluna_materializada_e_valor_da_tela(cliente):
    from input_module import db, engine

    db.salvar_em_massa(pd.DataFrame([{
        "Numero_Nota": 21001,
        "Conjunto": "POA",
        "Planejado_DDPM": 1.0,
        "Mes_Execucao_Planejado": "jul-2026",
        "Status_Nota": "99 Encerrado",
        "Ordem_Executada": "SIM",
        "Encerram.por data": "2026-08-03",
    }]))
    engine.invalidar_cache()
    dataset = engine.get_dataset(forcar=True)
    linha = dataset.loc[dataset["Numero_Nota"] == 21001].iloc[0]
    resposta = cliente.post("/api/input/export", json={
        "numeros": [21001], "colunas": ["Numero_Nota", "Status_SLA", "Desvio_SLA"],
    })

    assert resposta.status_code == 200
    exportado = pd.read_excel(io.BytesIO(resposta.content))
    assert list(exportado.columns) == ["Nº Nota (ID)", "Status SLA", "Status de SLA / Desvio"]
    assert exportado.iloc[0]["Status SLA"] == linha["Status_SLA"]
    assert exportado.iloc[0]["Status de SLA / Desvio"] == linha["Desvio_SLA"]


def test_export_rejeita_coluna_desconhecida_com_422_e_mensagem_acionavel(cliente):
    resposta = cliente.post("/api/input/export", json={
        "numeros": [], "colunas": ["Numero_Nota", "Coluna_Que_Nao_Existe"],
    })

    assert resposta.status_code == 422
    assert "Coluna_Que_Nao_Existe" in resposta.json()["detail"]
    assert "desconhecida" in resposta.json()["detail"].lower()
