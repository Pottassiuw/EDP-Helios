import { describe, expect, it } from 'vitest';
import { resumir } from './consulta-notas-modal';
import type { ConsultaLoteItem } from '../../types';

const RESULTADOS: ConsultaLoteItem[] = [
  { pk: 1, id_sap: null, classificacao: 'nao_gerada', ja_na_operacao: false, elegivel: true, local_instalacao: 'Itu-PS-05', erro: null },
  { pk: 2, id_sap: 17259425, classificacao: 'gerada', ja_na_operacao: false, elegivel: false, local_instalacao: 'Bauru-PT-08', erro: null },
  { pk: 3, id_sap: 10000000, classificacao: 'pendente', ja_na_operacao: true, elegivel: false, local_instalacao: 'Sorocaba-PT-51', erro: null },
  { pk: 4, id_sap: null, classificacao: null, ja_na_operacao: false, elegivel: false, local_instalacao: null, erro: 'nota não encontrada' },
];

describe('ConsultaNotasModal - resumir', () => {
  it('calcula o resumo de contagens corretamente', () => {
    const contagens = resumir(RESULTADOS);
    expect(contagens.elegiveis).toBe(1);
    expect(contagens.concluidas).toBe(1);
    expect(contagens.naOperacao).toBe(1);
    expect(contagens.erros).toBe(1);
  });

  it('lida com lista vazia de resultados', () => {
    const contagens = resumir([]);
    expect(contagens).toEqual({ elegiveis: 0, concluidas: 0, naOperacao: 0, erros: 0 });
  });
});
