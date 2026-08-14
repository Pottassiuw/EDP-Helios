import React from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { toast } from 'sonner';

import { EDPApi } from '../../api';
import {
  analisarEdicaoLocal,
  comporLocalInstalacao,
  dividirLocalInstalacao,
  normalizarLocalInstalacao,
  type LocalInstalacaoPartes,
} from '../../lib/local-instalacao';
import type { CoffeeConsulta, Municipio } from '../coffee/types';
import { OPERACAO_KEY } from '../coffee/operacao/use-coffee-operacao';
import { COFFEE_CONSULTA_KEY, MUNICIPIOS_KEY, TIPOS_EQUIPAMENTO_KEY } from '../coffee/coffee-query-keys';
import { REVISAO_KEY } from '../coffee/use-nota-revisao';
import { corrigirEConfirmarLocal } from './local-instalacao-service';

/** Sentinela do item "outro código" no Select de município — nunca colide
 * com um código real (sempre 3 dígitos numéricos). */
export const MUNICIPIO_MANUAL_VALUE = '__manual__';

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

export function useMunicipios() {
  return useQuery({
    queryKey: MUNICIPIOS_KEY,
    queryFn: EDPApi.listarMunicipios,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

export function useTiposEquipamento() {
  return useQuery({
    queryKey: TIPOS_EQUIPAMENTO_KEY,
    queryFn: EDPApi.listarTiposEquipamento,
    staleTime: 24 * 60 * 60 * 1000,
  });
}

/** Município reconhecido pela lista carregada continua no Select; um código
 * fora da lista (nota antiga, código descontinuado) cai em edição manual
 * pra não perder o valor original silenciosamente. */
function municipioReconhecido(codigo: string, lista: Municipio[] | undefined): boolean {
  return codigo === '' || (lista ?? []).some((m) => m.codigo === codigo);
}

export function useLocalInstalacaoCorrection(
  noteId: string,
  localTriagem: string,
  consulta: UseQueryResult<CoffeeConsulta>,
) {
  const queryClient = useQueryClient();
  const id = /^\d+$/.test(noteId) ? Number(noteId) : null;
  const municipios = useMunicipios();

  const iniciais = dividirLocalInstalacao(localTriagem);
  const [municipio, setMunicipio] = React.useState(iniciais.municipio);
  const [tipo, setTipo] = React.useState(iniciais.tipo);
  const [numero, setNumero] = React.useState(iniciais.numero);
  const [municipioManual, setMunicipioManual] = React.useState(false);

  function aplicarPartes(valor: string | null | undefined, lista: Municipio[] | undefined): void {
    const partes = dividirLocalInstalacao(valor);
    setMunicipio(partes.municipio);
    setTipo(partes.tipo);
    setNumero(partes.numero);
    setMunicipioManual(!municipioReconhecido(partes.municipio, lista));
  }

  // Ajusta o rascunho durante o render quando a nota selecionada muda —
  // evita remount (`key`) só pra resetar estado de formulário por nota.
  const [noteIdAnterior, setNoteIdAnterior] = React.useState(noteId);
  if (noteId !== noteIdAnterior) {
    setNoteIdAnterior(noteId);
    aplicarPartes(localTriagem, municipios.data);
  }

  const mutacao = useMutation({
    mutationFn: async (local: string) => {
      if (id === null) throw new Error('A correção exige um ID ONR numérico.');
      return corrigirEConfirmarLocal(id, local);
    },
    onSuccess: async (confirmada) => {
      if (id === null) return;
      queryClient.setQueryData(COFFEE_CONSULTA_KEY(id), confirmada);
      aplicarPartes(confirmada.local_instalacao, municipios.data);
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
    aplicarPartes(consulta.data.local_instalacao, municipios.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consulta.data, municipios.data]);

  const partes: LocalInstalacaoPartes = { municipio, tipo, numero };
  const proposto = comporLocalInstalacao(partes);
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

  function escolherMunicipio(valor: string): void {
    if (valor === MUNICIPIO_MANUAL_VALUE) {
      setMunicipioManual(true);
      setMunicipio('');
    } else {
      setMunicipioManual(false);
      setMunicipio(valor);
    }
    mutacao.reset();
  }

  function alterarMunicipioManual(valor: string): void {
    setMunicipio(normalizarLocalInstalacao(valor).slice(0, 3));
    mutacao.reset();
  }

  function voltarParaLista(): void {
    setMunicipioManual(false);
    setMunicipio((atual) => (municipioReconhecido(atual, municipios.data) ? atual : ''));
    mutacao.reset();
  }

  function alterarTipo(valor: string): void {
    setTipo(valor);
    mutacao.reset();
  }

  function alterarNumero(valor: string): void {
    setNumero(valor.replace(/\D/g, '').slice(0, 8));
    mutacao.reset();
  }

  return {
    municipio,
    tipo,
    numero,
    municipioManual,
    municipios,
    escolherMunicipio,
    alterarMunicipioManual,
    voltarParaLista,
    alterarTipo,
    alterarNumero,
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
