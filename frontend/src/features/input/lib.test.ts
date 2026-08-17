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

  it('faz parse de colagem TSV incluindo coluna Nota_Mae e ignora cabecalhos', async () => {
    const { parseColagemTsv } = await import('./lib');
    const { COLUNAS_COLAGEM } = await import('./columns');
    const tsv = '16958288\t14118256\t00 Pendente\tProgramável\t1.5\tPOSTES\tGUA-01\t045RL00000001\tjul-2026\t14/08/2026\tObservacao teste\t-';
    const resultado = parseColagemTsv(tsv, COLUNAS_COLAGEM);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].Numero_Nota).toBe(16958288);
    expect(resultado[0].Nota_Mae).toBe('14118256');
    expect(resultado[0].Planejado_DDPM).toBe(1.5);

    const tsvComCabecalho = 'Numero_Nota\tNota_Mae\tStatus_Nota\n16958288\t14118256\t00 Pendente';
    const resComCabecalho = parseColagemTsv(tsvComCabecalho, COLUNAS_COLAGEM);
    expect(resComCabecalho).toHaveLength(1);
    expect(resComCabecalho[0].Numero_Nota).toBe(16958288);
  });
});

describe('Ocultação de Notas (ehNotaOculta, buscarNotasOcultas, filtrarRegistros)', () => {
  it('ehNotaOculta identifica notas marcadas como ocultas no Check ou Observacao', async () => {
    const { ehNotaOculta } = await import('./lib');
    expect(ehNotaOculta({ Check: 'Oculta' })).toBe(true);
    expect(ehNotaOculta({ Check: 'OCULTA' })).toBe(true);
    expect(ehNotaOculta({ Check: 'oculto' })).toBe(true);
    expect(ehNotaOculta({ Check: '[oculta]' })).toBe(true);
    expect(ehNotaOculta({ Observacao: 'Nota desativada [OCULTA]' })).toBe(true);

    expect(ehNotaOculta({ Check: '-' })).toBe(false);
    expect(ehNotaOculta({ Check: 'OK' })).toBe(false);
    expect(ehNotaOculta({ Check: '' })).toBe(false);
    expect(ehNotaOculta({})).toBe(false);
  });

  it('buscarNotasOcultas encontra notas ocultas por número ou busca de texto', async () => {
    const { buscarNotasOcultas } = await import('./lib');
    const registros: NotaInput[] = [
      { Numero_Nota: 1001, Check: 'Oculta', Conjunto: 'POA', Observacao: 'Nota teste 1' },
      { Numero_Nota: 1002, Check: '-', Conjunto: 'POA', Observacao: 'Nota ativa 2' },
      { Numero_Nota: 1003, Check: 'Oculta', Conjunto: 'MOGI', Observacao: 'Obra especial' },
    ];

    expect(buscarNotasOcultas(registros, '1001')).toHaveLength(1);
    expect(buscarNotasOcultas(registros, '1001')[0].Numero_Nota).toBe(1001);

    expect(buscarNotasOcultas(registros, '1002')).toHaveLength(0); // Nota 1002 não é oculta

    expect(buscarNotasOcultas(registros, 'especial')).toHaveLength(1);
    expect(buscarNotasOcultas(registros, 'especial')[0].Numero_Nota).toBe(1003);
  });

  it('filtrarRegistros oculta notas por padrão e as exibe quando mostrarOcultas é true', async () => {
    const { filtrarRegistros } = await import('./overview');
    const registros: NotaInput[] = [
      { Numero_Nota: 1001, Check: 'Oculta', Conjunto: 'POA', Mes_Execucao_Planejado: 'jul-2026' },
      { Numero_Nota: 1002, Check: '-', Conjunto: 'POA', Mes_Execucao_Planejado: 'jul-2026' },
    ];

    const filtradosSemOcultas = filtrarRegistros(registros, {
      busca: '',
      filtros: [],
      somente2026: true,
      somenteNotasMaes: false,
      mostrarOcultas: false,
    });
    expect(filtradosSemOcultas).toHaveLength(1);
    expect(filtradosSemOcultas[0].Numero_Nota).toBe(1002);

    const filtradosComOcultas = filtrarRegistros(registros, {
      busca: '',
      filtros: [],
      somente2026: true,
      somenteNotasMaes: false,
      mostrarOcultas: true,
    });
    expect(filtradosComOcultas).toHaveLength(2);
  });
});

