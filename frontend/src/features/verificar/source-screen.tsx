import React from 'react';
import { Database, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface SourceScreenProps {
  error: unknown;
  onRetry: () => void;
}

export function SourceScreen({ error, onRetry }: SourceScreenProps): React.JSX.Element {
  const message = error instanceof Error
    ? error.message
    : 'Conectando ao banco Verificar.db…';

  return (
    <div className="grid flex-1 place-items-center p-8">
      <div className="max-w-md rounded-app-lg border border-line bg-surface p-6 text-center shadow-sm">
        <Database className="mx-auto size-8 text-accent" aria-hidden="true" />
        <h1 className="mt-4 text-lg font-semibold tracking-display text-balance">
          Triagem Verificar
        </h1>
        <p className="mt-2 text-sm text-text-dim">{message}</p>
        {Boolean(error) && (
          <Button className="mt-5" variant="outline" onClick={onRetry}>
            <RefreshCw /> Tentar novamente
          </Button>
        )}
      </div>
    </div>
  );
}
