import React from 'react';
import type { InputDataset, NotaInput } from './types';
import { InputApi, baixarBlob } from './api';
import { toast } from 'sonner';
import { valoresUnicos, formatarNumero } from './lib';
import type { ColunaDef } from './columns';
import { NotesTable } from './notes-table';
import { Button } from '@/components/ui/button';
import { PageHeader, SectionPage } from '@/components/branded/section';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MultiSelect } from './filters';
import { Loader2, Mail } from 'lucide-react';
import { anoEncerramento, calcularSLA } from './reports-lib';

/** Cores do "semáforo" (porte de Input/app.py:1132-1139). */
const CORES_AUDITORIA: Record<string, string> = {
  '🟢 Adiantado': 'var(--green-3)',
  '🔵 No Prazo': 'var(--blue)',
  '🔴 Com Atraso': 'var(--red)',
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
  { key: 'Conjunto', label: 'Conjunto' },
  { key: 'Status_Nota', label: 'Status Nota', largura: 170 },
  { key: 'Status_Final', label: 'Status Final' },
  { key: 'Ordem_Executada', label: 'Ordem Exec.' },
  { key: 'Encerram.por data', label: 'Data Encerramento SAP' },
  { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
  { key: 'Auditoria_Cronograma', label: 'Resultado da Auditoria', largura: 220 },
  { key: 'Regional', label: 'Regional' },
  { key: 'Centro_Responsavel', label: 'Centro Responsável' },
];

const FILTROS_RAPIDOS = [
  '(Nenhum)',
  'Passíveis de Encerramento',
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
  const total = fatias.reduce((a, f) => a + f.qtd, 0) || 1;
  const R = 70;
  const C = 2 * Math.PI * R;
  let acumulado = 0;
  return (
    <div className="flex gap-[24px] items-center flex-wrap justify-center sm:justify-start bg-bg-2/30 border border-line-2 rounded-[8px] p-[16px] w-full">
      <svg
        width="150"
        height="150"
        viewBox="0 0 180 180"
        role="img"
        aria-label="Distribuição por status de prazo"
        className="shrink-0"
      >
        {fatias.map((f) => {
          const frac = f.qtd / total;
          const offset = acumulado;
          acumulado += frac;
          return (
            <circle
              key={f.rotulo}
              cx="90"
              cy="90"
              r={R}
              fill="none"
              stroke={f.cor}
              strokeWidth="28"
              strokeDasharray={`${frac * C} ${C}`}
              strokeDashoffset={-offset * C}
              transform="rotate(-90 90 90)"
            />
          );
        })}
      </svg>
      <div className="flex flex-col gap-[6px] text-[12px] flex-1 min-w-[180px]">
        <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider mb-[2px]">
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

type TabRelatorio = 'prazos' | 'financas' | 'planejamento' | 'aderencia';

const TABS_RELATORIOS = [
  { id: 'prazos', rotulo: 'Auditoria de Prazos' },
  { id: 'financas', rotulo: 'Visão Financeira (Custos)' },
  { id: 'planejamento', rotulo: 'Em Planejamento (Status 10)' },
  { id: 'aderencia', rotulo: 'Aderência ao Cronograma (SLA)' },
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
  const [tab, setTab] = React.useState<TabRelatorio>('prazos');

  const registrosBase = React.useMemo(() => {
    if (!estadoFiltros) return dados.registros;
    return filtrarRegistros(dados.registros, estadoFiltros);
  }, [dados.registros, estadoFiltros]);

  // --- FILTROS ABA PRAZOS ---
  const [rapido, setRapido] = React.useState<(typeof FILTROS_RAPIDOS)[number]>('(Nenhum)');
  const [fAnos, setFAnos] = React.useState<string[]>([]);
  const [fStatus, setFStatus] = React.useState<string[]>([]);
  const [fRegional, setFRegional] = React.useState<string[]>([]);

  // --- FILTROS ABA FINANÇAS ---
  const [finMeses, setFinMeses] = React.useState<string[]>([]);
  const [finRegionais, setFinRegionais] = React.useState<string[]>([]);
  const [finStatus, setFinStatus] = React.useState<string[]>([]);

  // --- FILTROS ABA PLANEJAMENTO (STATUS 10) ---
  const [planMeses, setPlanMeses] = React.useState<string[]>([]);
  const [planRegionais, setPlanRegionais] = React.useState<string[]>([]);
  const [planPrioridades, setPlanPrioridades] = React.useState<string[]>([]);

  // --- FILTROS ABA ADERÊNCIA (SLA) ---
  const [slaMeses, setSlaMeses] = React.useState<string[]>([]);
  const [slaRegionais, setSlaRegionais] = React.useState<string[]>([]);
  const [slaStatus, setSlaStatus] = React.useState<string[]>([]);

  const [exportando, setExportando] = React.useState(false);
  const [enviandoEmailSt10, setEnviandoEmailSt10] = React.useState(false);

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

  // --- PROCESSAMENTO DADOS: PRAZOS ---
  const auditadas = React.useMemo(() => {
    let r: NotaInput[] = registrosBase;
    if (rapido === 'Passíveis de Encerramento') {
      r = r.filter((n) => n.Status_Nota !== '99 Encerrado' && n.Ordem_Executada === 'SIM');
    } else if (rapido === 'Em Andamento') {
      r = r.filter((n) => n.Status_Nota !== '99 Encerrado');
    } else if (rapido === 'Encerradas') {
      r = r.filter((n) => n.Status_Nota === '99 Encerrado');
    } else if (rapido === 'Ordem Executada (SAP)') {
      r = r.filter((n) => n.Ordem_Executada === 'SIM');
    }
    if (fAnos.length) r = r.filter((n) => fAnos.includes(String(anoEncerramento(n['Encerram.por data']) ?? '')));
    if (fStatus.length) r = r.filter((n) => fStatus.includes(String(n.Auditoria_Cronograma ?? '')));
    if (fRegional.length) r = r.filter((n) => fRegional.includes(String(n.Regional ?? '')));
    return r;
  }, [registrosBase, rapido, fAnos, fStatus, fRegional]);

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

  const kpisPrazos = [
    { rotulo: 'Total Auditadas', valor: auditadas.length },
    { rotulo: 'No Prazo', valor: contagens.get('🔵 No Prazo') ?? 0 },
    { rotulo: 'Antecipadas', valor: contagens.get('🟢 Adiantado') ?? 0 },
    { rotulo: 'Com Atraso', valor: contagens.get('🔴 Com Atraso') ?? 0 },
    { rotulo: 'Fora do Plano', valor: contagens.get('🟣 Fora do Plano') ?? 0 },
    { rotulo: 'Passíveis Encerram.', valor: contagens.get('⚠️ Passível de Encerramento') ?? 0 },
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
    let total = 0;
    let emPlanejamento = 0;
    let emExecucao = 0;
    let encerrado = 0;
    let executado = 0;

    registrosFinancas.forEach((n) => {
      const valor = Number(n.Planejado_DDPM) || 0;
      total += valor;
      const statusStr = String(n.Status_Nota ?? '');
      if (statusStr.startsWith('10')) {
        emPlanejamento += valor;
      } else if (
        statusStr.startsWith('11') ||
        statusStr.startsWith('47') ||
        statusStr.startsWith('51') ||
        statusStr.startsWith('53')
      ) {
        emExecucao += valor;
      } else if (statusStr.startsWith('99')) {
        encerrado += valor;
      }
      if (n.Ordem_Executada === 'SIM') {
        executado += valor;
      }
    });

    return { total, emPlanejamento, emExecucao, encerrado, executado };
  }, [registrosFinancas]);

  const distribuicaoRegional = React.useMemo(() => {
    const mapa = new Map<string, number>();
    registrosFinancas.forEach((n) => {
      const reg = String(n.Regional || 'Não Cadastrado');
      const valor = Number(n.Planejado_DDPM) || 0;
      mapa.set(reg, (mapa.get(reg) ?? 0) + valor);
    });
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  }, [registrosFinancas]);

  const distribuicaoStatus = React.useMemo(() => {
    const mapa = new Map<string, number>();
    registrosFinancas.forEach((n) => {
      const status = String(n.Status_Nota || 'Sem Status');
      const valor = Number(n.Planejado_DDPM) || 0;
      mapa.set(status, (mapa.get(status) ?? 0) + valor);
    });
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  }, [registrosFinancas]);

  // --- PROCESSAMENTO DADOS: PLANEJAMENTO (STATUS 10) ---
  const registrosPlanejamento = React.useMemo(() => {
    let r = registrosBase.filter((n) => String(n.Status_Nota ?? '').startsWith('10'));
    if (planMeses.length) r = r.filter((n) => planMeses.includes(String(n.Mes_Execucao_Planejado ?? '')));
    if (planRegionais.length) r = r.filter((n) => planRegionais.includes(String(n.Regional ?? '')));
    if (planPrioridades.length) r = r.filter((n) => planPrioridades.includes(String(n.Prioridade_Nota ?? '')));
    return r;
  }, [registrosBase, planMeses, planRegionais, planPrioridades]);

  const totaisPlanejamento = React.useMemo(() => {
    let totalValor = 0;
    let urgentesOuEmergentes = 0;
    const mapaRegional = new Map<string, { valor: number; qtd: number }>();
    const mapaPrioridade = new Map<string, { valor: number; qtd: number }>();

    registrosPlanejamento.forEach((n) => {
      const valor = Number(n.Planejado_DDPM) || 0;
      totalValor += valor;

      const prio = String(n.Prioridade_Nota ?? '');
      if (prio === 'Emergente' || prio === 'Urgente' || prio === 'Prioritário') {
        urgentesOuEmergentes += 1;
      }

      const reg = String(n.Regional || 'Não Mapeado');
      const curReg = mapaRegional.get(reg) ?? { valor: 0, qtd: 0 };
      mapaRegional.set(reg, { valor: curReg.valor + valor, qtd: curReg.qtd + 1 });

      const curPrio = mapaPrioridade.get(prio) ?? { valor: 0, qtd: 0 };
      mapaPrioridade.set(prio, { valor: curPrio.valor + valor, qtd: curPrio.qtd + 1 });
    });

    const distReg = [...mapaRegional.entries()].sort((a, b) => b[1].valor - a[1].valor);
    const distPrio = [...mapaPrioridade.entries()].sort((a, b) => b[1].qtd - a[1].qtd);

    return { totalValor, urgentesOuEmergentes, distReg, distPrio };
  }, [registrosPlanejamento]);

  // --- PROCESSAMENTO DADOS: ADERÊNCIA (SLA) ---
  const registrosSLA = React.useMemo(() => {
    return registrosBase.map((n) => calcularSLA(n));
  }, [registrosBase]);

  const registrosSLAFiltrados = React.useMemo(() => {
    let r = registrosSLA;
    if (slaMeses.length) r = r.filter((item) => slaMeses.includes(String(item.nota.Mes_Execucao_Planejado ?? '')));
    if (slaRegionais.length) r = r.filter((item) => slaRegionais.includes(String(item.nota.Regional ?? '')));
    if (slaStatus.length) r = r.filter((item) => slaStatus.includes(item.statusSLA));
    return r;
  }, [registrosSLA, slaMeses, slaRegionais, slaStatus]);

  const kpisSLA = React.useMemo(() => {
    let concluidas = 0;
    let concluídasNoPrazoOuAdiantadas = 0;
    let somaDesviosConcluidas = 0;
    let pendentesAtrasadas = 0;
    let totalFiltradas = registrosSLAFiltrados.length;

    registrosSLAFiltrados.forEach((item) => {
      if (item.statusSLA === 'No Prazo' || item.statusSLA === 'Adiantado' || item.statusSLA === 'Atrasado') {
        concluidas += 1;
        if (item.statusSLA !== 'Atrasado') concluídasNoPrazoOuAdiantadas += 1;
        somaDesviosConcluidas += item.desvio ?? 0;
      } else if (item.statusSLA === 'Pendente Atrasado') {
        pendentesAtrasadas += 1;
      }
    });

    const indexAderencia = concluidas > 0 ? (concluídasNoPrazoOuAdiantadas / concluidas) * 100 : 0;
    const mediaDesvio = concluidas > 0 ? (somaDesviosConcluidas / concluidas) : 0;

    return { concluidas, indexAderencia, mediaDesvio, pendentesAtrasadas, totalFiltradas };
  }, [registrosSLAFiltrados]);

  const distribuicaoSLA = React.useMemo(() => {
    const contagem = {
      'No Prazo': 0,
      'Adiantado': 0,
      'Atrasado (1 mês)': 0,
      'Atrasado (2 meses)': 0,
      'Atrasado (3+ meses)': 0,
      'Pendente Atrasado': 0,
      'Outros/Sem Planejamento': 0,
    };

    registrosSLAFiltrados.forEach((item) => {
      if (item.statusSLA === 'No Prazo') contagem['No Prazo'] += 1;
      else if (item.statusSLA === 'Adiantado') contagem['Adiantado'] += 1;
      else if (item.statusSLA === 'Atrasado') {
        if (item.desvio === 1) contagem['Atrasado (1 mês)'] += 1;
        else if (item.desvio === 2) contagem['Atrasado (2 meses)'] += 1;
        else contagem['Atrasado (3+ meses)'] += 1;
      } else if (item.statusSLA === 'Pendente Atrasado') contagem['Pendente Atrasado'] += 1;
      else contagem['Outros/Sem Planejamento'] += 1;
    });

    return Object.entries(contagem);
  }, [registrosSLAFiltrados]);

  const auditadasSLAFlat = React.useMemo(() => {
    return registrosSLAFiltrados.map((item) => ({
      ...item.nota,
      Desvio_SLA: item.textoDesvio,
    }));
  }, [registrosSLAFiltrados]);

  const COLUNAS_SLA: ColunaDef[] = [
    { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
    { key: 'Conjunto', label: 'Conjunto' },
    { key: 'Status_Nota', label: 'Status Nota', largura: 170 },
    { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
    { key: 'Encerram.por data', label: 'Data Encerramento SAP', largura: 160 },
    { key: 'Ordem_Executada', label: 'Ordem Exec.' },
    { key: 'Desvio_SLA', label: 'Status de SLA / Desvio', largura: 180 },
    { key: 'Regional', label: 'Regional' },
  ];

  // --- AÇÃO EXPORTAR ---
  async function exportar(): Promise<void> {
    setExportando(true);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      let colunasAlvo = COLUNAS_AUDITORIA;
      let registrosExport = auditadas;
      let nomeArquivo = `Auditoria_Prazos_${stamp}.xlsx`;

      if (tab === 'financas') {
        colunasAlvo = [
          { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
          { key: 'Conjunto', label: 'Conjunto' },
          { key: 'Status_Nota', label: 'Status Nota' },
          { key: 'Planejado_DDPM', label: 'Valor Planejado', numeric: true },
          { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
          { key: 'Regional', label: 'Regional' },
          { key: 'Circuito', label: 'Circuito' },
          { key: 'Local_Instalacao', label: 'Local Instalação' },
        ];
        registrosExport = registrosFinancas;
        nomeArquivo = `Custos_Planejados_${stamp}.xlsx`;
      } else if (tab === 'planejamento') {
        colunasAlvo = [
          { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
          { key: 'Conjunto', label: 'Conjunto' },
          { key: 'Local_Instalacao', label: 'Local Instalação' },
          { key: 'Planejado_DDPM', label: 'Valor Planejado', numeric: true },
          { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
          { key: 'Prioridade_Nota', label: 'Prioridade' },
          { key: 'Regional', label: 'Regional' },
          { key: 'Centro_Responsavel', label: 'Centro Responsável' },
          { key: 'Observacao', label: 'Observação' },
        ];
        registrosExport = registrosPlanejamento;
        nomeArquivo = `Notas_Em_Planejamento_${stamp}.xlsx`;
      } else if (tab === 'aderencia') {
        colunasAlvo = COLUNAS_SLA;
        registrosExport = auditadasSLAFlat;
        nomeArquivo = `Aderencia_SLA_Desvios_${stamp}.xlsx`;
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
              : tab === 'planejamento'
              ? registrosPlanejamento.length === 0
              : registrosSLAFiltrados.length === 0)
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

      {/* CONTEÚDO DA ABA: AUDITORIA DE PRAZOS */}
      {tab === 'prazos' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px] shrink-0">
            {/* Bloco de KPIs e Gráfico */}
            <Card className="lg:col-span-2 bg-surface border border-line flex flex-col justify-between">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Métricas de Desempenho Geral
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[16px] justify-between h-full">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-[10px]">
                  {kpisPrazos.map((k) => (
                    <div
                      key={k.rotulo}
                      className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]"
                    >
                      <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                        {k.rotulo}
                      </span>
                      <strong className="text-[16px] font-mono text-text">
                        {k.valor.toLocaleString('pt-BR')}
                      </strong>
                    </div>
                  ))}
                </div>
                {fatias.length > 0 ? (
                  <div className="border-t border-line pt-[16px]">
                    <Rosca fatias={fatias} />
                  </div>
                ) : (
                  <div className="text-[12px] text-text-mute py-4 text-center">
                    Nenhum prazo registrado
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bloco de Filtros da Auditoria */}
            <Card className="bg-surface border border-line">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Filtros da Auditoria
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[12px]">
                <div className="flex flex-col gap-[6px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
                    Filtro Rápido
                  </span>
                  <div className="flex flex-wrap gap-[6px]">
                    {FILTROS_RAPIDOS.map((f) => (
                      <button
                        key={f}
                        onClick={() => setRapido(f)}
                        className={`px-[10px] py-[5px] rounded-[6px] border text-[11px] font-medium transition-colors cursor-pointer ${
                          rapido === f
                            ? 'border-primary bg-primary/10 text-primary font-semibold'
                            : 'border-line-2 bg-bg-2 text-text-dim hover:bg-surface-3'
                        }`}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-[4px] mt-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
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
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
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
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
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

          {/* Tabela dos Resultados da Auditoria */}
          <div className="flex flex-col gap-[6px] flex-1 min-h-[300px]">
            <span className="text-[12px] font-semibold text-text-dim uppercase tracking-wider font-sans ml-[4px]">
              Detalhamento da Auditoria de Prazo ({auditadas.length})
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
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Consolidação dos Recursos Planejados
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[20px] justify-between h-full">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[10px]">
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Total Planejado
                    </span>
                    <strong className="text-[15px] font-mono text-green">
                      R$ {formatarNumero(totaisFinancas.total)}
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Em Planejamento
                    </span>
                    <strong className="text-[15px] font-mono text-blue">
                      R$ {formatarNumero(totaisFinancas.emPlanejamento)}
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Em Execução
                    </span>
                    <strong className="text-[15px] font-mono text-amber">
                      R$ {formatarNumero(totaisFinancas.emExecucao)}
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Executado/Viabilizado
                    </span>
                    <strong className="text-[15px] font-mono text-text">
                      R$ {formatarNumero(totaisFinancas.executado)}
                    </strong>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-[24px] border-t border-line pt-[16px]">
                  {/* Progress bars por Regional */}
                  <div>
                    <h4 className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                      Orçamento por Regional
                    </h4>
                    <div className="flex flex-col gap-[10px] max-h-[160px] overflow-y-auto pr-[4px]">
                      {distribuicaoRegional.map(([reg, valor]) => {
                        const percent = totaisFinancas.total > 0 ? (valor / totaisFinancas.total) * 100 : 0;
                        return (
                          <div key={reg} className="flex flex-col gap-[3px] w-full text-[12px]">
                            <div className="flex justify-between font-sans text-[11.5px]">
                              <span className="text-text font-medium">{reg}</span>
                              <span className="text-text-mute font-mono">
                                R$ {formatarNumero(valor)} ({percent.toFixed(1)}%)
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
                      {distribuicaoRegional.length === 0 && (
                        <div className="text-[11px] text-text-mute text-center py-6">
                          Sem dados cadastrados
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress bars por Status */}
                  <div>
                    <h4 className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                      Orçamento por Status
                    </h4>
                    <div className="flex flex-col gap-[10px] max-h-[160px] overflow-y-auto pr-[4px]">
                      {distribuicaoStatus.slice(0, 5).map(([status, valor]) => {
                        const percent = totaisFinancas.total > 0 ? (valor / totaisFinancas.total) * 100 : 0;
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
                      {distribuicaoStatus.length === 0 && (
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
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Filtros Financeiros
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[12px]">
                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
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
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
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
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
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
            <span className="text-[12px] font-semibold text-text-dim uppercase tracking-wider font-sans ml-[4px]">
              Detalhamento de Custos ({registrosFinancas.length})
            </span>
            <NotesTable
              registros={registrosFinancas}
              colunas={[
                { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
                { key: 'Conjunto', label: 'Conjunto' },
                { key: 'Status_Nota', label: 'Status Nota', largura: 170 },
                { key: 'Planejado_DDPM', label: 'Valor Planejado', numeric: true, largura: 150 },
                { key: 'Mes_Execucao_Planejado', label: 'Mês Execução' },
                { key: 'Regional', label: 'Regional' },
                { key: 'Circuito', label: 'Circuito' },
                { key: 'Local_Instalacao', label: 'Local Instalação' },
              ]}
              altura={380}
            />
          </div>
        </>
      )}

      {/* CONTEÚDO DA ABA: EM PLANEJAMENTO (STATUS 10) */}
      {tab === 'planejamento' && (
        <>
          {/* Card de Disparo do E-mail de Engenharia */}
          <div className="flex justify-between items-center bg-surface border border-line p-[14px] rounded-[8px] gap-[12px] flex-wrap shadow-xs">
            <div className="flex items-center gap-[10px]">
              <div className="p-[8px] rounded-full bg-primary/10 text-primary">
                <Mail size={18} />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-text">Relatório Diário de Engenharia (Status 10)</h4>
                <p className="text-[11.5px] text-text-mute">
                  Gera a tabela analítica formatada e abre o rascunho de e-mail no Outlook pronto para disparo aos engenheiros.
                </p>
              </div>
            </div>
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

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px] shrink-0">
            {/* Bloco de KPIs e Gráficos de Prioridade */}
            <Card className="lg:col-span-2 bg-surface border border-line flex flex-col justify-between">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Métricas do Backlog (Status 10)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[20px] justify-between h-full">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-[10px]">
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Qtd Notas Backlog
                    </span>
                    <strong className="text-[16px] font-mono text-text">
                      {registrosPlanejamento.length.toLocaleString('pt-BR')}
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Valor Total em Planejamento
                    </span>
                    <strong className="text-[15px] font-mono text-primary">
                      R$ {formatarNumero(totaisPlanejamento.totalValor)}
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Notas Prioritárias/Urgentes
                    </span>
                    <strong className="text-[15px] font-mono text-red">
                      {totaisPlanejamento.urgentesOuEmergentes}
                    </strong>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-[24px] border-t border-line pt-[16px]">
                  {/* Progress bars por Regional (Valor) */}
                  <div>
                    <h4 className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                      Orçamento do Backlog por Regional
                    </h4>
                    <div className="flex flex-col gap-[10px] max-h-[160px] overflow-y-auto pr-[4px]">
                      {totaisPlanejamento.distReg.map(([reg, info]) => {
                        const percent = totaisPlanejamento.totalValor > 0 ? (info.valor / totaisPlanejamento.totalValor) * 100 : 0;
                        return (
                          <div key={reg} className="flex flex-col gap-[3px] w-full text-[12px]">
                            <div className="flex justify-between font-sans text-[11.5px]">
                              <span className="text-text font-medium">{reg} ({info.qtd} notas)</span>
                              <span className="text-text-mute font-mono">
                                R$ {formatarNumero(info.valor)} ({percent.toFixed(1)}%)
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
                    <h4 className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
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
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Filtros do Backlog
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[12px]">
                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
                    Mês Planejado
                  </span>
                  <MultiSelect
                    options={valoresUnicos(
                      dados.registros.filter((n) => String(n.Status_Nota ?? '').startsWith('10')),
                      'Mes_Execucao_Planejado'
                    ).sort()}
                    selected={planMeses}
                    onChange={setPlanMeses}
                    placeholder="Todos os meses"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
                    Regional
                  </span>
                  <MultiSelect
                    options={valoresUnicos(
                      dados.registros.filter((n) => String(n.Status_Nota ?? '').startsWith('10')),
                      'Regional'
                    )}
                    selected={planRegionais}
                    onChange={setPlanRegionais}
                    placeholder="Todas as regionais"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
                    Prioridade
                  </span>
                  <MultiSelect
                    options={valoresUnicos(
                      dados.registros.filter((n) => String(n.Status_Nota ?? '').startsWith('10')),
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

          {/* Tabela do Backlog (Status 10) */}
          <div className="flex flex-col gap-[6px] flex-1 min-h-[300px]">
            <span className="text-[12px] font-semibold text-text-dim uppercase tracking-wider font-sans ml-[4px]">
              Notas de Backlog em Planejamento ({registrosPlanejamento.length})
            </span>
            <NotesTable
              registros={registrosPlanejamento}
              colunas={[
                { key: 'Numero_Nota', label: 'Nº Nota', numeric: true },
                { key: 'Conjunto', label: 'Conjunto' },
                { key: 'Local_Instalacao', label: 'Local Instalação', largura: 150 },
                { key: 'Planejado_DDPM', label: 'Valor Planejado', numeric: true, largura: 130 },
                { key: 'Mes_Execucao_Planejado', label: 'Mês Planejado' },
                { key: 'Prioridade_Nota', label: 'Prioridade' },
                { key: 'Regional', label: 'Regional' },
                { key: 'Centro_Responsavel', label: 'Centro Responsável' },
                { key: 'Observacao', label: 'Observação', largura: 250 },
              ]}
              altura={380}
            />
          </div>
        </>
      )}

      {/* CONTEÚDO DA ABA: ADERÊNCIA AO CRONOGRAMA (SLA) */}
      {tab === 'aderencia' && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-[16px] shrink-0">
            {/* Bloco de KPIs e Gráficos de Aderência */}
            <Card className="lg:col-span-2 bg-surface border border-line flex flex-col justify-between">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Métricas de Aderência ao Cronograma (SLA)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[20px] justify-between h-full">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-[10px]">
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Índice de Aderência
                    </span>
                    <strong className="text-[16px] font-mono text-green">
                      {kpisSLA.indexAderencia.toFixed(1)}%
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Média de Desvio
                    </span>
                    <strong className="text-[16px] font-mono text-text">
                      {kpisSLA.mediaDesvio.toFixed(1)} m
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Notas Concluídas
                    </span>
                    <strong className="text-[16px] font-mono text-blue">
                      {kpisSLA.concluidas}
                    </strong>
                  </div>
                  <div className="bg-bg-2 border border-line-2 rounded-[8px] p-[10px] flex flex-col gap-[2px]">
                    <span className="text-[11px] font-sans text-text-mute uppercase tracking-wider">
                      Pendentes Atrasadas
                    </span>
                    <strong className="text-[16px] font-mono text-red">
                      {kpisSLA.pendentesAtrasadas}
                    </strong>
                  </div>
                </div>

                <div className="border-t border-line pt-[16px]">
                  <h4 className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-[10px] font-sans border-b border-line-2 pb-[4px]">
                    Distribuição dos Desvios de Planejamento (Aderência Geral)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-[14px]">
                    {distribuicaoSLA.map(([desvioTipo, qtd]) => {
                      const totalSLA = kpisSLA.totalFiltradas || 1;
                      const percent = (qtd / totalSLA) * 100;
                      const barColor =
                        desvioTipo.startsWith('Atrasado') || desvioTipo === 'Pendente Atrasado'
                          ? 'bg-red'
                          : desvioTipo === 'Adiantado' || desvioTipo === 'No Prazo'
                          ? 'bg-primary'
                          : 'bg-text-mute';
                      return (
                        <div key={desvioTipo} className="flex flex-col gap-[3px] w-full text-[12px]">
                          <div className="flex justify-between font-sans text-[11.5px]">
                            <span className="text-text font-medium">{desvioTipo}</span>
                            <span className="text-text-mute font-mono">
                              {qtd} nota(s) ({percent.toFixed(1)}%)
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
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Bloco de Filtros de SLA */}
            <Card className="bg-surface border border-line">
              <CardHeader className="py-[12px] px-[16px] border-b border-line">
                <CardTitle className="text-[13px] uppercase font-semibold text-text-dim tracking-wider">
                  Filtros de SLA
                </CardTitle>
              </CardHeader>
              <CardContent className="p-[16px] flex flex-col gap-[12px]">
                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
                    Mês Planejado
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Mes_Execucao_Planejado').sort()}
                    selected={slaMeses}
                    onChange={setSlaMeses}
                    placeholder="Todos os meses"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
                    Regional
                  </span>
                  <MultiSelect
                    options={valoresUnicos(dados.registros, 'Regional')}
                    selected={slaRegionais}
                    onChange={setSlaRegionais}
                    placeholder="Todas as regionais"
                  />
                </div>

                <div className="flex flex-col gap-[4px]">
                  <span className="text-[11px] font-semibold text-text-mute uppercase tracking-wider">
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
                    selected={slaStatus}
                    onChange={setSlaStatus}
                    placeholder="Todos os status"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Tabela do SLA */}
          <div className="flex flex-col gap-[6px] flex-1 min-h-[300px]">
            <span className="text-[12px] font-semibold text-text-dim uppercase tracking-wider font-sans ml-[4px]">
              Detalhamento de Aderência e Desvios ({auditadasSLAFlat.length})
            </span>
            <NotesTable registros={auditadasSLAFlat} colunas={COLUNAS_SLA} altura={380} />
          </div>
        </>
      )}
    </SectionPage>
  );
}
