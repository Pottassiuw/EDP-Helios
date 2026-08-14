import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { InputApi } from './api';
import type { Bloqueio } from './types';

const BLOQUEIOS_KEY = ['input', 'bloqueios'] as const;
export const BLOQUEIOS_INTERVALO_REPOUSO_MS = 60_000;
export const BLOQUEIOS_INTERVALO_ATIVO_MS = 15_000;

export function intervaloPollingBloqueios(edicaoAtiva: boolean): number {
  return edicaoAtiva ? BLOQUEIOS_INTERVALO_ATIVO_MS : BLOQUEIOS_INTERVALO_REPOUSO_MS;
}

export interface UseBloqueiosResultado {
  /** Numero_Nota -> bloqueio ativo. Vazio enquanto a primeira carga não chega. */
  mapa: Map<number, Bloqueio>;
  recarregar: () => void;
}

/** Polling leve da tabela de bloqueios — não cacheia em disco: é estado
 * efêmero (TTL de minutos), diferente do dataset principal. */
export function useBloqueios(edicaoAtiva: boolean): UseBloqueiosResultado {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: BLOQUEIOS_KEY,
    queryFn: () => InputApi.bloqueios(),
    refetchInterval: intervaloPollingBloqueios(edicaoAtiva),
    staleTime: 0,
  });

  const mapa = React.useMemo(() => {
    const m = new Map<number, Bloqueio>();
    for (const b of data?.bloqueios ?? []) m.set(b.Numero_Nota, b);
    return m;
  }, [data]);

  const recarregar = React.useCallback(() => {
    void qc.invalidateQueries({ queryKey: BLOQUEIOS_KEY });
  }, [qc]);

  return { mapa, recarregar };
}
