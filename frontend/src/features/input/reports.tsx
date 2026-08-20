import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InputDataset, NotaInput, Status10Registro } from './types';
import { InputApi, baixarBlob } from './api';
import { toast } from 'sonner';
import { valoresUnicos, formatarNumero } from './lib';
import type { ColunaDef } from './columns';
import { NotesTable } from './notes-table';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionPage } from '@/components/branded/section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { MultiSelect } from './filters';
import { Bot, Info, Loader2, Mail, RefreshCw } from 'lucide-react';
import { anoEncerramento, calcularSLA } from './reports-lib';

/** Cores do "semáforo" e indicadores de aderência. */
const CORES_AUDITORIA: Record<string, string> = {
  '🟢 No Prazo': 'var(--green)',
  '🔵 Adiantado': 'var(--blue)',
  '🟠 Executado com atraso': 'var(--amber)',
  '🔴 Pendente Atrasado': 'var(--red)',
  '🟢 Adiantado': 'var(--blue)',
  '🔵 No Prazo': 'var(--green)',
  '🔴 Com Atraso': 'var(--amber)',
  '🟣 Fora do Plano': 'var(--indigo)',
  '⚠️ Passível de Encerramento': 'var(--amber)',
  '⚪ Em Andamento (No Prazo)': 'var(--text-dim)',
  '⚪ Sem Planejamento': 'var(--text-mute)',
  '⏳Sem Data SAP': 'var(--red)',
  '⚠️ Data SAP Inválida': 'var(--text-dim)',
  '⚠️ Sem Mês Planejado Válido': 'var(--amber)',
  '⚠️ Erro na Análise': 'var(--text)',
};

