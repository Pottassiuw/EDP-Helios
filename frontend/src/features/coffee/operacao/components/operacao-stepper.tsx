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
  fila: 'bg-indigo ring-2 ring-indigo/30 ring-offset-1 ring-offset-surface',
  pronta: 'bg-green ring-2 ring-green/30 ring-offset-1 ring-offset-surface',
  processando: 'bg-amber ring-2 ring-amber/30 ring-offset-1 ring-offset-surface motion-safe:animate-pulse',
  aguardando_sap: 'bg-blue ring-2 ring-blue/30 ring-offset-1 ring-offset-surface',
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
    <div className="flex w-[184px] shrink-0 flex-col gap-1">
      <div className="flex items-center">
        {ETAPAS.map((passo, indice) => (
          <React.Fragment key={passo}>
            <span
              className={[
                'size-2 shrink-0 rounded-full transition-all',
                indice < indiceAtual
                  ? 'bg-green'
                  : indice === indiceAtual
                    ? NODE_ATUAL[passo]
                    : 'bg-line-2',
              ].join(' ')}
            />
            <span
              className={[
                'h-[1.5px] w-4 shrink-0',
                indice < indiceAtual ? 'bg-green' : 'bg-line-2',
              ].join(' ')}
            />
          </React.Fragment>
        ))}
        <span
          title="Concluída (sai da operação)"
          className="size-2.5 shrink-0 rounded-full border border-dashed border-line-2 bg-surface"
        />
      </div>
      <span className={`font-mono text-[10px] font-medium tracking-[0.06em] ${LABEL_COR[etapa]}`}>
        {ROTULOS[etapa]}{sufixo}
      </span>
    </div>
  );
}
