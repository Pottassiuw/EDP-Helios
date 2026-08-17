"""Lookup estático de alimentadores (circuitos) para correção manual no Verificar.

Fonte: planilha da concessionária convertida uma vez para CSV
(`data/alimentadores.csv`, id + cidades atendidas). Carregado uma vez e
cacheado em memória — não muda em runtime.
"""
import csv
from functools import lru_cache
from pathlib import Path

_CSV_PATH = Path(__file__).resolve().parent / "data" / "alimentadores.csv"


@lru_cache(maxsize=1)
def listar() -> list[dict]:
    with open(_CSV_PATH, encoding="utf-8", newline="") as arquivo:
        return [
            {"id": linha["id"], "cidade": linha["cidade"]}
            for linha in csv.DictReader(arquivo)
        ]


@lru_cache(maxsize=1)
def _ids_validos() -> frozenset[str]:
    return frozenset(item["id"] for item in listar())


def alimentador_valido(id_alimentador: str) -> bool:
    return id_alimentador in _ids_validos()
