import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InputApi } from './api';
import { NetworkSyncStatus } from './network-sync-status';
import { obterEstadoRede } from './use-input-data';

describe('NetworkSyncStatus', () => {
  it('expõe a indisponibilidade e volta a mostrar sucesso após nova checagem', async () => {
    const tentarNovamente = () => undefined;
    vi.spyOn(InputApi, 'sync')
      .mockRejectedValueOnce(new Error('rede fora'))
      .mockResolvedValueOnce({
        ultima_alteracao: null,
        versao: '2026-08-09T12:00:00',
        sincronizando: false,
      });

    const estadoIndisponivel = await obterEstadoRede();
    const estadoRecuperado = await obterEstadoRede();

    const indisponivel = renderToStaticMarkup(
      <NetworkSyncStatus estado={estadoIndisponivel.estado} onTentarNovamente={tentarNovamente} />,
    );
    const sincronizada = renderToStaticMarkup(
      <NetworkSyncStatus estado={estadoRecuperado.estado} onTentarNovamente={tentarNovamente} />,
    );

    expect(indisponivel).toContain('Rede indisponível');
    expect(indisponivel).toContain('role="alert"');
    expect(indisponivel).toContain('Tentar novamente');
    expect(indisponivel).toContain('aria-label="Tentar novamente a verificação da rede"');
    expect(sincronizada).toContain('Sincronizada');
    expect(sincronizada).toContain('role="status"');
    expect(sincronizada).not.toContain('Rede indisponível');
  });
});
