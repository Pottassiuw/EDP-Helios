import { describe, expect, it } from 'vitest';

import {
  ehNotaAtiva,
  ehNotaMaeValida,
  extrairValorUnidadeMedida,
  limparNotaMae,
} from './rateio-lib';

describe('ehNotaAtiva', () => {
  it('reconhece status operacionais ativos e bloqueia sentinelas encerradas', () => {
    expect(ehNotaAtiva('11 Em execução')).toBe(true);
    expect(ehNotaAtiva('99 Encerrado')).toBe(false);
    expect(ehNotaAtiva('55 Cancelada')).toBe(false);
    expect(ehNotaAtiva(null)).toBe(false);
  });
});

describe('ehNotaMaeValida', () => {
  it('aceita somente identificadores numéricos positivos', () => {
    expect(ehNotaMaeValida('700500')).toBe(true);
    expect(ehNotaMaeValida(0)).toBe(false);
    expect(ehNotaMaeValida('abc')).toBe(false);
    expect(ehNotaMaeValida(undefined)).toBe(false);
  });
});

describe('limparNotaMae', () => {
  it('normaliza números decimais vindos da planilha para o identificador inteiro', () => {
    expect(limparNotaMae('700500.0')).toBe('700500');
    expect(limparNotaMae(700501.9)).toBe('700501');
    expect(limparNotaMae('-')).toBe('');
  });
});

describe('extrairValorUnidadeMedida', () => {
  it('extrai valor e unidade de textos SAP', () => {
    expect(extrairValorUnidadeMedida('12,5 km')).toEqual([12.5, 'km']);
    expect(extrairValorUnidadeMedida('4 UN')).toEqual([4, 'un']);
    expect(extrairValorUnidadeMedida('-')).toEqual([0, null]);
    expect(extrairValorUnidadeMedida('sem medida')).toEqual([0, null]);
  });
});
