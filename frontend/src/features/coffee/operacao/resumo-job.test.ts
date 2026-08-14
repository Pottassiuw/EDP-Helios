import { describe, expect, it } from 'vitest';

import { resumoJobConsulta } from './resumo-job';

describe('resumoJobConsulta', () => {
  it('resume só o total quando não há detalhamento por etapa nem erro', () => {
    expect(resumoJobConsulta({ total: 3, erros: [] })).toBe('3 notas consultadas');
  });

  it('detalha prontas, aguardando SAP, processando e ignoradas quando disponível', () => {
    const resumo = resumoJobConsulta({
      total: 10,
      erros: [],
      por_etapa: { pronta: 4, aguardando_sap: 3, processando: 1, ignorada: 2 },
    });
    expect(resumo).toBe(
      '10 notas consultadas · 4 prontas para gerar · 3 aguardando SAP · '
      + '1 em processamento · 2 já em estado final (ignoradas)',
    );
  });

  it('inclui a contagem de falhas quando o job tem erros', () => {
    const resumo = resumoJobConsulta({
      total: 2,
      erros: [{ pk: 1, msg: 'timeout' }],
      por_etapa: { pronta: 1 },
    });
    expect(resumo).toBe('2 notas consultadas · 1 pronta para gerar · 1 falhou');
  });

  it('nota única usa singular', () => {
    expect(resumoJobConsulta({ total: 1, erros: [] })).toBe('1 nota consultada');
  });
});
