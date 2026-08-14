"""Dicionários de domínio e caminhos do módulo Input.

Porte de Input/config.py, sem dependência de Streamlit.
"""

import os
from pathlib import Path

# ── Caminhos locais ──────────────────────────────────────────────────────


def data_dir() -> Path:
    """Diretório de dados local (sobrescritível por env para testes)."""
    return Path(
        os.environ.get(
            "INPUT_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data")
        )
    )


# ── Perfil de execução ───────────────────────────────────────────────────
# "local"    → banco em backend/data/ (desenvolvimento e testes)
# "producao" → banco compartilhado da rede; sem fallback silencioso para o local
PERFIL_LOCAL = "local"
PERFIL_PRODUCAO = "producao"


def perfil() -> str:
    """Perfil ativo, lido de EDP_PERFIL (padrão: local)."""
    valor = os.environ.get("EDP_PERFIL", PERFIL_LOCAL).strip().lower()
    return PERFIL_PRODUCAO if valor == PERFIL_PRODUCAO else PERFIL_LOCAL


def em_producao() -> bool:
    return perfil() == PERFIL_PRODUCAO


def caminho_sap_robot() -> Path:
    """Script do robô SAP — vive em backend/Sap_Robot.py, não numa pasta de rede."""
    return Path(
        os.environ.get(
            "SAP_ROBOT_PATH", str(Path(__file__).resolve().parent.parent / "Sap_Robot.py")
        )
    )


def caminho_controle_recomposicao() -> Path:
    """Retorna a cópia local do Excel hospedado no SharePoint.

    ``CONTROLE_RECOMPOSICAO_PATH`` vence para ambientes que usam outro
    diretório. No padrão, a pasta sincronizada é montada com o usuário da
    máquina, evitando deixar o perfil do servidor fixo no código.
    """
    caminho_configurado = os.environ.get("CONTROLE_RECOMPOSICAO_PATH", "").strip()
    if caminho_configurado:
        return Path(caminho_configurado)

    usuario = (
        os.environ.get("USER")
        or os.environ.get("USERNAME")
        or Path.home().name
    )
    return (
        Path("C:/Users")
        / usuario
        / "EDP"
        / "O365_Planejamento_Manutencao_EDP_Brasil - Documentos"
        / "PLANO RECOMPOSIÇÃO"
        / "SP"
        / "2026"
        / "Controle Plano de Recomposição 2026.xlsx"
    )


# ── Caminhos da rede EDP ─────────────────────────────────────────────────
# Raiz sobrescritível por env: outra máquina/ambiente aponta para o próprio
# compartilhamento sem editar código (o default é o servidor usado hoje).
REDE_RAIZ = os.environ.get(
    "INPUT_REDE_RAIZ",
    r"\\ebeat-fp1\Documentos\Diretoria Tecnica\Engenharia\DSPM\Planejamento Distribuição 2016\Estrutura BI - DDPM",
)
REDE_INPUT_SQL = REDE_RAIZ + r"\INPUT SQL"
REDE_ARQUIVOS_SAP = REDE_INPUT_SQL + r"\Arquivos_SAP"
REDE_BASES_APOIO = REDE_INPUT_SQL + r"\Bases_Apoio"

REDE_DB_ORIGEM = REDE_INPUT_SQL + r"\notas_departamento.db"

CAMINHO_BASE_IW28 = REDE_ARQUIVOS_SAP + r"\Gerada_base_IW28.XLSX"
CAMINHO_CUSTO_ORD_IW38 = REDE_ARQUIVOS_SAP + r"\Gerada_custo_ord_IW38.XLSX"
CAMINHO_BASE_IW66 = REDE_ARQUIVOS_SAP + r"\Gerada_medidas_IW66.XLSX"
CAMINHO_INDICADOR_CONTINUIDADE = REDE_BASES_APOIO + r"\Indicador base conjunto - Limite Aneel.xlsx"
CAMINHO_CLIENTES_CONJUNTO = REDE_BASES_APOIO + r"\Clientes_Conjunto.xlsx"
CAMINHO_CUSTO_MODULAR = REDE_BASES_APOIO + r"\Custo_Modular.xlsx"
CAMINHO_GANHOS = REDE_BASES_APOIO + r"\Ganhos.xlsx"
CAMINHO_PROJETO_CONSTRUCAO = REDE_RAIZ + r"\config_projeto_construcao.json"
CAMINHO_COPIA_EXCEL = REDE_INPUT_SQL + r"\Base_Notas_Sincronizada.xlsx"
CAMINHO_INPUT_NOTA_RAIZ = REDE_RAIZ + r"\Input Nota.xlsx"


