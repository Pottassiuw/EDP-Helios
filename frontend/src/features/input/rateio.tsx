import React from 'react';
import type { InputDataset, NotaInput } from './types';
import type { FiltersState } from './filters';
import { filtrarRegistros } from './overview';
import { InputApi } from './api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegTabs } from '@/components/branded/section';
import {
  ehNotaAtiva,
  ehNotaMaeValida,
  extrairValorUnidadeMedida,
  limparNotaMae,
} from './rateio-lib';
import {
  Search,
  Sparkles,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  Zap,
  CheckCircle2,
  AlertCircle,
  CheckSquare,
  Square,
  ChevronDown,
  User,
  KeyRound,
  ShieldCheck,
  Flame,
  CornerDownRight,
  HelpCircle,
  Filter,
} from 'lucide-react';

interface RateioProps {
  dados: InputDataset;
  estadoFiltros?: FiltersState;
  onClearFilters?: () => void;
  recarregar: () => Promise<void>;
}
interface RelatorioItem {
  Nota: number;
  Status: 'OK' | 'ERRO' | 'TESTE';
  Mensagem: string;
}

export function Rateio({ dados, estadoFiltros, onClearFilters, recarregar }: RateioProps): React.JSX.Element {
  // SAP GUI Credentials State com persistência no localStorage
  const [loginSap, setLoginSap] = React.useState(() => localStorage.getItem('sap_user') ?? '');
  const [senhaSap, setSenhaSap] = React.useState('');
  const [modoTeste, setModoTeste] = React.useState(true);
  const [forcarValidacao, setForcarValidacao] = React.useState(false);
  const [loadingRobot, setLoadingRobot] = React.useState(false);

  // Navegação por abas: 'hierarquico' | 'individual'
  const [subTab, setSubTab] = React.useState<'hierarquico' | 'individual'>('hierarquico');
  const [ignorarFiltrosPainel, setIgnorarFiltrosPainel] = React.useState(false);

  // Relatório de execução
  const [relatorio, setRelatorio] = React.useState<RelatorioItem[] | null>(null);

  const handleUserChange = (val: string) => {
    setLoginSap(val);
    localStorage.setItem('sap_user', val);
  };

  // Helper robusto para comparar valores divergentes de medição
  const ehDivergente = React.useCallback((val: unknown): boolean => {
    if (val === null || val === undefined) return false;
    const str = String(val).trim().toLowerCase();
    return str === 'não' || str === 'nao';
  }, []);

  // Checa se há filtros ativos de busca ou coluna no painel restringindo a exibição
  const temFiltrosAtivos = React.useMemo(() => {
    if (!estadoFiltros) return false;
    return (
      (estadoFiltros.busca ?? '').trim() !== '' ||
      (estadoFiltros.filtros ?? []).some((f) => (f.valores?.length ?? 0) > 0) ||
      Boolean(estadoFiltros.mostrarOcultas)
    );
  }, [estadoFiltros]);

  // Base filtrada pelo estado de filtros (ex: busca, somente2026)
  const registrosBase = React.useMemo(() => {
    if (!estadoFiltros || ignorarFiltrosPainel) return dados.registros;
    return filtrarRegistros(dados.registros, estadoFiltros);
  }, [dados.registros, estadoFiltros, ignorarFiltrosPainel]);

  // 1. FILTRAGEM DE VÍNCULOS MÃE/FILHA
  const ativas = React.useMemo(() => registrosBase.filter((r) => ehNotaAtiva(r.Status_Nota)), [registrosBase]);

  const dfComMae = React.useMemo(() => {
    return ativas
      .map((r): NotaInput & { Nota_Mae_Limpa: string } => ({ ...r, Nota_Mae_Limpa: limparNotaMae(r['Nota_Mae']) }))
      .filter((r) => ehNotaMaeValida(r.Nota_Mae_Limpa) && r.Nota_Mae_Limpa !== '');
  }, [ativas]);

  // Mapeamento de status para checagem se a mãe está ativa
  const statusMap = React.useMemo(() => {
    const map = new Map<string, string>();
    dados.registros.forEach((r) => {
      map.set(String(r.Numero_Nota), String(r.Status_Nota ?? '-'));
    });
    return map;
  }, [dados.registros]);

  // Apenas filhas cujas MÃES também estão ativas
  const ativasComMae = React.useMemo(() => {
    return dfComMae.filter((r) => {
      const stMae = statusMap.get(r.Nota_Mae_Limpa);
      return stMae !== undefined && ehNotaAtiva(stMae);
    });
  }, [dfComMae, statusMap]);

  // Identificação de grupos de notas que possuem divergência entre si
  const { notasMaesComDivergencia } = React.useMemo(() => {
    const maes = new Set<string>();

    const filhasPorMae = new Map<string, Array<NotaInput & { Nota_Mae_Limpa: string }>>();
    ativasComMae.forEach((r) => {
      const list = filhasPorMae.get(r.Nota_Mae_Limpa) ?? [];
      list.push(r);
      filhasPorMae.set(r.Nota_Mae_Limpa, list);
    });

    filhasPorMae.forEach((filhas, maeId) => {
      const maeRow = dados.registros.find((r) => String(r.Numero_Nota) === maeId);
      const grupo = maeRow ? [maeRow, ...filhas] : filhas;
      const temDivergencia = grupo.some((r) => ehDivergente(r.Medida_vs_Planejado));
      if (temDivergencia) {
        maes.add(maeId);
      }
    });

    return {
      notasMaesComDivergencia: Array.from(maes).sort((a, b) => Number(a) - Number(b)),
    };
  }, [ativasComMae, dados.registros, ehDivergente]);

  // Lista de Mães com pendência
  const notasMaesUnicas = notasMaesComDivergencia;

  // Estado da Nota Mãe Selecionada
  const [maeSelecionada, setMaeSelecionada] = React.useState<string>('');
  const [buscaMae, setBuscaMae] = React.useState<string>('');

  // Seleciona a primeira mãe automaticamente se houver
  React.useEffect(() => {
    if (notasMaesUnicas.length > 0 && (!maeSelecionada || !notasMaesUnicas.includes(maeSelecionada))) {
      setMaeSelecionada(notasMaesUnicas[0]);
    } else if (notasMaesUnicas.length === 0) {
      setMaeSelecionada('');
    }
  }, [notasMaesUnicas, maeSelecionada]);

  // Dados da Mãe Selecionada
  const maeRowDetails = React.useMemo(() => {
    if (!maeSelecionada) return null;
    return dados.registros.find((r) => String(r.Numero_Nota) === maeSelecionada) ?? null;
  }, [dados.registros, maeSelecionada]);

  // Filhas da Mãe Selecionada
  const filhasDaMae = React.useMemo(() => {
    if (!maeSelecionada) return [];
    return ativasComMae.filter((r) => r.Nota_Mae_Limpa === maeSelecionada);
  }, [ativasComMae, maeSelecionada]);

  // Unidade de medida da Mãe
  const undMae = React.useMemo<'km' | 'un'>(() => {
    if (!maeRowDetails) return 'km';
    const [, un] = extrairValorUnidadeMedida(maeRowDetails.Medida_SAP);
    return un ?? 'km';
  }, [maeRowDetails]);

  // Estado de novas medidas a serem salvas no rateio hierárquico
  const [novasMedidasHier, setNovasMedidasHier] = React.useState<Record<number, number>>({});

  // Atualiza as medidas iniciais quando muda a mãe selecionada
  React.useEffect(() => {
    if (!maeRowDetails) {
      setNovasMedidasHier({});
      return;
    }
    const initial: Record<number, number> = {};
    const [valMae] = extrairValorUnidadeMedida(maeRowDetails.Medida_SAP);
    initial[maeRowDetails.Numero_Nota] = valMae;

    filhasDaMae.forEach((f) => {
      const [valF] = extrairValorUnidadeMedida(f.Medida_SAP);
      initial[f.Numero_Nota] = valF;
    });

    setNovasMedidasHier(initial);
  }, [maeRowDetails, filhasDaMae]);

  // Cálculos matemáticos do Rateio
  const valMaeTarget = Number(maeRowDetails?.Planejado_DDPM ?? 0);
  const somaFilhas = React.useMemo(() => {
    if (!maeRowDetails) return 0;
    const all = [maeRowDetails, ...filhasDaMae];
    return all.reduce((acc, r) => acc + (novasMedidasHier[r.Numero_Nota] ?? 0), 0);
  }, [maeRowDetails, filhasDaMae, novasMedidasHier]);

  const diferenca = React.useMemo(() => {
    return Number((valMaeTarget - somaFilhas).toFixed(3));
  }, [valMaeTarget, somaFilhas]);

  const somaFechada = React.useMemo(() => {
    if (undMae === 'un') {
      return diferenca === 0;
    }
    return Math.abs(diferenca) <= 0.005;
  }, [diferenca, undMae]);

  const unidadeCorreta = React.useMemo(() => {
    if (undMae === 'un') {
      const all = maeRowDetails ? [maeRowDetails, ...filhasDaMae] : [];
      return all.every((r) => {
        const v = novasMedidasHier[r.Numero_Nota] ?? 0;
        return Number.isInteger(v);
      });
    }
    return true;
  }, [undMae, maeRowDetails, filhasDaMae, novasMedidasHier]);

  // 2. FUNÇÕES DE AÇÃO RÁPIDA DE RATEIO HIERÁRQUICO
  const ratearProporcionalmente = () => {
    if (!maeRowDetails) return;
    const all = [maeRowDetails, ...filhasDaMae];
    const n = all.length;
    if (n === 0) return;

    if (undMae === 'un') {
      const targetInt = Math.floor(valMaeTarget);
      const base = Math.floor(targetInt / n);
      let resto = targetInt % n;

      const next: Record<number, number> = {};
      all.forEach((r) => {
        let quota = base;
        if (resto > 0) {
          quota += 1;
          resto -= 1;
        }
        next[r.Numero_Nota] = quota;
      });
      setNovasMedidasHier(next);
      toast.success(`⚡ Rateio proporcional distribuído igualmente (${n} notas).`);
    } else {
      const quota = Number((valMaeTarget / n).toFixed(3));
      const next: Record<number, number> = {};
      all.forEach((r, i) => {
        if (i === 0) {
          const quotaRestante = Number((valMaeTarget - quota * (n - 1)).toFixed(3));
          next[r.Numero_Nota] = quotaRestante;
        } else {
          next[r.Numero_Nota] = quota;
        }
      });
      setNovasMedidasHier(next);
      toast.success(`⚡ Rateio proporcional distribuído igualmente (${quota} ${undMae}/nota).`);
    }
  };

  const concentrarNaMae = () => {
    if (!maeRowDetails) return;
    const next: Record<number, number> = {};
    next[maeRowDetails.Numero_Nota] = valMaeTarget;
    filhasDaMae.forEach((f) => {
      next[f.Numero_Nota] = 0;
    });
    setNovasMedidasHier(next);
    toast.info('🎯 Medida total concentrada na Nota Mãe (filhas zeradas).');
  };

  const restaurarOriginal = () => {
    if (!maeRowDetails) return;
    const initial: Record<number, number> = {};
    const [valMae] = extrairValorUnidadeMedida(maeRowDetails.Medida_SAP);
    initial[maeRowDetails.Numero_Nota] = valMae;

    filhasDaMae.forEach((f) => {
      const [valF] = extrairValorUnidadeMedida(f.Medida_SAP);
      initial[f.Numero_Nota] = valF;
    });

    setNovasMedidasHier(initial);
    toast.info('↺ Medidas restauradas para os valores lidos do SAP.');
  };

  const fecharRestanteEm = (notaId: number) => {
    setNovasMedidasHier((prev) => {
      const atual = prev[notaId] ?? 0;
      const novo = Number((atual + diferenca).toFixed(3));
      return {
        ...prev,
        [notaId]: Math.max(0, novo),
      };
    });
  };

  // Navegação entre Mães
  const irParaProximaMae = () => {
    if (notasMaesUnicas.length === 0) return;
    const idx = notasMaesUnicas.indexOf(maeSelecionada);
    if (idx < notasMaesUnicas.length - 1) {
      setMaeSelecionada(notasMaesUnicas[idx + 1]);
    } else {
      setMaeSelecionada(notasMaesUnicas[0]);
    }
  };

  const irParaMaeAnterior = () => {
    if (notasMaesUnicas.length === 0) return;
    const idx = notasMaesUnicas.indexOf(maeSelecionada);
    if (idx > 0) {
      setMaeSelecionada(notasMaesUnicas[idx - 1]);
    } else {
      setMaeSelecionada(notasMaesUnicas[notasMaesUnicas.length - 1]);
    }
  };

  // 3. ABA DE REFERÊNCIA INDIVIDUAL
  const dfDivergentes = React.useMemo(() => {
    return ativas.filter((r) => ehDivergente(r.Medida_vs_Planejado));
  }, [ativas, ehDivergente]);

  const [buscaInd, setBuscaInd] = React.useState('');
  const [selecionadasInd, setSelecionadasInd] = React.useState<Set<number>>(new Set());
  const [novasMedidasInd, setNovasMedidasInd] = React.useState<Record<number, number>>({});
  const [unidadesInd, setUnidadesInd] = React.useState<Record<number, 'km' | 'un'>>({});

  // Inicializa dicionários de edição individual
  React.useEffect(() => {
    const medMap: Record<number, number> = {};
    const unMap: Record<number, 'km' | 'un'> = {};

    dfDivergentes.forEach((r) => {
      const [val, un] = extrairValorUnidadeMedida(r.Medida_SAP);
      medMap[r.Numero_Nota] = val;
      unMap[r.Numero_Nota] = un ?? 'km';
    });

    setNovasMedidasInd(medMap);
    setUnidadesInd(unMap);
  }, [dfDivergentes]);

  const dfDivergentesFiltradas = React.useMemo(() => {
    const q = buscaInd.trim().toLowerCase();
    if (!q) return dfDivergentes;
    return dfDivergentes.filter((r) => {
      const num = String(r.Numero_Nota);
      const cnj = String(r.Conjunto ?? '').toLowerCase();
      const loc = String(r.Local_Instalacao ?? '').toLowerCase();
      return num.includes(q) || cnj.includes(q) || loc.includes(q);
    });
  }, [dfDivergentes, buscaInd]);

  const toggleSelecionarTodasInd = () => {
    if (selecionadasInd.size === dfDivergentesFiltradas.length) {
      setSelecionadasInd(new Set());
    } else {
      setSelecionadasInd(new Set(dfDivergentesFiltradas.map((r) => r.Numero_Nota)));
    }
  };

  const igualarPlanejadoEmLote = () => {
    if (selecionadasInd.size === 0) {
      toast.warning('Nenhuma nota selecionada para ajuste.');
      return;
    }
    setNovasMedidasInd((prev) => {
      const next = { ...prev };
      selecionadasInd.forEach((num) => {
        const row = dados.registros.find((r) => r.Numero_Nota === num);
        if (row) {
          next[num] = Number(row['Planejado_DDPM'] ?? 0);
        }
      });
      return next;
    });
    toast.success(`⚡ Medidas de ${selecionadasInd.size} nota(s) igualadas ao Planejado DDPM!`);
  };

  // Validação de unidades individuais
  const individualValido = React.useMemo(() => {
    let ok = true;
    dfDivergentes.forEach((r) => {
      if (!selecionadasInd.has(r.Numero_Nota)) return;
      const val = novasMedidasInd[r.Numero_Nota] ?? 0;
      const unit = unidadesInd[r.Numero_Nota] ?? 'km';
      if (unit === 'un' && !Number.isInteger(val)) {
        ok = false;
      }
    });
    return ok;
  }, [dfDivergentes, selecionadasInd, novasMedidasInd, unidadesInd]);

  // --- AÇÃO PRINCIPAL DE EXECUÇÃO NO ROBÔ SAP ---
  async function executarNoSap(): Promise<void> {
    if (loadingRobot) return;
    setRelatorio(null);

    const correcoes: Array<{ nota: number; quantidade: number; unidade: string }> = [];

    if (subTab === 'hierarquico') {
      if (!maeSelecionada) return;
      if ((!somaFechada || !unidadeCorreta) && !forcarValidacao) {
        toast.error('O robô não pode ser executado devido a pendências de validação matemática. Marque "Forçar Execução" se desejar prosseguir mesmo assim.');
        return;
      }
      const rows = [maeRowDetails!, ...filhasDaMae];
      rows.forEach((r) => {
        correcoes.push({
          nota: r.Numero_Nota,
          quantidade: novasMedidasHier[r.Numero_Nota] ?? 0,
          unidade: undMae,
        });
      });
    } else {
      if (selecionadasInd.size === 0) {
        toast.warning('Nenhuma nota selecionada para correção.');
        return;
      }
      if (!individualValido && !forcarValidacao) {
        toast.error('Erro de validação: valores decimais em unidades do tipo "un" (Equipamento). Marque "Forçar Execução" se desejar prosseguir.');
        return;
      }

      dfDivergentes.forEach((r) => {
        if (!selecionadasInd.has(r.Numero_Nota)) return;
        correcoes.push({
          nota: r.Numero_Nota,
          quantidade: novasMedidasInd[r.Numero_Nota] ?? 0,
          unidade: unidadesInd[r.Numero_Nota] ?? 'km',
        });
      });
    }

    setLoadingRobot(true);
    const p = InputApi.executarRateio(correcoes, loginSap.trim() || undefined, senhaSap.trim() || undefined, modoTeste);

    toast.promise(p, {
      loading: `Disparando robô SAP para ajustar ${correcoes.length} nota(s)... 🤖`,
      success: (res) => {
        setRelatorio(res.relatorio);
        void recarregar();
        return modoTeste
          ? 'Simulação do Robô SAP executada com sucesso!'
          : 'Gravação Real concluída! Planilha IW66 e banco de dados atualizados.';
      },
      error: (e: unknown) => {
        return `Falha no Robô SAP: ${e instanceof Error ? e.message : String(e)}`;
      },
    });

    try {
      await p;
    } catch {
      // Tratado pelo toast.promise
    } finally {
      setLoadingRobot(false);
    }
  }

  function handleIndCheckboxToggle(nota: number): void {
    setSelecionadasInd((prev) => {
      const next = new Set(prev);
      if (next.has(nota)) next.delete(nota); else next.add(nota);
      return next;
    });
  }

  // Notas mãe filtradas pelo termo de busca
  const maesFiltradas = React.useMemo(() => {
    const q = buscaMae.trim().toLowerCase();
    if (!q) return notasMaesUnicas;
    return notasMaesUnicas.filter((maeId) => {
      const maeRow = dados.registros.find((r) => String(r.Numero_Nota) === maeId);
      const conj = String(maeRow?.Conjunto ?? '').toLowerCase();
      const loc = String(maeRow?.Local_Instalacao ?? '').toLowerCase();
      return maeId.includes(q) || conj.includes(q) || loc.includes(q);
    });
  }, [notasMaesUnicas, buscaMae, dados.registros]);

  return (
    <div className="flex flex-col gap-5 w-full">
      {/* Cabeçalho da Seção de Rateio */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-wider text-accent font-mono">Automação SAP · IW66 / IW28</span>
          <h2 className="text-xl font-medium text-foreground">Rateio de Medidas Físicas</h2>
          <p className="text-xs text-text-dim mt-0.5">
            Distribuição e balanceamento de medidas físicas (km / un) entre grupos hierárquicos e gravação no SAP.
          </p>
        </div>
      </div>

      {/* Banner de Aviso quando há Filtros Globais / Busca Ativa */}
      {temFiltrosAtivos && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/25 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-600 dark:text-amber-400">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 shrink-0" />
            <span>
              Filtro do painel ativo ({registrosBase.length} de {dados.registros.length} notas).{' '}
              {ignorarFiltrosPainel
                ? 'Exibindo todas as divergências da base completa.'
                : estadoFiltros?.busca
                ? `Filtrando pela busca: "${estadoFiltros.busca}".`
                : 'Filtros de pesquisa aplicados no cabeçalho.'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIgnorarFiltrosPainel((v) => !v)}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 font-medium rounded-lg transition-colors cursor-pointer"
            >
              {ignorarFiltrosPainel ? 'Aplicar Filtros do Painel' : 'Mostrar Todas as Divergências da Base'}
            </button>
            {onClearFilters && (
              <button
                type="button"
                onClick={onClearFilters}
                className="px-2.5 py-1 bg-surface border border-line hover:border-text-mute font-medium rounded-lg transition-colors cursor-pointer text-foreground"
              >
                Limpar Filtros
              </button>
            )}
          </div>
        </div>
      )}

      {/* Barra de Autenticação SAP & Chave de Modo */}
      <div className="p-3.5 bg-surface-2/60 border border-line rounded-xl flex items-center justify-between gap-4 flex-wrap shadow-2xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-lg border border-line">
            <User className="h-4 w-4 text-text-mute shrink-0" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-mono tracking-wider text-text-mute leading-tight">Usuário SAP</span>
              <input
                id="sap-usr"
                value={loginSap}
                onChange={(e) => handleUserChange(e.target.value)}
                className="h-5 text-xs font-mono font-medium bg-transparent border-0 outline-none text-foreground w-28"
                placeholder="Ex: 713105"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-lg border border-line">
            <KeyRound className="h-4 w-4 text-text-mute shrink-0" />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-mono tracking-wider text-text-mute leading-tight">Senha SAP (Opcional)</span>
              <input
                id="sap-pwd"
                type="password"
                value={senhaSap}
                onChange={(e) => setSenhaSap(e.target.value)}
                className="h-5 text-xs bg-transparent border-0 outline-none text-foreground w-28"
                placeholder="••••••••"
              />
            </div>
          </div>
        </div>

        {/* Chave de Alternância: Simulação vs Modo Real */}
        <div className="flex items-center gap-1 bg-surface p-1 rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setModoTeste(true)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
              modoTeste
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-2xs font-medium'
                : 'text-text-mute hover:text-foreground'
            }`}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Simulação (Teste)</span>
          </button>
          <button
            type="button"
            onClick={() => setModoTeste(false)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
              !modoTeste
                ? 'bg-red/15 text-red border border-red/30 shadow-2xs font-medium'
                : 'text-text-mute hover:text-foreground'
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            <span>Modo Real (SAP)</span>
          </button>
        </div>
      </div>

      {/* Sub-Abas do Rateio */}
      <div className="border-b border-line">
        <SegTabs
          tabs={[
            { id: 'hierarquico', rotulo: `Rateio Hierárquico (${notasMaesUnicas.length} Mães Pendentes)` },
            { id: 'individual', rotulo: `Referência Individual (${dfDivergentes.length} Divergências)` },
          ]}
          value={subTab}
          onChange={(val) => {
            setSubTab(val as 'hierarquico' | 'individual');
            setRelatorio(null);
          }}
          ariaLabel="Abas do Rateio de Medidas"
        />
      </div>

      {subTab === 'hierarquico' ? (
        // --- VISÃO DE RATEIO HIERÁRQUICO ---
        <div className="flex flex-col gap-4">
          {notasMaesUnicas.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-line rounded-xl bg-surface-2/30 text-text-mute text-xs flex flex-col items-center gap-2">
              <span className="text-2xl">🎉</span>
              <span className="font-medium text-foreground">Tudo em dia!</span>
              <span>Nenhum grupo hierárquico com divergências de medição pendente no momento.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Barra de Seleção e Navegação da Nota Mãe */}
              <div className="flex items-center justify-between gap-3 flex-wrap bg-surface border border-line p-3 rounded-xl shadow-2xs">
                <div className="flex items-center gap-3 flex-1 min-w-[320px]">
                  <div className="flex flex-col gap-1 flex-1">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="select-mae" className="text-xs font-medium text-foreground">
                        Selecionar Nota Mãe:
                      </Label>
                      <span className="text-[11px] font-mono text-text-mute">
                        {notasMaesUnicas.indexOf(maeSelecionada) + 1} de {notasMaesUnicas.length} pendentes
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <select
                          id="select-mae"
                          value={maeSelecionada}
                          onChange={(e) => setMaeSelecionada(e.target.value)}
                          className="h-9 w-full rounded-lg border border-line bg-surface-2 px-3 text-xs font-mono font-medium outline-none focus:border-primary pr-8 appearance-none cursor-pointer"
                        >
                          <option value="">Selecione uma Nota Mãe...</option>
                          {maesFiltradas.map((maeId) => {
                            const maeRow = dados.registros.find((r) => String(r.Numero_Nota) === maeId);
                            const plan = maeRow?.Planejado_DDPM ?? 0;
                            const sap = maeRow?.Medida_SAP ?? '-';
                            const conj = maeRow?.Conjunto ?? '-';
                            const filhasCount = ativasComMae.filter((r) => r.Nota_Mae_Limpa === maeId).length;
                            return (
                              <option key={maeId} value={maeId}>
                                Nota {maeId} | {conj} ({filhasCount} filhas) — Plan: {plan} | SAP: {sap}
                              </option>
                            );
                          })}
                        </select>
                        <ChevronDown size={14} className="absolute right-3 top-3 text-text-mute pointer-events-none" />
                      </div>

                      {/* Campo de Busca Rápida */}
                      <div className="relative w-48">
                        <Search size={13} className="absolute left-2.5 top-3 text-text-mute" />
                        <input
                          type="text"
                          value={buscaMae}
                          onChange={(e) => setBuscaMae(e.target.value)}
                          placeholder="Filtrar mães..."
                          className="h-9 w-full pl-8 pr-2.5 text-xs rounded-lg border border-line bg-surface-2 text-foreground outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Botões de Navegação Anterior / Próxima */}
                <div className="flex items-center gap-1.5 self-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={irParaMaeAnterior}
                    title="Ir para Nota Mãe Anterior"
                    className="h-9 px-3 text-xs font-medium gap-1.5"
                  >
                    <ArrowLeft size={13} /> Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={irParaProximaMae}
                    title="Ir para Próxima Nota Mãe Pendente"
                    className="h-9 px-3 text-xs font-medium gap-1.5"
                  >
                    Próxima <ArrowRight size={13} />
                  </Button>
                </div>
              </div>

              {maeRowDetails && (
                <div className="flex flex-col gap-4">
                  {/* Card de Métricas da Nota Mãe */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="p-3.5 bg-surface border border-line rounded-xl shadow-2xs flex flex-col justify-between">
                      <span className="text-[11px] text-text-mute font-medium uppercase font-mono tracking-wider">Nota Mãe</span>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="font-mono text-base font-medium text-foreground">#{maeSelecionada}</span>
                        <span className="text-[10.5px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                          {filhasDaMae.length} {filhasDaMae.length === 1 ? 'filha' : 'filhas'}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 bg-surface border border-line rounded-xl shadow-2xs flex flex-col justify-between">
                      <span className="text-[11px] text-text-mute font-medium uppercase font-mono tracking-wider">Conjunto / Regional</span>
                      <div className="mt-1">
                        <span className="font-medium text-foreground text-xs">{maeRowDetails.Conjunto}</span>
                        <span className="text-text-mute text-xs ml-1.5">({maeRowDetails.Regional})</span>
                      </div>
                    </div>

                    <div className="p-3.5 bg-surface border border-line rounded-xl shadow-2xs flex flex-col justify-between">
                      <span className="text-[11px] text-text-mute font-medium uppercase font-mono tracking-wider">Local de Instalação</span>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="font-mono font-medium text-foreground text-xs">{maeRowDetails.Local_Instalacao}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-mute border border-line">
                          {maeRowDetails.Status_Nota}
                        </span>
                      </div>
                    </div>

                    <div className="p-3.5 bg-surface border border-line rounded-xl shadow-2xs flex flex-col justify-between">
                      <span className="text-[11px] text-text-mute font-medium uppercase font-mono tracking-wider">Medida Alvo vs SAP</span>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="font-mono text-xs font-medium text-primary">{maeRowDetails.Planejado_DDPM} {undMae}</span>
                        <span className="text-[11px] text-text-mute font-mono">SAP: {maeRowDetails.Medida_SAP}</span>
                      </div>
                    </div>
                  </div>

                  {/* Barra de Ações Rápidas de Rateio */}
                  <div className="flex items-center justify-between gap-3 flex-wrap bg-surface-2/70 border border-line px-3.5 py-2.5 rounded-xl">
                    <div className="flex items-center gap-2">
                      <Sparkles size={14} className="text-primary" />
                      <span className="text-xs font-medium text-foreground">Ações de Distribuição Rápida:</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={ratearProporcionalmente}
                        className="h-8 text-xs font-medium gap-1.5 shadow-2xs"
                      >
                        <Zap size={13} /> Ratear Proporcionalmente
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={concentrarNaMae}
                        className="h-8 text-xs font-medium"
                      >
                        Concentrar na Mãe
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={restaurarOriginal}
                        className="h-8 text-xs font-medium gap-1.5 text-text-mute hover:text-foreground"
                      >
                        <RotateCcw size={12} /> Restaurar Original
                      </Button>
                    </div>
                  </div>

                  {/* Tabela de Medidas */}
                  <div className="border border-line rounded-xl overflow-hidden bg-surface shadow-2xs">
                    <table className="w-full border-collapse text-xs text-left">
                      <thead>
                        <tr className="bg-surface-2 border-b border-line text-text-mute font-mono text-[10.5px] uppercase tracking-wider">
                          <th className="py-2.5 px-3 font-medium w-16">Tipo</th>
                          <th className="py-2.5 px-3 font-medium">Nº Nota</th>
                          <th className="py-2.5 px-3 font-medium">Local Instalação</th>
                          <th className="py-2.5 px-3 font-medium text-right">Planejado DDPM</th>
                          <th className="py-2.5 px-3 font-medium">Medida Atual SAP</th>
                          <th className="py-2.5 px-3 font-medium text-center">Status</th>
                          <th className="py-2.5 px-3 font-medium w-48 text-right">Nova Medida ({undMae})</th>
                          <th className="py-2.5 px-3 font-medium w-28 text-center">Ajuste</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Linha da Mãe */}
                        <tr className="border-b border-line bg-primary/5 hover:bg-primary/10 transition-colors">
                          <td className="py-2 px-3">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-primary text-primary-foreground">
                              MÃE
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono font-medium text-foreground">{maeRowDetails.Numero_Nota}</td>
                          <td className="py-2 px-3 font-mono text-text-dim">{maeRowDetails.Local_Instalacao}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium">{maeRowDetails.Planejado_DDPM}</td>
                          <td className="py-2 px-3 font-mono text-text-dim">{maeRowDetails.Medida_SAP}</td>
                          <td className="py-2 px-3 text-center">
                            <span className={`inline-block text-[10.5px] font-medium px-2 py-0.5 rounded-full ${
                              maeRowDetails.Medida_vs_Planejado === 'Sim' ? 'bg-green/10 text-green' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            }`}>
                              {maeRowDetails.Medida_vs_Planejado === 'Sim' ? 'OK' : 'Divergente'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <Input
                              type="number"
                              step={undMae === 'un' ? '1' : '0.001'}
                              value={novasMedidasHier[maeRowDetails.Numero_Nota] ?? 0}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setNovasMedidasHier((prev) => ({ ...prev, [maeRowDetails.Numero_Nota]: v }));
                              }}
                              className="h-8 py-0 px-2 text-right text-xs border-line font-mono font-medium bg-surface w-36 ml-auto"
                            />
                          </td>
                          <td className="py-2 px-3 text-center">
                            {Math.abs(diferenca) > 1e-5 && (
                              <button
                                type="button"
                                onClick={() => fecharRestanteEm(maeRowDetails.Numero_Nota)}
                                className="text-[11px] font-medium text-primary hover:underline cursor-pointer bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded-md transition-colors"
                                title="Jogar a diferença restante nesta nota"
                              >
                                + Restante
                              </button>
                            )}
                          </td>
                        </tr>

                        {/* Linhas das Filhas */}
                        {filhasDaMae.map((f) => (
                          <tr key={f.Numero_Nota} className="border-b border-line bg-surface hover:bg-surface-2/80 transition-colors">
                            <td className="py-2 px-3">
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-sans font-medium bg-surface-2 text-text-mute border border-line">
                                <CornerDownRight className="h-3 w-3 text-accent" />
                                FILHA
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono font-medium text-foreground">{f.Numero_Nota}</td>
                            <td className="py-2 px-3 font-mono text-text-dim">{f.Local_Instalacao}</td>
                            <td className="py-2 px-3 text-right font-mono text-text-dim">{f.Planejado_DDPM}</td>
                            <td className="py-2 px-3 font-mono text-text-dim">{f.Medida_SAP}</td>
                            <td className="py-2 px-3 text-center">
                              <span className={`inline-block text-[10.5px] font-medium px-2 py-0.5 rounded-full ${
                                f.Medida_vs_Planejado === 'Sim' ? 'bg-green/10 text-green' : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                              }`}>
                                {f.Medida_vs_Planejado === 'Sim' ? 'OK' : 'Divergente'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right">
                              <Input
                                type="number"
                                step={undMae === 'un' ? '1' : '0.001'}
                                value={novasMedidasHier[f.Numero_Nota] ?? 0}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value) || 0;
                                  setNovasMedidasHier((prev) => ({ ...prev, [f.Numero_Nota]: v }));
                                }}
                                className="h-8 py-0 px-2 text-right text-xs border-line font-mono bg-surface w-36 ml-auto"
                              />
                            </td>
                            <td className="py-2 px-3 text-center">
                              {Math.abs(diferenca) > 1e-5 && (
                                <button
                                  type="button"
                                  onClick={() => fecharRestanteEm(f.Numero_Nota)}
                                  className="text-[11px] font-medium text-primary hover:underline cursor-pointer bg-primary/10 hover:bg-primary/20 px-2 py-1 rounded-md transition-colors"
                                  title="Jogar a diferença restante nesta nota"
                                >
                                  + Restante
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Painel de Métricas e Balanço */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3.5 bg-surface border border-line rounded-xl shadow-2xs">
                      <span className="text-[11px] text-text-mute font-medium">Total Alvo (Planejado DDPM)</span>
                      <div className="text-base font-medium mt-1 font-mono text-foreground">
                        {valMaeTarget.toFixed(3)} {undMae}
                      </div>
                    </div>
                    <div className="p-3.5 bg-surface border border-line rounded-xl shadow-2xs">
                      <span className="text-[11px] text-text-mute font-medium">Soma Distribuída Atual</span>
                      <div className="text-base font-medium mt-1 font-mono text-foreground">
                        {somaFilhas.toFixed(3)} {undMae}
                      </div>
                    </div>
                    <div className={`p-3.5 border rounded-xl shadow-2xs ${
                      somaFechada ? 'border-green/30 bg-green/5' : 'border-red/30 bg-red/5'
                    }`}>
                      <span className="text-[11px] text-text-mute font-medium">Diferença Restante</span>
                      <div className={`text-base font-medium mt-1 font-mono flex items-center gap-1.5 ${
                        somaFechada ? 'text-green' : 'text-red'
                      }`}>
                        {somaFechada ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                        <span>{diferenca > 0 ? `+${diferenca.toFixed(3)}` : diferenca.toFixed(3)} {undMae}</span>
                      </div>
                    </div>
                  </div>

                  {/* Avisos e Botão de Disparo do SAP */}
                  <div className="flex flex-col gap-3">
                    {!somaFechada && (
                      <div className="p-3 bg-red/10 border border-red/20 text-red text-xs rounded-xl flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span><strong>Divergência matemática:</strong> A soma das medidas difere em {Math.abs(diferenca).toFixed(3)} {undMae} do planejado. Use <strong>Ratear Proporcionalmente</strong> ou <strong>+ Restante</strong>.</span>
                      </div>
                    )}
                    {somaFechada && Math.abs(diferenca) > 1e-5 && (
                      <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs rounded-xl flex items-center gap-2">
                        <HelpCircle className="h-4 w-4 shrink-0" />
                        <span><strong>Tolerância aceita:</strong> Há uma variação residual de {Math.round(Math.abs(diferenca) * 1000)} mm/un aceita pelo sistema.</span>
                      </div>
                    )}

                    <div className="flex gap-4 items-center justify-between flex-wrap pt-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="forcar-val"
                          checked={forcarValidacao}
                          onChange={(e) => setForcarValidacao(e.target.checked)}
                          className="w-4 h-4 rounded border-line cursor-pointer"
                        />
                        <Label htmlFor="forcar-val" className="text-xs cursor-pointer text-text-mute font-normal">
                          Forçar Execução (Ignorar validação matemática)
                        </Label>
                      </div>
                      <Button
                        variant="default"
                        onClick={executarNoSap}
                        disabled={loadingRobot || (!somaFechada && !forcarValidacao) || (undMae === 'un' && !unidadeCorreta)}
                        className="font-medium text-xs h-9 px-5 shadow-xs"
                      >
                        {loadingRobot ? 'Processando no SAP GUI...' : !modoTeste ? '🚀 Gravar no SAP (Modo Real)' : '⚡ Simular no SAP (Teste)'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        // --- VISÃO DE REFERÊNCIA INDIVIDUAL ---
        <div className="flex flex-col gap-4">
          {dfDivergentes.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-line rounded-xl bg-surface-2/30 text-text-mute text-xs flex flex-col items-center gap-2">
              <span className="text-2xl">🎉</span>
              <span className="font-medium text-foreground">Sem divergências</span>
              <span>Nenhuma nota ativa com divergência de medição física encontrada no banco de dados.</span>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Barra de Busca e Ações em Lote */}
              <div className="flex items-center justify-between gap-3 flex-wrap bg-surface border border-line p-3 rounded-xl shadow-2xs">
                <div className="relative flex items-center w-80">
                  <Search size={14} className="absolute left-3 text-text-mute" />
                  <Input
                    type="text"
                    value={buscaInd}
                    onChange={(e) => setBuscaInd(e.target.value)}
                    placeholder="Buscar por nota, conjunto ou local..."
                    className="pl-9 pr-3 h-9 text-xs w-full"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelecionarTodasInd}
                    className="h-9 text-xs font-medium gap-1.5"
                  >
                    {selecionadasInd.size === dfDivergentesFiltradas.length ? <CheckSquare size={13} /> : <Square size={13} />}
                    {selecionadasInd.size === dfDivergentesFiltradas.length ? 'Deselecionar Todas' : 'Selecionar Todas'}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={igualarPlanejadoEmLote}
                    disabled={selecionadasInd.size === 0}
                    className="h-9 text-xs font-medium gap-1.5 shadow-2xs"
                  >
                    <Zap size={13} /> Igualar ao Planejado ({selecionadasInd.size})
                  </Button>
                </div>
              </div>

              {/* Tabela de Notas Divergentes */}
              <div className="border border-line rounded-xl overflow-hidden bg-surface max-h-[460px] overflow-y-auto shadow-2xs">
                <table className="w-full border-collapse text-xs text-left">
                  <thead>
                    <tr className="bg-surface-2 border-b border-line text-text-mute font-mono text-[10.5px] uppercase tracking-wider sticky top-0 z-10">
                      <th className="py-2.5 px-3 font-medium w-14 text-center">Corrigir?</th>
                      <th className="py-2.5 px-3 font-medium">Nº Nota</th>
                      <th className="py-2.5 px-3 font-medium">Conjunto</th>
                      <th className="py-2.5 px-3 font-medium">Local Instalação</th>
                      <th className="py-2.5 px-3 font-medium text-right">Planejado DDPM</th>
                      <th className="py-2.5 px-3 font-medium">Medida SAP</th>
                      <th className="py-2.5 px-3 font-medium">Nota Mãe</th>
                      <th className="py-2.5 px-3 font-medium w-24">Unidade</th>
                      <th className="py-2.5 px-3 font-medium w-36 text-right">Nova Medida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dfDivergentesFiltradas.map((r) => {
                      const num = r.Numero_Nota;
                      const selected = selecionadasInd.has(num);
                      const unit = unidadesInd[num] ?? 'km';
                      const val = novasMedidasInd[num] ?? 0;
                      const isUnValError = unit === 'un' && !Number.isInteger(val) && selected;

                      return (
                        <tr key={num} className={`border-b border-line hover:bg-surface-2 transition-colors ${isUnValError ? 'bg-red/5' : ''}`}>
                          <td className="py-2 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => handleIndCheckboxToggle(num)}
                              className="w-4 h-4 rounded border-line cursor-pointer"
                            />
                          </td>
                          <td className="py-2 px-3 font-mono font-medium text-foreground">{num}</td>
                          <td className="py-2 px-3">{r.Conjunto}</td>
                          <td className="py-2 px-3 font-mono text-text-dim">{r.Local_Instalacao}</td>
                          <td className="py-2 px-3 text-right font-mono font-medium">{r.Planejado_DDPM}</td>
                          <td className="py-2 px-3 font-mono text-text-dim">{r.Medida_SAP}</td>
                          <td className="py-2 px-3 font-mono text-text-dim">{r.Nota_Mae}</td>
                          <td className="py-1.5 px-3">
                            <select
                              value={unit}
                              onChange={(e) => setUnidadesInd((prev) => ({ ...prev, [num]: e.target.value as 'km' | 'un' }))}
                              className="h-8 w-full rounded border border-line bg-surface text-xs outline-none px-2 font-mono"
                            >
                              <option value="km">km</option>
                              <option value="un">un</option>
                            </select>
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <Input
                              type="number"
                              step={unit === 'un' ? '1' : '0.001'}
                              value={val}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setNovasMedidasInd((prev) => ({ ...prev, [num]: v }));
                              }}
                              className={`h-8 py-0 px-2 text-right text-xs font-mono bg-surface ${isUnValError ? 'border-red' : 'border-line'}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Avisos e Envio em Lote */}
              <div className="flex flex-col gap-2.5">
                {!individualValido && (
                  <div className="p-3 bg-red/10 border border-red/20 text-red text-xs rounded-xl">
                    ❌ <strong>Validação:</strong> Notas com unidade &quot;un&quot; selecionadas precisam de valores inteiros.
                  </div>
                )}
                {selecionadasInd.size === 0 && (
                  <div className="p-3 bg-surface-2 border border-line text-text-mute text-xs rounded-xl">
                    ℹ️ Selecione pelo menos uma nota na tabela para enviar ao SAP.
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 flex-wrap gap-3">
                  <div className="flex items-center gap-4 flex-wrap">
                    <span className="text-xs text-text-mute">
                      Selecionadas: <strong className="text-foreground">{selecionadasInd.size}</strong> nota(s)
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id="forcar-val-ind"
                        checked={forcarValidacao}
                        onChange={(e) => setForcarValidacao(e.target.checked)}
                        className="w-4 h-4 rounded border-line cursor-pointer"
                      />
                      <Label htmlFor="forcar-val-ind" className="text-xs cursor-pointer text-text-mute font-normal">
                        Forçar Execução (ignorar validação)
                      </Label>
                    </div>
                  </div>
                  <Button
                    variant="default"
                    onClick={executarNoSap}
                    disabled={loadingRobot || selecionadasInd.size === 0 || (!individualValido && !forcarValidacao)}
                    className="text-xs font-medium h-9 px-5 shadow-xs"
                  >
                    {loadingRobot ? 'Processando no SAP GUI...' : !modoTeste ? '🚀 Gravar Selecionadas no SAP' : '⚡ Simular Selecionadas no SAP'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RELATÓRIO DE EXECUÇÃO DO ROBÔ SAP */}
      {relatorio && (
        <div className="mt-4 border border-line rounded-xl bg-surface shadow-2xs overflow-hidden">
          <div className="px-4 py-3 border-b border-line bg-surface-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">Relatório de Execução do Robô SAP</span>
            <span className="text-[11px] text-text-mute font-mono">{relatorio.length} nota(s) processada(s)</span>
          </div>
          <div className="p-3">
            <div className="border border-line rounded-lg overflow-hidden max-h-56 overflow-y-auto">
              <table className="w-full border-collapse text-xs text-left">
                <thead>
                  <tr className="bg-surface-2 text-text-mute font-mono text-[10.5px] uppercase border-b border-line">
                    <th className="py-2 px-3">Nota</th>
                    <th className="py-2 px-3 w-24 text-center">Status</th>
                    <th className="py-2 px-3">Mensagem do SAP</th>
                  </tr>
                </thead>
                <tbody>
                  {relatorio.map((r, i) => (
                    <tr key={i} className="border-b border-line hover:bg-surface-2 transition-colors">
                      <td className="py-2 px-3 font-mono font-medium text-foreground">{r.Nota}</td>
                      <td className="py-2 px-3 text-center">
                        <span
                          className={`inline-block py-0.5 px-2 rounded-full font-medium text-[10px] uppercase ${
                            r.Status === 'OK'
                              ? 'bg-green/15 text-green'
                              : r.Status === 'TESTE'
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-red/15 text-red'
                          }`}
                        >
                          {r.Status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-text-mute text-xs">{r.Mensagem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
