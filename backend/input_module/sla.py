"""Regra canônica de aderência ao prazo (SLA) do módulo Input."""
from __future__ import annotations

import datetime as dt
import math
import re
from collections.abc import Mapping

MESES = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "maio": 5,
    "jun": 6, "jul": 7, "ago": 8, "set": 9, "out": 10,
    "nov": 11, "dez": 12,
}


def _data(valor) -> tuple[int, int] | None:
    texto = str(valor or "").strip()
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", texto)
    br = re.match(r"^(\d{2})/(\d{2})/(\d{4})", texto)
    if iso:
        return int(iso.group(1)), int(iso.group(2))
    if br:
        return int(br.group(3)), int(br.group(2))
    return None


def _planejado(valor) -> tuple[int, int] | None:
    partes = str(valor or "").strip().lower().split("-")
    if len(partes) != 2 or partes[0] not in MESES or not partes[1].isdigit():
        return None
    return int(partes[1]), MESES[partes[0]]


def calcular_sla(row: Mapping, *, hoje: dt.date | None = None) -> dict[str, str]:
    """Calcula os campos materializados consumidos pela tela e exportação."""
    planejado = _planejado(row.get("Mes_Execucao_Planejado"))
    if planejado is None:
        return {"Status_SLA": "Dados Insuficientes", "Desvio_SLA": "Planejado Inválido"}

    status = str(row.get("Status_Nota") or "").strip()
    executada = str(row.get("Ordem_Executada") or "").strip().upper() == "SIM"
    executada = executada or bool(re.match(r"^99(?:\.0+)?(?:\s|$)", status))
    if str(row.get("Export_status") or "").strip().upper() == "ENCE EXEC":
        executada = True

    if executada:
        real = _data(row.get("Encerram.por data"))
        if real is None:
            return {"Status_SLA": "Dados Insuficientes", "Desvio_SLA": "Sem Data Encerramento"}
    else:
        referencia = hoje or dt.date.today()
        real = (referencia.year, referencia.month)

    ano_plan, mes_plan = planejado
    ano_real, mes_real = real
    desvio = (ano_real - ano_plan) * 12 + mes_real - mes_plan
    if not executada:
        if desvio > 0:
            return {"Status_SLA": "Pendente Atrasado", "Desvio_SLA": f"Atrasado pendente ({desvio}m)"}
        return {"Status_SLA": "Pendente No Prazo", "Desvio_SLA": "Pendente (No Prazo)"}
    if desvio == 0:
        return {"Status_SLA": "No Prazo", "Desvio_SLA": "No Prazo"}
    if desvio < 0:
        return {"Status_SLA": "Adiantado", "Desvio_SLA": f"Antecipado ({math.fabs(desvio):g}m)"}
    return {"Status_SLA": "Atrasado", "Desvio_SLA": f"Atrasado ({desvio}m)"}
