import type { CoffeeOperacaoItem } from '../types';

export function operacaoItemMatches(item: CoffeeOperacaoItem, query: string): boolean {
  const terms = query
    .toLocaleLowerCase('pt-BR')
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (terms.length === 0) return true;

  const fields = item.nota?.dados_json ?? {};
  const localCompacto = [
    fields.cidade,
    fields.tipo_local_instalacao,
    fields.local_instalacao_numero,
  ]
    .filter((value) => value != null)
    .join('');

  const localFormatado = [
    fields.cidade,
    fields.tipo_local_instalacao,
    fields.local_instalacao_numero,
  ]
    .filter((value) => value != null && value !== '')
    .join('-');

  const haystack = [
    item.entrada_id,
    item.nota_pk,
    item.nota?.pk,
    item.nota?.id_sap,
    localCompacto,
    localFormatado,
    fields.local_instalacao,
    fields.cidade,
    fields.tipo_local_instalacao,
    fields.local_instalacao_numero,
  ]
    .filter((value) => value != null)
    .map((value) => String(value).toLocaleLowerCase('pt-BR'))
    .join(' ');

  return terms.some((term) => haystack.includes(term));
}
