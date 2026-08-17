import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

import { EDPApi } from '../../api';
import type { CoffeeConsulta } from '../coffee/types';
import { COFFEE_CONSULTA_KEY } from '../coffee/coffee-query-keys';

/** Política única da consulta ao vivo (`json_all`) de uma nota: cacheada por
 * 30min, sem `refetchOnMount: 'always'` — montar um segundo observador (ficha
 * completa, correção de local, correção de alimentador) não deve refazer a
 * consulta enquanto o dado estiver fresco. Atualização é sempre explícita,
 * via `refetch()`. Exportada à parte pra ser exercida em teste sem precisar
 * montar componentes React. */
export function consultaCoffeeQueryOptions(
  noteId: string,
): UseQueryOptions<CoffeeConsulta> {
  const id = /^\d+$/.test(noteId) ? Number(noteId) : null;
  return {
    queryKey: id === null
      ? ['coffee', 'consulta', 'id-invalido', noteId]
      : COFFEE_CONSULTA_KEY(id),
    queryFn: async () => {
      if (id === null) throw new Error('ID ONR inválido.');
      return EDPApi.consultarNota(id);
    },
    enabled: id !== null,
    staleTime: 30 * 60 * 1000,
  };
}

/** Base de indicadores completos, correção de local e de alimentador — todos
 * observam a mesma query, então uma única fonte de dados por nota. */
export function useConsultaCoffee(noteId: string) {
  return useQuery(consultaCoffeeQueryOptions(noteId));
}
