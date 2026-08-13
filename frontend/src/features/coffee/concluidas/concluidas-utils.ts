import type { CoffeeNota } from '../types';

export function completionDate(nota: CoffeeNota): string {
  return nota.classificacao_em ?? nota.buscado_em;
}

export function notaMatches(nota: CoffeeNota, query: string): boolean {
  const terms = query
    .toLocaleLowerCase('pt-BR')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (terms.length === 0) return true;

  const fields = nota.dados_json ?? {};
  const local = [
    fields.cidade,
    fields.tipo_local_instalacao,
    fields.local_instalacao_numero,
  ]
    .filter((value) => value != null)
    .join('');

  const haystack = [nota.pk, nota.id_sap, local]
    .map((value) => String(value).toLocaleLowerCase('pt-BR'))
    .join(' ');

  return terms.some((term) => haystack.includes(term));
}
