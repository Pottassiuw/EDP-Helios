import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InputApi } from './api';
import { gravarSnapshot, lerSnapshot, SNAPSHOT_RAMAL } from './cache';
import type { RamalDataset } from './types';

export const RAMAL_KEY = ['input', 'ramal'] as const;

async function buscarEGravar(): Promise<RamalDataset> {
  const dataset = await InputApi.ramal();
  // ramal não tem meta/versao própria: snapshot leva versao null
  await gravarSnapshot(SNAPSHOT_RAMAL, null, dataset);
  return dataset;
}

export function useRamalData() {
  const qc = useQueryClient();

  React.useEffect(() => {
    let cancelado = false;
    void lerSnapshot(SNAPSHOT_RAMAL).then((snap) => {
      if (cancelado || !snap) return;
      if (qc.getQueryData(RAMAL_KEY) === undefined) {
        qc.setQueryData(RAMAL_KEY, snap.dados as RamalDataset,
                        { updatedAt: Date.parse(snap.salvoEm) });
      }
    });
    return () => { cancelado = true; };
  }, [qc]);

  return useQuery({ queryKey: RAMAL_KEY, queryFn: buscarEGravar, staleTime: 300_000 });
}

export function useRecarregarRamal(): () => Promise<void> {
  const qc = useQueryClient();
  return React.useCallback(async () => {
    await qc.refetchQueries({ queryKey: RAMAL_KEY, type: 'active' });
  }, [qc]);
}