def caminho_banco_notas() -> str:
    """Banco de notas em uso, resolvido pelo perfil.

    Ordem: INPUT_DB_PATH (override explícito, usado também pelo robô SAP) →
    banco compartilhado da rede em produção → banco local em desenvolvimento.
    """
    explicito = os.environ.get("INPUT_DB_PATH", "").strip()
    if explicito:
        return explicito
    if em_producao():
        return REDE_DB_ORIGEM
    return str(data_dir() / "notas_departamento.db")


def mascarar_caminho(caminho: str) -> str:
    """Versão de um caminho segura para log: só host mascarado e nome do arquivo.

    ``\\\\servidor-xy\\Pasta\\...\\notas_departamento.db``
    vira ``\\\\se***xy\\…\\notas_departamento.db``.
    """
    nome = os.path.basename(caminho) or caminho
    if not caminho.startswith("\\\\"):
        return f"local:…\\{nome}"
    host = caminho[2:].split("\\", 1)[0]
    host_mascarado = host[:2] + "***" + host[-2:] if len(host) > 4 else "***"
    return f"\\\\{host_mascarado}\\…\\{nome}"

# Bases lidas pelo motor (para o meta.bases da API)
BASES_REDE = {
    "Extração SAP IW28 (Notas)": CAMINHO_BASE_IW28,
    "Extração SAP IW38 (Ordens)": CAMINHO_CUSTO_ORD_IW38,
    "Extração SAP IW66 (Medidas)": CAMINHO_BASE_IW66,
    "Indicador de Continuidade (Limite ANEEL)": CAMINHO_INDICADOR_CONTINUIDADE,
    "Clientes por Conjunto": CAMINHO_CLIENTES_CONJUNTO,
    "Custos Modulares e Sazonalidade": CAMINHO_CUSTO_MODULAR,
    "Ganhos (CHI-Conjunto)": CAMINHO_GANHOS,
}

# Bases gerenciáveis pela aba Configurações (download/upload) — Input/app.py:792-798
BASES_APOIO = {
    "Indicador de Continuidade (Limite ANEEL)": CAMINHO_INDICADOR_CONTINUIDADE,
    "Clientes por Conjunto": CAMINHO_CLIENTES_CONJUNTO,
    "Custos Modulares e Sazonalidade": CAMINHO_CUSTO_MODULAR,
    "Ganhos (CHI-Conjunto)": CAMINHO_GANHOS,
}

# ── Dicionários de domínio (porte literal de Input/config.py) ────────────
STATUS_MAP = {
    0: "00 Pendente",
    1: "01 Sem providência",
    2: "02 Predição de Sinal",
    3: "03 Estudo de Proteção",
    7: "07 Em analise",
    10: "10 Em planejamento",
    11: "11 Em execução",
    20: "20 Envio Entidade Externa",
    21: "21 Pré análise Projetos",
    27: "27 Levantamento campo",
    28: "28 Desenho",
    29: "29 Orçamento",
    30: "30 Aguardando material",
    31: "31 Aguardando equipe",
    32: "32 Aguardando terceiros",
    33: "33 Aguardando aprovação",
    34: "34 Aguardando liberação",
    35: "35 Aguardando orçamento",
    36: "36 Aguardando levantamento campo",
    37: "37 Aguardando desenho",
    38: "38 Aguardando estudo proteção",
    39: "39 Aguardando predição sinal",
    47: "47 Enviado Execução",
    51: "51 Ordem Liberada",
    52: "52 ADS e Viabilizado",
    53: "53 Programado Execução",
    54: "54 Executado/Energizado",
    55: "55 Cancelado",
    56: "56 Reprogramado Execução",
    57: "57 Reprogramado Planejamento",
    58: "58 Reprogramado Análise",
    59: "59 Reprogramado Levantamento",
    60: "60 Reprogramado Desenho",
    61: "61 Reprogramado Estudo Proteção",
    62: "62 Obra Suspensa",
    99: "99 Encerrado",
    997: "SUPR CANC",
    998: "SUPR",
    999: "ENCE EXEC",
}
INV_STATUS_MAP = {v: k for k, v in STATUS_MAP.items()}

