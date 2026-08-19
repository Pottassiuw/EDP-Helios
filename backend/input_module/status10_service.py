"""Serviço para análise, extração SAP e geração de relatórios de Notas em Status 10 (Em Planejamento)."""

import datetime
import gc
import json
import logging
import os
import re
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional

import pandas as pd

from input_module import config, db

logger = logging.getLogger("Status10Service")


def _obter_credenciais_sap() -> tuple[str, str]:
    """Recupera usuário e senha do SAP de credenciais.json ou ambiente."""
    caminhos_cred = [
        config.data_dir() / "credenciais.json",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "credenciais.json"),
        os.path.join(os.getcwd(), "credenciais.json"),
    ]
    for c in caminhos_cred:
        if os.path.exists(c):
            try:
                with open(c, "r", encoding="utf-8") as f:
                    dados = json.load(f)
                    return str(dados.get("LOGIN_SAP", "")), str(dados.get("SENHA_SAP", ""))
            except Exception as e:
                logger.warning(f"Erro ao ler credenciais de {c}: {e}")

    return os.getenv("LOGIN_SAP", ""), os.getenv("SENHA_SAP", "")


def _converter_numero_br(valor) -> float:
    """Converte números formatados em padrão BR (1.234,56 ou 1234.56) para float."""
    if pd.isna(valor) or valor is None:
        return 0.0
    if isinstance(valor, (int, float)):
        return float(valor)
    s = str(valor).strip().upper().replace("R$", "").strip()
    if not s or s in ["-", "NAN", "NONE", "NULL"]:
        return 0.0
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except Exception:
        return 0.0


def rotulos_resumo_status10() -> dict[str, str]:
    """Rótulos do relatório, preservando a unidade de quantidade do DDPM."""
    return {
        "Total_Planejado": "Total Planejado (un)",
        "Total_Modular": "Total Modular (R$)",
    }


def eh_status_10(val) -> bool:
    """Verifica se o valor do status corresponde a Status 10."""
    if val is None or pd.isna(val):
        return False
    val_str = str(val).strip().upper()
    return val_str.startswith("10") or "EM PLANEJAMENTO" in val_str


def ano_planejado_valido(val_mes) -> bool:
    """Verifica se o ano do mês planejado é válido (exclui 2027, 9999, etc)."""
    if pd.isna(val_mes) or val_mes is None:
        return True
    v_str = str(val_mes).strip()
    match = re.search(r'\b(19\d\d|20\d\d|9999)\b', v_str)
    if match:
        ano = int(match.group(1))
        return ano <= 2026 and ano != 9999
    return True


