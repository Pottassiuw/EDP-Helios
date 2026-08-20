import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperacaoLista } from './operacao-lista';
import type { CoffeeOperacaoItem } from '../../types';

function item(overrides: Partial<CoffeeOperacaoItem>): CoffeeOperacaoItem {
  return {
    entrada_id: 1,
    nota_pk: 1,
    etapa: 'fila',
    origem: 'avulsa',
    operacao_id: null,
    erro: null,
    criado_em: '2026-08-18T10:00:00',
    atualizado_em: '2026-08-18T10:00:00',
    nota: null,
    ...overrides,
  };
}

const noop = (): void => {};

describe('OperacaoLista', () => {
  it('mostra uma linha por nota, sem colunas', () => {
    const html = renderToStaticMarkup(
      <OperacaoLista
        itens={[item({ entrada_id: 1, nota_pk: 1 }), item({ entrada_id: 2, nota_pk: 2, etapa: 'pronta' })]}
        jobs={[]}
        selected={new Set()}
        onToggle={noop}
        onOpen={noop}
      />,
    );
    expect(html).toContain('#1');
    expect(html).toContain('#2');
  });

  it('ordena por atualização mais recente por padrão', () => {
    const html = renderToStaticMarkup(
      <OperacaoLista
        itens={[
          item({ entrada_id: 1, nota_pk: 1, atualizado_em: '2026-08-18T09:00:00' }),
          item({ entrada_id: 2, nota_pk: 2, atualizado_em: '2026-08-18T10:00:00' }),
        ]}
        jobs={[]}
        selected={new Set()}
        onToggle={noop}
        onOpen={noop}
      />,
    );
    expect(html.indexOf('#2')).toBeLessThan(html.indexOf('#1'));
  });

  it('mostra estado vazio quando não há notas', () => {
    const html = renderToStaticMarkup(
      <OperacaoLista itens={[]} jobs={[]} selected={new Set()} onToggle={noop} onOpen={noop} />,
    );
    expect(html).toContain('Nenhuma nota na operação.');
  });

  it('filtra notas por id, sap e local em lote quando query é fornecida', () => {
    const itens = [
      item({
        entrada_id: 101,
        nota_pk: 101,
        nota: {
          pk: 101,
          id_sap: 900123,
          id_sap_anterior: null,
          arquivado: null,
          classificacao: 'pronta',
          dados_json: { cidade: 'Recife', tipo_local_instalacao: 'Poste', local_instalacao_numero: '42' },
          buscado_em: '2026-08-18T10:00:00',
          erro: null,
        },
      }),
      item({
        entrada_id: 202,
        nota_pk: 202,
        nota: {
          pk: 202,
          id_sap: 900456,
          id_sap_anterior: null,
          arquivado: null,
          classificacao: 'pronta',
          dados_json: { cidade: 'Olinda', tipo_local_instalacao: 'Torre', local_instalacao_numero: '88' },
          buscado_em: '2026-08-18T10:00:00',
          erro: null,
        },
      }),
      item({
        entrada_id: 303,
        nota_pk: 303,
        nota: {
          pk: 303,
          id_sap: 900789,
          id_sap_anterior: null,
          arquivado: null,
          classificacao: 'pronta',
          dados_json: { cidade: 'Paulista', tipo_local_instalacao: 'Poste', local_instalacao_numero: '99' },
          buscado_em: '2026-08-18T10:00:00',
          erro: null,
        },
      }),
    ];

    // Busca em lote por IDs separados por quebra de linha / espaço
    const htmlLote = renderToStaticMarkup(
      <OperacaoLista
        itens={itens}
        jobs={[]}
        selected={new Set()}
        onToggle={noop}
        onOpen={noop}
        query={'101\n303'}
      />,
    );
    expect(htmlLote).toContain('#101');
    expect(htmlLote).not.toContain('#202');
    expect(htmlLote).toContain('#303');

    // Busca por id_sap
    const htmlSap = renderToStaticMarkup(
      <OperacaoLista
        itens={itens}
        jobs={[]}
        selected={new Set()}
        onToggle={noop}
        onOpen={noop}
        query="900456"
      />,
    );
    expect(htmlSap).not.toContain('#101');
    expect(htmlSap).toContain('#202');
    expect(htmlSap).not.toContain('#303');

    // Busca por local de instalação
    const htmlLocal = renderToStaticMarkup(
      <OperacaoLista
        itens={itens}
        jobs={[]}
        selected={new Set()}
        onToggle={noop}
        onOpen={noop}
        query="Recife"
      />,
    );
    expect(htmlLocal).toContain('#101');
    expect(htmlLocal).not.toContain('#202');
    expect(htmlLocal).not.toContain('#303');
  });

  it('exibe mensagem quando filtro não encontra nenhuma nota', () => {
    const itens = [item({ entrada_id: 101, nota_pk: 101 })];
    const html = renderToStaticMarkup(
      <OperacaoLista
        itens={itens}
        jobs={[]}
        selected={new Set()}
        onToggle={noop}
        onOpen={noop}
        query="999999"
      />,
    );
    expect(html).toContain('Nenhuma nota encontrada para o filtro informado.');
  });
});