DE_PARA_CIDADES = {
    "045": "Guarulhos",
    "130": "Mogi das Cruzes - SP",
    "150": "Biritiba Mirim",
    "275": "Salesópolis",
    "290": "Guararema",
    "155": "Suzano",
    "160": "Poá",
    "165": "Itaquaquecetuba",
    "170": "Ferraz de Vasconcelos",
    "270": "Pindamonhangaba - SP",
    "271": "Moreira César",
    "295": "Taubaté",
    "300": "Tremembé",
    "305": "Lorena",
    "306": "Canas - SP",
    "310": "Guaratinguetá",
    "312": "Potim - SP",
    "315": "Aparecida - SP",
    "320": "Roseira",
    "325": "Cachoeira Paulista - SP",
    "330": "Cruzeiro",
    "185": "São Sebastião, Litoral SP",
    "195": "Caraguatatuba",
    "175": "São José dos Campos",
    "190": "Monteiro Lobato",
    "280": "Santa Branca",
    "285": "Jacareí",
    "260": "Caçapava -SP",
    "265": "Jambeiro - SP",
    "BIR": "Biritiba Mirim",
    "GOP": "Guarulhos",
}

DE_PARA_REGIONAL = {
    "045": "Guarulhos",
    "130": "Mogi das Cruzes",
    "150": "Mogi das Cruzes",
    "275": "Mogi das Cruzes",
    "290": "Mogi das Cruzes",
    "155": "Mogi das Cruzes",
    "160": "Mogi das Cruzes",
    "165": "Mogi das Cruzes",
    "170": "Mogi das Cruzes",
    "270": "Guaratinguetá",
    "271": "Guaratinguetá",
    "295": "Guaratinguetá",
    "300": "Guaratinguetá",
    "305": "Guaratinguetá",
    "306": "Guaratinguetá",
    "310": "Guaratinguetá",
    "312": "Guaratinguetá",
    "315": "Guaratinguetá",
    "320": "Guaratinguetá",
    "325": "Guaratinguetá",
    "330": "Guaratinguetá",
    "185": "Litoral Norte",
    "195": "Litoral Norte",
    "175": "São José dos Campos",
    "190": "São José dos Campos",
    "280": "São José dos Campos",
    "285": "São José dos Campos",
    "260": "São José dos Campos",
    "265": "São José dos Campos",
    "BIR": "Mogi das Cruzes",
    "GOP": "Guarulhos",
}

