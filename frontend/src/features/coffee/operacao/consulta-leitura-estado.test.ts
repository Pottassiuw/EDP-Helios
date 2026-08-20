import { describe, expect, it } from 'vitest';
import {
  estadoInicial,
  aplicarResultado,
  alternarSelecao,
  alternarElegiveis,
  removerDosResultados,
  resumirInterrupcao,
} from './consulta-leitura-estado';
import type { ConsultaLoteItem, CoffeeJob } from '../types';

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

  it('alternarElegiveis marca só as notas elegíveis quando nenhuma está selecionada', () => {
    const estado = alternarElegiveis(aplicarResultado(RESULTADOS));
    expect(estado.selecionados).toEqual(new Set([1]));
  });

  it('alternarElegiveis limpa a seleção quando todas as elegíveis já estão selecionadas', () => {
    let estado = alternarElegiveis(aplicarResultado(RESULTADOS));
    expect(estado.selecionados).toEqual(new Set([1]));
    estado = alternarElegiveis(estado);
    expect(estado.selecionados).toEqual(new Set());
  });

  it('alternarElegiveis preserva seleção manual de notas não elegíveis', () => {
    let estado = alternarSelecao(aplicarResultado(RESULTADOS), 2);
    estado = alternarElegiveis(estado);
    expect(estado.selecionados).toEqual(new Set([2, 1]));
  });

  it('removerDosResultados tira os IDs da lista e da seleção', () => {
    let estado = aplicarResultado(RESULTADOS);
    estado = alternarSelecao(estado, 1);
    estado = removerDosResultados(estado, [1]);
    expect(estado.resultados?.map((item) => item.pk)).toEqual([2]);
    expect(estado.selecionados.has(1)).toBe(false);
  });
});

describe('resumirInterrupcao', () => {
  const baseJob = {
    id: 'job-1',
    total: 2,
    feitas: 1,
    iniciado_em: '2026-08-19T10:00:00Z',
  };

  it('retorna null quando o job concluiu normalmente', () => {
    const job: Pick<CoffeeJob, 'estado' | 'erros'> = { estado: 'concluido', erros: [] };
    expect(resumirInterrupcao(job)).toBeNull();
  });

  it('descreve a interrupção quando o job não concluiu e não tem erros detalhados', () => {
    const job: Pick<CoffeeJob, 'estado' | 'erros'> = { estado: 'interrompido', erros: [] };
    const mensagem = resumirInterrupcao(job);
    expect(mensagem).toContain('interrompida');
  });

  it('inclui os motivos de erros do job quando presentes', () => {
    const job: Pick<CoffeeJob, 'estado' | 'erros'> = {
      estado: 'interrompido',
      erros: [{ pk: 7, msg: 'timeout ao buscar nota' }],
    };
    expect(resumirInterrupcao(job)).toContain('timeout ao buscar nota');
  });

  // Confirma que a função aceita o shape completo de CoffeeJob (Pick não
  // exige um objeto parcial na chamada real).
  it('funciona com um CoffeeJob completo', () => {
    const job: CoffeeJob = { ...baseJob, estado: 'concluido', erros: [] };
    expect(resumirInterrupcao(job)).toBeNull();
  });
});
