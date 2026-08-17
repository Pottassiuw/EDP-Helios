import { describe, expect, it } from 'vitest';

import { anoEncerramento, calcularSLA } from './reports-lib';
import type { NotaInput } from './types';

function criarNota(overrides: Partial<NotaInput> = {}): NotaInput {
  return {
    Numero_Nota: 700500,
    Mes_Execucao_Planejado: 'jan-2026',
    'Encerram.por data': '-',
    Ordem_Executada: null,
    Status_Nota: 'Em aberto',
    ...overrides,
  };
}

describe('anoEncerramento', () => {
  it('retorna null para valores vazios ou sentinela', () => {
    expect(anoEncerramento(null)).toBeNull();
    expect(anoEncerramento(undefined)).toBeNull();
    expect(anoEncerramento('-')).toBeNull();
    expect(anoEncerramento('')).toBeNull();
  });

  it('extrai o ano de uma data em texto', () => {
    expect(anoEncerramento('2026-01-15')).toBe(2026);
  });

  it('extrai o ano de um timestamp numérico', () => {
    expect(anoEncerramento(new Date('2026-06-15').getTime())).toBe(2026);
  });

  it('retorna null para texto que não é data', () => {
    expect(anoEncerramento('não-é-data')).toBeNull();
  });
});

describe('calcularSLA', () => {
  it('marca como Sem Planejamento quando não há mês planejado', () => {
    const r = calcularSLA(criarNota({ Mes_Execucao_Planejado: '-' }));
    expect(r.statusSLA).toBe('Sem Planejamento');
    expect(r.desvio).toBeNull();
  });

  it('marca como Dados Insuficientes quando o planejado não tem o formato mês-ano', () => {
    const r = calcularSLA(criarNota({ Mes_Execucao_Planejado: '2026' }));
    expect(r.statusSLA).toBe('Dados Insuficientes');
    expect(r.textoDesvio).toBe('Planejado Inválido');
  });

  it('marca como Dados Insuficientes quando o mês do planejado é desconhecido', () => {
    const r = calcularSLA(criarNota({ Mes_Execucao_Planejado: 'xxx-2026' }));
    expect(r.statusSLA).toBe('Dados Insuficientes');
    expect(r.textoDesvio).toBe('Mês/Ano Inválido');
  });

  it('nota pendente (não executada) com planejado distante no futuro fica Pendente No Prazo', () => {
    const r = calcularSLA(criarNota({ Mes_Execucao_Planejado: 'jan-2999', Ordem_Executada: null }));
    expect(r.statusSLA).toBe('Pendente No Prazo');
    expect(r.desvio).toBe(0);
  });

  it('nota pendente (não executada) com planejado distante no passado fica Pendente Atrasado', () => {
    const r = calcularSLA(criarNota({ Mes_Execucao_Planejado: 'jan-2000', Ordem_Executada: null }));
    expect(r.statusSLA).toBe('Pendente Atrasado');
    expect(r.desvio).toBeGreaterThan(0);
  });

  it('nota executada sem data de encerramento fica Dados Insuficientes', () => {
    const r = calcularSLA(criarNota({ Ordem_Executada: 'SIM', 'Encerram.por data': '-' }));
    expect(r.statusSLA).toBe('Dados Insuficientes');
    expect(r.textoDesvio).toBe('Sem Data Encerramento');
  });

  it('nota executada com data de encerramento inválida fica Dados Insuficientes', () => {
    const r = calcularSLA(criarNota({ Ordem_Executada: 'SIM', 'Encerram.por data': 'não-é-data' }));
    expect(r.statusSLA).toBe('Dados Insuficientes');
    expect(r.textoDesvio).toBe('Data Encerramento Inválida');
  });

  it('nota executada no mesmo mês/ano do planejado fica No Prazo', () => {
    const r = calcularSLA(criarNota({
      Mes_Execucao_Planejado: 'jan-2026', Ordem_Executada: 'SIM', 'Encerram.por data': '2026-01-15',
    }));
    expect(r.statusSLA).toBe('No Prazo');
    expect(r.desvio).toBe(0);
  });

  it('nota executada antes do planejado fica Adiantado', () => {
    const r = calcularSLA(criarNota({
      Mes_Execucao_Planejado: 'mar-2026', Ordem_Executada: 'SIM', 'Encerram.por data': '2026-01-15',
    }));
    expect(r.statusSLA).toBe('Adiantado');
    expect(r.desvio).toBe(-2);
    expect(r.textoDesvio).toBe('Antecipado (2m)');
  });

  it('nota executada depois do planejado fica Atrasado', () => {
    const r = calcularSLA(criarNota({
      Mes_Execucao_Planejado: 'jan-2026', Ordem_Executada: 'SIM', 'Encerram.por data': '2026-03-15',
    }));
    expect(r.statusSLA).toBe('Atrasado');
    expect(r.desvio).toBe(2);
    expect(r.textoDesvio).toBe('Atrasado (2m)');
  });

  it('aceita data de encerramento no formato brasileiro DD/MM/YYYY', () => {
    const r = calcularSLA(criarNota({
      Mes_Execucao_Planejado: 'mar-2026', Ordem_Executada: 'SIM', 'Encerram.por data': '25/03/2026',
    }));
    expect(r.statusSLA).toBe('No Prazo');
    expect(r.desvio).toBe(0);
  });

  it('Status_Nota começando com 99 conta como executada mesmo sem Ordem_Executada=SIM', () => {
    const r = calcularSLA(criarNota({
      Mes_Execucao_Planejado: 'jan-2026', Status_Nota: '99 Encerrado', 'Encerram.por data': '2026-01-15',
    }));
    expect(r.statusSLA).toBe('No Prazo');
  });
});
