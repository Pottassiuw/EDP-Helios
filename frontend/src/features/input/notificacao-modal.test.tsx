import { describe, expect, it } from 'vitest';
import type { ResumoNotificacoesDiarias } from './types';

describe('NotificacaoModal e Resumo Diário', () => {
  it('estrutura corretamente os dados de resumo diário por engenheiro', () => {
    const mockResumo: ResumoNotificacoesDiarias = {
      data_referencia: '2026-08-14',
      total_alteracoes: 3,
      total_notas_afetadas: 2,
      engenheiros: {
        James: {
          engenheiro: 'James',
          email: 'james.junior@edp.com',
          regionais: ['Guarulhos', 'São José dos Campos'],
          total_alteracoes: 2,
          total_notas_afetadas: 1,
          notas_afetadas: [14118256],
          alteracoes: [
            {
              ID_Log: 1,
              Numero_Nota: 14118256,
              Regional: 'Guarulhos',
              Conjunto: 'POSTES',
              Circuito: 'GUA-01',
              Tipo_Evento: 'Edição de Campo',
              Campo_Alterado: 'Planejado_DDPM',
              Valor_Antigo: '5.0',
              Valor_Novo: '4.0',
              Detalhe: "Planejado_DDPM: '5.0' ➔ '4.0'",
              Usuario: 'felip',
              Data_Hora: '2026-08-14 10:30:00',
            },
          ],
        },
        Danilo: {
          engenheiro: 'Danilo',
          email: 'danilop.vilela@edp.com',
          regionais: ['Suzano', 'Poa', 'Litoral Norte'],
          total_alteracoes: 1,
          total_notas_afetadas: 1,
          notas_afetadas: [16958288],
          alteracoes: [],
        },
        Fabricio: {
          engenheiro: 'Fabricio',
          email: 'fabricio.viana@edp.com',
          regionais: ['Mogi das Cruzes'],
          total_alteracoes: 0,
          total_notas_afetadas: 0,
          notas_afetadas: [],
          alteracoes: [],
        },
      },
    };

    expect(mockResumo.total_alteracoes).toBe(3);
    expect(mockResumo.engenheiros.James.total_alteracoes).toBe(2);
    expect(mockResumo.engenheiros.Fabricio.total_alteracoes).toBe(0);
    expect(mockResumo.engenheiros.James.email).toBe('james.junior@edp.com');
  });
});
