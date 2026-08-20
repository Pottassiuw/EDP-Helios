import type { CoffeeJob, ConsultaLoteItem } from '../types';

export interface ConsultaLeituraEstado {
  resultados: ConsultaLoteItem[] | null;
  selecionados: Set<number>;
}

export function estadoInicial(): ConsultaLeituraEstado {
  return { resultados: null, selecionados: new Set() };
}

export function aplicarResultado(resultados: ConsultaLoteItem[]): ConsultaLeituraEstado {
  return { resultados, selecionados: new Set() };
}

export function alternarSelecao(estado: ConsultaLeituraEstado, pk: number): ConsultaLeituraEstado {
  const proximo = new Set(estado.selecionados);
  if (proximo.has(pk)) proximo.delete(pk);
  else proximo.add(pk);
  return { ...estado, selecionados: proximo };
}

/** Alterna a seleção das notas elegíveis: se todas já estão selecionadas,
 * limpa só essas da seleção; senão, seleciona todas — o par que dá ao
 * checkbox "Selecionar todas elegíveis" um estado controlado e reversível. */
export function alternarElegiveis(estado: ConsultaLeituraEstado): ConsultaLeituraEstado {
  const elegiveis = (estado.resultados ?? [])
    .filter((item) => item.elegivel)
    .map((item) => item.pk);
  const todasSelecionadas = elegiveis.length > 0
    && elegiveis.every((pk) => estado.selecionados.has(pk));
  const selecionados = todasSelecionadas
    ? new Set([...estado.selecionados].filter((pk) => !elegiveis.includes(pk)))
    : new Set([...estado.selecionados, ...elegiveis]);
  return { ...estado, selecionados };
}

export function removerDosResultados(estado: ConsultaLeituraEstado, ids: number[]): ConsultaLeituraEstado {
  const resultados = estado.resultados?.filter((item) => !ids.includes(item.pk)) ?? null;
  const selecionados = new Set(estado.selecionados);
  ids.forEach((id) => selecionados.delete(id));
  return { resultados, selecionados };
}

/** Se o job da consulta somente-leitura não terminou em `concluido` (ex.:
 * `interrompido` por reinício do backend no meio da consulta), devolve uma
 * mensagem explicando o motivo — os `resultados` parciais ainda são
 * aplicados normalmente, mas a UI não pode tratar isso como sucesso pleno.
 * Retorna `null` quando o job concluiu normalmente. */
export function resumirInterrupcao(job: Pick<CoffeeJob, 'estado' | 'erros'>): string | null {
  if (job.estado === 'concluido') return null;
  const motivos = job.erros.map((erro) => erro.msg).join('; ');
  return motivos
    ? `Consulta interrompida antes de terminar: ${motivos}`
    : 'Consulta interrompida antes de terminar — os resultados abaixo podem estar incompletos.';
}