const COLUNAS_AUDITORIA: ColunaDef[] = [
  { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
  { key: 'Regional', label: 'Regional' },
  { key: 'Conjunto', label: 'Conjunto' },
  { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
  { key: 'Encerram.por data', label: 'Data Encerramento SAP', largura: 160 },
  { key: 'Auditoria_Cronograma', label: 'Auditoria Cronograma', largura: 170 },
  { key: 'Desvio_SLA', label: 'Status SLA / Desvio', largura: 180 },
  { key: 'Status_Nota', label: 'Status Nota', largura: 160 },
  { key: 'Ordem_Executada', label: 'Ordem Exec.' },
  { key: 'Prioridade_Nota', label: 'Prioridade' },
  { key: 'Planejado_DDPM', label: 'Físico Planejado', numeric: true },
];

const FILTROS_RAPIDOS = [
  '(Nenhum)',
  '🟢 No Prazo',
  '🔵 Adiantado',
  '🟠 Executado com atraso',
  '🔴 Pendente Atrasado',
  '⚠️ Passível de Encerramento',
  'Em Andamento',
  'Encerradas',
  'Ordem Executada (SAP)',
] as const;


interface FatiaRosca {
  rotulo: string;
  qtd: number;
  cor: string;
}

function Rosca({ fatias }: { fatias: FatiaRosca[] }): React.JSX.Element {
  const total = fatias.reduce((acc, f) => acc + f.qtd, 0);
  if (total === 0) return <div className="text-[12px] text-text-mute text-center py-4">Sem dados</div>;

  let acumulado = 0;
  const gradienteFatias = fatias.map((f) => {
    const inicio = (acumulado / total) * 100;
    acumulado += f.qtd;
    const fim = (acumulado / total) * 100;
    return `${f.cor} ${inicio.toFixed(2)}% ${fim.toFixed(2)}%`;
  });

  const backgroundConic = `conic-gradient(${gradienteFatias.join(', ')})`;

  return (
    <div className="flex items-center gap-[24px]">
      <div
        className="w-[120px] h-[120px] rounded-full shrink-0 relative flex items-center justify-center shadow-inner"
        style={{ background: backgroundConic }}
      >
        <div className="w-[76px] h-[76px] rounded-full bg-surface flex flex-col items-center justify-center border border-line shadow-xs">
          <span className="text-[10px] text-text-mute uppercase tracking-wider font-medium">Total</span>
          <span className="text-[15px] font-mono font-medium text-text">{total}</span>
        </div>
      </div>

      <div className="flex flex-col gap-[6px] flex-1 max-h-[140px] overflow-y-auto pr-[4px]">
        <span className="text-[11px] font-medium text-text-dim uppercase tracking-wider font-sans border-b border-line-2 pb-[3px]">
          Distribuição dos Prazos
        </span>
        {fatias.map((f) => {
          const percentual = ((f.qtd / total) * 100).toFixed(1);
          return (
            <div key={f.rotulo} className="flex justify-between items-center font-sans border-b border-line-2/40 pb-[4px]">
              <span className="flex items-center text-text-dim text-[12px]">
                <span
                  className="inline-block w-[8px] h-[8px] rounded-full mr-[8px] shrink-0"
                  style={{ background: f.cor }}
                />
                {f.rotulo}
              </span>
              <span className="font-mono text-text">
                <strong>{f.qtd}</strong>
                <span className="text-text-mute text-[10px] ml-[4px]">({percentual}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type TabRelatorio = 'prazos' | 'financas' | 'planejamento';

const TABS_RELATORIOS = [
  { id: 'prazos', rotulo: 'Aderência ao Plano' },
  { id: 'financas', rotulo: 'Visão Financeira (Custos)' },
  { id: 'planejamento', rotulo: 'Em Planejamento (Status 10)' },
];


import type { FiltersState } from './filters';
import { filtrarRegistros } from './overview';

export function Reports({
  dados,
  estadoFiltros,
}: {
  dados: InputDataset;
  estadoFiltros?: FiltersState;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<TabRelatorio>('prazos');

  const registrosBase = React.useMemo(() => {
    if (!estadoFiltros) return dados.registros;
    return filtrarRegistros(dados.registros, estadoFiltros);
  }, [dados.registros, estadoFiltros]);

  // --- FILTROS ABA PRAZOS & ADERÊNCIA (SLA) ---
  const [rapido, setRapido] = React.useState<(typeof FILTROS_RAPIDOS)[number]>('(Nenhum)');
  const [fAnos, setFAnos] = React.useState<string[]>([]);
  const [fMesesPlan, setFMesesPlan] = React.useState<string[]>([]);
  const [fStatus, setFStatus] = React.useState<string[]>([]);
  const [fSlaStatus, setFSlaStatus] = React.useState<string[]>([]);
  const [fRegional, setFRegional] = React.useState<string[]>([]);

  // --- FILTROS ABA FINANÇAS ---
  const [finMeses, setFinMeses] = React.useState<string[]>([]);
  const [finRegionais, setFinRegionais] = React.useState<string[]>([]);
  const [finStatus, setFinStatus] = React.useState<string[]>([]);

  // --- FILTROS ABA PLANEJAMENTO (STATUS 10) ---
  const [planMeses, setPlanMeses] = React.useState<string[]>([]);
  const [planRegionais, setPlanRegionais] = React.useState<string[]>([]);
  const [planPrioridades, setPlanPrioridades] = React.useState<string[]>([]);

  const [exportando, setExportando] = React.useState(false);
  const [enviandoEmailSt10, setEnviandoEmailSt10] = React.useState(false);
  const [extraindoSapSt10, setExtraindoSapSt10] = React.useState(false);

  // Status 10 Enriquecido do Backend
  const status10Query = useQuery({
    queryKey: ['input-status10-resumo'],
    queryFn: InputApi.obterStatus10Resumo,
    staleTime: 60000,
  });

  const dispararExtracaoSapStatus10 = async (): Promise<void> => {
    setExtraindoSapSt10(true);
    try {
      const res = await InputApi.extrairSapStatus10();
      toast.success('Extração SAP Concluída', { description: res.mensagem });
      await queryClient.invalidateQueries({ queryKey: ['input-status10-resumo'] });
      await queryClient.invalidateQueries({ queryKey: ['input-dataset'] });
    } catch (e) {
      toast.error('Falha na extração SAP de Status 10', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setExtraindoSapSt10(false);
    }
  };

  const dispararEmailStatus10 = async (): Promise<void> => {
    setEnviandoEmailSt10(true);
    try {
      const res = await InputApi.enviarEmailStatus10();
      if (res.ok) {
        toast.success(res.mensagem);
      } else {
        toast.error('Erro ao gerar e-mail', { description: res.mensagem });
      }
    } catch (e) {
      toast.error('Falha no envio de e-mail', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setEnviandoEmailSt10(false);
    }
  };

  // --- PROCESSAMENTO DADOS: PRAZOS & ADERÊNCIA (SLA) ---
  const auditadas = React.useMemo(() => {
    let r: NotaInput[] = registrosBase.map((n) => {
      const sla = calcularSLA(n);
      return {
        ...n,
        Desvio_SLA: sla.textoDesvio,
        Status_SLA: sla.statusSLA,
        Desvio_Numero: sla.desvio,
      };
    });

    if (rapido === '⚠️ Passível de Encerramento') {
      r = r.filter((n) => n.Status_Nota !== '99 Encerrado' && n.Ordem_Executada === 'SIM');
    } else if (rapido === 'Em Andamento') {
      r = r.filter((n) => n.Status_Nota !== '99 Encerrado');
    } else if (rapido === 'Encerradas') {
      r = r.filter((n) => n.Status_Nota === '99 Encerrado');
    } else if (rapido === 'Ordem Executada (SAP)') {
      r = r.filter((n) => n.Ordem_Executada === 'SIM');
    } else if (rapido === '🟢 No Prazo') {
      r = r.filter((n) => n.Auditoria_Cronograma === '🟢 No Prazo' || n.Auditoria_Cronograma === '🔵 No Prazo' || n.Status_SLA === 'No Prazo');
    } else if (rapido === '🔵 Adiantado') {
      r = r.filter((n) => n.Auditoria_Cronograma === '🔵 Adiantado' || n.Auditoria_Cronograma === '🟢 Adiantado' || n.Status_SLA === 'Adiantado');
    } else if (rapido === '🟠 Executado com atraso') {
      r = r.filter((n) => n.Auditoria_Cronograma === '🟠 Executado com atraso' || n.Auditoria_Cronograma === '🔴 Com Atraso' || n.Status_SLA === 'Atrasado');
    } else if (rapido === '🔴 Pendente Atrasado') {
      r = r.filter((n) => n.Auditoria_Cronograma === '🔴 Pendente Atrasado' || n.Status_SLA === 'Pendente Atrasado');
    }

    if (fAnos.length) r = r.filter((n) => fAnos.includes(String(anoEncerramento(n['Encerram.por data']) ?? '')));
    if (fMesesPlan.length) r = r.filter((n) => fMesesPlan.includes(String(n.Mes_Execucao_Planejado ?? '')));
    if (fStatus.length) r = r.filter((n) => fStatus.includes(String(n.Auditoria_Cronograma ?? '')));
    if (fSlaStatus.length) r = r.filter((n) => fSlaStatus.includes(String(n.Status_SLA ?? '')));
    if (fRegional.length) r = r.filter((n) => fRegional.includes(String(n.Regional ?? '')));

    return r;
  }, [registrosBase, rapido, fAnos, fMesesPlan, fStatus, fSlaStatus, fRegional]);

  const contagens = React.useMemo(() => {
    const mapa = new Map<string, number>();
    auditadas.forEach((n) => {
      const k = String(n.Auditoria_Cronograma ?? '—');
      mapa.set(k, (mapa.get(k) ?? 0) + 1);
    });
    return mapa;
  }, [auditadas]);

  const anosDisponiveis = React.useMemo(() => {
    const anos = new Set<string>();
    registrosBase.forEach((n) => {
      const a = anoEncerramento(n['Encerram.por data']);
      if (a) anos.add(String(a));
    });
    return [...anos].sort().reverse();
  }, [registrosBase]);

  const kpisSLA = React.useMemo(() => {
    let concluidas = 0;
    let concluidasNoPrazoOuAdiantadas = 0;
    let somaDesviosConcluidas = 0;
    let atrasoAcumuladoMeses = 0;
    let totalNotasComAtrasoReal = 0;
    let pendentesAtrasadas = 0;
    let adiantadasQtd = 0;
    let noPrazoQtd = 0;
    let comAtrasoQtd = 0;

    auditadas.forEach((item) => {
      const d = typeof item.Desvio_Numero === 'number' ? item.Desvio_Numero : null;
      if (d !== null && d > 0) {
        atrasoAcumuladoMeses += d;
        totalNotasComAtrasoReal += 1;
      }

      if (item.Status_SLA === 'No Prazo' || item.Status_SLA === 'Adiantado' || item.Status_SLA === 'Atrasado') {
        concluidas += 1;
        if (item.Status_SLA === 'Adiantado') {
          adiantadasQtd += 1;
          concluidasNoPrazoOuAdiantadas += 1;
        } else if (item.Status_SLA === 'No Prazo') {
          noPrazoQtd += 1;
          concluidasNoPrazoOuAdiantadas += 1;
        } else if (item.Status_SLA === 'Atrasado') {
          comAtrasoQtd += 1;
        }
        if (d !== null) somaDesviosConcluidas += d;
      } else if (item.Status_SLA === 'Pendente Atrasado') {
        pendentesAtrasadas += 1;
      }
    });

    const indexAderencia = concluidas > 0 ? (concluidasNoPrazoOuAdiantadas / concluidas) * 100 : 0;
    const mediaDesvio = concluidas > 0 ? somaDesviosConcluidas / concluidas : 0;

    return {
      indexAderencia,
      mediaDesvio,
      atrasoAcumuladoMeses,
      totalNotasComAtrasoReal,
      concluidas,
      adiantadasQtd,
      noPrazoQtd,
      comAtrasoQtd,
      pendentesAtrasadas,
    };
  }, [auditadas]);

  const distSLA = React.useMemo(() => {
    const contagem: Record<string, number> = {
      'Adiantado': 0,
      'No Prazo (Exato)': 0,
      'Tolerância (+1 mês)': 0,
      'Atrasado (2 meses)': 0,
      'Atrasado (3+ meses)': 0,
      'Pendente Atrasado (≥2m)': 0,
      'Outros/Sem Planejamento': 0,
    };

    auditadas.forEach((item) => {
      const d = item.Desvio_Numero;
      if (item.Status_SLA === 'Adiantado') {
        contagem['Adiantado'] += 1;
      } else if (item.Status_SLA === 'No Prazo') {
        if (d === 0) contagem['No Prazo (Exato)'] += 1;
        else if (d === 1) contagem['Tolerância (+1 mês)'] += 1;
        else contagem['No Prazo (Exato)'] += 1;
      } else if (item.Status_SLA === 'Atrasado') {
        if (d === 2) contagem['Atrasado (2 meses)'] += 1;
        else contagem['Atrasado (3+ meses)'] += 1;
      } else if (item.Status_SLA === 'Pendente Atrasado') {
        contagem['Pendente Atrasado (≥2m)'] += 1;
      } else {
        contagem['Outros/Sem Planejamento'] += 1;
      }
    });

    return Object.entries(contagem);
  }, [auditadas]);

  const kpisPrincipais = [
    {
      rotulo: 'Índice de Aderência',
      valor: `${kpisSLA.indexAderencia.toFixed(1)}%`,
      cor: 'text-green',
      sub: 'No Prazo (+1m) + Adiantadas',
    },
    {
      rotulo: 'Atraso Acumulado',
      valor: `+${kpisSLA.atrasoAcumuladoMeses.toLocaleString('pt-BR')} m`,
      cor: 'text-red',
      sub: `${kpisSLA.totalNotasComAtrasoReal.toLocaleString('pt-BR')} notas c/ atraso`,
    },
    {
      rotulo: 'Média de Desvio Real',
      valor: `${kpisSLA.mediaDesvio >= 0 ? '+' : ''}${kpisSLA.mediaDesvio.toFixed(1)} m`,
      cor: 'text-text',
      sub: 'Desvio médio ponderado',
    },
    {
      rotulo: 'Total Auditadas',
      valor: auditadas.length.toLocaleString('pt-BR'),
      cor: 'text-text',
      sub: 'Volume no filtro atual',
    },
  ];

  const totalPassiveis = contagens.get('⚠️ Passível de Encerramento') ?? 0;

  const statusPills: Array<{
    label: string;
    qtd: number;
    filtro: (typeof FILTROS_RAPIDOS)[number];
    corBadge: string;
    dot: string;
  }> = [
    {
      label: 'No Prazo (+1m)',
      qtd: kpisSLA.noPrazoQtd,
      filtro: '🟢 No Prazo',
      corBadge: 'bg-green/10 text-green border-green/30 hover:bg-green/20',
      dot: '🟢',
    },
    {
      label: 'Adiantadas',
      qtd: kpisSLA.adiantadasQtd,
      filtro: '🔵 Adiantado',
      corBadge: 'bg-blue-500/10 text-blue-500 border-blue-500/30 hover:bg-blue-500/20',
      dot: '🔵',
    },
    {
      label: 'Executado com Atraso',
      qtd: kpisSLA.comAtrasoQtd,
      filtro: '🟠 Executado com atraso',
      corBadge: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20',
      dot: '🟠',
    },
    {
      label: 'Pendentes Atrasadas',
      qtd: kpisSLA.pendentesAtrasadas,
      filtro: '🔴 Pendente Atrasado',
      corBadge: 'bg-red/10 text-red border-red/30 hover:bg-red/20',
      dot: '🔴',
    },
    {
      label: 'Passíveis Encerramento',
      qtd: totalPassiveis,
      filtro: '⚠️ Passível de Encerramento',
      corBadge: 'bg-bg-2 text-text-dim border-line-2 hover:bg-surface-3 hover:text-text',
      dot: '⚠️',
    },
  ];

  const fatias: FatiaRosca[] = [...contagens.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rotulo, qtd]) => ({ rotulo, qtd, cor: CORES_AUDITORIA[rotulo] ?? 'var(--text-mute)' }));

  // --- PROCESSAMENTO DADOS: FINANÇAS ---
  const registrosFinancas = React.useMemo(() => {
    let r = registrosBase;
    if (finMeses.length) r = r.filter((n) => finMeses.includes(String(n.Mes_Execucao_Planejado ?? '')));
    if (finRegionais.length) r = r.filter((n) => finRegionais.includes(String(n.Regional ?? '')));
    if (finStatus.length) r = r.filter((n) => finStatus.includes(String(n.Status_Nota ?? '')));
    return r;
  }, [registrosBase, finMeses, finRegionais, finStatus]);

  const totaisFinancas = React.useMemo(() => {
    let totalFisico = 0;
    let totalModular = 0;
    let totalOrdemPlan = 0;
    let totalOrdemReal = 0;
    let emPlanejamento = 0;
    let emExecucao = 0;
    let executado = 0;

    registrosFinancas.forEach((n) => {
      const fisico = Number(n.Planejado_DDPM) || 0;
      const modUnit = Number(n.Modular) || 0;
      const modTot = Number(n.Total_planejado_modular) || (fisico * modUnit) || 0;
      const ordPlan = Number(n.Total_planejado_ordem) || 0;
      const ordReal = Number(n.Total_real_ordem) || 0;

      totalFisico += fisico;
      totalModular += modTot;
      totalOrdemPlan += ordPlan;
      totalOrdemReal += ordReal;

      const statusStr = String(n.Status_Nota ?? '');
      if (statusStr.startsWith('10')) {
        emPlanejamento += modTot;
      } else if (
        statusStr.startsWith('11') ||
        statusStr.startsWith('47') ||
        statusStr.startsWith('51') ||
        statusStr.startsWith('52') ||
        statusStr.startsWith('53')
      ) {
        emExecucao += modTot;
      }
      if (n.Ordem_Executada === 'SIM' || statusStr.startsWith('54') || statusStr.startsWith('99')) {
        executado += (ordReal > 0 ? ordReal : modTot);
      }
    });

    return { totalFisico, totalModular, totalOrdemPlan, totalOrdemReal, emPlanejamento, emExecucao, executado };
  }, [registrosFinancas]);

  const distribuicaoRegionalFinancas = React.useMemo(() => {
    const mapa = new Map<string, { modular: number; fisico: number }>();
    registrosFinancas.forEach((n) => {
      const reg = String(n.Regional || 'Não Mapeado');
      const fisico = Number(n.Planejado_DDPM) || 0;
      const modTot = Number(n.Total_planejado_modular) || (fisico * (Number(n.Modular) || 0)) || 0;
      const cur = mapa.get(reg) ?? { modular: 0, fisico: 0 };
      mapa.set(reg, { modular: cur.modular + modTot, fisico: cur.fisico + fisico });
    });
    return [...mapa.entries()].sort((a, b) => b[1].modular - a[1].modular);
  }, [registrosFinancas]);

  const distribuicaoStatusFinancas = React.useMemo(() => {
    const mapa = new Map<string, number>();
    registrosFinancas.forEach((n) => {
      const status = String(n.Status_Nota || 'Sem Status');
      const fisico = Number(n.Planejado_DDPM) || 0;
      const modTot = Number(n.Total_planejado_modular) || (fisico * (Number(n.Modular) || 0)) || 0;
      mapa.set(status, (mapa.get(status) ?? 0) + modTot);
    });
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  }, [registrosFinancas]);

  // --- PROCESSAMENTO DADOS: PLANEJAMENTO (STATUS 10) ---
  const registrosPlanejamento = React.useMemo(() => {
    const st10Remoto = status10Query.data?.registros;
    let r: Status10Registro[] = [];

    if (st10Remoto && st10Remoto.length > 0) {
      r = st10Remoto.filter((n) => {
        const stSap = String(n.Status_Usuario ?? '').trim();
        const stNota = String(n.Status_Nota ?? '').trim();
        if (stSap.startsWith('51') || stSap.startsWith('50') || stSap.startsWith('99') || stSap.startsWith('55')) return false;
        if (stNota.startsWith('51') || stNota.startsWith('50') || stNota.startsWith('99') || stNota.startsWith('55')) return false;

        const mesPlan = String(n.Mes_Execucao_Planejado ?? '');
        const anoMatch = mesPlan.match(/\b(19\d\d|20\d\d|9999)\b/);
        if (anoMatch) {
          const ano = parseInt(anoMatch[1], 10);
          if (ano > 2026 || ano === 9999) return false;
        }
        return true;
      });
    } else {
      r = registrosBase
        .filter((n) => {
          const stFinal = String(n.Status_Final ?? '').trim();
          const stNota = String(n.Status_Nota ?? '').trim();
          const stSap = String(n.Export_status ?? '').trim();

          // Exclui notas que já estão em 51, 50, 99, 55 no SAP
          if (stSap.startsWith('51') || stSap.startsWith('50') || stSap.startsWith('99') || stSap.startsWith('55')) {
            return false;
          }
          if (stFinal.startsWith('51') || stFinal.startsWith('50') || stFinal.startsWith('99') || stFinal.startsWith('55')) {
            return false;
          }

          const eh10 = stFinal.startsWith('10') || stSap === '10' || (stFinal === 'Fora SAP' && stNota.startsWith('10')) || stNota.toUpperCase().includes('PLANEJAMENTO');
          if (!eh10) return false;

          // Filtra anos inválidos / sentinelas / futuros distantes (2027, 9999)
          const mesPlan = String(n.Mes_Execucao_Planejado ?? '');
          const anoMatch = mesPlan.match(/\b(19\d\d|20\d\d|9999)\b/);
          if (anoMatch) {
            const ano = parseInt(anoMatch[1], 10);
            if (ano > 2026 || ano === 9999) return false;
          }
          return true;
        })
        .map((n) => {
          const fisico = Number(n.Planejado_DDPM) || 0;
          const mod = Number(n.Modular) || 0;
          return {
            Numero_Nota: n.Numero_Nota,
            Ordem: n.Ordem,
            Status_Nota: n.Status_Final ?? n.Status_Nota,
            Status_Usuario: n.Status_Usuário_Ordem,
            Conjunto: n.Conjunto,
            Local_Instalacao: n.Local_Instalacao,
            Planejado_DDPM: fisico,
            Modular: mod,
            Modular_Obra: Number(n.Total_planejado_modular) || (fisico * mod) || 0,
            Custo_Plan: Number(n.Total_planejado_ordem) || 0,
            Mes_Execucao_Planejado: n.Mes_Execucao_Planejado,
            Prioridade_Nota: n.Prioridade_Nota,
            Regional: n.Regional,
            Centro_Responsavel: n.Centro_Responsavel,
            Observacao: n.Observacao,
          };
        });
    }

    if (planMeses.length) r = r.filter((n) => planMeses.includes(String(n.Mes_Execucao_Planejado ?? '')));
    if (planRegionais.length) r = r.filter((n) => planRegionais.includes(String(n.Regional ?? '')));
    if (planPrioridades.length) r = r.filter((n) => planPrioridades.includes(String(n.Prioridade_Nota ?? '')));
    return r;
  }, [status10Query.data?.registros, registrosBase, planMeses, planRegionais, planPrioridades]);

  const totaisPlanejamento = React.useMemo(() => {
    let totalFisico = 0;
    let totalModular = 0;
    let totalCustoOrdem = 0;
    let urgentesOuEmergentes = 0;
    const mapaRegional = new Map<string, { modular: number; fisico: number; qtd: number }>();
    const mapaPrioridade = new Map<string, { modular: number; qtd: number }>();

    registrosPlanejamento.forEach((n) => {
      const fisico = Number(n.Planejado_DDPM) || 0;
      const modObra = Number(n.Modular_Obra) || (fisico * (Number(n.Modular) || 0)) || 0;
      const ordPlan = Number(n.Custo_Plan) || 0;

      totalFisico += fisico;
      totalModular += modObra;
      totalCustoOrdem += ordPlan;

      const prio = String(n.Prioridade_Nota ?? '');
      if (prio === 'Emergente' || prio === 'Urgente' || prio === 'Prioritário') {
        urgentesOuEmergentes += 1;
      }

      const reg = String(n.Regional || 'Não Mapeado');
      const curReg = mapaRegional.get(reg) ?? { modular: 0, fisico: 0, qtd: 0 };
      mapaRegional.set(reg, {
        modular: curReg.modular + modObra,
        fisico: curReg.fisico + fisico,
        qtd: curReg.qtd + 1,
      });

      const curPrio = mapaPrioridade.get(prio) ?? { modular: 0, qtd: 0 };
      mapaPrioridade.set(prio, { modular: curPrio.modular + modObra, qtd: curPrio.qtd + 1 });
    });

    const distReg = [...mapaRegional.entries()].sort((a, b) => b[1].modular - a[1].modular);
    const distPrio = [...mapaPrioridade.entries()].sort((a, b) => b[1].qtd - a[1].qtd);

    return { totalFisico, totalModular, totalCustoOrdem, urgentesOuEmergentes, distReg, distPrio };
  }, [registrosPlanejamento]);

  // --- AÇÃO EXPORTAR ---
  async function exportar(): Promise<void> {
    setExportando(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      let colunasAlvo = COLUNAS_AUDITORIA;
      let registrosExport: Array<NotaInput | Status10Registro> = auditadas;
      let nomeArquivo = `Aderencia_ao_Plano_${stamp}.xlsx`;

      if (tab === 'financas') {
        colunasAlvo = [
          { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
          { key: 'Regional', label: 'Regional' },
          { key: 'Conjunto', label: 'Conjunto' },
          { key: 'Status_Nota', label: 'Status Nota' },
          { key: 'Planejado_DDPM', label: 'Físico Planejado (Postes)', numeric: true },
          { key: 'Modular', label: 'Modular Unitário (R$)', numeric: true },
          { key: 'Total_planejado_modular', label: 'Total Modular Planejado (R$)', numeric: true },
          { key: 'Total_planejado_ordem', label: 'Total Orçado Ordem (R$)', numeric: true },
          { key: 'Total_real_ordem', label: 'Total Real Ordem (R$)', numeric: true },
          { key: 'Ordem', label: 'Ordem' },
          { key: 'Status_Usuário_Ordem', label: 'Status Usuário' },
          { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
          { key: 'Observacao', label: 'Observação' },
        ];
        registrosExport = registrosFinancas;
        nomeArquivo = `Custos_Planejados_${stamp}.xlsx`;
      } else if (tab === 'planejamento') {
        colunasAlvo = [
          { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
          { key: 'Ordem', label: 'Ordem' },
          { key: 'Status_Usuario', label: 'Status Usuário' },
          { key: 'Conjunto', label: 'Conjunto' },
          { key: 'Denominacao_Conjunto', label: 'Denominação Conjunto' },
          { key: 'Local_Instalacao', label: 'Local Instalação' },
          { key: 'Planejado_DDPM', label: 'Físico Planejado', numeric: true },
          { key: 'Modular', label: 'Modular Unitário (R$)', numeric: true },
          { key: 'Modular_Obra', label: 'Modular Obra (R$)', numeric: true },
          { key: 'Custo_Plan', label: 'Custo Plan Ordem (R$)', numeric: true },
          { key: 'PEP', label: 'PEP' },
          { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
          { key: 'Prioridade_Nota', label: 'Prioridade' },
          { key: 'Regional', label: 'Regional' },
          { key: 'Centro_Responsavel', label: 'Centro Responsável' },
          { key: 'Cidade', label: 'Cidade' },
          { key: 'Criado_Por', label: 'Criado Por' },
          { key: 'Data_Nota', label: 'Data da Nota' },
          { key: 'Descricao', label: 'Descrição' },
          { key: 'Observacao', label: 'Observação' },
        ];
        registrosExport = registrosPlanejamento;
        nomeArquivo = `Notas_Em_Planejamento_Status10_${stamp}.xlsx`;
      }

      const blob = await InputApi.exportar(
        registrosExport.map((n) => n.Numero_Nota),
        colunasAlvo.map((c) => c.key)
      );
      baixarBlob(blob, nomeArquivo);
      toast.success('Exportação concluída');
    } catch (e) {
      toast.error('Falha na exportação', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setExportando(false);
    }
  }

  return (
    <SectionPage className="flex flex-col gap-[16px]">
      <PageHeader
        eyebrow="Relatórios"
        title="Painel Executivo"
        subtitle="Auditoria de prazos, controle financeiro de custos e análise de aderência (SLA)"
      />

      {/* Navegação entre Relatórios */}
      <div className="flex justify-between items-center gap-[16px] flex-wrap border-b border-line pb-[10px] shrink-0">
        <div className="flex gap-[6px] bg-bg-2 border border-line-2 p-[3px] rounded-sm select-none flex-wrap">
          {TABS_RELATORIOS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as TabRelatorio)}
              className={`px-[12px] py-[6px] rounded-sm text-[12.5px] font-medium transition-all cursor-pointer ${
                tab === t.id
                  ? 'bg-surface border border-line text-primary shadow-sm'
                  : 'border border-transparent text-text-mute hover:text-text'
              }`}
            >
              {t.rotulo}
            </button>
          ))}
        </div>

        <Button
          disabled={
            exportando ||
            (tab === 'prazos'
              ? auditadas.length === 0
              : tab === 'financas'
              ? registrosFinancas.length === 0
              : registrosPlanejamento.length === 0)
          }
          onClick={() => {
            void exportar();
          }}
          className="h-[34px] px-[14px]"
        >
          {exportando ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Gerando...
            </>
          ) : (
            'Exportar Excel'
          )}
        </Button>
      </div>

      {/* CONTEÚDO DA ABA: ADERÊNCIA AO PLANO */}
      {tab === 'prazos' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px] shrink-0">
            {/* Bloco de KPIs e Gráficos */}
            <Card className="lg:col-span-2 bg-surface border border-line flex flex-col justify-between">
              <CardHeader className="py-[10px] px-[16px] border-b border-line flex flex-row items-center justify-between">
                <CardTitle className="text-[13px] uppercase font-medium text-text-dim tracking-wider">
                  Métricas de Aderência ao Plano
                </CardTitle>

                {/* Botão Discreto com Dialog de Regras & Tolerâncias */}
                <Dialog>
                  <DialogTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-[5px] px-[9px] py-[3px] rounded-[6px] border border-line-2 bg-bg-2 hover:bg-surface-3 text-[11px] font-medium text-text-dim hover:text-text transition-colors cursor-pointer"
                    >
                      <Info className="h-3.5 w-3.5 text-primary shrink-0" />
                      Regras & Tolerâncias
                    </button>
                  </DialogTrigger>
                  <DialogContent className="max-w-[540px] bg-surface border-line p-[20px] rounded-[10px]">
                    <DialogHeader>
                      <DialogTitle className="text-[14px] font-medium text-text flex items-center gap-2">
                        <Info className="h-4 w-4 text-primary" />
                        Guia de Critérios e Regras das Flags
                      </DialogTitle>
                      <DialogDescription className="text-[11.5px] text-text-dim">
                        Regras de auditoria temporal e tolerâncias homologadas do EDP-Helios.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-[10px] pt-[8px] text-[12px] font-sans">
                      <div className="bg-bg-2 border border-line-2 rounded-[6px] p-[10px] flex items-center justify-between text-[11.5px]">
                        <span className="text-text-dim">Tolerância Operacional Homologada:</span>
                        <strong className="text-primary font-medium">+1 mês (No Prazo)</strong>
                      </div>
                      <div className="flex flex-col gap-[6px]">
                        <div className="flex items-start gap-[8px] bg-bg-2/50 p-[8px] rounded-[6px] border border-line-2/40">
                          <span className="text-[14px]">🟢</span>
                          <div>
                            <strong className="text-text font-medium">Adiantado:</strong>
                            <p className="text-text-mute text-[11px]">Encerramento SAP realizado antes do mês planejado.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-[8px] bg-bg-2/50 p-[8px] rounded-[6px] border border-line-2/40">
                          <span className="text-[14px]">🔵</span>
                          <div>
                            <strong className="text-text font-medium">No Prazo (+1m):</strong>
                            <p className="text-text-mute text-[11px]">Concluído no mês ou até 1 mês após (dentro da tolerância).</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-[8px] bg-bg-2/50 p-[8px] rounded-[6px] border border-line-2/40">
                          <span className="text-[14px]">🔴</span>
                          <div>
                            <strong className="text-text font-medium">Com Atraso (≥2m):</strong>
                            <p className="text-text-mute text-[11px]">Concluído com 2 ou mais meses além do planejado.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-[8px] bg-bg-2/50 p-[8px] rounded-[6px] border border-line-2/40">
                          <span className="text-[14px]">⏳</span>
                          <div>
                            <strong className="text-text font-medium">Pendente Atrasado:</strong>
                            <p className="text-text-mute text-[11px]">Nota aberta cujo mês planejado já expirou há mais de 1 mês.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-[8px] bg-bg-2/50 p-[8px] rounded-[6px] border border-line-2/40">
                          <span className="text-[14px]">⚠️</span>
                          <div>
                            <strong className="text-text font-medium">Passível de Encerramento:</strong>
                            <p className="text-text-mute text-[11px]">Ordem executada em campo no SAP aguardando encerramento da nota.</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-[8px] bg-bg-2/50 p-[8px] rounded-[6px] border border-line-2/40">
                          <span className="text-[14px]">⏱️</span>
                          <div>
                            <strong className="text-text font-medium">Atraso Acumulado:</strong>
                            <p className="text-text-mute text-[11px]">Soma total dos meses de desvio real positivo para controle do passivo.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent className="p-[14px] flex flex-col gap-[12px] justify-between h-full">
                {/* 4 Cards Executivos Principais */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[10px]">
                  {kpisPrincipais.map((k) => (
                    <div
                      key={k.rotulo}
                      className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col justify-between gap-[2px]"
                    >
                      <div className="flex flex-col">
                        <span className="text-[10.5px] font-sans text-text-mute uppercase tracking-wider">
                          {k.rotulo}
                        </span>
                        <strong className={`text-[17px] font-mono ${k.cor ?? 'text-text'}`}>
                          {k.valor}
                        </strong>
                      </div>
                      {k.sub && (
                        <span className="text-[9.5px] text-text-dim font-sans truncate" title={k.sub}>
                          {k.sub}
                        </span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Barra de Status Pills Compacta e Clicável */}
                <div className="flex flex-wrap items-center gap-[6px] pt-[2px]">
                  {statusPills.map((p) => {
                    const ativo = rapido === p.filtro;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setRapido(ativo ? '(Nenhum)' : p.filtro)}
                        className={`flex items-center gap-[5px] px-[9px] py-[3px] rounded-full border text-[11px] font-medium font-sans transition-all cursor-pointer ${
                          ativo
                            ? 'ring-2 ring-primary ring-offset-1 ring-offset-surface font-medium ' + p.corBadge
                            : p.corBadge
                        }`}
                        title={`Filtrar por ${p.label}`}
                      >
                        <span>{p.dot}</span>
                        <span>{p.label}:</span>
                        <strong className="font-mono">{p.qtd.toLocaleString('pt-BR')}</strong>
                      </button>
                    );
                  })}
                </div>

                {/* Gráficos de Proporção e Desvios */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-[14px] border-t border-line pt-[12px]">
                  {/* Gráfico de Rosca */}
                  <div className="flex flex-col gap-[6px]">
                    <span className="text-[11px] font-medium text-text-dim uppercase tracking-wider font-sans">
                      Proporção de Status
                    </span>
                    {fatias.length > 0 ? (
                      <Rosca fatias={fatias} />
                    ) : (
                      <div className="text-[12px] text-text-mute py-4 text-center">
                        Nenhum registro encontrado
                      </div>
                    )}
                  </div>

                  {/* Distribuição dos Desvios em Meses */}
                  <div className="flex flex-col gap-[6px]">
                    <span className="text-[11px] font-medium text-text-dim uppercase tracking-wider font-sans border-b border-line-2 pb-[3px]">
                      Distribuição dos Desvios (Meses)
                    </span>
                    <div className="flex flex-col gap-[5px] max-h-[120px] overflow-y-auto pr-[4px]">
                      {distSLA.map(([desvioTipo, qtd]) => {
                        const totalSLA = auditadas.length || 1;
                        const percent = (qtd / totalSLA) * 100;
                        const barColor =
                          desvioTipo.startsWith('Atrasado') || desvioTipo.startsWith('Pendente Atrasado')
                            ? 'bg-red'
                            : desvioTipo.startsWith('Adiantado') || desvioTipo.startsWith('No Prazo') || desvioTipo.startsWith('Tolerância')
                            ? 'bg-primary'
                            : 'bg-text-mute';
                        return (
                          <div key={desvioTipo} className="flex flex-col gap-[1px] w-full text-[11px]">
                            <div className="flex justify-between font-sans">
                              <span className="text-text font-medium">{desvioTipo}</span>
                              <span className="text-text-mute font-mono">
                                {qtd} ({percent.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-[4px] w-full bg-bg-2 border border-line rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bloco de Filtros da Auditoria & SLA */}
            <Card className="bg-surface border border-line">
              <CardHeader className="py-[10px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-medium text-text-dim tracking-wider">
                  Filtros da Auditoria
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[14px] flex flex-col gap-[9px]">
                <div className="flex flex-col gap-[4px]">
                  <span className="text-[10.5px] font-medium text-text-mute uppercase tracking-wider">
                    Filtro Rápido
                  </span>
                  <div className="flex flex-wrap gap-[4px]">
                    {FILTROS_RAPIDOS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setRapido(f)}
                        className={`px-[7px] py-[3px] rounded-[5px] border text-[10.5px] font-medium transition-colors cursor-pointer ${
                          rapido === f
                            ? 'border-primary bg-primary/10 text-primary font-medium'
                            : 'border-line-2 bg-bg-2 text-text-dim hover:bg-surface-3'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-[4px] mt-[1px]">
                  <span className="text-[10.5px] font-medium text-text-mute uppercase tracking-wider">
                    Ano de Encerramento (SAP)
                  </span>
                  <MultiSelect
                    options={anosDisponiveis}
                    selected={fAnos}
                    onChange={setFAnos}
                    placeholder="Todos os anos"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[10.5px] font-medium text-text-mute uppercase tracking-wider">
                    Mês Planejado
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Mes_Execucao_Planejado').sort()}
                    selected={fMesesPlan}
                    onChange={setFMesesPlan}
                    placeholder="Todos os meses"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[10.5px] font-medium text-text-mute uppercase tracking-wider">
                    Resultado da Auditoria
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Auditoria_Cronograma')}
                    selected={fStatus}
                    onChange={setFStatus}
                    placeholder="Todos os resultados"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[10.5px] font-medium text-text-mute uppercase tracking-wider">
                    Status de SLA
                  </span>
                  <MultiSelect
                    options={[
                      'No Prazo',
                      'Adiantado',
                      'Atrasado',
                      'Pendente Atrasado',
                      'Pendente No Prazo',
                      'Sem Planejamento',
                    ]}
                    selected={fSlaStatus}
                    onChange={setFSlaStatus}
                    placeholder="Todos os status SLA"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[10.5px] font-medium text-text-mute uppercase tracking-wider">
                    Regional
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Regional')}
                    selected={fRegional}
                    onChange={setFRegional}
                    placeholder="Todas as regionais"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela Unificada de Aderência ao Plano */}
          <div className="flex flex-col gap-[6px] flex-1 min-h-[300px]">
            <span className="text-[12px] font-medium text-text-dim uppercase tracking-wider font-sans ml-[4px]">
              Detalhamento de Aderência ao Plano ({auditadas.length})
            </span>
            <NotesTable registros={auditadas} colunas={COLUNAS_AUDITORIA} altura={380} />
          </div>
        </>
      )}

      {/* CONTEÚDO DA ABA: VISÃO FINANCEIRA */}
      {tab === 'financas' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px] shrink-0">
            {/* Bloco de KPIs e Gráficos de Barra Financeiros */}
            <Card className="lg:col-span-2 bg-surface border border-line flex flex-col justify-between">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-medium text-text-dim tracking-wider">
                  Consolidação dos Custos Planejados e Realizados
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[20px] justify-between h-full">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[10px]">
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Total Modular (R$)
                    </span>
                    <strong className="text-[15px] font-mono text-green">
                      R$ {formatarNumero(totaisFinancas.totalModular)}
                    </strong>
                    <span className="text-[10px] text-text-dim">Custo Modular Estimado</span>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Físico Planejado
                    </span>
                    <strong className="text-[15px] font-mono text-text">
                      {totaisFinancas.totalFisico.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                    </strong>
                    <span className="text-[10px] text-text-dim">Postes / Unidades</span>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Orçado em Ordens
                    </span>
                    <strong className="text-[15px] font-mono text-blue">
                      R$ {formatarNumero(totaisFinancas.totalOrdemPlan)}
                    </strong>
                    <span className="text-[10px] text-text-dim">Total Orçado SAP</span>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Realizado em Ordens
                    </span>
                    <strong className="text-[15px] font-mono text-amber">
                      R$ {formatarNumero(totaisFinancas.totalOrdemReal)}
                    </strong>
                    <span className="text-[10px] text-text-dim">Total Realizado SAP</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-[24px] border-t border-line pt-[16px]">
                  {/* Progress bars por Regional */}
                  <div>
                    <h4 className="text-[12px] font-medium text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                      Orçamento Modular por Regional
                    </h4>
                    <div className="flex flex-col gap-[10px] max-h-[160px] overflow-y-auto pr-[4px]">
                      {distribuicaoRegionalFinancas.map(([reg, info]) => {
                        const percent = totaisFinancas.totalModular > 0 ? (info.modular / totaisFinancas.totalModular) * 100 : 0;
                        return (
                          <div key={reg} className="flex flex-col gap-[3px] w-full text-[12px]">
                            <div className="flex justify-between font-sans text-[11.5px]">
                              <span className="text-text font-medium">{reg} ({info.fisico.toLocaleString('pt-BR')} un)</span>
                              <span className="text-text-mute font-mono">
                                R$ {formatarNumero(info.modular)} ({percent.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-[6px] w-full bg-bg-2 border border-line rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-500"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {distribuicaoRegionalFinancas.length === 0 && (
                        <div className="text-[11px] text-text-mute text-center py-6">
                          Sem dados cadastrados
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bars por Status */}
                  <div>
                    <h4 className="text-[12px] font-medium text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                      Orçamento Modular por Status
                    </h4>
                    <div className="flex flex-col gap-[10px] max-h-[160px] overflow-y-auto pr-[4px]">
                      {distribuicaoStatusFinancas.slice(0, 5).map(([status, valor]) => {
                        const percent = totaisFinancas.totalModular > 0 ? (valor / totaisFinancas.totalModular) * 100 : 0;
                        return (
                          <div key={status} className="flex flex-col gap-[3px] w-full text-[12px]">
                            <div className="flex justify-between font-sans text-[11.5px]">
                              <span className="text-text font-medium truncate max-w-[130px]" title={status}>
                                {status}
                              </span>
                              <span className="text-text-mute font-mono">
                                R$ {formatarNumero(valor)} ({percent.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-[6px] w-full bg-bg-2 border border-line rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue transition-all duration-500"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {distribuicaoStatusFinancas.length === 0 && (
                        <div className="text-[11px] text-text-mute text-center py-6">
                          Sem dados cadastrados
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bloco de Filtros Financeiros */}
            <Card className="bg-surface border border-line">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-medium text-text-dim tracking-wider">
                  Filtros Financeiros
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[12px]">
                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-medium text-text-mute uppercase tracking-wider">
                    Mês Planejado
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Mes_Execucao_Planejado').sort()}
                    selected={finMeses}
                    onChange={setFinMeses}
                    placeholder="Todos os meses"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-medium text-text-mute uppercase tracking-wider">
                    Regional
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Regional')}
                    selected={finRegionais}
                    onChange={setFinRegionais}
                    placeholder="Todas as regionais"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-medium text-text-mute uppercase tracking-wider">
                    Status de Nota
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Status_Nota')}
                    selected={finStatus}
                    onChange={setFinStatus}
                    placeholder="Todos os status"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela de Detalhamento de Custos */}
          <div className="flex flex-col gap-[6px] flex-1 min-h-[300px]">
            <span className="text-[12px] font-medium text-text-dim uppercase tracking-wider font-sans ml-[4px]">
              Detalhamento de Custos ({registrosFinancas.length})
            </span>
            <NotesTable
              registros={registrosFinancas}
              colunas={[
                { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
                { key: 'Regional', label: 'Regional' },
                { key: 'Conjunto', label: 'Conjunto' },
                { key: 'Status_Nota', label: 'Status Nota', largura: 160 },
                { key: 'Planejado_DDPM', label: 'Físico (Postes)', numeric: true, largura: 120 },
                { key: 'Modular', label: 'Modular Unit. (R$)', numeric: true, largura: 140 },
                { key: 'Total_planejado_modular', label: 'Total Modular (R$)', numeric: true, largura: 150 },
                { key: 'Total_planejado_ordem', label: 'Orçado Ordem (R$)', numeric: true, largura: 150 },
                { key: 'Total_real_ordem', label: 'Realizado Ordem (R$)', numeric: true, largura: 150 },
                { key: 'Ordem', label: 'Ordem', largura: 120 },
                { key: 'Status_Usuário_Ordem', label: 'Status Usuário', largura: 140 },
                { key: 'Mes_Execucao_Planejado', label: 'Mês Execução', largura: 130 },
                { key: 'Observacao', label: 'Observação', largura: 220 },
              ]}
              altura={380}
            />
          </div>
        </>
      )}

      {/* CONTEÚDO DA ABA: EM PLANEJAMENTO (STATUS 10) */}
      {tab === 'planejamento' && (
        <>
          {/* Barra de Ações do Status 10 */}
          <div className="flex justify-between items-center bg-surface border border-line p-[14px] rounded-[8px] gap-[12px] flex-wrap shadow-xs">
            <div className="flex items-center gap-[10px]">
              <div className="p-[8px] rounded-full bg-primary/10 text-primary">
                <Mail size={18} />
              </div>
              <div>
                <h4 className="text-[13px] font-medium text-text">Relatório Analítico de Engenharia (Status 10)</h4>
                <p className="text-[11.5px] text-text-mute">
                  Extrai notas e ordens diretamente do SAP (IW28 + IW38), cruza com custos modulares e gera resumo no Outlook.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-[8px] flex-wrap">
              <Button
                variant="outline"
                size="sm"
                disabled={extraindoSapSt10}
                onClick={() => { void dispararExtracaoSapStatus10(); }}
                className="gap-[6px]"
              >
                {extraindoSapSt10 ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Extraindo SAP...
                  </>
                ) : (
                  <>
                    <Bot size={14} />
                    Extrair do SAP (Status 10)
                  </>
                )}
              </Button>

              <Button
                variant="default"
                size="sm"
                disabled={enviandoEmailSt10 || registrosPlanejamento.length === 0}
                onClick={() => { void dispararEmailStatus10(); }}
                className="bg-primary hover:bg-primary/90 text-primary-foreground gap-[6px]"
              >
                {enviandoEmailSt10 ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gerando no Outlook...
                  </>
                ) : (
                  <>
                    <Mail size={14} />
                    Disparar E-mail Status 10
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px] shrink-0">
            {/* Bloco de KPIs e Gráficos de Prioridade */}
            <Card className="lg:col-span-2 bg-surface border border-line flex flex-col justify-between">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-medium text-text-dim tracking-wider">
                  Métricas do Backlog (Status 10)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[20px] justify-between h-full">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[10px]">
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Qtd Notas Backlog
                    </span>
                    <strong className="text-[16px] font-mono text-text">
                      {registrosPlanejamento.length.toLocaleString('pt-BR')}
                    </strong>
                    <span className="text-[10px] text-text-dim">Notas em Análise</span>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Volume Físico
                    </span>
                    <strong className="text-[15px] font-mono text-text">
                      {totaisPlanejamento.totalFisico.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}
                    </strong>
                    <span className="text-[10px] text-text-dim">Postes / Unidades</span>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Total Modular Obra
                    </span>
                    <strong className="text-[15px] font-mono text-primary">
                      R$ {formatarNumero(totaisPlanejamento.totalModular)}
                    </strong>
                    <span className="text-[10px] text-text-dim">Estimativa de Custo</span>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Custo Orçado Ordem
                    </span>
                    <strong className="text-[15px] font-mono text-blue">
                      R$ {formatarNumero(totaisPlanejamento.totalCustoOrdem)}
                    </strong>
                    <span className="text-[10px] text-text-dim">Orçamento SAP</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-[24px] border-t border-line pt-[16px]">
                  {/* Progress bars por Regional (Valor) */}
                  <div>
                    <h4 className="text-[12px] font-medium text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                      Orçamento do Backlog por Regional
                    </h4>
                    <div className="flex flex-col gap-[10px] max-h-[160px] overflow-y-auto pr-[4px]">
                      {totaisPlanejamento.distReg.map(([reg, info]) => {
                        const percent = totaisPlanejamento.totalModular > 0 ? (info.modular / totaisPlanejamento.totalModular) * 100 : 0;
                        return (
                          <div key={reg} className="flex flex-col gap-[3px] w-full text-[12px]">
                            <div className="flex justify-between font-sans text-[11.5px]">
                              <span className="text-text font-medium">{reg} ({info.qtd} notas | {info.fisico.toLocaleString('pt-BR')} un)</span>
                              <span className="text-text-mute font-mono">
                                R$ {formatarNumero(info.modular)} ({percent.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-[6px] w-full bg-bg-2 border border-line rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-primary transition-all duration-500"
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {totaisPlanejamento.distReg.length === 0 && (
                        <div className="text-[11px] text-text-mute text-center py-6">
                          Nenhuma nota no backlog
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bars por Prioridade (Qtd) */}
                  <div>
                    <h4 className="text-[12px] font-medium text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                      Notas por Prioridade
                    </h4>
                    <div className="flex flex-col gap-[10px] max-h-[160px] overflow-y-auto pr-[4px]">
                      {totaisPlanejamento.distPrio.map(([prio, info]) => {
                        const totalQtd = registrosPlanejamento.length || 1;
                        const percent = (info.qtd / totalQtd) * 100;
                        const barColor =
                          prio === 'Emergente' || prio === 'Urgente'
                            ? 'bg-red'
                            : prio === 'Prioritário'
                            ? 'bg-amber'
                            : 'bg-blue';
                        return (
                          <div key={prio} className="flex flex-col gap-[3px] w-full text-[12px]">
                            <div className="flex justify-between font-sans text-[11.5px]">
                              <span className="text-text font-medium">{prio}</span>
                              <span className="text-text-mute font-mono">
                                {info.qtd} nota(s) ({percent.toFixed(1)}%)
                              </span>
                            </div>
                            <div className="h-[6px] w-full bg-bg-2 border border-line rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {totaisPlanejamento.distPrio.length === 0 && (
                        <div className="text-[11px] text-text-mute text-center py-6">
                          Nenhuma nota no backlog
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bloco de Filtros do Backlog */}
            <Card className="bg-surface border border-line">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-medium text-text-dim tracking-wider">
                  Filtros do Backlog
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[12px]">
                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-medium text-text-mute uppercase tracking-wider">
                    Mês Planejado
                  </span>
                  <MultiSelect
                    options={valoresUnicos(
                      registrosPlanejamento,
                      'Mes_Execucao_Planejado'
                    ).sort()}
                    selected={planMeses}
                    onChange={setPlanMeses}
                    placeholder="Todos os meses"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-medium text-text-mute uppercase tracking-wider">
                    Regional
                  </span>
                  <MultiSelect
                    options={valoresUnicos(
                      registrosPlanejamento,
                      'Regional'
                    )}
                    selected={planRegionais}
                    onChange={setPlanRegionais}
                    placeholder="Todas as regionais"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-medium text-text-mute uppercase tracking-wider">
                    Prioridade
                  </span>
                  <MultiSelect
                    options={valoresUnicos(
                      registrosPlanejamento,
                      'Prioridade_Nota'
                    )}
                    selected={planPrioridades}
                    onChange={setPlanPrioridades}
                    placeholder="Todas as prioridades"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela do Backlog (Status 10 Enriquecida) */}
          <div className="flex flex-col gap-[6px] flex-1 min-h-[300px]">
            <div className="flex justify-between items-center px-1">
              <span className="text-[12px] font-medium text-text-dim uppercase tracking-wider font-sans">
                Notas de Backlog em Planejamento ({registrosPlanejamento.length})
              </span>
              {status10Query.isFetching && (
                <span className="text-[11px] text-text-mute flex items-center gap-1 font-sans">
                  <RefreshCw className="h-3 w-3 animate-spin text-primary" />
                  Atualizando dados SAP...
                </span>
              )}
            </div>
            <NotesTable
              registros={registrosPlanejamento as NotaInput[]}
              colunas={[
                { key: 'Numero_Nota', label: 'Nº Nota', numeric: true, largura: 110 },
                { key: 'Ordem', label: 'Ordem', largura: 110 },
                { key: 'Status_Usuario', label: 'Status Usuário', largura: 140 },
                { key: 'Conjunto', label: 'Conjunto' },
                { key: 'Local_Instalacao', label: 'Local Instalação', largura: 150 },
                { key: 'Planejado_DDPM', label: 'Físico (Postes)', numeric: true, largura: 120 },
                { key: 'Modular', label: 'Modular Unit. (R$)', numeric: true, largura: 140 },
                { key: 'Modular_Obra', label: 'Modular Obra (R$)', numeric: true, largura: 150 },
                { key: 'Custo_Plan', label: 'Custo Plan Ordem (R$)', numeric: true, largura: 150 },
                { key: 'PEP', label: 'PEP', largura: 120 },
                { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado', largura: 130 },
                { key: 'Prioridade_Nota', label: 'Prioridade', largura: 130 },
                { key: 'Regional', label: 'Regional', largura: 130 },
                { key: 'Centro_Responsavel', label: 'Centro Resp.', largura: 150 },
                { key: 'Criado_Por', label: 'Criado Por', largura: 120 },
                { key: 'Data_Nota', label: 'Data da Nota', largura: 130 },
                { key: 'Descricao', label: 'Descrição SAP', largura: 220 },
                { key: 'Observacao', label: 'Observação', largura: 250 },
              ]}
              altura={380}
            />
          </div>
        </>
      )}

      {/* Fim do Bloco de Relatórios */}
    </SectionPage>
  );
}