DE_PARA_CJ_ANEEL = {
    "ASP": "ALEX SANFORD PETRASOLI",
    "AVP": "ALTOS DA VILA PAIVA",
    "APA": "APARECIDA",
    "ARA": "ARARETAMA",
    "BRR": "BARREIRO",
    "BOI": "BOISSUCANGA",
    "JUQ": "BOISSUCANGA",
    "MRE": "BOISSUCANGA",
    "OLR": "BOISSUCANGA",
    "PNO": "BOISSUCANGA",
    "SSC": "BOISSUCANGA",
    "UNA": "BOISSUCANGA",
    "BON": "BONSUCESSO",
    "ACT": "BONSUCESSO",
    "BCU": "BRAS CUBAS",
    "CAC": "CACAPAVA",
    "GER": "CACAPAVA",
    "CPA": "CACHOEIRA PAULISTA",
    "CAR": "CARAGUATATUBA",
    "BIR": "CESAR DE SOUZA",
    "CSO": "CESAR DE SOUZA",
    "MRM": "CESAR DE SOUZA",
    "NAG": "CESAR DE SOUZA",
    "SAL": "CESAR DE SOUZA",
    "SBR": "CESAR DE SOUZA",
    "USS": "CESAR DE SOUZA",
    "AMZ": "COLORADO",
    "CBR": "COLORADO",
    "COL": "COLORADO",
    "CRU": "CRUZEIRO",
    "DBE": "DONA BENTA",
    "DUT": "DUTRA",
    "FER": "FERRAZ",
    "GOP": "GOPOUVA",
    "GUE": "GUARAREMA",
    "INP": "GUARAREMA",
    "PRT": "GUARAREMA",
    "GUR": "GUARATINGUETÁ",
    "GUL": "GUARULHOS",
    "IPO": "IPORANGA",
    "ITQ": "ITAQUAQUECETUBA",
    "JAC": "JACAREI",
    "JNO": "JOAO NOVAES",
    "JCE": "JOSE CENTRO",
    "BVI": "KIDA MACEDO",
    "KMA": "KIDA MACEDO",
    "LOR": "LORENA",
    "MTQ": "MANTIQUEIRA",
    "MAS": "MASSAGUACU",
    "MCI": "MOGI CIDADE",
    "PIL": "PARQUE INDUSTRIAL",
    "JAM": "PARQUE TECNOLÓGICO",
    "PTE": "PARQUE TECNOLÓGICO",
    "MAP": "PEDREIRA",
    "PED": "PEDREIRA",
    "PME": "PIMENTAS",
    "PIC": "PINDAMONHANGABA",
    "PID": "PINDAMONHANGABA",
    "POA": "POA",
    "ROS": "ROSEIRA",
    "SLZ": "SANTA LUZIA",
    "SPA": "SANTA PAULA",
    "SJC": "SAO JOSE DOS CAMPOS",
    "CMB": "SAO LUIS",
    "JAR": "SAO LUIS",
    "SLU": "SAO LUIS",
    "SAT": "SATÉLITE",
    "SUZ": "SUZANO",
    "TAU": "TAUBATÉ",
    "URB": "URBANOVA",
    "VSL": "VALE DO SOL",
    "SKO": "VALTER JOSE DOS SANTOS",
    "VJS": "VALTER JOSE DOS SANTOS",
    "VGA": "VILA GALVAO",
    "VHE": "VILA HERMINIA",
}

MAP_FILTROS = {
    "Status": "Status_Nota",
    "Regional": "Regional",
    "Conjunto": "Conjunto",
    "Local Instalação": "Local_Instalacao",
    "Planejado": "Planejado_DDPM",
    "Mês Execução": "Mes_Execucao_Planejado",
    "Prioridade": "Prioridade_Nota",
    "Circuito": "Circuito",
    "Conjunto Crítico": "Conj.critico",
    "Ranking": "ranking",
    "Cidade": "Cidade",
    "CJ Aneel": "CJ_Aneel",
    "Subestação Conj": "substacao_conjunto",
    "Export Status": "Export_status",
    "Status Final": "Status_Final",
    "Status Anterior": "Status_Anterior",
    "Centro Responsável": "Centro_Responsavel",
    "Check Cancelado": "Check_Cancelado",
    "Ordem": "Ordem",
    "Status Usuário Ordem": "Status_Usuário_Ordem",
    "Status Sistema": "Status_Sistema",
    "Total Planejado Ordem": "Total_planejado_ordem",
    "Total Real Ordem": "Total_real_ordem",
    "Exec %": "Exec_percentagem_ordem",
    "Ordem Executada": "Ordem_Executada",
    "Modular": "Modular",
    "Total Planejado Modular": "Total_planejado_modular",
    "Medida SAP": "Medida_SAP",
    "Medida vs Planejado": "Medida_vs_Planejado",
    "Regional CSD": "Regional_CSD",
    "Nº Clientes Conjunto": "N_Clientes_Conjunto",
    "CHI": "CHI",
    "CIH": "CI",
    "Ocorrências": "Ocorrencia",  # Corrigido: Estava 'Ocorrencias'
    "DEC": "DEC",
    "FEC": "FEC",
    "CHI Conjunto": "CHI_Conj",  # Corrigido: Estava 'CHI_conjunto'
    "DIS Proteção": "Equipamento_Protecao",  # Corrigido: Estava 'DIS_Protecao'
    "CI-12M": "CI_12M",  # Corrigido: Traço trocado por underline
    "CHI-12M": "CHI_12M",  # Corrigido: Traço trocado por underline
    "Ocorrências-12M": "OCO_12M",  # Corrigido: Estava 'Ocorrencias-12M'
    "Ocorrências-3M": "OCO_3M",  # Corrigido: Estava 'Ocorrencias-3M'
    "DEC Prog. CHI": "DEC_PROG_CHI",  # Corrigido: Ajuste de capitalização
    "Data Envio Projeto": "Data_Envio_Projeto",
    "Data Envio Projeto-DDPM": "Data_Envio_Projeto",
    "Data_Envio_Projeto-DDPM": "Data_Envio_Projeto",
    "Data Envio Projeto DDPM": "Data_Envio_Projeto",
    "Observação": "Observacao",
}

