import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

import { EDPApi } from '../../api';
import type { CoffeeConsulta, TipoEquipamento } from '../coffee/types';
import { COFFEE_CONSULTA_KEY, TIPOS_EQUIPAMENTO_KEY } from '../coffee/coffee-query-keys';
import type { Note } from '../../types';
import { Dashboard } from './dashboard';

function nota(overrides: Partial<Note>): Note {
  return {
    id: overrides.id ?? '1',
    local_instalacao: 'ABC-10', poste: 'P1', referencia: 'REF-1', problema: 'Problema',
    tipo_nota: 'Poda', setor: 'Centro', uf: 'ES', prioridade: 3,
    latitude: null, longitude: null, colaborador: null,
    imagens_totais: null, imagens_recebidas: null,
    errors: [], status: 'ok', duplicates: [],
    raw: {
      id: overrides.id ?? '1', tipo_nota: 'Poda', referencia_fisica: '', prioridade: 3,
      setor: 'Centro', uf: 'ES', local_instalacao: 'ABC-10', alimentador: '', colaborador: '',
      executor: '', imagens_totais: 0, imagens_recebidas: 0, latitude: '', longitude: '',
      id_sap: '', descricao: '', poste: 'P1',
    },
    ...overrides,
  };
}

function consulta(overrides: Partial<CoffeeConsulta> = {}): CoffeeConsulta {
  return {
    pk: 1, id_sap: 17247854, local_instalacao: '701CF12345678', classificacao: 'gerada',
    arquivado: false, poste: 'TR-088', referencia: 'SER-11', referencia_fisica: 'SER-11',
    referencia_eletrica: 'ELE-22', alimentador: 'AFC01', problema: 'chave · queda',
    observacao: 'Poste inclinado',
    campos: { sintoma: 'queda' },
    ...overrides,
  };
}

const noop = (): void => {};

function renderDetail(note: Note, dadosCoffee: CoffeeConsulta, tipos: TipoEquipamento[] = []): string {
  const queryClient = new QueryClient();
  queryClient.setQueryData(COFFEE_CONSULTA_KEY(Number(note.id)), dadosCoffee);
  queryClient.setQueryData(TIPOS_EQUIPAMENTO_KEY, tipos);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <Dashboard
        showKpis={false} notes={[note]} completed={new Set()} encaminhamentos={{}}
        encaminhadasHoje={[]} dupResolved={new Set()}
        onToggleComplete={noop} onMarkMany={noop} onMarkDuplicate={noop} onSendToCoffee={noop}
      />
    </QueryClientProvider>,
  );
}

describe('Detail — ordem e deduplicação de campos', () => {
  beforeEach(() => {
    vi.spyOn(EDPApi, 'consultarNota').mockResolvedValue(consulta());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra a referência elétrica da consulta COFFEE no bloco Identificação & localização', () => {
    const note = nota({ id: '355617' });
    const html = renderDetail(note, consulta({ referencia_eletrica: 'ELE-22' }));
    const idxIdentificacao = html.indexOf('Identificação &amp; localização');
    const idxEletrica = html.indexOf('ELE-22');
    expect(idxIdentificacao).toBeGreaterThan(-1);
    expect(idxEletrica).toBeGreaterThan(idxIdentificacao);
  });

  it('ordena o detalhe: identificação antes de correção de local, falhas e ficha completa', () => {
    const note = nota({
      id: '355617',
      errors: [{ rule: 'chk_local_instalacao', rule_name: 'Local', value: 'x' }],
      status: 'erro',
    });
    const html = renderDetail(note, consulta());

    const idxIdentificacao = html.indexOf('Identificação &amp; localização');
    const idxCorrecao = html.indexOf('Corrigir local no COFFEE');
    const idxFalhas = html.indexOf('Falhas encontradas');
    const idxFicha = html.indexOf('Ficha completa (COFFEE)');

    expect(idxIdentificacao).toBeGreaterThan(-1);
    expect(idxCorrecao).toBeGreaterThan(idxIdentificacao);
    expect(idxFalhas).toBeGreaterThan(idxCorrecao);
    expect(idxFicha).toBeGreaterThan(idxFalhas);
  });

  it('campos que a Identificação complementa via COFFEE (observação, referências, alimentador, ID SAP) aparecem uma única vez', () => {
    // raw da nota vem vazio nesses campos (fixture `nota()`), então o bloco
    // principal usa o valor da consulta COFFEE — a ficha não pode repeti-lo.
    const note = nota({ id: '355617' });
    const dados = consulta({
      observacao: 'Poste inclinado único',
      referencia_eletrica: 'ELE-99',
      referencia_fisica: 'FIS-99',
      alimentador: 'AFC99',
      id_sap: 999999,
      campos: {
        observacao: 'Poste inclinado único',
        referencia_eletrica: 'ELE-99',
        referencia_fisica: 'FIS-99',
        alimentador: 'AFC99',
        id_sap: 999999,
        cidade_extra: 'Vitoria',
      },
    });
    const html = renderDetail(note, dados);

    // Alimentador também aparece dentro de `AlimentadorCorrection` (widget de
    // correção, fora do escopo desta tarefa) como "valor atual" — igual ao
    // que já acontece com local de instalação em `LocalInstalacaoCorrection`.
    // Não é a duplicação-bug (campos crus repetidos na ficha adicional).
    for (const marcador of ['Poste inclinado único', 'ELE-99', 'FIS-99', '999999']) {
      const primeira = html.indexOf(marcador);
      const ultima = html.lastIndexOf(marcador);
      expect(primeira, `${marcador} deveria aparecer`).toBeGreaterThan(-1);
      expect(ultima, `${marcador} apareceu mais de uma vez`).toBe(primeira);
    }
    expect(html).toContain('AFC99');
    // campo extra sem correspondente no resumo principal continua na ficha adicional.
    expect(html).toContain('Vitoria');
  });

  it('campos já mostrados no bloco principal por dado da própria nota (poste, local, problema) não vazam pra ficha', () => {
    const note = nota({ id: '355617', poste: 'P1', local_instalacao: 'ABC-10', problema: 'Problema' });
    const dados = consulta({
      campos: {
        poste: 'valor-cru-poste-nao-deve-aparecer',
        local_instalacao: 'valor-cru-local-nao-deve-aparecer',
        problema: 'valor-cru-problema-nao-deve-aparecer',
      },
    });
    const html = renderDetail(note, dados);

    expect(html).not.toContain('valor-cru-poste-nao-deve-aparecer');
    expect(html).not.toContain('valor-cru-local-nao-deve-aparecer');
    expect(html).not.toContain('valor-cru-problema-nao-deve-aparecer');
    // o bloco principal segue mostrando o valor da própria nota.
    expect(html.match(/>P1</g)?.length).toBe(1);
  });
});

describe('Detail — copiar código de equipamento da referência elétrica', () => {
  beforeEach(() => {
    vi.spyOn(EDPApi, 'consultarNota').mockResolvedValue(consulta());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mostra botão de copiar pro equipamento reconhecido no texto', () => {
    const note = nota({ id: '355617' });
    const tipos: TipoEquipamento[] = [{ id: 'FF', descricao: '' }];
    const html = renderDetail(note, consulta({ referencia_eletrica: 'INSTALAR RL (NA) EM FF-655816' }), tipos);
    expect(html).toContain('00655816');
  });

  it('não mostra botão quando o tipo de equipamento não é reconhecido', () => {
    const note = nota({ id: '355617' });
    const html = renderDetail(note, consulta({ referencia_eletrica: 'INSTALAR RL (NA) EM FF-655816' }), []);
    expect(html).not.toContain('00655816');
  });
});
