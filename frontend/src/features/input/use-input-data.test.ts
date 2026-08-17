import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import type { Snapshot } from './cache';
import { INPUT_DADOS_KEY, semearInputSeVazio } from './use-input-data';
import type { InputDataset } from './types';

const dataset = { meta: { versao: 'snapshot' }, registros: [] } as unknown as InputDataset;

describe('cache offline do Input', () => {
  it('semeia o React Query com o snapshot e preserva a data em que foi salvo', () => {
    const queryClient = new QueryClient();
    const snapshot: Snapshot = {
      chave: 'input-dados',
      versao: 'snapshot',
      salvoEm: '2026-08-13T12:00:00.000Z',
      dados: dataset,
    };

    semearInputSeVazio(queryClient, snapshot);

    expect(queryClient.getQueryData(INPUT_DADOS_KEY)).toBe(dataset);
    expect(queryClient.getQueryState(INPUT_DADOS_KEY)?.dataUpdatedAt)
      .toBe(Date.parse(snapshot.salvoEm));
  });

  it('não sobrescreve uma resposta de rede que chegou antes do snapshot', () => {
    const queryClient = new QueryClient();
    const respostaRede = { ...dataset, meta: { ...dataset.meta, versao: 'rede' } };
    queryClient.setQueryData(INPUT_DADOS_KEY, respostaRede);

    semearInputSeVazio(queryClient, {
      chave: 'input-dados', versao: 'snapshot', salvoEm: new Date(0).toISOString(), dados: dataset,
    });

    expect(queryClient.getQueryData(INPUT_DADOS_KEY)).toBe(respostaRede);
  });
});
