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
  const strVal = String(v).trim();
  const matchBR = strVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (matchBR) return Number(matchBR[3]);
  const matchISO = strVal.match(/^(\d{4})[-/](\d{1,2})/);
  if (matchISO) return Number(matchISO[1]);
  const d = typeof v === 'number' ? new Date(v) : new Date(strVal);
  return Number.isNaN(d.getTime()) ? null : d.getFullYear();
}

export function calcularSLA(n: NotaInput): SLADados {
  const planejadoVal = n.Mes_Execucao_Planejado;
  const realVal = n['Encerram.por data'];
  const hasRealDate = Boolean(realVal && realVal !== '-' && realVal !== '' && realVal !== 'None' && realVal !== 'nan');
  const executada = n.Ordem_Executada === 'SIM' || String(n.Status_Nota ?? '').startsWith('99') || hasRealDate;

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
    const strVal = String(realVal).trim();
    const matchBR = strVal.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const matchISO = strVal.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (matchBR) {
      anoReal = Number(matchBR[3]);
      mesReal = Number(matchBR[2]);
    } else if (matchISO) {
      anoReal = Number(matchISO[1]);
      mesReal = Number(matchISO[2]);
    } else {
      const d = typeof realVal === 'number' ? new Date(realVal) : new Date(strVal);
      if (!Number.isNaN(d.getTime())) {
        anoReal = d.getFullYear();
        mesReal = d.getMonth() + 1;
      } else {
        return { nota: n, statusSLA: 'Dados Insuficientes', desvio: null, textoDesvio: 'Data Encerramento Inválida' };
      }
    }
  }

  const desvio = (anoReal - anoPlan) * 12 + (mesReal - mesPlanParsed);

  if (isPending) {
    if (desvio > 1) {
      return { nota: n, statusSLA: 'Pendente Atrasado', desvio, textoDesvio: `Pendente Atrasado (${desvio}m)` };
    }
    return { nota: n, statusSLA: 'Pendente No Prazo', desvio: desvio <= 0 ? 0 : desvio, textoDesvio: 'Pendente (No Prazo)' };
  } else {
    if (desvio < 0) {
      return { nota: n, statusSLA: 'Adiantado', desvio, textoDesvio: `Adiantado (${Math.abs(desvio)}m)` };
    }
    if (desvio === 0) {
      return { nota: n, statusSLA: 'No Prazo', desvio: 0, textoDesvio: 'No Prazo' };
    }
    if (desvio === 1) {
      return { nota: n, statusSLA: 'No Prazo', desvio: 1, textoDesvio: 'No Prazo (+1m tolerância)' };
    }
    return { nota: n, statusSLA: 'Atrasado', desvio, textoDesvio: `Executado com atraso (${desvio}m)` };
  }
}
