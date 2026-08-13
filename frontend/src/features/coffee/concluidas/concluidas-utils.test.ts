import { describe, expect, it } from 'vitest';
import type { CoffeeNota } from '../types';
import { notaMatches } from './concluidas-utils';

function nota(overrides: Partial<CoffeeNota>): CoffeeNota {
  return {
    pk: 101,
    id_sap: 900123,
    classificacao: 'corrigida',
    dados_json: { cidade: 'Recife', tipo_local_instalacao: 'Poste', local_instalacao_numero: '42' },
    ...overrides,
  } as CoffeeNota;
}

describe('notaMatches', () => {
  it('casa quando um id colado em lote (multi-linha) contém o pk da nota', () => {
    expect(notaMatches(nota({ pk: 101 }), '55\n101\n909')).toBe(true);
  });

  it('casa por local quando pesquisado junto de outros termos em lote', () => {
    expect(notaMatches(nota({}), 'aaaa, Recife; bbbb')).toBe(true);
  });

  it('não casa quando nenhum termo em lote corresponde', () => {
    expect(notaMatches(nota({ pk: 101, id_sap: 900123 }), '55\n909')).toBe(false);
  });

  it('trata query vazia como sem filtro', () => {
    expect(notaMatches(nota({}), '   ')).toBe(true);
  });
});
