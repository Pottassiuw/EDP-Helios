import type { QueryClient } from '@tanstack/react-query';

export const COFFEE_CONSULTA_KEY = (id: number) => (
  ['coffee', 'consulta', id] as const
);

export const ALIMENTADORES_KEY = ['coffee', 'alimentadores'] as const;

export function invalidarConsultaCoffee(
  queryClient: QueryClient,
  id: number,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: COFFEE_CONSULTA_KEY(id),
  });
}
