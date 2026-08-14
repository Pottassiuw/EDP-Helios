import { describe, expect, it } from 'vitest';

import {
  agruparCampo,
  formatarValorCru,
  humanizarChave,
  rotularCampo,
} from './campos-coffee';

describe('rotularCampo', () => {
  it('usa o rótulo conhecido pra campos de domínio já mapeados', () => {
    expect(rotularCampo('referencia_eletrica')).toBe('Referência elétrica');
    expect(rotularCampo('id_sap')).toBe('ID SAP');
  });

  it('cai no fallback humanizado pra chaves desconhecidas', () => {
    expect(rotularCampo('tipo_defeito_raro')).toBe('Tipo Defeito Raro');
  });
});

describe('humanizarChave', () => {
  it('converte snake_case em Title Case legível', () => {
    expect(humanizarChave('cidade_extra')).toBe('Cidade Extra');
    expect(humanizarChave('sintoma')).toBe('Sintoma');
  });
});

describe('agruparCampo', () => {
  it('agrupa campos de local e rede', () => {
    expect(agruparCampo('cidade_extra', 'Vitoria')).toBe('Local e rede');
    expect(agruparCampo('trafo_numero', 5)).toBe('Local e rede');
  });

  it('agrupa campos de risco e segurança', () => {
    expect(agruparCampo('ferragem_exposta', true)).toBe('Risco e segurança');
  });

  it('agrupa booleanos sem outro sinal em Estado', () => {
    expect(agruparCampo('confirmado_campo', true)).toBe('Estado');
  });

  it('usa Metadados como fallback pra campos sem padrão reconhecido', () => {
    expect(agruparCampo('data_captura', '2026-01-01')).toBe('Metadados');
  });
});

describe('formatarValorCru', () => {
  it('formata booleanos como Sim/Não', () => {
    expect(formatarValorCru(true)).toBe('Sim');
    expect(formatarValorCru(false)).toBe('Não');
  });

  it('formata nulo/vazio como travessão', () => {
    expect(formatarValorCru(null)).toBe('—');
    expect(formatarValorCru('')).toBe('—');
  });

  it('preserva objetos e arrays sem truncar, via JSON', () => {
    expect(formatarValorCru({ a: 1 })).toBe('{"a":1}');
    expect(formatarValorCru([1, 2])).toBe('[1,2]');
  });

  it('converte número e string diretamente', () => {
    expect(formatarValorCru(42)).toBe('42');
    expect(formatarValorCru('Vitoria')).toBe('Vitoria');
  });
});
