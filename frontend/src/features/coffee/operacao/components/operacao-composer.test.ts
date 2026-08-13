import { describe, expect, it } from 'vitest';

import { parseCoffeeIds } from './operacao-composer';

describe('parseCoffeeIds', () => {
  it('aceita espaço, vírgula, ponto e vírgula e quebra de linha como separador', () => {
    expect(parseCoffeeIds('1 2,3;4\n5').ids).toEqual([1, 2, 3, 4, 5]);
  });

  it('deduplica e conta repetidos separadamente dos válidos', () => {
    const parsed = parseCoffeeIds('10 10 20 20 20');
    expect(parsed.ids).toEqual([10, 20]);
    expect(parsed.repetidos).toBe(3);
  });

  it('separa tokens inválidos (não numéricos, zero, negativos) dos válidos', () => {
    const parsed = parseCoffeeIds('10 abc -5 0 20');
    expect(parsed.ids).toEqual([10, 20]);
    expect(parsed.invalidos).toEqual(['abc', '-5', '0']);
  });

  it('valor vazio ou só separadores não gera IDs nem inválidos', () => {
    expect(parseCoffeeIds('')).toEqual({ ids: [], invalidos: [], repetidos: 0 });
    expect(parseCoffeeIds('   ,;  \n ')).toEqual({ ids: [], invalidos: [], repetidos: 0 });
  });

  it('ignora espaços nas bordas de cada token', () => {
    expect(parseCoffeeIds('  100  ,  200  ').ids).toEqual([100, 200]);
  });
});
