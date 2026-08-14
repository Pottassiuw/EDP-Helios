import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CarteiraEnriquecimentoContent,
} from './carteira-enriquecimento-card';
import type { CarteiraEnriquecimento } from './types';

const encontrada: CarteiraEnriquecimento = {
  numero_sap: 700500,
  estado: 'encontrada',
  dados: {
    descricao_conjunto: 'POSTES - CAPEX',
    conjunto: 'POSTE',
    sintoma: 'Queda',
    componente_novo: 'Rede primária',
    kit: 'KIT-01',
    n_trafo: 'TR-10',
    dispositivo_protecao: 'REL-2',
    status_sap: 'Pendente',
    prioridade_sap: 2,
  },
  ausente_na_origem_em: null,
  avisos: [],
  versao: '7',
};

function render(resultado: CarteiraEnriquecimento | undefined): string {
  return renderToStaticMarkup(
    <CarteiraEnriquecimentoContent
      resultado={resultado}
      carregando={false}
      erro={null}
      onRetry={vi.fn()}
      onIrParaSincronizacao={vi.fn()}
    />,
  );
}

describe('CarteiraEnriquecimentoContent', () => {
  it('renderiza a hierarquia e os nove campos sem PII', () => {
    const html = render(encontrada);

    expect(html).toContain('Dados da base COFFEE');
    expect(html).toContain('POSTES - CAPEX');
    expect(html).toContain('POSTE');
    expect(html).toContain('Sintoma');
    expect(html).toContain('Componente novo');
    expect(html).toContain('KIT-01');
    expect(html).toContain('TR-10');
    expect(html).toContain('REL-2');
    expect(html).toContain('Pendente');
    expect(html).toContain('Prioridade SAP');
    expect(html).not.toContain('Solicitante');
    expect(html).not.toContain('Colaborador');
  });

  it('mantém os dados e avisa quando a nota é tombstone', () => {
    const html = render({
      ...encontrada,
      estado: 'ausente_na_origem',
      ausente_na_origem_em: '2026-07-29T12:00:00',
    });

    expect(html).toContain('Ausente na origem desde');
    expect(html).toContain('POSTES - CAPEX');
  });

  it('mostra aviso acionável, preserva dados válidos e distingue zero de indisponível', () => {
    const html = render({
      ...encontrada,
      dados: {
        ...encontrada.dados!,
        kit: null,
        prioridade_sap: 0,
      },
      avisos: [{
        codigo: 'equipamentos_indisponiveis',
        bloco: 'equipamentos',
        campos: ['kit'],
        mensagem: 'Parte dos dados de equipamentos está indisponível.',
        acao: 'Sincronize novamente. Se o aviso persistir, verifique a compatibilidade da fonte.',
      }],
    });

    expect(html).toContain('role="status"');
    expect(html).toContain('Dados parcialmente indisponíveis');
    expect(html).toContain('Parte dos dados de equipamentos está indisponível.');
    expect(html).toContain('Sincronize novamente.');
    expect(html).toContain('Ir para Sincronização');
    expect(html).toContain('POSTES - CAPEX');
    expect(html).toContain('>Indisponível<');
    expect(html).toContain('>0<');
  });

  it('renders a legacy payload without avisos', () => {
    const html = render({
      ...encontrada,
      avisos: undefined,
    } as unknown as CarteiraEnriquecimento);

    expect(html).toContain('POSTES - CAPEX');
  });

  it('exibe travessão quando a data de tombstone é vazia', () => {
    const html = render({
      ...encontrada,
      estado: 'ausente_na_origem',
      ausente_na_origem_em: '',
    });

    expect(html).toContain('Ausente na origem desde —.');
  });

  it('diferencia ausência e base nunca sincronizada', () => {
    const semCorrespondencia = render({
      ...encontrada,
      estado: 'sem_correspondencia',
      dados: null,
    });
    const semSync = render({
      ...encontrada,
      estado: 'base_nao_sincronizada',
      dados: null,
    });

    expect(semCorrespondencia).toContain(
      'Sem correspondência na base COFFEE.',
    );
    expect(semSync).toContain('A Carteira ainda não foi sincronizada.');
    expect(semSync).toContain('Ir para Sincronização');
  });

  it('oferece retry somente para erro real', () => {
    const html = renderToStaticMarkup(
      <CarteiraEnriquecimentoContent
        resultado={undefined}
        carregando={false}
        erro={new Error('offline')}
        onRetry={vi.fn()}
        onIrParaSincronizacao={vi.fn()}
      />,
    );

    expect(html).toContain('Não foi possível consultar a base COFFEE.');
    expect(html).toContain('Tentar novamente');
  });

  it('marca o carregamento sem bloquear o inspector', () => {
    const html = renderToStaticMarkup(
      <CarteiraEnriquecimentoContent
        resultado={undefined}
        carregando
        erro={null}
        onRetry={vi.fn()}
        onIrParaSincronizacao={vi.fn()}
      />,
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Carregando dados da base COFFEE');
  });
});
