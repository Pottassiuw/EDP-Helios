"""Casos de uso da Carteira: leitura paginada, resumo e sincronizacao."""
import json

from carteira_module import db, mapping, repository, sync
from input_module import db as input_db


def _numeros_no_plano() -> set[int]:
    return input_db.listar_numeros_nota()


# Cache do COUNT total por (versao_leitura, filtros): o COUNT com situação
# derivada é o custo dominante do request (~166 ms em 98k). A versão de leitura
# combina o dataset do Input (muda quando o plano muda → situação muda) e a
# versão da carteira (muda no sync) — invalida em qualquer um dos dois (Fase 4d).
_total_cache: dict[str, dict] = {}


def _versao_leitura() -> str:
    # A versão do Input entra na chave para invalidar contagens por situação
    # quando o plano muda sem sync da carteira. Guarda por existência do arquivo
    # (mesma cortesia de listar_numeros_nota) — NÃO chamar obter_versao_dataset
    # com o banco ausente: get_db_connection criaria o arquivo vazio e quebraria
    # o guard de listar_numeros_nota logo em seguida.
    import os
    if not os.path.exists(input_db.obter_caminho_banco()):
        return f"0-{db.obter_versao()}"
    return f"{input_db.obter_versao_dataset()}-{db.obter_versao()}"


def _chave_filtros(filtros: dict) -> tuple:
    return tuple(sorted((k, str(v)) for k, v in filtros.items()))


def pagina_notas(filtros: dict, page: int, size: int,
                 ordenar_por: str, ordem: str) -> dict:
    versao = _versao_leitura()
    cache = _total_cache.get(versao)
    if cache is None:
        _total_cache.clear()  # versão nova invalida todo o cache antigo
        cache = _total_cache[versao] = {}
    chave = _chave_filtros(filtros)

    conn = db.conectar()
    try:
        registros, total = repository.listar(
            conn, numeros_no_plano=_numeros_no_plano(), filtros=filtros,
            page=page, size=size, ordenar_por=ordenar_por, ordem=ordem,
            total_cache=cache.get(chave),
        )
    finally:
        conn.close()
    cache[chave] = total
    return {"registros": registros, "total": total, "page": page,
            "size": size, "versao": db.obter_versao()}


def metricas() -> dict:
    """Instrumentação da projeção (Fase 4d): tamanho e motor, para decidir com
    dado real se/quando migrar de SQLite (gate da Fase 4d storage)."""
    import os
    caminho = db.caminho_banco()
    conn = db.conectar()
    try:
        n_linhas = conn.execute("SELECT COUNT(*) FROM nota_carteira").fetchone()[0]
        journal = conn.execute("PRAGMA journal_mode").fetchone()[0]
    finally:
        conn.close()
    tamanho_mb = round(os.path.getsize(caminho) / 1e6, 1) if os.path.exists(caminho) else 0.0
    return {"n_linhas": n_linhas, "tamanho_mb": tamanho_mb, "journal_mode": journal}


def detalhe(id_onr: int) -> dict | None:
    conn = db.conectar()
    try:
        return repository.obter(conn, id_onr, _numeros_no_plano())
    finally:
        conn.close()


_CAMPOS_ENRIQUECIMENTO = (
    "descricao_conjunto",
    "conjunto",
    "sintoma",
    "componente_novo",
    "kit",
    "n_trafo",
    "dispositivo_protecao",
    "status_sap",
    "prioridade_sap",
)


