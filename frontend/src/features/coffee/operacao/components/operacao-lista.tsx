import React from 'react';
import { Inbox, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { CoffeeJob, CoffeeOperacaoItem } from '../../types';
import { operacaoItemMatches } from '../operacao-utils';
import { NotaOperacaoRow } from './nota-operacao-row';

type Ordenacao = 'atualizacao' | 'prioridade';

interface OperacaoListaProps {
  itens: CoffeeOperacaoItem[];
  jobs: CoffeeJob[];
  selected: Set<number>;
  onToggle: (pk: number) => void;
  onOpen: (pk: number, trigger: HTMLButtonElement) => void;
  query?: string;
  onQueryChange?: (query: string) => void;
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
  const [internalQuery, setInternalQuery] = React.useState('');
  const query = props.query ?? internalQuery;
  const setQuery = props.onQueryChange ?? setInternalQuery;

  const filtrados = React.useMemo(() => {
    return props.itens.filter((item) => operacaoItemMatches(item, query));
  }, [props.itens, query]);

  const ordenados = ordenar(filtrados, ordenacao);

  return (
    <div className="flex flex-col bg-surface">
      <div className="sticky top-0 z-10 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line bg-bg-2 px-6 py-2">
        <div className="flex items-center gap-3.5 text-xs text-text-mute">
          {LEGENDA.map((entrada) => (
            <span key={entrada.etapa} className="flex items-center gap-1.5">
              <span className={`size-2 shrink-0 rounded-full ${entrada.cor}`} />
              <span className="font-mono text-[11px] text-text-dim">{entrada.rotulo}</span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative flex items-center">
            <Search className="pointer-events-none absolute left-2.5 size-3.5 text-text-mute" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar ID, SAP ou local"
              aria-label="Buscar ID, SAP ou local"
              className="h-7 w-56 pl-8 text-xs font-normal"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-text-dim">
            <span>Ordenar por:</span>
            <select
              value={ordenacao}
              onChange={(event) => setOrdenacao(event.target.value as Ordenacao)}
              className="h-7 rounded-[5px] border border-line bg-surface px-2 text-xs font-medium text-text outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
            >
              <option value="atualizacao">Atualização</option>
              <option value="prioridade">Prioridade</option>
            </select>
          </label>
        </div>
      </div>
      <div className={`flex flex-col ${props.selected.size > 0 ? 'pb-24' : 'pb-8'}`}>
        {ordenados.length === 0 ? (
          <div className="flex min-h-60 flex-col items-center justify-center gap-2 p-8 text-center">
            <Inbox className="size-8 text-text-mute/50" />
            <span className="text-sm font-medium text-text">
              {props.itens.length === 0
                ? 'Nenhuma nota na operação.'
                : 'Nenhuma nota encontrada para o filtro informado.'}
            </span>
            <span className="max-w-sm font-mono text-xs text-text-mute">
              {props.itens.length === 0
                ? 'Cole IDs no campo acima ou selecione notas da triagem no Verificar para enfileirar.'
                : 'Verifique os IDs, SAPs ou locais buscados ou limpe a busca.'}
            </span>
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

