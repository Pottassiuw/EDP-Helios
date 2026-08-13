import React from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  analisarEdicaoLocal,
  formatarLocalInstalacao,
  normalizarLocalInstalacao,
} from '../../lib/local-instalacao';
import type { CoffeeConsulta } from '../coffee/types';
import { OPERACAO_KEY } from '../coffee/operacao/use-coffee-operacao';
import { COFFEE_CONSULTA_KEY } from '../coffee/coffee-query-keys';
import { REVISAO_KEY } from '../coffee/use-nota-revisao';
import { corrigirEConfirmarLocal } from './local-instalacao-service';

interface EstadoConsultaLocal {
  isSuccess: boolean;
  isError: boolean;
  isRefetchError: boolean;
}

export function consultaLocalEstaAtualizada({
  isSuccess,
  isError,
  isRefetchError,
}: EstadoConsultaLocal): boolean {
  return isSuccess && !isError && !isRefetchError;
}

export function useLocalInstalacaoCorrection(
  noteId: string,
  localTriagem: string,
  consulta: UseQueryResult<CoffeeConsulta>,
) {
  const queryClient = useQueryClient();
  const id = /^\d+$/.test(noteId) ? Number(noteId) : null;
  const [rascunho, setRascunho] = React.useState(
    formatarLocalInstalacao(localTriagem),
  );

  // Ajusta o rascunho durante o render quando a nota selecionada muda —
  // evita remount (`key`) só pra resetar estado de formulário por nota.
  const [noteIdAnterior, setNoteIdAnterior] = React.useState(noteId);
  if (noteId !== noteIdAnterior) {
    setNoteIdAnterior(noteId);
    setRascunho(formatarLocalInstalacao(localTriagem));
  }

  const mutacao = useMutation({
    mutationFn: async (local: string) => {
      if (id === null) throw new Error('A correção exige um ID ONR numérico.');
      return corrigirEConfirmarLocal(id, local);
    },
    onSuccess: async (confirmada) => {
      if (id === null) return;
      queryClient.setQueryData(COFFEE_CONSULTA_KEY(id), confirmada);
      setRascunho(formatarLocalInstalacao(confirmada.local_instalacao));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: OPERACAO_KEY }),
        queryClient.invalidateQueries({ queryKey: REVISAO_KEY(id) }),
      ]);
      toast.success(`Local da nota ${noteId} confirmado no COFFEE`);
    },
    onError: (error: unknown) => {
      toast.error('Falha ao corrigir local no COFFEE', {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const localCoffee = normalizarLocalInstalacao(
    consulta.data?.local_instalacao ?? '',
  );
  React.useEffect(() => {
    if (!consulta.data) return;
    const formatado = formatarLocalInstalacao(consulta.data.local_instalacao);
    setRascunho((atual) => (atual === formatado ? atual : formatado));
  }, [consulta.data]);

  const proposto = normalizarLocalInstalacao(rascunho);
  const ocupado = consulta.isFetching || mutacao.isPending;
  const { podeSalvar, confirmado } = analisarEdicaoLocal({
    consultado: consultaLocalEstaAtualizada(consulta),
    ocupado,
    atual: localCoffee,
    proposto,
  });

  const erroBruto = id === null
    ? new Error('A correção direta exige um ID ONR numérico.')
    : mutacao.error ?? consulta.error;
  const erro = erroBruto instanceof Error
    ? erroBruto.message
    : erroBruto ? String(erroBruto) : null;

  function alterarRascunho(value: string): void {
    setRascunho(formatarLocalInstalacao(value));
    mutacao.reset();
  }

  return {
    rascunho,
    alterarRascunho,
    localCoffee,
    proposto,
    podeSalvar,
    confirmado,
    erro,
    consultando: consulta.isFetching,
    salvando: mutacao.isPending,
    salvo: mutacao.isSuccess,
    atualizarConsulta: consulta.refetch,
    salvar: () => mutacao.mutate(proposto),
  };
}
