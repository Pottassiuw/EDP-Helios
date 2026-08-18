import { describe, expect, it } from 'vitest';
import {
  varrerVinculos, ehNotaOculta, buscarNotasOcultas,
  buscarPorTextoGlobal, indiceBuscaGlobal,
} from './lib';
import { filtrarRegistros } from './overview';
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
    const tsv = '16958288\t14118256\tObservacao teste\t00 Pendente\tProgramável\t1.5\tPOSTES\tGUA-01\t045RL00000001\tjul-2026\t14/08/2026\t-';
    const resultado = parseColagemTsv(tsv, COLUNAS_COLAGEM);
    expect(resultado).toHaveLength(1);
    expect(resultado[0].Numero_Nota).toBe(16958288);
    expect(resultado[0].Nota_Mae).toBe('14118256');
    expect(resultado[0].Observacao).toBe('Observacao teste');
    expect(resultado[0].Planejado_DDPM).toBe(1.5);

    const tsvComCabecalho = 'Numero_Nota\tNota_Mae\tObservacao\tStatus_Nota\n16958288\t14118256\tObservacao teste\t00 Pendente';
    const resComCabecalho = parseColagemTsv(tsvComCabecalho, COLUNAS_COLAGEM);
    expect(resComCabecalho).toHaveLength(1);
    expect(resComCabecalho[0].Numero_Nota).toBe(16958288);
  });
});

describe('Ocultação de Notas (ehNotaOculta, buscarNotasOcultas, filtrarRegistros)', () => {
  it('ehNotaOculta identifica notas marcadas como ocultas no Check ou Observacao', () => {
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

  it('buscarNotasOcultas encontra notas ocultas por número ou busca de texto', () => {
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

  it('filtrarRegistros oculta notas por padrão e as exibe quando mostrarOcultas é true', () => {
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

  it('filtrarRegistros encontra notas por busca parcial de prefixo numérico (ex: 9999 encontra 9999001, 9999010...) ', () => {
    const registros: NotaInput[] = [
      { Numero_Nota: 9999001, Nota_Mae: '-', Check: '-', Mes_Execucao_Planejado: 'mar-2026' },
      { Numero_Nota: 9999002, Nota_Mae: '9999001', Check: '-', Mes_Execucao_Planejado: 'mar-2026' },
      { Numero_Nota: 9999010, Nota_Mae: '-', Check: '-', Mes_Execucao_Planejado: 'abr-2026' },
      { Numero_Nota: 9999020, Nota_Mae: '-', Check: 'Oculta', Mes_Execucao_Planejado: 'mai-2026' },
      { Numero_Nota: 14118256, Nota_Mae: '-', Check: '-', Mes_Execucao_Planejado: 'jul-2026' },
    ];

    const busca9999 = filtrarRegistros(registros, {
      busca: '9999',
      filtros: [],
      somente2026: true,
      somenteNotasMaes: false,
      mostrarOcultas: false,
    });
    expect(busca9999).toHaveLength(3);
    expect(busca9999.map((r) => r.Numero_Nota)).toEqual([9999001, 9999002, 9999010]);

    const busca9999ComOcultas = filtrarRegistros(registros, {
      busca: '9999',
      filtros: [],
      somente2026: true,
      somenteNotasMaes: false,
      mostrarOcultas: true,
    });
    expect(busca9999ComOcultas).toHaveLength(4);
  });
});

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
