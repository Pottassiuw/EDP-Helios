import React from 'react';
import type { AbaInput } from './types';
import { toast } from 'sonner';
import { getUsuario, setUsuario, InputApi } from './api';
import { useInputData, useRecarregarInput } from './use-input-data';
import { useInputSync } from './use-input-sync';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { Overview } from './overview';
import { Manage } from './manage';
import { Ramal } from './ramal';
import { Reports } from './reports';
import { Logs } from './logs';
import { Settings } from './settings';
import { NotesTableSkeleton } from './notes-table-skeleton';
import { Button } from '@/components/ui/button';
import { PageHeader, SegTabs } from '@/components/branded/section';
import { Filters, FILTROS_INICIAIS, type FiltersState } from './filters';
import { INPUT_SUBS } from './subs';
import { NetworkSyncStatus } from './network-sync-status';

interface InputSectionProps {
  sub: AbaInput;
  setSub: (s: AbaInput) => void;
  filtrosHandoff?: { estado: FiltersState; id: number } | null;
  onIrParaSincronizacao: () => void;
}

export function InputSection({
  sub,
  setSub,
  filtrosHandoff,
  onIrParaSincronizacao,
}: InputSectionProps): React.JSX.Element {
  const { data: dados, isLoading, error, dataUpdatedAt } = useInputData();
  const recarregar = useRecarregarInput();
  const [estadoFiltros, setEstadoFiltros] = React.useState<FiltersState>(() => {
    try {
      const salvas = localStorage.getItem('input_estado_filtros');
      if (salvas) {
        const parsed = JSON.parse(salvas);
        if (typeof parsed.busca === 'string' && typeof parsed.somente2026 === 'boolean' && Array.isArray(parsed.filtros)) {
          return {
            ...FILTROS_INICIAIS,
            ...parsed,
            somenteNotasMaes: false,
          };
        }
      }
    } catch (e) {
      // Silencia
    }
    return FILTROS_INICIAIS;
  });
  const { estado: estadoRede, tentarNovamente } = useInputSync(dados?.meta.versao, dados?.meta.sap?.estado);

  React.useEffect(() => {
    try {
      localStorage.setItem('input_estado_filtros', JSON.stringify(estadoFiltros));
    } catch (e) {
      // Silencia
    }
  }, [estadoFiltros]);

  React.useEffect(() => {
    if (!getUsuario()) {
      InputApi.me()
        .then(({ usuario }) => setUsuario(usuario))
        .catch(() => setUsuario('sistema'));
    }
  }, []);

  React.useEffect(() => {
    if (filtrosHandoff) setEstadoFiltros(filtrosHandoff.estado);
  }, [filtrosHandoff?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const basesAusentes = dados?.meta.bases.filter((b) => !b.encontrada) ?? [];
  const clearFilters = React.useCallback(() => setEstadoFiltros(FILTROS_INICIAIS), []);

  return (
    <div className="input-scope flex-1 min-w-0 flex flex-col overflow-hidden h-full">
      <div className="shrink-0 bg-surface border-b border-b-line pt-[13px] px-[22px] pb-[11px]">
        <PageHeader
          eyebrow="Rede EDP · SQLite Local"
          title="Gestão de Notas"
          subtitle="Controle unificado de notas, alterações, base ramal e indicadores."
          action={
            <div className="flex items-center gap-3 flex-wrap">
              <NetworkSyncStatus estado={estadoRede} onTentarNovamente={tentarNovamente} />
              <SegTabs tabs={INPUT_SUBS} value={sub} onChange={setSub} ariaLabel="Seções do módulo Input" />
            </div>
          }
        />
      </div>

      {dados && (sub === 'visao' || sub === 'gerenciar' || sub === 'ramal' || sub === 'relatorios') && (
        <div className="shrink-0 bg-surface border-b border-line px-6 py-3">
          <Filters registros={dados.registros} estado={estadoFiltros} setEstado={setEstadoFiltros} />
        </div>
      )}

      {dados && dados.meta.migracao === 'rede-indisponivel' && dados.registros.length === 0 && (
        <div className="mx-6 mt-3 p-3 rounded-md bg-amber/10 border border-amber/30 text-amber text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber" />
            <span>Importação inicial pendente: a rede da EDP estava indisponível.</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              void (async () => {
                const { InputApi } = await import('./api');
                try {
                  await InputApi.migrar();
                  await recarregar();
                  toast.success('Importação reprocessada');
                } catch (e) {
                  toast.error('Falha na importação', { description: e instanceof Error ? e.message : String(e) });
                }
              })();
            }}
          >
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Tentar Importar
          </Button>
        </div>
      )}

      {basesAusentes.length > 0 && (
        <div className="mx-6 mt-2 px-3 py-1.5 rounded-md bg-amber/10 border border-amber/20 text-amber text-xs flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{basesAusentes.length} de {dados!.meta.bases.length} bases da rede indisponíveis — exibindo indicadores parciais.</span>
        </div>
      )}

      {isLoading && (
        <div className="p-6">
          <NotesTableSkeleton />
        </div>
      )}

      {error != null && !dados && (
        <div role="alert" className="m-6 p-4 rounded-md bg-red/10 border border-red/20 text-red text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Backend indisponível. O módulo Input exige o backend rodando na porta 8000. Detalhe: {String((error as Error).message)}</span>
        </div>
      )}

      {error != null && dados && (
        <div role="alert" className="mx-6 mt-2 px-3 py-1.5 rounded-md bg-amber/10 border border-amber/20 text-amber text-xs">
          Backend indisponível — mostrando dados salvos{dataUpdatedAt ? ` de ${new Date(dataUpdatedAt).toLocaleString('pt-BR')}` : ''}.
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {dados && sub === 'visao' && (
          <Overview
            dados={dados}
            estado={estadoFiltros}
            onIrParaSincronizacao={onIrParaSincronizacao}
            onClearFilters={clearFilters}
          />
        )}
        {dados && sub === 'gerenciar' && <Manage dados={dados} estadoFiltros={estadoFiltros} onClearFilters={clearFilters} />}
        {dados && sub === 'ramal' && <Ramal dadosPrincipais={dados} estadoFiltros={estadoFiltros} onClearFilters={clearFilters} />}
        {dados && sub === 'relatorios' && <Reports dados={dados} estadoFiltros={estadoFiltros} />}
        {dados && sub === 'logs' && <Logs />}
        {dados && sub === 'config' && <Settings dados={dados} />}
      </div>
    </div>
  );
}
