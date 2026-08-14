"""Configuração do módulo COFFEE: chave da API, URL base, delays e constantes."""
import os
from pathlib import Path


def data_dir() -> Path:
    """Diretório de dados local (sobrescritível por env para testes)."""
    return Path(
        os.environ.get(
            "COFFEE_DATA_DIR", str(Path(__file__).resolve().parent.parent / "data")
        )
    )


COFFEE_API_KEY = os.environ.get(
    "COFFEE_API_KEY", "CC575E3C071BB24932AC90F1D9E59537AD9974D47582042098DA28E1"
)
DELAY_BUSCA = float(os.environ.get("COFFEE_DELAY_BUSCA", "1.0"))
DELAY_GERACAO = float(os.environ.get("COFFEE_DELAY_GERACAO", "0.5"))
# Era 120s fixo: uma nota lenta/travada podia prender até 360s (3 chamadas
# em _executar_geracao) o worker inteiro, e com fila sequencial isso travava
# todo o lote atrás dela. 30s corta o pior caso pra 90s por nota-problema.
TIMEOUT = float(os.environ.get("COFFEE_TIMEOUT", "30"))
# Processamento paralelo limitado dos jobs em lote (consulta/geração/SAP) —
# sequencial (1 nota por vez) não escalava com filas grandes.
MAX_WORKERS = int(os.environ.get("COFFEE_MAX_WORKERS", "4"))
SAP_PENDENTE = 10000000
SAP_DUPLICATA = 99999999


def base_url() -> str:
    """URL base da API externa. Falha claro se a chave não estiver definida."""
    if not COFFEE_API_KEY:
        raise RuntimeError(
            "COFFEE_API_KEY não definida — defina a variável de ambiente."
        )
    return f"https://coffee.edp.gpti.com.br/api/{COFFEE_API_KEY}/deolhonarede"


def ssl_verify() -> bool | str:
    """Modo de verificação TLS das chamadas COFFEE (parâmetro verify do httpx).

    A rede corporativa injeta um CA raiz auto-assinado na cadeia, que o bundle
    público do httpx rejeita. Controlado por COFFEE_SSL_VERIFY:
      - "false" (padrão): desliga a verificação (host interno da EDP);
      - "true": usa o bundle público padrão;
      - qualquer outro valor: caminho de um CA bundle .pem (recomendado em prod).
    """
    valor = os.environ.get("COFFEE_SSL_VERIFY", "false").strip()
    if valor.lower() in ("false", "0", "no", ""):
        return False
    if valor.lower() in ("true", "1", "yes"):
        return True
    return valor
