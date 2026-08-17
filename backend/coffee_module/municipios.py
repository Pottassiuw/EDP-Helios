"""Lookup estático de códigos de município para correção manual do local de
instalação no Verificar.

Fonte: planilha da concessionária convertida uma vez para CSV
(`data/municipios.csv`, código com 3 dígitos + nome). Carregado uma vez e
cacheado em memória — não muda em runtime.
"""
import csv
from functools import lru_cache
from pathlib import Path

_CSV_PATH = Path(__file__).resolve().parent / "data" / "municipios.csv"


@lru_cache(maxsize=1)
def listar() -> list[dict]:
    with open(_CSV_PATH, encoding="utf-8", newline="") as arquivo:
        return [
            {"codigo": linha["codigo"], "nome": linha["nome"]}
            for linha in csv.DictReader(arquivo)
        ]


@lru_cache(maxsize=1)
def _codigos_validos() -> frozenset[str]:
    return frozenset(item["codigo"] for item in listar())


def municipio_valido(codigo: str) -> bool:
    return codigo in _codigos_validos()
