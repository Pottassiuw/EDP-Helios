import React from 'react';
import { Slot } from 'radix-ui';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

/** Rótulo técnico: mono, 10px, caixa alta, tracking largo.
 *  `asChild` preserva a semântica do call site — o rótulo aparece em `dt`,
 *  `label`, `h2` e `li`, e trocar a tag por `span` quebraria acessibilidade. */
export function Eyebrow({ asChild, className, ...props }: React.ComponentProps<'span'> & {
  asChild?: boolean;
}): React.JSX.Element {
  const Comp = asChild ? Slot.Root : 'span';
  return (
    <Comp
      className={cn(
        'font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-text-mute',
        className,
      )}
      {...props}
    />
  );
}

/** Número display de KPI: tabular, tracking negativo. */
export function StatNumber({ className, ...props }: React.ComponentProps<'span'>): React.JSX.Element {
  return (
    <span
      className={cn(
        'text-2xl font-semibold leading-none tracking-display tabular-nums text-text',
        className,
      )}
      {...props}
    />
  );
}

/** Casca padrão de subseção: coluna com respiro e rolagem próprios.
 *  `--gap`/`--pad` ficam como arbitrary value de propósito: são reativos a
 *  `data-density` em runtime e não podem virar spacing scale estática. */
export function SectionPage({ className, ...props }: React.ComponentProps<'div'>): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-[var(--gap)] overflow-auto p-[var(--pad)]',
        className,
      )}
      {...props}
    />
  );
}

/** Cabeçalho de seção: eyebrow técnico + título display + subtítulo + ação. */
export function PageHeader({ eyebrow, title, subtitle, action }: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-[3px]">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className="m-0 text-lg font-semibold leading-[1.15] tracking-display text-balance">
          {title}
        </h2>
        {subtitle && <p className="m-0 text-[13px] text-text-dim">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** Tile de KPI: rótulo mono + número display tabular.
 *  `destaque` pinta o número com o tom de marca. Era um seletor posicional em
 *  CSS (`:first-child`), o que amarrava o realce à ordem do tile na linha;
 *  virou prop explícita na Fase 4c. Use em um tile por viewport — a disciplina
 *  Supabaze é de um único evento verde por tela. */
export function StatTile({ label, value, destaque }: {
  label: string;
  value: React.ReactNode;
  destaque?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex min-w-[120px] flex-col gap-[7px] rounded-app-md border border-line bg-surface px-4 py-[14px]">
      <Eyebrow>{label}</Eyebrow>
      <StatNumber className={destaque ? 'text-[var(--green-3)]' : undefined}>{value}</StatNumber>
    </div>
  );
}

const BANNER_TIPO = {
  ok: 'border-l-green bg-tint-green',
  err: 'border-l-amber bg-tint-amber',
} as const;

/** Banner de status inline (sucesso/erro). */
export function Banner({ tipo, className, children }: {
  tipo: 'ok' | 'err';
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="status"
      className={cn(
        'flex items-center gap-[10px] rounded-app-sm border-l-[3px] px-[14px] py-[10px] text-[13px]',
        BANNER_TIPO[tipo],
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface SegTab<T extends string> {
  id: T;
  rotulo: string;
}

/** Abas segmentadas com sublinhado. Envolve o ToggleGroup do shadcn para
 *  preservar a acessibilidade Radix (roving tabindex, navegação por setas).
 *  A pele (caixa → sublinhado) precisa de `!` para vencer as utilities da
 *  variant `outline` do primitivo. */
export function SegTabs<T extends string>({ tabs, value, onChange, ariaLabel }: {
  tabs: SegTab<T>[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}): React.JSX.Element {
  return (
    <ToggleGroup
      type="single"
      value={value}
      variant="default"
      className="gap-[2px]! shadow-none!"
      aria-label={ariaLabel}
      onValueChange={(v) => { if (v) onChange(v as T); }}
    >
      {tabs.map((t) => (
        <ToggleGroupItem
          key={t.id}
          value={t.id}
          className="mr-4! ml-0! my-0! rounded-none! border-0! border-b-2! border-b-transparent! bg-transparent! hover:bg-transparent! px-[2px]! py-2! text-[13px] font-medium text-text-mute shadow-none! hover:text-text data-[state=on]:bg-transparent! data-[state=on]:border-b-accent! data-[state=on]:text-text!"
        >
          {t.rotulo}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
