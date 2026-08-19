import type { Celula } from './types';

export function anoEncerramento(v: Celula | undefined): number | null {
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}
