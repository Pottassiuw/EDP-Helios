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
});
