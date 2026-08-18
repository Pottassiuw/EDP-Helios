"""Persistência do módulo Input (SQLite).

Porte de Input/database.py. Segue o perfil ativo (local em backend/data/, ou
o banco compartilhado da rede em produção — ver config.em_producao()).
"""
import datetime
import glob
import json
import os
import re
import shutil
import sqlite3
import threading
import uuid
from contextlib import closing
from pathlib import Path

import pandas as pd

from input_module import config
from input_module.config import DE_PARA_CIDADES, DE_PARA_REGIONAL, INV_STATUS_MAP, STATUS_MAP


class BancoRedeIndisponivelErro(RuntimeError):
    """Perfil de produção sem acesso ao banco compartilhado da rede.

    Levantada em vez de cair silenciosamente no banco local: um servidor de
    produção lendo a cópia local serve notas desatualizadas sem nenhum sinal.
    """


class GravacaoNaoIniciadaErro(RuntimeError):
    """O banco não pôde ser aberto — a gravação não chegou a começar.

    Separa "não deu para escrever" de "escrevi pela metade": quem trata o erro
    precisa saber se há algo para desfazer antes de mexer em dados sãos.
    """


class NotasDuplicadasErro(Exception):
    """Numero_Nota repetido no lote ou já existente no banco.

    Mora aqui porque quem decide a duplicidade é a transação de escrita:
    `service` reexporta o tipo para as rotas traduzirem em HTTP 409.
    """


def obter_caminho_banco() -> str:
    return config.caminho_banco_notas()


def get_db_connection() -> sqlite3.Connection:
    caminho = obter_caminho_banco()
    # Em produção o banco vive na rede: o diretório já existe e não é nosso
    # para criar. Só o perfil local materializa backend/data/.
    if not config.em_producao():
        config.data_dir().mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(caminho, timeout=30, check_same_thread=False)
    # WAL não funciona em compartilhamento SMB (precisa de memória
    # compartilhada). Algumas configurações de share recusam o PRAGMA de
    # cara com "OperationalError: locking protocol" em vez de virar no-op —
    # por isso nem tentamos em produção. A serialização em produção vem do
    # timeout de 30s.
    if not config.em_producao():
        conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def descrever_conexao() -> dict:
    """Resumo seguro da conexão para log/diagnóstico — nunca caminho completo."""
    caminho = obter_caminho_banco()
    resumo = {
        "ambiente": config.perfil(),
        "tipo": "sqlite",
        "alvo": config.mascarar_caminho(caminho),
        "database": os.path.basename(caminho),
        "status": "indisponivel",
        "qtd_notas": None,
    }
    if not os.path.exists(caminho):
        return resumo
    try:
        conn = sqlite3.connect(caminho, timeout=5)
        try:
            resumo["qtd_notas"] = conn.execute("SELECT count(*) FROM notas").fetchone()[0]
        finally:
            conn.close()
        resumo["status"] = "ok"
    except Exception as e:  # noqa: BLE001
        resumo["status"] = f"erro: {type(e).__name__}"
    return resumo


def migrar_da_rede_se_preciso() -> str:
    """Prepara o banco de notas conforme o perfil de execução.

    Produção: o banco EM USO já é o da rede — nada é copiado. Se ele não
    estiver acessível, levanta ``BancoRedeIndisponivelErro`` em vez de servir
    a cópia local desatualizada.

    Local: primeira execução ou recuperação copia o banco da rede para
    ``backend/data/``. Se o banco local já existir mas estiver zerado/incompleto
    (< 100 notas) e a rede tiver a base completa (>= 100 notas), restaura.

    Retorna "rede" (produção), "ja-existe", "migrado" ou "rede-indisponivel".
    """
    destino = obter_caminho_banco()

    if config.em_producao():
        if not os.path.exists(destino):
            raise BancoRedeIndisponivelErro(
                "Perfil de produção (EDP_PERFIL=producao) não encontrou o banco "
                f"compartilhado em {config.mascarar_caminho(destino)}. "
                "Verifique se a máquina está na rede EDP, se INPUT_REDE_RAIZ/"
                "INPUT_DB_PATH apontam para o compartilhamento correto e se o "
                "usuário do serviço tem permissão de leitura e escrita. "
                "O sistema NÃO cai para o banco local nesse perfil — isso "
                "esconderia notas desatualizadas de todo o setor."
            )
        return "rede"

    if not os.path.exists(config.REDE_DB_ORIGEM):
        return "rede-indisponivel"

    if os.path.exists(destino):
        try:
            conn = sqlite3.connect(destino, timeout=5)
            cur = conn.cursor()
            cur.execute("SELECT count(*) FROM notas")
            cnt = cur.fetchone()[0]
            conn.close()
            if cnt >= 100:
                return "ja-existe"

            # Banco local tem poucas notas. Verifica se a rede tem uma base real para restaurar
            conn_net = sqlite3.connect(config.REDE_DB_ORIGEM, timeout=5)
            cur_net = conn_net.cursor()
            cur_net.execute("SELECT count(*) FROM notas")
            cnt_net = cur_net.fetchone()[0]
            conn_net.close()

            if cnt_net < 100:
                # Tanto o local quanto a rede são pequenos/ambientes de teste
                return "ja-existe"

            print(f"⚠️ Banco local '{destino}' tem apenas {cnt} notas. Restaurando base completa ({cnt_net} notas) da rede...")
        except Exception as e:
            print(f"⚠️ Erro ao verificar contagem ({e}). Seguiu com migração padrão...")

    config.data_dir().mkdir(parents=True, exist_ok=True)
    shutil.copy2(config.REDE_DB_ORIGEM, destino)
    print(f"✅ Banco de dados restaurado da rede com sucesso ({destino})!")
    return "migrado"


def _conferir_esquema_compartilhado() -> None:
    """Em produção: INSPECIONA o banco do setor, nunca o altera.

    O arquivo é de todo o departamento e também é escrito pelo robô SAP e pelo
    app legado. Criar tabela ou coluna nele não pode ser efeito colateral de um
    restart deste backend — então aqui só registramos o que falta.
    ``salvar_em_massa`` grava apenas as colunas que existem de fato.
    """
    conn = get_db_connection()
    try:
        colunas = {c[1] for c in conn.execute("PRAGMA table_info(notas)")}
        ausentes = [c for c in ("Check", "Status_Anterior", "Nota_Mae", "origem")
                    if c not in colunas]
        if ausentes:
            print(f"[input] Banco compartilhado nao tem: {', '.join(ausentes)}. "
                  "Nenhum ALTER TABLE e aplicado no perfil de producao; essas "
                  "colunas simplesmente nao sao gravadas.")
    finally:
        conn.close()


