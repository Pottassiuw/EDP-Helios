import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CoffeeConclusaoFiltro } from '../../../types';
import { Eyebrow } from '@/components/branded/section';
import { Button } from '@/components/ui/button';
import { baixarBlob } from '@/lib/download';
import { ConfirmModal } from '../confirm-modal';
import {
  CoffeeNotaInspector,
  type InspectorAction,
} from '../components/coffee-nota-inspector';
import { MoverPlanoModal, type MoverAlvo } from '../mover-plano-modal';
import type { NotaRevisao } from '../types';
import { REVISAO_KEY } from '../use-nota-revisao';
import { OperacaoApi } from '../operacao/operacao-api';
import { CONCLUIDAS_KEY, useCoffeeConcluidas } from './use-coffee-concluidas';
import { completionDate, notaMatches } from './concluidas-utils';
import { exportCoffeeConcluidas } from './concluidas-api';
import {
  ConcluidasToolbar,
  type ConcluidasPeriodo,
} from './components/concluidas-toolbar';
import { ConcluidasList } from './components/concluidas-list';

interface CoffeeConcluidasProps {
  concluidasHandoff: { filtro: CoffeeConclusaoFiltro; id: number } | null;
  onIrParaInput?: () => void;
  onIrParaSincronizacao: () => void;
}

function inPeriod(date: string, periodo: ConcluidasPeriodo): boolean {
  if (periodo === 'tudo') return true;

  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return false;

  const days = periodo === '7d' ? 7 : 30;
  return parsed >= Date.now() - days * 86_400_000;
}

