import React from 'react';
import { OperacaoApi } from './operacao-api';
import { aguardarJobOperacao } from './use-coffee-operacao';
import {
  estadoInicial,
  aplicarResultado,
  alternarSelecao,
  alternarElegiveis,
  removerDosResultados,
  resumirInterrupcao,
} from './consulta-leitura-estado';

const STORAGE_KEY = 'edp_coffee_operacao_consulta';

interface PersistedConsultaState {
  resultados: import('../types').ConsultaLoteItem[] | null;
  selecionados: number[];
  erro: string | null;
}

function carregarEstadoPersistido(): { estado: import('./consulta-leitura-estado').ConsultaLeituraEstado; erro: string | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { estado: estadoInicial(), erro: null };
    const parsed = JSON.parse(raw) as PersistedConsultaState;
    return {
      estado: {
        resultados: Array.isArray(parsed.resultados) ? parsed.resultados : null,
        selecionados: new Set(Array.isArray(parsed.selecionados) ? parsed.selecionados : []),
      },
      erro: typeof parsed.erro === 'string' ? parsed.erro : null,
    };
  } catch {
    return { estado: estadoInicial(), erro: null };
  }
}

/** Estado da consulta somente-leitura da Operação: separado de
 * useCoffeeOperacao porque não mexe no quadro (nenhuma invalidação de
 * query) — é um resultado à parte que o usuário decide, linha a linha ou
 * em lote, se quer promover pra fila de geração. Toda transição de estado
 * vive em consulta-leitura-estado.ts (testável sem React); este hook
 * conecta isso a useState, à persistência de sessão e à chamada assíncrona do job. */
export function useConsultaLeitura() {
  const [inicial] = React.useState(carregarEstadoPersistido);
  const [estado, setEstado] = React.useState(inicial.estado);
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(inicial.erro);

  React.useEffect(() => {
    try {
      if (estado.resultados === null) {
        sessionStorage.removeItem(STORAGE_KEY);
      } else {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            resultados: estado.resultados,
            selecionados: [...estado.selecionados],
            erro,
          }),
        );
      }
    } catch {
      // sessionStorage indisponível ou cheio: ignora
    }
  }, [estado, erro]);

  async function iniciar(ids: number[]): Promise<void> {
    setPending(true);
    try {
      const { job_id } = await OperacaoApi.consultarLeitura(ids);
      const job = await aguardarJobOperacao(job_id);
      setEstado(aplicarResultado(job.resultados ?? []));
      setErro(resumirInterrupcao(job));
    } finally {
      setPending(false);
    }
  }

  return {
    resultados: estado.resultados,
    selecionados: estado.selecionados,
    pending,
    erro,
    iniciar,
    toggle: (pk: number) => setEstado((atual) => alternarSelecao(atual, pk)),
    selecionarTodasElegiveis: () => setEstado(alternarElegiveis),
    fechar: () => {
      setEstado(estadoInicial());
      setErro(null);
    },
    removerDosResultados: (ids: number[]) => setEstado((atual) => removerDosResultados(atual, ids)),
  };
}
