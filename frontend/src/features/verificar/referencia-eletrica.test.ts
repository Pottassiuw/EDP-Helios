import { describe, expect, it } from 'vitest';

import { extrairEquipamentos } from './referencia-eletrica';

const tipos = [
  { id: 'FF', descricao: '' },
  { id: 'RL', descricao: '' },
  { id: 'TD', descricao: 'Transformador' },
];

describe('extrairEquipamentos', () => {
  it('extrai tipo e código de 8 dígitos de um texto livre', () => {
    expect(extrairEquipamentos('INSTALAR RL (NA) EM FF-655816', tipos)).toEqual([
      { tipo: 'FF', descricao: '', codigo: '00655816' },
    ]);
  });

  it('completa com zeros à esquerda até 8 dígitos', () => {
    expect(extrairEquipamentos('TD-42', tipos)).toEqual([
      { tipo: 'TD', descricao: 'Transformador', codigo: '00000042' },
    ]);
  });

  it('retorna múltiplos equipamentos quando o texto cita mais de um', () => {
    expect(extrairEquipamentos('TROCAR TD-100 E FF-200', tipos)).toEqual([
      { tipo: 'TD', descricao: 'Transformador', codigo: '00000100' },
      { tipo: 'FF', descricao: '', codigo: '00000200' },
    ]);
  });

  it('ignora menção de tipo sem número junto', () => {
    expect(extrairEquipamentos('INSTALAR RL (NA)', tipos)).toEqual([]);
  });

  it('ignora prefixo que não está na lista de tipos válidos', () => {
    expect(extrairEquipamentos('XX-123456', tipos)).toEqual([]);
  });

  it('retorna vazio pra texto vazio, nulo ou sem tipos carregados', () => {
    expect(extrairEquipamentos('', tipos)).toEqual([]);
    expect(extrairEquipamentos(null, tipos)).toEqual([]);
    expect(extrairEquipamentos('FF-655816', [])).toEqual([]);
  });
});