export function CoffeeConcluidas({
  concluidasHandoff,
  onIrParaInput,
  onIrParaSincronizacao,
}: CoffeeConcluidasProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const concluidas = useCoffeeConcluidas();
  const notas = concluidas.data ?? [];
  const [filtro, setFiltro] = React.useState<CoffeeConclusaoFiltro>('todas');
  const [query, setQuery] = React.useState('');
  const [periodo, setPeriodo] = React.useState<ConcluidasPeriodo>('30d');
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [selectedPk, setSelectedPk] = React.useState<number | null>(null);
  const [moverAlvo, setMoverAlvo] = React.useState<MoverAlvo | null>(null);
  const [archivePk, setArchivePk] = React.useState<number | null>(null);
  const lastHandoffId = React.useRef<number | null>(null);
  const lastTriggerRef = React.useRef<HTMLButtonElement | null>(null);

  const contagens = React.useMemo(() => ({
    todas: notas.length,
    gerada: notas.filter((nota) => nota.classificacao === 'gerada').length,
    corrigida: notas.filter((nota) => nota.classificacao === 'corrigida').length,
  }), [notas]);

  const filtered = React.useMemo(() => (
    notas
      .filter((nota) => (
        (filtro === 'todas' || nota.classificacao === filtro)
        && notaMatches(nota, query)
        && inPeriod(completionDate(nota), periodo)
      ))
      .sort((left, right) => (
        new Date(completionDate(right)).getTime()
        - new Date(completionDate(left)).getTime()
      ))
  ), [filtro, notas, periodo, query]);

  const selectablePks = React.useMemo(() => new Set(
    filtered
      .filter((nota) => nota.classificacao === 'corrigida')
      .map((nota) => nota.pk),
  ), [filtered]);
  const visibleSelected = React.useMemo(() => new Set(
    [...selected].filter((pk) => selectablePks.has(pk)),
  ), [selectablePks, selected]);

  React.useEffect(() => {
    if (
      concluidasHandoff === null
      || concluidasHandoff.id === lastHandoffId.current
    ) return;

    lastHandoffId.current = concluidasHandoff.id;
    setFiltro(concluidasHandoff.filtro);
  }, [concluidasHandoff]);

  React.useEffect(() => {
    setSelected((current) => {
      const next = new Set([...current].filter((pk) => selectablePks.has(pk)));
      return next.size === current.size ? current : next;
    });
  }, [selectablePks]);

  const archiveMutation = useMutation({
    mutationFn: ({ pk, justificativa }: { pk: number; justificativa: string }) => (
      OperacaoApi.arquivar(pk, justificativa)
    ),
    onSuccess: async (_, variables) => {
      setArchivePk(null);
      setSelectedPk(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONCLUIDAS_KEY }),
        queryClient.invalidateQueries({ queryKey: REVISAO_KEY(variables.pk) }),
      ]);
      toast.success('Nota arquivada');
    },
    onError: (error: unknown) => {
      toast.error('Falha ao arquivar', {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  const exportMutation = useMutation({
    mutationFn: () => exportCoffeeConcluidas(filtered.map((nota) => nota.pk)),
    onSuccess: (arquivo) => {
      const hoje = new Date().toISOString().slice(0, 10);
      baixarBlob(arquivo, `notas_concluidas_${hoje}.xlsx`);
      toast.success(`${filtered.length} nota(s) exportada(s) para Excel`);
    },
    onError: (error: unknown) => {
      toast.error('Não foi possível exportar as notas concluídas', {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });

  function toggle(pk: number): void {
    if (!selectablePks.has(pk)) return;

    setSelected((current) => {
      const next = new Set(current);
      if (next.has(pk)) next.delete(pk);
      else next.add(pk);
      return next;
    });
  }

  function openInspector(pk: number, trigger: HTMLButtonElement): void {
    lastTriggerRef.current = trigger;
    setSelectedPk(pk);
  }

  function closeInspector(): void {
    setSelectedPk(null);
    window.requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  function handleInspectorAction(
    action: InspectorAction,
    revisao: NotaRevisao,
  ): void {
    if (action === 'mover') {
      if (revisao.coffee.classificacao !== 'corrigida') {
        toast.error('Somente notas corrigidas podem ser movidas para o plano.');
        return;
      }
      setMoverAlvo({ pks: [revisao.coffee.pk], revisao });
      return;
    }
    if (action === 'arquivar') {
      setArchivePk(revisao.coffee.pk);
      return;
    }
    toast.error('Ação indisponível em notas concluídas.');
  }

  async function copyIds(): Promise<void> {
    try {
      await navigator.clipboard.writeText(filtered.map((nota) => nota.pk).join('\n'));
      toast.success(`${filtered.length} ID(s) copiado(s)`);
    } catch (error: unknown) {
      toast.error('Não foi possível copiar automaticamente', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (concluidas.error) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-sm text-red">
        <div className="text-center">
          <p>Falha ao carregar notas concluídas.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void concluidas.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="px-[22px] pt-4">
        <Eyebrow>Histórico operacional</Eyebrow>
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold tracking-display text-balance">Notas concluídas</h1>
          <span className="font-mono text-xs text-text-mute">
            {contagens.todas} no total
          </span>
        </div>
      </header>
      <ConcluidasToolbar
        filtro={filtro}
        onFiltroChange={setFiltro}
        query={query}
        onQueryChange={setQuery}
        periodo={periodo}
        onPeriodoChange={setPeriodo}
        contagens={contagens}
        copyDisabled={filtered.length === 0}
        onCopy={() => void copyIds()}
        exportDisabled={filtered.length === 0}
        exportPending={exportMutation.isPending}
        onExport={() => exportMutation.mutate()}
      />
      <div className="flex items-center gap-3 border-b border-line px-[22px] py-2">
        <span className="font-mono text-xs text-text-mute">
          {concluidas.isLoading ? 'Carregando…' : `${filtered.length} resultados`}
        </span>
        <div className="flex-1" />
        <Button
          size="sm"
          disabled={visibleSelected.size === 0}
          onClick={() => setMoverAlvo({ pks: [...visibleSelected], revisao: null })}
        >
          Mover para Plano ({visibleSelected.size})
        </Button>
      </div>
      <ConcluidasList
        notas={filtered}
        selected={visibleSelected}
        onToggle={toggle}
        onOpen={openInspector}
      />
      <CoffeeNotaInspector
        pk={selectedPk}
        open={selectedPk !== null}
        showArchive={notas.find((nota) => nota.pk === selectedPk)?.classificacao === 'gerada'}
        showMove={notas.find((nota) => nota.pk === selectedPk)?.classificacao === 'corrigida'}
        onClose={closeInspector}
        onAction={handleInspectorAction}
        onIrParaSincronizacao={onIrParaSincronizacao}
      />
      <ConfirmModal
        open={archivePk !== null}
        title="Arquivar nota"
        message="A nota deixará de aparecer nas listagens."
        confirmLabel="Arquivar"
        tone="danger"
        requireJustification
        busy={archiveMutation.isPending}
        onCancel={() => setArchivePk(null)}
        onConfirm={(justificativa) => {
          if (archivePk !== null) {
            archiveMutation.mutate({ pk: archivePk, justificativa });
          }
        }}
      />
      <MoverPlanoModal
        alvo={moverAlvo}
        onClose={() => setMoverAlvo(null)}
        onSucesso={() => setSelected(new Set())}
        onIrParaInput={onIrParaInput}
      />
    </div>
  );
}
