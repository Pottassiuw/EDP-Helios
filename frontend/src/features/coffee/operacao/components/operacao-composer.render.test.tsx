import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperacaoComposer } from './operacao-composer';

const asyncNoop = async (): Promise<void> => {};

describe('OperacaoComposer', () => {
  it('está sempre visível, sem precisar expandir, com os dois botões', () => {
    const html = renderToStaticMarkup(
      <OperacaoComposer
        pendingConsulta={false}
        pendingAdicionar={false}
        onConsultar={asyncNoop}
        onAdicionarFila={asyncNoop}
      />,
    );
    expect(html).toContain('Cole IDs');
    expect(html).toContain('Consultar');
    expect(html).toContain('Adicionar à fila');
  });

  it('reflete pendingConsulta/pendingAdicionar nos rótulos dos botões', () => {
    const consultando = renderToStaticMarkup(
      <OperacaoComposer
        pendingConsulta
        pendingAdicionar={false}
        onConsultar={asyncNoop}
        onAdicionarFila={asyncNoop}
      />,
    );
    expect(consultando).toContain('Consultando…');

    const adicionando = renderToStaticMarkup(
      <OperacaoComposer
        pendingConsulta={false}
        pendingAdicionar
        onConsultar={asyncNoop}
        onAdicionarFila={asyncNoop}
      />,
    );
    expect(adicionando).toContain('Adicionando…');
  });
});
