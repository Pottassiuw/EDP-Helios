import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

import type { DuplicateCandidate, Note } from '../../types';
import { COFFEE_CONSULTA_KEY } from '../coffee/coffee-query-keys';
import { DuplicateCompare, dupcEq } from './duplicate-compare';
import { Dashboard } from './dashboard';
import { ExternalCandidateCard, mergeConsultaCampos } from './duplicate-compare-externa';

function nota(overrides: Partial<Note>): Note {
  return {
    id: '100',
    local_instalacao: '718ET00026773', poste: 'P1', referencia: 'REF-1', problema: 'chave · queda',
    tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
    latitude: null, longitude: null, colaborador: null,
    imagens_totais: null, imagens_recebidas: null,
    errors: [], status: 'erro', duplicates: [],
    raw: {
      id: '100', tipo_nota: 'Poda', referencia_fisica: 'REF-1', prioridade: 3,
      setor: 'Centro', uf: 'ES', local_instalacao: 'ABC-10', alimentador: '', colaborador: '',
      executor: '', imagens_totais: 0, imagens_recebidas: 0, latitude: '', longitude: '',
      id_sap: '', descricao: '', poste: 'P1',
    },
    ...overrides,
  };
}

function candidataMatch(overrides: Partial<DuplicateCandidate>): DuplicateCandidate {
  return {
    id: '171153', in_sheet: false, match: [], latitude: null, longitude: null,
    local_instalacao: '718ET00026773', poste: '', referencia: '', problema: 'chave · queda',
    tipo_nota: '', setor: '', uf: '', prioridade: 0,
    carteira_match: true, status_sap: 'Pendente', prioridade_sap: 3,
    conjunto: 'POSTE DEMANDA', carteira_ausente_em: null,
    ...overrides,
  };
}

function renderCard(note: Note, candidate: DuplicateCandidate): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <ExternalCandidateCard note={note} candidate={candidate} />
    </QueryClientProvider>,
  );
}

describe('mergeConsultaCampos', () => {
  it('preenche poste/referencia/referencia_eletrica buscados, sem mexer no resto da candidata', () => {
    const candidate = candidataMatch({ local_instalacao: 'LI anterior', problema: 'Problema anterior', poste: '', referencia: '', referencia_eletrica: '', observacao: 'Observação anterior' });
    const resultado = mergeConsultaCampos(candidate, { local_instalacao: 'LI COFFEE', problema: 'Problema COFFEE', poste: 'TR-088', referencia: 'SER-11', referencia_eletrica: 'FF-655816', observacao: 'Observação COFFEE' });
    expect(resultado).not.toBe(candidate);
    expect(candidate.local_instalacao).toBe('LI anterior');
    expect(candidate.observacao).toBe('Observação anterior');
    expect(resultado.local_instalacao).toBe('LI COFFEE');
    expect(resultado.problema).toBe('Problema COFFEE');
    expect(resultado.poste).toBe('TR-088');
    expect(resultado.referencia).toBe('SER-11');
    expect(resultado.referencia_eletrica).toBe('FF-655816');
    expect(resultado.observacao).toBe('Observação COFFEE');
  });

  it('campos nulos da busca caem pro que já existia na candidata', () => {
    const candidate = candidataMatch({ local_instalacao: 'LI anterior', problema: 'Problema anterior', poste: 'ja-tinha', referencia: 'REF anterior', referencia_eletrica: 'ELE anterior', observacao: 'Observação anterior' });
    const resultado = mergeConsultaCampos(candidate, { local_instalacao: null, problema: ' ', poste: '', referencia: null, referencia_eletrica: null, observacao: '   ' });
    expect(resultado.local_instalacao).toBe('LI anterior');
    expect(resultado.problema).toBe('Problema anterior');
    expect(resultado.poste).toBe('ja-tinha');
    expect(resultado.referencia).toBe('REF anterior');
    expect(resultado.referencia_eletrica).toBe('ELE anterior');
    expect(resultado.observacao).toBe('Observação anterior');
  });
});

