import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => key === 'edp_input_user' ? 'alice' : null,
    setItem: () => undefined,
  });
});

import { exportCoffeeConcluidas, fetchCoffeeConcluidas } from './concluidas-api';

describe('exportCoffeeConcluidas', () => {
  it('envia a identidade do usuário ao listar as notas concluídas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ registros: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchCoffeeConcluidas();

    expect(fetchMock).toHaveBeenCalledWith('/api/coffee/notas?status=concluida', {
      headers: { 'X-User': 'alice', Accept: 'application/json' },
    });
  });

  it('envia os PKs filtrados e a identidade do usuário para o endpoint de planilha', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('arquivo-xlsx', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await exportCoffeeConcluidas([101, 202]);

    expect(result).toBeInstanceOf(Blob);
    expect(fetchMock).toHaveBeenCalledWith('/api/coffee/notas/concluidas/exportar', {
      method: 'POST',
      headers: { 'X-User': 'alice', 'Content-Type': 'application/json' },
      body: JSON.stringify({ pks: [101, 202] }),
    });
  });
});
