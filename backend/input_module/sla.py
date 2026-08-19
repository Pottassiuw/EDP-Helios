"""Regra canônica de aderência ao prazo (SLA) do módulo Input.

A regra é a homologada com a operação e descrita na legenda "Guia de Critérios
e Regras das Flags" (aba Relatórios): tolerância de **+1 mês** para a obra
concluída, atraso a partir de 2 meses, e a nota com ordem executada em campo
mas ainda aberta como estado próprio ("Passível de Encerramento") em vez de
entrar na conta do prazo.

É a mesma regra que `engine.avaliar_prazo_sap` aplica ao
`Auditoria_Cronograma`: as duas leituras compartilham daqui o parsing das
datas e a tolerância, para não voltarem a divergir.
"""
import datetime
import re

import pandas as pd

# Tolerância operacional homologada, em meses, para a obra concluída depois do
# mês planejado. Mudou a regra com a operação? Muda aqui e nos dois consumidores.
TOLERANCIA_MESES = 1

_VAZIOS = {"", "-", "none", "nan", "nat", "null"}

MESES = {
    "jan": 1, "fev": 2, "mar": 3, "abr": 4, "maio": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12,
}


def valor_ausente(valor) -> bool:
    """Distingue "campo em branco" de "campo preenchido com lixo".

    Cobre os vazios do pandas (`NaN`, `NaT`, `NA`) e os sentinelas de texto que
    o app grava no lugar de nulo ("-", "None", "nan").
    """
    try:
        if pd.isna(valor):
            return True
    except (TypeError, ValueError):
        pass
    return str(valor).strip().lower() in _VAZIOS


def mes_planejado(valor) -> tuple[int, int] | None:
    """(ano, mês) do planejamento DDPM — aceita `jul-2026`, `2026-jul` e ISO."""
    if valor_ausente(valor):
        return None
    texto = str(valor).strip()

    iso = re.match(r"^(\d{4})[-/](\d{2})[-/](\d{2})", texto)
    if iso:
        return int(iso.group(1)), int(iso.group(2))

    if "-" not in texto:
        return None
    partes = texto.split("-")
    if len(partes) != 2:
        return None

    if partes[0].lower() in MESES and partes[1].strip().isdigit():
        return _ano_de_quatro_digitos(partes[1]), MESES[partes[0].lower()]
    if partes[1].lower() in MESES and partes[0].strip().isdigit():
        return _ano_de_quatro_digitos(partes[0]), MESES[partes[1].lower()]
    return None


def _ano_de_quatro_digitos(texto: str) -> int:
    ano = int(texto.strip())
    return ano + 2000 if ano < 100 else ano


def mes_encerramento(valor) -> tuple[int, int] | None:
    """(ano, mês) do encerramento SAP; `None` quando a data não é interpretável.

    O formato ISO é resolvido antes de chegar ao pandas de propósito:
    `pd.to_datetime("2026-08-03", dayfirst=True)` devolve **8 de março**, não 3
    de agosto — todo encerramento com dia <= 12 vinha com mês e dia trocados na
    auditoria de prazo. `dayfirst` continua valendo para o que sobra, que é
    justamente o formato brasileiro ambíguo.
    """
    if valor_ausente(valor):
        return None
    if isinstance(valor, (datetime.datetime, datetime.date)):
        return int(valor.year), int(valor.month)

    texto = str(valor).strip()
    iso = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", texto)
    if iso:
        return int(iso.group(1)), int(iso.group(2))
    brasileiro = re.match(r"^(\d{2})/(\d{2})/(\d{4})", texto)
    if brasileiro:
        return int(brasileiro.group(3)), int(brasileiro.group(2))

    data = pd.to_datetime(texto, dayfirst=True, errors="coerce")
    if pd.isna(data):
        return None
    return int(data.year), int(data.month)


def nota_encerrada(row) -> bool:
    """Nota logicamente encerrada (status 99), olhando o status SAP e o da nota."""
    status_sap = str(row.get("Status_Final", "") or "")
    status_nota = str(row.get("Status_Nota", "") or "")
    return "99" in status_sap or "99" in status_nota


def ordem_executada(row) -> bool:
    return str(row.get("Ordem_Executada", "") or "").strip().upper() == "SIM"


def desvio_em_meses(planejado: tuple[int, int], real: tuple[int, int]) -> int:
    ano_plan, mes_plan = planejado
    ano_real, mes_real = real
    return (ano_real - ano_plan) * 12 + (mes_real - mes_plan)


def calcular(row, hoje: datetime.date | None = None) -> dict:
    """Materializa `Status_SLA`, `Desvio_SLA` e `Desvio_SLA_Meses` de uma nota.

    `Desvio_SLA_Meses` é o desvio numérico (negativo = adiantado) que a tela usa
    nos KPIs — evita reconstruir o número a partir do texto.
    """
    if ordem_executada(row) and not nota_encerrada(row):
        return _verdito("Passível de Encerramento",
                        "Ordem executada, nota ainda aberta")

    planejado = mes_planejado(row.get("Mes_Execucao_Planejado"))
    if planejado is None:
        if valor_ausente(row.get("Mes_Execucao_Planejado")):
            return _verdito("Sem Planejamento", "Sem Planejamento")
        return _verdito("Dados Insuficientes", "Planejado Inválido")

    if nota_encerrada(row):
        return _sla_encerrada(row, planejado)
    return _sla_pendente(planejado, hoje or datetime.date.today())


def _sla_encerrada(row, planejado: tuple[int, int]) -> dict:
    encerramento = row.get("Encerram.por data")
    if valor_ausente(encerramento):
        return _verdito("Dados Insuficientes", "Sem Data Encerramento")
    real = mes_encerramento(encerramento)
    if real is None:
        return _verdito("Dados Insuficientes", "Data Encerramento Inválida")

    desvio = desvio_em_meses(planejado, real)
    if desvio < 0:
        return _verdito("Adiantado", f"Antecipado ({abs(desvio)}m)", desvio)
    if desvio == 0:
        return _verdito("No Prazo", "No Prazo", desvio)
    if desvio <= TOLERANCIA_MESES:
        return _verdito("No Prazo", f"No Prazo (+{desvio}m tolerância)", desvio)
    return _verdito("Atrasado", f"Atrasado ({desvio}m)", desvio)


def _sla_pendente(planejado: tuple[int, int], hoje: datetime.date) -> dict:
    desvio = desvio_em_meses(planejado, (hoje.year, hoje.month))
    if desvio > TOLERANCIA_MESES:
        return _verdito("Pendente Atrasado", f"Atrasado pendente ({desvio}m)", desvio)
    # Dentro da tolerância o desvio numérico vai zerado de propósito: o KPI de
    # atraso acumulado soma desvios positivos e mede passivo, não folga.
    return _verdito("Pendente No Prazo", "Pendente (No Prazo)", 0)


def _verdito(status: str, desvio_texto: str, desvio: int | None = None) -> dict:
    return {"Status_SLA": status, "Desvio_SLA": desvio_texto,
            "Desvio_SLA_Meses": desvio}
