import type { AbaInput } from './types';

// Módulo leve, sem imports de UI: o sidebar importa daqui sem puxar o
// input-section para o bundle inicial.
export const INPUT_SUBS: { id: AbaInput; rotulo: string }[] = [
  { id: 'visao', rotulo: 'Notas Gerais' },
  { id: 'ramal', rotulo: 'Ramal' },
  { id: 'relatorios', rotulo: 'Relatórios' },
  { id: 'logs', rotulo: 'Logs' },
  { id: 'config', rotulo: 'Configurações' },
];
