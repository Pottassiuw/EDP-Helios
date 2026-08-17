import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

import type { DuplicateCandidate, Note } from '../../types';
import { DuplicateCompare } from './duplicate-compare';

function nota(overrides: Partial<Note>): Note {
  return {
    id: '100',
    local_instalacao: '718ET00026773', poste: 'P1', referencia: 'REF-1', problema: 'chave · queda',
    tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
    latitude: null, longitude: null, colaborador: null,
    imagens_totais: null, imagens_recebidas: null,
    errors: [], status: 'erro',
    duplicates: [candidata({})],
    raw: {
      id: '100', tipo_nota: 'Poda', referencia_fisica: 'REF-1', prioridade: 3,
      setor: 'Centro', uf: 'ES', local_instalacao: '718ET00026773', alimentador: '', colaborador: '',
      executor: '', imagens_totais: 0, imagens_recebidas: 0, latitude: '', longitude: '',
      id_sap: '', descricao: '', poste: 'P1',
    },
    ...overrides,
  };
}

function candidata(overrides: Partial<DuplicateCandidate>): DuplicateCandidate {
  return {
    id: '171153', in_sheet: true, match: [], latitude: null, longitude: null,
    local_instalacao: '718ET00026773', poste: 'P1', referencia: 'REF-1', problema: 'chave · queda',
    tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
    ...overrides,
  };
}

describe('DuplicateCompare — marcar/desmarcar duplicata', () => {
  it('nota não resolvida mostra "Marcar como duplicata" e o botão de Fila COFFEE', () => {
    const html = renderToStaticMarkup(
      <DuplicateCompare note={nota({})} resolved={false}
                         onMarkDuplicate={() => undefined} onSendToCoffee={() => undefined} />,
    );
    expect(html).toContain('Marcar como duplicata');
    expect(html).toContain('Fila COFFEE');
    expect(html).not.toContain('Reabrir');
  });

  it('nota resolvida mostra "Reabrir" e esconde o botão de Fila COFFEE', () => {
    const html = renderToStaticMarkup(
      <DuplicateCompare note={nota({})} resolved={true}
                         onMarkDuplicate={() => undefined} onSendToCoffee={() => undefined} />,
    );
    expect(html).toContain('Reabrir');
    expect(html).not.toContain('Fila COFFEE');
  });
});
