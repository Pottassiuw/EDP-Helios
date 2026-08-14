import { describe, expect, it } from 'vitest';

import {
  BLOQUEIOS_INTERVALO_ATIVO_MS,
  BLOQUEIOS_INTERVALO_REPOUSO_MS,
  intervaloPollingBloqueios,
} from './use-bloqueios';

describe('polling de bloqueios do Input', () => {
  it('só mantém a frequência curta enquanto há edição ativa', () => {
    expect(intervaloPollingBloqueios(false)).toBe(BLOQUEIOS_INTERVALO_REPOUSO_MS);
    expect(intervaloPollingBloqueios(true)).toBe(BLOQUEIOS_INTERVALO_ATIVO_MS);
    expect(BLOQUEIOS_INTERVALO_ATIVO_MS).toBeLessThan(BLOQUEIOS_INTERVALO_REPOUSO_MS);
  });
});
