import type { ConsultaLoteItem } from '../types';

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

export function selecionarElegiveis(estado: ConsultaLeituraEstado): ConsultaLeituraEstado {
  const elegiveis = (estado.resultados ?? [])
    .filter((item) => item.elegivel)
    .map((item) => item.pk);
  return { ...estado, selecionados: new Set(elegiveis) };
}

export function removerDosResultados(estado: ConsultaLeituraEstado, ids: number[]): ConsultaLeituraEstado {
  const resultados = estado.resultados?.filter((item) => !ids.includes(item.pk)) ?? null;
  const selecionados = new Set(estado.selecionados);
  ids.forEach((id) => selecionados.delete(id));
  return { resultados, selecionados };
}
