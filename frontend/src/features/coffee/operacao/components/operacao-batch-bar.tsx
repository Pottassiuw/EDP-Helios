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
    <div className="absolute inset-x-4 bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-[11px] border border-line-2 bg-surface p-2 shadow-lg">
      <strong className="px-2 text-sm">{itens.length} selecionadas</strong>
      {etapa !== null && columnIds.length > itens.length && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onSelectColumn(columnIds)}
        >
          <ListChecks /> Selecionar etapa
        </Button>
      )}
      {etapa === 'fila' && (
        <Button size="sm" onClick={() => onReconsultar(ids)}>
          <RefreshCw /> Consultar novamente
        </Button>
      )}
      {etapa === 'pronta' && (
        <Button size="sm" onClick={() => onGerar(ids)}>
          <WandSparkles /> Gerar
        </Button>
      )}
      {etapa === 'aguardando_sap' && (
        <Button size="sm" onClick={() => onAtualizar(ids)}>
          <RefreshCw /> Atualizar SAP
        </Button>
      )}
      {etapa === null && (
        <span className="text-xs text-text-mute">
          Selecione notas da mesma etapa para executar ações.
        </span>
      )}
      <div className="flex-1" />
      {!etapas.has('processando') && (
        <Button variant="ghost" size="sm" onClick={() => onRemover(ids)}>
          <Trash2 /> Remover
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClear}
        aria-label="Limpar seleção"
      >
        <X />
      </Button>
    </div>
  );
}
