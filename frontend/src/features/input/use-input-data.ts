import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { InputApi } from './api';
import { gravarSnapshot, lerSnapshot, SNAPSHOT_INPUT } from './cache';
import type { NetworkSyncState } from './network-sync-status';
import type { InputDataset } from './types';

export const INPUT_DADOS_KEY = ['input-dados'] as const;

export async function obterEstadoRede(): Promise<NetworkSyncState> {
  try {
    const resposta = await InputApi.sync();
    return { estado: resposta.sincronizando ? 'sincronizando' : 'sincronizada' };
  } catch {
    return { estado: 'indisponivel' };
  }
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
      if (qc.getQueryData(INPUT_DADOS_KEY) === undefined) {
        qc.setQueryData(INPUT_DADOS_KEY, snap.dados as InputDataset,
                        { updatedAt: Date.parse(snap.salvoEm) });
      }
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

/** Polling de /sync: quando outro usuário salva, revalida em background e avisa. */
export function useSincronizacaoAutomatica(versaoConhecida: string | undefined): void {
  const qc = useQueryClient();
  React.useEffect(() => {
    if (versaoConhecida === undefined) return;
    const id = window.setInterval(() => {
      InputApi.sync()
        .then((s) => {
          if (s.versao !== versaoConhecida) {
            toast.info('Dados atualizados por outro usuário', {
              description: 'A tabela foi recarregada em segundo plano.',
            });
            void qc.invalidateQueries({ queryKey: INPUT_DADOS_KEY });
          }
        })
        .catch(() => { /* backend fora: o erro aparece no fluxo principal */ });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [versaoConhecida, qc]);
}

/** Hook para monitorar sincronização de rede ativa e bloquear o fechamento do navegador. */
export function useNetworkSync(): {
  estado: NetworkSyncState['estado'];
  tentarNovamente: () => void;
} {
  const [status, setStatus] = React.useState<NetworkSyncState>({ estado: 'verificando' });
  const ativo = React.useRef(true);
  const sequencia = React.useRef(0);

  const consultar = React.useCallback((mostrarVerificando: boolean) => {
    const tentativa = ++sequencia.current;
    if (mostrarVerificando) setStatus({ estado: 'verificando' });
    void obterEstadoRede().then((novoStatus) => {
      if (ativo.current && tentativa === sequencia.current) setStatus(novoStatus);
    });
  }, []);

  const tentarNovamente = React.useCallback(() => consultar(true), [consultar]);

  React.useEffect(() => {
    ativo.current = true;
    consultar(false);
    const intervalId = window.setInterval(() => consultar(false), 3000);
    return () => {
      ativo.current = false;
      sequencia.current += 1;
      window.clearInterval(intervalId);
    };
  }, [consultar]);

  React.useEffect(() => {
    if (status.estado !== 'sincronizando') return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = 'Sincronização com a rede em andamento. Suas alterações podem ser perdidas se fechar o sistema agora.';
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [status.estado]);

  return { estado: status.estado, tentarNovamente };
}
