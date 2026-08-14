import { describe, expect, it } from 'vitest';

import { estadoSapDaMeta } from './use-input-data';

describe('estado SAP da sincronização', () => {
  it('usa o estado real do robô, sem confundir sincronização da rede com SAP', () => {
    expect(estadoSapDaMeta({
      estado: 'executando',
      ultima_atualizacao: '2026-08-14T12:00:00',
      erro: null,
    })).toEqual('executando');
  });
});
