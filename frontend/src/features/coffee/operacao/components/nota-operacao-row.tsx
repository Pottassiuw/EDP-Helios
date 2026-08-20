import React from 'react';
import { AlertCircle, ChevronRight, Clock3 } from 'lucide-react';
import { PriorityChip } from '@/features/verificar/shared';
import { formatRelativeTime } from '../../format';
import type { CoffeeJob, CoffeeOperacaoItem } from '../../types';
import { OperacaoStepper } from './operacao-stepper';

interface NotaOperacaoRowProps {
  item: CoffeeOperacaoItem;
  selected: boolean;
  progress?: Pick<CoffeeJob, 'feitas' | 'total'>;
  onSelect: (selected: boolean) => void;
  onOpen: (trigger: HTMLButtonElement) => void;
}

function field(item: CoffeeOperacaoItem, key: string): string | null {
  const value = item.nota?.dados_json?.[key];
  return value == null || value === '' ? null : String(value);
}

export function NotaOperacaoRow({
  item,
  selected,
  progress,
  onSelect,
  onOpen,
}: NotaOperacaoRowProps): React.JSX.Element {
  const id = item.nota_pk ?? item.entrada_id;
  const local = [
    field(item, 'cidade'),
    field(item, 'tipo_local_instalacao'),
    field(item, 'local_instalacao_numero'),
  ].filter(Boolean).join('-');
  const alimentador = field(item, 'alimentador');
  const prioRaw = field(item, 'prioridade');
  const prioNum = prioRaw ? Number(prioRaw) : 99;
  const prio = Number.isFinite(prioNum) ? prioNum : 99;

  return (
    <div
      className={[
        'group flex items-center gap-3 border-b border-line px-6 py-2.5 transition-colors',
        selected ? 'bg-tint-green' : 'even:bg-bg-2/50 hover:bg-surface-2/70',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
        aria-label={`Selecionar nota ${id}`}
        className="size-3.5 shrink-0 accent-green cursor-pointer"
      />
      <div className="flex w-[86px] shrink-0 flex-col gap-0.5">
        <span className="font-mono text-xs font-medium text-text">#{id}</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-text-mute">
          {item.origem === 'verificar' ? 'Verificar' : 'Avulsa'}
        </span>
      </div>
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        aria-label={`Abrir detalhes da nota ${id}`}
        className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none rounded focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-xs text-text-dim group-hover:text-text transition-colors">
          {local || 'Local ainda não consultado'}
          {alimentador && (
            <span className="ml-1 font-mono text-[11px] text-text-mute">· {alimentador}</span>
          )}
        </span>
        <PriorityChip p={prio} />
        <OperacaoStepper etapa={item.etapa} />
        {item.erro ? (
          <span className="flex w-[110px] shrink-0 items-center gap-1 font-mono text-xs text-red">
            <AlertCircle className="size-3.5 shrink-0" /> <span className="truncate">{item.erro}</span>
          </span>
        ) : (
          <span className="flex w-[110px] shrink-0 items-center gap-1 font-mono text-[11px] text-text-mute">
            <Clock3 className="size-3 shrink-0" />
            <span className="truncate">{formatRelativeTime(item.atualizado_em)}</span>
          </span>
        )}
        {progress && (
          <div className="w-[60px] shrink-0" aria-label={`${progress.feitas} de ${progress.total}`}>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{
                  width: `${progress.total === 0 ? 0 : Math.round((progress.feitas / progress.total) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}
        <ChevronRight className="size-4 shrink-0 text-text-mute/60 group-hover:text-text group-hover:translate-x-0.5 transition-all" />
      </button>
    </div>
  );
}
