import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import {
  aplicarRespostaSincronizacao,
  deveAvisarFalhaDoEspelho,
  intervaloPollingSincronizacao,
  SYNC_INTERVALO_ATIVO_MS,
  SYNC_INTERVALO_REPOUSO_MS,
} from './use-input-sync';
import { INPUT_DADOS_KEY } from './use-input-data';

describe('estratégia única de polling do Input', () => {
  it('usa intervalo relaxado em repouso e curto somente durante sincronização ativa', () => {
    expect(intervaloPollingSincronizacao(undefined)).toBe(SYNC_INTERVALO_REPOUSO_MS);
    expect(intervaloPollingSincronizacao({ sincronizando: false })).toBe(SYNC_INTERVALO_REPOUSO_MS);
    expect(intervaloPollingSincronizacao({ sincronizando: true })).toBe(SYNC_INTERVALO_ATIVO_MS);
    expect(SYNC_INTERVALO_ATIVO_MS).toBeLessThan(SYNC_INTERVALO_REPOUSO_MS);
  });

  it('invalida o dataset compartilhado somente quando a versão remota muda', async () => {
    const queryClient = new QueryClient();
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);

    aplicarRespostaSincronizacao(queryClient, 'versao-atual', { versao: 'versao-atual' });
    aplicarRespostaSincronizacao(queryClient, 'versao-atual', { versao: 'versao-nova' });

    expect(invalidar).toHaveBeenCalledTimes(1);
    expect(invalidar).toHaveBeenCalledWith({ queryKey: INPUT_DADOS_KEY });
  });
});

describe('deveAvisarFalhaDoEspelho', () => {
  it('avisa quando aparece um erro novo na publicação do espelho', () => {
    expect(deveAvisarFalhaDoEspelho('rede indisponível', null)).toBe(true);
    expect(deveAvisarFalhaDoEspelho('alvo travado', 'rede indisponível')).toBe(true);
  });

  it('não repete o aviso a cada ciclo de polling', () => {
    expect(deveAvisarFalhaDoEspelho('rede indisponível', 'rede indisponível')).toBe(false);
    expect(deveAvisarFalhaDoEspelho(null, 'rede indisponível')).toBe(false);
    expect(deveAvisarFalhaDoEspelho(undefined, null)).toBe(false);
  });
});
