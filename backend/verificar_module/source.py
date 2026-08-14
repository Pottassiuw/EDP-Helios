"""Fonte SQLite somente leitura da triagem Verificar."""
from __future__ import annotations

import datetime
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

import pandas as pd


TABELA_VERIFICACAO = "ids_verificacao"
CAMINHO_REDE_PADRAO = (
    "//fscoc10/dep/DDPM/COFFEE/Gerador de Notas/Verificar.db"
)


class FonteVerificarIndisponivelErro(RuntimeError):
    """O banco de triagem não pôde ser lido."""


@dataclass(frozen=True)
class FonteCarregada:
    """Dados da triagem e metadados seguros da fonte SQLite."""

    registros: pd.DataFrame
    arquivo: str
    schema_version: int
    atualizado_em: str | None


def caminho_banco() -> str:
    """Caminho do banco de triagem; override permite usar um clone em testes."""
    return os.environ.get("VERIFICAR_DB_PATH", CAMINHO_REDE_PADRAO).strip()


def _uri_somente_leitura(caminho: str) -> str:
    normalizado = caminho.replace("\\", "/")
    if normalizado.startswith("//"):
        return "file:////" + quote(normalizado.lstrip("/"), safe="/") + "?mode=ro"
    return Path(normalizado).resolve().as_uri() + "?mode=ro"


def carregar_fonte() -> FonteCarregada:
    """Retorna a tabela e seus metadados sem alterar o banco compartilhado."""
    caminho = caminho_banco()
    if not caminho:
        raise FonteVerificarIndisponivelErro(
            "VERIFICAR_DB_PATH não foi configurado. Informe o banco da triagem."
        )

    try:
        conn = sqlite3.connect(_uri_somente_leitura(caminho), uri=True, timeout=15)
        try:
            conn.execute("PRAGMA query_only = ON")
            tabelas = {
                row[0]
                for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type = 'table'"
                )
            }
            if TABELA_VERIFICACAO not in tabelas:
                raise FonteVerificarIndisponivelErro(
                    f"O banco de triagem não contém a tabela '{TABELA_VERIFICACAO}'."
                )
            registros = pd.read_sql_query(
                f'SELECT * FROM "{TABELA_VERIFICACAO}"',
                conn,
            )
            try:
                atualizado_em = datetime.datetime.fromtimestamp(
                    os.path.getmtime(caminho),
                ).isoformat()
            except OSError:
                atualizado_em = None
            return FonteCarregada(
                registros=registros,
                arquivo=os.path.basename(caminho),
                schema_version=conn.execute("PRAGMA schema_version").fetchone()[0],
                atualizado_em=atualizado_em,
            )
        finally:
            conn.close()
    except FonteVerificarIndisponivelErro:
        raise
    except (OSError, sqlite3.Error) as exc:
        raise FonteVerificarIndisponivelErro(
            "Não foi possível ler o Verificar.db. Verifique acesso à rede, "
            "permissão de leitura e o caminho configurado."
        ) from exc


def carregar_registros() -> pd.DataFrame:
    """Compatibilidade para consumidores que só precisam dos registros."""
    return carregar_fonte().registros
