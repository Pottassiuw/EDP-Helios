import threading
import time

import pytest

from input_module import sap_sync


def reset_guard():
    sap_sync.resetar_estado()


def test_dois_disparos_simultaneos_iniciam_no_maximo_uma_execucao():
    reset_guard()
    iniciou = threading.Event()
    libera = threading.Event()
    chamadas = []

    def robo_fake():
        chamadas.append("iniciou")
        iniciou.set()
        libera.wait(timeout=2)

    resultados = []

    def disparar():
        try:
            resultados.append(sap_sync.disparar(robo_fake))
        except sap_sync.SapSyncEmAndamento as exc:
            resultados.append(exc)

    threads = [threading.Thread(target=disparar) for _ in range(2)]
    for thread in threads:
        thread.start()
    assert iniciou.wait(timeout=2)
    time.sleep(0.05)
    assert len(chamadas) == 1
    libera.set()
    for thread in threads:
        thread.join(timeout=2)

    assert sum(isinstance(resultado, sap_sync.SapSyncEmAndamento) for resultado in resultados) == 1
    reset_guard()


def test_segundo_disparo_recebe_erro_acionavel():
    reset_guard()
    libera = threading.Event()
    primeira = []
    thread = threading.Thread(
        target=lambda: primeira.append(sap_sync.disparar(lambda: libera.wait(timeout=2)))
    )
    thread.start()
    time.sleep(0.05)

    with pytest.raises(sap_sync.SapSyncEmAndamento, match="já está em execução"):
        sap_sync.disparar(lambda: None)

    assert sap_sync.estado()["estado"] == "executando"
    libera.set()
    thread.join(timeout=2)
    assert primeira[0]["estado"] == "concluido"
    reset_guard()


def test_estado_do_sync_expoe_estado_real_e_ultima_atualizacao():
    reset_guard()
    assert sap_sync.estado()["estado"] == "ocioso"
    assert sap_sync.estado()["ultima_atualizacao"] is None

    sap_sync.disparar(lambda: None)
    estado = sap_sync.estado()

    assert estado["estado"] == "concluido"
    assert estado["ultima_atualizacao"] is not None
    assert estado["erro"] is None
    reset_guard()


def test_endpoint_rejeita_segundo_disparo_com_erro_acionavel(monkeypatch):
    from input_module import routes

    class Tasks:
        def __init__(self):
            self.tarefas = []

        def add_task(self, func, *args, **kwargs):
            self.tarefas.append((func, args, kwargs))

    tasks = Tasks()
    monkeypatch.setattr(routes, "garantir_banco", lambda: "ja-existe")
    monkeypatch.setattr(routes, "_rotina_sap_background", lambda: None)
    reset_guard()

    resposta = routes.sync_sap(tasks)
    assert resposta["sap"]["estado"] == "executando"

    with pytest.raises(routes.HTTPException) as erro:
        routes.sync_sap(tasks)
    assert erro.value.status_code == 409
    assert "aguarde" in erro.value.detail

    func, args, kwargs = tasks.tarefas[0]
    func(*args, **kwargs)
    assert sap_sync.estado()["estado"] == "concluido"
    reset_guard()


def test_contrato_sync_inclui_estado_sap(monkeypatch):
    from input_module import db, routes

    db.inicializar_banco()
    monkeypatch.setattr(routes, "garantir_banco", lambda: "ja-existe")
    reset_guard()

    resposta = routes.sync()

    assert resposta["sap"] == {
        "estado": "ocioso",
        "ultima_atualizacao": None,
        "erro": None,
    }
