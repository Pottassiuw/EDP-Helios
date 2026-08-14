import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
});

import { alterarLocalInstalacao } from '../../api';
import {
  COFFEE_CONSULTA_KEY,
  invalidarConsultaCoffee,
} from '../coffee/coffee-query-keys';
import {
  analisarEdicaoLocal,
  formatarLocalInstalacao,
  localInstalacaoValido,
  normalizarLocalInstalacao,
} from '../../lib/local-instalacao';
import { corrigirEConfirmarLocal } from './local-instalacao-service';
import { consultaLocalEstaAtualizada } from './use-local-instalacao-correction';

const fetchMock = vi.fn<typeof fetch>();

describe('correção de local de instalação', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('edp_input_user', 'alice');
  });

  it('normaliza, formata e valida o contrato de 13 caracteres', () => {
    expect(normalizarLocalInstalacao(' 701-cf-12345678 ')).toBe('701CF12345678');
    expect(formatarLocalInstalacao('701cf12345678')).toBe('701-CF-12345678');
    expect(localInstalacaoValido('701CF12345678')).toBe(true);
    expect(localInstalacaoValido('701-CF-12345678')).toBe(false);
    expect(localInstalacaoValido('701CF123456789')).toBe(false);
  });

  it('deriva salvar e confirmar sem depender do estado transitório da consulta', () => {
    const igual = analisarEdicaoLocal({
      consultado: true,
      ocupado: false,
      atual: '701CF12345678',
      proposto: '701CF12345678',
    });
    expect(igual).toEqual({ podeSalvar: false, confirmado: true });

    const diferente = analisarEdicaoLocal({
      consultado: true,
      ocupado: false,
      atual: '701CF12345678',
      proposto: '702ET87654321',
    });
    expect(diferente).toEqual({ podeSalvar: true, confirmado: false });

    const semConsulta = analisarEdicaoLocal({
      consultado: false,
      ocupado: false,
      atual: '701CF12345678',
      proposto: '701CF12345678',
    });
    expect(semConsulta).toEqual({ podeSalvar: false, confirmado: false });
  });

  it('não confirma dados retidos quando a releitura falha', () => {
    expect(consultaLocalEstaAtualizada({
      isSuccess: true,
      isError: false,
      isRefetchError: false,
    })).toBe(true);
    expect(consultaLocalEstaAtualizada({
      isSuccess: true,
      isError: false,
      isRefetchError: true,
    })).toBe(false);
    expect(consultaLocalEstaAtualizada({
      isSuccess: true,
      isError: true,
      isRefetchError: false,
    })).toBe(false);
  });

  it('invalida a consulta compartilhada após uma correção externa', async () => {
    const queryClient = new QueryClient();
    const key = COFFEE_CONSULTA_KEY(800);
    queryClient.setQueryData(key, { local_instalacao: '701CF12345678' });

    await invalidarConsultaCoffee(queryClient, 800);

    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
  });

  it('altera o local identificado pelo usuário da sessão', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      local_instalacao: '701CF12345678',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));

    await expect(alterarLocalInstalacao(800, '701CF12345678')).resolves.toEqual({
      ok: true,
      local_instalacao: '701CF12345678',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/coffee/local-instalacao', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User': 'alice',
      },
      body: JSON.stringify({ id: 800, local: '701CF12345678' }),
    });
  });

  it('só confirma a correção após reler o mesmo valor do COFFEE', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        local_instalacao: '701CF12345678',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        pk: 800,
        id_sap: null,
        arquivado: false,
        local_instalacao: '701CF12345678',
        fields: {},
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));

    await expect(corrigirEConfirmarLocal(800, '701CF12345678'))
      .resolves.toMatchObject({ local_instalacao: '701CF12345678' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/coffee/consultar/800');
  });
});
