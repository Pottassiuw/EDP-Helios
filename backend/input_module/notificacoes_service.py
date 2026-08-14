import datetime
import logging
import os
import pandas as pd
from input_module import db

logger = logging.getLogger("NotificacoesService")


def _extrair_data_str(dt_val) -> str:
    if dt_val is None or pd.isna(dt_val):
        return ""
    if isinstance(dt_val, (datetime.date, datetime.datetime)):
        return dt_val.strftime("%Y-%m-%d")
    s = str(dt_val).strip()
    return s[:10] if len(s) >= 10 else s


def obter_resumo_alteracoes_diarias(data_referencia: str | None = None) -> dict:
    """Consolida as alterações do log por Engenheiro e Regional para a data de referência (padrão: hoje)."""
    if not data_referencia:
        data_referencia = datetime.date.today().isoformat()

    df_logs = db.carregar_logs()
    df_notas = db.carregar_dados()
    de_para_resp = db.carregar_responsaveis()
    emails_resp = db.carregar_emails_responsaveis()

    if df_logs.empty:
        return {
            "data_referencia": data_referencia,
            "total_alteracoes": 0,
            "total_notas_afetadas": 0,
            "engenheiros": {},
        }

    # Filtra logs pela data de referência
    df_logs["Data_Str"] = df_logs["Data_Hora"].apply(_extrair_data_str)
    df_dia = df_logs[df_logs["Data_Str"] == data_referencia].copy()

    # Dicionário de metadados das notas (Regional, Conjunto, Circuito, etc.)
    dict_notas = {}
    if not df_notas.empty:
        for _, row in df_notas.iterrows():
            num = int(row["Numero_Nota"]) if pd.notna(row["Numero_Nota"]) else None
            if num:
                dict_notas[num] = {
                    "Regional": str(row.get("Regional", "-") or "-").strip(),
                    "Conjunto": str(row.get("Conjunto", "-") or "-").strip(),
                    "Circuito": str(row.get("Circuito", "-") or "-").strip(),
                    "Local_Instalacao": str(row.get("Local_Instalacao", "-") or "-").strip(),
                }

    # Inicializa estrutura para todos os engenheiros conhecidos
    engenheiros_map: dict[str, dict] = {}
    for eng in set(de_para_resp.values()):
        if eng and eng != "-":
            reg_list = [r for r, e in de_para_resp.items() if e == eng]
            engenheiros_map[eng] = {
                "engenheiro": eng,
                "email": emails_resp.get(eng, ""),
                "regionais": reg_list,
                "total_alteracoes": 0,
                "total_notas_afetadas": 0,
                "notas_afetadas": [],
                "alteracoes": [],
            }

    if df_dia.empty:
        return {
            "data_referencia": data_referencia,
            "total_alteracoes": 0,
            "total_notas_afetadas": 0,
            "engenheiros": engenheiros_map,
        }

    for _, row in df_dia.iterrows():
        try:
            num_nota = int(row["Numero_Nota"])
        except (ValueError, TypeError):
            continue

        info_nota = dict_notas.get(num_nota, {})
        regional = info_nota.get("Regional", "-")
        conjunto = info_nota.get("Conjunto", "-")
        circuito = info_nota.get("Circuito", "-")

        # Determina o engenheiro responsável pela regional da nota
        engenheiro = de_para_resp.get(regional, "Não Definido")
        if engenheiro not in engenheiros_map:
            engenheiros_map[engenheiro] = {
                "engenheiro": engenheiro,
                "email": emails_resp.get(engenheiro, ""),
                "regionais": [regional] if regional != "-" else [],
                "total_alteracoes": 0,
                "total_notas_afetadas": 0,
                "notas_afetadas": [],
                "alteracoes": [],
            }

        campo = str(row.get("Campo_Alterado", "-"))
        antigo = str(row.get("Valor_Antigo", "-"))
        novo = str(row.get("Valor_Novo", "-"))
        usuario = str(row.get("Usuario", "sistema"))
        dt_hora_str = str(row.get("Data_Hora", ""))

        # Classificação do tipo de evento
        if campo == "Nota_Mae":
            tipo_evento = "Vínculo / Hierarquia"
            detalhe = f"Nota Mãe alterada de '{antigo}' para '{novo}'"
        elif campo == "CRIAÇÃO DE NOTA":
            tipo_evento = "Criação de Nota"
            detalhe = novo
        elif campo == "EXCLUSÃO DE NOTA":
            tipo_evento = "Exclusão de Nota"
            detalhe = "Nota removida do plano"
        else:
            tipo_evento = "Edição de Campo"
            detalhe = f"{campo}: '{antigo}' ➔ '{novo}'"

        item = {
            "ID_Log": int(row.get("ID_Log", 0)) if pd.notna(row.get("ID_Log")) else 0,
            "Numero_Nota": num_nota,
            "Regional": regional,
            "Conjunto": conjunto,
            "Circuito": circuito,
            "Tipo_Evento": tipo_evento,
            "Campo_Alterado": campo,
            "Valor_Antigo": antigo,
            "Valor_Novo": novo,
            "Detalhe": detalhe,
            "Usuario": usuario,
            "Data_Hora": dt_hora_str,
        }

        eng_entry = engenheiros_map[engenheiro]
        eng_entry["total_alteracoes"] += 1
        if num_nota not in eng_entry["notas_afetadas"]:
            eng_entry["notas_afetadas"].append(num_nota)
        eng_entry["alteracoes"].append(item)

    for eng, dados in engenheiros_map.items():
        dados["total_notas_afetadas"] = len(dados["notas_afetadas"])

    total_alt = sum(d["total_alteracoes"] for d in engenheiros_map.values())
    total_notas_af = len({n for d in engenheiros_map.values() for n in d["notas_afetadas"]})

    return {
        "data_referencia": data_referencia,
        "total_alteracoes": total_alt,
        "total_notas_afetadas": total_notas_af,
        "engenheiros": engenheiros_map,
    }


