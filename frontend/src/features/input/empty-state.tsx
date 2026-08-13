import { FilterX, Inbox } from 'lucide-react';

import { Button } from '@/components/ui/button';

export type InputEmptyStateKind = 'dataset' | 'filter';

export function getInputEmptyState(sourceCount: number, visibleCount: number): InputEmptyStateKind | null {
  if (sourceCount === 0) return 'dataset';
  if (visibleCount === 0) return 'filter';
  return null;
}

type InputEmptyStateProps =
  | { state: 'dataset'; onClearFilters?: never }
  | { state: 'filter'; onClearFilters?: () => void };

export function InputEmptyState({ state, onClearFilters }: InputEmptyStateProps): React.JSX.Element {
  const filtered = state === 'filter';
  const Icon = filtered ? FilterX : Inbox;

  return (
    <div className="flex min-h-48 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <Icon aria-hidden="true" className="h-6 w-6 text-text-mute" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">
          {filtered ? 'Nenhuma nota corresponde aos filtros' : 'Nenhuma nota cadastrada'}
        </p>
        <p className="text-xs text-text-mute">
          {filtered
            ? 'Ajuste ou limpe os filtros para voltar a exibir as notas.'
            : 'As notas aparecerão aqui quando a base tiver registros.'}
        </p>
      </div>
      {filtered && onClearFilters && (
        <Button variant="outline" size="sm" className="min-h-11 text-xs" onClick={onClearFilters}>
          Limpar filtros
        </Button>
      )}
    </div>
  );
}
