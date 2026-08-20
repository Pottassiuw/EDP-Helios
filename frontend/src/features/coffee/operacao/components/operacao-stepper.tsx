import React from 'react';
import type { OperacaoEtapa } from '../../types';

const ETAPAS: OperacaoEtapa[] = ['fila', 'pronta', 'processando', 'aguardando_sap'];

const ROTULOS: Record<OperacaoEtapa, string> = {
  fila: 'Fila',
  pronta: 'Pronta',
  processando: 'Processando',
  aguardando_sap: 'Aguardando SAP',
};

const NODE_ATUAL: Record<OperacaoEtapa, string> = {
  fila: 'bg-indigo ring-4 ring-tint-indigo',
  pronta: 'bg-green ring-4 ring-tint-green',
  processando: 'bg-amber ring-4 ring-tint-amber motion-safe:animate-pulse',
  aguardando_sap: 'bg-blue ring-4 ring-tint-blue',
};

const LABEL_COR: Record<OperacaoEtapa, string> = {
  fila: 'text-indigo',
  pronta: 'text-[var(--green-3)]',
  processando: 'text-amber',
  aguardando_sap: 'text-blue',
};

interface OperacaoStepperProps {
  etapa: OperacaoEtapa;
}

/** Mini-stepper de 5 nós (4 etapas reais + 1 nó fantasma tracejado
 * "Concluída"): mostra a jornada da própria nota em vez de depender de o
 * usuário saber em qual coluna de um Kanban ela está. */
export function OperacaoStepper({ etapa }: OperacaoStepperProps): React.JSX.Element {
  const indiceAtual = ETAPAS.indexOf(etapa);
  const sufixo = etapa === 'aguardando_sap' ? ' · sai ao concluir' : '';

  return (
    <div className="flex w-[222px] shrink-0 flex-col gap-[5px]">
      <div className="flex items-center">
        {ETAPAS.map((passo, indice) => (
          <React.Fragment key={passo}>
            <span
              className={[
                'h-[9px] w-[9px] shrink-0 rounded-full',
                indice < indiceAtual
                  ? 'bg-green'
                  : indice === indiceAtual
                    ? NODE_ATUAL[passo]
                    : 'bg-line-2',
              ].join(' ')}
            />
            <span
              className={[
                'h-[2px] w-[24px] shrink-0',
                indice < indiceAtual ? 'bg-green' : 'bg-line-2',
              ].join(' ')}
            />
          </React.Fragment>
        ))}
        <span className="h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-dashed border-line-2 bg-surface" />
      </div>
      <span className={`font-mono text-[10px] font-medium uppercase tracking-[0.07em] ${LABEL_COR[etapa]}`}>
        {ROTULOS[etapa]}{sufixo}
      </span>
    </div>
  );
}