describe('ExternalCandidateCard', () => {
  it('reaproveita a consulta COFFEE já em cache ao voltar para a nota', () => {
    const candidate = candidataMatch({
      carteira_match: false,
      local_instalacao: '',
      problema: '',
      poste: '',
      referencia: '',
    });
    const queryClient = new QueryClient();
    queryClient.setQueryData(COFFEE_CONSULTA_KEY(Number(candidate.id)), {
      local_instalacao: 'LI COFFEE',
      problema: 'Problema COFFEE',
      poste: 'P-77',
      referencia: 'Rua da Consulta',
      observacao: 'Observação recuperada do cache',
    });

    const html = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <ExternalCandidateCard note={nota({})} candidate={candidate} />
      </QueryClientProvider>,
    );

    expect(html).toContain('Dados abaixo vieram direto do COFFEE.');
    expect(html).toContain('Observação recuperada do cache');
  });

  it('com match na Carteira, mostra os quatro campos, observação e contexto SAP', () => {
    const html = renderCard(nota({ observacao: 'Observação desta nota' }), candidataMatch({ observacao: 'Observação candidata' }));
    expect(html).toContain('718ET00026773');
    expect(html).toContain('Observação desta nota');
    expect(html).toContain('Observação candidata');
    expect(html).toContain('Pendente');
    expect(html).toContain('POSTE DEMANDA');
    // poste/referencia/referencia_eletrica em branco na Carteira: só 2 dos 5
    // campos ponderados são conhecidos, cobertura abaixo do corte de confiança.
    expect(html).toContain('Evidência insuficiente');
    expect(html).toContain('Buscar dados no COFFEE');
    expect(html).not.toContain('≠');
  });

  it('tombstoned mostra aviso de ausencia mas ainda mostra os dados', () => {
    const html = renderCard(nota({}), candidataMatch({ carteira_ausente_em: '2026-07-01T00:00:00' }));
    expect(html).toContain('Ausente da Carteira desde');
    expect(html).toContain('718ET00026773');
  });

  it('sem match na Carteira, mostra estado dedicado sem grid', () => {
    const html = renderCard(nota({}), candidataMatch({ carteira_match: false, local_instalacao: '', problema: '', poste: '', referencia: '' }));
    expect(html).toContain('Não encontrada na Carteira de Notas');
    expect(html).toContain('Evidência insuficiente');
    expect(html.match(/class="[^"]*dupc-badge/g) ?? []).toHaveLength(1);
  });
});

describe('Normalização visual da comparação', () => {
  it('considera espaços internos como o score ponderado', () => {
    expect(dupcEq(' P 01 ', 'P01')).toBe(true);
  });
});

describe('DuplicateCompare — candidatas externas', () => {
  it('renderiza um único badge de estado para a candidata externa', () => {
    const candidate = candidataMatch({});
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <DuplicateCompare
          note={nota({ duplicates: [candidate] })}
          resolved={false}
          onMarkDuplicate={() => undefined}
        />
      </QueryClientProvider>,
    );
    const badges = html.match(/class="[^"]*dupc-badge/g) ?? [];
    expect(badges).toHaveLength(1);
    expect(html).not.toContain('⧉ Externo');
  });
});

describe('Dashboard — indicador de compatibilidade', () => {
  it('prioriza evidência forte sobre score bruto com cobertura insuficiente', () => {
    const forte = candidataMatch({
      id: '101', local_instalacao: '718ET00026773', problema: 'chave · queda', poste: 'P1', referencia: 'REF-1',
      referencia_eletrica: 'ELE-1',
    });
    const semEvidencia = candidataMatch({
      id: '102', local_instalacao: '', problema: '', poste: '', referencia: '',
    });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <Dashboard
          showKpis={false}
          notes={[nota({ duplicates: [semEvidencia, forte], referencia_eletrica: 'ELE-1' })]}
          completed={new Set()}
          encaminhamentos={{}}
          encaminhadasHoje={[]}
          dupResolved={new Set()}
          onToggleComplete={() => undefined}
          onMarkMany={() => undefined}
          onMarkDuplicate={() => undefined}
          onSendToCoffee={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(html).toContain('aria-label="Forte: 100% · cobertura 100%"');
  });
});
