"""Caminho canônico de escrita do módulo Input (reusado por rotas e integração)."""
import datetime
import os
import tempfile
import threading

import pandas as pd
from fastapi import BackgroundTasks
from pydantic import BaseModel

from input_module import config, db, engine

# Estado da migração inicial (resolvido uma vez por processo)
_migracao = {"resultado": None}
_banco_lock = threading.Lock()


def garantir_banco() -> str:
    """Resolve o banco de notas do perfil ativo (uma vez por processo).

    No perfil de produção uma falha de rede/permissão sobe como
    ``BancoRedeIndisponivelErro`` e é reavaliada na próxima requisição — nunca
    é convertida em fallback silencioso para o banco local.
    """
    with _banco_lock:
        if _migracao["resultado"] is None:
            resultado = db.migrar_da_rede_se_preciso()
            db.inicializar_banco()
            _registrar_conexao(resultado)
            _migracao["resultado"] = resultado
    return _migracao["resultado"]


def _registrar_conexao(resultado: str) -> None:
    """Log seguro da origem dos dados — sem caminho completo nem credenciais."""
    resumo = db.descrever_conexao()
    print(
        f"ℹ️ [input] ambiente={resumo['ambiente']} tipo={resumo['tipo']} "
        f"alvo={resumo['alvo']} database={resumo['database']} "
        f"status={resumo['status']} notas={resumo['qtd_notas']} "
        f"resolucao={resultado}"
    )
    if not config.em_producao():
        print("⚠️ [input] Perfil LOCAL: escritas ficam apenas nesta máquina e "
              "notas novas do banco da rede não aparecem até uma nova migração. "
              "Use EDP_PERFIL=producao no servidor do setor.")


def resetar_migracao() -> None:
    _migracao["resultado"] = None


def pos_escrita(tasks: BackgroundTasks) -> None:
    """Efeitos pós-escrita comuns a toda mutação do plano: invalida o cache em
    memória e agenda a cópia Excel de rede em background."""
    engine.invalidar_cache()
    tasks.add_task(engine.gerar_copia_excel_rede)


class NovaNota(BaseModel):
    Numero_Nota: int
    Status_Nota: str
    Prioridade_Nota: str
    Planejado_DDPM: float = 0.0
    Status_Obra: str = "-"
    Nota_Mae: str = "-"
    Conjunto: str = "-"
    Circuito: str = "-"
    Local_Instalacao: str = "-"
    Mes_Execucao_Planejado: str = "-"
    Data_Envio_Projeto: str = "-"
    Observacao: str = ""
    Check: str = "-"


# Conflito de criação: o tipo mora em db.py porque quem decide a duplicidade é
# a transação de escrita. Reexportado aqui pelo contrato já usado pelas rotas.
NotasDuplicadasErro = db.NotasDuplicadasErro


def _preparar_novas(notas: list[NovaNota], origem: str) -> pd.DataFrame:
    """Valida duplicidade dentro do lote e completa Regional/origem.

    A duplicidade contra o banco fica com `db.inserir_notas_novas`: decidir por
    um snapshot lido antes da escrita não impede uma criação concorrente.
    """
    numeros = [n.Numero_Nota for n in notas]
    repetidas_lote = {str(n) for n in numeros if numeros.count(n) > 1}
    if repetidas_lote:
        raise NotasDuplicadasErro(
            "Notas duplicadas no próprio lote: " + ", ".join(sorted(repetidas_lote)))
    linhas = []
    for nota in notas:
        registro = nota.model_dump()
        registro["Regional"] = config.DE_PARA_REGIONAL.get(str(nota.Local_Instalacao)[:3], "-")
        registro["Centro_Responsavel"] = "-"
        registro["Status_Anterior"] = "-"
        registro["origem"] = origem
        linhas.append(registro)
    return pd.DataFrame(linhas)


def _logs_de_criacao(notas: list[NovaNota], usuario: str,
                     origem: str) -> list[tuple]:
    """Trilha de auditoria da criação, no formato de `db.salvar_log_alteracoes`."""
    agora = datetime.datetime.now()
    usuario_log = (usuario or "sistema").strip()
    logs = []
    for n in notas:
        detalhes = f"Origem: {origem} | Status: {n.Status_Nota or '-'} | Conjunto: {n.Conjunto or '-'}"
        if n.Nota_Mae and n.Nota_Mae not in ("-", "None", "null"):
            detalhes += f" | Mãe: {n.Nota_Mae}"
        logs.append((
            int(n.Numero_Nota),
            usuario_log,
            agora,
            "CRIAÇÃO DE NOTA",
            "-",
            detalhes,
        ))
    return logs


def criar_notas(notas: list[NovaNota], usuario: str, origem: str = "manual") -> int:
    """Insere notas novas no plano com a auditoria na mesma transação; levanta
    NotasDuplicadasErro em conflito."""
    df_novas = _preparar_novas(notas, origem)
    return db.inserir_notas_novas(df_novas, _logs_de_criacao(notas, usuario, origem))


