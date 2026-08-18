import React from 'react';
import { Copy, ExternalLink, Info, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ConsultaLoteItem } from '../../types';

interface OperacaoConsultaResultadoProps {
  resultados: ConsultaLoteItem[];
  selecionados: Set<number>;
  onToggle: (pk: number) => void;
  onSelecionarTodasElegiveis: () => void;
  onAdicionarFila: (ids: number[]) => void;
  onFechar: () => void;
}

interface Resumo {
  elegiveis: number;
  concluidas: number;
  naOperacao: number;
  erros: number;
}

function resumir(resultados: ConsultaLoteItem[]): Resumo {
  const inicial: Resumo = { elegiveis: 0, concluidas: 0, naOperacao: 0, erros: 0 };
  return resultados.reduce((acc, item) => {
    if (item.erro) return { ...acc, erros: acc.erros + 1 };
    if (item.ja_na_operacao) return { ...acc, naOperacao: acc.naOperacao + 1 };
    if (item.elegivel) return { ...acc, elegiveis: acc.elegiveis + 1 };
    return { ...acc, concluidas: acc.concluidas + 1 };
  }, inicial);
}

export function OperacaoConsultaResultado({
  resultados,
  selecionados,
  onToggle,
  onSelecionarTodasElegiveis,
  onAdicionarFila,
  onFechar,
}: OperacaoConsultaResultadoProps): React.JSX.Element {
  const contagens = resumir(resultados);
  const elegiveis = resultados.filter((item) => item.elegivel);

  return (
    <section className="flex flex-col border-b border-line">
      <div className="flex items-center justify-between border-b border-line px-[22px] py-[10px]">
        <span className="text-[13px] font-semibold">
          Resultado da consulta
          <span className="ml-2 font-mono text-xs font-normal text-text-mute">
            {resultados.length} notas · somente leitura
          </span>
        </span>
        <Button variant="ghost" size="xs" onClick={onFechar}>
          <X /> Fechar
        </Button>
      </div>
      <div className="flex items-center gap-[6px] border-b border-line bg-tint-indigo px-[22px] py-[7px] text-[12px] text-indigo">
        <Info className="size-[13px] shrink-0" />
        Isso só busca os dados — nada aqui entra na fila de geração até você
        clicar em &quot;Adicionar à fila&quot;.
      </div>
      <div className="flex flex-wrap items-center gap-[10px] border-b border-line px-[22px] py-[10px] text-xs text-text-dim">
        <span>{contagens.elegiveis} ainda não geradas</span>
        <span>{contagens.concluidas} já concluídas</span>
        <span>{contagens.naOperacao} já na Operação</span>
        <span>{contagens.erros} erros</span>
      </div>
      <div className="max-h-[336px] overflow-y-auto border-b border-line">
        {resultados.map((item) => (
          <div key={item.pk} className="flex items-center gap-[14px] border-b border-line px-[22px] py-[10px] even:bg-bg-2">
            <input
              type="checkbox"
              disabled={!item.elegivel}
              checked={selecionados.has(item.pk)}
              onChange={() => onToggle(item.pk)}
              aria-label={`Selecionar nota ${item.pk}`}
              className="size-[14px] shrink-0 accent-green disabled:opacity-40"
            />
            <span className="w-[70px] shrink-0 font-mono text-[13px] font-semibold">#{item.pk}</span>
            <span className="min-w-[140px] flex-1 truncate text-[12.5px] text-text-dim">
              {item.local_instalacao ?? '—'}
            </span>
            {item.erro ? (
              <span className="text-[12px] text-red">{item.erro}</span>
            ) : item.elegivel ? (
              <div className="flex shrink-0 items-center gap-[8px]">
                <span className="rounded-[5px] bg-surface-3 px-2 py-[3px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-text-dim">
                  Ainda não gerada
                </span>
                <Button variant="outline" size="xs" onClick={() => onAdicionarFila([item.pk])}>
                  + Fila
                </Button>
              </div>
            ) : item.ja_na_operacao ? (
              <span className="shrink-0 rounded-[5px] bg-tint-blue px-2 py-[3px] font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-blue">
                Já na Operação
              </span>
            ) : (
              <div className="flex shrink-0 items-center gap-[8px]">
                <span className="font-mono text-[12.5px] font-semibold">SAP {item.id_sap}</span>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(String(item.id_sap))}
                  aria-label={`Copiar SAP ${item.id_sap}`}
                  className="flex size-[24px] items-center justify-center rounded-md border border-line text-text-dim"
                >
                  <Copy className="size-[13px]" />
                </button>
                <span className="flex items-center gap-[3px] text-[11.5px] text-text-mute">
                  já concluída <ExternalLink className="size-3" />
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-[12px] px-[22px] py-[9px]">
        <label className="flex items-center gap-[7px] text-xs text-text-mute">
          <input
            type="checkbox"
            onChange={onSelecionarTodasElegiveis}
            disabled={elegiveis.length === 0}
            className="size-[14px] accent-green"
          />
          Selecionar todas elegíveis
          <span className="font-mono opacity-70">({elegiveis.length})</span>
        </label>
        <span className="ml-auto text-[12.5px] font-medium text-text-dim">
          {selecionados.size} selecionadas
        </span>
        <Button size="sm" disabled={selecionados.size === 0} onClick={() => onAdicionarFila([...selecionados])}>
          Adicionar à fila de geração
        </Button>
      </div>
    </section>
  );
}
