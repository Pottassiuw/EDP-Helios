"""Agregação do dashboard do Plano de Recomposição (funções puras).

Regras:
- Executado: código exato 99 em Status_Final; Status_Nota é fallback quando
  Status_Final está ausente; Export_status == "ENCE EXEC" é preservado.
- Com data SAP válida, execução usa o mês real. Sem data, usa o mês planejado
  e incrementa avisos.executadas_sem_data.
"""
import re

import pandas as pd

from input_module import config
from input_module.engine import meses_pt_rev as MESES_ABREV, parse_data_encerramento

MESES_NOME = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
              "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
REGIONAIS_CSD = ["Guaratinguetá", "Guarulhos", "Litoral Norte",
                 "Mogi das Cruzes", "Poa/Suzano", "São José dos Campos"]
_PREFIXOS_POA_SUZANO = {"155", "160", "165", "170"}
PLANO_RAMAL = "RAMAL"


def _mes_de_execucao(valor) -> tuple[int | None, int | None]:
    """'jul-2026' -> (7, 2026); tolera vazio/lixo -> (None, None)."""
    s = str(valor or "").strip().lower()
    if "-" not in s:
        return None, None
    abrev, _, ano = s.partition("-")
    mes = MESES_ABREV.get(abrev)
    try:
        return mes, int(ano)
    except ValueError:
        return None, None


def _regional_csd_nota(row) -> str:
    csd = str(row.get("Regional_CSD") or "-").strip()
    if csd not in ("-", "", "nan"):
        return csd
    return str(row.get("Regional") or "-").strip()


def _regional_csd_ramal(local) -> str:
    prefixo = str(local or "")[:3]
    if prefixo in _PREFIXOS_POA_SUZANO:
        return "Poa/Suzano"
    return config.DE_PARA_REGIONAL.get(prefixo, "-")


def _status_99(valor) -> bool:
    if pd.isna(valor):
        return False
    texto = str(valor).strip()
    return re.fullmatch(r"99(?:\.0+)?(?:\s+.*)?", texto) is not None


def _valor_preenchido(valor) -> bool:
    if pd.isna(valor):
        return False
    return str(valor).strip().lower() not in ("", "-", "nan", "none")


def _executada(row) -> bool:
    status_final = row.get("Status_Final")
    status_99 = (
        _status_99(status_final)
        if _valor_preenchido(status_final)
        else _status_99(row.get("Status_Nota"))
    )
    status_textual = str(row.get("Export_status") or "").strip().upper()
    return status_99 or status_textual == "ENCE EXEC"


def _linhas_fato(df_notas: pd.DataFrame, df_ramal: pd.DataFrame, ano: int) -> pd.DataFrame:
    """Normaliza notas+ramal em um fato único: plano, regional, mes, qtd, exec_mes."""
    fatos = []
    for _, row in df_notas.iterrows():
        mes, ano_exec = _mes_de_execucao(row.get("Mes_Execucao_Planejado"))
        if ano_exec != ano or mes is None:
            continue
        enc = parse_data_encerramento(row.get("Encerram.por data"))
        executada = _executada(row)
        exec_mes = None
        executada_sem_data = False
        if executada and enc is not None and enc.year == ano:
            exec_mes = int(enc.month)
        elif executada and enc is None:
            exec_mes = mes
            executada_sem_data = True
        fatos.append({
            "plano": str(row.get("Conjunto") or "-").strip(),
            "regional": _regional_csd_nota(row),
            "mes": mes,
            "qtd": float(row.get("Planejado_DDPM") or 0),
            "exec_mes": exec_mes,
            "executada_sem_data": executada_sem_data,
        })
    for _, row in df_ramal.iterrows():
        mes, ano_exec = _mes_de_execucao(row.get("Mes_Execucao_Planejado"))
        if ano_exec != ano or mes is None:
            continue
        executada = _executada(row)
        fatos.append({
            "plano": PLANO_RAMAL,
            "regional": _regional_csd_ramal(row.get("Local_Instalacao")),
            "mes": mes,
            "qtd": float(row.get("Planejado_DDPM") or 0),
            # ramal não tem Encerram.por data: executado cai no mês planejado
            "exec_mes": mes if executada else None,
            "executada_sem_data": executada,
        })
    if not fatos:
        return pd.DataFrame(columns=[
            "plano", "regional", "mes", "qtd", "exec_mes",
            "executada_sem_data",
        ])
    return pd.DataFrame(fatos)


def _pct(carteira: float, meta: float) -> float | None:
    return None if meta == 0 else carteira / meta


