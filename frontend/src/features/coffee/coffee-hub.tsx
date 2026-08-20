import React from 'react';
import type { CoffeeConclusaoFiltro, CoffeeSubPage, Note } from '../../types';

import { CoffeeAbrir } from './coffee-abrir';
import { CoffeeConcluidas } from './concluidas/coffee-concluidas';
import { CoffeeOperacao } from './operacao/coffee-operacao';
import { CoffeeVerificar, type TriageHandoff } from './coffee-verificar';
import { CoffeeLogs } from './coffee-logs';
import { COFFEE_SUBS } from './subs';
import { Eyebrow, SegTabs } from '@/components/branded/section';
import { Button } from '@/components/ui/button';


function formatSourceDate(value: string | null): string {
  if (!value) return 'data não disponível';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'data não disponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

interface CoffeeHubProps {
  notes: Note[];
  sub: CoffeeSubPage;
  setSub: (s: CoffeeSubPage) => void;
  triage: TriageHandoff;
  coffeeReturn: { noteId: string; noteRef: string } | null;
  concluidasHandoff: { filtro: CoffeeConclusaoFiltro; id: number } | null;
  onIrParaInput?: () => void;
  onIrParaSincronizacao: () => void;
  onClearReturn: () => void;
  onBackToTriagem: () => void;
}

export function CoffeeHub({
  notes,
  sub,
  setSub,
  triage,
  coffeeReturn,
  concluidasHandoff,
  onIrParaInput,
  onIrParaSincronizacao,
  onClearReturn,
  onBackToTriagem,
}: CoffeeHubProps): React.JSX.Element {

  return (
    <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div className="shrink-0 bg-surface border-b border-b-line">
        <div className="pt-3 px-6 pb-2.5 flex items-center gap-3">
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <Eyebrow>Módulo COFFEE</Eyebrow>
            <strong className="text-base font-medium leading-tight tracking-display text-balance text-text">
              Geração de notas
            </strong>
          </div>
          {sub === "verificar" && !triage.isLoading && !triage.error && (
            <div className="flex items-center gap-3 shrink-0">
              <span
                className="font-mono text-[11px] text-text-mute bg-bg-2 py-1 px-2.5 rounded-[6px] border border-line"
                title={`Arquivo atualizado em ${formatSourceDate(triage.fonte?.atualizado_em ?? null)}`}
              >
                {triage.fonte?.arquivo ?? 'Verificar.db'} · schema v{triage.fonte?.schema_version ?? '—'}
              </span>
              <span title="Banco de triagem conectado"
                    className="inline-flex items-center gap-1.5 text-[10.5px]
                             font-mono tracking-wider uppercase
                             py-1 px-2.5 rounded-full
                             text-green bg-tint-green">
                <span className="size-1.5 rounded-full bg-current" />
                Banco conectado
              </span>
              <Button variant="ghost" size="sm" disabled={triage.isRefreshing} onClick={triage.onRetry} className="h-7 text-xs font-medium">
                {triage.isRefreshing ? 'Atualizando…' : 'Atualizar'}
              </Button>
            </div>
          )}
        </div>
        <div className="py-0 px-6 border-t border-t-line">
          <SegTabs tabs={COFFEE_SUBS} value={sub} onChange={setSub}
                   ariaLabel="Seções do módulo COFFEE" />
        </div>
      </div>

      {sub === "abrir" ? (
        <CoffeeAbrir notes={notes}
                     coffeeReturn={coffeeReturn} onClearReturn={onClearReturn}
                     onBackToTriagem={onBackToTriagem} />
      ) : sub === "operacao" ? (
        <CoffeeOperacao onIrParaSincronizacao={onIrParaSincronizacao} />
      ) : sub === "concluidas" ? (
        <CoffeeConcluidas
          concluidasHandoff={concluidasHandoff}
          onIrParaInput={onIrParaInput}
          onIrParaSincronizacao={onIrParaSincronizacao}
        />
      ) : sub === "verificar" ? (
        <CoffeeVerificar triage={triage} />
      ) : sub === "logs" ? (
        <CoffeeLogs />
      ) : null}
    </div>
  );
}
