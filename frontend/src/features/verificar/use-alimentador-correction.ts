import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { EDPApi } from '../../api';
import { ALIMENTADORES_KEY, COFFEE_CONSULTA_KEY } from '../coffee/coffee-query-keys';
import { OPERACAO_KEY } from '../coffee/operacao/use-coffee-operacao';
import { REVISAO_KEY } from '../coffee/use-nota-revisao';
import { corrigirEConfirmarAlimentador } from './alimentador-service';
import { useConsultaCoffee } from './use-consulta-coffee';

export function useAlimentadores() {
  return useQuery({
    queryKey: ALIMENTADORES_KEY,
    queryFn: EDPApi.listarAlimentadores,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useAlimentadorCorrection(noteId: string) {
  const queryClient = useQueryClient();
  const id = /^\d+$/.test(noteId) ? Number(noteId) : null;
  const consulta = useConsultaCoffee(noteId);

  const mutacao = useMutation({
    mutationFn: async (alimentador: string) => {
      if (id === null) throw new Error('A correção exige um ID ONR numérico.');
      return corrigirEConfirmarAlimentador(id, alimentador);
    },
    onSuccess: async (confirmada) => {
      if (id === null) return;
      queryClient.setQueryData(COFFEE_CONSULTA_KEY(id), confirmada);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: OPERACAO_KEY }),
        queryClient.invalidateQueries({ queryKey: REVISAO_KEY(id) }),
      ]);
      toast.success(`Alimentador da nota ${noteId} confirmado no COFFEE`);
    },
    onError: (error: unknown) => {
      toast.error('Falha ao corrigir alimentador no COFFEE', {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const [rascunho, setRascunho] = React.useState<string | null>(null);
  React.useEffect(() => { setRascunho(null); mutacao.reset(); }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const atual = consulta.data?.alimentador ?? null;
  const proposto = rascunho ?? atual ?? '';

  return {
    atual,
    proposto,
    escolher: setRascunho,
    podeSalvar: proposto !== '' && proposto !== atual && !consulta.isFetching && !mutacao.isPending,
    consultando: consulta.isFetching,
    salvando: mutacao.isPending,
    erro: mutacao.error instanceof Error ? mutacao.error.message : null,
    salvar: () => mutacao.mutate(proposto),
    atualizar: consulta.refetch,
  };
}
