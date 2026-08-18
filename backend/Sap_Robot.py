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

# region Chapter 2. CREDENTIALS LOAD
# Descobre a pasta onde o script está rodando e procura o arquivo JSON
caminho_script = os.path.dirname(os.path.abspath(__file__))
caminho_credenciais = os.path.join(caminho_script, 'credenciais.json')
caminho_credenciais_alt = r"c:\Users\E713105\Documents\INPUT SQL\credenciais.json"

if not os.path.exists(caminho_credenciais) and os.path.exists(caminho_credenciais_alt):
    caminho_credenciais = caminho_credenciais_alt

# Tenta ler o arquivo de senhas
try:
    with open(caminho_credenciais, 'r', encoding='utf-8') as f:
        segredos = json.load(f)
        LOGIN_SAP = segredos['LOGIN_SAP']
        SENHA_SAP = segredos['SENHA_SAP']
except FileNotFoundError:
    print(f"❌ ERRO FATAL: Arquivo 'credenciais.json' não encontrado na pasta {caminho_script} nem em {caminho_credenciais_alt}.")
    print("Crie o arquivo com suas credenciais antes de rodar o robô.")
    os._exit(1)
except KeyError as e:
    print(f"❌ ERRO FATAL: Chave {e} não encontrada dentro do 'credenciais.json'.")
    os._exit(1)
# endregion

# region Chapter 3. SAP AUTOMATION CLASS
class SapAutomator:
    def __init__(self, system_name):
        self.system_name = system_name
        self.session = None

    def connect(self, login, password):
        try:
            self.session = None
            gc.collect()

            subprocess.Popen(CAMINHO_SAP_LOGON)
            time.sleep(5)

            sap_gui_auto = None
            for _ in range(10):
                try:
                    sap_gui_auto = win32com.client.GetObject("SAPGUI")
                    break
                except:
                    time.sleep(1)

            if sap_gui_auto is None:
                raise Exception("SAP GUI scripting não disponível")

            application = sap_gui_auto.GetScriptingEngine
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

            notas_string = "\r\n".join(map(str, lista_notas))
            pyperclip.copy(notas_string)

            self.session.findById("wnd[0]/usr/btn%_QMNUM_%_APP_%-VALU_PUSH").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[24]").press()
            time.sleep(1)
            self.session.findById("wnd[1]/tbar[0]/btn[8]").press()

            try:
                self.session.findById("wnd[0]/usr/ctxtDATUV").text = ""
            except: pass
            try:
                self.session.findById("wnd[0]/usr/ctxtDATUB").text = ""
            except: pass

            try:
                self.session.findById("wnd[0]/usr/ctxtVARIANT").text = "/GALVAO"
                self.session.findById("wnd[0]/usr/ctxtVARIANT").setFocus()
                self.session.findById("wnd[0]/usr/ctxtVARIANT").caretPosition = 7
            except Exception as e:
                print(f"  [Aviso] Erro ao aplicar variante: {e}")

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

    arquivos_limpar = [
        CAMINHO_EXPORT_NOTAS,
        CAMINHO_EXPORT_ORDEM,
        CAMINHO_EXPORT_MEDIDAS
    ]

    for arq in arquivos_limpar:
        try:
            if os.path.exists(arq):
                os.remove(arq)
                print(f"🗑️ Arquivo antigo '{os.path.basename(arq)}' deletado.")
        except Exception as e:
            print(f"⚠️ Aviso: Não foi possível deletar '{os.path.basename(arq)}'. {e}")

