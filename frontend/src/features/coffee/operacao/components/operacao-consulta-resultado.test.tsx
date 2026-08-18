import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperacaoConsultaResultado } from './operacao-consulta-resultado';
import type { ConsultaLoteItem } from '../../types';

const RESULTADOS: ConsultaLoteItem[] = [
  { pk: 1, id_sap: null, classificacao: 'nao_gerada', ja_na_operacao: false, elegivel: true, local_instalacao: 'Itu-PS-05', erro: null },
  { pk: 2, id_sap: 17259425, classificacao: 'gerada', ja_na_operacao: false, elegivel: false, local_instalacao: 'Bauru-PT-08', erro: null },
  { pk: 3, id_sap: 10000000, classificacao: 'pendente', ja_na_operacao: true, elegivel: false, local_instalacao: 'Sorocaba-PT-51', erro: null },
  { pk: 4, id_sap: null, classificacao: null, ja_na_operacao: false, elegivel: false, local_instalacao: null, erro: 'nota não encontrada' },
];

const noop = (): void => {};

describe('OperacaoConsultaResultado', () => {
  it('mostra o resumo por contagem', () => {
    const html = renderToStaticMarkup(
      <OperacaoConsultaResultado
        resultados={RESULTADOS}
        selecionados={new Set()}
        onToggle={noop}
        onSelecionarTodasElegiveis={noop}
        onAdicionarFila={noop}
        onFechar={noop}
      />,
    );
    expect(html).toContain('1 ainda não geradas');
    expect(html).toContain('1 já concluídas');
    expect(html).toContain('1 já na Operação');
    expect(html).toContain('1 erros');
  });

  it('só mostra "+ Fila" pra notas elegíveis', () => {
    const html = renderToStaticMarkup(
      <OperacaoConsultaResultado
        resultados={RESULTADOS}
        selecionados={new Set()}
        onToggle={noop}
        onSelecionarTodasElegiveis={noop}
        onAdicionarFila={noop}
        onFechar={noop}
      />,
    );
    expect(html.split('+ Fila').length - 1).toBe(1);
  });

  it('mostra o SAP real e "já concluída" pra nota não elegível com SAP real', () => {
    const html = renderToStaticMarkup(
      <OperacaoConsultaResultado
        resultados={RESULTADOS}
        selecionados={new Set()}
        onToggle={noop}
        onSelecionarTodasElegiveis={noop}
        onAdicionarFila={noop}
        onFechar={noop}
      />,
    );
    expect(html).toContain('SAP 17259425');
    expect(html).toContain('já concluída');
  });
});
