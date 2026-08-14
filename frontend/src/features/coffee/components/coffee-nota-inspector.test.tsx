import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

import { CARTEIRA_ENRIQUECIMENTO_KEY } from '../../carteira/use-carteira-enriquecimento';
import { NOTA_LOGS_KEY } from '../use-coffee-logs';
import { REVISAO_KEY } from '../use-nota-revisao';
import { CoffeeNotaInspector } from './coffee-nota-inspector';

vi.mock('@/components/ui/sheet', () => {
  const passthrough = ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  );

  return {
    Sheet: passthrough,
    SheetContent: passthrough,
    SheetHeader: passthrough,
    SheetTitle: passthrough,
  };
});

describe('CoffeeNotaInspector', () => {
  it('consulta o enriquecimento pelo ID SAP da revisão, não pelo pk interno', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(REVISAO_KEY(58), {
      coffee: {
        pk: 58,
        id_sap: 900100,
        id_sap_anterior: null,
        arquivado: false,
        classificacao: 'gerada',
        dados_json: null,
        buscado_em: '2026-07-29T12:00:00Z',
        erro: null,
      },
      iw28: null,
      iw28_extraida_em: null,
      plano: null,
      ja_no_plano: false,
      proposta: {
        Numero_Nota: 900100,
        Local_Instalacao: 'ABC-10',
        Circuito: 'CIR-01',
        Prioridade_Nota: 'Alta',
        Status_Nota: 'Em aberto',
        Data_Envio_Projeto: '',
        Observacao: '',
        Planejado_DDPM: 0,
        Planejado_Unidade: null,
      },
      avisos: [],
      pode_mover: false,
      motivo_bloqueio: null,
    });
    queryClient.setQueryData(NOTA_LOGS_KEY(58), []);
    queryClient.setQueryData(CARTEIRA_ENRIQUECIMENTO_KEY(900100), {
      numero_sap: 900100,
      estado: 'encontrada',
      dados: {
        descricao_conjunto: 'POSTES - CAPEX',
        conjunto: 'POSTE',
        sintoma: null,
        componente_novo: null,
        kit: null,
        n_trafo: null,
        dispositivo_protecao: null,
        status_sap: null,
        prioridade_sap: null,
      },
      ausente_na_origem_em: null,
      avisos: [],
      versao: '7',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <CoffeeNotaInspector
          pk={58}
          open
          onClose={vi.fn()}
          onAction={vi.fn()}
          onIrParaSincronizacao={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(html).toContain('Dados da base COFFEE');
    expect(html).toContain('POSTES - CAPEX');
  });
});
