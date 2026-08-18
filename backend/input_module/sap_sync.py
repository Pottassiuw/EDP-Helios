"""Estado e guarda de concorrência do robô SAP.

O lock é deliberadamente dedicado ao robô SAP: sincronizações de rede e outras
operações do módulo Input não devem mascarar o estado desta execução.
"""
import datetime
import threading
from typing import Callable


class SapSyncEmAndamento(RuntimeError):
    """Indica que outra execução SAP já está em curso."""


_lock = threading.Lock()
_executando = False
_estado = {
    "estado": "ocioso",
    "ultima_atualizacao": None,
    "erro": None,
}


def estado() -> dict:
    with _lock:
        return dict(_estado)


def reservar() -> dict:
    """Reserva a única vaga antes de enfileirar o trabalho em background."""
    global _executando
    with _lock:
        if _executando:
            raise SapSyncEmAndamento(
                "Sincronização SAP já está em execução; aguarde a conclusão antes de tentar novamente."
            )
        _executando = True
        _estado.update({"estado": "executando", "erro": None})
        return dict(_estado)


def executar(tarefa: Callable[[], None]) -> dict:
    """Executa uma tarefa previamente reservada por `reservar`."""
    try:
        tarefa()
    except Exception as exc:
        with _lock:
            _estado.update({
                "estado": "falhou",
                "ultima_atualizacao": datetime.datetime.now().isoformat(),
                "erro": str(exc),
            })
        return estado()
    else:
        with _lock:
            _estado.update({
                "estado": "concluido",
                "ultima_atualizacao": datetime.datetime.now().isoformat(),
                "erro": None,
            })
        return estado()
    finally:
        with _lock:
            _executando = False


def disparar(tarefa: Callable[[], None]) -> dict:
    reservar()
    return executar(tarefa)


def resetar_estado() -> None:
    """Reseta estado apenas para isolamento de testes e reinício controlado."""
    global _executando
    with _lock:
        _executando = False
        _estado.update({
            "estado": "ocioso",
            "ultima_atualizacao": None,
            "erro": None,
        })
