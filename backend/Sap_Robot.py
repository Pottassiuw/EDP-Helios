# region Chapter 1. IMPORTS & CONSTANTS
import os
import sys
import time
import pandas as pd
import subprocess
import win32com.client
import pyperclip
import gc
import json
import sqlite3

# Adiciona o diretório atual ao path para garantir resolução do input_module
caminho_dir = os.path.dirname(os.path.abspath(__file__))
if caminho_dir not in sys.path:
    sys.path.append(caminho_dir)

from input_module.config import (
    REDE_INPUT_SQL as CAMINHO_PASTA_SQL,
    CAMINHO_BASE_IW28 as CAMINHO_EXPORT_NOTAS,
    CAMINHO_CUSTO_ORD_IW38 as CAMINHO_EXPORT_ORDEM,
    CAMINHO_BASE_IW66 as CAMINHO_EXPORT_MEDIDAS,
    REDE_DB_ORIGEM as CAMINHO_DB
)

# Nomes de Arquivos
ARQUIVO_NOME_IW28 = os.path.basename(CAMINHO_EXPORT_NOTAS)
ARQUIVO_NOME_IW38 = os.path.basename(CAMINHO_EXPORT_ORDEM)
ARQUIVO_NOME_IW66 = os.path.basename(CAMINHO_EXPORT_MEDIDAS)

# Parâmetros SAP
NOME_SISTEMA_SAP = "P40_S4/HANA"
LAYOUT_IW38 = "/GALVAO"
LAYOUT_IW66 = "/GALVAO"
CAMINHO_SAP_LOGON = r"C:\Program Files (x86)\SAP\FrontEnd\SAPgui\saplogon.exe"
# endregion

# region Chapter 2. CREDENTIALS HELPER
def obter_credenciais_sap() -> tuple[str, str]:
    """
    Obtém as credenciais do SAP com prioridade flexível e sem dependência obrigatória de arquivo:
    1. Variáveis de ambiente LOGIN_SAP/SENHA_SAP — como chegam quando disparado pela UI
       web (Configurações → Automação SAP), por requisição, nunca gravadas em disco
       (ver routes.py `_rotina_sap_background`). Cada engenheiro loga com o próprio usuário.
    2. Arquivo credenciais.json (fallback para a execução agendada via Rodar_Sap_Robot.bat,
       que não passa pela UI e portanto não tem variáveis de ambiente por requisição).
    """
    login = os.environ.get("LOGIN_SAP", "").strip()
    senha = os.environ.get("SENHA_SAP", "")

    if not (login and senha):
        caminhos_tentativas = [
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "credenciais.json"),
            os.path.join(os.getcwd(), "credenciais.json"),
            r"c:\Users\E713105\Documents\INPUT SQL\credenciais.json",
        ]
        for cp in caminhos_tentativas:
            if os.path.exists(cp):
                try:
                    with open(cp, "r", encoding="utf-8") as f:
                        dados = json.load(f)
                        if not login:
                            login = str(dados.get("LOGIN_SAP", ""))
                        if not senha:
                            senha = str(dados.get("SENHA_SAP", ""))
                        if login and senha:
                            break
                except Exception:
                    pass

    return login.strip(), senha.strip()


LOGIN_SAP, SENHA_SAP = obter_credenciais_sap()
# endregion

def obter_sap_gui_engine():
    """Obtém o motor de scripting do SAP GUI ativo através do SapROTWrapper ou GetObject."""
    try:
        rot = win32com.client.Dispatch("SapROTWr.SapROTWrapper")
        entry = rot.GetROTEntry("SAPGUI")
        if entry is not None:
            return entry.GetScriptingEngine
    except Exception:
        pass

    try:
        obj = win32com.client.GetObject("SAPGUI")
        if obj is not None:
            return obj.GetScriptingEngine
    except Exception:
        pass

    return None