MAP_ORDEM_EXECUTADA = {
    "-": "NÃO",
    "CANC INVE": "NÃO",
    "CANC INVE BLOQ": "NÃO",
    "CANC PLAR": "NÃO",
    "CANC PLAR BLOQ": "NÃO",
    "CANC VIAB INVE": "NÃO",
    "CANC VIAB INVE BLOQ": "NÃO",
    "INVE": "NÃO",
    "JAND ENER": "SIM",
    "JAND EXEC": "NÃO",
    "JAND EXPA": "NÃO",
    "JAND FISC": "NÃO",
    "JAND INVE": "SIM",
    "JAND INVE BLOQ": "SIM",
    "JAND INVE BLOQ ENTE": "SIM",
    "JAND INVE PPAG": "SIM",
    "JAND PLAR": "NÃO",
    "JAND PLAR BLOQ": "NÃO",
    "JAND PLAR BLOR": "NÃO",
    "JAND PLAR BLOR BLOQ": "NÃO",
    "JAND PPAG": "NÃO",
    "JAND PRES": "NÃO",
    "JAND VIAB": "NÃO",
    "JAND VIAB INVE BLOQ": "NÃO",
    "JAND PDEV": "NÃO",
}

MAP_REGIONAL_CSD = {
    "ALEX SANFORD PETRASOLI": "Poa/Suzano",
    "ALTOS DA VILA PAIVA": "São José dos Campos",
    "APARECIDA": "Guaratinguetá",
    "ARARETAMA": "Guaratinguetá",
    "BARREIRO": "Guaratinguetá",
    "BOISSUCANGA": "Litoral Norte",
    "BONSUCESSO": "Guarulhos",
    "BRAZ CUBAS": "Mogi das Cruzes",
    "BRAS CUBAS": "Mogi das Cruzes",
    "CAÇAPAVA": "Guaratinguetá",
    "CACAPAVA": "Guaratinguetá",
    "CACHOEIRA PAULISTA": "Guaratinguetá",
    "CARAGUA": "Litoral Norte",
    "CARAGUATATUBA": "Litoral Norte",
    "CESAR DE SOUZA": "Mogi das Cruzes",
    "COLORADO": "Poa/Suzano",
    "CRUZEIRO": "Guaratinguetá",
    "DONA BENTA": "Poa/Suzano",
    "DUTRA": "Guarulhos",
    "FERRAZ DE VASCONCELOS": "Poa/Suzano",
    "FERRAZ": "Poa/Suzano",
    "GOPOUVA": "Guarulhos",
    "GUARAREMA": "São José dos Campos",
    "GUARATINGUETA": "Guaratinguetá",
    "GUARATINGUETÁ": "Guaratinguetá",
    "GUARULHOS": "Guarulhos",
    "IPORANGA": "Guarulhos",
    "ITAQUAQUECETUBA": "Poa/Suzano",
    "JACAREI": "São José dos Campos",
    "JOAO NOVAES": "São José dos Campos",
    "JOSE CENTRO": "São José dos Campos",
    "KIDA MACEDO": "Guarulhos",
    "LORENA": "Guaratinguetá",
    "MANTIQUEIRA": "Guaratinguetá",
    "MASSAGUACU": "Litoral Norte",
    "MOGI CIDADE": "Mogi das Cruzes",
    "PARQUE INDUSTRIAL": "São José dos Campos",
    "PARQUE TECNOLOGICO": "São José dos Campos",
    "PARQUE TECNOLÓGICO": "São José dos Campos",
    "PEDREIRA": "Poa/Suzano",
    "PIMENTAS": "Guarulhos",
    "PINDAMONHANGABA": "Guaratinguetá",
    "POA": "Poa/Suzano",
    "ROSEIRA": "Guaratinguetá",
    "SANTA LUZIA": "São José dos Campos",
    "SANTA PAULA": "São José dos Campos",
    "SAO JOSE DOS CAMPOS": "São José dos Campos",
    "SAO LUIS": "Guarulhos",
    "SATELITE": "Guarulhos",
    "SATÉLITE": "Guarulhos",
    "SUZANO": "Poa/Suzano",
    "TAUBATE": "Guaratinguetá",
    "TAUBATÉ": "Guaratinguetá",
    "URBANOVA": "São José dos Campos",
    "VALE DO SOL": "São José dos Campos",
    "VALTER JOSE DOS SANTOS": "Guarulhos",
    "VILA GALVAO": "Guarulhos",
    "VILA HERMINIA": "Guarulhos",
}

