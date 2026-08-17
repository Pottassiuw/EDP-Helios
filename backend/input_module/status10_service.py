"""Serviço para análise e geração de relatórios de Notas em Status 10 (Em Planejamento)."""

import datetime
import json
import logging
import os
import pandas as pd

from input_module import config, db

logger = logging.getLogger("Status10Service")


def rotulos_resumo_status10() -> dict[str, str]:
    """Rótulos do relatório, preservando a unidade de quantidade do DDPM."""
    return {
        "Total_Planejado": "Total Planejado (un)",
        "Total_Modular": "Total Modular (R$)",
    }


def eh_status_10(val) -> bool:
    if val is None or pd.isna(val):
        return False
    val_str = str(val).strip().upper()
    return val_str.startswith("10") or "EM PLANEJAMENTO" in val_str


def obter_resumo_status10() -> dict:
    """Gera indicadores e tabela agrupada das notas em Status 10."""
    df = db.carregar_dados()
    if df.empty:
        return {
            "total_notas": 0,
            "total_planejado": 0.0,
            "total_modular": 0.0,
            "resumo_regional": [],
            "registros": [],
        }

    # Filtra apenas notas em Status 10
    df_st10 = df[df["Status_Nota"].apply(eh_status_10)].copy()
    if df_st10.empty:
        return {
            "total_notas": 0,
            "total_planejado": 0.0,
            "total_modular": 0.0,
            "resumo_regional": [],
            "registros": [],
        }

    # Converte colunas numéricas
    df_st10["Planejado_DDPM"] = pd.to_numeric(
        df_st10["Planejado_DDPM"], errors="coerce"
    ).fillna(0.0)
    if "Modular" in df_st10.columns:
        df_st10["Modular"] = pd.to_numeric(
            df_st10["Modular"], errors="coerce"
        ).fillna(0.0)
    else:
        df_st10["Modular"] = 0.0

    total_notas = len(df_st10)
    total_planejado = float(df_st10["Planejado_DDPM"].sum())
    total_modular = float(df_st10["Modular"].sum())

    # Agrupa por Regional e Conjunto
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
            Total_Planejado=("Planejado_DDPM", "sum"),
            Total_Modular=("Modular", "sum"),
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
        "total_planejado": round(total_planejado, 2),
        "total_modular": round(total_modular, 2),
        "resumo_regional": resumo_regional,
        "registros": registros,
    }


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
            "Total_Planejado": rotulos["Total_Planejado"],
            "Total_Modular": rotulos["Total_Modular"],
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
            "OneDrive",
            "Documentos",
            "Status-10-SP",
            "STATUS_10_DDPM_Macro.xlsm",
        )

    try:
        # Import tardio: pywin32 (pythoncom/win32com) só existe nas máquinas
        # Windows com Outlook — não deve quebrar o import do backend em outros
        # ambientes. Falta da dependência cai no except abaixo.
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
            f"Notas - Status 10 ({resumo_dados['total_notas']} Notas)"
        )
        message.BodyFormat = 2  # Formato HTML

        message.HTMLBody = f"""
        <html>
        <body style="font-family: sans-serif; color: #1e293b; line-height: 1.5;">
            <p>Prezados, {saudacao}!</p>
            <p>Conforme solicitado, segue resumo das <strong>{resumo_dados['total_notas']} notas em Status 10</strong> encontradas no departamento.</p>
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
            pass  # pywin32 ausente ou CoInitialize nunca chamado