# region Chapter 3. SAP AUTOMATION CLASS
class SapAutomator:
    def __init__(self, system_name):
        self.system_name = system_name
        self.session = None

    def connect(self, login="", password=""):
        try:
            self.session = None
            gc.collect()

            # 1. Tenta anexar à sessão ativa do SAP que já esteja aberta e logada
            try:
                app = obter_sap_gui_engine()
                if app and app.Connections.Count > 0:
                    for conn in app.Connections:
                        if conn.Children.Count > 0:
                            for sess in conn.Children:
                                try:
                                    sess.findById("wnd[0]/tbar[0]/okcd")
                                    print("✅ Conectado à sessão ativa do SAP já aberta pelo usuário.")
                                    self.session = sess
                                    return self.session
                                except Exception:
                                    pass
            except Exception:
                pass

            # 2. Se não há sessão ativa, valida se as credenciais foram fornecidas
            if not login or not password:
                if sys.stdin and sys.stdin.isatty():
                    print("\n🔑 Nenhuma sessão ativa do SAP encontrada.")
                    import getpass
                    if not login:
                        login = input("Informe o usuário SAP: ").strip()
                    if not password:
                        password = getpass.getpass("Informe a senha SAP: ").strip()

            if not login or not password:
                print("❌ ERRO: Credenciais SAP não fornecidas e nenhuma sessão ativa do SAP aberta foi encontrada.")
                print("💡 Dica: Abra a conexão do SAP (ex: duplo clique em P40_S4/HANA e entre no SAP) antes de executar o robô.")
                return None

            subprocess.Popen(CAMINHO_SAP_LOGON)
            time.sleep(5)

            application = None
            for _ in range(10):
                application = obter_sap_gui_engine()
                if application is not None:
                    break
                time.sleep(1)

            if application is None:
                raise Exception("SAP GUI scripting não disponível")

            connection = application.OpenConnection(self.system_name, True)
            time.sleep(0.5) # Aguarda a renderização rápida da janela de login
            self.session = connection.Children(0)

            self.session.findById("wnd[0]/usr/txtRSYST-BNAME").text = login
            self.session.findById("wnd[0]/usr/pwdRSYST-BCODE").text = password
            self.session.findById("wnd[0]").sendVKey(0)

            try:
                self.session.findById("wnd[1]/usr/radMULTI_LOGON_OPT2").select()
                self.session.findById("wnd[1]/tbar[0]/btn[0]").press()
            except:
                pass

            print("✅ Login no SAP realizado com sucesso.")
            return self.session
        except Exception as e:
            print(f"❌ Erro ao conectar no SAP: {e}")
            return None

    def execute_iw28(self, lista_notas, output_folder, output_filename):
        if not self.session or not lista_notas: return False
        try:
            print(f"Iniciando transação 'IW28' para auditar {len(lista_notas)} notas do banco...")
            self.session.findById("wnd[0]/tbar[0]/okcd").text = "IW28"
            self.session.findById("wnd[0]").sendVKey(0)

            try:
                self.session.findById("wnd[0]/tbar[1]/btn[17]").press()
                self.session.findById("wnd[1]/usr/txtENAME-LOW").text = "713105"
                self.session.findById("wnd[1]/tbar[0]/btn[8]").press()
            except Exception as e:
                print(f"  [Aviso] Ignorando variante: {e}")

            try:
                self.session.findById("wnd[0]/usr/ctxtQMART-LOW").text = ""
            except: pass

            notas_string = "\r\n".join(map(str, lista_notas))
            pyperclip.copy(notas_string)

            self.session.findById("wnd[0]/usr/btn%_QMNUM_%_APP_%-VALU_PUSH").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[24]").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[8]").press()

            print("Executando a consulta no SAP...")
            self.session.findById("wnd[0]/tbar[1]/btn[8]").press()
            time.sleep(5)

            print("Exportando dados diretamente para Planilha (XXL)...")
            grid = self.session.findById("wnd[0]/usr/cntlGRID1/shellcont/shell")
            grid.selectAll()
            grid.contextMenu()
            grid.selectContextMenuItem("&XXL")

            self.session.findById("wnd[1]/tbar[0]/btn[0]").press()
            self.session.findById("wnd[1]/usr/ctxtDY_PATH").text = output_folder + "\\"
            self.session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = output_filename
            self.session.findById("wnd[1]/tbar[0]/btn[11]").press()

            print(f"✅ Arquivo '{output_filename}' salvo com sucesso na rede!")

            self.session.findById("wnd[0]/tbar[0]/btn[15]").press()
            time.sleep(1)
            self.session.findById("wnd[0]/tbar[0]/btn[15]").press()

            return True
        except Exception as e:
            print(f"❌ Erro fatal na transação 'IW28': {e}")
            return False

    def execute_iw38(self, order_list, layout, output_folder, output_filename):
        if not self.session or not order_list: return False
        try:
            print(f"Iniciando transação 'IW38' para {len(order_list)} ordens...")
            self.session.findById("wnd[0]/tbar[0]/okcd").text = "IW38"
            self.session.findById("wnd[0]").sendVKey(0)
            self.session.findById("wnd[0]/usr/chkDY_MAB").selected = True
            self.session.findById("wnd[0]/usr/chkDY_HIS").selected = True

            try:
                self.session.findById("wnd[0]/usr/ctxtDATUV").text = ""
                self.session.findById("wnd[0]/usr/ctxtDATUB").text = ""
            except: pass

            self.session.findById("wnd[0]/usr/ctxtVARIANT").text = layout

            orders_string = "\r\n".join(map(str, order_list))
            pyperclip.copy(orders_string)

            self.session.findById("wnd[0]/usr/btn%_AUFNR_%_APP_%-VALU_PUSH").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[24]").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[8]").press()

            print("Executando a consulta na IW38...")
            self.session.findById("wnd[0]/tbar[1]/btn[8]").press()
            time.sleep(5)

            print("Exportando dados da IW38 diretamente para Planilha (XXL)...")
            grid = self.session.findById("wnd[0]/usr/cntlGRID1/shellcont/shell")
            grid.selectAll()
            grid.contextMenu()
            grid.selectContextMenuItem("&XXL")

            self.session.findById("wnd[1]/tbar[0]/btn[0]").press()
            self.session.findById("wnd[1]/usr/ctxtDY_PATH").text = output_folder + "\\"
            self.session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = output_filename
            self.session.findById("wnd[1]/tbar[0]/btn[11]").press()

            print(f"✅ Arquivo '{output_filename}' salvo com sucesso na rede!")

            time.sleep(3)
            try:
                subprocess.run(["taskkill", "/F", "/IM", "EXCEL.EXE"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print("🧹 Excel fechado automaticamente para liberar o arquivo.")
            except: pass

            self.session.findById("wnd[0]/tbar[0]/btn[15]").press()
            time.sleep(1)
            self.session.findById("wnd[0]/tbar[0]/btn[15]").press()

            return True
        except Exception as e:
            print(f"❌ Erro na transação 'IW38': {e}")
            return False

    def execute_iw66(self, lista_notas, output_folder, output_filename):
        if not self.session or not lista_notas: return False
        try:
            print(f"Iniciando transação 'IW66' para {len(lista_notas)} notas...")
            self.session.findById("wnd[0]/tbar[0]/okcd").text = "IW66"
            self.session.findById("wnd[0]").sendVKey(0)

            # Marca medidas pendentes e encerradas/histórico
            for chk in ["chkDY_MAB", "chkDY_HIS", "chkDY_NOT_ERL", "chkDY_MAB_ERL"]:
                try:
                    self.session.findById(f"wnd[0]/usr/{chk}").selected = True
                except: pass

            try:
                self.session.findById("wnd[0]/usr/ctxtVARIANT").text = "/GALVAO"
                self.session.findById("wnd[0]/usr/ctxtVARIANT").setFocus()
                self.session.findById("wnd[0]/usr/ctxtVARIANT").caretPosition = 7
            except Exception as e:
                print(f"  [Aviso] Erro ao aplicar variante: {e}")

            # Reafirma flags de status abertas e encerradas após carregar a variante
            for chk in ["chkDY_MAB", "chkDY_HIS", "chkDY_NOT_ERL", "chkDY_MAB_ERL"]:
                try:
                    self.session.findById(f"wnd[0]/usr/{chk}").selected = True
                except: pass

            try:
                self.session.findById("wnd[0]/usr/ctxtDATUV").text = ""
            except: pass
            try:
                self.session.findById("wnd[0]/usr/ctxtDATUB").text = ""
            except: pass

            notas_string = "\r\n".join(map(str, lista_notas))
            pyperclip.copy(notas_string)

            self.session.findById("wnd[0]/usr/btn%_QMNUM_%_APP_%-VALU_PUSH").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[24]").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[8]").press()

            self.session.findById("wnd[0]/tbar[1]/btn[8]").press()
            time.sleep(5)

            print("Exportando dados da IW66 diretamente para Planilha (XXL)...")
            grid = self.session.findById("wnd[0]/usr/cntlGRID1/shellcont/shell")
            grid.setCurrentCell(-1, "")
            grid.selectAll()
            grid.contextMenu()
            grid.selectContextMenuItem("&XXL")

            self.session.findById("wnd[1]/tbar[0]/btn[0]").press()
            self.session.findById("wnd[1]/usr/ctxtDY_PATH").text = output_folder + "\\"
            self.session.findById("wnd[1]/usr/ctxtDY_FILENAME").text = output_filename
            self.session.findById("wnd[1]/tbar[0]/btn[11]").press()

            print(f"✅ Arquivo '{output_filename}' salvo com sucesso na rede!")

            time.sleep(3)
            try:
                subprocess.run(["taskkill", "/F", "/IM", "EXCEL.EXE"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                print("🧹 Excel fechado automaticamente para liberar o arquivo.")
            except: pass

            self.session.findById("wnd[0]/tbar[0]/btn[15]").press()
            time.sleep(1)
            self.session.findById("wnd[0]/tbar[0]/btn[15]").press()

            return True
        except Exception as e:
            print(f"❌ Erro na transação 'IW66': {e}")
            return False
# endregion

# endregion

# region Chapter 4. HELPER UTILITIES
def limpar_ambiente():
    try:
        subprocess.run(["taskkill", "/F", "/IM", "EXCEL.EXE"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print("🧹 Instâncias do Excel fechadas.")
    except: pass

def obter_ou_criar_sessao_sap(login_sap=None, senha_sap=None):
    """
    Tenta se conectar a uma sessão ativa do SAP. Se encontrar uma conexão aberta mas não autenticada (tela de login),
    realiza o login nela. Se não encontrar nenhuma conexão, inicia uma nova.
    """
    usr, pwd = obter_credenciais_sap()
    if login_sap and str(login_sap).strip():
        usr = str(login_sap).strip()
    if senha_sap and str(senha_sap).strip():
        pwd = str(senha_sap).strip()

    try:
        app = obter_sap_gui_engine()
        if app and app.Connections.Count > 0:
            for conn in app.Connections:
                if conn.Children.Count > 0:
                    for sess in conn.Children:
                        try:
                            # Se o campo de texto do usuário está visível, a conexão está na tela de login.
                            try:
                                if usr and pwd:
                                    sess.findById("wnd[0]/usr/txtRSYST-BNAME").text = usr
                                    sess.findById("wnd[0]/usr/pwdRSYST-BCODE").text = pwd
                                    sess.findById("wnd[0]").sendVKey(0)
                                    try:
                                        # Trata pop-up de multi-logon se aparecer
                                        sess.findById("wnd[1]/usr/radMULTI_LOGON_OPT2").select()
                                        sess.findById("wnd[1]/tbar[0]/btn[0]").press()
                                    except:
                                        pass
                                    return sess
                            except:
                                pass

                            # Se não há campo de login, valida se a sessão está ativa e logada
                            sess.findById("wnd[0]/tbar[0]/okcd")
                            return sess
                        except:
                            pass
    except Exception:
        pass

    # Se não há sessão ativa, inicia uma nova
    sap = SapAutomator(NOME_SISTEMA_SAP)
    return sap.connect(usr, pwd)
def log_debug(msg):
    import datetime
    try:
        with open("sap_debug.log", "a", encoding="utf-8") as f:
            f.write(f"[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
        print(f"DEBUG: {msg}")
    except:
        pass


def formatar_quantidade_sap(qtd, unidade):
    """
    Formata a quantidade com base na unidade:
    - Se for 'un' (Equipamento), retorna apenas o número inteiro.
    - Se for 'km' (Obra linear), converte para metros (multiplica por 1000) e retorna como inteiro.
    """
    if unidade == 'un':
        return str(int(round(qtd)))
    # km -> m (multiplica por 1000 e arredonda)
    return str(int(round(qtd * 1000)))

def alterar_medidas_sap(lista_notas_correcao, login_sap=None, senha_sap=None, modo_teste=True):
    """
    Altera as quantidades de medidas das notas fornecidas no SAP GUI via IW22.
    """
    import pythoncom
    try:
        pythoncom.CoInitialize()
    except:
        pass

    relatorio = []

    session = obter_ou_criar_sessao_sap(login_sap, senha_sap)
    if not session:
        try:
            pythoncom.CoUninitialize()
        except:
            pass
        return [{"Nota": item.get('nota'), "Status": "ERRO", "Mensagem": "SAP fechado ou sem sessão ativa. Por favor, abra o SAP ou forneça usuário/senha válidos na interface."} for item in lista_notas_correcao]

    for item in lista_notas_correcao:
        nota = str(item.get('nota'))
        quantidade = item.get('quantidade')
        unidade = item.get('unidade')

        try:
            # 1. Acessa a IW22 e entra na nota
            session.findById("wnd[0]/tbar[0]/okcd").text = "/nIW22"
            session.findById("wnd[0]").sendVKey(0)
            time.sleep(1.0) # Atraso após entrar na IW22

            session.findById("wnd[0]/usr/ctxtRIWO00-QMNUM").text = nota
            session.findById("wnd[0]").sendVKey(0)
            time.sleep(1.0) # Atraso após submeter o número da nota

            # 2. Detecção de Bloqueio ou Erro de Acesso
            sbar = session.findById("wnd[0]/sbar")
            msg_text = sbar.Text
            msg_type = sbar.MessageType

            if msg_type == "E" or "bloquead" in msg_text.lower() or "processad" in msg_text.lower() or "locked" in msg_text.lower():
                relatorio.append({"Nota": nota, "Status": "ERRO", "Mensagem": f"Nota bloqueada ou erro de acesso: {msg_text}"})
                # Volta para o menu principal
                session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
                session.findById("wnd[0]").sendVKey(0)

            # 2.5. Detecção de Status e Log Informativo
            status_text = ""
            for num in ["1050", "1040", "1010", "1020", "1030"]:
                try:
                    status_text = session.findById(f"wnd[0]/usr/subSCREEN_1:SAPLIQS0:{num}/txtRIWO00-ASTXT").text
                    if status_text:
                        break
                except:
                    pass
            if not status_text:
                for num in ["1050", "1040", "1010", "1020", "1030"]:
                    try:
                        status_text = session.findById(f"wnd[0]/usr/subSCREEN_1:SAPLIQS0:{num}/txtVIQMEL-ASTXT").text
                        if status_text:
                            break
                    except:
                        pass

            status_num = 0
            if status_text:
                log_debug(f"Nota {nota} - Status no SAP: {status_text}")
                import re
                match = re.match(r'^(\d+)', status_text.strip())
                if match:
                    status_num = int(match.group(1))
                else:
                    match_any = re.search(r'\d+', status_text)
                    if match_any:
                        status_num = int(match_any.group(0))

            # Se for inativo (CANC, ENCE, etc.), pula a nota
            status_text_upper = status_text.upper()
            termos_inativos = ["ENCE CANC", "SUPR CANC", "ENCE EXEC", "SUPR", "55", "99", "999", "998", "997"]
            if any(t in status_text_upper for t in termos_inativos):
                relatorio.append({
                    "Nota": nota,
                    "Status": "ERRO",
                    "Mensagem": f"Nota inativa no SAP (Status: {status_text})"
                })
                session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
                session.findById("wnd[0]").sendVKey(0)
                time.sleep(1.0)
                continue

            # 3. Validação de Acesso na aba TAB10 (Medidas)
            try:
                session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10").select()
                time.sleep(0.5) # Atraso após trocar para aba principal
                session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03").select()
                time.sleep(1.0) # Atraso após abrir a sub-aba de Medidas

                table_control = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2")
                is_changeable = True
            except Exception as e:
                is_changeable = False
                log_debug(f"Nota {nota} - Erro ao encontrar o controle de tabela de medidas: {e}")

            if not is_changeable:
                relatorio.append({"Nota": nota, "Status": "ERRO", "Mensagem": "Aba TAB10 (Medidas) fechada ou tabela de medidas não editável."})
                session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
                session.findById("wnd[0]").sendVKey(0)
                time.sleep(0.5)
                try:
                    if session.Children.Count > 1:
                        session.findById("wnd[1]/usr/btnSPOP-OPTION2").press()
                    time.sleep(0.5)
                except:
                    pass
                continue

            # 4. Formata a quantidade e determina se a linha 0 pode ser editada diretamente
            str_qtd = formatar_quantidade_sap(quantidade, unidade)
            try:
                # Foca a janela do SAP
                try:
                    sap_title = session.findById("wnd[0]").text
                    shell = win32com.client.Dispatch("WScript.Shell")
                    shell.AppActivate(sap_title)
                    time.sleep(0.3)
                except Exception as focus_err:
                    log_debug(f"Nota {nota} - Aviso: Não foi possível focar a janela do SAP: {focus_err}")

                tbl = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2")
                try:
                    tbl.verticalScrollbar.position = 0
                except Exception:
                    pass

                # Checa se a linha 0 é editável diretamente no SAP GUI
                campo_medida_0 = None
                eh_editavel_direto = False
                try:
                    campo_medida_0 = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,0]")
                    eh_editavel_direto = bool(getattr(campo_medida_0, "Changeable", False))
                except Exception:
                    eh_editavel_direto = False

                # Edição direta só se for permitido pelo SAP (Changeable=True) e status compatível
                edicao_direta = eh_editavel_direto and (status_num <= 27 and status_num not in [10, 20] and status_num > 0)

                if edicao_direta:
                    # ── MODO 1: EDIÇÃO DIRETA NA LINHA 0 ──────────
                    log_debug(f"Nota {nota} - Status {status_num} (Changeable=True): alterando medida diretamente na linha 0")
                    campo_medida_0.text = str_qtd
                    campo_medida_0.setFocus()
                    try:
                        campo_medida_0.caretPosition = 0
                    except Exception:
                        pass
                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(0.5)
                    if session.Children.Count > 1:
                        try:
                            session.findById("wnd[1]").sendVKey(0)
                            time.sleep(0.3)
                        except Exception:
                            pass
                else:
                    # ── MODO 2: RECRIAÇÃO NA LINHA 1 + EXCLUSÃO DA LINHA 0 ──────────
                    log_debug(f"Nota {nota} - Status {status_num} (Changeable={eh_editavel_direto}): recriando na linha 1 e excluindo linha 0")

                    # 1. Cria nova medida com código ELP
                    code_fld = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-MNCOD[2,1]")
                    code_fld.text = "ELP"
                    code_fld.setFocus()
                    try:
                        code_fld.caretPosition = 3
                    except Exception:
                        pass
                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(0.5)
                    if session.Children.Count > 1:
                        try:
                            session.findById("wnd[1]").sendVKey(0)
                            time.sleep(0.3)
                        except Exception:
                            pass

                    # 2. Digita a quantidade na segunda linha
                    qtd_fld = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,1]")
                    qtd_fld.text = str_qtd
                    qtd_fld.setFocus()
                    try:
                        qtd_fld.caretPosition = 3
                    except Exception:
                        pass
                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(0.5)
                    if session.Children.Count > 1:
                        try:
                            session.findById("wnd[1]").sendVKey(0)
                            time.sleep(0.3)
                        except Exception:
                            pass

                    # 3. Pega texto da medida e copia para linha 1
                    try:
                        texto_medida = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-MATXT[4,0]").text
                        session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-MATXT[4,1]").text = texto_medida
                    except Exception:
                        pass

                    # 4. Pega as datas e coloca na linha 1
                    try:
                        dt_inicio = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTER[11,0]").text
                        h_inicio = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTUR[12,0]").text
                        dt_fim = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETER[13,0]").text
                        h_fim = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETUR[14,0]").text

                        if dt_inicio: session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTER[11,1]").text = dt_inicio
                        if h_inicio: session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTUR[12,1]").text = h_inicio
                        if dt_fim: session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETER[13,1]").text = dt_fim
                        if h_fim:
                            session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETUR[14,1]").text = h_fim
                            fld_fim = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETUR[14,1]")
                            fld_fim.setFocus()
                            try:
                                fld_fim.caretPosition = 5
                            except Exception:
                                pass
                            session.findById("wnd[0]").sendVKey(0)
                            time.sleep(0.5)
                            if session.Children.Count > 1:
                                try:
                                    session.findById("wnd[1]").sendVKey(0)
                                    time.sleep(0.3)
                                except Exception:
                                    pass
                    except Exception:
                        pass

                    # 5. Se status 99, copia conclusão e encerra na linha 1
                    if status_num == 99:
                        try:
                            concluido_por = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-ERLNAM[15,0]").text
                            data_conclusao = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLDAT[16,0]").text
                            hora_da_conclusao = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLZEIT[17,0]").text

                            session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-ERLNAM[15,1]").text = concluido_por
                            session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLDAT[16,1]").text = data_conclusao
                            fld_ez = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLZEIT[17,1]")
                            fld_ez.text = hora_da_conclusao
                            fld_ez.setFocus()
                            try:
                                fld_ez.caretPosition = 8
                            except Exception:
                                pass

                            tbl.getAbsoluteRow(1).selected = True
                            fld_q1 = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,1]")
                            fld_q1.setFocus()
                            try:
                                fld_q1.caretPosition = 0
                            except Exception:
                                pass
                            session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/btnFC_ERLEDIGT").press()
                            time.sleep(0.5)
                            if session.Children.Count > 1:
                                session.findById("wnd[1]").sendVKey(0)
                                time.sleep(0.3)
                        except Exception as e_enc:
                            log_debug(f"Nota {nota} - Aviso ao encerrar medida na linha 1: {e_enc}")

                    # 6. Reposiciona o scroll no topo absoluto (linha 0)
                    try:
                        tbl.verticalScrollbar.position = 0
                    except Exception:
                        pass
                    time.sleep(0.3)

                    # 6.1. Se a medida original estiver encerrada (MEDE), reabre para habilitar a exclusão
                    try:
                        tbl.selectedRows = "0"
                        tbl.getAbsoluteRow(0).selected = True
                        btn_reabrir = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/btnFC_ERL_ZURUECK")
                        btn_reabrir.press()
                        time.sleep(0.4)
                        if session.Children.Count > 1:
                            session.findById("wnd[1]").sendVKey(0)
                            time.sleep(0.2)
                    except Exception:
                        pass

                    # 7. Exclui a medida original (linha 0)
                    try:
                        tbl.verticalScrollbar.position = 0
                    except Exception:
                        pass
                    time.sleep(0.2)

                    try:
                        tbl.selectedRows = "0"
                        tbl.getAbsoluteRow(0).selected = True
                    except Exception:
                        pass

                    fld_q0 = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,0]")
                    fld_q0.setFocus()
                    try:
                        fld_q0.caretPosition = 0
                    except Exception:
                        pass
                    time.sleep(0.2)

                    deletou = False
                    try:
                        session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/btnLOESCHEN").press()
                        deletou = True
                    except Exception as e_loesch:
                        log_debug(f"Nota {nota} - btnLOESCHEN falhou: {e_loesch}")

                    if not deletou:
                        try:
                            session.findById("wnd[0]").sendVKey(14) # Shift+F2
                            deletou = True
                        except Exception:
                            pass

                    if not deletou:
                        try:
                            session.findById("wnd[0]/tbar[0]/okcd").text = "=LOES"
                            session.findById("wnd[0]").sendVKey(0)
                            deletou = True
                        except Exception:
                            pass

                    time.sleep(0.4)
                    if session.Children.Count > 1:
                        wnd1 = session.findById("wnd[1]")
                        for btn_name in ["usr/btnSPOP-OPTION1", "usr/btnBUTTON_1", "tbar[0]/btn[0]"]:
                            try:
                                wnd1.findById(btn_name).press()
                                break
                            except Exception:
                                pass
                        else:
                            wnd1.sendVKey(0)

                log_debug(f"Nota {nota} - Valor alterado com sucesso para '{str_qtd}'")
            except Exception as e:
                log_debug(f"Nota {nota} - Erro ao escrever a quantidade: {e}")

            # 5. A TRAVA DO MODO DE TESTE (CRÍTICO)
            if modo_teste:
                # Atraso adicional de 2.0 segundos para visualização do usuário no modo teste antes de cancelar
                time.sleep(2.0)

                relatorio.append({
                    "Nota": nota,
                    "Status": "TESTE OK",
                    "Mensagem": f"TESTE: Simulação perfeita, salvamento ignorado (Seria gravado: {str_qtd} {unidade})"
                })
                # Sai sem salvar
                session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
                session.findById("wnd[0]").sendVKey(0)
                time.sleep(0.5)
                try:
                    if session.Children.Count > 1:
                        session.findById("wnd[1]/usr/btnSPOP-OPTION2").press()
                    time.sleep(1.0)
                except:
                    pass
            else:
                # Clica em Salvar (btn[11])
                session.findById("wnd[0]/tbar[0]/btn[11]").press()
                time.sleep(1.5)
                if status_num == 27:
                    try:
                        session.findById("wnd[0]").sendVKey(0)
                        time.sleep(1.0)
                    except:
                        pass

                # Lê a barra inferior após o salvamento
                sbar = session.findById("wnd[0]/sbar")
                msg_text = sbar.Text
                msg_type = sbar.MessageType

                if msg_type == "E":
                    relatorio.append({"Nota": nota, "Status": "ERRO", "Mensagem": f"Erro de gravação no SAP: {msg_text}"})
                    # Sai descartando para não trancar o robô
                    session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(0.5)
                    try:
                        if session.Children.Count > 1:
                            session.findById("wnd[1]/usr/btnSPOP-OPTION2").press()
                        time.sleep(0.5)
                    except:
                        pass
                else:
                    relatorio.append({"Nota": nota, "Status": "OK", "Mensagem": f"Gravado com sucesso: {msg_text}"})

        except Exception as ex:
            relatorio.append({"Nota": nota, "Status": "ERRO", "Mensagem": f"Erro inesperado no robô SAP: {str(ex)}"})
            try:
                session.findById("wnd[0]/tbar[0]/okcd").text = "/n"
                session.findById("wnd[0]").sendVKey(0)
                time.sleep(0.5)
                try:
                    if session.Children.Count > 1:
                        session.findById("wnd[1]/usr/btnSPOP-OPTION2").press()
                except:
                    pass
            except:
                pass

    try:
        pythoncom.CoUninitialize()
    except:
        pass
    return relatorio
# endregion

# region Chapter 5. ROBOT PROCESS EXECUTION
if __name__ == "__main__":
    print("--- INICIANDO ROBÔ SAP: AUDITORIA DE BANCO DE DADOS ---")
    limpar_ambiente()

    lista_notas_banco = []
    caminho_db_final = os.environ.get("INPUT_DB_PATH", CAMINHO_DB)
    try:
        if os.path.exists(caminho_db_final):
            print(f"Lendo as notas ativas do banco de dados: {caminho_db_final}...")
            conn = sqlite3.connect(caminho_db_final)
            cursor = conn.cursor()
            cursor.execute("SELECT Numero_Nota FROM notas WHERE Numero_Nota IS NOT NULL UNION SELECT Numero_Nota FROM notas_ramal WHERE Numero_Nota IS NOT NULL")
            lista_notas_banco = [str(linha[0]) for linha in cursor.fetchall()]
            conn.close()
            print(f"✅ {len(lista_notas_banco)} notas carregadas do banco.")
        else:
            print(f"❌ ERRO: Banco de dados não encontrado no caminho: {caminho_db_final}")
            os._exit(1)
    except Exception as e:
        print(f"❌ Erro ao ler o banco de dados: {e}")
        os._exit(1)

    login_sap, senha_sap = obter_credenciais_sap()
    sap = SapAutomator(NOME_SISTEMA_SAP)
    session = obter_ou_criar_sessao_sap(login_sap, senha_sap)
    sap.session = session

    if not session:
        print("❌ ERRO: Não foi possível obter ou iniciar uma sessão ativa do SAP. Abra o SAP GUI previamente ou configure as credenciais.")
        sys.exit(1)

    if not lista_notas_banco:
        print("❌ ERRO: Nenhuma nota ativa encontrada no banco de dados.")
        sys.exit(1)

    success_iw28 = sap.execute_iw28(lista_notas_banco, os.path.dirname(CAMINHO_EXPORT_NOTAS), ARQUIVO_NOME_IW28)

    if not success_iw28:
        print("❌ A extração da IW28 falhou. Processo interrompido.")
        sys.exit(1)

    sap.execute_iw66(lista_notas_banco, os.path.dirname(CAMINHO_EXPORT_MEDIDAS), ARQUIVO_NOME_IW66)

    try:
        time.sleep(5)
        caminho_completo_iw28 = CAMINHO_EXPORT_NOTAS
        print(f"Lendo a coluna 'Ordem' do arquivo '{ARQUIVO_NOME_IW28}'...")

        time.sleep(2)
        df_para_ordens = pd.read_excel(caminho_completo_iw28)

        if "Ordem" in df_para_ordens.columns:
            ordens_num = pd.to_numeric(df_para_ordens["Ordem"], errors='coerce').dropna()
            orders_unicas = sorted(list({str(int(o)) for o in ordens_num if int(o) > 0}))
            if orders_unicas:
                print(f"Auditando {len(orders_unicas)} ordens únicas na IW38...")
                sap.execute_iw38(orders_unicas, LAYOUT_IW38, os.path.dirname(CAMINHO_EXPORT_ORDEM), ARQUIVO_NOME_IW38)
            else:
                print("⚠️ Nenhuma ordem válida atrelada às notas foi encontrada.")
        else:
            print("⚠️ Coluna 'Ordem' não encontrada no arquivo gerado.")
    except Exception as e:
        print(f"❌ Erro ao extrair custos (IW38): {e}")
        limpar_ambiente()

    print("--- EXECUÇÃO CONCLUÍDA ---")

    try:
        subprocess.run(["taskkill", "/F", "/IM", "saplogon.exe"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["taskkill", "/F", "/IM", "sapgui.exe"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except: pass
# endregion
