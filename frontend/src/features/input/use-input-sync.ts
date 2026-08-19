import React from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { InputApi } from './api';
import { INPUT_DADOS_KEY } from './use-input-data';
import type { NetworkSyncState } from './network-sync-status';
import type { EspelhoRedeEstado, SapSyncState } from './types';

export const INPUT_SYNC_KEY = ['input', 'sync'] as const;
export const SYNC_INTERVALO_REPOUSO_MS = 60_000;
export const SYNC_INTERVALO_ATIVO_MS = 3_000;

interface RespostaSincronizacao {
  versao: string;
  sincronizando?: boolean;
  espelho?: EspelhoRedeEstado;
  sap?: SapSyncState;
}

/** Só avisa quando o erro é novo — o polling repete o mesmo estado a cada ciclo. */
export function deveAvisarFalhaDoEspelho(
  erroAtual: string | null | undefined,
  erroJaAvisado: string | null | undefined,
): boolean {
  return Boolean(erroAtual) && erroAtual !== erroJaAvisado;
}

export function intervaloPollingSincronizacao(
  resposta: Pick<RespostaSincronizacao, 'sincronizando' | 'sap'> | undefined,
): number {
  const sapAtivo = resposta?.sap?.estado === 'executando';
  return resposta?.sincronizando || sapAtivo ? SYNC_INTERVALO_ATIVO_MS : SYNC_INTERVALO_REPOUSO_MS;
}

export function aplicarRespostaSincronizacao(
  queryClient: QueryClient,
  versaoConhecida: string | undefined,
  resposta: Pick<RespostaSincronizacao, 'versao'>,
): boolean {
  if (versaoConhecida === undefined || resposta.versao === versaoConhecida) return false;
  void queryClient.invalidateQueries({ queryKey: INPUT_DADOS_KEY });
  return true;
}

interface UseInputSyncResultado {
  estado: NetworkSyncState['estado'];
  tentarNovamente: () => void;
}

/** Fonte única do status e da detecção de mudanças do Input por aba montada. */
export function useInputSync(
  versaoConhecida: string | undefined,
  estadoSapConhecido?: SapSyncState['estado'],
): UseInputSyncResultado {
  const queryClient = useQueryClient();
  const ultimaVersaoNotificada = React.useRef<string>();
  const ultimoErroEspelho = React.useRef<string | null>(null);
  const ultimoSapNotificado = React.useRef(estadoSapConhecido);
  const consulta = useQuery({
    queryKey: INPUT_SYNC_KEY,
    queryFn: () => InputApi.sync(),
    refetchInterval: (query) => intervaloPollingSincronizacao(query.state.data),
    retry: false,
  });

  React.useEffect(() => {
    if (!consulta.data) return;
    const sapAtual = consulta.data.sap?.estado;
    const sapMudou = estadoSapConhecido !== undefined && sapAtual !== ultimoSapNotificado.current;
    const versaoInvalidou = aplicarRespostaSincronizacao(queryClient, versaoConhecida, consulta.data);
    if (!versaoInvalidou && !sapMudou) {
      ultimoSapNotificado.current = sapAtual;
      return;
    }
    ultimaVersaoNotificada.current = consulta.data.versao;
    ultimoSapNotificado.current = sapAtual;
    if (sapMudou && !versaoInvalidou) {
      void queryClient.invalidateQueries({ queryKey: INPUT_DADOS_KEY });
    }
    toast.info('Dados atualizados por outro usuário', {
      description: 'A tabela foi recarregada em segundo plano.',
    });
  }, [consulta.data, queryClient, versaoConhecida, estadoSapConhecido]);

  React.useEffect(() => {
    const erro = consulta.data?.espelho?.ultimo_erro ?? null;
    const avisar = deveAvisarFalhaDoEspelho(erro, ultimoErroEspelho.current);
    ultimoErroEspelho.current = erro;
    if (!avisar) return;
    toast.error('Falha ao publicar a planilha espelho na rede', {
      description: `${erro} As alterações estão salvas no banco; a publicação é refeita na próxima escrita.`,
    });
  }, [consulta.data?.espelho?.ultimo_erro]);

  React.useEffect(() => {
    if (!consulta.data?.sincronizando) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = 'Sincronização com a rede em andamento. Suas alterações podem ser perdidas se fechar o sistema agora.';
      return event.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [consulta.data?.sincronizando]);

  let estado: NetworkSyncState['estado'] = 'verificando';
  if (consulta.isError) estado = 'indisponivel';
  else if (consulta.data?.sincronizando) estado = 'sincronizando';
  else if (consulta.data) estado = 'sincronizada';

  return {
    estado,
    tentarNovamente: () => { void consulta.refetch(); },
  };
}