def obter_ou_criar_sessao_sap(login_sap=None, senha_sap=None):
    """
    Tenta se conectar a uma sessão ativa do SAP. Se encontrar uma conexão aberta mas não autenticada (tela de login),
    realiza o login nela. Se não encontrar nenhuma conexão, inicia uma nova.
    Usa fallbacks para as credenciais padrão do credenciais.json.
    """
    usr = login_sap if (login_sap and str(login_sap).strip() != "") else LOGIN_SAP
    pwd = senha_sap if (senha_sap and str(senha_sap).strip() != "") else SENHA_SAP

    try:
        sapgui = win32com.client.GetObject("SAPGUI")
        app = sapgui.GetScriptingEngine
        if app.Connections.Count > 0:
            for conn in app.Connections:
                if conn.Children.Count > 0:
                    for sess in conn.Children:
                        try:
                            # Se o campo de texto do usuário está visível, a conexão está na tela de login.
                            # Preenchemos as credenciais diretamente nela!
                            try:
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
                                # Se não há campo de login, valida se a sessão está ativa e logada
                                sess.findById("wnd[0]/tbar[0]/okcd")
                                return sess
                        except:
                            pass
    except Exception:
        pass

    # Se não há sessão ativa, inicia uma nova do zero
    if usr and pwd:
        try:
            sap = SapAutomator(NOME_SISTEMA_SAP)
            return sap.connect(usr, pwd)
        except Exception as e:
            print(f"Erro ao criar nova sessão SAP: {e}")
            return None
    return None
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

            # 2.5. Detecção de Status e Escolha do Modo de Edição (Regras da Macro VBA)
            status_text = ""
            # Tenta ler o status do usuário a partir dos subscreens típicos da IW22
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

            # Regra da macro:
            # - Se status for <= 27 e não for 10 ou 20, altera direto na linha 0.
            # - Caso contrário (se for status 10, 20 ou > 27 como 51, 53, etc.), recria a medida na linha 1 e deleta a original.
            direto = (status_num <= 27 and status_num != 10 and status_num != 20 and status_num > 0)

            # 3. Validação de Acesso na aba TAB10 (Medidas)
            try:
                session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10").select()
                time.sleep(0.5) # Atraso após trocar para aba principal
                session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03").select()
                time.sleep(1.0) # Atraso após abrir a sub-aba de Medidas

                # Apenas verifica se a tabela existe
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
                    session.findById("wnd[1]/usr/btnSPOP-OPTION2").press()
                    time.sleep(0.5)
                except:
                    pass
                continue

            # 4. Digita a quantidade
            str_qtd = formatar_quantidade_sap(quantidade, unidade)
            try:
                # Tenta focar a janela do SAP
                try:
                    sap_title = session.findById("wnd[0]").text
                    shell = win32com.client.Dispatch("WScript.Shell")
                    shell.AppActivate(sap_title)
                    time.sleep(0.3)
                except Exception as focus_err:
                    log_debug(f"Nota {nota} - Aviso: Não foi possível focar a janela do SAP: {focus_err}")

                shell = win32com.client.Dispatch("WScript.Shell")

                if direto:
                    log_debug(f"Nota {nota} - Alterando medida diretamente na linha 0 (Status: {status_text})")
                    campo_medida = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,0]")
                    campo_medida.setFocus()
                    time.sleep(0.2)

                    shell.SendKeys("^a")
                    time.sleep(0.1)
                    shell.SendKeys("{BACKSPACE}")
                    time.sleep(0.1)
                    shell.SendKeys(str_qtd)
                    time.sleep(0.2)

                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(1.0)
                else:
                    log_debug(f"Nota {nota} - Recriando medida na linha 1 e excluindo a linha 0 (Status: {status_text})")
                    # 1. Escreve "ELP" no código da segunda linha
                    code_field = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-MNCOD[2,1]")
                    code_field.text = "ELP"
                    code_field.setFocus()
                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(0.5)

                    # 2. Digita a quantidade na segunda linha
                    campo_medida = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,1]")
                    campo_medida.setFocus()
                    time.sleep(0.2)

                    shell.SendKeys("^a")
                    time.sleep(0.1)
                    shell.SendKeys("{BACKSPACE}")
                    time.sleep(0.1)
                    shell.SendKeys(str_qtd)
                    time.sleep(0.2)

                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(0.5)

                    # 3. Copia a descrição da medida original (linha 0) para a nova (linha 1)
                    texto_medida = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-MATXT[4,0]").text
                    session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-MATXT[4,1]").text = texto_medida

                    # 4. Copia as datas e horas de início/fim
                    dt_inicio = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTER[11,0]").text
                    h_inicio = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTUR[12,0]").text
                    dt_fim = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETER[13,0]").text
                    h_fim = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETUR[14,0]").text

                    session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTER[11,1]").text = dt_inicio
                    session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PSTUR[12,1]").text = h_inicio
                    session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETER[13,1]").text = dt_fim
                    session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETUR[14,1]").text = h_fim

                    session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-PETUR[14,1]").setFocus()
                    session.findById("wnd[0]").sendVKey(0)
                    time.sleep(0.5)
                    session.findById("wnd[1]").sendVKey(0) # Confirma diálogo de advertência
                    time.sleep(0.5)

                    # 5. Se for status 99 (Encerrado), copia dados de conclusão e encerra a medida
                    if status_num == 99:
                        concluido_por = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-ERLNAM[15,0]").text
                        data_conclusao = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLDAT[16,0]").text
                        hora_conclusao = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLZEIT[17,0]").text

                        session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-ERLNAM[15,1]").text = concluido_por
                        session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLDAT[16,1]").text = data_conclusao
                        session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/ctxtVIQMSM-ERLZEIT[17,1]").text = hora_conclusao

                        # Encerra a segunda medida
                        try:
                            tbl = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2")
                            tbl.getAbsoluteRow(1).Selected = True
                            session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,1]").setFocus()
                            session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/btnFC_ERLEDIGT").press()
                            time.sleep(0.5)
                        except Exception as e_enc:
                            log_debug(f"Nota {nota} - Aviso ao encerrar medida: {e_enc}")

                    # 6. Exclui a primeira medida original (linha 0)
                    tbl = session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2")
                    try:
                        tbl.verticalScrollbar.position = 0
                    except:
                        pass
                    time.sleep(0.2)

                    try:
                        tbl.getAbsoluteRow(0).Selected = True
                    except:
                        pass

                    try:
                        session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/tblSAPLIQS0MASSNAH_VIEWER2/txtVIQMSM-QSMNUM[0,0]").setFocus()
                    except:
                        pass

                    try:
                        session.findById("wnd[0]/usr/tabsTAB_GROUP_10/tabp10\\TAB10/ssubSUB_GROUP_10:SAPLIQS0:7210/tabsTAB_GROUP_20/tabp20\\TAB03/ssubSUB_GROUP_20:SAPLIQS0:7125/btnLOESCHEN").press()
                    except Exception as btn_err:
                        log_debug(f"Nota {nota} - btnLOESCHEN falhou: {btn_err}. Tentando tecla de atalho Shift+F2...")
                        try:
                            session.findById("wnd[0]").sendVKey(14)
                        except Exception as vkey_err:
                            log_debug(f"Nota {nota} - sendVKey(14) falhou: {vkey_err}")

                    time.sleep(0.5)

                    if session.Children.Count > 1:
                        try:
                            wnd1 = session.findById("wnd[1]")
                            try:
                                wnd1.findById("usr/btnSPOP-OPTION1").press()
                            except:
                                try:
                                    wnd1.findById("usr/btnBUTTON_1").press()
                                except:
                                    wnd1.sendVKey(0)
                            time.sleep(0.5)
                        except Exception as pop_err:
                            log_debug(f"Nota {nota} - Aviso popup exclusao: {pop_err}")

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

    sap = SapAutomator(NOME_SISTEMA_SAP)
    session = sap.connect(LOGIN_SAP, SENHA_SAP)

    if session and lista_notas_banco:
        success_iw28 = sap.execute_iw28(lista_notas_banco, os.path.dirname(CAMINHO_EXPORT_NOTAS), ARQUIVO_NOME_IW28)

        if success_iw28:
            sap.execute_iw66(lista_notas_banco, os.path.dirname(CAMINHO_EXPORT_MEDIDAS), ARQUIVO_NOME_IW66)

            try:
                time.sleep(5)
                caminho_completo_iw28 = CAMINHO_EXPORT_NOTAS
                print(f"Lendo a coluna 'Ordem' do arquivo '{ARQUIVO_NOME_IW28}'...")

                time.sleep(2)
                df_para_ordens = pd.read_excel(caminho_completo_iw28)

                if "Ordem" in df_para_ordens.columns:
                    orders = df_para_ordens["Ordem"].dropna().astype(int).astype(str).tolist()
                    if orders:
                        sap.execute_iw38(orders, LAYOUT_IW38, os.path.dirname(CAMINHO_EXPORT_ORDEM), ARQUIVO_NOME_IW38)
                    else:
                        print("⚠️ Nenhuma ordem atrelada às notas foi encontrada.")
                else:
                    print("⚠️ Coluna 'Ordem' não encontrada no arquivo gerado.")
            except Exception as e:
                print(f"❌ Erro ao extrair custos (IW38): {e}")
                limpar_ambiente()
        else:
            print("❌ A extração da IW28 falhou. Processo interrompido.")

        print("--- EXECUÇÃO CONCLUÍDA ---")

        try:
            subprocess.run(["taskkill", "/F", "/IM", "saplogon.exe"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["taskkill", "/F", "/IM", "sapgui.exe"], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except: pass
# endregion
