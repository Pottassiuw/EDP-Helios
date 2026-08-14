import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

import type { CoffeeConsulta } from '../coffee/types';
import { consultaCoffeeQueryOptions } from './use-consulta-coffee';

function consulta(): CoffeeConsulta {
  return {
    pk: 1, id_sap: 1, local_instalacao: '701CF12345678', classificacao: 'gerada',
    arquivado: false, poste: 'P1', referencia: 'REF-1', referencia_fisica: 'REF-1',
    referencia_eletrica: 'ELE-1', alimentador: 'AFC01', problema: 'x', observacao: 'y',
    campos: {},
  };
}

/** `useConsultaCoffee` é usada por NotaFichaCompleta, LocalInstalacaoCorrection
 * e AlimentadorCorrection — este teste exercita a política de query direto via
 * `QueryObserver`, sem montar React, pra provar que múltiplos observadores na
 * mesma nota não geram consultas duplicadas nem em remontagem (Strict Mode). */
describe('consultaCoffeeQueryOptions — política de consulta compartilhada', () => {
  it('um segundo observador (ficha completa + correção de local na mesma nota) reusa o dado fresco, sem chamada extra', async () => {
    const queryFn = vi.fn().mockResolvedValue(consulta());
    const queryClient = new QueryClient();
    const options = { ...consultaCoffeeQueryOptions('355617'), queryFn, retry: false };

    const observerA = new QueryObserver(queryClient, options);
    const unsubA = observerA.subscribe(() => {});
    await vi.waitFor(() => expect(observerA.getCurrentResult().isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    // Monta o segundo observador depois que o primeiro já tem dado fresco em
    // cache — é o cenário real (NotaFichaCompleta + LocalInstalacaoCorrection
    // observando a mesma nota). Sem `refetchOnMount:'always'`, isso não deve
    // gerar uma segunda chamada.
    const observerB = new QueryObserver(queryClient, options);
    const unsubB = observerB.subscribe(() => {});
    expect(observerB.getCurrentResult().isSuccess).toBe(true);

    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubA();
    unsubB();
  });

  it('remontar um observador (Strict Mode) com dado fresco não refaz a consulta', async () => {
    const queryFn = vi.fn().mockResolvedValue(consulta());
    const queryClient = new QueryClient();
    const options = { ...consultaCoffeeQueryOptions('355617'), queryFn, retry: false };

    const observer = new QueryObserver(queryClient, options);
    const unsub1 = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    unsub1();

    // Strict Mode desmonta e remonta o observador em seguida; com staleTime
    // de 30min e sem `refetchOnMount: 'always'`, isso não deve refazer o fetch.
    const unsub2 = observer.subscribe(() => {});
    expect(observer.getCurrentResult().isSuccess).toBe(true);
    unsub2();

    expect(queryFn).toHaveBeenCalledTimes(1);
  });

  it('atualizar consulta explicitamente (refetch) faz exatamente uma nova chamada', async () => {
    const queryFn = vi.fn().mockResolvedValue(consulta());
    const queryClient = new QueryClient();
    const options = { ...consultaCoffeeQueryOptions('355617'), queryFn, retry: false };

    const observer = new QueryObserver(queryClient, options);
    const unsub = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().isSuccess).toBe(true));
    expect(queryFn).toHaveBeenCalledTimes(1);

    await observer.refetch();
    expect(queryFn).toHaveBeenCalledTimes(2);

    await observer.refetch();
    expect(queryFn).toHaveBeenCalledTimes(3);
    unsub();
  });

  it('não usa refetchOnMount "always" — dado fresco não é refeito ao montar', () => {
    const options = consultaCoffeeQueryOptions('355617');
    expect(options.refetchOnMount).not.toBe('always');
  });
});
