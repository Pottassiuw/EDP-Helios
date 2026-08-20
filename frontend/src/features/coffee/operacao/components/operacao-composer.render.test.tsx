import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperacaoComposer } from './operacao-composer';

const noop = (): void => {};
const asyncNoop = async (): Promise<void> => {};

describe('OperacaoComposer', () => {
  it('está sempre visível, sem precisar expandir, com os dois botões', () => {
    const html = renderToStaticMarkup(
      <OperacaoComposer
        pendingAdicionar={false}
        onAdicionarFila={asyncNoop}
        onAbrirConsulta={noop}
      />,
    );
    expect(html).toContain('Cole IDs');
    expect(html).toContain('Consultar notas…');
    expect(html).toContain('Adicionar à fila');
  });

  it('reflete pendingAdicionar no rótulo do botão', () => {
    const adicionando = renderToStaticMarkup(
      <OperacaoComposer
        pendingAdicionar
        onAdicionarFila={asyncNoop}
        onAbrirConsulta={noop}
      />,
    );
    expect(adicionando).toContain('Adicionando…');
  });
});
