import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EDPApi } from '../../api';
import type { CoffeeConsulta } from '../coffee/types';
import type { Note } from '../../types';

vi.hoisted(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
  // dashboard.tsx (fila recolhida) e api.ts (BASE) leem localStorage no module
  // scope / mount; sem stub, o ambiente node do vitest não tem esse global.
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

vi.mock('./local-instalacao-correction', () => ({
  LocalInstalacaoCorrection: () => (
    <section>
      Corrigir local no COFFEE · Disponível via API · 3 cidade · 2 tipo · 8 número
      <button>Encaminhar para operação</button>
    </section>
  ),
}));

vi.mock('./nota-ficha-completa', () => ({
  NotaFichaCompleta: () => <section>Ficha completa (COFFEE)</section>,
}));

import { Dashboard, idsEncaminhaveisEmLote, inspetorOptions } from './dashboard';

function consultaVazia(): CoffeeConsulta {
  return {
    pk: 1, id_sap: null, local_instalacao: null, classificacao: 'gerada', arquivado: false,
    poste: null, referencia: null, referencia_fisica: null, referencia_eletrica: null,
    alimentador: null, problema: null, observacao: null, campos: {},
  };
}

function withQuery(node: ReactElement): string {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>,
  );
}

function nota(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? '1',
    local_instalacao: 'ABC-10', poste: 'P1', referencia: 'REF-1', problema: 'Problema',
    tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
    latitude: null, longitude: null, colaborador: null,
    imagens_totais: null, imagens_recebidas: null,
    errors: [], status: 'ok', duplicates: [],
    raw: {
      id: overrides.id ?? '1', tipo_nota: 'Poda', referencia_fisica: 'REF-1', prioridade: 3,
      setor: 'Centro', uf: 'ES', local_instalacao: 'ABC-10', alimentador: '', colaborador: '',
      executor: '', imagens_totais: 0, imagens_recebidas: 0, latitude: '', longitude: '',
      id_sap: '', descricao: '', poste: 'P1',
    },
    ...overrides,
  };
}

const notes: Note[] = [
  nota({
    id: '100', gerador: { matricula: '204565', nome: 'Fabricio Dias', uf: 'ES', inspetor: true, cadastrado: true },
  }),
  nota({
    id: '200', uf: 'SP', gerador: { matricula: '111', nome: 'Outro Inspetor', uf: 'SP', inspetor: true, cadastrado: true },
  }),
  nota({
    id: '300', gerador: { matricula: '999999', nome: '999999', uf: '', inspetor: false, cadastrado: false },
  }),
];

const noop = (): void => {};

