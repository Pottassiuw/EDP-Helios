import React from 'react';
import type { CoffeeJob, CoffeeOperacaoItem } from '../../types';
import { NotaOperacaoRow } from './nota-operacao-row';

type Ordenacao = 'atualizacao' | 'prioridade';

interface OperacaoListaProps {
  itens: CoffeeOperacaoItem[];
  jobs: CoffeeJob[];
  selected: Set<number>;
  onToggle: (pk: number) => void;
  onOpen: (pk: number, trigger: HTMLButtonElement) => void;
}

function valorPrioridade(item: CoffeeOperacaoItem): number {
  const numero = Number(item.nota?.dados_json?.prioridade);
  return Number.isFinite(numero) ? numero : Number.POSITIVE_INFINITY;
}

function ordenar(itens: CoffeeOperacaoItem[], ordenacao: Ordenacao): CoffeeOperacaoItem[] {
  const copia = [...itens];
  if (ordenacao === 'prioridade') {
    return copia.sort((a, b) => valorPrioridade(a) - valorPrioridade(b));
  }
  return copia.sort((a, b) => (a.atualizado_em < b.atualizado_em ? 1 : -1));
}

const LEGENDA: Array<{ etapa: string; cor: string; rotulo: string }> = [
  { etapa: 'fila', cor: 'bg-indigo', rotulo: 'Fila' },
  { etapa: 'pronta', cor: 'bg-green', rotulo: 'Pronta' },
  { etapa: 'processando', cor: 'bg-amber', rotulo: 'Processando' },
  { etapa: 'aguardando_sap', cor: 'bg-blue', rotulo: 'Aguardando SAP' },
];

export function OperacaoLista(props: OperacaoListaProps): React.JSX.Element {
  const [ordenacao, setOrdenacao] = React.useState<Ordenacao>('atualizacao');
  const ordenados = ordenar(props.itens, ordenacao);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg-2 px-[22px] py-[9px]">
        <div className="flex items-center gap-3 text-[11.5px] text-text-mute">
          {LEGENDA.map((entrada) => (
            <span key={entrada.etapa} className="flex items-center gap-[5px]">
              <span className={`size-[7px] shrink-0 rounded-full ${entrada.cor}`} />
              {entrada.rotulo}
            </span>
          ))}
        </div>
        <label className="flex items-center gap-[6px] text-[12.5px] text-text-dim">
          Ordenar por:
          <select
            value={ordenacao}
            onChange={(event) => setOrdenacao(event.target.value as Ordenacao)}
            className="rounded-app-sm border border-line-2 bg-bg-2 px-[6px] py-[2px] text-[12.5px] text-text"
          >
            <option value="atualizacao">Atualização</option>
            <option value="prioridade">Prioridade</option>
          </select>
        </label>
      </div>
      <div className="min-h-40 flex-1 overflow-y-auto">
        {ordenados.length === 0 ? (
          <div className="grid min-h-28 place-items-center text-center text-xs text-text-mute">
            Nenhuma nota na operação.
          </div>
        ) : ordenados.map((item) => {
          const pk = item.nota_pk ?? item.entrada_id;
          const progress = props.jobs.find((job) => job.id === item.operacao_id);
          return (
            <NotaOperacaoRow
              key={`${item.entrada_id}-${item.nota_pk ?? 'pending'}`}
              item={item}
              selected={props.selected.has(pk)}
              progress={progress}
              onSelect={() => props.onToggle(pk)}
              onOpen={(trigger) => props.onOpen(pk, trigger)}
            />
          );
        })}
      </div>
    </div>
  );
}
