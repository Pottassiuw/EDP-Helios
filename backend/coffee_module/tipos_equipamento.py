"""Lookup estático de tipos de equipamento para correção manual do local de
instalação no Verificar.

Fonte: planilha da concessionária convertida uma vez para CSV
(`data/tipos_equipamento.csv`, id + descrição). Carregado uma vez e
cacheado em memória — não muda em runtime.
"""
import csv
from functools import lru_cache
from pathlib import Path

_CSV_PATH = Path(__file__).resolve().parent / "data" / "tipos_equipamento.csv"


@lru_cache(maxsize=1)
def listar() -> list[dict]:
    with open(_CSV_PATH, encoding="utf-8", newline="") as arquivo:
        return [
            {"id": linha["id"], "descricao": linha["descricao"]}
            for linha in csv.DictReader(arquivo)
        ]


@lru_cache(maxsize=1)
def _ids_validos() -> frozenset[str]:
    return frozenset(item["id"] for item in listar())


def tipo_equipamento_valido(id_tipo: str) -> bool:
    return id_tipo in _ids_validos()
