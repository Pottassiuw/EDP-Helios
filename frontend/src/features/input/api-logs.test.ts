import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputApi } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respostaVazia(): Response {
  return new Response(
    JSON.stringify({
      registros: [],
      paginacao: { total: 0, limite: 100, offset: 0, tem_mais: false },
      resumo: { total: 0, criacoes: 0, exclusoes: 0, ocultacoes: 0, edicoes: 0 },
      usuarios: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('InputApi.logs', () => {
  it('pede uma página ao servidor em vez do histórico inteiro', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaVazia());
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', fetchMock);

    await InputApi.logs({ nota: '1001, 1002', tipo: 'criacao', limite: 100, offset: 200 });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/input/logs?nota=1001%2C+1002&tipo=criacao&limite=100&offset=200',
      undefined,
    );
  });

  it('omite filtros vazios para não estreitar a consulta sem querer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaVazia());
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', fetchMock);

    await InputApi.logs({ nota: '', usuario: undefined, limite: 100, offset: 0 });

    expect(fetchMock).toHaveBeenCalledWith('/api/input/logs?limite=100&offset=0', undefined);
  });
});
