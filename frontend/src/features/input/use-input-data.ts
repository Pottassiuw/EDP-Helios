import React from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { InputApi } from './api';
import { gravarSnapshot, lerSnapshot, SNAPSHOT_INPUT, type Snapshot } from './cache';
import type { InputDataset } from './types';

export const INPUT_DADOS_KEY = ['input-dados'] as const;

export function semearInputSeVazio(queryClient: QueryClient, snapshot: Snapshot): void {
  if (queryClient.getQueryData(INPUT_DADOS_KEY) !== undefined) return;
  queryClient.setQueryData(INPUT_DADOS_KEY, snapshot.dados as InputDataset, {
    updatedAt: Date.parse(snapshot.salvoEm),
  });
}

async function buscarEGravar(): Promise<InputDataset> {
  const dataset = await InputApi.dados();
  await gravarSnapshot(SNAPSHOT_INPUT, dataset.meta.versao, dataset);
  return dataset;
}

export function useInputData() {
  const qc = useQueryClient();

  // Seed do IndexedDB: só se a query ainda não tem dado (rede pode ter
  // chegado antes). updatedAt antigo marca o seed como stale, então o
  // próprio React Query dispara a revalidação — sem estado manual.
  React.useEffect(() => {
    let cancelado = false;
    void lerSnapshot(SNAPSHOT_INPUT).then((snap) => {
      if (cancelado || !snap) return;
      semearInputSeVazio(qc, snap);
    });
    return () => { cancelado = true; };
  }, [qc]);

  return useQuery({
    queryKey: INPUT_DADOS_KEY,
    queryFn: buscarEGravar,
    staleTime: 300_000,
    retry: 1,
  });
}

export function useRecarregarInput(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await qc.invalidateQueries({ queryKey: INPUT_DADOS_KEY });
  }, [qc]);
}