PRIORIDADES = [
    "Emergente",
    "Urgente",
    "Importante",
    "Prioritário",
    "Programável",
    "Informativo",
    "Protheus",
    "Nota Projetos",
]

# Responsáveis padrão (Input/database.py:87-91) e projeto construção padrão
# (Input/database.py:106-120 — copiar literal)
DE_PARA_RESPONSAVEIS_PADRAO = {
    "Poa": "Danilo",
    "Suzano": "Danilo",
    "São José dos Campos": "James",
    "Guaratinguetá": "Danilo",
    "Litoral Norte": "Danilo",
    "Guarulhos": "James",
    "Mogi das Cruzes": "Fabricio",
}
MAP_PROJETO_CONSTRUCAO_PADRAO = {
    "ALEX SANFORD PETRASOLI": "SIM",
    "ALTOS DA VILA PAIVA": "-",
    "APARECIDA": "-",
    "ARARETAMA": "-",
    "BARREIRO": "-",
    "BOISSUCANGA": "SIM",
    "BONSUCESSO": "-",
    "BRAS CUBAS": "-",
    "CACAPAVA": "-",
    "CACHOEIRA PAULISTA": "-",
    "CARAGUATATUBA": "-",
    "CESAR DE SOUZA": "-",
    "COLORADO": "-",
    "CRUZEIRO": "-",
    "DONA BENTA": "SIM",
    "DUTRA": "-",
    "FERRAZ": "SIM",
    "GOPOUVA": "-",
    "GUARAREMA": "SIM",
    "GUARATINGUETÁ": "-",
    "GUARULHOS": "-",
    "IPORANGA": "-",
    "ITAQUAQUECETUBA": "-",
    "JACAREI": "-",
    "JOAO NOVAES": "-",
    "JOSE CENTRO": "-",
    "KIDA MACEDO": "-",
    "LORENA": "-",
    "MANTIQUEIRA": "-",
    "MASSAGUACU": "-",
    "MOGI CIDADE": "-",
    "PARQUE INDUSTRIAL": "-",
    "PARQUE TECNOLÓGICO": "-",
    "PEDREIRA": "-",
    "PIMENTAS": "-",
    "PINDAMONHANGABA": "-",
    "POA": "SIM",
    "ROSEIRA": "-",
    "SANTA LUZIA": "-",
    "SANTA PAULA": "-",
    "SAO JOSE DOS CAMPOS": "-",
    "SAO LUIS": "-",
    "SATÉLITE": "SIM",
    "SUZANO": "-",
    "TAUBATÉ": "-",
    "URBANOVA": "-",
    "VALE DO SOL": "-",
    "VALTER JOSE DOS SANTOS": "-",
    "VILA GALVAO": "-",
    "VILA HERMINIA": "-",
}

# Nomes amigáveis de coluna para exports (Input/app.py:67-84, mesma lógica)
NOMES_AMIGAVEIS = {v: k for k, v in MAP_FILTROS.items()}
NOMES_AMIGAVEIS.update(
    {
        "Numero_Nota": "Nº Nota (ID)",
        "Status_Nota": "Status Nota",
        "Prioridade_Nota": "Prioridade Nota",
        "Status_Obra": "Status Obra",
        "Planejado_DDPM": "Planejado",
        "Local_Instalacao": "Local Instalação",
        "Mes_Execucao_Planejado": "Mês Execução Planejado",
        "substacao_conjunto": "Subestação Conj",
        "CJ_Aneel": "Cj. Aneel",
        "Check": "Check",
        "Observacao": "Observação",
        "Centro_Responsavel": "Centro de Trabalho Responsável",
        "Total_planejado_ordem": "Total Planejado Ordem (R$)",
        "Total_real_ordem": "Total Real Ordem (R$)",
        "Modular": "Modular (R$)",
        "Data programada SAP": "Data programada SAP",
        "Comparação Data SAP": "Comparação Data SAP",
        "Status_SLA": "Status SLA",
        "Desvio_SLA": "Status de SLA / Desvio",
    }
)