def gerar_email_outlook_engenheiro(engenheiro: str, data_referencia: str | None = None, usuario: str = "sistema") -> dict:
    """Gera o rascunho de e-mail diário para um engenheiro específico no Outlook."""
    resumo = obter_resumo_alteracoes_diarias(data_referencia)
    dados_eng = resumo["engenheiros"].get(engenheiro)

    if not dados_eng or dados_eng["total_alteracoes"] == 0:
        return {
            "ok": False,
            "mensagem": f"Nenhuma alteração registrada hoje para as regionais do engenheiro {engenheiro}.",
        }

    email_to = dados_eng.get("email") or ""
    regionais_str = ", ".join(dados_eng["regionais"]) or "Geral"
    total_notas = dados_eng["total_notas_afetadas"]
    total_alt = dados_eng["total_alteracoes"]

    # Monta tabela HTML elegante
    linhas_tr = []
    for item in dados_eng["alteracoes"]:
        tipo_badge = item["Tipo_Evento"]
        cor_badge = "#0284c7"  # azul
        if "Criação" in tipo_badge:
            cor_badge = "#16a34a"  # verde
        elif "Exclusão" in tipo_badge:
            cor_badge = "#dc2626"  # vermelho
        elif "Hierarquia" in tipo_badge or "Vínculo" in tipo_badge:
            cor_badge = "#7c3aed"  # roxo

        badge_html = f'<span style="background-color: {cor_badge}; color: #ffffff; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: bold;">{tipo_badge}</span>'

        linhas_tr.append(f"""
        <tr>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-family: monospace; font-weight: bold;">{item['Numero_Nota']}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">{item['Regional']}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">{item['Conjunto']}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">{badge_html}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px;">{item['Detalhe']}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 12px; color: #475569;">{item['Usuario']}</td>
            <td style="border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 11.5px; color: #64748b;">{item['Data_Hora'][:16]}</td>
        </tr>
        """)

    tabela_html = f"""
    <table style="border: 1px solid #cbd5e1; border-collapse: collapse; width: 100%; font-family: sans-serif; font-size: 13px;">
        <thead>
            <tr style="background-color: #0f172a; color: #ffffff;">
                <th style="border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;">Nº Nota</th>
                <th style="border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;">Regional</th>
                <th style="border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;">Conjunto</th>
                <th style="border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;">Tipo</th>
                <th style="border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;">Alteração Realizada</th>
                <th style="border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;">Responsável</th>
                <th style="border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left;">Data/Hora</th>
            </tr>
        </thead>
        <tbody>
            {''.join(linhas_tr)}
        </tbody>
    </table>
    """

    try:
        import pythoncom
        import win32com.client

        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        message = outlook.CreateItem(0)

        hora = datetime.datetime.now().hour
        saudacao = "bom dia" if 6 <= hora < 12 else ("boa tarde" if 12 <= hora < 18 else "boa noite")

        message.To = email_to
        message.CC = "felipeg.bezerra@edp.com"
        message.Subject = f"Resumo Diário de Alterações em Notas - {engenheiro} ({regionais_str}) - {resumo['data_referencia']}"
        message.BodyFormat = 2  # Formato HTML

        message.HTMLBody = f"""
        <html>
        <body style="font-family: sans-serif; color: #1e293b; line-height: 1.5;">
            <p>Olá, <strong>{engenheiro}</strong>, {saudacao}!</p>
            <p>Segue o resumo das <strong>{total_alt} alterações</strong> realizadas hoje em <strong>{total_notas} nota(s)</strong> vinculadas às suas regionais (<strong>{regionais_str}</strong>):</p>
            <br>
            {tabela_html}
            <br>
            <p style="font-size: 12.5px; color: #64748b;">Este é um informativo diário automático gerado pelo sistema <strong>EDP Verify</strong>.</p>
            <p>Atenciosamente,<br><strong>{usuario}</strong></p>
        </body>
        </html>
        """

        message.Display()
        logger.info(f"✅ E-mail diário de alterações gerado para {engenheiro} por {usuario}.")
        return {
            "ok": True,
            "mensagem": f"E-mail com {total_alt} alteração(ões) gerado com sucesso no Outlook para {engenheiro} ({email_to})!",
        }
    except Exception as e:
        logger.error(f"Erro ao interagir com Outlook para {engenheiro}: {e}")
        return {
            "ok": False,
            "mensagem": f"Não foi possível abrir o Outlook para {engenheiro}: {e}",
        }
    finally:
        try:
            import pythoncom
            pythoncom.CoUninitialize()
        except Exception:
            pass


def gerar_todos_emails_outlook(data_referencia: str | None = None, usuario: str = "sistema") -> dict:
    """Gera e-mails no Outlook para todos os engenheiros que tiveram alterações no dia."""
    resumo = obter_resumo_alteracoes_diarias(data_referencia)
    engenheiros_com_alt = [
        eng for eng, d in resumo["engenheiros"].items()
        if d["total_alteracoes"] > 0
    ]

    if not engenheiros_com_alt:
        return {
            "ok": False,
            "mensagem": "Nenhuma alteração encontrada nas regionais para gerar notificações hoje.",
            "enviados": 0,
        }

    resultados = []
    for eng in engenheiros_com_alt:
        res = gerar_email_outlook_engenheiro(eng, data_referencia=data_referencia, usuario=usuario)
        resultados.append({"engenheiro": eng, "resultado": res})

    qtd_ok = sum(1 for r in resultados if r["resultado"]["ok"])
    return {
        "ok": qtd_ok > 0,
        "mensagem": f"{qtd_ok} e-mail(s) de resumo gerado(s) com sucesso no Outlook!",
        "enviados": qtd_ok,
        "total_elegiveis": len(engenheiros_com_alt),
        "detalhes": resultados,
    }
