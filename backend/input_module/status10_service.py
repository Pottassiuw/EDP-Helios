"""Serviço para análise, extração SAP e geração de relatórios de Notas em Status 10 (Em Planejamento)."""

import datetime
import gc
import json
import logging
import os
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

    # Filtra apenas notas em Status 10 da base principal
    df_st10 = df_db[df_db["Status_Nota"].apply(eh_status_10)].copy() if not df_db.empty else pd.DataFrame()

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


def gerar_email_outlook_status10(usuario: str = "sistema") -> dict:
    """Monta o e-mail do Status 10 e abre o rascunho no Outlook do usuário."""
    resumo_dados = obter_resumo_status10()
    if resumo_dados["total_notas"] == 0:
        return {
            "ok": False,
            "mensagem": "Nenhuma nota em Status 10 encontrada para gerar o relatório.",
        }

    df_resumo = pd.DataFrame(resumo_dados["resumo_regional"])
    rotulos = rotulos_resumo_status10()
    df_resumo = df_resumo.rename(
        columns={
            "Regional": "Regional",
            "Conjunto": "Conjunto",
            "Qtd_Notas": "Qtd Notas",
            "Total_Fisico": rotulos.get("Total_Planejado", "Físico (Postes)"),
            "Total_Modular": rotulos.get("Total_Modular", "Modular Obra (R$)"),
            "Total_Custo_Ordem": "Custo Ordem SAP (R$)",
        }
    )

    tabela_html = (
        df_resumo.to_html(index=False, na_rep="")
        .replace(
            '<table border="1" class="dataframe">',
            '<table style="border: 1px solid #cbd5e1; border-collapse:'
            ' collapse; font-family: sans-serif; font-size: 13px;">',
        )
        .replace(
            "<th>",
            '<th style="border: 1px solid #cbd5e1; padding: 6px 10px;'
            ' background-color: #0f172a; color: #ffffff; text-align: left;">',
        )
        .replace(
            "<td>",
            '<td style="border: 1px solid #cbd5e1; padding: 6px 10px;">',
        )
    )

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
            f"Notas - Status 10 ({resumo_dados['total_notas']} Notas | {resumo_dados['total_fisico']} Postes)"
        )
        message.BodyFormat = 2  # Formato HTML

        message.HTMLBody = f"""
        <html>
        <body style="font-family: sans-serif; color: #1e293b; line-height: 1.5;">
            <p>Prezados, {saudacao}!</p>
            <p>Conforme solicitado, segue resumo analítico das <strong>{resumo_dados['total_notas']} notas em Status 10</strong> ({resumo_dados['total_fisico']} postes planejados) encontradas no departamento.</p>
            <br>
            {tabela_html}
            <br>
            <p>Fico à disposição caso precisem de algo mais.</p>
            <p>Atenciosamente,<br><strong>{usuario}</strong></p>
        </body>
        </html>
        """

        if os.path.exists(caminho_macro):
            message.Attachments.Add(caminho_macro)

        message.Display()
        logger.info(
            f"✅ E-mail de Status 10 gerado no Outlook por {usuario}."
        )
        return {
            "ok": True,
            "mensagem": (
                f"E-mail com {resumo_dados['total_notas']} notas em Status 10"
                " gerado com sucesso no Outlook!"
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
