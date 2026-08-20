import React from 'react';
import {
  ListChecks,
  RefreshCw,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CoffeeOperacaoItem, OperacaoEtapa } from '../../types';

interface OperacaoBatchBarProps {
  itens: CoffeeOperacaoItem[];
  allItems: CoffeeOperacaoItem[];
  onClear: () => void;
  onSelectColumn: (ids: number[]) => void;
  onGerar: (ids: number[]) => void;
  onAtualizar: (ids: number[]) => void;
  onReconsultar: (ids: number[]) => void;
  onRemover: (ids: number[]) => void;
}

export function OperacaoBatchBar({
  itens,
  allItems,
  onClear,
  onSelectColumn,
  onGerar,
  onAtualizar,
  onReconsultar,
  onRemover,
}: OperacaoBatchBarProps): React.JSX.Element | null {
  if (itens.length === 0) return null;

  const etapas = new Set<OperacaoEtapa>(itens.map((item) => item.etapa));
  const ids = itens.map((item) => item.nota_pk ?? item.entrada_id);
  const etapa = etapas.size === 1 ? itens[0].etapa : null;
  const columnIds = etapa === null
    ? []
    : allItems
      .filter((item) => item.etapa === etapa)
      .map((item) => item.nota_pk ?? item.entrada_id);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex max-w-2xl w-[calc(100%-3rem)] flex-wrap items-center gap-2 rounded-[8px] border border-line-2 bg-surface/95 p-2 shadow-2xl shadow-black/15 backdrop-blur-md">
      <span className="px-2 font-mono text-xs font-medium text-text">{itens.length} selecionadas</span>
      {etapa !== null && columnIds.length > itens.length && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelectColumn(columnIds)}
          className="h-7 gap-1.5 text-xs font-medium"
        >
          <ListChecks className="size-3.5" /> Selecionar etapa
        </Button>
      )}
      {etapa === 'fila' && (
        <Button size="sm" onClick={() => onReconsultar(ids)} className="h-7 gap-1.5 text-xs font-medium">
          <RefreshCw className="size-3.5" /> Consultar novamente
        </Button>
      )}
      {etapa === 'pronta' && (
        <Button size="sm" onClick={() => onGerar(ids)} className="h-7 gap-1.5 text-xs font-medium">
          <WandSparkles className="size-3.5" /> Gerar
        </Button>
      )}
      {etapa === 'aguardando_sap' && (
        <Button size="sm" onClick={() => onAtualizar(ids)} className="h-7 gap-1.5 text-xs font-medium">
          <RefreshCw className="size-3.5" /> Atualizar SAP
        </Button>
      )}
      {etapa === null && (
        <span className="font-mono text-xs text-text-mute">
          Selecione notas da mesma etapa para executar ações em lote.
        </span>
      )}
      <div className="flex-1" />
      {!etapas.has('processando') && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onRemover(ids)}
          className="h-7 gap-1.5 text-xs font-medium text-red hover:bg-tint-red hover:text-red"
        >
          <Trash2 className="size-3.5" /> Remover
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClear}
        aria-label="Limpar seleção"
        className="size-7 text-text-dim hover:text-text"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