def montar_dashboard(df_notas: pd.DataFrame, df_ramal: pd.DataFrame,
                     df_metas: pd.DataFrame, df_depara: pd.DataFrame,
                     df_postergacoes: pd.DataFrame,
                     ano: int, mes_referencia: int, regional: str | None) -> dict:
    fato = _linhas_fato(df_notas, df_ramal, ano)
    depara = df_depara.set_index("Plano") if not df_depara.empty else pd.DataFrame()
    metas = df_metas

    def soma_fato(f, por_mes=None, so_exec=False):
        if f.empty:
            return 0.0
        m = f
        if por_mes is not None:
            m = m[m["exec_mes"] == por_mes] if so_exec else m[m["mes"] == por_mes]
        elif so_exec:
            m = m[m["exec_mes"].notna()]
        return float(m["qtd"].sum())

    fato_f = fato if regional is None else fato[fato["regional"] == regional]
    avisos = {
        "executadas_sem_data": (
            int(fato_f["executada_sem_data"].sum()) if not fato_f.empty else 0
        ),
    }
    metas_f = metas if regional is None else metas[metas["Regional"] == regional]
    post_f = (df_postergacoes if regional is None
              else df_postergacoes[df_postergacoes["Regional"] == regional])
    hero_postergadas = (float(post_f[post_f["Mes"] == mes_referencia]["Qtd"].sum())
                        if not post_f.empty else 0.0)
    post_por_plano = (post_f.groupby("Plano")["Qtd"].sum().to_dict()
                      if not post_f.empty else {})

    def modular(plano: str) -> float:
        try:
            return float(depara.loc[plano, "Modular_RS"])
        except KeyError:
            return 0.0

    def rs(f_plano_qtd: dict) -> float:
        return sum(q * modular(p) for p, q in f_plano_qtd.items())

    # ── hero do mês ──────────────────────────────────────────────────
    cart_mes_por_plano = (fato_f[fato_f["mes"] == mes_referencia]
                          .groupby("plano")["qtd"].sum().to_dict()) if not fato_f.empty else {}
    meta_mes_por_plano = (metas_f[metas_f["Mes"] == mes_referencia]
                          .groupby("Plano")["Meta"].sum().to_dict()) if not metas_f.empty else {}
    hero_carteira = sum(cart_mes_por_plano.values())
    hero_meta = sum(meta_mes_por_plano.values())
    hero = {
        "mes_nome": MESES_NOME[mes_referencia - 1],
        "meta": hero_meta, "carteira": hero_carteira,
        "executado": soma_fato(fato_f, por_mes=mes_referencia, so_exec=True),
        "pct_disp": _pct(hero_carteira, hero_meta),
        "meta_rs": rs(meta_mes_por_plano), "carteira_rs": rs(cart_mes_por_plano),
        "postergadas": hero_postergadas,
    }

    # ── visão anual por plano ────────────────────────────────────────
    cart_por_plano = fato_f.groupby("plano")["qtd"].sum().to_dict() if not fato_f.empty else {}
    meta_por_plano = metas_f.groupby("Plano")["Meta"].sum().to_dict() if not metas_f.empty else {}
    planos = set(cart_por_plano) | set(meta_por_plano) | set(post_por_plano)
    linhas = []
    for plano in planos:
        cart = cart_por_plano.get(plano, 0.0)
        meta = meta_por_plano.get(plano, 0.0)
        if plano in depara.index:
            info = depara.loc[plano]
            nome, area, unidade = str(info["Nome_Curto"]), str(info["Area"]), str(info["Unidade"])
            ordem = int(info["Ordem_Exibicao"])
        else:
            nome, area, unidade, ordem = plano, "Outros", "-", 9999
        linhas.append({
            "plano": plano, "nome_curto": nome, "area": area, "unidade": unidade,
            "meta": meta, "carteira": cart, "saldo": cart - meta,
            "pct_disp": _pct(cart, meta), "gap_rs": (cart - meta) * modular(plano),
            "postergado": post_por_plano.get(plano, 0.0),
            "_ordem": ordem,
        })
    ordem_area = {"Construção": 0, "CSD": 1, "Outros": 2}
    linhas.sort(key=lambda l: (ordem_area.get(l["area"], 3), l["_ordem"], l["plano"]))
    for l in linhas:
        l.pop("_ordem")

    # ── mensalização ─────────────────────────────────────────────────
    mensalizacao = [{
        "mes": m,
        "meta": float(metas_f[metas_f["Mes"] == m]["Meta"].sum()) if not metas_f.empty else 0.0,
        "carteira": soma_fato(fato_f, por_mes=m),
        "executado": soma_fato(fato_f, por_mes=m, so_exec=True),
    } for m in range(1, 13)]

    # ── regionais (mês corrente; sempre as 6, sem filtro de regional) ──
    fato_mes = fato[fato["mes"] == mes_referencia]
    metas_mes = metas[metas["Mes"] == mes_referencia]
    cart_por_regional = fato_mes.groupby("regional")["qtd"].sum().to_dict() if not fato_mes.empty else {}
    meta_por_regional = metas_mes.groupby("Regional")["Meta"].sum().to_dict() if not metas_mes.empty else {}
    regionais = []
    for reg in REGIONAIS_CSD:
        cart = cart_por_regional.get(reg, 0.0)
        meta = meta_por_regional.get(reg, 0.0)
        regionais.append({"regional": reg, "meta": meta, "carteira": cart,
                          "saldo": cart - meta, "pct_disp": _pct(cart, meta)})

    # ── financeiro do ano ────────────────────────────────────────────
    fin = {"meta_rs": rs(meta_por_plano), "carteira_rs": rs(cart_por_plano)}
    fin["gap_rs"] = fin["carteira_rs"] - fin["meta_rs"]

    return {"ano": ano, "mes_referencia": mes_referencia, "regional": regional,
            "hero": hero, "visao_anual": linhas, "mensalizacao": mensalizacao,
            "regionais": regionais, "financeiro_ano": fin, "avisos": avisos}
