import { describe, expect, it } from 'vitest';

import {
  comporLocalInstalacao,
  dividirLocalInstalacao,
  regraLocalInstalacao,
} from './local-instalacao';

describe('regraLocalInstalacao', () => {
  it('reconhece os identificadores já observados na fonte', () => {
    expect(regraLocalInstalacao('chk_local_instal')).toBe(true);
    expect(regraLocalInstalacao('chk_local_instalacao')).toBe(true);
  });

  it('reconhece variantes com "de" e com acentos, sem depender de lista fixa', () => {
    expect(regraLocalInstalacao('chk_local_de_instalacao')).toBe(true);
    expect(regraLocalInstalacao('chk_local_de_instalação')).toBe(true);
    expect(regraLocalInstalacao('CHK_LOCAL_DE_INSTALAÇÃO')).toBe(true);
    expect(regraLocalInstalacao('chk_localdeinstalacao')).toBe(true);
  });

  it('não reconhece falhas de outros domínios', () => {
    expect(regraLocalInstalacao('chk_referencia')).toBe(false);
    expect(regraLocalInstalacao('chk_poste')).toBe(false);
    expect(regraLocalInstalacao('chk_trafo')).toBe(false);
    expect(regraLocalInstalacao('')).toBe(false);
  });
});

describe('dividirLocalInstalacao', () => {
  it('quebra o valor de 13 caracteres em município, tipo e número', () => {
    expect(dividirLocalInstalacao('701-CF-12345678')).toEqual({
      municipio: '701',
      tipo: 'CF',
      numero: '12345678',
    });
  });

  it('não falha com valores incompletos ou vazios', () => {
    expect(dividirLocalInstalacao('701CF')).toEqual({
      municipio: '701',
      tipo: 'CF',
      numero: '',
    });
    expect(dividirLocalInstalacao(null)).toEqual({ municipio: '', tipo: '', numero: '' });
    expect(dividirLocalInstalacao(undefined)).toEqual({ municipio: '', tipo: '', numero: '' });
  });
});

describe('comporLocalInstalacao', () => {
  it('junta as 3 partes na string de 13 caracteres', () => {
    expect(comporLocalInstalacao({ municipio: '701', tipo: 'CF', numero: '12345678' }))
      .toBe('701CF12345678');
  });

  it('completa o número com zeros à esquerda quando incompleto', () => {
    expect(comporLocalInstalacao({ municipio: '701', tipo: 'CF', numero: '1234' }))
      .toBe('701CF00001234');
    expect(comporLocalInstalacao({ municipio: '701', tipo: 'CF', numero: '' }))
      .toBe('701CF00000000');
  });

  it('é a inversa de dividirLocalInstalacao pra valores já completos', () => {
    const original = '701CF12345678';
    expect(comporLocalInstalacao(dividirLocalInstalacao(original))).toBe(original);
  });
});
