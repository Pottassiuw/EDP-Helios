import { describe, expect, it } from 'vitest';

import { anoEncerramento } from './reports-lib';

describe('anoEncerramento', () => {
  it('retorna null para valores vazios ou sentinela', () => {
    expect(anoEncerramento(null)).toBeNull();
    expect(anoEncerramento(undefined)).toBeNull();
    expect(anoEncerramento('-')).toBeNull();
    expect(anoEncerramento('')).toBeNull();
  });

  it('extrai o ano de uma data em texto', () => {
    expect(anoEncerramento('2026-01-15')).toBe(2026);
  });

  it('extrai o ano de um timestamp numérico', () => {
    expect(anoEncerramento(new Date('2026-06-15').getTime())).toBe(2026);
  });

  it('retorna null para texto que não é data', () => {
    expect(anoEncerramento('não-é-data')).toBeNull();
  });
});
