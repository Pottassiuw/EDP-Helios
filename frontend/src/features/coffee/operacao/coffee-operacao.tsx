import React from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Eyebrow } from '@/components/branded/section';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '../confirm-modal';
import {
  CoffeeNotaInspector,
  type InspectorAction,
} from '../components/coffee-nota-inspector';
import { formatRelativeTime } from '../format';
import type { NotaRevisao } from '../types';
import { OperacaoBatchBar } from './components/operacao-batch-bar';
import { OperacaoComposer } from './components/operacao-composer';
import { OperacaoKanban } from './components/operacao-kanban';
import { aguardarJobOperacao, useCoffeeOperacao } from './use-coffee-operacao';
import { resumoJobConsulta } from './resumo-job';

const LEGACY_ROWS_KEY = 'edp_coffee_gerar_rows';
const LEGACY_MIGRATED_KEY = 'edp_coffee_gerar_rows_migrated';

interface CoffeeOperacaoProps {
  onIrParaSincronizacao: () => void;
}

export function CoffeeOperacao({
  onIrParaSincronizacao,
}: CoffeeOperacaoProps): React.JSX.Element {
  const {
    quadro,
    consultar,
    gerar,
    atualizarSap,
    remover,
  } = useCoffeeOperacao();
  const [selected, setSelected] = React.useState<Set<number>>(new Set());
  const [selectedPk, setSelectedPk] = React.useState<number | null>(null);
  const [pendingRemoval, setPendingRemoval] = React.useState<number[] | null>(null);
  const lastTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const legacyMigrationStarted = React.useRef(false);
  const itens = quadro.data?.itens ?? [];
  const selectedItems = itens.filter(
    (item) => selected.has(item.nota_pk ?? item.entrada_id),
  );
  const selectedItem = itens.find(
    (item) => (item.nota_pk ?? item.entrada_id) === selectedPk,
  );
  const waitingSapIds = itens
    .filter((item) => item.etapa === 'aguardando_sap')
    .map((item) => item.nota_pk ?? item.entrada_id);
  const idsNaOperacao = new Set(
    itens.flatMap((item) => [item.entrada_id, item.nota_pk].filter(
      (id): id is number => id !== null,
    )),
  );
  const latestUpdate = itens.reduce<string | null>(
    (latest, item) => (
      latest === null || item.atualizado_em > latest
        ? item.atualizado_em
        : latest
    ),
    null,
  );

  React.useEffect(() => {
    if (legacyMigrationStarted.current) return;

    legacyMigrationStarted.current = true;
    if (sessionStorage.getItem(LEGACY_MIGRATED_KEY) === '1') return;

    try {
      const raw = sessionStorage.getItem(LEGACY_ROWS_KEY);
      const rows = raw
        ? (JSON.parse(raw) as Array<{ id?: unknown }>)
        : [];
      const ids = rows
        .map((row) => Number(row.id))
        .filter((id) => Number.isFinite(id) && id > 0);

      if (ids.length === 0) {
        sessionStorage.setItem(LEGACY_MIGRATED_KEY, '1');
        return;
      }

      const idsUnicos = [...new Set(ids)];
      toast.info(
        `Migrando ${idsUnicos.length} ${idsUnicos.length === 1 ? 'nota' : 'notas'} `
        + 'do antigo modal de geração para a Operação…',
      );
      consultar.mutate(idsUnicos, {
        onSuccess: () => {
          sessionStorage.removeItem(LEGACY_ROWS_KEY);
          sessionStorage.setItem(LEGACY_MIGRATED_KEY, '1');
          toast.success(`${idsUnicos.length} notas migradas para a Operação.`);
        },
        onError: (error) => {
          // Não remove a sessão: os dados legados continuam disponíveis
          // para uma nova tentativa (a migração não é silenciosamente
          // perdida em caso de falha).
          toast.error('Não foi possível migrar as notas do modal anterior.', {
            description: error instanceof Error ? error.message : String(error),
          });
        },
      });
    } catch {
      sessionStorage.setItem(LEGACY_MIGRATED_KEY, '1');
    }
  }, [consultar]);

  function clearSelection(): void {
    setSelected(new Set());
  }

  function toggle(pk: number): void {
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
    const pk = revisao.coffee.pk;
    if (action === 'gerar') {
      generate([pk]);
      return;
    }
    if (action === 'atualizar') {
      updateSap([pk]);
      return;
    }
    if (action === 'remover') {
      setPendingRemoval([pk]);
      return;
    }
    toast.error('Ação indisponível na Operação.');
  }

  function mutationError(action: string, error: unknown): void {
    toast.error(`Não foi possível ${action}`, {
      description: error instanceof Error ? error.message : String(error),
    });
  }

  function aoConsultarComSucesso(ids: number[], jobId: string): void {
    clearSelection();
    toast.info(`Consultando ${ids.length} ${ids.length === 1 ? 'nota' : 'notas'}…`);
    void aguardarJobOperacao(jobId).then((job) => {
      toast.success(resumoJobConsulta(job));
    });
  }

  function consult(ids: number[]): void {
    consultar.mutateAsync(ids)
      .then(({ job_id }) => aoConsultarComSucesso(ids, job_id))
      .catch((error: unknown) => mutationError('consultar as notas', error));
  }

  /** Variante usada pelo composer: ele mesmo decide se fecha/limpa (só no
   * sucesso) e mostra o erro embutido no painel — por isso não engole a
   * rejeição aqui. */
  async function consultarViaComposer(ids: number[]): Promise<void> {
    const { job_id } = await consultar.mutateAsync(ids);
    aoConsultarComSucesso(ids, job_id);
  }

  function generate(ids: number[]): void {
    gerar.mutate(ids, {
      onSuccess: () => {
        clearSelection();
        toast.success(`Geração iniciada para ${ids.length} notas.`);
      },
      onError: (error) => mutationError('gerar as notas', error),
    });
  }

  function updateSap(ids: number[]): void {
    atualizarSap.mutate(ids, {
      onSuccess: () => {
        clearSelection();
        toast.success(`Atualização SAP iniciada para ${ids.length} notas.`);
      },
      onError: (error) => mutationError('atualizar o SAP', error),
    });
  }

  function confirmRemoval(justificativa: string): void {
    if (pendingRemoval === null) return;

    remover.mutate(
      { ids: pendingRemoval, justificativa },
      {
        onSuccess: () => {
          clearSelection();
          setPendingRemoval(null);
          toast.success(`${pendingRemoval.length} notas removidas da operação.`);
        },
        onError: (error) => mutationError('remover as notas', error),
      },
    );
  }

  return (
    <div
      className="relative flex flex-1 flex-col overflow-hidden"
      data-selected-pk={selectedPk ?? undefined}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-[22px] py-4">
        <div className="min-w-0 flex-1">
          <Eyebrow>Fluxo ativo</Eyebrow>
          <h1 className="text-lg font-semibold tracking-display text-balance">Geração de notas</h1>
        </div>
        <span className="font-mono text-xs text-text-mute">
          {itens.length} em andamento
        </span>
        <span className="font-mono text-xs text-text-mute">
          {latestUpdate
            ? `Atualizado ${formatRelativeTime(latestUpdate)}`
            : 'Sem atualizações'}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={waitingSapIds.length === 0 || atualizarSap.isPending}
          onClick={() => updateSap(waitingSapIds)}
        >
          <RefreshCw /> Atualizar pendentes
        </Button>
        <OperacaoComposer
          pending={consultar.isPending}
          idsNaOperacao={idsNaOperacao}
          onConsultar={consultarViaComposer}
        />
      </header>
      {quadro.isError && (
        <div className="border-b border-line px-[22px] py-3 text-sm text-red" role="alert">
          Não foi possível carregar a operação. Atualize a página para tentar novamente.
        </div>
      )}
      <OperacaoKanban
        itens={itens}
        jobs={quadro.data?.operacoes_ativas ?? []}
        selected={selected}
        onToggle={toggle}
        onOpen={openInspector}
      />
      <OperacaoBatchBar
        itens={selectedItems}
        allItems={itens}
        onClear={clearSelection}
        onSelectColumn={(ids) => setSelected(new Set(ids))}
        onGerar={generate}
        onAtualizar={updateSap}
        onReconsultar={consult}
        onRemover={setPendingRemoval}
      />
      <ConfirmModal
        open={pendingRemoval !== null}
        title="Remover notas da operação"
        message="As notas serão removidas da operação atual. Informe o motivo."
        confirmLabel="Remover"
        tone="danger"
        requireJustification
        busy={remover.isPending}
        onConfirm={confirmRemoval}
        onCancel={() => setPendingRemoval(null)}
      />
      <CoffeeNotaInspector
        pk={selectedPk}
        etapa={selectedItem?.etapa}
        open={selectedPk !== null}
        onClose={closeInspector}
        onAction={handleInspectorAction}
        onIrParaSincronizacao={onIrParaSincronizacao}
      />
    </div>
  );
}