describe('Dashboard — filtro por inspetor', () => {
  // O mock de sessionStorage é um Map compartilhado por todo o arquivo (ver
  // vi.hoisted acima); sem limpar entre testes, o filtro persistido por um
  // teste (ex.: "com inspetores selecionado") vaza para os seguintes e filtra
  // a fila de forma inesperada.
  beforeEach(() => {
    sessionStorage.removeItem('edp_verify_gerador');
    sessionStorage.removeItem('edp_verify_inspetor');
    sessionStorage.removeItem('edp_verify_situacao');
    sessionStorage.removeItem('edp_verify_uf');
    vi.spyOn(EDPApi, 'consultarNota').mockResolvedValue(consultaVazia());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sem seleção, mostra notas de todos os geradores', () => {
    const html = withQuery(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    // Notas aparecem como <span ...>{id}</span> na fila; usamos os delimitadores
    // de tag (`>100<`) porque um bare `toContain('200')` também casa com o
    // `xmlns="http://www.w3.org/2000/svg"` de qualquer ícone lucide-react
    // renderizado na página, gerando falso positivo/negativo.
    expect(html).toContain('>100<');
    expect(html).toContain('>200<');
    expect(html).toContain('>300<');
  });

  it('filtra as notas pelo estado de encaminhamento', () => {
    sessionStorage.setItem('edp_verify_situacao', JSON.stringify('falha_operacional'));
    const html = withQuery(
      <Dashboard showKpis={false} notes={notes} completed={new Set(['100', '200'])}
                 encaminhamentos={{
                   '100': { situacao: 'encaminhada', etapa: 'pronta', erro: null, encaminhada_em: null, encaminhada_por: 'ana', retornada_em: null, retornada_por: null, retorno_justificativa: null },
                   '200': { situacao: 'falha_operacional', etapa: 'pronta', erro: 'timeout', encaminhada_em: null, encaminhada_por: 'bruno', retornada_em: null, retornada_por: null, retorno_justificativa: null },
                 }} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).not.toContain('>100<');
    expect(html).toContain('>200<');
    expect(html).not.toContain('>300<');
    expect(html).toContain('Falha operacional');
  });

  it('com inspetores ES/SP selecionado (via sessionStorage persistido), exclui notas de não inspetores', () => {
    sessionStorage.setItem('edp_verify_gerador', JSON.stringify('inspectors'));
    const html = withQuery(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('>100<');
    expect(html).toContain('>200<');
    expect(html).not.toContain('>300<');
  });

  it('permite filtrar um inspetor após selecionar o escopo ES/SP', () => {
    sessionStorage.setItem('edp_verify_gerador', JSON.stringify('inspectors'));
    sessionStorage.setItem('edp_verify_inspetor', JSON.stringify('204565'));
    const html = withQuery(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('aria-label="Filtrar por quem gerou a nota"');
    expect(html).toContain('aria-label="Filtrar por inspetor"');
    expect(html).toContain('Gerada por: Inspetores ES/SP');
    expect(html).toContain('Inspetor: Fabricio Dias');
    expect(html).toContain('>100<');
    expect(html).not.toContain('>200<');
    expect(html).not.toContain('>300<');
  });

  it('mostra "Gerada por" na fila mesmo sem filtro de inspetor ativo, para nota não-inspetor', () => {
    const html = withQuery(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('Gerada por 999999');
    expect(html).toContain('matrícula não cadastrada');
  });

  it('mostra "Gerada por" na fila para nota de inspetor, sem precisar do filtro ativo', () => {
    const html = withQuery(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('Gerada por Fabricio Dias · ES');
  });

  it('nota cadastrada não recebe a marca de "matrícula não cadastrada" na fila', () => {
    const html = withQuery(
      <Dashboard showKpis={false} notes={notes} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html.includes('Fabricio Dias · ES (matrícula não cadastrada)')).toBe(false);
    expect(html.includes('Fabricio Dias · ES')).toBe(true);
  });

  it('painel de detalhe mostra "(não cadastrado)" só para a nota sem registro no De-Para', () => {
    // notes[0] é sempre a nota selecionada por padrão (selId cai para
    // notes[0].id quando não há valor persistido em sessionStorage), então
    // cada render abaixo usa um lote de uma nota só para controlar quem
    // aparece no painel de detalhe.
    const cadastrada = nota({
      id: '500', gerador: { matricula: '204565', nome: 'Fabricio Dias', uf: 'ES', inspetor: true, cadastrado: true },
    });
    const naoCadastrada = nota({
      id: '600', gerador: { matricula: '777777', nome: 'Sem Registro', uf: 'SP', inspetor: false, cadastrado: false },
    });

    const htmlCadastrada = withQuery(
      <Dashboard showKpis={false} notes={[cadastrada]} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(htmlCadastrada).toContain('Fabricio Dias · 204565');
    expect(htmlCadastrada).not.toContain('Fabricio Dias · 204565 (não cadastrado)');

    const htmlNaoCadastrada = withQuery(
      <Dashboard showKpis={false} notes={[naoCadastrada]} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(htmlNaoCadastrada).toContain('Sem Registro · 777777 (não cadastrado)');
  });

  it('expõe semanticamente o indicador de compatibilidade na fila', () => {
    const comCandidata = nota({
      id: '700',
      referencia_eletrica: 'ELE-1',
      duplicates: [{
        id: '701', local_instalacao: 'ABC-10', poste: 'P1', referencia: 'REF-1', problema: 'Problema',
        referencia_eletrica: 'ELE-1',
        tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
        in_sheet: true, match: [], latitude: null, longitude: null,
      }],
    });
    const html = withQuery(
      <Dashboard showKpis={false} notes={[comCandidata]} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Forte: 100% · cobertura 100%"');
    expect(html).toContain('100% cob.');
  });

  it('restringe a lista de inspetores ao estado selecionado no filtro de UF', () => {
    expect(inspetorOptions(notes, 'ES').map((o) => o.nome)).toEqual(['Fabricio Dias']);
    expect(inspetorOptions(notes, 'SP').map((o) => o.nome)).toEqual(['Outro Inspetor']);
  });

  it('sem filtro de UF, a lista de inspetores cobre todos os estados', () => {
    expect(inspetorOptions(notes, 'all').map((o) => o.nome).sort()).toEqual(['Fabricio Dias', 'Outro Inspetor']);
  });

  it('exclui do encaminhamento em lote notas com correção local pendente', () => {
    const localAtual = nota({
      id: '900',
      errors: [{ rule: 'chk_local_instalacao', rule_name: 'Local', value: 'x' }],
    });
    const localLegado = nota({
      id: '901',
      errors: [{ rule: 'chk_local_instal', rule_name: 'Local', value: 'x' }],
    });
    const elegivel = nota({ id: '902' });
    const concluida = nota({ id: '903' });

    expect(idsEncaminhaveisEmLote(
      ['900', '901', '902', '903'],
      [localAtual, localLegado, elegivel, concluida],
      new Set(['903']),
    )).toEqual(['902']);
  });

  it('oferece correção direta para os dois identificadores de falha local', () => {
    const comFalhaLocal = nota({
      id: '800',
      local_instalacao: '701CF123456789',
      errors: [{
        rule: 'chk_local_instalacao',
        rule_name: 'Local Instalação',
        value: '701CF123456789',
      }],
      status: 'erro',
    });
    const comAliasLegado = nota({
      id: '802',
      errors: [{
        rule: 'chk_local_instal',
        rule_name: 'Local Instalação',
        value: '701CF123456789',
      }],
      status: 'erro',
    });
    const comOutraFalha = nota({
      id: '801',
      errors: [{ rule: 'chk_referencia', rule_name: 'Referência', value: '-' }],
      status: 'erro',
    });

    const htmlLocal = withQuery(
      <Dashboard showKpis={false} notes={[comFalhaLocal]} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    const htmlAlias = withQuery(
      <Dashboard showKpis={false} notes={[comAliasLegado]} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );
    const htmlOutra = withQuery(
      <Dashboard showKpis={false} notes={[comOutraFalha]} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );

    expect(htmlLocal).toContain('Corrigir local no COFFEE');
    expect(htmlLocal).toContain('Disponível via API');
    expect(htmlLocal).toContain('3 cidade · 2 tipo · 8 número');
    expect(htmlLocal).toContain('Encaminhar para operação');
    expect(htmlLocal.match(/Encaminhar/g)).toHaveLength(1);
    expect(htmlAlias).toContain('Corrigir local no COFFEE');
    expect(htmlAlias.match(/Encaminhar/g)).toHaveLength(1);
    expect(htmlOutra).not.toContain('Corrigir local no COFFEE');
  });

  it('oferece correção direta para uma variante "de" com acento nunca vista antes', () => {
    const comVarianteDesconhecida = nota({
      id: '803',
      errors: [{
        rule: 'chk_local_de_instalação',
        rule_name: 'Local de Instalação',
        value: '701CF123456789',
      }],
      status: 'erro',
    });

    const html = withQuery(
      <Dashboard showKpis={false} notes={[comVarianteDesconhecida]} completed={new Set()} encaminhamentos={{}} encaminhadasHoje={[]} dupResolved={new Set()}
                 onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop} />
    );

    expect(html).toContain('Corrigir local no COFFEE');
  });
});
