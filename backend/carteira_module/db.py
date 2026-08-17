"""Persistencia local da projecao da Carteira (SQLite, carteira.db)."""
import sqlite3

from carteira_module import config


def caminho_banco() -> str:
    config.data_dir().mkdir(parents=True, exist_ok=True)
    return str(config.data_dir() / "carteira.db")


def conectar() -> sqlite3.Connection:
    conn = sqlite3.connect(caminho_banco(), timeout=30, check_same_thread=False)
    # journal_mode=WAL é PERSISTENTE (header do db) — setado 1× em
    # inicializar_banco, não aqui: reexecutá-lo com outra conexão aberta
    # tentaria um checkpoint exclusivo e esperaria busy_timeout inteiro.
    # synchronous=NORMAL (par recomendado do WAL: fsync só no checkpoint,
    # seguro contra crash, escrita mais rápida) e busy_timeout são
    # per-conexão e baratos.
    conn.execute("PRAGMA synchronous = NORMAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.row_factory = sqlite3.Row
    return conn


def inicializar_banco() -> None:
    conn = conectar()
    conn.execute("PRAGMA journal_mode = WAL;")  # persistente; setado 1× aqui
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS nota_carteira (
            id_onr INTEGER PRIMARY KEY,
            id_sap TEXT,
            sap_real INTEGER,
            conjunto TEXT,
            descricao_conjunto TEXT,
            regional TEXT,
            csd_origem TEXT,
            empresa TEXT,
            quantidade INTEGER,
            quantidade_valida INTEGER,
            prioridade TEXT,
            prioridade_sap INTEGER,
            status_sap TEXT,
            data_encerramento_exec TEXT,
            local_instalacao TEXT,
            alimentador TEXT,
            executor TEXT,
            sintoma TEXT,
            componente_novo TEXT,
            kit TEXT,
            n_trafo TEXT,
            dispositivo_protecao TEXT,
            latitude TEXT,
            longitude TEXT,
            observacao TEXT,
            referencia_eletrica TEXT,
            hash_conteudo TEXT,
            sincronizado_em TEXT,
            criado_em TEXT,
            atualizado_em TEXT,
            ausente_na_origem_em TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_nc_regional ON nota_carteira(regional);
        CREATE INDEX IF NOT EXISTS ix_nc_conjunto ON nota_carteira(conjunto);
        CREATE INDEX IF NOT EXISTS ix_nc_status ON nota_carteira(status_sap);
        CREATE INDEX IF NOT EXISTS ix_nc_sapreal ON nota_carteira(sap_real);
        CREATE INDEX IF NOT EXISTS ix_nc_lookup_sap
            ON nota_carteira(id_sap, sap_real, sincronizado_em DESC, id_onr ASC);
        CREATE INDEX IF NOT EXISTS ix_nc_ausente ON nota_carteira(ausente_na_origem_em);
        CREATE INDEX IF NOT EXISTS ix_nc_enc ON nota_carteira(data_encerramento_exec);

        CREATE TABLE IF NOT EXISTS carteira_sync_execucoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            estrategia TEXT,
            iniciado_em TEXT,
            finalizado_em TEXT,
            status TEXT,
            refresh_marker TEXT,
            novas INTEGER,
            atualizadas INTEGER,
            inalteradas INTEGER,
            ausentes INTEGER,
            erro TEXT,
            versao_resultante TEXT
        );

        CREATE TABLE IF NOT EXISTS carteira_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT,
            trace_id TEXT,
            tipo TEXT,
            acao TEXT,
            detalhes TEXT,
            sucesso INTEGER
        );

        CREATE TABLE IF NOT EXISTS carteira_meta (
            chave TEXT PRIMARY KEY,
            valor TEXT
        );

        CREATE TABLE IF NOT EXISTS plano_movimentacoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_onr INTEGER,
            numero_nota TEXT,
            acao TEXT,
            usuario TEXT,
            lote_id TEXT,
            mes_execucao TEXT,
            status_obra TEXT,
            snapshot TEXT,
            movido_em TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_mov_id_onr ON plano_movimentacoes(id_onr);
        CREATE INDEX IF NOT EXISTS ix_mov_lote ON plano_movimentacoes(lote_id);
        """
    )
    # CREATE TABLE IF NOT EXISTS acima e no-op pra banco ja existente em disco
    # (arquivo .db anterior a essas colunas) — sem isso, um banco antigo nunca
    # ganha as colunas novas.
    cols_nota = [r[1] for r in conn.execute("PRAGMA table_info(nota_carteira)").fetchall()]
    if "observacao" not in cols_nota:
        conn.execute("ALTER TABLE nota_carteira ADD COLUMN observacao TEXT")
    if "referencia_eletrica" not in cols_nota:
        conn.execute("ALTER TABLE nota_carteira ADD COLUMN referencia_eletrica TEXT")
    conn.commit()
    conn.close()


def obter_meta(chave: str) -> str | None:
    conn = conectar()
    try:
        return obter_meta_na_conexao(conn, chave)
    finally:
        conn.close()


def obter_meta_na_conexao(conn: sqlite3.Connection, chave: str) -> str | None:
    row = conn.execute(
        "SELECT valor FROM carteira_meta WHERE chave = ?", (chave,)
    ).fetchone()
    return row["valor"] if row else None


def definir_meta(conn: sqlite3.Connection, chave: str, valor: str) -> None:
    conn.execute(
        "INSERT INTO carteira_meta(chave, valor) VALUES(?, ?) "
        "ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor",
        (chave, valor),
    )


def obter_versao() -> str:
    return obter_meta("versao") or "0"


def bump_versao(conn: sqlite3.Connection) -> None:
    atual = conn.execute(
        "SELECT valor FROM carteira_meta WHERE chave = 'versao'"
    ).fetchone()
    proximo = (int(atual["valor"]) if atual else 0) + 1
    definir_meta(conn, "versao", str(proximo))


def registrar_movimentacao(conn: sqlite3.Connection, movimentos: list[dict]) -> None:
    conn.executemany(
        "INSERT INTO plano_movimentacoes (id_onr, numero_nota, acao, usuario, "
        "lote_id, mes_execucao, status_obra, snapshot, movido_em) "
        "VALUES (:id_onr,:numero_nota,:acao,:usuario,:lote_id,:mes_execucao,"
        ":status_obra,:snapshot,:movido_em)",
        movimentos,
    )
