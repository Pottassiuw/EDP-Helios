import { describe, expect, it } from 'vitest';

import { buscarPorTextoGlobal, indiceBuscaGlobal } from './lib';
import type { NotaInput } from './types';

function nota(overrides: Partial<NotaInput> & { Numero_Nota: number }): NotaInput {
  return {
    Regional: 'Guarulhos',
    Conjunto: 'POSTE',
    Circuito: 'GUA-01',
    Local_Instalacao: 'ABC-10',
    Nota_Mae: '-',
    Status_Nota: 'Em aberto',
    ...overrides,
  };
}

describe('indiceBuscaGlobal', () => {
  it('memoiza pela identidade do array: mesma referência retorna o mesmo índice', () => {
    const registros = [nota({ Numero_Nota: 1 })];

    const primeiro = indiceBuscaGlobal(registros);
    const segundo = indiceBuscaGlobal(registros);

    expect(segundo).toBe(primeiro);
  });

  it('um novo array (mesmo com conteúdo igual) gera um novo índice, sem reaproveitar o antigo', () => {
    const registrosA = [nota({ Numero_Nota: 1 })];
    const registrosB = [nota({ Numero_Nota: 1 })];

    const indiceA = indiceBuscaGlobal(registrosA);
    const indiceB = indiceBuscaGlobal(registrosB);

    expect(indiceB).not.toBe(indiceA);
    expect(indiceB).toEqual(indiceA);
  });
});

describe('buscarPorTextoGlobal', () => {
  it('busca vazia retorna todos os registros sem filtrar', () => {
    const registros = [nota({ Numero_Nota: 1 }), nota({ Numero_Nota: 2 })];

    expect(buscarPorTextoGlobal(registros, '')).toEqual(registros);
    expect(buscarPorTextoGlobal(registros, '   ')).toEqual(registros);
  });

  it('query numérica casa por Numero_Nota', () => {
    const alvo = nota({ Numero_Nota: 700500 });
    const registros = [alvo, nota({ Numero_Nota: 111111 })];

    expect(buscarPorTextoGlobal(registros, '700500')).toEqual([alvo]);
  });

  it('query numérica também casa por Nota_Mae', () => {
    const filha = nota({ Numero_Nota: 2, Nota_Mae: '700500' });
    const registros = [nota({ Numero_Nota: 700500 }), filha, nota({ Numero_Nota: 3, Nota_Mae: '-' })];

    const resultado = buscarPorTextoGlobal(registros, '700500');

    expect(resultado.map((r) => r.Numero_Nota)).toEqual([700500, 2]);
  });

  it('múltiplos números separados por vírgula/espaço casam por OR', () => {
    const registros = [nota({ Numero_Nota: 1 }), nota({ Numero_Nota: 2 }), nota({ Numero_Nota: 3 })];

    const resultado = buscarPorTextoGlobal(registros, '1, 3');

    expect(resultado.map((r) => r.Numero_Nota)).toEqual([1, 3]);
  });

  it('query não numérica cai no fallback genérico: casa qualquer campo, case-insensitive', () => {
    const alvo = nota({ Numero_Nota: 1, Circuito: 'GUA-01' });
    const outro = nota({ Numero_Nota: 2, Circuito: 'SP-02', Regional: 'Sao Paulo' });

    const resultado = buscarPorTextoGlobal([alvo, outro], 'gua-01');

    expect(resultado).toEqual([alvo]);
  });

  it('fallback genérico não casa termo que só existe partido entre dois campos diferentes', () => {
    // Local_Instalacao termina em "foo", Circuito começa com "bar" — nenhum campo isolado contém "foobar".
    const registro = nota({ Numero_Nota: 1, Local_Instalacao: 'xxfoo', Circuito: 'barxx' });

    const resultado = buscarPorTextoGlobal([registro], 'foobar');

    expect(resultado).toEqual([]);
  });

  it('resultado do índice memoizado é usado igualmente em buscas sucessivas com a mesma referência de registros', () => {
    const registros = [
      nota({ Numero_Nota: 1, Circuito: 'GUA-01' }),
      nota({ Numero_Nota: 2, Circuito: 'SP-02', Regional: 'Sao Paulo' }),
    ];

    const primeira = buscarPorTextoGlobal(registros, 'gua');
    const segunda = buscarPorTextoGlobal(registros, 'sp');

    expect(primeira.map((r) => r.Numero_Nota)).toEqual([1]);
    expect(segunda.map((r) => r.Numero_Nota)).toEqual([2]);
  });
});