def obter_resumo_status10() -> dict:
    """Gera indicadores e tabela analítica detalhada das notas em Status 10."""
    df_db = db.carregar_dados()

    # Tenta carregar base enriquecida previamente extraída do SAP se disponível
    caminho_base_analise = os.path.join(
        tempfile.gettempdir(), "Base_Analise_Status_10.xlsx"
    )
    pasta_status10_usuario = os.path.join(
        os.path.expanduser("~"),
        "EDP",
        "O365_Planejamento_Manutencao_EDP_Brasil - Documentos",
        "MACROS_SAP",
        "Status-10-SP",
    )
    caminho_analise_usuario = os.path.join(
        pasta_status10_usuario, "Base_Analise_Status_10.xlsx"
    )

    df_sap_enriquecido = None
    for cand in [caminho_analise_usuario, caminho_base_analise]:
        if os.path.exists(cand):
            try:
                df_sap_enriquecido = pd.read_excel(cand)
                break
            except Exception as e:
                logger.warning(f"Não foi possível ler base analítica {cand}: {e}")

    if df_db.empty and (df_sap_enriquecido is None or df_sap_enriquecido.empty):
        return {
            "total_notas": 0,
            "total_fisico": 0.0,
            "total_modular_obra": 0.0,
            "total_custo_ordem": 0.0,
            "resumo_regional": [],
            "registros": [],
        }

    # Carrega base_iw28 para verificar se notas mudaram de status no SAP (ex: 51, 50, 99, 55)
    dict_sap_status = {}
    try:
        df_sap_iw28 = db.carregar_base_dataframe("base_iw28")
        if df_sap_iw28 is not None and not df_sap_iw28.empty:
            col_n = "Nota" if "Nota" in df_sap_iw28.columns else "Numero_Nota"
            col_s = "Status usuário" if "Status usuário" in df_sap_iw28.columns else "Status_Usuario"
            if col_n in df_sap_iw28.columns and col_s in df_sap_iw28.columns:
                s_int = pd.to_numeric(df_sap_iw28[col_n], errors="coerce")
                dict_sap_status = dict(zip(s_int, df_sap_iw28[col_s].astype(str)))
    except Exception:
        pass

    # Filtra apenas notas REALMENTE em Status 10 (exclui notas com status 51/50/99/55 no SAP e anos inválidos)
    def _filtro_st10(row):
        num_nota = row.get("Numero_Nota")
        st_sap = str(dict_sap_status.get(num_nota, row.get("Status usuário", row.get("Status_Usuario", "")))).strip()
        st_nota = str(row.get("Status_Nota", "")).strip()

        # Se no SAP a nota foi para 51, 50, 99, 55, NÃO é status 10
        if st_sap.startswith("51") or st_sap.startswith("50") or st_sap.startswith("99") or st_sap.startswith("55"):
            return False
        if st_nota.startswith("51") or st_nota.startswith("50") or st_nota.startswith("99") or st_nota.startswith("55"):
            return False

        eh_10 = eh_status_10(st_sap) or eh_status_10(st_nota)
        if not eh_10:
            return False

        mes_plan = row.get("Mes_Execucao_Planejado", row.get("Mês de Execução  Planejado - DDPM"))
        return ano_planejado_valido(mes_plan)

    df_st10 = df_db[df_db.apply(_filtro_st10, axis=1)].copy() if not df_db.empty else pd.DataFrame()

    if df_sap_enriquecido is not None and not df_sap_enriquecido.empty:
        # Se temos dados do SAP enriquecidos, consolidamos com a base de notas
        col_nota_sap = "Nota" if "Nota" in df_sap_enriquecido.columns else "Numero_Nota"
        if col_nota_sap in df_sap_enriquecido.columns:
            df_sap_enriquecido["Numero_Nota"] = pd.to_numeric(
                df_sap_enriquecido[col_nota_sap], errors="coerce"
            ).fillna(0).astype(int)

            if not df_st10.empty:
                # Merge preservando campos editáveis do banco e enriquecendo com campos SAP
                cols_sap_extras = [
                    c for c in df_sap_enriquecido.columns
                    if c not in ["Numero_Nota", "Nota"] and c not in df_st10.columns
                ]
                df_st10 = df_st10.merge(
                    df_sap_enriquecido[["Numero_Nota"] + cols_sap_extras],
                    on="Numero_Nota",
                    how="left",
                )
            else:
                df_st10 = df_sap_enriquecido.copy()

    if df_st10.empty:
        return {
            "total_notas": 0,
            "total_fisico": 0.0,
            "total_modular_obra": 0.0,
            "total_custo_ordem": 0.0,
            "resumo_regional": [],
            "registros": [],
        }

    # Normalização de colunas
    if "Planejado_DDPM" in df_st10.columns:
        df_st10["Planejado_DDPM"] = df_st10["Planejado_DDPM"].apply(_converter_numero_br)
    else:
        df_st10["Planejado_DDPM"] = 0.0

    if "Modular" in df_st10.columns:
        df_st10["Modular"] = df_st10["Modular"].apply(_converter_numero_br)
    else:
        df_st10["Modular"] = 0.0

    # Modular Obra (R$) = Físico * Modular Unitário
    if "Modular_Obra" not in df_st10.columns and "Modular Obra" not in df_st10.columns:
        df_st10["Modular_Obra"] = df_st10["Planejado_DDPM"] * df_st10["Modular"]
    elif "Modular Obra" in df_st10.columns:
        df_st10["Modular_Obra"] = df_st10["Modular Obra"].apply(_converter_numero_br)

    # Custo Planejado da Ordem
    if "Custo_Plan" not in df_st10.columns and "Custo Plan" in df_st10.columns:
        df_st10["Custo_Plan"] = df_st10["Custo Plan"].apply(_converter_numero_br)
    elif "Total_planejado_ordem" in df_st10.columns:
        df_st10["Custo_Plan"] = df_st10["Total_planejado_ordem"].apply(_converter_numero_br)
    else:
        df_st10["Custo_Plan"] = 0.0

    total_notas = len(df_st10)
    total_fisico = float(df_st10["Planejado_DDPM"].sum())
    total_modular_obra = float(df_st10["Modular_Obra"].sum())
    total_custo_ordem = float(df_st10["Custo_Plan"].sum())

    if "Regional" not in df_st10.columns:
        df_st10["Regional"] = "-"
    else:
        df_st10["Regional"] = df_st10["Regional"].fillna("-")
    if "Conjunto" not in df_st10.columns:
        df_st10["Conjunto"] = "-"
    else:
        df_st10["Conjunto"] = df_st10["Conjunto"].fillna("-")

    agrupado = (
        df_st10.groupby(["Regional", "Conjunto"])
        .agg(
            Qtd_Notas=("Numero_Nota", "count"),
            Total_Fisico=("Planejado_DDPM", "sum"),
            Total_Modular=("Modular_Obra", "sum"),
            Total_Custo_Ordem=("Custo_Plan", "sum"),
        )
        .reset_index()
    )

    resumo_regional = json.loads(
        agrupado.to_json(orient="records", force_ascii=False)
    )
    registros = json.loads(
        df_st10.to_json(orient="records", force_ascii=False)
    )

    return {
        "total_notas": total_notas,
        "total_fisico": round(total_fisico, 2),
        "total_modular_obra": round(total_modular_obra, 2),
        "total_custo_ordem": round(total_custo_ordem, 2),
        "resumo_regional": resumo_regional,
        "registros": registros,
    }


