import type React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type NetworkSyncState =
  | { estado: 'verificando' }
  | { estado: 'sincronizando' }
  | { estado: 'sincronizada' }
  | { estado: 'indisponivel' };

interface NetworkSyncStatusProps {
  estado: NetworkSyncState['estado'];
  onTentarNovamente: () => void;
}

export function NetworkSyncStatus({
  estado,
  onTentarNovamente,
}: NetworkSyncStatusProps): React.JSX.Element {
  if (estado === 'sincronizada') {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 px-3 py-1 rounded-md bg-green/10 border border-green/20 text-green text-xs font-medium">
        <div className="carteira-sync-dot" />
        <span>Sincronizada</span>
      </div>
    );
  }

  if (estado === 'indisponivel') {
    return (
      <div role="status" aria-live="polite" className="flex items-center gap-2 px-2 py-1 rounded-md bg-red/10 border border-red/20 text-red text-xs font-medium">
        <span>Rede indisponível</span>
        <Button
          variant="outline"
          size="xs"
          aria-label="Tentar novamente a verificação da rede"
          onClick={onTentarNovamente}
        >
          <RefreshCw />
          Tentar novamente
        </Button>
      </div>
    );
  }

  const sincronizando = estado === 'sincronizando';
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 px-3 py-1 rounded-md bg-amber/10 border border-amber/30 text-amber text-xs font-medium">
      <Loader2 className={`h-3.5 w-3.5 ${sincronizando ? 'animate-spin' : ''}`} />
      <span>{sincronizando ? 'Sincronizando…' : 'Verificando rede…'}</span>
    </div>
  );
}
