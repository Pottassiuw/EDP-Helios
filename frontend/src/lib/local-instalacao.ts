const LOCAL_INSTALACAO_RE = /^\d{3}[A-Z0-9]{2}\d{8}$/;

/** Remove acentos e baixa a caixa, pra comparar chaves de regra sem depender
 * de como a fonte escreveu separador ou grafia ("de instalação" vs
 * "instalacao"). A fonte gera o nome da regra a partir do nome da coluna
 * `chk_*` do banco — não é uma lista fixa que o Helios controla. */
const MARCAS_DIACRITICAS = new RegExp('[̀-ͯ]', 'g');

function normalizarChaveRegra(value: string): string {
  return value
    .normalize('NFD')
    .replace(MARCAS_DIACRITICAS, '')
    .toLowerCase();
}

export function regraLocalInstalacao(rule: string): boolean {
  const normalizado = normalizarChaveRegra(rule);
  return normalizado.includes('local') && normalizado.includes('instal');
}

export function normalizarLocalInstalacao(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function formatarLocalInstalacao(value: string | null | undefined): string {
  const clean = normalizarLocalInstalacao(value ?? '');
  return [clean.slice(0, 3), clean.slice(3, 5), clean.slice(5)]
    .filter(Boolean)
    .join('-');
}

export function localInstalacaoValido(value: string): boolean {
  return LOCAL_INSTALACAO_RE.test(value);
}

interface EdicaoLocalEntrada {
  consultado: boolean;
  ocupado: boolean;
  atual: string;
  proposto: string;
}

export function analisarEdicaoLocal({
  consultado,
  ocupado,
  atual,
  proposto,
}: EdicaoLocalEntrada): { podeSalvar: boolean; confirmado: boolean } {
  const disponivel = consultado && !ocupado && localInstalacaoValido(proposto);
  return {
    podeSalvar: disponivel && proposto !== atual,
    confirmado: disponivel && proposto === atual,
  };
}
