import { describe, expect, it } from 'vitest';

import { filtrarRegistros } from './overview';
import { FILTROS_INICIAIS, type FiltersState } from './filters';
import type { NotaInput } from './types';

function nota(overrides: Partial<NotaInput> & { Numero_Nota: number }): NotaInput {
  return {
    Regional: 'Guarulhos',
    Conjunto: 'POSTE',
    Circuito: 'GUA-01',
    Local_Instalacao: 'ABC-10',
    Nota_Mae: '-',
    Status_Nota: 'Em aberto',
    Mes_Execucao_Planejado: `jul-${new Date().getFullYear()}`,
    ...overrides,
  };
}

function estado(overrides: Partial<FiltersState>): FiltersState {
  return { ...FILTROS_INICIAIS, somente2026: false, ...overrides };
}

describe('filtrarRegistros', () => {
  it('busca vazia + sem outros filtros retorna todos os registros', () => {
    const registros = [nota({ Numero_Nota: 1 }), nota({ Numero_Nota: 2 })];

    expect(filtrarRegistros(registros, estado({}))).toEqual(registros);
  });

  it('busca numérica casa por Numero_Nota ou Nota_Mae', () => {
    const mae = nota({ Numero_Nota: 700500 });
    const filha = nota({ Numero_Nota: 2, Nota_Mae: '700500' });
    const registros = [mae, filha, nota({ Numero_Nota: 3 })];

    const resultado = filtrarRegistros(registros, estado({ busca: '700500' }));

    expect(resultado.map((r) => r.Numero_Nota)).toEqual([700500, 2]);
  });

  it('busca textual usa o fallback genérico sobre qualquer campo', () => {
    const alvo = nota({ Numero_Nota: 1, Circuito: 'GUA-01' });
    const outro = nota({ Numero_Nota: 2, Circuito: 'SP-02' });

    const resultado = filtrarRegistros([alvo, outro], estado({ busca: 'gua-01' }));

    expect(resultado).toEqual([alvo]);
  });

  it('filtro de texto avançado com negação por asteriscos exclui os que contêm o termo', () => {
    const registros = [
      nota({ Numero_Nota: 1, Status_Nota: 'Cancelada' }),
      nota({ Numero_Nota: 2, Status_Nota: 'Em aberto' }),
    ];

    const resultado = filtrarRegistros(
      registros,
      estado({ filtros: [{ campo: 'Status_Nota', tipo: 'texto', texto: '*cancelada*' }] }),
    );

    expect(resultado.map((r) => r.Numero_Nota)).toEqual([2]);
  });

  it('combina busca global com filtros avançados e com somenteNotasMaes', () => {
    const mae = nota({ Numero_Nota: 700500, Circuito: 'GUA-01' });
    const filha = nota({ Numero_Nota: 2, Nota_Mae: '700500', Circuito: 'GUA-01' });
    const semRelacao = nota({ Numero_Nota: 3, Circuito: 'GUA-01' });

    const resultado = filtrarRegistros(
      [mae, filha, semRelacao],
      estado({ somenteNotasMaes: true }),
    );

    expect(resultado.map((r) => r.Numero_Nota)).toEqual([700500]);
  });
});
