import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

import type { CoffeeConsulta } from '../coffee/types';
import { COFFEE_CONSULTA_KEY } from '../coffee/coffee-query-keys';
import { NotaFichaCompleta } from './nota-ficha-completa';
import { useConsultaCoffee } from './use-consulta-coffee';

function consulta(overrides: Partial<CoffeeConsulta>): CoffeeConsulta {
  return {
    pk: 355617, id_sap: 17247854, local_instalacao: '701CF12345678',
    classificacao: 'gerada', arquivado: false, poste: 'TR-088',
    referencia: 'SER-11', referencia_fisica: 'SER-11', referencia_eletrica: 'ELE-22',
    alimentador: 'AFC01', problema: 'chave · queda', observacao: 'Poste inclinado',
    campos: { sintoma: 'queda', componente: 'chave', cidade_extra: 'Vitoria' },
    ...overrides,
  };
}

function Wrapper({ noteId }: { noteId: string }) {
  const consulta = useConsultaCoffee(noteId);
  return <NotaFichaCompleta noteId={noteId} consulta={consulta} />;
}

function renderFicha(dados: CoffeeConsulta): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(COFFEE_CONSULTA_KEY(355617), dados);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Wrapper noteId="355617" />
    </QueryClientProvider>,
  );
}

describe('NotaFichaCompleta', () => {
  it('não repete os campos já mostrados em Identificação & localização (destaque removido da ficha)', () => {
    const html = renderFicha(consulta({}));
    expect(html).not.toContain('Referência elétrica');
    expect(html).not.toContain('Poste inclinado');
  });

  it('mostra o resto dos campos crus do json_all agrupado, com rótulo humanizado', () => {
    const html = renderFicha(consulta({}));
    expect(html).toContain('Cidade Extra');
    expect(html).not.toContain('cidade_extra');
    expect(html).toContain('Vitoria');
    expect(html).toContain('Local e rede');
  });

  it('preserva campos crus sem rótulo conhecido, mesmo booleanos e nulos', () => {
    const html = renderFicha(consulta({
      campos: { risco_terceiros: true, motivo_pendencia: null, quantidade_vaos: 3 },
    }));
    expect(html).toContain('Sim');
    expect(html).toContain('Risco e segurança');
    expect(html).toContain('Quantidade Vaos');
    expect(html).toContain('3');
    expect(html).not.toContain('Motivo Pendencia');
  });
});
