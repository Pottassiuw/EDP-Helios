import time

import pytest
from fastapi.testclient import TestClient

from coffee_module import client, config, db, jobs, operation_service


@pytest.fixture
def coffee_operation_tmp(monkeypatch, tmp_path):
    monkeypatch.setenv("COFFEE_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(config, "COFFEE_API_KEY", "fake-key")
    monkeypatch.setattr(config, "DELAY_BUSCA", 0)
    monkeypatch.setattr(config, "DELAY_GERACAO", 0)
    db.inicializar_banco()
    return tmp_path


def test_operacao_snapshot_roundtrip(coffee_operation_tmp):
    criado = db.criar_operacao("job-1", "consulta", 2)
    assert criado["estado"] == "rodando"
    db.salvar_operacao("job-1", {
        **criado,
        "feitas": 1,
        "erros": [{"pk": 99, "msg": "timeout"}],
    })
    salvo = db.obter_operacao("job-1")
    assert salvo is not None
    assert salvo["feitas"] == 1
    assert salvo["erros"][0]["pk"] == 99


def test_fila_operacao_canonicaliza_por_pk(coffee_operation_tmp):
    db.upsert_item_operacao(entrada_id=777, etapa="fila", origem="avulsa")
    db.upsert_item_operacao(
        entrada_id=888,
        nota_pk=777,
        etapa="pronta",
        origem="verificar",
    )
    itens = db.listar_itens_operacao()
    assert len(itens) == 1
    assert itens[0]["nota_pk"] == 777
    assert itens[0]["etapa"] == "pronta"
    assert itens[0]["origem"] == "avulsa"


def test_recovery_interrompe_job_e_retorna_processando_para_pronta(
    coffee_operation_tmp,
):
    db.criar_operacao("job-2", "geracao", 1)
    db.upsert_item_operacao(
        entrada_id=777,
        nota_pk=777,
        etapa="processando",
        origem="avulsa",
        operacao_id="job-2",
    )
    db.interromper_operacoes_em_andamento()
    assert db.obter_operacao("job-2")["estado"] == "interrompida"
    item = db.listar_itens_operacao()[0]
    assert item["etapa"] == "pronta"
    assert item["erro"] == "Operação interrompida; reconsulte antes de tentar novamente."


def _nota(pk, sap, **fields):
    return {
        "pk": pk,
        "id_sap": sap,
        "arquivado": False,
        "local_instalacao": fields.get("local_instalacao"),
        "fields": {"id_sap": sap, **fields},
    }


def _aguardar(job_id: str, limite: float = 2.0) -> dict:
    fim = time.time() + limite
    while time.time() < fim:
        job = jobs.obter_job(job_id)
        if job and job["estado"] != "rodando":
            return job
        time.sleep(0.01)
    raise TimeoutError(job_id)


@pytest.fixture
def operation_client(coffee_operation_tmp, monkeypatch):
    from coffee_module import routes
    from main import app

    routes._estado["inicializado"] = False
    monkeypatch.setattr(
        client,
        "buscar_nota",
        lambda ident: _nota(int(ident), None, alimentador="ABC01"),
    )
    return TestClient(app)


def test_rotas_operacao_consultar_e_listar(operation_client):
    resposta = operation_client.post(
        "/api/coffee/operacao/consultar",
        json={"ids": [101]},
    )
    assert resposta.status_code == 200
    _aguardar(resposta.json()["job_id"])
    quadro = operation_client.get("/api/coffee/operacao").json()
    assert quadro["contagens"]["pronta"] == 1
    assert quadro["itens"][0]["nota"]["pk"] == 101


def test_rota_operacao_rejeita_lista_vazia(operation_client):
    resposta = operation_client.post(
        "/api/coffee/operacao/gerar",
        json={"ids": []},
    )
    assert resposta.status_code == 400


def test_rota_operacao_remover_exige_justificativa(operation_client):
    resposta = operation_client.post(
        "/api/coffee/operacao/remover",
        json={"ids": [101], "justificativa": ""},
    )
    assert resposta.status_code == 400


def test_rota_operacao_atualizar_sap_rejeita_etapa_invalida(
    operation_client,
):
    operation_service.adicionar_entradas([101], "avulsa", "seed")
    operation_service.aplicar_consulta(
        101, _nota(101, None), "avulsa", "seed"
    )

    resposta = operation_client.post(
        "/api/coffee/operacao/atualizar-sap",
        json={"ids": [101]},
    )

    assert resposta.status_code == 409
    assert db.listar_operacoes_ativas() == []


def test_rota_operacao_atualizar_sap_conclui_nota_aguardando(
    operation_client,
    monkeypatch,
):
    operation_service.adicionar_entradas([202], "avulsa", "seed")
    operation_service.aplicar_consulta(
        202, _nota(202, config.SAP_PENDENTE), "avulsa", "seed"
    )
    monkeypatch.setattr(
        client,
        "buscar_nota",
        lambda ident: _nota(int(ident), 17200202),
    )

    resposta = operation_client.post(
        "/api/coffee/operacao/atualizar-sap",
        json={"ids": [202]},
    )

    assert resposta.status_code == 200
    assert _aguardar(resposta.json()["job_id"])["estado"] == "concluido"
    assert db.listar_itens_operacao() == []


def test_rota_operacao_remover_remove_notas_da_fila(operation_client):
    operation_service.adicionar_entradas([303], "avulsa", "seed")
    operation_service.aplicar_consulta(
        303, _nota(303, None), "avulsa", "seed"
    )

    resposta = operation_client.post(
        "/api/coffee/operacao/remover",
        json={"ids": [303], "justificativa": "Não será mais necessária."},
    )

    assert resposta.status_code == 200
    assert resposta.json()["removidas"] == 1
    assert db.listar_itens_operacao() == []


def test_rota_local_reconsulta_e_atualiza_o_quadro(
    operation_client,
    monkeypatch,
):
    local = {"value": "701CF12345678"}
    monkeypatch.setattr(
        client,
        "alterar_local",
        lambda ident, value: local.update(value=value),
    )
    monkeypatch.setattr(
        client,
        "buscar_nota",
        lambda ident: _nota(
            int(ident),
            None,
            local_instalacao=local["value"],
            alimentador="ABC01",
        ),
    )
    operation_service.adicionar_entradas([101], "avulsa", "setup")
    operation_service.aplicar_consulta(
        101,
        _nota(101, None, local_instalacao="ANTIGO"),
        "avulsa",
        "setup",
    )

    resposta = operation_client.post(
        "/api/coffee/local-instalacao",
        json={"id": 101, "local": "702ET87654321"},
    )

    assert resposta.status_code == 200
    quadro = operation_client.get("/api/coffee/operacao").json()
    assert (
        quadro["itens"][0]["nota"]["dados_json"]["local_instalacao"]
        == "702ET87654321"
    )


def test_job_consulta_persiste_e_atualiza_quadro(
    coffee_operation_tmp,
    monkeypatch,
):
    monkeypatch.setattr(
        client,
        "buscar_nota",
        lambda ident: _nota(int(ident), None, alimentador="ABC01"),
    )
    job_id = jobs.iniciar_consulta_operacao([101], "avulsa")
    job = _aguardar(job_id)
    assert job["estado"] == "concluido"
    assert db.obter_operacao(job_id) is not None
    assert db.listar_itens_operacao()[0]["etapa"] == "pronta"


def test_consulta_operacao_mantem_x_user_nos_logs_da_thread(
    operation_client,
    monkeypatch,
):
    def buscar_e_logar(ident):
        db.registrar_log(
            "api_call", "buscar_nota", int(ident), {"id": ident}, True
        )
        return _nota(int(ident), None, alimentador="ABC01")

    monkeypatch.setattr(db.getpass, "getuser", lambda: "usuario-da-maquina")
    monkeypatch.setattr(client, "buscar_nota", buscar_e_logar)

    resposta = operation_client.post(
        "/api/coffee/operacao/consultar",
        json={"ids": [101]},
        headers={"X-User": "alice"},
    )

    assert resposta.status_code == 200
    assert _aguardar(resposta.json()["job_id"])["estado"] == "concluido"
    logs = db.listar_logs(nota_pk=101, tipo="api_call")
    assert logs and all(log["usuario"] == "alice" for log in logs)


def test_job_atualizacao_remove_nota_quando_sap_fica_real(
    coffee_operation_tmp,
    monkeypatch,
):
    operation_service.adicionar_entradas([202], "verificar", "seed")
    operation_service.aplicar_consulta(
        202, _nota(202, config.SAP_PENDENTE), "verificar", "seed"
    )
    monkeypatch.setattr(
        client,
        "buscar_nota",
        lambda ident: _nota(int(ident), 17200202),
    )
    job_id = jobs.iniciar_atualizacao_sap([202])
    assert _aguardar(job_id)["estado"] == "concluido"
    assert db.listar_itens_operacao() == []
    assert db.listar_notas("corrigida")[0]["pk"] == 202


def test_geracao_operacao_mantem_x_user_nos_logs_da_thread(
    operation_client,
    monkeypatch,
):
    def buscar_e_logar(ident):
        db.registrar_log(
            "api_call", "buscar_nota", int(ident), {"id": ident}, True
        )
        return _nota(int(ident), None, alimentador="ABC01")

    operation_service.adicionar_entradas([303], "avulsa", "seed")
    operation_service.aplicar_consulta(
        303, _nota(303, None), "avulsa", "seed"
    )
    monkeypatch.setattr(db.getpass, "getuser", lambda: "usuario-da-maquina")
    monkeypatch.setattr(client, "buscar_nota", buscar_e_logar)
    monkeypatch.setattr(client, "definir_sap", lambda ident, sap: True)
    monkeypatch.setattr(client, "desarquivar", lambda ident: True)

    resposta = operation_client.post(
        "/api/coffee/operacao/gerar",
        json={"ids": [303]},
        headers={"X-User": "bob"},
    )

    assert resposta.status_code == 200
    assert _aguardar(resposta.json()["job_id"])["estado"] == "concluido"
    logs = db.listar_logs(nota_pk=303, tipo="api_call")
    assert logs and all(log["usuario"] == "bob" for log in logs)


def test_geracao_operacao_rejeita_selecao_mista_sem_mutar_fila_ou_job(
    coffee_operation_tmp,
):
    operation_service.adicionar_entradas([303, 999], "avulsa", "seed")
    operation_service.aplicar_consulta(
        303, _nota(303, None), "avulsa", "seed"
    )
    operation_service.aplicar_consulta(
        999, _nota(999, config.SAP_PENDENTE), "avulsa", "seed"
    )

    with pytest.raises(ValueError, match="Nota 999"):
        jobs.iniciar_geracao_operacao([303, 999])

    etapas = {
        item["nota_pk"]: item["etapa"]
        for item in db.listar_itens_operacao()
    }
    assert etapas == {303: "pronta", 999: "aguardando_sap"}
    assert db.listar_operacoes_ativas() == []


def test_geracao_operacao_interrompe_job_se_transicao_falha_apos_criacao(
    coffee_operation_tmp,
    monkeypatch,
):
    operation_service.adicionar_entradas([303], "avulsa", "seed")
    operation_service.aplicar_consulta(
        303, _nota(303, None), "avulsa", "seed"
    )
    validar_prontas = operation_service.validar_prontas
    criar_operacao = db.criar_operacao
    chamadas_validacao = 0
    operacoes_criadas = []

    def falhar_na_segunda_validacao(pks):
        nonlocal chamadas_validacao
        chamadas_validacao += 1
        if chamadas_validacao == 2:
            raise ValueError("Nota 303 deixou de estar pronta.")
        validar_prontas(pks)

    def registrar_operacao(operacao_id, tipo, total):
        operacoes_criadas.append(operacao_id)
        return criar_operacao(operacao_id, tipo, total)

    monkeypatch.setattr(
        operation_service,
        "validar_prontas",
        falhar_na_segunda_validacao,
    )
    monkeypatch.setattr(db, "criar_operacao", registrar_operacao)

    with pytest.raises(ValueError, match="deixou de estar pronta"):
        jobs.iniciar_geracao_operacao([303])

    operacao = db.obter_operacao(operacoes_criadas[0])
    assert chamadas_validacao == 2
    assert operacao["estado"] == "interrompida"
    assert "deixou de estar pronta" in operacao["erros"][0]["msg"]
    assert db.listar_itens_operacao()[0]["etapa"] == "pronta"
    assert db.listar_operacoes_ativas() == []


def test_geracao_operacao_reverte_apenas_cartoes_do_job_se_thread_falha(
    coffee_operation_tmp,
    monkeypatch,
):
    operation_service.adicionar_entradas([303, 404], "avulsa", "seed")
    operation_service.aplicar_consulta(
        303, _nota(303, None), "avulsa", "seed"
    )
    operation_service.aplicar_consulta(
        404, _nota(404, None), "avulsa", "seed"
    )
    operation_service.marcar_processando([404], "outra-operacao")
    criar_operacao = db.criar_operacao
    operacoes_criadas = []

    class ThreadComFalha:
        def __init__(self, **kwargs):
            pass

        def start(self):
            raise RuntimeError("falha ao iniciar worker")

    def registrar_operacao(operacao_id, tipo, total):
        operacoes_criadas.append(operacao_id)
        return criar_operacao(operacao_id, tipo, total)

    monkeypatch.setattr(jobs.threading, "Thread", ThreadComFalha)
    monkeypatch.setattr(db, "criar_operacao", registrar_operacao)

    with pytest.raises(RuntimeError, match="falha ao iniciar worker"):
        jobs.iniciar_geracao_operacao([303])

    operacao = db.obter_operacao(operacoes_criadas[0])
    itens = {
        item["nota_pk"]: item
        for item in db.listar_itens_operacao()
    }
    assert operacao["estado"] == "interrompida"
    assert "falha ao iniciar worker" in operacao["erros"][0]["msg"]
    assert itens[303]["etapa"] == "pronta"
    assert itens[303]["operacao_id"] is None
    assert "interrompida" in itens[303]["erro"].lower()
    assert itens[404]["etapa"] == "processando"
    assert itens[404]["operacao_id"] == "outra-operacao"
    assert db.listar_operacoes_ativas() == []


def test_reconsulta_nao_altera_item_processando_nem_permite_geracao_duplicada(
    coffee_operation_tmp,
    monkeypatch,
):
    operation_service.adicionar_entradas([505], "avulsa", "seed")
    operation_service.aplicar_consulta(
        505, _nota(505, None), "avulsa", "seed"
    )
    db.criar_operacao("geracao-ativa", "geracao", 1)
    operation_service.marcar_processando([505], "geracao-ativa")
    monkeypatch.setattr(
        client,
        "buscar_nota",
        lambda ident: pytest.fail("A nota ativa não pode ser reconsultada."),
    )

    job_id = jobs.iniciar_consulta_operacao([505], "avulsa")

    assert _aguardar(job_id)["estado"] == "concluido"
    item = db.listar_itens_operacao()[0]
    assert item["etapa"] == "processando"
    assert item["operacao_id"] == "geracao-ativa"
    with pytest.raises(ValueError, match="não está pronta"):
        jobs.iniciar_geracao_operacao([505])


def test_reconsulta_reenvia_fila_com_erro_e_avanca_para_pronta(
    coffee_operation_tmp,
    monkeypatch,
):
    db.upsert_item_operacao(
        entrada_id=606,
        etapa="fila",
        origem="avulsa",
        operacao_id="consulta-com-erro",
        erro="timeout",
    )
    chamadas: list[int] = []
    monkeypatch.setattr(
        client,
        "buscar_nota",
        lambda ident: chamadas.append(int(ident)) or _nota(int(ident), None),
    )

    job_id = jobs.iniciar_consulta_operacao([606], "avulsa")

    assert _aguardar(job_id)["estado"] == "concluido"
    assert chamadas == [606]
    item = db.listar_itens_operacao()[0]
    assert item["etapa"] == "pronta"
    assert item["operacao_id"] == job_id


def test_job_consulta_reporta_contagem_por_etapa(coffee_operation_tmp, monkeypatch):
    def buscar(ident):
        ident = int(ident)
        if ident == 901:
            return _nota(ident, config.SAP_PENDENTE, alimentador="ABC01")
        return _nota(ident, None, alimentador="ABC01")

    monkeypatch.setattr(client, "buscar_nota", buscar)

    job_id = jobs.iniciar_consulta_operacao([900, 901], "avulsa")
    job = _aguardar(job_id)

    assert job["estado"] == "concluido"
    assert job["por_etapa"] == {"pronta": 1, "aguardando_sap": 1, "processando": 0, "ignorada": 0}


def test_consulta_move_sem_sap_para_pronta(coffee_operation_tmp):
    operation_service.adicionar_entradas([101], "avulsa", "job-a")
    etapa = operation_service.aplicar_consulta(
        101, _nota(101, None, alimentador="ABC01"), "avulsa", "job-a"
    )
    assert etapa == "pronta"
    assert db.listar_itens_operacao()[0]["etapa"] == "pronta"


# ---------------------------------------------------------------------------
# Paralelismo limitado (fila grande não pode mais ser 1-nota-por-vez serial)
# ---------------------------------------------------------------------------

def test_consulta_operacao_processa_lote_grande_em_paralelo(
    monkeypatch, tmp_path_factory,
):
    """MAX_WORKERS=4 processa um lote bem mais rápido que MAX_WORKERS=1 —
    grupo de controle serial vs paralelo, sem hardcodar tempo absoluto (a
    velocidade real de I/O do SQLite varia por máquina; o que importa é que
    o pool concorrente esteja de fato em uso, não parado no papel)."""
    monkeypatch.setattr(config, "COFFEE_API_KEY", "fake-key")
    monkeypatch.setattr(config, "DELAY_BUSCA", 0)
    monkeypatch.setattr(config, "DELAY_GERACAO", 0)
    ids = list(range(700, 712))  # 12 notas

    def buscar_lenta(ident):
        time.sleep(0.05)
        return _nota(int(ident), None, alimentador="ABC01")

    monkeypatch.setattr(client, "buscar_nota", buscar_lenta)

    def rodar_lote(max_workers: int) -> float:
        # Banco novo a cada rodada: inicializar_banco() é CREATE TABLE IF NOT
        # EXISTS (não limpa dados) — reusar o mesmo já deixaria a 2ª rodada
        # sem itens "fila" pra consultar (adicionar_entradas pula quem não
        # está mais em fila-com-erro).
        monkeypatch.setenv("COFFEE_DATA_DIR", str(tmp_path_factory.mktemp("coffee")))
        db.inicializar_banco()
        monkeypatch.setattr(config, "MAX_WORKERS", max_workers)
        inicio = time.time()
        job_id = jobs.iniciar_consulta_operacao(ids, "avulsa")
        job = _aguardar(job_id, limite=10.0)
        assert job["estado"] == "concluido"
        assert job["feitas"] == len(ids)
        return time.time() - inicio

    duracao_serial = rodar_lote(1)
    duracao_paralela = rodar_lote(4)

    assert duracao_paralela < duracao_serial * 0.7, (
        f"serial={duracao_serial:.2f}s paralelo={duracao_paralela:.2f}s — "
        "pool concorrente não está rendendo ganho real"
    )
    prontas = [item for item in db.listar_itens_operacao() if item["etapa"] == "pronta"]
    assert len(prontas) == len(ids)


def test_geracao_operacao_falha_de_uma_nota_nao_trava_as_outras(
    coffee_operation_tmp, monkeypatch,
):
    """Uma nota que estoura erro no meio do lote não pode impedir as demais
    de terminar — cada item trata seu próprio erro (defense-in-depth do pool)."""
    ids = [801, 802, 803, 804]
    for ident in ids:
        operation_service.adicionar_entradas([ident], "avulsa", "seed")
        operation_service.aplicar_consulta(ident, _nota(ident, None), "avulsa", "seed")

    def buscar_com_uma_falha(ident):
        if int(ident) == 802:
            raise RuntimeError("COFFEE indisponível pra essa nota")
        return _nota(int(ident), None, alimentador="ABC01")

    monkeypatch.setattr(client, "buscar_nota", buscar_com_uma_falha)
    monkeypatch.setattr(client, "definir_sap", lambda ident, sap: True)
    monkeypatch.setattr(client, "desarquivar", lambda ident: True)

    job_id = jobs.iniciar_geracao_operacao(ids)
    job = _aguardar(job_id)

    assert job["estado"] == "concluido"  # "parcial" (com erros) já sai mapeado assim por obter_job
    assert job["feitas"] == len(ids)
    assert [erro["pk"] for erro in job["erros"]] == [802]
    itens = {item["nota_pk"]: item["etapa"] for item in db.listar_itens_operacao()}
    assert itens[802] == "pronta"  # falha devolve a nota pra pronta, não trava em processando
    for ok_pk in (801, 803, 804):
        assert itens[ok_pk] == "aguardando_sap"  # geradas com sucesso: aguardando o SAP real


def test_consulta_move_placeholder_para_aguardando(coffee_operation_tmp):
    operation_service.adicionar_entradas([202], "verificar", "job-b")
    etapa = operation_service.aplicar_consulta(
        202, _nota(202, config.SAP_PENDENTE), "verificar", "job-b"
    )
    assert etapa == "aguardando_sap"


def test_consulta_remove_sap_real_do_quadro(coffee_operation_tmp):
    operation_service.adicionar_entradas([303], "avulsa", "job-c")
    etapa = operation_service.aplicar_consulta(
        303, _nota(303, 17300303), "avulsa", "job-c"
    )
    assert etapa is None
    assert db.listar_itens_operacao() == []


def test_falha_de_geracao_retorna_para_pronta(coffee_operation_tmp):
    operation_service.adicionar_entradas([404], "avulsa", "job-d")
    operation_service.aplicar_consulta(
        404, _nota(404, None), "avulsa", "job-d"
    )
    operation_service.marcar_processando([404], "job-e")
    operation_service.aplicar_falha(404, "pronta", "timeout")
    item = db.listar_itens_operacao()[0]
    assert item["etapa"] == "pronta"
    assert item["erro"] == "timeout"
