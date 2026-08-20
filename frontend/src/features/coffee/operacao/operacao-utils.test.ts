import { describe, expect, it } from 'vitest';
import type { CoffeeOperacaoItem } from '../types';
import { operacaoItemMatches } from './operacao-utils';

function item(overrides: Partial<CoffeeOperacaoItem>): CoffeeOperacaoItem {
  return {
    entrada_id: 101,
    nota_pk: 101,
    etapa: 'fila',
    origem: 'avulsa',
    operacao_id: null,
    erro: null,
    criado_em: '2026-08-18T10:00:00',
    atualizado_em: '2026-08-18T10:00:00',
    nota: {
      pk: 101,
      id_sap: 900123,
      id_sap_anterior: null,
      arquivado: null,
      classificacao: 'pronta',
      dados_json: {
        cidade: 'Recife',
        tipo_local_instalacao: 'Poste',
        local_instalacao_numero: '42',
      },
      buscado_em: '2026-08-18T10:00:00',
      erro: null,
    },
    ...overrides,
  };
}

describe('operacaoItemMatches', () => {
  it('casa quando um id colado em lote (multi-linha) contém o pk da nota', () => {
    expect(operacaoItemMatches(item({ entrada_id: 101, nota_pk: 101 }), '55\n101\n909')).toBe(true);
  });

  it('casa quando um id_sap colado em lote contém o id_sap da nota', () => {
    expect(operacaoItemMatches(item({}), '900123, 900456')).toBe(true);
  });

  it('casa por local quando pesquisado junto de outros termos em lote', () => {
    expect(operacaoItemMatches(item({}), 'aaaa, Recife; bbbb')).toBe(true);
  });

  it('casa por local formatado com hífen', () => {
    expect(operacaoItemMatches(item({}), 'Recife-Poste-42')).toBe(true);
  });

  it('casa por entrada_id quando nota é nula (fila antes da consulta)', () => {
    expect(operacaoItemMatches(item({ entrada_id: 777, nota_pk: null, nota: null }), '777')).toBe(true);
  });

  it('não casa quando nenhum termo em lote corresponde', () => {
    expect(operacaoItemMatches(item({ entrada_id: 101, nota_pk: 101 }), '55\n909')).toBe(false);
  });

  it('trata query vazia como sem filtro (retorna true)', () => {
    expect(operacaoItemMatches(item({}), '   ')).toBe(true);
  });
});