def extrair_sap_status10() -> Dict[str, Any]:
    """Executa a automação SAP para extração e consolidação das Notas em Status 10."""
    login_sap, senha_sap = _obter_credenciais_sap()
    if not login_sap or not senha_sap:
        return {
            "ok": False,
            "mensagem": "Credenciais SAP não configuradas (LOGIN_SAP/SENHA_SAP ausentes em credenciais.json).",
        }

    caminho_sap_logon = r"C:\Program Files (x86)\SAP\FrontEnd\SAPgui\saplogon.exe"
    nome_sistema_sap = "P40_S4/HANA"
    criador_variante_iw28 = "703846"
    layout_iw38 = "/GALVAO"

    pasta_temp = tempfile.gettempdir()
    arquivo_iw28 = os.path.join(pasta_temp, "Gerada_base_IW29_Status10.XLSX")
    arquivo_iw38 = os.path.join(pasta_temp, "Gerada_custo_ord_IW38_Status10.XLSX")

    # Limpeza de instâncias e arquivos temporários anteriores
    try:
        subprocess.run(["taskkill", "/F", "/IM", "EXCEL.EXE"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        pass

    for fpath in [arquivo_iw28, arquivo_iw38]:
        try:
            if os.path.exists(fpath):
                os.remove(fpath)
        except Exception:
            pass

    try:
        import pythoncom
        import pyperclip
        import win32com.client

        pythoncom.CoInitialize()

        # Inicia SAP Logon se necessário
        subprocess.Popen(caminho_sap_logon)
        time.sleep(5)

        sap_gui_auto = None
        for _ in range(10):
            try:
                sap_gui_auto = win32com.client.GetObject("SAPGUI")
                if sap_gui_auto:
                    break
            except Exception:
                time.sleep(1)

        if not sap_gui_auto:
            return {"ok": False, "mensagem": "SAP GUI scripting não está disponível ou acessível."}

        application = sap_gui_auto.GetScriptingEngine
        connection = application.OpenConnection(nome_sistema_sap, True)
        session = connection.Children(0)

        # Login
        session.findById("wnd[0]/usr/txtRSYST-BNAME").text = login_sap
        session.findById("wnd[0]/usr/pwdRSYST-BCODE").text = senha_sap
        session.findById("wnd[0]").sendVKey(0)

        try:
            session.findById("wnd[1]/usr/radMULTI_LOGON_OPT2").select()
            session.findById("wnd[1]/tbar[0]/btn[0]").press()
        except Exception:
            pass

        # ── 1. Extração IW28 com Status 10 ──
        session.findById("wnd[0]/tbar[0]/okcd").text = "IW28"
        session.findById("wnd[0]").sendVKey(0)
        session.findById("wnd[0]/tbar[1]/btn[17]").press()
        session.findById("wnd[1]/usr/txtV-LOW").text = ""
        session.findById("wnd[1]/usr/txtENAME-LOW").text = criador_variante_iw28
        session.findById("wnd[1]/tbar[0]/btn[8]").press()

        # Garante apenas status 10
        pyperclip.copy("10")
        session.findById("wnd[0]/usr/btn%_STAI1_%_APP_%-VALU_PUSH").press()
        time.sleep(1)
        try:
            session.findById("wnd[1]/tbar[0]/btn[16]").press()  # Limpar
            time.sleep(1)
        except Exception:
            pass
        session.findById("wnd[1]/tbar[0]/btn[24]").press()  # Colar 10
        time.sleep(1)
        session.findById("wnd[1]/tbar[0]/btn[8]").press()
        time.sleep(1)

        # Executa consulta
        session.findById("wnd[0]/tbar[1]/btn[8]").press()
        time.sleep(5)

        # Exporta XXL
        grid = session.findById("wnd[0]/usr/cntlGRID1/shellcont/shell")
        grid.selectAll()
        grid.contextMenu()
        grid.selectContextMenuItem("&XXL")
        session.findById("wnd[1]/tbar[0]/btn[0]").press()
        session.findById("wnd[1]/usr/ctxtDY_PATH").text = pasta_temp
        session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = "Gerada_base_IW29_Status10.XLSX"
        session.findById("wnd[1]/tbar[0]/btn[0]").press()
        try:
            session.findById("wnd[1]/tbar[0]/btn[0]").press()
            session.findById("wnd[1]/tbar[0]/btn[11]").press()
        except Exception:
            pass

        session.findById("wnd[0]/tbar[0]/btn[15]").press()
        time.sleep(1)
        session.findById("wnd[0]/tbar[0]/btn[15]").press()

        # ── 2. Extração IW38 para Ordens ──
        time.sleep(3)
        try:
            subprocess.run(["taskkill", "/F", "/IM", "EXCEL.EXE"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        df_iw28 = pd.read_excel(arquivo_iw28)
        if "Ordem" in df_iw28.columns:
            orders = df_iw28["Ordem"].dropna().astype(str).str.replace(r"\.0$", "", regex=True).str.strip().tolist()
            orders = [o for o in orders if o and o != "0" and o != "-"]
            if orders:
                session.findById("wnd[0]/tbar[0]/okcd").text = "IW38"
                session.findById("wnd[0]").sendVKey(0)
                session.findById("wnd[0]/usr/chkDY_MAB").selected = True
                session.findById("wnd[0]/usr/chkDY_HIS").selected = True
                session.findById("wnd[0]/usr/ctxtDATUV").text = ""
                session.findById("wnd[0]/usr/ctxtDATUB").text = ""
                session.findById("wnd[0]/usr/ctxtVARIANT").text = layout_iw38
                pyperclip.copy("\r\n".join(orders))
                session.findById("wnd[0]/usr/btn%_AUFNR_%_APP_%-VALU_PUSH").press()
                time.sleep(2)
                session.findById("wnd[1]/tbar[0]/btn[24]").press()
                time.sleep(2)
                session.findById("wnd[1]/tbar[0]/btn[8]").press()

                session.findById("wnd[0]/tbar[1]/btn[8]").press()
                time.sleep(5)

                grid_ord = session.findById("wnd[0]/usr/cntlGRID1/shellcont/shell")
                grid_ord.selectAll()
                grid_ord.contextMenu()
                grid_ord.selectContextMenuItem("&XXL")
                session.findById("wnd[1]/tbar[0]/btn[0]").press()
                session.findById("wnd[1]/usr/ctxtDY_PATH").text = pasta_temp
                session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = "Gerada_custo_ord_IW38_Status10.XLSX"
                session.findById("wnd[1]/tbar[0]/btn[0]").press()
                try:
                    session.findById("wnd[1]/tbar[0]/btn[0]").press()
                    session.findById("wnd[1]/tbar[0]/btn[11]").press()
                except Exception:
                    pass

                session.findById("wnd[0]/tbar[0]/btn[15]").press()

        # ── 3. Consolidação e Cruzamento no Pandas ──
        try:
            subprocess.run(["taskkill", "/F", "/IM", "EXCEL.EXE"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

        df_base = pd.read_excel(arquivo_iw28)
        df_ord = pd.read_excel(arquivo_iw38) if os.path.exists(arquivo_iw38) else pd.DataFrame()
        df_notas = db.carregar_dados()
        df_modulares = db.carregar_base_dataframe("base_custo_modular")

        if not df_ord.empty and "PEP cabeçalho da ordem" in df_ord.columns:
            df_ord["PEP"] = df_ord["PEP cabeçalho da ordem"].astype(str).str[:10]
            if "Custos totais plan." in df_ord.columns:
                df_ord["Custo Plan"] = df_ord["Custos totais plan."].apply(_converter_numero_br)

        # Merge com notas cadastradas
        col_nota_base = "Nota" if "Nota" in df_base.columns else "Numero_Nota"
        df_base["Numero_Nota"] = pd.to_numeric(df_base[col_nota_base], errors="coerce").fillna(0).astype(int)

        if not df_notas.empty:
            cols_notas = [c for c in ["Numero_Nota", "Regional", "Planejado_DDPM", "Mes_Execucao_Planejado", "Observacao", "Prioridade_Nota"] if c in df_notas.columns]
            df_base = df_base.merge(df_notas[cols_notas], on="Numero_Nota", how="left")

        # Merge com ordens
        if not df_ord.empty and "Ordem" in df_base.columns and "Ordem" in df_ord.columns:
            df_base["Ordem_Str"] = df_base["Ordem"].astype(str).str.replace(r"\.0$", "", regex=True).str.strip()
            df_ord["Ordem_Str"] = df_ord["Ordem"].astype(str).str.replace(r"\.0$", "", regex=True).str.strip()
            cols_ord = [c for c in ["Ordem_Str", "Custo Plan", "PEP"] if c in df_ord.columns]
            df_base = df_base.merge(df_ord[cols_ord], on="Ordem_Str", how="left").drop(columns=["Ordem_Str"], errors="ignore")

        # Merge com custos modulares
        if df_modulares is not None and not df_modulares.empty:
            df_modulares.columns = df_modulares.columns.astype(str).str.strip()
            col_conj = [c for c in df_modulares.columns if "Conjunto" in c]
            col_mod = [c for c in df_modulares.columns if "Custo Modular" in c or "Modular" in c]
            if col_conj and col_mod:
                dict_mod = dict(zip(
                    df_modulares[col_conj[0]].astype(str).str.strip().str.upper(),
                    df_modulares[col_mod[0]].apply(_converter_numero_br)
                ))
                col_busca = "Denominação do conjunto" if "Denominação do conjunto" in df_base.columns else "Conjunto"
                if col_busca in df_base.columns:
                    df_base["Modular"] = df_base[col_busca].astype(str).str.strip().str.upper().map(dict_mod).fillna(0.0)

        if "Planejado_DDPM" in df_base.columns and "Modular" in df_base.columns:
            df_base["Planejado_DDPM"] = df_base["Planejado_DDPM"].apply(_converter_numero_br)
            df_base["Modular"] = df_base["Modular"].apply(_converter_numero_br)
            df_base["Modular Obra"] = df_base["Planejado_DDPM"] * df_base["Modular"]

        # Salva o arquivo analítico consolidado
        caminho_salvar_analise = os.path.join(tempfile.gettempdir(), "Base_Analise_Status_10.xlsx")
        df_base.to_excel(caminho_salvar_analise, index=False)

        # Salva também na pasta padrão do OneDrive/Rede se acessível
        try:
            os.makedirs(pasta_status10_usuario, exist_ok=True)
            df_base.to_excel(os.path.join(pasta_status10_usuario, "Base_Analise_Status_10.xlsx"), index=False)
        except Exception:
            pass

        return {
            "ok": True,
            "mensagem": f"Extração SAP de Status 10 concluída com sucesso ({len(df_base)} notas processadas)!",
            "total_notas": len(df_base),
        }

    except Exception as e:
        logger.error(f"Erro na extração SAP de Status 10: {e}")
        return {"ok": False, "mensagem": f"Falha na extração SAP: {e}"}
    finally:
        try:
            import pythoncom
            pythoncom.CoUninitialize()
        except Exception:
            pass


def _formatar_moeda_br(val: Any) -> str:
    if val is None or pd.isna(val) or str(val).strip() in ["", "-", "None", "nan"]:
        return "R$ 0,00"
    try:
        f = float(val)
        return f"R$ {f:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return str(val)


def _formatar_numero_br(val: Any, casas: int = 2) -> str:
    if val is None or pd.isna(val) or str(val).strip() in ["", "-", "None", "nan"]:
        return "0,00"
    try:
        f = float(val)
        s = f"{f:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")
        return s
    except Exception:
        return str(val)


def _montar_tabelas_email_status10(resumo_dados: dict) -> tuple[str, str]:
    """Gera o HTML da tabela de resumo consolidado e da tabela de desvios relevantes de custo."""
    rotulos = rotulos_resumo_status10()
    rotulo_fisico = rotulos.get("Total_Planejado", "Total Planejado (un)")
    rotulo_modular = rotulos.get("Total_Modular", "Total Modular (R$)")

    # ── 1. Tabela de Resumo Consolidado por Regional e Conjunto ──
    resumo_linhas = resumo_dados.get("resumo_regional", [])
    total_notas = resumo_dados.get("total_notas", 0)
    total_fisico = resumo_dados.get("total_fisico", 0.0)
    total_modular = resumo_dados.get("total_modular_obra", 0.0)
    total_custo_ordem = resumo_dados.get("total_custo_ordem", 0.0)
    total_dif = total_custo_ordem - total_modular
    total_desvio_pct = (total_dif / total_modular * 100) if total_modular > 0 else 0.0

    html_resumo = [
        '<table style="border: 1px solid #cbd5e1; border-collapse: collapse; font-family: Segoe UI, Arial, sans-serif; font-size: 12.5px; width: 100%; max-width: 920px;">'
    ]
    html_resumo.append('<thead><tr style="background-color: #0f172a; color: #ffffff;">')
    html_resumo.append('<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left;">Regional</th>')
    html_resumo.append('<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left;">Conjunto</th>')
    html_resumo.append('<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: center;">Qtd Notas</th>')
    html_resumo.append(f'<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: right;">{rotulo_fisico}</th>')
    html_resumo.append(f'<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: right;">{rotulo_modular}</th>')
    html_resumo.append('<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: right;">Custo Ordem SAP (R$)</th>')
    html_resumo.append('<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: right;">Diferença (R$)</th>')
    html_resumo.append('<th style="border: 1px solid #cbd5e1; padding: 7px 10px; text-align: right;">Desvio (%)</th>')
    html_resumo.append('</tr></thead><tbody>')

    for idx, r in enumerate(resumo_linhas):
        bg = "#f8fafc" if idx % 2 == 1 else "#ffffff"
        reg = r.get("Regional", "-")
        conj = r.get("Conjunto", "-")
        qtd = r.get("Qtd_Notas", 0)
        fis = float(r.get("Total_Fisico", 0) or 0)
        mod = float(r.get("Total_Modular", 0) or 0)
        ordem = float(r.get("Total_Custo_Ordem", 0) or 0)
        dif = ordem - mod
        pct = (dif / mod * 100) if mod > 0 else (100.0 if ordem > 0 else 0.0)
        cor_dif = "#b91c1c" if dif > 500 else ("#1d4ed8" if dif < -500 else "#334155")
        sinal = "+" if pct > 0 else ""

        html_resumo.append(f'<tr style="background-color: {bg};">')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px;">{reg}</td>')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-weight: 500;">{conj}</td>')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: center;">{qtd}</td>')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">{_formatar_numero_br(fis, 2)}</td>')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">{_formatar_moeda_br(mod)}</td>')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right;">{_formatar_moeda_br(ordem)}</td>')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right; color: {cor_dif}; font-weight: 600;">{_formatar_moeda_br(dif)}</td>')
        html_resumo.append(f'<td style="border: 1px solid #cbd5e1; padding: 6px 10px; text-align: right; color: {cor_dif};">{sinal}{pct:.1f}%</td>')
        html_resumo.append('</tr>')

    sinal_tot = "+" if total_desvio_pct > 0 else ""
    html_resumo.append('<tr style="background-color: #0f172a; color: #ffffff; font-weight: bold; border-top: 2px solid #0f172a;">')
    html_resumo.append('<td colspan="2" style="border: 1px solid #334155; padding: 8px 10px; text-align: left; text-transform: uppercase;">TOTAL GERAL</td>')
    html_resumo.append(f'<td style="border: 1px solid #334155; padding: 8px 10px; text-align: center;">{total_notas}</td>')
    html_resumo.append(f'<td style="border: 1px solid #334155; padding: 8px 10px; text-align: right;">{_formatar_numero_br(total_fisico, 2)}</td>')
    html_resumo.append(f'<td style="border: 1px solid #334155; padding: 8px 10px; text-align: right;">{_formatar_moeda_br(total_modular)}</td>')
    html_resumo.append(f'<td style="border: 1px solid #334155; padding: 8px 10px; text-align: right;">{_formatar_moeda_br(total_custo_ordem)}</td>')
    html_resumo.append(f'<td style="border: 1px solid #334155; padding: 8px 10px; text-align: right;">{_formatar_moeda_br(total_dif)}</td>')
    html_resumo.append(f'<td style="border: 1px solid #334155; padding: 8px 10px; text-align: right;">{sinal_tot}{total_desvio_pct:.1f}%</td>')
    html_resumo.append('</tr></tbody></table>')
    tabela_resumo_html = "".join(html_resumo)

    # ── 2. Tabela de Notas Individuais com Divergência Significativa ──
    df_registros = pd.DataFrame(resumo_dados.get("registros", []))
    desvios = []
    if not df_registros.empty:
        col_denom = [c for c in df_registros.columns if "Denomina" in c or "denomina" in c.lower()]
        for _, r in df_registros.iterrows():
            nota = r.get("Numero_Nota", r.get("Nota", "-"))
            ordem = str(r.get("Ordem", "-")).replace(".0", "").strip()
            conj = r.get(col_denom[0], r.get("Conjunto", "-")) if col_denom else r.get("Conjunto", "-")
            reg = r.get("Regional", "-")
            fis = float(r.get("Planejado_DDPM", 0) or 0)
            mod = float(r.get("Modular_Obra", 0) or 0)
            custo_ord = float(r.get("Custo_Plan", 0) or 0)
            dif = custo_ord - mod
            pct = (dif / mod * 100) if mod > 0 else (100.0 if custo_ord > 0 else 0.0)

            # Filtra notas com divergência relevante (> R$ 1.500 ou desvio relativo >= 15%)
            if abs(dif) > 1500 or (mod > 0 and abs(pct) >= 15):
                desvios.append({
                    "nota": nota,
                    "ordem": ordem,
                    "regional": reg,
                    "conjunto": conj,
                    "fisico": fis,
                    "mod": mod,
                    "custo_ord": custo_ord,
                    "dif": dif,
                    "pct": pct,
                    "abs_dif": abs(dif),
                    "desc": str(r.get("Descricao", r.get("Descrição", r.get("Observacao", "")))).strip(),
                })

    desvios.sort(key=lambda x: x["abs_dif"], reverse=True)

    if desvios:
        html_desv = [
            '<div style="margin-top: 24px;">',
            '<h3 style="font-size: 13.5px; color: #0f172a; margin-bottom: 6px;">⚠️ Notas com Divergência Significativa de Custos (Modular DDPM vs Ordem SAP):</h3>',
            '<p style="font-size: 12px; color: #64748b; margin-top: 0; margin-bottom: 10px;">Notas com variação superior a R$ 1.500 ou desvio relativo acima de 15% entre o custo modular de engenharia e o orçamento da ordem SAP.</p>',
            '<table style="border: 1px solid #cbd5e1; border-collapse: collapse; font-family: Segoe UI, Arial, sans-serif; font-size: 12px; width: 100%; max-width: 950px;">',
            '<thead><tr style="background-color: #1e293b; color: #ffffff;">',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">Nº Nota</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: center;">Ordem SAP</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left;">Conjunto</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right;">Físico (un)</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right;">Modular DDPM</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right;">Ordem SAP</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right;">Diferença (R$)</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right;">Desvio (%)</th>',
            '<th style="border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left;">Descrição / Observação</th>',
            '</tr></thead><tbody>',
        ]

        for d in desvios:
            bg = "#fff7ed" if d["dif"] > 0 else "#f0fdf4"
            cor_dif = "#c2410c" if d["dif"] > 0 else "#15803d"
            sinal = "+" if d["pct"] > 0 else ""
            desc_text = d["desc"] if d["desc"] and d["desc"] != "nan" and d["desc"] != "None" else "-"

            html_desv.append(f'<tr style="background-color: {bg};">')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; font-weight: 600; font-family: monospace;">{d["nota"]}</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: center; font-family: monospace;">{d["ordem"]}</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px;">{d["conjunto"]}</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right;">{_formatar_numero_br(d["fisico"], 2)}</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right;">{_formatar_moeda_br(d["mod"])}</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right; font-weight: 500;">{_formatar_moeda_br(d["custo_ord"])}</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right; font-weight: 700; color: {cor_dif};">{_formatar_moeda_br(d["dif"])}</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; text-align: right; font-weight: 600; color: {cor_dif};">{sinal}{d["pct"]:.1f}%</td>')
            html_desv.append(f'<td style="border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 11px; color: #475569;">{desc_text}</td>')
            html_desv.append('</tr>')

        html_desv.append('</tbody></table></div>')
        tabela_desvios_html = "".join(html_desv)
    else:
        tabela_desvios_html = '<p style="color: #16a34a; font-size: 12.5px; margin: 12px 0;"><strong>✅ Nenhuma divergência crítica identificada entre os custos modulares e os orçamentos das ordens SAP.</strong></p>'

    return tabela_resumo_html, tabela_desvios_html


def gerar_email_outlook_status10(usuario: str = "sistema") -> dict:
    """Monta o e-mail do Status 10 com resumo executivo e notas com divergências de custos, abrindo o rascunho no Outlook."""
    resumo_dados = obter_resumo_status10()
    if resumo_dados["total_notas"] == 0:
        return {
            "ok": False,
            "mensagem": "Nenhuma nota em Status 10 encontrada para gerar o relatório.",
        }

    tabela_resumo_html, tabela_desvios_html = _montar_tabelas_email_status10(resumo_dados)

    caminho_macro = str(config.data_dir() / "STATUS_10_DDPM_Macro.xlsm")
    if not os.path.exists(caminho_macro):
        caminho_macro = os.path.join(
            os.path.expanduser("~"),
            "EDP",
            "O365_Planejamento_Manutencao_EDP_Brasil - Documentos",
            "MACROS_SAP",
            "Status-10-SP",
            "STATUS_10_DDPM_Macro.xlsm",
        )

    caminho_base_analise = os.path.join(tempfile.gettempdir(), "Base_Analise_Status_10.xlsx")

    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        message = outlook.CreateItem(0)

        hora = datetime.datetime.now().hour
        saudacao = (
            "bom dia" if 6 <= hora < 12 else ("boa tarde" if 12 <= hora < 18 else "boa noite")
        )

        message.To = "james.junior@edp.com; fabricio.viana@edp.com"
        message.CC = "danilop.vilela@edp.com; felipeg.bezerra@edp.com"
        message.Subject = (
            f"Notas - Status 10 ({resumo_dados['total_notas']} Notas | {_formatar_numero_br(resumo_dados['total_fisico'])} Postes)"
        )
        message.BodyFormat = 2  # Formato HTML

        message.HTMLBody = f"""
        <html>
        <body style="font-family: Segoe UI, Arial, sans-serif; color: #1e293b; line-height: 1.5; font-size: 13px;">
            <p>Prezados, {saudacao}!</p>
            <p>Conforme solicitado, segue resumo analítico das <strong>{resumo_dados['total_notas']} notas em Status 10</strong> ({_formatar_numero_br(resumo_dados['total_fisico'])} postes planejados) encontradas no departamento.</p>
            <br>
            {tabela_resumo_html}
            {tabela_desvios_html}
            <br>
            <p>Fico à disposição caso precisem de algo mais.</p>
            <p>Atenciosamente,<br><strong>{usuario}</strong></p>
        </body>
        </html>
        """

        if os.path.exists(caminho_macro):
            message.Attachments.Add(caminho_macro)
        elif os.path.exists(caminho_base_analise):
            message.Attachments.Add(caminho_base_analise)

        message.Display()
        logger.info(
            f"✅ E-mail de Status 10 gerado no Outlook por {usuario}."
        )
        return {
            "ok": True,
            "mensagem": (
                f"E-mail com {resumo_dados['total_notas']} notas em Status 10"
                " e análise de desvios gerado com sucesso no Outlook!"
            ),
        }

    except Exception as e:
        logger.error(f"Erro ao interagir com Outlook: {e}")
        return {
            "ok": False,
            "mensagem": f"Não foi possível abrir o Outlook: {e}",
        }
    finally:
        try:
            import pythoncom
            pythoncom.CoUninitialize()
        except Exception:
            pass
