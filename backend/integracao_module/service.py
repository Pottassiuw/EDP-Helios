"""Composição COFFEE + IW28 + plano. Direção de dependência: integracao -> {coffee, input}."""
from coffee_module import config as coffee_config
from coffee_module import db as coffee_db
from input_module import db as input_db
from input_module import iw28
from input_module import service as input_service
from integracao_module import mapping


class NotaNaoEncontradaErro(Exception):
    """pk não existe no snapshot local do COFFEE (coffee.db)."""


class SapPendenteErro(Exception):
    """Nota sem SAP real — mover quebraria o cruzamento IW28."""


class JaNoPlanoErro(Exception):
    """Numero_Nota já cadastrado no plano do INPUT."""


def _sap_real(nota: dict) -> bool:
    return bool(nota.get("id_sap")) and nota["id_sap"] != coffee_config.SAP_PENDENTE


def montar_revisao(pk: int) -> dict:
    nota = coffee_db.obter_nota(pk)
    if nota is None:
        raise NotaNaoEncontradaErro(
            f"Nota {pk} não está no snapshot local do COFFEE — busque-a antes (Pendentes/Gerar).")
    sap_real = _sap_real(nota)
    registro_iw28 = iw28.obter_por_nota(nota["id_sap"]) if sap_real else None
    plano = input_db.obter_nota_plano(nota["id_sap"]) if sap_real else None
    pode_mover, motivo = True, None
    if not sap_real:
        pode_mover, motivo = False, "Nota ainda sem SAP real (pendente no COFFEE)."
    return {
        "coffee": nota,
        "iw28": registro_iw28,
        "iw28_extraida_em": iw28.extraida_em(),
        "plano": plano,
        "ja_no_plano": plano is not None,
        "proposta": mapping.montar_proposta(nota, registro_iw28),
        "avisos": mapping.avisos_proposta(nota, registro_iw28),
        "pode_mover": pode_mover,
        "motivo_bloqueio": motivo,
    }


def _carregar_validas(pks: list[int]) -> list[dict]:
    notas, nao_encontradas, pendentes = [], [], []
    for pk in pks:
        nota = coffee_db.obter_nota(pk)
        if nota is None:
            nao_encontradas.append(f"{pk}: não está no snapshot local do COFFEE")
        elif not _sap_real(nota):
            pendentes.append(f"{pk}: sem SAP real (pendente)")
        else:
            notas.append(nota)
    if nao_encontradas:
        raise NotaNaoEncontradaErro("; ".join(nao_encontradas))
    if pendentes:
        raise SapPendenteErro("; ".join(pendentes))
    return notas


def mover_para_plano(pks: list[int], campos_usuario: dict, usuario: str,
                     atualizar_existente: bool = False) -> dict:
    """Cria (ou atualiza, se pedido) registros do plano a partir de notas COFFEE.

    Lote é all-or-nothing: qualquer nota inválida aborta antes de escrever.
    """
    if atualizar_existente and len(pks) != 1:
        raise ValueError("Atualização de dados vale para uma nota por vez.")
    notas = _carregar_validas(pks)

    if atualizar_existente:
        nota = notas[0]
        if input_db.obter_nota_plano(nota["id_sap"]) is None:
            raise NotaNaoEncontradaErro(
                f"Nota {nota['id_sap']} não está no plano — não é possível atualizar.")
        registro_iw28 = iw28.obter_por_nota(nota["id_sap"])
        proposta = mapping.montar_proposta(nota, registro_iw28)
        linha = {"Numero_Nota": nota["id_sap"]}
        linha.update({c: proposta[c] for c in mapping.CAMPOS_ATUALIZAVEIS})
        linha.update({c: campos_usuario[c] for c in mapping.CAMPOS_MANUAIS if c in campos_usuario})
        resultado = input_db.aplicar_edicoes(
            [linha], usuario=usuario, campos_adicionais=("Status_Obra",))
        coffee_db.registrar_log("acao_usuario", "atualizar_no_plano", nota["pk"],
                                {"id_sap": nota["id_sap"], "campos": resultado["campos"]}, True)
        return {"inseridas": 0, "atualizadas": resultado["alteradas"]}

    ja_existem = [n for n in notas if input_db.obter_nota_plano(n["id_sap"]) is not None]
    if ja_existem:
        raise JaNoPlanoErro(
            "Já no plano: " + ", ".join(str(n["id_sap"]) for n in ja_existem))
    novas = [mapping.montar_nova_nota(n, iw28.obter_por_nota(n["id_sap"]), campos_usuario)
             for n in notas]
    inseridas = input_service.criar_notas(novas, usuario=usuario, origem="coffee")
    coffee_db.registrar_log("acao_usuario", "mover_para_plano", None,
                            {"pks": list(pks),
                             "saps": [n["id_sap"] for n in notas]}, True)
    return {"inseridas": inseridas, "atualizadas": 0}


def contar_fora_do_plano(usuario: str | None = None) -> int:
    """Notas COFFEE com SAP real, não arquivadas, ainda ausentes do plano.

    Quando usuario é informado, restringe às notas do próprio dono (ou sem dono).
    """
    candidatas = [n for n in coffee_db.listar_notas(usuario=usuario) if _sap_real(n)]
    if not candidatas:
        return 0
    df_plano = input_db.carregar_dados()
    existentes = set(df_plano["Numero_Nota"].tolist()) if not df_plano.empty else set()
    return sum(1 for n in candidatas if n["id_sap"] not in existentes)
