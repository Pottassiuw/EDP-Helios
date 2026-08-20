import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerFeedback } from './operacao-composer';

describe('ComposerFeedback', () => {
  it('mostra a contagem de válidos e chips com o token exato de repetidos e inválidos', () => {
    const html = renderToStaticMarkup(
      <ComposerFeedback parsed={{ ids: [10, 20], invalidos: ['abc'], repetidos: [10] }} jaNaOperacao={0} />,
    );
    expect(html).toContain('2 válidos');
    expect(html).toContain('repetido: 10');
    expect(html).toContain('inválido: abc');
  });

  it('mostra o aviso de "já na operação" só quando houver', () => {
    const semAviso = renderToStaticMarkup(
      <ComposerFeedback parsed={{ ids: [], invalidos: [], repetidos: [] }} jaNaOperacao={0} />,
    );
    expect(semAviso).not.toContain('já na operação');

    const comAviso = renderToStaticMarkup(
      <ComposerFeedback parsed={{ ids: [10], invalidos: [], repetidos: [] }} jaNaOperacao={2} />,
    );
    expect(comAviso).toContain('2 já na operação');
  });
});
