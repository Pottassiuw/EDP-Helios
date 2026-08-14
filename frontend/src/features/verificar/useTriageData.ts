import { useQuery } from '@tanstack/react-query';
import { fetchData } from '../../api';

export function useTriageData() {
  return useQuery({
    queryKey: ['triage'],
    queryFn: fetchData,
    retry: false,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });
}
