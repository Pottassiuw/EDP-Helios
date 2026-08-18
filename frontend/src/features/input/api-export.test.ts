import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputApi } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function comUsuario(nome: string | null): void {
  vi.stubGlobal('localStorage', {
    getItem: (chave: string) => (chave === 'edp_input_user' ? nome : null),
  });
}

describe('InputApi.exportar', () => {
  it('identifica quem exportou pelo header X-User', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(), { status: 200 }));
    comUsuario('ana');
    vi.stubGlobal('fetch', fetchMock);

    await InputApi.exportar([9000], ['Numero_Nota']);

    expect(fetchMock).toHaveBeenCalledWith('/api/input/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User': 'ana' },
      body: JSON.stringify({ numeros: [9000], colunas: ['Numero_Nota'] }),
    });
  });

  it('propaga a mensagem do backend quando a identidade falta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Header X-User obrigatório para escrita.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    comUsuario(null);
    vi.stubGlobal('fetch', fetchMock);

    await expect(InputApi.exportar([9000], ['Numero_Nota'])).rejects.toThrow(
      'Header X-User obrigatório para escrita.',
    );
  });
});
