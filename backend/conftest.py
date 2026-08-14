"""Blindagem global de testes: nenhum teste toca o banco de dados real.

Sobrescreve INCONDICIONALMENTE os diretórios de dados para um tmp de sessão
ANTES de qualquer import dos módulos de produção. Diferente de
``os.environ.setdefault`` (que vira no-op quando a variável já existe),
a atribuição direta vence uma env herdada apontando para ``backend/data``.

Cobre até testes que esquecem de usar a fixture de isolamento e arquivos de
teste sem guarda própria (ex.: carteira).

O PERFIL também é forçado para ``local``. Sem isso a blindagem tem um furo
real: ``config.caminho_banco_notas()`` devolve o banco COMPARTILHADO DA REDE
antes de sequer olhar para ``data_dir()`` quando ``EDP_PERFIL=producao`` — e
``main.py`` carrega o ``.env`` no import, então basta a variável estar lá para
a suíte inteira passar a escrever no banco de todo o setor.

``INPUT_REDE_RAIZ`` também é forçado para um caminho inexistente. Segundo
furo, mais sutil: mesmo em perfil local, ``migrar_da_rede_se_preciso()``
(chamada por ``garantir_banco()`` em toda rota) copia o banco da REDE por
cima do tmp de teste sempre que ele tem poucas notas (< 100) — o que é
sempre verdade logo após um teste inserir 1-2 notas fake. Sem este
override, testes de API acabavam de fato lendo (via SMB, ~15-60MB) o banco
compartilhado real do setor a cada execução — lento e o motivo dos 404
inexplicáveis em vários testes (a nota fake sumia, substituída pelos dados
reais). Com a raiz apontando para um caminho que não existe,
``os.path.exists(config.REDE_DB_ORIGEM)`` é sempre False e
``migrar_da_rede_se_preciso()`` cai em "rede-indisponivel" — sem tocar a rede.
"""
import os
import tempfile
import pytest

_tmp_dados_teste = tempfile.mkdtemp(prefix="edp_test_")
_rede_inexistente = os.path.join(_tmp_dados_teste, "rede-nao-existe-em-teste")

# Todos os módulos resolvem o diretório de dados por estas envs (config.data_dir()).
for _var in ("INPUT_DATA_DIR", "COFFEE_DATA_DIR", "CARTEIRA_DATA_DIR"):
    os.environ[_var] = _tmp_dados_teste

# Perfil e override de banco: o teste NUNCA resolve para a rede.
os.environ["EDP_PERFIL"] = "local"
os.environ.pop("INPUT_DB_PATH", None)
# REDE_RAIZ/REDE_DB_ORIGEM são constantes de MÓDULO (config.py), resolvidas no
# import a partir desta env — por isso precisa ser setada aqui, antes de
# qualquer `from input_module import config` na suíte.
os.environ["INPUT_REDE_RAIZ"] = _rede_inexistente


@pytest.fixture(scope="session", autouse=True)
def blindar_banco_producao():
    """Fixture de sessão executada automaticamente em todos os testes."""
    for _var in ("INPUT_DATA_DIR", "COFFEE_DATA_DIR", "CARTEIRA_DATA_DIR"):
        assert os.environ.get(_var) == _tmp_dados_teste
    assert os.environ.get("EDP_PERFIL") == "local"
    assert not os.environ.get("INPUT_DB_PATH")

    from input_module import config
    assert config.REDE_RAIZ == _rede_inexistente
    assert not os.path.exists(config.REDE_DB_ORIGEM)
    caminho = config.caminho_banco_notas()
    assert str(_tmp_dados_teste) in caminho, (
        f"Teste resolveria o banco para {caminho!r} — fora do tmp de teste.")
    yield

