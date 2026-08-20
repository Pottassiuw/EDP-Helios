import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Banner } from '@/components/branded/section';
import { getInputEmptyState, InputEmptyState } from './empty-state';

describe('InputEmptyState', () => {
  it('distinguishes an empty dataset from filters with no matches', () => {
    expect(getInputEmptyState(0, 0)).toBe('dataset');
    expect(getInputEmptyState(3, 0)).toBe('filter');
    expect(getInputEmptyState(3, 2)).toBeNull();
  });

  it('offers clearing filters only for a filter-empty dataset when provided', () => {
    const onClearFilters = vi.fn();
    const filteredHtml = renderToStaticMarkup(
      <InputEmptyState state="filter" onClearFilters={onClearFilters} />,
    );
    const datasetHtml = renderToStaticMarkup(<InputEmptyState state="dataset" />);

    expect(filteredHtml).toContain('Nenhuma nota corresponde aos filtros');
    expect(filteredHtml).toContain('Limpar filtros');
    expect(datasetHtml).toContain('Nenhuma nota cadastrada');
    expect(datasetHtml).not.toContain('Limpar filtros');
  });
});

describe('Banner live-region semantics', () => {
  it('uses implicit live-region roles without duplicate aria-live', () => {
    const statusHtml = renderToStaticMarkup(<Banner tipo="ok">Concluído</Banner>);
    const alertHtml = renderToStaticMarkup(<Banner tipo="err">Falhou</Banner>);

    expect(statusHtml).toContain('role="status"');
    expect(alertHtml).toContain('role="alert"');
    expect(statusHtml).not.toContain('aria-live');
    expect(alertHtml).not.toContain('aria-live');
  });
});