def inicializar_banco() -> None:
    """Cria/migra o esquema — só no perfil local.

    Em produção o banco já existe, pertence ao setor e é compartilhado com o
    robô SAP e o app legado: apenas conferimos o esquema, sem alterá-lo.
    """
    if config.em_producao():
        _conferir_esquema_compartilhado()
        return

    conn = get_db_connection()
    cursor = conn.cursor()

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notas (
            Numero_Nota INTEGER PRIMARY KEY,
            ID_Cronologia INTEGER,
            Status_Obra TEXT,
            Conjunto TEXT,
            Circuito TEXT,
            Local_Instalacao TEXT,
            Regional TEXT,
            Planejado_DDPM REAL,
            Mes_Execucao_Planejado TEXT,
            Data_Envio_Projeto TEXT,
            Centro_Responsavel TEXT,
            Status_Nota INTEGER,
            Prioridade_Nota TEXT,
            Observacao TEXT,
            "Check" TEXT,
            Status_Anterior TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notas_ramal (
            Numero_Nota INTEGER PRIMARY KEY,
            ID_Cronologia INTEGER,
            Status_Obra TEXT,
            Conjunto TEXT,
            Circuito TEXT,
            Local_Instalacao TEXT,
            Planejado_DDPM REAL,
            Mes_Execucao_Planejado TEXT,
            CenTrab_Respon TEXT,
            Prioridade_Nota TEXT,
            Observacao TEXT,
            Extracao_Antiga TEXT,
            Status_Nota TEXT,
            Status_Anterior TEXT,
            Check_Btzero TEXT,
            Plano TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS log_alteracoes (
            ID_Log INTEGER PRIMARY KEY AUTOINCREMENT,
            Numero_Nota INTEGER,
            Usuario TEXT,
            Data_Hora TIMESTAMP,
            Campo_Alterado TEXT,
            Valor_Antigo TEXT,
            Valor_Novo TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS log_arquivos (
            ID_Log INTEGER PRIMARY KEY AUTOINCREMENT,
            Nome_Arquivo TEXT,
            Usuario TEXT,
            Data_Hora TIMESTAMP,
            Acao TEXT
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS metas_plano (
            Ano INTEGER NOT NULL, Mes INTEGER NOT NULL,
            Regional TEXT NOT NULL, Plano TEXT NOT NULL,
            Meta REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (Ano, Mes, Regional, Plano)
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS planos_depara (
            Plano TEXT PRIMARY KEY, Nome_Curto TEXT NOT NULL,
            Unidade TEXT NOT NULL, Area TEXT NOT NULL,
            Modular_RS REAL NOT NULL DEFAULT 0,
            Ordem_Exibicao INTEGER NOT NULL DEFAULT 999
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS metas_sync_estado (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            arquivo_mtime REAL, atualizadas_em TEXT, erro TEXT
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS metas_postergadas (
            Ano INTEGER NOT NULL, Mes INTEGER NOT NULL,
            Regional TEXT NOT NULL, Plano TEXT NOT NULL,
            Qtd REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (Ano, Mes, Regional, Plano)
        )
    ''')
    # Espelha o schema real do banco da rede (legado, nunca portado por falta
    # de uso — agora usada para travar notas em edição, ver seção BLOQUEIOS).
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS bloqueios (
            Numero_Nota INTEGER PRIMARY KEY,
            Usuario TEXT,
            Data_Hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # --- VERIFICAÇÃO E ATUALIZAÇÃO DO ESQUEMA (ALTER TABLE & MIGRAÇÃO) ---
    # Pega a lista de colunas que realmente existem hoje no banco
    cursor.execute("PRAGMA table_info(notas)")
    colunas_existentes = [coluna[1] for coluna in cursor.fetchall()]

    # Se as colunas novas não existirem, adiciona elas na tabela antiga
    if "Check" not in colunas_existentes:
        cursor.execute('ALTER TABLE notas ADD COLUMN "Check" TEXT DEFAULT "-"')
    if "Status_Anterior" not in colunas_existentes:
        cursor.execute('ALTER TABLE notas ADD COLUMN Status_Anterior TEXT DEFAULT "-"')
    if "Nota_Mae" not in colunas_existentes:
        cursor.execute("ALTER TABLE notas ADD COLUMN Nota_Mae TEXT DEFAULT '-'")
    if "origem" not in colunas_existentes:
        cursor.execute("ALTER TABLE notas ADD COLUMN origem TEXT")

    # Migração: concatena Status_Obra em Observacao (mantendo apenas Observacao e Check).
    # É um UPDATE em massa e só chega aqui no perfil local — o perfil de produção
    # retorna antes de qualquer DDL/DML de esquema, porque reescrever a base de
    # todo o setor não pode ser efeito colateral de um restart. Para aplicá-la
    # de propósito no banco compartilhado, rode uma vez com EDP_PERFIL=local e
    # INPUT_DB_PATH apontando para ele.
    try:
        if "Status_Obra" in colunas_existentes:
            cursor.execute("""
                UPDATE notas
                SET Observacao = CASE
                    WHEN (Observacao IS NULL OR TRIM(Observacao) IN ('', '-')) THEN Status_Obra
                    ELSE 'Status Obra: ' || TRIM(Status_Obra) || ' | ' || TRIM(Observacao)
                END
                WHERE Status_Obra IS NOT NULL AND TRIM(Status_Obra) NOT IN ('', '-');
            """)
            cursor.execute("UPDATE notas SET Status_Obra = '-' WHERE Status_Obra IS NOT NULL;")
    except Exception as e:
        print(f"Aviso migração Status_Obra (notas): {e}")

    try:
        cursor.execute("PRAGMA table_info(notas_ramal)")
        cols_ramal = [coluna[1] for coluna in cursor.fetchall()]
        if "Status_Obra" in cols_ramal:
            cursor.execute("""
                UPDATE notas_ramal
                SET Observacao = CASE
                    WHEN (Observacao IS NULL OR TRIM(Observacao) IN ('', '-')) THEN Status_Obra
                    ELSE 'Status Obra: ' || TRIM(Status_Obra) || ' | ' || TRIM(Observacao)
                END
                WHERE Status_Obra IS NOT NULL AND TRIM(Status_Obra) NOT IN ('', '-');
            """)
            cursor.execute("UPDATE notas_ramal SET Status_Obra = '-' WHERE Status_Obra IS NOT NULL;")
    except Exception as e:
        print(f"Aviso migração Status_Obra (notas_ramal): {e}")

    # Índices para acelerar auditoria e logs
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_log_alteracoes_nota ON log_alteracoes(Numero_Nota)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_log_alteracoes_data ON log_alteracoes(Data_Hora DESC)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_log_arquivos_data ON log_arquivos(Data_Hora DESC)')

    conn.commit()
    conn.close()


# ==============================================================================
# BACKUP ROTATIVO (local, síncrono — a rota decide o background)
# ==============================================================================
_BACKUP_LOCK = threading.Lock()


def _conectar_origem_backup(caminho: str) -> sqlite3.Connection:
    """Abre a origem existente sem criar um banco vazio durante uma corrida."""
    uri = Path(caminho).absolute().as_uri()
    if uri.startswith("file://") and not uri.startswith("file:///"):
        uri = f"file:////{uri.removeprefix('file://')}"
    uri = f"{uri}?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=30)


def realizar_backup(limite: int = 20, intervalo_horas: int = 2) -> None:
    """Serializa a criação e a rotação de backups dentro do worker."""
    with _BACKUP_LOCK:
        _realizar_backup_serializado(limite, intervalo_horas)


def _realizar_backup_serializado(limite: int, intervalo_horas: int) -> None:
    """Cria um backup rotativo do banco em ``config.data_dir()/"backups"``.

    Só cria um novo se o último tiver sido feito há mais de ``intervalo_horas``
    (``intervalo_horas=0`` sempre cria). Mantém no máximo ``limite`` arquivos.
    Síncrono: o agendamento em segundo plano fica a cargo da rota (BackgroundTasks).
    """
    caminho_db = obter_caminho_banco()
    if not os.path.exists(caminho_db):
        return

    diretorio_backup = str(config.data_dir() / "backups")
    if not os.path.exists(diretorio_backup):
        try:
            os.makedirs(diretorio_backup)
        except Exception:
            pass

    backups_existentes = glob.glob(os.path.join(diretorio_backup, "notas_departamento_*.db"))
    backups_existentes.sort(key=os.path.getmtime)

    if backups_existentes and intervalo_horas:
        ultimo_backup = backups_existentes[-1]
        tempo_ultimo = datetime.datetime.fromtimestamp(os.path.getmtime(ultimo_backup))
        if (datetime.datetime.now() - tempo_ultimo).total_seconds() < (intervalo_horas * 3600):
            return  # Já existe um backup recente, não cria duplicatas à toa

    data_hora_str = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    identificador = uuid.uuid4().hex
    nome_backup = f"notas_departamento_{data_hora_str}_{identificador}.db"
    caminho_backup = os.path.join(diretorio_backup, nome_backup)
    caminho_parcial = f"{caminho_backup}.partial"

    try:
        with closing(_conectar_origem_backup(caminho_db)) as conexao_origem:
            with closing(sqlite3.connect(caminho_parcial)) as conexao_backup:
                conexao_origem.backup(conexao_backup)
        os.replace(caminho_parcial, caminho_backup)
    except Exception as e:
        if os.path.exists(caminho_parcial):
            os.remove(caminho_parcial)
        print(f"Erro ao realizar backup: {e}")
        return

    backups_concluidos = glob.glob(
        os.path.join(diretorio_backup, "notas_departamento_*.db")
    )
    backups_concluidos.sort(key=os.path.getmtime)
    while len(backups_concluidos) > limite:
        backup_antigo = backups_concluidos.pop(0)
        try:
            if os.path.exists(backup_antigo):
                os.remove(backup_antigo)
        except FileNotFoundError:
            pass
        except OSError as e:
            print(f"Erro ao remover backup antigo: {e}")
            break


# ==============================================================================
# CONFIGURAÇÕES DINÂMICAS LOCAIS (JSON)
# ==============================================================================
def _caminho_responsaveis() -> str:
    return str(config.data_dir() / "config_responsaveis.json")


def _caminho_emails_responsaveis() -> str:
    return str(config.data_dir() / "config_emails_responsaveis.json")


def carregar_responsaveis() -> dict:
    caminho = _caminho_responsaveis()
    if os.path.exists(caminho):
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    return dict(config.DE_PARA_RESPONSAVEIS_PADRAO)


def salvar_responsaveis(novo: dict) -> None:
    config.data_dir().mkdir(parents=True, exist_ok=True)
    with open(_caminho_responsaveis(), "w", encoding="utf-8") as f:
        json.dump(novo, f, ensure_ascii=False, indent=4)


def carregar_emails_responsaveis() -> dict:
    caminho = _caminho_emails_responsaveis()
    if os.path.exists(caminho):
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    return dict(config.EMAILS_RESPONSAVEIS_PADRAO)


def salvar_emails_responsaveis(novo: dict) -> None:
    config.data_dir().mkdir(parents=True, exist_ok=True)
    with open(_caminho_emails_responsaveis(), "w", encoding="utf-8") as f:
        json.dump(novo, f, ensure_ascii=False, indent=4)


def carregar_projeto_construcao() -> dict:
    """Carrega o mapa projeto/construção do JSON na rede; se ausente, devolve o padrão.

    Diferente do porte original, NÃO tenta escrever na rede quando o arquivo não
    existe — apenas retorna ``config.MAP_PROJETO_CONSTRUCAO_PADRAO``.
    """
    caminho = config.CAMINHO_PROJETO_CONSTRUCAO
    if os.path.exists(caminho):
        with open(caminho, "r", encoding="utf-8") as f:
            return json.load(f)
    return dict(config.MAP_PROJETO_CONSTRUCAO_PADRAO)


# ==============================================================================
# CARGA E PERSISTÊNCIA DE DADOS
# ==============================================================================
def carregar_dados(conn: sqlite3.Connection | None = None) -> pd.DataFrame:
    conexao_propria = conn is None
    if conexao_propria:
        conn = get_db_connection()
    try:
        df = pd.read_sql("SELECT * FROM notas ORDER BY ID_Cronologia ASC", conn)

        if 'Centro_Responsavel' in df.columns:
            df['Centro_Responsavel'] = df['Centro_Responsavel'].fillna('-')
        else:
            df['Centro_Responsavel'] = '-'
    finally:
        if conexao_propria:
            conn.close()

    if not df.empty:
        df['Status_Nota'] = df['Status_Nota'].map(STATUS_MAP)

        meses_pt = {
            1: 'jan', 2: 'fev', 3: 'mar', 4: 'abr',
            5: 'maio', 6: 'jun', 7: 'jul', 8: 'ago',
            9: 'set', 10: 'out', 11: 'nov', 12: 'dez'
        }
        dt_mes = pd.to_datetime(df['Mes_Execucao_Planejado'], errors='coerce', format='mixed')
        mes_ano_formatado = dt_mes.dt.month.map(meses_pt) + '-' + dt_mes.dt.year.fillna(0).astype(int).astype(str)
        df['Mes_Execucao_Planejado'] = mes_ano_formatado.where(dt_mes.notna(), df['Mes_Execucao_Planejado'])

        def formatar_data_envio(val):
            if pd.isna(val) or str(val).strip().lower() in ["none", "nan", "-", "", "<na>"]:
                return "-"
            val_str = str(val).strip()
            try:
                return pd.to_datetime(val_str, dayfirst=True, format='mixed').strftime('%d/%m/%Y')
            except Exception:
                try:
                    return pd.to_datetime(val_str).strftime('%d/%m/%Y')
                except Exception:
                    return val_str

        df['Data_Envio_Projeto'] = df['Data_Envio_Projeto'].apply(formatar_data_envio)

        # Coluna Cidades
        df['Codigo_Busca'] = df['Local_Instalacao'].astype(str).str[:3]
        df['Cidade'] = df['Codigo_Busca'].map(DE_PARA_CIDADES)
        df = df.drop(columns=['Codigo_Busca'])

        # Limpeza de valores Nulos e texto "None"
        colunas_forcar_texto = [
            "Observacao", "Check", "Status_Obra", "Conjunto", "Circuito",
            "Local_Instalacao", "Regional", "Centro_Responsavel", "Prioridade_Nota", "Nota_Mae"
        ]

        for col in df.columns:
            if df[col].dtype == object or col in colunas_forcar_texto:
                # Força a conversão para string para lidar com colunas que vieram como numéricas (NaN)
                df[col] = df[col].fillna("").astype(str)
                df[col] = df[col].apply(lambda x: "" if str(x).strip().lower() in ["none", "nan", "null", "<na>"] else x)

                # Garante que a Observação e o Check também não fiquem com o traço "-" padrão
                if col in ["Observacao", "Check"]:
                    df[col] = df[col].apply(lambda x: "" if str(x).strip() == "-" else x)

        if "Nota_Mae" in df.columns:
            def _limpar_mae(v):
                if pd.isna(v):
                    return "-"
                s = str(v).strip()
                if s.lower() in ["", "-", "none", "nan", "null", "<na>", "0", "0.0", "."]:
                    return "-"
                if s.endswith(".0"):
                    s = s[:-2]
                return s
            df["Nota_Mae"] = df["Nota_Mae"].apply(_limpar_mae)

        # Normaliza acentuação de prioridades comuns vindas do banco
        if 'Prioridade_Nota' in df.columns:
            df['Prioridade_Nota'] = df['Prioridade_Nota'].astype(str).str.strip()
            df['Prioridade_Nota'] = df['Prioridade_Nota'].replace({
                'Programavel': 'Programável', 'programavel': 'Programável',
                'PROGRAMAVEL': 'Programável', 'Prioritario': 'Prioritário',
                'prioritario': 'Prioritário', 'PRIORITARIO': 'Prioritário',
            })

    else:
        df = pd.DataFrame(columns=[
            "ID_Cronologia", "Numero_Nota", "Status_Obra", "Conjunto", "Circuito",
            "Local_Instalacao", "Cidade", "Regional", "Planejado_DDPM",
            "Mes_Execucao_Planejado", "Data_Envio_Projeto", "Status_Nota",
            "Prioridade_Nota", "Observacao", "Centro_Responsavel", "Check", "Status_Anterior"
        ])

    return df


def _proximo_id_cronologia(cursor: sqlite3.Cursor) -> int:
    """Próximo ID_Cronologia livre, lido dentro da transação que vai gravar.

    Ler de um DataFrame carregado antes da escrita devolve o mesmo número para
    duas criações concorrentes; aqui o valor é apurado com o lock de escrita já
    tomado.
    """
    maximo = cursor.execute(
        "SELECT MAX(CAST(ID_Cronologia AS INTEGER)) FROM notas").fetchone()[0]
    return int(maximo) + 1 if maximo is not None else 1


def carregar_logs() -> pd.DataFrame:
    """Carrega todos os registros da tabela de log de alterações."""
    conn = get_db_connection()
    try:
        return pd.read_sql("SELECT * FROM log_alteracoes ORDER BY Data_Hora DESC", conn)
    except Exception:
        return pd.DataFrame(columns=["ID_Log", "Numero_Nota", "Usuario",
                                     "Data_Hora", "Campo_Alterado",
                                     "Valor_Antigo", "Valor_Novo"])
    finally:
        conn.close()


_MESES_PT_REV = {
    'jan': 1, 'janeiro': 1, 'fev': 2, 'fevereiro': 2,
    'mar': 3, 'março': 3, 'marco': 3, 'abr': 4, 'abril': 4,
    'mai': 5, 'maio': 5, 'jun': 6, 'junho': 6,
    'jul': 7, 'julho': 7, 'ago': 8, 'agosto': 8,
    'set': 9, 'setembro': 9, 'out': 10, 'outubro': 10,
    'nov': 11, 'novembro': 11, 'dez': 12, 'dezembro': 12,
}


def converter_para_iso_data(val) -> str:
    if pd.isna(val) or str(val).strip() in ("", "-", "nan", "None"):
        return "-"
    val_str = str(val).strip().lower()
    try:
        dt = pd.to_datetime(val_str, errors='coerce', format='mixed')
        if pd.notna(dt):
            return dt.strftime('%Y-%m-%d')
    except Exception:
        pass
    parts = re.split(r'[-/\s]+', val_str)
    if len(parts) == 2:
        part_m, part_y = parts[0], parts[1]
        month = int(part_m) if part_m.isdigit() and 1 <= int(part_m) <= 12 else _MESES_PT_REV.get(part_m)
        year = None
        if part_y.isdigit():
            year = (2000 + int(part_y)) if len(part_y) == 2 else (int(part_y) if len(part_y) == 4 else None)
        if month and year:
            return f"{year:04d}-{month:02d}-01"
    elif len(parts) == 1:
        month = _MESES_PT_REV.get(parts[0])
        if month:
            return f"{datetime.datetime.now().year:04d}-{month:02d}-01"
    return val_str


def status_para_int(val):
    if pd.isna(val) or str(val).strip() == "-":
        return None
    val_str = str(val).strip()

    # 1. BUSCA EXATA: Se o texto for exatamente o do Selectbox, retorna o ID na hora
    if val_str in INV_STATUS_MAP:
        return INV_STATUS_MAP[val_str]

    # 2. FALLBACK SEGURO: Caso venha de digitação manual ou logs parciais
    val_upper = val_str.upper()
    if "SUPR CANC" in val_upper:
        return 997
    if "SUPR" in val_upper:
        return 998
    if "ENCE EXEC" in val_upper:
        return 999

    match = re.search(r'^(\d+)', val_upper)
    if match:
        return int(match.group(1))
    return 0


# Colunas do plano gravadas por qualquer caminho de escrita de notas.
_COLUNAS_NOTAS = [
    "ID_Cronologia",
    "Numero_Nota", "Status_Obra", "Conjunto", "Circuito", "Local_Instalacao",
    "Regional", "Planejado_DDPM", "Mes_Execucao_Planejado", "Data_Envio_Projeto",
    "Status_Nota", "Prioridade_Nota", "Observacao", "Check", "Status_Anterior",
    "Centro_Responsavel", "origem", "Nota_Mae",
]

_RENOMES_NOTAS = {
    "Data Envio Projeto-DDPM": "Data_Envio_Projeto",
    "Data Envio Projeto": "Data_Envio_Projeto",
    "Data_Envio_Projeto-DDPM": "Data_Envio_Projeto",
    "Data Envio Projeto DDPM": "Data_Envio_Projeto",
    "Mês de Execução  Planejado - DDPM": "Mes_Execucao_Planejado",
    "Planejado-DDPM": "Planejado_DDPM",
}


def _normalizar_notas(df: pd.DataFrame) -> pd.DataFrame:
    """Padroniza nomes de coluna, tipos e defaults antes de gravar em `notas`."""
    df_salvar = df.copy().rename(columns=_RENOMES_NOTAS)

    df_salvar["Status_Nota"] = df_salvar["Status_Nota"].apply(status_para_int)

    if "Status_Anterior" not in df_salvar.columns:
        df_salvar["Status_Anterior"] = "-"
    df_salvar["Status_Anterior"] = df_salvar["Status_Anterior"].apply(status_para_int)

    if "Mes_Execucao_Planejado" in df_salvar.columns:
        df_salvar["Mes_Execucao_Planejado"] = (
            df_salvar["Mes_Execucao_Planejado"].apply(converter_para_iso_data))

    if "Check" not in df_salvar.columns:
        df_salvar["Check"] = "-"
    if "Centro_Responsavel" not in df_salvar.columns:
        df_salvar["Centro_Responsavel"] = "-"

    for coluna in _COLUNAS_NOTAS:
        if coluna not in df_salvar.columns:
            df_salvar[coluna] = "-"
    return df_salvar


def _colunas_gravaveis(cursor: sqlite3.Cursor) -> list[str]:
    """Interseção entre as colunas conhecidas e as existentes no banco ativo."""
    colunas_no_banco = {c[1] for c in cursor.execute("PRAGMA table_info(notas)")}
    return [coluna for coluna in _COLUNAS_NOTAS if coluna in colunas_no_banco]


def salvar_em_massa(df: pd.DataFrame) -> None:
    """UPSERT do plano: usado por cargas e sincronizações que devem atualizar
    notas já existentes. Criação de nota nova vai por `inserir_notas_novas`,
    que recusa o conflito em vez de sobrescrever."""
    realizar_backup()
    df_salvar = _normalizar_notas(df)

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        colunas = _colunas_gravaveis(cursor)
        registros = df_salvar[colunas].to_records(index=False).tolist()

        assignments = []
        for col in colunas:
            if col == "Numero_Nota":
                continue
            if col == "Nota_Mae":
                assignments.append(
                    '"Nota_Mae" = CASE WHEN excluded."Nota_Mae" NOT IN (\'-\', \'\', \'None\', \'null\') AND excluded."Nota_Mae" IS NOT NULL '
                    'THEN excluded."Nota_Mae" ELSE notas."Nota_Mae" END'
                )
            else:
                assignments.append(f'"{col}" = excluded."{col}"')
        update_assignments = ',\n'.join(assignments)

        sql_upsert = f'''
            INSERT INTO notas ({', '.join(f'"{c}"' for c in colunas)})
            VALUES ({', '.join(['?'] * len(colunas))})
            ON CONFLICT(Numero_Nota) DO UPDATE SET
                {update_assignments};
        '''

        cursor.executemany(sql_upsert, registros)
        conn.commit()
    except Exception as e:
        print(f"Erro no banco: {e}")
        raise e
    finally:
        conn.close()


def inserir_notas_novas(df: pd.DataFrame, logs: list | None = None) -> int:
    """Insere notas inéditas: decide a duplicidade e grava no mesmo
    `BEGIN IMMEDIATE`.

    Sem o limite transacional único, duas criações simultâneas do mesmo
    `Numero_Nota` liam o banco antes de gravar, passavam as duas na validação e
    a segunda virava um UPDATE silencioso por cima da primeira. Aqui a perdedora
    recebe `NotasDuplicadasErro` (HTTP 409 nas rotas) e não grava nada.

    ``logs`` entra na mesma transação (mesmo formato de `salvar_log_alteracoes`):
    nota criada sem trilha de auditoria — ou trilha sem nota — deixa de ser um
    estado possível.
    """
    if df.empty:
        return 0

    realizar_backup()
    df_salvar = _normalizar_notas(df)
    numeros = [int(numero) for numero in df_salvar["Numero_Nota"].tolist()]

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("BEGIN IMMEDIATE")
        marcadores = ",".join("?" * len(numeros))
        existentes = sorted(
            str(linha[0]) for linha in cursor.execute(
                f"SELECT Numero_Nota FROM notas WHERE Numero_Nota IN ({marcadores})",
                numeros,
            ).fetchall()
        )
        if existentes:
            conn.rollback()
            raise NotasDuplicadasErro(
                "Notas já existentes no banco: " + ", ".join(existentes))

        primeiro_id = _proximo_id_cronologia(cursor)
        df_salvar["ID_Cronologia"] = range(primeiro_id, primeiro_id + len(df_salvar))

        colunas = _colunas_gravaveis(cursor)
        registros = df_salvar[colunas].to_records(index=False).tolist()
        nomes = ", ".join(f'"{coluna}"' for coluna in colunas)
        valores = ", ".join(["?"] * len(colunas))
        cursor.executemany(
            f"INSERT INTO notas ({nomes}) VALUES ({valores})", registros)
        if logs:
            cursor.executemany(SQL_LOG_ALTERACOES, logs)
        conn.commit()
        return len(registros)
    except sqlite3.IntegrityError as erro:
        conn.rollback()
        raise NotasDuplicadasErro(
            "Notas já existentes no banco: "
            + ", ".join(str(numero) for numero in numeros)) from erro
    finally:
        conn.close()


SQL_LOG_ALTERACOES = '''
    INSERT INTO log_alteracoes (Numero_Nota, Usuario, Data_Hora, Campo_Alterado, Valor_Antigo, Valor_Novo)
    VALUES (?, ?, ?, ?, ?, ?)
'''


def salvar_log_alteracoes(logs: list) -> None:
    """Salva uma lista de alterações no log do banco de dados.

    A lista ``logs`` deve ser uma lista de tuplas no formato:
    (Numero_Nota, Usuario, Data_Hora, Campo_Alterado, Valor_Antigo, Valor_Novo)
    """
    if not logs:
        return

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.executemany(SQL_LOG_ALTERACOES, logs)
        conn.commit()
    except Exception as e:
        print(f"Erro ao salvar log de alterações: {e}")
    finally:
        conn.close()


def deletar_notas(lista_numeros_nota: list, usuario: str = "sistema", motivo: str | None = None) -> int:
    """Exclui notas do banco e registra a exclusão no log de auditoria.

    Pula notas travadas por OUTRO usuário — quem está no meio de uma edição
    não pode ter a nota apagada por baixo dela. O log e o DELETE ocorrem na
    mesma transação.
    """
    realizar_backup()
    if not lista_numeros_nota:
        return 0

    numeros = list(dict.fromkeys(int(n) for n in lista_numeros_nota))
    bloqueios = obter_bloqueios(numeros)
    permitidos = [n for n in numeros
                 if not (bloqueios.get(n) and bloqueios[n]["usuario"] != usuario)]
    bloqueados = [n for n in numeros if n not in permitidos]
    if not permitidos:
        print(f"Aviso: {len(bloqueados)} nota(s) não excluída(s) — em edição "
              f"por outro usuário: {bloqueados}")
        return 0

    conn = get_db_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("BEGIN IMMEDIATE")
        marcadores = ",".join("?" * len(permitidos))
        linhas_bloqueio = cursor.execute(
            f"SELECT Numero_Nota, Usuario, Data_Hora FROM bloqueios "
            f"WHERE Numero_Nota IN ({marcadores})",
            permitidos,
        ).fetchall()
        bloqueios_atuais = {
            numero: dono
            for numero, dono, data_hora in linhas_bloqueio
            if not _bloqueio_expirado(data_hora)
        }
        permitidos = [
            numero for numero in permitidos
            if bloqueios_atuais.get(numero, usuario) == usuario
        ]
        bloqueados = [numero for numero in numeros if numero not in permitidos]
        if bloqueados:
            print(f"Aviso: {len(bloqueados)} nota(s) não excluída(s) — em edição "
                  f"por outro usuário: {bloqueados}")
        if not permitidos:
            conn.rollback()
            return 0

        marcadores_existentes = ",".join("?" * len(permitidos))
        notas_existentes = {
            linha[0] for linha in cursor.execute(
                f"SELECT Numero_Nota FROM notas "
                f"WHERE Numero_Nota IN ({marcadores_existentes})",
                permitidos,
            ).fetchall()
        }
        permitidos = [
            numero for numero in permitidos if numero in notas_existentes
        ]
        if not permitidos:
            conn.rollback()
            return 0

        data_hora_log = datetime.datetime.now()
        desc_motivo = f"Registro Apagado (Motivo: {motivo.strip()})" if motivo and motivo.strip() else "Registro Apagado"
        logs_exclusao = [
            (nota, usuario, data_hora_log,
             "EXCLUSÃO DE NOTA", "Registro Existente", desc_motivo)
            for nota in permitidos
        ]
        cursor.executemany('''
            INSERT INTO log_alteracoes (Numero_Nota, Usuario, Data_Hora, Campo_Alterado, Valor_Antigo, Valor_Novo)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', logs_exclusao)

        cursor.executemany('DELETE FROM notas WHERE Numero_Nota = ?',
                           [(n,) for n in permitidos])
        count = cursor.rowcount
        cursor.executemany('DELETE FROM bloqueios WHERE Numero_Nota = ?',
                           [(n,) for n in permitidos])
        conn.commit()
        return count
    except Exception as e:
        print(f"Erro ao deletar notas do banco: {e}")
        raise e
    finally:
        conn.close()


# ==============================================================================
# BLOQUEIOS — trava por nota para edição concorrente no banco compartilhado.
#
# Reaproveita a tabela `bloqueios`, que já existe no schema real do banco da
# rede (legado, nunca portada antes por falta de uso). Trava é por TTL, sem
# heartbeat dedicado: cada clique numa célula de uma nota já travada pelo
# mesmo usuário chama travar_nota() de novo, o que renova o prazo via upsert.
# Se o usuário fecha a aba no meio de uma edição, o TTL expira sozinho — sem
# isso a nota ficaria travada para sempre.
# ==============================================================================
BLOQUEIO_TTL_MINUTOS = 20


def _bloqueio_expirado(data_hora) -> bool:
    if not data_hora:
        return True
    if isinstance(data_hora, str):
        try:
            data_hora = datetime.datetime.fromisoformat(data_hora)
        except ValueError:
            return True
    limite = datetime.datetime.now() - datetime.timedelta(minutes=BLOQUEIO_TTL_MINUTOS)
    return data_hora < limite


def obter_bloqueios(numeros: list[int] | None = None) -> dict[int, dict]:
    """Bloqueios ATIVOS (não expirados), opcionalmente filtrados por número.

    Devolve ``{Numero_Nota: {"usuario": ..., "desde": ...}}``. Linhas expiradas
    não são apagadas aqui — é um caminho de leitura; elas somem quando alguém
    trava a mesma nota de novo (upsert em ``travar_nota``).
    """
    conn = get_db_connection()
    try:
        if numeros:
            marcadores = ",".join("?" * len(numeros))
            linhas = conn.execute(
                f"SELECT Numero_Nota, Usuario, Data_Hora FROM bloqueios "
                f"WHERE Numero_Nota IN ({marcadores})", numeros).fetchall()
        else:
            linhas = conn.execute(
                "SELECT Numero_Nota, Usuario, Data_Hora FROM bloqueios").fetchall()
    finally:
        conn.close()

    return {
        numero: {"usuario": usuario, "desde": str(data_hora)}
        for numero, usuario, data_hora in linhas
        if not _bloqueio_expirado(data_hora)
    }


def travar_nota(numero: int, usuario: str) -> dict:
    """Reivindica a edição de uma nota.

    Retorna ``{"ok": True}`` em caso de sucesso (nota livre, expirada, ou já
    travada pelo próprio ``usuario`` — renovando o TTL), ou ``{"ok": False,
    "usuario": ..., "desde": ...}`` se outra pessoa estiver editando agora.
    """
    conn = get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        linha = conn.execute(
            "SELECT Usuario, Data_Hora FROM bloqueios WHERE Numero_Nota = ?",
            (numero,),
        ).fetchone()
        if linha and not _bloqueio_expirado(linha[1]) and linha[0] != usuario:
            conn.rollback()
            return {"ok": False, "usuario": linha[0], "desde": str(linha[1])}

        conn.execute(
            "INSERT INTO bloqueios (Numero_Nota, Usuario, Data_Hora) VALUES (?, ?, ?) "
            "ON CONFLICT(Numero_Nota) DO UPDATE SET "
            "Usuario = excluded.Usuario, Data_Hora = excluded.Data_Hora",
            (numero, usuario, datetime.datetime.now()))
        conn.commit()
        return {"ok": True}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def destravar_notas(numeros: list[int], usuario: str) -> int:
    """Libera os bloqueios que pertencem a ``usuario``.

    Não mexe em bloqueios de outra pessoa — um release tardio (ex.: usuário A
    demorou pra salvar, o TTL expirou e o usuário B já travou a mesma nota)
    não pode derrubar o lock de quem já assumiu o lugar.
    """
    if not numeros:
        return 0
    conn = get_db_connection()
    try:
        marcadores = ",".join("?" * len(numeros))
        cursor = conn.execute(
            f"DELETE FROM bloqueios WHERE Usuario = ? AND Numero_Nota IN ({marcadores})",
            [usuario, *numeros])
        conn.commit()
        return cursor.rowcount
    finally:
        conn.close()


# ==============================================================================
# RAMAL — CRUD para a tabela notas_ramal
# ==============================================================================
_COLUNAS_RAMAL = [
    "ID_Cronologia", "Numero_Nota", "Status_Obra", "Conjunto", "Circuito",
    "Local_Instalacao", "Planejado_DDPM", "Mes_Execucao_Planejado",
    "CenTrab_Respon", "Prioridade_Nota", "Observacao", "Extracao_Antiga",
    "Status_Nota", "Status_Anterior", "Check_Btzero", "Plano",
]
_COLUNAS_RAMAL_VAZIAS = [
    "ID_Cronologia", "Numero_Nota", "Status_Obra", "Conjunto", "Circuito",
    "Local_Instalacao", "Cidade", "Planejado_DDPM", "Mes_Execucao_Planejado",
    "CenTrab_Respon", "Prioridade_Nota", "Observacao", "Extracao_Antiga",
    "Status_Nota", "Status_Anterior", "Check_Btzero", "Plano",
]
_MESES_PT = {1: 'jan', 2: 'fev', 3: 'mar', 4: 'abr', 5: 'maio', 6: 'jun',
             7: 'jul', 8: 'ago', 9: 'set', 10: 'out', 11: 'nov', 12: 'dez'}


def carregar_dados_ramal() -> pd.DataFrame:
    conn = get_db_connection()
    try:
        df = pd.read_sql("SELECT * FROM notas_ramal ORDER BY ID_Cronologia ASC", conn)
    except Exception:
        return pd.DataFrame(columns=_COLUNAS_RAMAL_VAZIAS)
    finally:
        conn.close()

    if df.empty:
        return pd.DataFrame(columns=_COLUNAS_RAMAL_VAZIAS)

    dt_mes = pd.to_datetime(df['Mes_Execucao_Planejado'], errors='coerce', format='mixed')
    mes_fmt = dt_mes.dt.month.map(_MESES_PT) + '-' + dt_mes.dt.year.fillna(0).astype(int).astype(str)
    df['Mes_Execucao_Planejado'] = mes_fmt.where(dt_mes.notna(), df['Mes_Execucao_Planejado'])

    df['Cidade'] = df['Local_Instalacao'].astype(str).str[:3].map(DE_PARA_CIDADES)

    texto_cols = ["Observacao", "Check_Btzero", "Status_Obra", "Conjunto", "Circuito",
                  "Local_Instalacao", "CenTrab_Respon", "Prioridade_Nota", "Extracao_Antiga", "Plano"]
    for col in df.columns:
        if df[col].dtype == object or col in texto_cols:
            df[col] = df[col].fillna("").astype(str)
            df[col] = df[col].apply(lambda x: "" if x.strip().lower() in ("none", "nan", "null", "<na>") else x)
    return df


def _resolver_id_cronologia_ramal(df: pd.DataFrame,
                                  cursor: sqlite3.Cursor) -> tuple[list, set]:
    """Mantém o ID_Cronologia de quem já existe e numera só as notas novas.

    Sem isso, um lote parcial (edição rápida manda só as notas alteradas)
    reescrevia ID_Cronologia = 1..n, colidindo com as demais linhas e
    embaralhando o ``ORDER BY ID_Cronologia`` da aba Ramal.

    Lê pelo cursor da transação de escrita e devolve, junto dos IDs, quais
    números já existiam — é o que distingue criação de atualização na trilha
    de auditoria.
    """
    existentes = dict(cursor.execute(
        "SELECT Numero_Nota, ID_Cronologia FROM notas_ramal").fetchall())
    maximo = cursor.execute(
        "SELECT MAX(ID_Cronologia) FROM notas_ramal").fetchone()[0] or 0

    proximo = int(maximo) + 1
    ids = []
    ja_existiam = set()
    for numero in df["Numero_Nota"]:
        atual = existentes.get(int(numero))
        if atual is None:
            ids.append(proximo)
            proximo += 1
        else:
            ids.append(int(atual))
            ja_existiam.add(int(numero))
    return ids, ja_existiam


def salvar_ramal_em_massa(df: pd.DataFrame, usuario: str = "sistema") -> None:
    """Importa notas de ramal em massa e registra a trilha de auditoria.

    O upsert e os logs ficam no mesmo `BEGIN IMMEDIATE`: a importação não passa
    a existir sem dizer quem a fez, e o `ID_Cronologia` é resolvido com o lock
    de escrita já tomado.
    """
    realizar_backup()
    df_s = df.copy()
    for col in _COLUNAS_RAMAL:
        if col not in df_s.columns:
            df_s[col] = "-"
    df_s['Planejado_DDPM'] = pd.to_numeric(df_s['Planejado_DDPM'], errors='coerce').fillna(0.0)
    if 'Mes_Execucao_Planejado' in df_s.columns:
        df_s['Mes_Execucao_Planejado'] = df_s['Mes_Execucao_Planejado'].apply(converter_para_iso_data)

    update = ',\n'.join([f'"{c}" = excluded."{c}"' for c in _COLUNAS_RAMAL if c != "Numero_Nota"])
    sql = f'''
        INSERT INTO notas_ramal ({', '.join(f'"{c}"' for c in _COLUNAS_RAMAL)})
        VALUES ({', '.join(['?'] * len(_COLUNAS_RAMAL))})
        ON CONFLICT(Numero_Nota) DO UPDATE SET {update};
    '''
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE")
        ids, ja_existiam = _resolver_id_cronologia_ramal(df_s, cursor)
        df_s['ID_Cronologia'] = ids
        registros = df_s[_COLUNAS_RAMAL].to_records(index=False).tolist()
        cursor.executemany(sql, registros)

        data_hora_log = datetime.datetime.now()
        logs = [
            (int(numero), usuario, data_hora_log, "IMPORTAÇÃO DE NOTA RAMAL", "-",
             "Registro Atualizado" if int(numero) in ja_existiam else "Registro Criado")
            for numero in df_s["Numero_Nota"]
        ]
        cursor.executemany(SQL_LOG_ALTERACOES, logs)
        conn.commit()
    except Exception as e:
        conn.rollback()
        print(f"Erro no banco (ramal): {e}")
        raise
    finally:
        conn.close()


def deletar_notas_ramal(lista_numeros_nota: list, usuario: str = "sistema") -> int:
    realizar_backup()
    if not lista_numeros_nota:
        return 0
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        data_hora_log = datetime.datetime.now()
        logs = [
            (int(n), usuario, data_hora_log, "EXCLUSÃO DE NOTA RAMAL", "Registro Existente", "Registro Apagado")
            for n in lista_numeros_nota
        ]
        cursor.executemany(
            'INSERT INTO log_alteracoes (Numero_Nota, Usuario, Data_Hora, Campo_Alterado, Valor_Antigo, Valor_Novo) VALUES (?,?,?,?,?,?)',
            logs,
        )
        cursor.executemany('DELETE FROM notas_ramal WHERE Numero_Nota = ?',
                           [(int(n),) for n in lista_numeros_nota])
        count = cursor.rowcount
        conn.commit()
        return count
    except Exception as e:
        print(f"Erro ao deletar notas ramal: {e}")
        raise
    finally:
        conn.close()


def vincular_nota_mae_lote(dados: dict, usuario: str) -> int:
    """Vincula notas filhas a uma nota mãe; dados = {nota_mae_str: [filha1, filha2, ...]}."""
    if not dados:
        return 0
    realizar_backup()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE")
        data_hora_log = datetime.datetime.now()
        logs, updates = [], []
        for nota_mae, filhas in dados.items():
            for filha in filhas:
                filha_int = int(filha)
                row = cursor.execute(
                    "SELECT Nota_Mae FROM notas WHERE Numero_Nota = ?", (filha_int,)
                ).fetchone()
                if row is None:
                    continue
                bloqueio = cursor.execute(
                    "SELECT Usuario, Data_Hora FROM bloqueios WHERE Numero_Nota = ?",
                    (filha_int,),
                ).fetchone()
                if (bloqueio and not _bloqueio_expirado(bloqueio[1])
                        and bloqueio[0] != usuario):
                    continue
                valor_antigo = row[0] if row and row[0] else "-"
                logs.append((filha_int, usuario, data_hora_log,
                             "VÍNCULO MÃE", str(valor_antigo), str(nota_mae)))
                updates.append((str(nota_mae), filha_int))
        if logs:
            cursor.executemany(
                'INSERT INTO log_alteracoes (Numero_Nota, Usuario, Data_Hora, Campo_Alterado, Valor_Antigo, Valor_Novo) VALUES (?,?,?,?,?,?)',
                logs,
            )
            cursor.executemany('UPDATE notas SET Nota_Mae = ? WHERE Numero_Nota = ?', updates)
        conn.commit()
        return len(updates)
    except Exception as e:
        conn.rollback()
        print(f"Erro em vincular_nota_mae_lote: {e}")
        raise
    finally:
        conn.close()


def _valor_para_coluna(campo: str, valor, ramal: bool = False):
    """Converte um valor vindo do log para a representação de armazenamento."""
    if not ramal and campo in ("Status_Nota", "Status_Anterior"):
        return status_para_int(valor)
    if campo == "Mes_Execucao_Planejado":
        return converter_para_iso_data(valor)
    return valor


def _mesmo_valor(gravado, esperado) -> bool:
    """Compara o valor no banco com o que o log diz que o usuário gravou.

    Tolerante de propósito: em caso de dúvida devolve True (= "não foi mexido
    por outra pessoa"), preservando o comportamento de reverter. Só uma
    diferença inequívoca caracteriza sobrescrita alheia.
    """
    a = "" if gravado is None else str(gravado).strip()
    b = "" if esperado is None else str(esperado).strip()
    if a == b:
        return True
    try:
        return float(a.replace(",", ".")) == float(b.replace(",", "."))
    except ValueError:
        return False


def reverter_ultima_alteracao(usuario: str):
    """Desfaz a última alteração DO PRÓPRIO USUÁRIO com base na tabela de log.

    Duas proteções, ambas necessárias quando o banco é o compartilhado do setor:

    1. Filtra por ``usuario`` — sem isso o botão "Reverter Última Alteração" de
       uma pessoa desfaria o trabalho de outra, já que o agrupamento é por
       timestamp.
    2. Só reverte o campo se o valor atual ainda for o que ESTE usuário gravou.
       Se alguém editou depois, reverter para o ``Valor_Antigo`` apagaria a
       edição mais recente — então o campo é pulado e contabilizado à parte.
    """
    realizar_backup()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute(
            "SELECT MAX(Data_Hora) FROM log_alteracoes WHERE Usuario = ?",
            (usuario,))
        result = cursor.fetchone()
        if not result or not result[0]:
            return False, f"Nenhuma alteração de {usuario} para desfazer."

        ultima_data_hora = result[0]

        cursor.execute(
            "SELECT ID_Log, Numero_Nota, Campo_Alterado, Valor_Antigo, Valor_Novo "
            "FROM log_alteracoes WHERE Data_Hora = ? AND Usuario = ?",
            (ultima_data_hora, usuario))
        logs = cursor.fetchall()

        if not logs:
            return False, "Nenhum detalhe encontrado para a última alteração."

        cursor.execute("PRAGMA table_info(notas)")
        colunas_validas_notas = {col[1] for col in cursor.fetchall()}

        cursor.execute("PRAGMA table_info(notas_ramal)")
        colunas_validas_ramal = {col[1] for col in cursor.fetchall()}

        alteracoes_revertidas = 0
        sobrescritas = 0

        def _reverter(tabela: str, colunas_validas: set, ramal: bool) -> None:
            """Reverte um campo se ele ainda tiver o valor que este usuário gravou."""
            nonlocal alteracoes_revertidas, sobrescritas
            if campo not in colunas_validas:
                cursor.execute("DELETE FROM log_alteracoes WHERE ID_Log = ?", (id_log,))
                return

            atual = cursor.execute(
                f'SELECT "{campo}" FROM {tabela} WHERE Numero_Nota = ?',
                (numero_nota,)).fetchone()
            if atual is not None and not _mesmo_valor(
                    atual[0], _valor_para_coluna(campo, valor_novo, ramal)):
                # Alguém editou depois: reverter aqui apagaria o trabalho dessa
                # pessoa. O log vira histórico e sai da fila de undo.
                sobrescritas += 1
                cursor.execute("DELETE FROM log_alteracoes WHERE ID_Log = ?", (id_log,))
                return

            cursor.execute(
                f'UPDATE {tabela} SET "{campo}" = ? WHERE Numero_Nota = ?',
                (_valor_para_coluna(campo, valor_antigo, ramal), numero_nota))
            cursor.execute("DELETE FROM log_alteracoes WHERE ID_Log = ?", (id_log,))
            alteracoes_revertidas += 1

        for id_log, numero_nota, campo, valor_antigo, valor_novo in logs:
            if campo in ("EXCLUSÃO DE NOTA", "EXCLUSÃO DE NOTA RAMAL"):
                cursor.execute("DELETE FROM log_alteracoes WHERE ID_Log = ?", (id_log,))
                alteracoes_revertidas += 1
                continue

            cursor.execute('SELECT 1 FROM notas WHERE Numero_Nota = ?', (numero_nota,))
            if cursor.fetchone():
                _reverter("notas", colunas_validas_notas, ramal=False)
                continue

            cursor.execute('SELECT 1 FROM notas_ramal WHERE Numero_Nota = ?', (numero_nota,))
            if cursor.fetchone():
                _reverter("notas_ramal", colunas_validas_ramal, ramal=True)
            else:
                cursor.execute("DELETE FROM log_alteracoes WHERE ID_Log = ?", (id_log,))

        conn.commit()

        data_formatada = str(ultima_data_hora)[:19]
        aviso = (f" {sobrescritas} campo(s) foram ignorados por já terem sido "
                 "alterados por outra pessoa depois.") if sobrescritas else ""
        return True, (f"Sucesso! {alteracoes_revertidas} alteração(ões) de "
                      f"{data_formatada} foram desfeitas.{aviso}")
    except Exception as e:
        conn.rollback()
        print(f"Erro ao reverter banco: {e}")
        return False, f"Erro interno na reversão: {e}"
    finally:
        conn.close()


def obter_data_ultima_alteracao():
    """Busca a data e hora exata da última modificação feita no banco."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT MAX(Data_Hora) FROM log_alteracoes")
        resultado = cursor.fetchone()
        return resultado[0] if resultado else None
    finally:
        conn.close()


# Prefixo da ação de exportação em `log_arquivos`. A exportação é auditada,
# mas não altera dado nenhum: fica de fora da versão do dataset para não
# disparar o aviso de "dados atualizados" em quem está com a tela aberta.
ACAO_EXPORTACAO = "Exportação"


def salvar_log_arquivo(nome_arquivo, usuario, data_hora, acao) -> bool:
    """Registra a auditoria de um arquivo. Retorna se a linha foi gravada.

    Continua best-effort — nenhuma importação é desfeita porque a auditoria
    falhou —, mas quem chama precisa poder avisar o usuário de que o upload
    entrou sem rastro. Falhar ao abrir o banco conta como não gravou.
    """
    try:
        conn = get_db_connection()
    except Exception as e:
        print(f"Erro ao salvar log de arquivo: {e}")
        return False
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO log_arquivos (Nome_Arquivo, Usuario, Data_Hora, Acao)
            VALUES (?, ?, ?, ?)
        ''', (nome_arquivo, usuario, data_hora, acao))
        conn.commit()
        return True
    except Exception as e:
        print(f"Erro ao salvar log de arquivo: {e}")
        return False
    finally:
        conn.close()


def carregar_log_arquivos() -> pd.DataFrame:
    conn = get_db_connection()
    try:
        return pd.read_sql("SELECT * FROM log_arquivos ORDER BY Data_Hora DESC", conn)
    except Exception:
        return pd.DataFrame(columns=["ID_Log", "Nome_Arquivo", "Usuario",
                                     "Data_Hora", "Acao"])
    finally:
        conn.close()


def salvar_base_dataframe(nome_tabela: str, df: pd.DataFrame) -> None:
    """Salva um DataFrame completo em uma tabela SQLite, substituindo-a.

    Segue o perfil ativo, como todo o resto: em produção as bases do SAP vivem
    no banco compartilhado, que é onde o robô SAP também as grava.

    Abrir a conexão é tratado à parte de propósito: `if_exists="replace"` dropa
    a tabela antiga, então uma falha durante o `to_sql` pode já ter mexido no
    banco, enquanto uma conexão que nem abriu não tocou em nada. Quem precisa
    dessa diferença captura `GravacaoNaoIniciadaErro`.
    """
    try:
        conn = get_db_connection()
    except Exception as e:
        raise GravacaoNaoIniciadaErro(
            f"Banco indisponível ao salvar tabela {nome_tabela}: {e}") from e
    try:
        df.to_sql(nome_tabela, conn, if_exists="replace", index=False)
    except Exception as e:
        print(f"Erro ao salvar tabela {nome_tabela}: {e}")
        raise e
    finally:
        conn.close()


def carregar_base_dataframe(nome_tabela: str) -> pd.DataFrame | None:
    """Carrega um DataFrame a partir da tabela SQLite ou com fallback para a planilha Excel de apoio."""
    conn = get_db_connection()
    try:
        df = pd.read_sql(f"SELECT * FROM {nome_tabela}", conn)
        if df is not None and not df.empty:
            return df
    except Exception:
        pass
    finally:
        conn.close()

    # Fallback robusto: se a tabela ainda não foi criada no SQLite, lê direto da planilha de apoio correspondente
    try:
        if nome_tabela == "base_custo_modular":
            if os.path.exists(config.CAMINHO_CUSTO_MODULAR):
                return pd.read_excel(config.CAMINHO_CUSTO_MODULAR, sheet_name='Modulares')
        elif nome_tabela == "base_sazonal":
            if os.path.exists(config.CAMINHO_CUSTO_MODULAR):
                return pd.read_excel(config.CAMINHO_CUSTO_MODULAR, sheet_name='Modulares', skiprows=1, nrows=4)
        elif nome_tabela == "base_clientes":
            if os.path.exists(config.CAMINHO_CLIENTES_CONJUNTO):
                return pd.read_excel(config.CAMINHO_CLIENTES_CONJUNTO)
        elif nome_tabela == "base_indicador_continuidade":
            if os.path.exists(config.CAMINHO_INDICADOR_CONTINUIDADE):
                return pd.read_excel(config.CAMINHO_INDICADOR_CONTINUIDADE)
        elif nome_tabela == "base_ganhos":
            if os.path.exists(config.CAMINHO_GANHOS):
                return pd.read_excel(config.CAMINHO_GANHOS, sheet_name='Ganhos')
    except Exception as e:
        print(f"Aviso: Fallback para leitura do Excel ({nome_tabela}) falhou: {e}")

    return None



# ==============================================================================
# EDIÇÃO COM DIFF (lógica server-side que substitui a UI do Streamlit)
# ==============================================================================
# Campos que o usuário pode editar pela UI (Input/app.py:540)
CAMPOS_EDITAVEIS = [
    "Status_Nota", "Status_Obra", "Prioridade_Nota", "Planejado_DDPM", "Observacao",
    "Conjunto", "Circuito", "Local_Instalacao",
    "Mes_Execucao_Planejado", "Data_Envio_Projeto", "Check",
]


def aplicar_edicoes(linhas: list, usuario: str) -> dict:
    """Aplica edições parciais: diff campo a campo, log e upsert.

    Cada item de ``linhas`` é um dict com Numero_Nota + os campos editados.
    A comparação usa a MESMA representação formatada de ``carregar_dados()``
    (status como texto, datas formatadas), que é o que a UI exibe e envia.

    Notas travadas por OUTRO usuário são puladas — não entram no diff, não
    geram log, não são salvas — e voltam em ``bloqueadas`` no retorno, para a
    UI manter a edição pendente do usuário em vez de descartá-la.
    """
    realizar_backup()
    linhas_por_numero = {}
    for linha in linhas:
        numero = int(linha["Numero_Nota"])
        linhas_por_numero.setdefault(numero, {}).update(linha)
        linhas_por_numero[numero]["Numero_Nota"] = numero
    linhas = list(linhas_por_numero.values())
    numeros = list(linhas_por_numero)
    conn = get_db_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        df_banco = carregar_dados(conn)
        if df_banco.empty:
            raise ValueError("Banco vazio: nenhuma nota para editar.")
        df_banco = df_banco.set_index("Numero_Nota", drop=False)
        colunas_no_banco = {
            coluna[1] for coluna in conn.execute("PRAGMA table_info(notas)")
        }

        marcadores = ",".join("?" * len(numeros))
        linhas_bloqueio = conn.execute(
            f"SELECT Numero_Nota, Usuario, Data_Hora FROM bloqueios "
            f"WHERE Numero_Nota IN ({marcadores})",
            numeros,
        ).fetchall() if numeros else []
        bloqueios = {
            numero: {"usuario": dono, "desde": str(data_hora)}
            for numero, dono, data_hora in linhas_bloqueio
            if not _bloqueio_expirado(data_hora)
        }

        agora = datetime.datetime.now()
        logs, atualizacoes, bloqueadas = [], [], []
        for linha in linhas:
            numero = int(linha["Numero_Nota"])
            if numero not in df_banco.index:
                raise ValueError(f"Nota {numero} não existe no banco.")

            bloqueio = bloqueios.get(numero)
            if bloqueio and bloqueio["usuario"] != usuario:
                bloqueadas.append(numero)
                continue

            original = df_banco.loc[numero]
            mudancas = {}
            for campo in CAMPOS_EDITAVEIS:
                if campo not in linha or campo not in colunas_no_banco:
                    continue
                novo = "" if linha[campo] is None else str(linha[campo]).strip()
                antigo = "" if pd.isna(original.get(campo)) else str(original.get(campo)).strip()
                if novo != antigo:
                    mudancas[campo] = _valor_para_coluna(campo, linha[campo])
                    logs.append((numero, usuario, agora, campo, antigo, novo))
            if not mudancas:
                continue
            if "Status_Nota" in mudancas and "Status_Anterior" in colunas_no_banco:
                mudancas["Status_Anterior"] = status_para_int(original["Status_Nota"])
            if "Local_Instalacao" in mudancas and "Regional" in colunas_no_banco:
                mudancas["Regional"] = DE_PARA_REGIONAL.get(
                    str(mudancas["Local_Instalacao"])[:3], "-")
            atualizacoes.append((numero, mudancas))

        if logs:
            conn.executemany(
                "INSERT INTO log_alteracoes "
                "(Numero_Nota, Usuario, Data_Hora, Campo_Alterado, Valor_Antigo, Valor_Novo) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                logs,
            )
        for numero, mudancas in atualizacoes:
            atribuicoes = ", ".join(f'"{campo}" = ?' for campo in mudancas)
            conn.execute(
                f"UPDATE notas SET {atribuicoes} WHERE Numero_Nota = ?",
                [*mudancas.values(), numero],
            )
        conn.commit()
        return {"alteradas": len(atualizacoes), "campos": len(logs),
                "bloqueadas": bloqueadas}
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def obter_nota_plano(numero: int) -> dict | None:
    """Registro do plano na MESMA representação formatada de carregar_dados()."""
    df = carregar_dados()
    if df.empty or numero not in df["Numero_Nota"].values:
        return None
    return df[df["Numero_Nota"] == numero].iloc[0].to_dict()


# ==============================================================================
# VERSÃO DO DATASET (cache/ETag de GET /notas)
# ==============================================================================
def obter_versao_dataset() -> str:
    """Versão barata do dataset, derivada dos logs + contagem de notas.

    Muda quando: edição/exclusão/undo/criação (log_alteracoes), criação
    (COUNT de notas), importação de base (log_arquivos). A exportação também
    grava em `log_arquivos`, mas é filtrada aqui: ela não altera dado algum e
    não deve invalidar o cache de quem está com a tela aberta.
    É a moeda de revalidação do cache do engine e do ETag de GET /notas.

    `PRAGMA schema_version` entra como rede de segurança das importações de
    base: `salvar_base_dataframe` recria a tabela (`to_sql` com
    `if_exists="replace"`), e cada DROP/CREATE incrementa esse contador no
    cabeçalho do arquivo. Assim uma base trocada continua mudando a versão
    mesmo se o log de arquivos — que é best-effort — não tiver gravado; sem
    isso o navegador receberia 304 e seguiria servindo a base antiga.
    """
    conn = get_db_connection()
    try:
        max_alt = conn.execute("SELECT MAX(Data_Hora) FROM log_alteracoes").fetchone()[0]
        qtd_alt = conn.execute("SELECT COUNT(*) FROM log_alteracoes").fetchone()[0]
        max_arq = conn.execute(
            "SELECT MAX(Data_Hora) FROM log_arquivos "
            "WHERE Acao IS NULL OR Acao NOT LIKE ?",
            (f"{ACAO_EXPORTACAO}%",)).fetchone()[0]
        qtd_notas = conn.execute("SELECT COUNT(*) FROM notas").fetchone()[0]
        schema = conn.execute("PRAGMA schema_version").fetchone()[0]
    finally:
        conn.close()
    return f"{max_alt}|{qtd_alt}|{max_arq}|{qtd_notas}|{schema}"


# ==============================================================================
# METAS DO PLANO DE RECOMPOSIÇÃO (espelho do Controle...xlsx — ver metas.py)
# ==============================================================================
def substituir_metas(df_metas: pd.DataFrame, df_depara: pd.DataFrame,
                     df_postergacoes: pd.DataFrame | None = None) -> None:
    """Replace transacional das metas, do de-para e (quando fornecidas) das
    postergadas — o sync sempre traz o conjunto completo, numa única transação.

    df_postergacoes=None mantém a tabela de postergadas intocada (chamadas de
    2 args continuam válidas)."""
    conn = get_db_connection()
    try:
        conn.execute("DELETE FROM metas_plano")
        conn.execute("DELETE FROM planos_depara")
        df_metas[["Ano", "Mes", "Regional", "Plano", "Meta"]].to_sql(
            "metas_plano", conn, if_exists="append", index=False)
        df_depara[["Plano", "Nome_Curto", "Unidade", "Area", "Modular_RS",
                   "Ordem_Exibicao"]].to_sql(
            "planos_depara", conn, if_exists="append", index=False)
        if df_postergacoes is not None:
            conn.execute("DELETE FROM metas_postergadas")
            df_postergacoes[["Ano", "Mes", "Regional", "Plano", "Qtd"]].to_sql(
                "metas_postergadas", conn, if_exists="append", index=False)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def carregar_metas(ano: int) -> pd.DataFrame:
    conn = get_db_connection()
    try:
        return pd.read_sql("SELECT * FROM metas_plano WHERE Ano = ?", conn, params=(ano,))
    finally:
        conn.close()


def carregar_postergacoes(ano: int) -> pd.DataFrame:
    conn = get_db_connection()
    try:
        return pd.read_sql(
            "SELECT * FROM metas_postergadas WHERE Ano = ?", conn, params=(ano,))
    finally:
        conn.close()


def carregar_planos_depara() -> pd.DataFrame:
    conn = get_db_connection()
    try:
        return pd.read_sql(
            "SELECT * FROM planos_depara ORDER BY Ordem_Exibicao, Plano", conn)
    finally:
        conn.close()


def obter_estado_metas() -> dict | None:
    conn = get_db_connection()
    try:
        row = conn.execute(
            "SELECT arquivo_mtime, atualizadas_em, erro FROM metas_sync_estado WHERE id = 1"
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        return None
    return {"arquivo_mtime": row[0], "atualizadas_em": row[1], "erro": row[2]}


def gravar_estado_metas(arquivo_mtime: float, erro: str | None) -> None:
    agora = datetime.datetime.now().isoformat()
    conn = get_db_connection()
    try:
        conn.execute(
            """INSERT INTO metas_sync_estado (id, arquivo_mtime, atualizadas_em, erro)
               VALUES (1, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 arquivo_mtime=excluded.arquivo_mtime,
                 atualizadas_em=excluded.atualizadas_em,
                 erro=excluded.erro""",
            (arquivo_mtime, agora, erro))
        conn.commit()
    finally:
        conn.close()


def listar_numeros_nota() -> set[int]:
    """Contrato estreito de leitura: numeros de nota presentes no plano.

    Usado por outros modulos (ex.: Carteira) para derivar situacao sem
    duplicar SQL do engine. Devolve set vazio se o banco ainda nao existe.
    """
    if not os.path.exists(obter_caminho_banco()):
        return set()
    conn = get_db_connection()
    try:
        linhas = conn.execute("SELECT Numero_Nota FROM notas").fetchall()
    finally:
        conn.close()
    return {int(linha[0]) for linha in linhas if linha[0] is not None}
