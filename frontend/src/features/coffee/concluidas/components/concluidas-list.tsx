import React from 'react';
import type { CoffeeNota } from '../../types';
import { formatRelativeTime } from '../../format';
import { completionDate } from '../concluidas-utils';

interface ConcluidasListProps {
  notas: CoffeeNota[];
  selected: Set<number>;
  onToggle: (pk: number) => void;
  onOpen: (pk: number, trigger: HTMLButtonElement) => void;
}

function field(nota: CoffeeNota, key: string): string {
  const value = nota.dados_json?.[key];
  return value == null || value === '' ? '—' : String(value);
}

function local(nota: CoffeeNota): string {
  const parts = [
    field(nota, 'cidade'),
    field(nota, 'tipo_local_instalacao'),
    field(nota, 'local_instalacao_numero'),
  ].filter((value) => value !== '—');

  return parts.length > 0 ? parts.join('-') : '—';
}

function Resultado({ nota }: { nota: CoffeeNota }): React.JSX.Element {
  const gerada = nota.classificacao === 'gerada';

  return (
    <span
      className={[
        'w-fit rounded-full px-2 py-1 text-xs font-medium',
        gerada ? 'bg-tint-green text-green' : 'bg-tint-blue text-blue',
      ].join(' ')}
    >
      {gerada ? 'Gerada' : 'Corrigida'}
    </span>
  );
}

function SelectNota({
  nota,
  selected,
  onToggle,
}: {
  nota: CoffeeNota;
  selected: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  if (nota.classificacao !== 'corrigida') {
    return <span className="size-4" aria-hidden="true" />;
  }

  return (
    <input
      type="checkbox"
      checked={selected}
      onChange={onToggle}
      aria-label={`Selecionar nota corrigida ${nota.pk}`}
    />
  );
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function LegacyDate({ nota }: { nota: CoffeeNota }): React.JSX.Element {
  const fallback = nota.classificacao_em == null;

  return (
    <span title={fallback ? 'Data da última consulta' : undefined}>
      {formatRelativeTime(completionDate(nota))}
    </span>
  );
}

export function ConcluidasList({
  notas,
  selected,
  onToggle,
  onOpen,
}: ConcluidasListProps): React.JSX.Element {
  if (notas.length === 0) {
    return (
      <div className="grid flex-1 place-items-center p-8 text-sm text-text-mute">
        Nenhuma nota concluída encontrada.
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className="sticky top-0 z-10 hidden grid-cols-[28px_0.7fr_0.8fr_1.8fr_0.9fr_0.8fr_0.8fr] gap-3 border-b border-line bg-bg-2 px-[22px] py-2 text-xs text-text-mute md:grid"
        aria-hidden="true"
      >
        <span />
        <span>ID</span>
        <span>SAP</span>
        <span>Local</span>
        <span>Resultado</span>
        <span>Veio de Verificar</span>
        <span>Corrigida em</span>
      </div>
      {notas.map((nota) => (
        <article key={nota.pk} className="border-b border-line px-[22px] py-3">
          <div className="hidden grid-cols-[28px_1fr] items-center gap-3 md:grid">
            <SelectNota
              nota={nota}
              selected={selected.has(nota.pk)}
              onToggle={() => onToggle(nota.pk)}
            />
            <button
              type="button"
              onClick={(event) => onOpen(nota.pk, event.currentTarget)}
              className="grid grid-cols-[0.7fr_0.8fr_1.8fr_0.9fr_0.8fr_0.8fr] items-center gap-3 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Abrir detalhes da nota ${nota.pk}`}
            >
              <span className="font-mono">#{nota.pk}</span>
              <span className="font-mono">{nota.id_sap ?? '—'}</span>
              <span className="truncate">{local(nota)}</span>
              <span><Resultado nota={nota} /></span>
              <span>{nota.origem === 'verificar' ? formatDateTime(nota.verificar_em) : '—'}</span>
              <span className="text-text-mute">
                {nota.classificacao === 'corrigida'
                  ? formatDateTime(nota.corrigida_em ?? completionDate(nota))
                  : <LegacyDate nota={nota} />}
              </span>
            </button>
          </div>
          <div className="flex items-start gap-3 md:hidden">
            <SelectNota
              nota={nota}
              selected={selected.has(nota.pk)}
              onToggle={() => onToggle(nota.pk)}
            />
            <button
              type="button"
              onClick={(event) => onOpen(nota.pk, event.currentTarget)}
              className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={`Abrir detalhes da nota ${nota.pk}`}
            >
              <div className="flex items-center gap-2">
                <strong className="font-mono">#{nota.pk}</strong>
                <Resultado nota={nota} />
              </div>
              <p className="mt-2 truncate text-sm">{local(nota)}</p>
              <p className="mt-1 text-xs text-text-mute">
                SAP {nota.id_sap ?? '—'} · {nota.origem === 'verificar'
                  ? `Verificar ${formatDateTime(nota.verificar_em)} · Corrigida ${formatDateTime(nota.corrigida_em ?? completionDate(nota))}`
                  : <LegacyDate nota={nota} />}
              </p>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
