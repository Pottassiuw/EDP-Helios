import { describe, expect, it } from 'vitest';
import {
  estadoInicial,
  aplicarResultado,
  alternarSelecao,
  selecionarElegiveis,
  removerDosResultados,
} from './consulta-leitura-estado';
import type { ConsultaLoteItem } from '../types';

const RESULTADOS: ConsultaLoteItem[] = [
  { pk: 1, id_sap: null, classificacao: 'nao_gerada', ja_na_operacao: false, elegivel: true, local_instalacao: null, erro: null },
  { pk: 2, id_sap: 123, classificacao: 'gerada', ja_na_operacao: false, elegivel: false, local_instalacao: null, erro: null },
];

describe('consulta-leitura-estado', () => {
  it('estadoInicial não tem resultados nem seleção', () => {
    expect(estadoInicial()).toEqual({ resultados: null, selecionados: new Set() });
  });

  it('aplicarResultado popula resultados e limpa a seleção', () => {
    const estado = aplicarResultado(RESULTADOS);
    expect(estado.resultados).toHaveLength(2);
    expect(estado.selecionados.size).toBe(0);
  });

  it('alternarSelecao adiciona e depois remove o mesmo pk', () => {
    let estado = aplicarResultado(RESULTADOS);
    estado = alternarSelecao(estado, 1);
    expect(estado.selecionados.has(1)).toBe(true);
    estado = alternarSelecao(estado, 1);
    expect(estado.selecionados.has(1)).toBe(false);
  });

  it('selecionarElegiveis marca só as notas elegíveis', () => {
    const estado = selecionarElegiveis(aplicarResultado(RESULTADOS));
    expect(estado.selecionados).toEqual(new Set([1]));
  });

  it('removerDosResultados tira os IDs da lista e da seleção', () => {
    let estado = aplicarResultado(RESULTADOS);
    estado = alternarSelecao(estado, 1);
    estado = removerDosResultados(estado, [1]);
    expect(estado.resultados?.map((item) => item.pk)).toEqual([2]);
    expect(estado.selecionados.has(1)).toBe(false);
  });
});