def enriquecimento_por_sap(numero: int) -> dict:
    conn = db.conectar()
    try:
        conn.execute("BEGIN")
        versao = db.obter_meta_na_conexao(conn, "versao") or "0"
        avisos_json = db.obter_meta_na_conexao(
            conn, "avisos_enriquecimento") or "[]"
        try:
            avisos_brutos = json.loads(avisos_json)
        except (TypeError, json.JSONDecodeError):
            avisos_brutos = []
        resposta = {
            "numero_sap": numero,
            "estado": "base_nao_sincronizada",
            "dados": None,
            "ausente_na_origem_em": None,
            "avisos": mapping.normalizar_avisos(avisos_brutos),
            "versao": versao,
        }
        if versao == "0":
            return resposta

        nota = repository.obter_por_id_sap(conn, numero)
    finally:
        conn.close()

    if nota is None:
        resposta["estado"] = "sem_correspondencia"
        return resposta

    resposta["estado"] = (
        "ausente_na_origem"
        if nota["ausente_na_origem_em"] is not None
        else "encontrada"
    )
    resposta["dados"] = {
        campo: nota.get(campo)
        for campo in _CAMPOS_ENRIQUECIMENTO
    }
    resposta["ausente_na_origem_em"] = nota["ausente_na_origem_em"]
    return resposta


def resumo() -> dict:
    conn = db.conectar()
    try:
        return repository.resumo(conn, _numeros_no_plano())
    finally:
        conn.close()


def _duracao_seg(inicio: str | None, fim: str | None) -> float | None:
    import datetime
    if not inicio or not fim:
        return None
    try:
        delta = datetime.datetime.fromisoformat(fim) - datetime.datetime.fromisoformat(inicio)
        return round(delta.total_seconds(), 1)
    except ValueError:
        return None


def estado_sincronizacao() -> dict:
    estado = sync.estado()
    for execucao in estado.get("execucoes", []):
        execucao["duracao_seg"] = _duracao_seg(
            execucao.get("iniciado_em"), execucao.get("finalizado_em"))
    estado["metricas"] = metricas()
    return estado


def disparar_sincronizacao() -> dict:
    return sync.sincronizar()


def versao_dashboard() -> str:
    """Versao composta (input+carteira) para o ETag do dashboard — barata,
    permite responder 304 antes de montar o corpo pesado (padrao da rota de
    Relatorios do Input). Sincroniza metas (idempotente por mtime) para que a
    versao reflita um eventual reimport, casando com o corpo."""
    from input_module import metas
    metas.sincronizar_se_preciso()
    return f"{input_db.obter_versao_dataset()}-{db.obter_versao()}"


def dashboard(ano: int | None, mes: int | None, regional: str | None) -> dict:
    """Dashboard: reusa a agregacao dos Relatorios (meta/planejado/executado)
    e adiciona a camada 'base disponivel' (fora do plano) da carteira."""
    import datetime

    from input_module import engine, metas, relatorios
    from carteira_module import dashboard as dash_mod

    agora = datetime.datetime.now()
    ano = ano or agora.year
    mes = mes or agora.month

    estado_metas = metas.sincronizar_se_preciso()
    df_depara = input_db.carregar_planos_depara()
    base_dash = relatorios.montar_dashboard(
        engine.get_dataset(), input_db.carregar_dados_ramal(),
        input_db.carregar_metas(ano), df_depara,
        input_db.carregar_postergacoes(ano),
        ano=ano, mes_referencia=mes, regional=regional)
    base_dash["regionais_disponiveis"] = relatorios.REGIONAIS_CSD

    unidade_por_plano, nome_area_por_plano = {}, {}
    if not df_depara.empty:
        for _, linha in df_depara.iterrows():
            unidade_por_plano[linha["Plano"]] = linha.get("Unidade")
            nome_area_por_plano[linha["Plano"]] = (
                linha.get("Nome_Curto"), linha.get("Area"))

    conn = db.conectar()
    try:
        base_bruta = repository.base_por_plano(conn, _numeros_no_plano())
    finally:
        conn.close()

    corpo = dash_mod.montar(base_dash, base_bruta, unidade_por_plano,
                            nome_area_por_plano)
    corpo["metas_info"] = {
        "atualizadas_em": estado_metas.get("atualizadas_em"),
        "arquivo_mtime": estado_metas.get("arquivo_mtime"),
        "erro": estado_metas.get("erro"),
    }
    corpo["versao"] = f"{input_db.obter_versao_dataset()}-{db.obter_versao()}"
    return corpo
