import React from 'react';
import { AlertCircle, ChevronRight, Clock3 } from 'lucide-react';
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

  return (
    <div
      className={[
        'flex items-center gap-[14px] border-b border-line px-[22px] py-[11px]',
        'even:bg-bg-2',
        selected ? 'bg-tint-green' : '',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
        aria-label={`Selecionar nota ${id}`}
        className="size-[14px] shrink-0 accent-green"
      />
      <div className="flex w-[110px] shrink-0 flex-col gap-[3px]">
        <span className="font-mono text-[13px] font-semibold">#{id}</span>
        <span className="font-mono text-[10.5px] text-text-mute">
          {item.origem === 'verificar' ? 'Verificar' : 'Avulsa'}
        </span>
      </div>
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        aria-label={`Abrir detalhes da nota ${id}`}
        className="flex min-w-0 flex-1 items-center gap-[14px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-dim">
          {local || 'Local ainda não consultado'}
          {alimentador && (
            <span className="ml-1 font-mono text-[11.5px] text-text-mute">· {alimentador}</span>
          )}
        </span>
        <span className="shrink-0 text-[12px] text-text-dim">
          prioridade {field(item, 'prioridade') ?? '—'}
        </span>
        <OperacaoStepper etapa={item.etapa} />
        {item.erro ? (
          <span className="flex w-[110px] shrink-0 items-center gap-[5px] text-[12px] text-red">
            <AlertCircle className="size-3" /> {item.erro}
          </span>
        ) : (
          <span className="flex w-[110px] shrink-0 items-center gap-[5px] text-[12px] text-text-mute">
            <Clock3 className="size-3" />
            {formatRelativeTime(item.atualizado_em)}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-text-mute" />
      </button>
      {progress && (
        <div className="w-[70px] shrink-0" aria-label={`${progress.feitas} de ${progress.total}`}>
          <div className="h-[6px] overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${progress.total === 0 ? 0 : Math.round((progress.feitas / progress.total) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
