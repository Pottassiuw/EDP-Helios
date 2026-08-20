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

/** Estado da consulta somente-leitura da Operação: separado de
 * useCoffeeOperacao porque não mexe no quadro (nenhuma invalidação de
 * query) — é um resultado à parte que o usuário decide, linha a linha ou
 * em lote, se quer promover pra fila de geração. Toda transição de estado
 * vive em consulta-leitura-estado.ts (testável sem React); este hook só
 * conecta isso a useState e à chamada assíncrona do job. */
export function useConsultaLeitura() {
  const [estado, setEstado] = React.useState(estadoInicial);
  const [pending, setPending] = React.useState(false);
  const [erro, setErro] = React.useState<string | null>(null);

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
