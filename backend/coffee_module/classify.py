"""Classificação de notas COFFEE a partir do id_sap (atual × anterior)."""
from coffee_module import config


def classificar(id_sap_atual, id_sap_anterior, origem=None) -> str:
    """nao_gerada | pendente | duplicada | corrigida | gerada. arquivado NÃO entra aqui.

    origem='avulsa' faz a transição pendente->SAP real classificar como
    'gerada' (não 'corrigida'). origem desconhecida mantém 'corrigida'
    (compat. retroativa)."""
    if not id_sap_atual:
        return "nao_gerada"
    if id_sap_atual == config.SAP_DUPLICATA:
        return "duplicada"
    if id_sap_atual == config.SAP_PENDENTE:
        return "pendente"
    if id_sap_anterior == config.SAP_PENDENTE and id_sap_atual != config.SAP_PENDENTE:
        return "gerada" if origem == "avulsa" else "corrigida"
    return "gerada"
