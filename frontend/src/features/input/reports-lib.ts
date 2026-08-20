import type { Celula, NotaInput } from './types';

const MESES_REV: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, maio: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

export interface SLADados {
  nota: NotaInput;
  statusSLA: 'No Prazo' | 'Adiantado' | 'Atrasado' | 'Pendente Atrasado' | 'Pendente No Prazo' | 'Sem Planejamento' | 'Dados Insuficientes';
  desvio: number | null;
  textoDesvio: string;
}

export function anoEncerramento(v: Celula | undefined): number | null {
  if (v === null || v === undefined || v === '-' || v === '') return null;
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}

export function calcularSLA(n: NotaInput): SLADados {
  const planejadoVal = n.Mes_Execucao_Planejado;
  const realVal = n['Encerram.por data'];
  const executada = n.Ordem_Executada === 'SIM' || String(n.Status_Nota ?? '').startsWith('99');

  if (!planejadoVal || planejadoVal === '-' || planejadoVal === '') {
    return { nota: n, statusSLA: 'Sem Planejamento', desvio: null, textoDesvio: 'Sem Planejamento' };
  }
  const partesPlan = String(planejadoVal).split('-');
  if (partesPlan.length !== 2) {
    return { nota: n, statusSLA: 'Dados Insuficientes', desvio: null, textoDesvio: 'Planejado Inválido' };
  }
  const mesPlanParsed = MESES_REV[partesPlan[0].toLowerCase()] || null;
  const anoPlan = Number(partesPlan[1]);
  if (!mesPlanParsed || !Number.isFinite(anoPlan)) {
    return { nota: n, statusSLA: 'Dados Insuficientes', desvio: null, textoDesvio: 'Mês/Ano Inválido' };
  }

  let anoReal = 0;
  let mesReal = 0;
  let isPending = !executada;

  if (isPending) {
    const hoje = new Date();
    anoReal = hoje.getFullYear();
    mesReal = hoje.getMonth() + 1;
  } else {
    if (!realVal || realVal === '-' || realVal === '') {
      return { nota: n, statusSLA: 'Dados Insuficientes', desvio: null, textoDesvio: 'Sem Data Encerramento' };
    }
    const d = typeof realVal === 'number' ? new Date(realVal) : new Date(String(realVal));
    if (Number.isNaN(d.getTime())) {
      const strVal = String(realVal).trim();
      const matchISO = strVal.match(/^(\d{4})-(\d{2})-(\d{2})/);
      const matchBR = strVal.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (matchISO) {
        anoReal = Number(matchISO[1]);
        mesReal = Number(matchISO[2]);
      } else if (matchBR) {
        anoReal = Number(matchBR[3]);
        mesReal = Number(matchBR[2]);
      } else {
        return { nota: n, statusSLA: 'Dados Insuficientes', desvio: null, textoDesvio: 'Data Encerramento Inválida' };
      }
    } else {
      anoReal = d.getFullYear();
      mesReal = d.getMonth() + 1;
    }
  }

  const desvio = (anoReal - anoPlan) * 12 + (mesReal - mesPlanParsed);

  if (isPending) {
    if (desvio > 0) {
      return { nota: n, statusSLA: 'Pendente Atrasado', desvio, textoDesvio: `Atrasado pendente (${desvio}m)` };
    }
    return { nota: n, statusSLA: 'Pendente No Prazo', desvio: 0, textoDesvio: 'Pendente (No Prazo)' };
  } else {
    if (desvio === 0) {
      return { nota: n, statusSLA: 'No Prazo', desvio: 0, textoDesvio: 'No Prazo' };
    }
    if (desvio === 1) {
      return { nota: n, statusSLA: 'No Prazo', desvio: 1, textoDesvio: 'No Prazo (+1m tolerância)' };
    }
    if (desvio < 0) {
      return { nota: n, statusSLA: 'Adiantado', desvio, textoDesvio: `Antecipado (${Math.abs(desvio)}m)` };
    }
    return { nota: n, statusSLA: 'Atrasado', desvio, textoDesvio: `Atrasado (${desvio}m)` };
  }
}
