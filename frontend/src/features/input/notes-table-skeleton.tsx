import React from 'react';

interface NotesTableSkeletonProps {
  /** Quantidade de linhas-fantasma exibidas. */
  linhas?: number;
}

const LARGURAS = [72, 110, 90, 130, 70, 100];

/** Estado de carregamento da NotesTable: linhas-fantasma na largura aproximada
 *  das colunas reais, em vez de um spinner genérico cobrindo a área inteira. */
export function NotesTableSkeleton({ linhas = 8 }: NotesTableSkeletonProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Carregando notas"
      className="rounded-[8px] border border-line overflow-hidden bg-surface"
    >
      <div className="h-[30px] bg-surface shadow-[inset_0_-1px_0_var(--line)]" />
      {Array.from({ length: linhas }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-5 h-[40px] px-3.5 border-b border-line last:border-b-0"
        >
          {LARGURAS.map((largura, j) => (
            <span
              key={j}
              className="h-[9px] rounded-[4px] bg-surface-3 animate-pulse"
              style={{ width: largura, animationDelay: `${(i * LARGURAS.length + j) * 40}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
