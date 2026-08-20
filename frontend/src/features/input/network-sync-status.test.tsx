import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NetworkSyncStatus } from './network-sync-status';

describe('NetworkSyncStatus', () => {
  it('expõe a indisponibilidade e volta a mostrar sucesso após nova checagem', async () => {
    const tentarNovamente = () => undefined;
    const indisponivel = renderToStaticMarkup(
      <NetworkSyncStatus estado="indisponivel" onTentarNovamente={tentarNovamente} />,
    );
    const sincronizada = renderToStaticMarkup(
      <NetworkSyncStatus estado="sincronizada" onTentarNovamente={tentarNovamente} />,
    );

    expect(indisponivel).toContain('Rede indisponível');
    expect(indisponivel).toContain('role="status"');
    expect(indisponivel).toContain('aria-live="polite"');
    expect(indisponivel).toContain('Tentar novamente');
    expect(indisponivel).toContain('aria-label="Tentar novamente a verificação da rede"');
    expect(sincronizada).toContain('Sincronizada');
    expect(sincronizada).toContain('role="status"');
    expect(sincronizada).not.toContain('Rede indisponível');
  });
});
