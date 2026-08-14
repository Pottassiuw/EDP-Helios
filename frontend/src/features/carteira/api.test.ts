import { afterEach, describe, expect, it, vi } from 'vitest';

import { CarteiraApi } from './api';
import type { CarteiraEnriquecimento } from './types';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CarteiraApi.enriquecimento', () => {
  it('consulta a nota pelo número SAP e preserva o contrato discriminado', async () => {
    const resposta: CarteiraEnriquecimento = {
      numero_sap: 700500,
      estado: 'encontrada',
      dados: {
        descricao_conjunto: 'POSTES - CAPEX',
        conjunto: 'POSTE',
        sintoma: 'Queda',
        componente_novo: 'Rede primária',
        kit: 'KIT-01',
        n_trafo: 'TR-10',
        dispositivo_protecao: 'REL-2',
        status_sap: 'Pendente',
        prioridade_sap: 2,
      },
      ausente_na_origem_em: null,
      avisos: [],
      versao: '7',
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(resposta), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('localStorage', { getItem: () => null });
    vi.stubGlobal('fetch', fetchMock);

    const resultado = await CarteiraApi.enriquecimento(700500);

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/carteira/notas/por-sap/700500',
      undefined,
    );
    expect(resultado).toEqual(resposta);
  });
});
