"""Normalizacao origem Databricks -> dominio da Carteira."""
import hashlib
import json

from carteira_module import config

SENTINELA_SAP = "10000000"
QUANTIDADE_SENTINELA = 9999

# Nome da coluna de descricao vem com acento na origem (descrição_conjunto).
_COL_DESCRICAO = "descrição_conjunto"

_BLOCOS_ENRIQUECIMENTO = (
    {
        "codigo": "identificacao_indisponivel",
        "bloco": "identificacao",
        "campos": {
            _COL_DESCRICAO: "descricao_conjunto",
            "conjunto": "conjunto",
        },
        "mensagem": "Parte dos dados de identificação está indisponível.",
    },
    {
        "codigo": "diagnostico_indisponivel",
        "bloco": "diagnostico",
        "campos": {"sintoma": "sintoma"},
        "mensagem": "Os dados de diagnóstico estão indisponíveis.",
    },
    {
        "codigo": "equipamentos_indisponiveis",
        "bloco": "equipamentos",
        "campos": {
            "componente_novo": "componente_novo",
            "kit": "kit",
            "n_trafo": "n_trafo",
            "dispositivo_protecao": "dispositivo_protecao",
        },
        "mensagem": "Parte dos dados de equipamentos está indisponível.",
    },
    {
        "codigo": "sap_indisponivel",
        "bloco": "sap",
        "campos": {
            "Status_SAP": "status_sap",
            "Prioridade_SAP": "prioridade_sap",
        },
        "mensagem": "Parte dos dados SAP está indisponível.",
    },
)

_ACAO_AVISO = (
    "Sincronize novamente. Se o aviso persistir, verifique a "
    "compatibilidade da fonte."
)


def _montar_aviso(bloco: dict, campos: list[str]) -> dict:
    return {
        "codigo": bloco["codigo"],
        "bloco": bloco["bloco"],
        "campos": campos,
        "mensagem": bloco["mensagem"],
        "acao": _ACAO_AVISO,
    }


def normalizar_avisos(avisos: object) -> list[dict]:
    """Reconstrói avisos públicos a partir do catálogo fixo.

    O metadado persistido guarda somente o código e os campos afetados como
    referência; mensagem, ação e bloco sempre vêm deste módulo para que
    nenhum conteúdo interno alcance o contrato.
    """
    if not isinstance(avisos, list):
        return []

    blocos_por_codigo = {
        bloco["codigo"]: bloco
        for bloco in _BLOCOS_ENRIQUECIMENTO
    }
    normalizados = []
    codigos_vistos = set()
    for aviso in avisos:
        if not isinstance(aviso, dict):
            continue
        codigo = aviso.get("codigo")
        if not isinstance(codigo, str) or codigo in codigos_vistos:
            continue
        bloco = blocos_por_codigo.get(codigo)
        campos_recebidos = aviso.get("campos")
        if bloco is None or not isinstance(campos_recebidos, list):
            continue

        campos = [
            campo_publico
            for campo_publico in bloco["campos"].values()
            if campo_publico in campos_recebidos
        ]
        if not campos:
            continue
        normalizados.append(_montar_aviso(bloco, campos))
        codigos_vistos.add(codigo)
    return normalizados


def de_para_regional(csd: str | None) -> str | None:
    if csd is None:
        return None
    return config.DE_PARA_REGIONAL.get(csd, csd)


def _texto(valor) -> str | None:
    # `valor != valor` detecta NaN (IEEE754: e o unico valor que nao e igual
    # a si mesmo) sem precisar importar pandas/numpy neste modulo puro. Sem
    # isso, DataFrame.to_dict("records") vaza float('nan') como string "nan".
    if valor is None or valor != valor:
        return None
    texto = str(valor).strip()
    return texto or None


def _inteiro(valor) -> int | None:
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def normalizar_linha(origem: dict) -> dict:
    # observacao/referencia_eletrica: colunas de negocio já existem em
    # nota_carteira (ver db.py) mas não são lidas daqui ainda — a origem
    # Databricks marca os candidatos como "avaliar" em
    # docs/dev/databricks-schema-discovery.md (nome pode ser "observacoes",
    # plural, e "referencia_fisica"/"referencia_eletrica" é um par ambíguo).
    # Confirmar o nome real da coluna lá antes de mapear pra cá.
    id_sap = _texto(origem.get("id_sap"))
    sap_real = 1 if (id_sap and id_sap != SENTINELA_SAP) else 0
    quantidade = _inteiro(origem.get("quantidade"))
    quantidade_valida = 1 if (quantidade is not None
                              and quantidade != QUANTIDADE_SENTINELA) else 0
    csd = _texto(origem.get("CSD"))
    return {
        "id_onr": _inteiro(origem.get("id_onr")),
        "id_sap": id_sap,
        "sap_real": sap_real,
        "conjunto": _texto(origem.get("conjunto")),
        "descricao_conjunto": _texto(origem.get(_COL_DESCRICAO)),
        "regional": de_para_regional(csd),
        "csd_origem": csd,
        "empresa": _texto(origem.get("EMPRESA")),
        "quantidade": quantidade,
        "quantidade_valida": quantidade_valida,
        "prioridade": _texto(origem.get("prioridade")),
        "prioridade_sap": _inteiro(origem.get("Prioridade_SAP")),
        "status_sap": _texto(origem.get("Status_SAP")),
        "data_encerramento_exec": _texto(origem.get("Data_encerramento_exec")),
        "local_instalacao": _texto(origem.get("local_instalacao")),
        "alimentador": _texto(origem.get("alimentador")),
        "executor": _texto(origem.get("executor")),
        "sintoma": _texto(origem.get("sintoma")),
        "componente_novo": _texto(origem.get("componente_novo")),
        "kit": _texto(origem.get("kit")),
        "n_trafo": _texto(origem.get("n_trafo")),
        "dispositivo_protecao": _texto(origem.get("dispositivo_protecao")),
        "latitude": _texto(origem.get("latitude")),
        "longitude": _texto(origem.get("longitude")),
    }


def normalizar_linhas(origens: list[dict]) -> tuple[list[dict], list[dict]]:
    """Normaliza o lote e relata blocos incompatíveis sem copiar a origem.

    Ausência de chave significa que o esquema não forneceu o dado. Uma chave
    presente com valor nulo continua sendo um valor válido da origem.
    """
    avisos = []
    if origens:
        for bloco in _BLOCOS_ENRIQUECIMENTO:
            campos_ausentes = [
                campo_publico
                for campo_origem, campo_publico in bloco["campos"].items()
                if any(campo_origem not in origem for origem in origens)
            ]
            if campos_ausentes:
                avisos.append(_montar_aviso(bloco, campos_ausentes))
    return [normalizar_linha(origem) for origem in origens], avisos


def hash_conteudo(nota: dict) -> str:
    """Hash estavel das colunas de negocio (o proprio dict de normalizar_linha)."""
    material = json.dumps(nota, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
