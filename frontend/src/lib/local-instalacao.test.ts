import { describe, expect, it } from 'vitest';

import { regraLocalInstalacao } from './local-instalacao';

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
