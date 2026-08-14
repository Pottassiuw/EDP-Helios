import { describe, expect, it } from 'vitest';
import { varrerVinculos } from './lib';
import type { NotaInput } from './types';

describe('varrerVinculos (Detetive de Notas)', () => {
  it('detecta Nota Mãe no campo Observacao mesmo com Planejado > 0', () => {
    const registros: NotaInput[] = [
      {
        Numero_Nota: 14118256,
        Conjunto: 'POSTES - CAPEX',
        Planejado_DDPM: 5.0,
        Nota_Mae: '-',
        Observacao: 'Nota mae principal',
      },
      {
        Numero_Nota: 16958288,
        Conjunto: 'POSTES - CAPEX',
        Planejado_DDPM: 1.0, // Medida maior que zero!
        Nota_Mae: '-',
        Observacao: 'Nota filha da 14118256 conforme projeto',
      },
    ];

    const sugestoes = varrerVinculos(registros);
    expect(sugestoes).toHaveLength(1);
    expect(sugestoes[0]).toEqual({
      Nota_Filha_Orfa: 16958288,
      Possivel_Nota_Mae: '14118256',
    });
  });

  it('detecta filhas quando a Nota Mãe lista os números em sua Observacao', () => {
    const registros: NotaInput[] = [
      {
        Numero_Nota: 15000000,
        Conjunto: 'MELHORIA OPERATIVA',
        Planejado_DDPM: 10.0,
        Nota_Mae: '-',
        Observacao: 'Filhas vinculadas: 16000001 e 16000002',
      },
      {
        Numero_Nota: 16000001,
        Conjunto: 'MELHORIA OPERATIVA',
        Planejado_DDPM: 2.0,
        Nota_Mae: '-',
        Observacao: '',
      },
      {
        Numero_Nota: 16000002,
        Conjunto: 'MELHORIA OPERATIVA',
        Planejado_DDPM: 3.0,
        Nota_Mae: '-',
        Observacao: '',
      },
    ];

    const sugestoes = varrerVinculos(registros);
    expect(sugestoes).toHaveLength(2);
    expect(sugestoes).toEqual([
      { Nota_Filha_Orfa: 16000001, Possivel_Nota_Mae: '15000000' },
      { Nota_Filha_Orfa: 16000002, Possivel_Nota_Mae: '15000000' },
    ]);
  });

  it('ignora notas com palavras proibidas como CANCELADA ou SUBSTITUIDA', () => {
    const registros: NotaInput[] = [
      {
        Numero_Nota: 14118256,
        Conjunto: 'POSTES - CAPEX',
        Planejado_DDPM: 5.0,
        Nota_Mae: '-',
      },
      {
        Numero_Nota: 16958288,
        Conjunto: 'POSTES - CAPEX',
        Planejado_DDPM: 1.0,
        Nota_Mae: '-',
        Observacao: '14118256 CANCELADA',
      },
    ];

    const sugestoes = varrerVinculos(registros);
    expect(sugestoes).toHaveLength(0);
  });

  it('faz parse de colagem TSV incluindo coluna Nota_Mae', async () => {
    const { parseColagemTsv } = await import('./lib');
    const { COLUNAS_COLAGEM } = await import('./columns');
    const tsv = '16958288\t14118256\t00 Pendente\tProgramável\t1.5\tPOSTES\tGUA-01\t045RL00000001\tjul-2026\t14/08/2026\tObservacao teste\t-';
    const resultado = parseColagemTsv(tsv, COLUNAS_COLAGEM);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].Numero_Nota).toBe('16958288');
    expect(resultado[0].Nota_Mae).toBe('14118256');
    expect(resultado[0].Planejado_DDPM).toBe('1.5');
  });
});
