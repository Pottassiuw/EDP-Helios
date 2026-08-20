import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OperacaoStepper } from './operacao-stepper';

describe('OperacaoStepper', () => {
  it('mostra o rótulo da etapa atual', () => {
    const html = renderToStaticMarkup(<OperacaoStepper etapa="processando" />);
    expect(html).toContain('Processando');
  });

  it('acrescenta o aviso de saída só em aguardando_sap', () => {
    const html = renderToStaticMarkup(<OperacaoStepper etapa="aguardando_sap" />);
    expect(html).toContain('sai ao concluir');
  });

  it('não mostra o aviso de saída em outras etapas', () => {
    const html = renderToStaticMarkup(<OperacaoStepper etapa="fila" />);
    expect(html).not.toContain('sai ao concluir');
  });
});