def atualizar_medidas_excel_local(lista_correcao: list[dict], relatorio_sap: list[dict]) -> None:
    caminho = config.CAMINHO_BASE_IW66
    if not os.path.exists(caminho):
        print(f"Aviso: Planilha IW66 local não encontrada em '{caminho}'. Ignorando atualização de arquivo físico.")
        return
    temporario = None
    try:
        df_m = pd.read_excel(caminho, engine="openpyxl")
        df_m['Nota'] = df_m['Nota'].fillna(0).astype(int).astype(str)
        
        for res in relatorio_sap:
            if res.get("Status") == "OK":
                nota_id_str = str(int(res.get("Nota")))
                item_corr = next(item for item in lista_correcao if str(int(item["nota"])) == nota_id_str)
                qtd_gravada = item_corr["quantidade"]
                und_gravada = item_corr["unidade"]
                
                # Nº de ordenação guarda metros ou un
                valor_m_ou_un = qtd_gravada * 1000 if und_gravada == 'km' else qtd_gravada
                
                mask = df_m['Nota'] == nota_id_str
                if mask.any():
                    df_m.loc[mask, 'Nº de ordenação'] = valor_m_ou_un
                else:
                    nova_linha = {col: "" for col in df_m.columns}
                    nova_linha['Nota'] = int(nota_id_str)
                    nova_linha['Nº de ordenação'] = valor_m_ou_un
                    df_m = pd.concat([df_m, pd.DataFrame([nova_linha])], ignore_index=True)
                    
        diretorio = os.path.dirname(os.path.abspath(caminho))
        with tempfile.NamedTemporaryFile(
                dir=diretorio, prefix=".iw66_", suffix=".xlsx", delete=False) as arquivo:
            temporario = arquivo.name
        df_m.to_excel(temporario, index=False, engine="openpyxl")
        pd.read_excel(temporario, engine="openpyxl")
        os.replace(temporario, caminho)
        temporario = None
        db.salvar_base_dataframe("base_iw66", df_m)
    finally:
        if temporario and os.path.exists(temporario):
            try:
                os.remove(temporario)
            except OSError as erro:
                print(f"Erro ao remover temporário IW66 '{temporario}': {erro}")


def executar_correcao_medidas(
    correcoes: list[dict],
    login_sap: str | None = None,
    senha_sap: str | None = None,
    modo_teste: bool = True,
    usuario: str = "sistema"
) -> list[dict]:
    # 1. Importar o robô SAP
    from Sap_Robot import alterar_medidas_sap
    
    # 2. Executar o robô
    relatorio = alterar_medidas_sap(
        correcoes,
        login_sap=login_sap,
        senha_sap=senha_sap,
        modo_teste=modo_teste
    )
    
    # 3. Se for bem-sucedido e não modo teste, atualiza planilha IW66 local e banco de dados local
    if not modo_teste:
        # A. Atualiza o Excel local e a tabela base_iw66 no SQLite
        atualizar_medidas_excel_local(correcoes, relatorio)
        
        # B. Atualiza a coluna Planejado_DDPM no SQLite local e grava logs de alterações
        conn = db.get_db_connection()
        cursor = conn.cursor()
        try:
            data_hora_log = datetime.datetime.now()
            updates = []
            logs = []
            for res in relatorio:
                if res.get("Status") == "OK":
                    nota_id = int(res.get("Nota"))
                    # Encontra a quantidade gravada
                    item = next(x for x in correcoes if int(x["nota"]) == nota_id)
                    qtd = item["quantidade"]
                    und = item["unidade"]
                    
                    # Formata o valor amigável da medida para o SQLite (ex: "318 m" ou "1 un")
                    if und == 'km':
                        valor_db = f"{int(round(qtd * 1000))} m"
                        planejado_db = float(qtd * 1000)
                    else:
                        valor_db = f"{int(round(qtd))} {und.lower()}"
                        planejado_db = float(qtd)
                    
                    row = cursor.execute("SELECT Planejado_DDPM FROM notas WHERE Numero_Nota = ?", (nota_id,)).fetchone()
                    val_antigo = row[0] if row else 0.0
                    
                    logs.append((nota_id, usuario, data_hora_log, "Planejado_DDPM", str(val_antigo), str(planejado_db)))
                    updates.append((planejado_db, nota_id))
                    
            if updates:
                cursor.executemany("UPDATE notas SET Planejado_DDPM = ? WHERE Numero_Nota = ?", updates)
                cursor.executemany(
                    "INSERT INTO log_alteracoes (Numero_Nota, Usuario, Data_Hora, Campo_Alterado, Valor_Antigo, Valor_Novo) VALUES (?,?,?,?,?,?)",
                    logs
                )
                conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"Erro ao atualizar banco local com correções de medidas: {e}")
            raise
        finally:
            conn.close()
            
        # Limpa cache do engine
        engine.invalidar_cache()
        engine.invalidar_status_bases()
        
    return relatorio

