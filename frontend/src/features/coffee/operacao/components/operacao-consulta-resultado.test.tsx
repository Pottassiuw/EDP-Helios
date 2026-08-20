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

// Nota pendente que ainda não entrou na Operação (ja_na_operacao: false) —
// caso que caía no fallback "já concluída" com o SAP placeholder antes do
// fix. Fixture isolada pra não alterar as contagens de RESULTADOS acima.
const RESULTADOS_COM_PENDENTE: ConsultaLoteItem[] = [
  ...RESULTADOS,
  { pk: 5, id_sap: 10000000, classificacao: 'pendente', ja_na_operacao: false, elegivel: false, local_instalacao: 'Jundiaí-PT-12', erro: null },
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

  it('mostra "+ Fila" também pra notas pendentes ainda fora da Operação', () => {
    const html = renderToStaticMarkup(
      <OperacaoConsultaResultado
        resultados={RESULTADOS_COM_PENDENTE}
        selecionados={new Set()}
        onToggle={noop}
        onSelecionarTodasElegiveis={noop}
        onAdicionarFila={noop}
        onFechar={noop}
      />,
    );
    // pk 1 (elegível) e pk 5 (pendente, ainda não na Operação).
    expect(html.split('+ Fila').length - 1).toBe(2);
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

  it('nota pendente (SAP placeholder, ainda fora da Operação) não é rotulada como "já concluída"', () => {
    const html = renderToStaticMarkup(
      <OperacaoConsultaResultado
        resultados={RESULTADOS_COM_PENDENTE}
        selecionados={new Set()}
        onToggle={noop}
        onSelecionarTodasElegiveis={noop}
        onAdicionarFila={noop}
        onFechar={noop}
      />,
    );
    expect(html).toContain('Aguardando SAP');
    // O SAP placeholder (10000000) da nota pendente não deve aparecer como
    // se fosse um SAP real de nota concluída.
    expect(html).not.toContain('SAP 10000000');
  });
});