# Colunas exibidas/exportadas na ordem do painel
COLUNAS_PAINEL = [
    "Regional",
    "Numero_Nota",
    "Nota_Mae",
    "Conjunto",
    "Circuito",
    "Local_Instalacao",
    "Planejado_DDPM",
    "Medida_SAP",
    "Medida_vs_Planejado",
    "Mes_Execucao_Planejado",
    "Data_Nota_SAP",
    "Data programada SAP",
    "Comparação Data SAP",
    "Data_Envio_Projeto",
    "Centro_Responsavel",
    "Prioridade_Nota",
    "Status_Nota",
    "Cidade",
    "Observacao",
    "CJ_Aneel",
    "substacao_conjunto",
    "Conj.critico",
    "ranking",
    "Check",
    "Export_status",
    "Status_Final",
    "Status_SLA",
    "Desvio_SLA",
    "Status_Anterior",
    "Check_Cancelado",
    "Ordem",
    "Status_Usuário_Ordem",
    "Status_Sistema",
    "Total_planejado_ordem",
    "Total_real_ordem",
    "Exec_percentagem_ordem",
    "Ordem_Executada",
    "Modular",
    "Total_planejado_modular",
    "Regional_CSD",
    "N_Clientes_Conjunto",
    "CHI",
    "CI",
    "Ocorrencia",
    "DEC",
    "FEC",
    "CHI_Conj",
    "Equipamento_Protecao",
]


MAPA_NOMES_EXCEL_LEGADO = {
    "Regional": "Regional",
    "Numero_Nota": "NOTA",
    "Nota_Mae": "Nota_Mae",
    "Status_Obra": "Status da Obra",
    "Conjunto": "Conjunto",
    "Circuito": "Circuito",
    "Local_Instalacao": "Local Instalação",
    "Planejado_DDPM": "Planejado-DDPM",
    "Medida_SAP": "Medida_SAP",
    "Medida_vs_Planejado": "Medida_vs_Planejado",
    "Mes_Execucao_Planejado": "Mês de Execução  Planejado - DDPM",
    "Data_Nota_SAP": "Data da Nota SAP",
    "Data programada SAP": "Data Programada SAP",
    "Comparação Data SAP": "Comparação Data SAP",
    "Data_Envio_Projeto": "Data Envio Projeto-DDPM",
    "Centro_Responsavel": "CenTrab respon/",
    "Prioridade_Nota": "Prioridade Nota",
    "Status_Nota": "Status Nota",
    "Cidade": "Cidade",
    "Observacao": "Observação",
    "CJ_Aneel": "CJ ANEEL",
    "substacao_conjunto": " SUBESTAÇÃO ",
    "Conj.critico": " Conj.Crítico ",
    "ranking": "Rankig",
    "Check": "Check",
    "Export_status": "EXPORT\nStatus",
    "Status_Final": "Status\nFinal",
    "Status_Anterior": "Status\nanterior",
    "Check_Cancelado": "Check\nCancelado",
    "Ordem": "Ordem",
    "Status_Usuário_Ordem": "Status usuário\nOrdem",
    "Status_Sistema": "Status do sistema",
    "Total_planejado_ordem": "Ordem\nTotal planejado",
    "Total_real_ordem": "Ordem\nTotal real",
    "Exec_percentagem_ordem": "%\nExecutado",
    "Ordem_Executada": "Considera\nOrdem Exec",
    "Modular": "Modular",
    "Total_planejado_modular": "Total Plan\nModular",
    "Regional_CSD": "Regional\nCSD",
    "N_Clientes_Conjunto": "Clientes Conj",
    "CHI": "CHI",
    "CI": "CI",
    "Ocorrencia": "Ocor.",
    "DEC": "DEC",
    "FEC": "FEC",
    "CHI_Conj": "CHI - Conj.",
    "Equipamento_Protecao": "DIS.PROTEÇÃO",
}

