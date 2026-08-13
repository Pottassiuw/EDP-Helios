import React from 'react';
import type { InputDataset, NotaInput } from './types';
import type { FiltersState } from './filters';
import { filtrarRegistros } from './overview';
import { InputApi } from './api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SegTabs, SectionPage, Eyebrow } from '@/components/branded/section';
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
} from 'lucide-react';

interface RateioProps {
  dados: InputDataset;
  estadoFiltros?: FiltersState;
  recarregar: () => Promise<void>;
}

interface RelatorioItem {
  Nota: number;
  Status: 'OK' | 'ERRO' | 'TESTE';
  Mensagem: string;
}

export function Rateio({ dados, estadoFiltros, recarregar }: RateioProps): React.JSX.Element {
  // SAP GUI Credentials State com persistência no localStorage
  const [loginSap, setLoginSap] = React.useState(() => localStorage.getItem('sap_user') ?? '');
  const [senhaSap, setSenhaSap] = React.useState('');
  const [modoTeste, setModoTeste] = React.useState(true);
  const [forcarValidacao, setForcarValidacao] = React.useState(false);
  const [loadingRobot, setLoadingRobot] = React.useState(false);

  // Navegação por abas: 'hierarquico' | 'individual'
  const [subTab, setSubTab] = React.useState<'hierarquico' | 'individual'>('hierarquico');

  // Relatório de execução
  const [relatorio, setRelatorio] = React.useState<RelatorioItem[] | null>(null);

  const handleUserChange = (val: string) => {
    setLoginSap(val);
    localStorage.setItem('sap_user', val);
  };

  // Base filtrada pelo estado de filtros (ex: somente2026)
  const registrosBase = React.useMemo(() => {
    if (!estadoFiltros) return dados.registros;
    return filtrarRegistros(dados.registros, estadoFiltros);
  }, [dados.registros, estadoFiltros]);

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

  const ativasComMae = React.useMemo(() => {
    return dfComMae.filter((r) => {
      const stMae = statusMap.get(r.Nota_Mae_Limpa) ?? '-';
      return ehNotaAtiva(stMae);
    });
  }, [dfComMae, statusMap]);

  // Notas mãe únicas que possuem divergência de medição nelas ou nas filhas
  const notasMaesUnicas = React.useMemo(() => {
    const maes = new Set<string>();
    const uniqueMaes = Array.from(new Set(ativasComMae.map((r) => r.Nota_Mae_Limpa)));

    uniqueMaes.forEach((maeId) => {
      const maeRow = dados.registros.find((r) => String(r.Numero_Nota) === maeId);
      const maeDiv = maeRow?.['Medida_vs_Planejado'] === 'Não';

      const filhas = ativasComMae.filter((r) => r.Nota_Mae_Limpa === maeId);
      const filhasDiv = filhas.some((r) => r['Medida_vs_Planejado'] === 'Não');

      if (maeDiv || filhasDiv) {
        maes.add(maeId);
      }
    });

    return Array.from(maes).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  }, [ativasComMae, dados.registros]);

  // --- ESTADO DO RATEIO HIERÁRQUICO ---
  const [maeSelecionada, setMaeSelecionada] = React.useState('');
  const [buscaMae, setBuscaMae] = React.useState('');
  const [novasMedidasHier, setNovasMedidasHier] = React.useState<Record<number, number>>({});

  // Reseta os inputs quando a nota mãe selecionada muda
  React.useEffect(() => {
    if (!maeSelecionada) return;
    const maeRow = dados.registros.find((r) => String(r.Numero_Nota) === maeSelecionada);
    const filhas = ativasComMae.filter((r) => r.Nota_Mae_Limpa === maeSelecionada);
    const initial: Record<number, number> = {};
    if (maeRow) {
      initial[maeRow.Numero_Nota] = Number(maeRow['Planejado_DDPM'] ?? 0);
    }
    filhas.forEach((f) => {
      initial[f.Numero_Nota] = Number(f['Planejado_DDPM'] ?? 0);
    });
    setNovasMedidasHier(initial);
    setRelatorio(null);
  }, [maeSelecionada, ativasComMae, dados.registros]);

  // Detalhes da nota mãe selecionada
  const maeRowDetails = React.useMemo(() => {
    return dados.registros.find((r) => String(r.Numero_Nota) === maeSelecionada);
  }, [maeSelecionada, dados.registros]);

  const filhasDaMae = React.useMemo(() => {
    return ativasComMae.filter((r) => r.Nota_Mae_Limpa === maeSelecionada);
  }, [maeSelecionada, ativasComMae]);

  const undMae = React.useMemo(() => {
    if (!maeRowDetails) return 'km';
    const [, und] = extrairValorUnidadeMedida(maeRowDetails['Medida_SAP'] as string);
    if (und) return und;
    const valMae = Number(maeRowDetails['Planejado_DDPM'] ?? 0.0);
    return Number.isInteger(valMae) && valMae <= 50 ? 'un' : 'km';
  }, [maeRowDetails]);

  // Métricas do Rateio Hierárquico
  const valMaeTarget = React.useMemo(() => {
    if (!maeRowDetails) return 0;
    const valMae = Number(maeRowDetails['Planejado_DDPM'] ?? 0.0);
    const valPlanFilhas = filhasDaMae.reduce((acc, f) => acc + Number(f['Planejado_DDPM'] ?? 0.0), 0);
    return valMae + valPlanFilhas;
  }, [maeRowDetails, filhasDaMae]);

  const somaFilhas = React.useMemo(() => {
    return Object.values(novasMedidasHier).reduce((acc, v) => acc + v, 0);
  }, [novasMedidasHier]);

  const diferenca = valMaeTarget - somaFilhas;
  const tolerancia = undMae === 'km' ? 0.010 : 0.0;
  const somaFechada = forcarValidacao ? true : Math.abs(diferenca) <= (tolerancia + 1e-7);

  // Validação de número inteiro para unidade "un"
  const unidadeCorreta = React.useMemo(() => {
    if (undMae !== 'un') return true;
    return Object.values(novasMedidasHier).every((val) => Number.isInteger(val));
  }, [novasMedidasHier, undMae]);

  // --- AUTOMATIZAÇÕES DO RATEIO HIERÁRQUICO ---

  // 1. Rateio Proporcional Automático
  const ratearProporcionalmente = () => {
    if (!maeRowDetails) return;
    const rows = [maeRowDetails, ...filhasDaMae];
    const totalPlanOriginal = rows.reduce((acc, r) => acc + Number(r['Planejado_DDPM'] ?? 0), 0);

    const novastMedidas: Record<number, number> = {};
    let acumulado = 0;

    rows.forEach((r, idx) => {
      const plan = Number(r['Planejado_DDPM'] ?? 0);
      let val = totalPlanOriginal > 0 ? (plan / totalPlanOriginal) * valMaeTarget : valMaeTarget / rows.length;

      if (undMae === 'km') {
        val = Math.round(val * 1000) / 1000;
      } else {
        val = Math.round(val);
      }

      if (idx < rows.length - 1) {
        acumulado += val;
        novastMedidas[r.Numero_Nota] = val;
      } else {
        // A última nota absorve a pequena sobra de arredondamento para fechar em 0.000 exato
        const resto = valMaeTarget - acumulado;
        novastMedidas[r.Numero_Nota] = undMae === 'km' ? Math.round(resto * 1000) / 1000 : Math.round(resto);
      }
    });

    setNovasMedidasHier(novastMedidas);
    toast.success('⚡ Rateio proporcional aplicado!');
  };

  // 2. Zerar Filhas e Concentrar Medida na Mãe
  const concentrarNaMae = () => {
    if (!maeRowDetails) return;
    const initial: Record<number, number> = {
      [maeRowDetails.Numero_Nota]: valMaeTarget,
    };
    filhasDaMae.forEach((f) => {
      initial[f.Numero_Nota] = 0;
    });
    setNovasMedidasHier(initial);
    toast.info('Medida total concentrada na Nota Mãe.');
  };

  // 3. Fechar Restante na Nota Selecionada
  const fecharRestanteEm = (numeroNota: number) => {
    const valAtual = novasMedidasHier[numeroNota] ?? 0;
    const novoVal = valAtual + diferenca;
    const valAjustado = undMae === 'km' ? Math.round(novoVal * 1000) / 1000 : Math.round(novoVal);
    setNovasMedidasHier((prev) => ({
      ...prev,
      [numeroNota]: Math.max(0, valAjustado),
    }));
    toast.success(`Diferença aplicada na Nota ${numeroNota}!`);
  };

  // 4. Copiar Planejado DDPM (Reset ao original)
  const restaurarOriginal = () => {
    if (!maeRowDetails) return;
    const initial: Record<number, number> = {};
    initial[maeRowDetails.Numero_Nota] = Number(maeRowDetails['Planejado_DDPM'] ?? 0);
    filhasDaMae.forEach((f) => {
      initial[f.Numero_Nota] = Number(f['Planejado_DDPM'] ?? 0);
    });
    setNovasMedidasHier(initial);
    toast.info('Valores originais do Planejado DDPM restaurados.');
  };

  // 5. Navegação entre Notas Mãe (Anterior / Próxima)
  const irParaProximaMae = () => {
    if (notasMaesUnicas.length === 0) return;
    const idxAtual = notasMaesUnicas.indexOf(maeSelecionada);
    if (idxAtual === -1 || idxAtual === notasMaesUnicas.length - 1) {
      setMaeSelecionada(notasMaesUnicas[0]);
    } else {
      setMaeSelecionada(notasMaesUnicas[idxAtual + 1]);
    }
  };

  const irParaMaeAnterior = () => {
    if (notasMaesUnicas.length === 0) return;
    const idxAtual = notasMaesUnicas.indexOf(maeSelecionada);
    if (idxAtual <= 0) {
      setMaeSelecionada(notasMaesUnicas[notasMaesUnicas.length - 1]);
    } else {
      setMaeSelecionada(notasMaesUnicas[idxAtual - 1]);
    }
  };

  // --- ESTADO DO RATEIO INDIVIDUAL ---
  const dfDivergentes = React.useMemo(() => {
    return dados.registros.filter((r) => r['Medida_vs_Planejado'] === 'Não' && ehNotaAtiva(r['Status_Nota']));
  }, [dados.registros]);

  const [buscaInd, setBuscaInd] = React.useState('');
  const [selecionadasInd, setSelecionadasInd] = React.useState<Set<number>>(new Set());
  const [novasMedidasInd, setNovasMedidasInd] = React.useState<Record<number, number>>({});
  const [unidadesInd, setUnidadesInd] = React.useState<Record<number, 'km' | 'un'>>({});

  // Filtragem local na aba individual por termo de busca
  const dfDivergentesFiltradas = React.useMemo(() => {
    const q = buscaInd.trim().toLowerCase();
    if (!q) return dfDivergentes;
    return dfDivergentes.filter((r) => {
      const notaStr = String(r.Numero_Nota);
      const conjStr = String(r.Conjunto ?? '').toLowerCase();
      const locStr = String(r.Local_Instalacao ?? '').toLowerCase();
      return notaStr.includes(q) || conjStr.includes(q) || locStr.includes(q);
    });
  }, [dfDivergentes, buscaInd]);

  // Reseta estado individual quando muda a lista de divergentes
  React.useEffect(() => {
    const sel = new Set<number>();
    const measures: Record<number, number> = {};
    const units: Record<number, 'km' | 'un'> = {};

    dfDivergentes.forEach((r) => {
      sel.add(r.Numero_Nota);
      measures[r.Numero_Nota] = Number(r['Planejado_DDPM'] ?? 0);
      const [, und] = extrairValorUnidadeMedida(r['Medida_SAP'] as string);
      if (und) {
        units[r.Numero_Nota] = und;
      } else {
        const valPlan = Number(r['Planejado_DDPM'] ?? 0.0);
        units[r.Numero_Nota] = Number.isInteger(valPlan) && valPlan <= 50 ? 'un' : 'km';
      }
    });

    setSelecionadasInd(sel);
    setNovasMedidasInd(measures);
    setUnidadesInd(units);
    setRelatorio(null);
  }, [dfDivergentes]);

  // Ações em Lote para Rateio Individual
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
      if (!somaFechada || !unidadeCorreta) {
        toast.error('O robô não pode ser executado devido a pendências de validação matemática.');
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
      if (!individualValido) {
        toast.error('Erro de validação: valores decimais em unidades do tipo "un" (Equipamento).');
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
    <SectionPage className="overflow-y-auto">
      <div className="mb-[20px]">
        <Eyebrow>Rateio de Medidas</Eyebrow>
        <h2 className="text-[18px] font-semibold leading-[1.15] tracking-display text-balance">Ajuste e Rateio de Medidas SAP</h2>
        <p className="text-[12.5px] text-text-mute mt-[2px]">
          Distribua ou corrija as medidas físicas de suas notas diretamente no SAP GUI de forma estruturada, automatizada e validada.
        </p>
      </div>

      {/* CARD DE CREDENCIAIS DO SAP GUI */}
      <Card className="mb-[20px] border-line">
        <CardHeader className="pb-[10px] pt-[14px]">
          <CardTitle className="text-[13.5px] font-semibold flex items-center gap-[8px]">
            🤖 Autenticação SAP GUI
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-[14px]">
          <div className="flex gap-[16px] flex-wrap items-end">
            <div className="flex flex-col gap-[4px] w-[180px]">
              <Label htmlFor="sap-usr" className="text-[11.5px] text-text-mute">Usuário SAP (Lembrado)</Label>
              <Input id="sap-usr" value={loginSap} onChange={(e) => handleUserChange(e.target.value)}
                     className="h-[32px] text-[12.5px]" placeholder="Ex: C123456" />
            </div>
            <div className="flex flex-col gap-[4px] w-[180px]">
              <Label htmlFor="sap-pwd" className="text-[11.5px] text-text-mute">Senha SAP (Opcional)</Label>
              <Input id="sap-pwd" type="password" value={senhaSap} onChange={(e) => setSenhaSap(e.target.value)}
                     className="h-[32px] text-[12.5px]" placeholder="••••••••" />
            </div>
            <div className="flex items-center gap-[8px] h-[32px] bg-bg-2 border border-line-2 px-[12px] rounded-sm">
              <Switch checked={!modoTeste} onCheckedChange={(val) => setModoTeste(!val)} id="modo-real" size="sm" />
              <Label htmlFor="modo-real" className="text-[12px] font-medium cursor-pointer">
                {!modoTeste ? '🔴 Gravar no SAP (Modo Real)' : '🟡 Apenas Simular (Modo Teste)'}
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SELEÇÃO DE ABAS */}
      <div className="border-b border-line mb-[16px]">
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
        <div className="flex flex-col gap-[16px]">
          {notasMaesUnicas.length === 0 ? (
            <div className="p-[24px] text-center border border-dashed border-line rounded-[8px] text-text-mute text-[13px]">
              🎉 Nenhum vínculo de hierarquia (Notas Filhas com Nota Mãe) com divergências de medição no banco atualmente.
            </div>
          ) : (
            <div className="flex flex-col gap-[16px]">
              {/* Barra de Seleção e Navegação de Notas Mãe */}
              <div className="flex items-center gap-[12px] flex-wrap bg-surface border border-line p-[12px] rounded-[8px] shadow-sm">
                <div className="flex flex-col gap-[4px] flex-1 min-w-[280px]">
                  <Label htmlFor="select-mae" className="text-[12px] font-semibold text-text-dim flex items-center justify-between">
                    <span>Selecione a Nota Mãe:</span>
                    <span className="text-[11px] font-normal text-text-mute">
                      {notasMaesUnicas.indexOf(maeSelecionada) + 1} de {notasMaesUnicas.length} pendentes
                    </span>
                  </Label>
                  <div className="flex gap-[8px]">
                    <div className="relative flex-1">
                      <select
                        id="select-mae"
                        value={maeSelecionada}
                        onChange={(e) => setMaeSelecionada(e.target.value)}
                        className="h-[34px] w-full rounded-[6px] border border-line bg-bg-2 px-[10px] text-[12.5px] font-mono outline-none focus:border-primary pr-[28px] appearance-none"
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
                      <ChevronDown size={14} className="absolute right-[10px] top-[10px] text-text-mute pointer-events-none" />
                    </div>
                    {/* Campo de Busca Rápida na Lista de Mães */}
                    <div className="relative w-[180px]">
                      <Search size={12} className="absolute left-[8px] top-[11px] text-text-mute" />
                      <input
                        type="text"
                        value={buscaMae}
                        onChange={(e) => setBuscaMae(e.target.value)}
                        placeholder="Filtrar lista..."
                        className="h-[34px] w-full pl-[26px] pr-[8px] text-[12px] rounded-[6px] border border-line bg-bg-2 text-text outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                </div>

                {/* Botões de Navegação Próxima / Anterior */}
                <div className="flex items-center gap-[6px] self-end h-[34px]">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={irParaMaeAnterior}
                    title="Ir para Nota Mãe Anterior"
                    className="h-[34px] px-[10px]"
                  >
                    <ArrowLeft size={14} className="mr-[4px]" /> Anterior
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={irParaProximaMae}
                    title="Ir para Próxima Nota Mãe Pendente"
                    className="h-[34px] px-[10px]"
                  >
                    Próxima <ArrowRight size={14} className="ml-[4px]" />
                  </Button>
                </div>
              </div>

              {maeRowDetails && (
                <div className="flex flex-col gap-[16px]">
                  {/* Card de Detalhes da Nota Mãe Selecionada */}
                  <Card className="bg-surface-2 border-line shadow-xs">
                    <CardContent className="pt-[14px] pb-[14px]">
                      <div className="flex items-center justify-between border-b border-line pb-[8px] mb-[10px]">
                        <h4 className="text-[13px] font-semibold text-text flex items-center gap-[6px]">
                          📌 Detalhes da Nota Mãe <span className="font-mono text-primary">{maeSelecionada}</span>
                        </h4>
                        <span className="text-[11.5px] px-[8px] py-[2px] rounded-full bg-primary/10 text-primary font-semibold">
                          {filhasDaMae.length} Nota(s) Filha(s) Vinculada(s)
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-[12px] text-[12.5px]">
                        <div>
                          <span className="text-text-mute">Conjunto:</span> <strong>{maeRowDetails.Conjunto}</strong><br/>
                          <span className="text-text-mute">Regional:</span> <strong>{maeRowDetails.Regional}</strong>
                        </div>
                        <div>
                          <span className="text-text-mute">Local Instalação:</span> <span className="font-mono font-medium">{maeRowDetails.Local_Instalacao}</span><br/>
                          <span className="text-text-mute">Status Nota:</span> <strong>{maeRowDetails.Status_Nota}</strong>
                        </div>
                        <div>
                          <span className="text-text-mute">Medida Correta (Planejado):</span> <strong>{maeRowDetails.Planejado_DDPM} {undMae}</strong><br/>
                          <span className="text-text-mute">Medida Atual no SAP:</span> <strong>{maeRowDetails.Medida_SAP}</strong>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* BARRA DE ATALHOS RÁPIDOS DE RATEIO (1-CLICK ACTIONS) */}
                  <div className="flex items-center justify-between gap-[10px] flex-wrap bg-primary/5 border border-primary/20 p-[10px] rounded-[8px]">
                    <div className="flex items-center gap-[6px]">
                      <Sparkles size={15} className="text-primary" />
                      <span className="text-[12px] font-semibold text-text">Ações Rápidas de Rateio:</span>
                    </div>
                    <div className="flex items-center gap-[8px] flex-wrap">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={ratearProporcionalmente}
                        className="h-[30px] text-[12px] gap-[4px] bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        <Zap size={13} /> Ratear Proporcionalmente
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={concentrarNaMae}
                        className="h-[30px] text-[12px] gap-[4px]"
                      >
                        Concentrar na Mãe
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={restaurarOriginal}
                        className="h-[30px] text-[12px] gap-[4px]"
                      >
                        <RotateCcw size={13} /> Restaurar Original
                      </Button>
                    </div>
                  </div>

                  {/* Tabela de Distribuição */}
                  <div className="border border-line rounded-[8px] overflow-hidden bg-surface shadow-xs">
                    <table className="w-full border-collapse text-[12.5px] text-left">
                      <thead>
                        <tr className="bg-surface-2 border-b border-b-line text-text-mute">
                          <th className="py-[10px] px-[12px] font-medium">Tipo</th>
                          <th className="py-[10px] px-[12px] font-medium">Nº Nota</th>
                          <th className="py-[10px] px-[12px] font-medium">Local Instalação</th>
                          <th className="py-[10px] px-[12px] font-medium text-right">Planejado DDPM</th>
                          <th className="py-[10px] px-[12px] font-medium">Medida SAP Atual</th>
                          <th className="py-[10px] px-[12px] font-medium text-center">Medida vs Plan</th>
                          <th className="py-[10px] px-[12px] font-medium w-[180px]">Nova Medida ({undMae})</th>
                          <th className="py-[10px] px-[12px] font-medium w-[100px] text-center">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {/* Linha da Mãe */}
                        <tr className="border-b border-b-line hover:bg-surface-2 font-semibold">
                          <td className="py-[10px] px-[12px] text-primary">MÃE</td>
                          <td className="py-[10px] px-[12px] font-mono">{maeRowDetails.Numero_Nota}</td>
                          <td className="py-[10px] px-[12px] font-mono">{maeRowDetails.Local_Instalacao}</td>
                          <td className="py-[10px] px-[12px] text-right">{maeRowDetails.Planejado_DDPM}</td>
                          <td className="py-[10px] px-[12px]">{maeRowDetails.Medida_SAP}</td>
                          <td className="py-[10px] px-[12px] text-center">{maeRowDetails.Medida_vs_Planejado}</td>
                          <td className="py-[6px] px-[12px]">
                            <Input
                              type="number"
                              step={undMae === 'un' ? '1' : '0.001'}
                              value={novasMedidasHier[maeRowDetails.Numero_Nota] ?? 0}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setNovasMedidasHier((prev) => ({ ...prev, [maeRowDetails.Numero_Nota]: v }));
                              }}
                              className="h-[28px] py-0 px-[6px] text-right text-[12.5px] border-line font-mono font-semibold"
                            />
                          </td>
                          <td className="py-[6px] px-[12px] text-center">
                            {Math.abs(diferenca) > 1e-5 && (
                              <button
                                type="button"
                                onClick={() => fecharRestanteEm(maeRowDetails.Numero_Nota)}
                                className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
                                title="Jogar a diferença restante nesta nota"
                              >
                                + Restante
                              </button>
                            )}
                          </td>
                        </tr>
                        {/* Linhas das Filhas */}
                        {filhasDaMae.map((f) => (
                          <tr key={f.Numero_Nota} className="border-b border-b-line hover:bg-surface-2">
                            <td className="py-[10px] px-[12px] text-text-mute">FILHA</td>
                            <td className="py-[10px] px-[12px] font-mono">{f.Numero_Nota}</td>
                            <td className="py-[10px] px-[12px] font-mono">{f['Local_Instalacao']}</td>
                            <td className="py-[10px] px-[12px] text-right">{f['Planejado_DDPM']}</td>
                            <td className="py-[10px] px-[12px]">{f['Medida_SAP']}</td>
                            <td className="py-[10px] px-[12px] text-center">{f['Medida_vs_Planejado']}</td>
                            <td className="py-[6px] px-[12px]">
                              <Input
                                type="number"
                                step={undMae === 'un' ? '1' : '0.001'}
                                value={novasMedidasHier[f.Numero_Nota] ?? 0}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value) || 0;
                                  setNovasMedidasHier((prev) => ({ ...prev, [f.Numero_Nota]: v }));
                                }}
                                className="h-[28px] py-0 px-[6px] text-right text-[12.5px] border-line font-mono"
                              />
                            </td>
                            <td className="py-[6px] px-[12px] text-center">
                              {Math.abs(diferenca) > 1e-5 && (
                                <button
                                  type="button"
                                  onClick={() => fecharRestanteEm(f.Numero_Nota)}
                                  className="text-[11px] font-medium text-primary hover:underline cursor-pointer"
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

                  {/* Painel de Métricas e Balanço do Rateio */}
                  <div className="flex gap-[12px] flex-wrap items-stretch">
                    <Card className="flex-1 min-w-[180px] border-line bg-surface">
                      <CardContent className="pt-[12px] pb-[12px]">
                        <span className="text-[11px] text-text-mute uppercase tracking-[.04em] font-sans">Total Alvo (DDPM)</span>
                        <div className="text-[17px] font-semibold mt-[2px] font-mono">
                          {valMaeTarget.toFixed(3)} {undMae}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className="flex-1 min-w-[180px] border-line bg-surface">
                      <CardContent className="pt-[12px] pb-[12px]">
                        <span className="text-[11px] text-text-mute uppercase tracking-[.04em] font-sans">Soma Distribuída</span>
                        <div className="text-[17px] font-semibold mt-[2px] font-mono">
                          {somaFilhas.toFixed(3)} {undMae}
                        </div>
                      </CardContent>
                    </Card>
                    <Card className={`flex-1 min-w-[180px] border ${
                      somaFechada ? 'border-green/30 bg-green/5' : 'border-red/30 bg-red/5'
                    }`}>
                      <CardContent className="pt-[12px] pb-[12px]">
                        <span className="text-[11px] text-text-mute uppercase tracking-[.04em] font-sans">Diferença Restante</span>
                        <div className={`text-[17px] font-semibold mt-[2px] font-mono flex items-center gap-[6px] ${
                          somaFechada ? 'text-green' : 'text-red'
                        }`}>
                          {somaFechada ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                          <span>{diferenca > 0 ? `+${diferenca.toFixed(3)}` : diferenca.toFixed(3)} {undMae}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Avisos de Validação e Botão de Disparo */}
                  <div className="flex flex-col gap-[10px]">
                    {!somaFechada && (
                      <div className="p-[10px] bg-red/10 border border-red/20 text-red text-[12px] rounded-[6px]">
                        ⚠️ <strong>Bloqueio de Execução:</strong> A diferença restante ({Math.abs(diferenca).toFixed(3)} {undMae}) supera a tolerância de {tolerancia * 1000} metros/unidades. Use a ação <strong>⚡ Ratear Proporcionalmente</strong> ou clique em <strong>+ Restante</strong>.
                      </div>
                    )}
                    {somaFechada && Math.abs(diferenca) > 1e-5 && (
                      <div className="p-[10px] bg-amber/10 border border-amber/20 text-amber text-[12px] rounded-[6px]">
                        💡 <strong>Diferença Aceitável:</strong> Há uma pequena diferença de {Math.round(Math.abs(diferenca) * 1000)} mm/un dentro da tolerância de {tolerancia * 1000} metros.
                      </div>
                    )}
                    {undMae === 'un' && !unidadeCorreta && (
                      <div className="p-[10px] bg-red/10 border border-red/20 text-red text-[12px] rounded-[6px]">
                        ❌ <strong>Erro de Validação:</strong> Para a unidade &quot;un&quot; (Equipamentos), todas as medidas devem ser números inteiros.
                      </div>
                    )}

                    <div className="flex gap-[16px] items-center flex-wrap mt-[4px]">
                      <div className="flex items-center gap-[8px]">
                        <input
                          type="checkbox"
                          id="forcar-val"
                          checked={forcarValidacao}
                          onChange={(e) => setForcarValidacao(e.target.checked)}
                          className="w-[15px] h-[15px] cursor-pointer"
                        />
                        <Label htmlFor="forcar-val" className="text-[12px] cursor-pointer text-text-mute">
                          ⚠️ Forçar Execução (Ignorar Validação matemática)
                        </Label>
                      </div>
                      <Button
                        variant="default"
                        onClick={executarNoSap}
                        disabled={loadingRobot || (!somaFechada && !forcarValidacao) || (undMae === 'un' && !unidadeCorreta)}
                        className="ml-auto bg-primary hover:bg-primary/90 text-primary-foreground"
                      >
                        {loadingRobot ? 'Processando SAP...' : '🚀 Executar no SAP'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        // --- VISÃO DE RATEIO INDIVIDUAL ---
        <div className="flex flex-col gap-[16px]">
          {dfDivergentes.length === 0 ? (
            <div className="p-[24px] text-center border border-dashed border-line rounded-[8px] text-text-mute text-[13px]">
              🎉 Nenhuma nota ativa com divergência de medição física encontrada no banco.
            </div>
          ) : (
            <div className="flex flex-col gap-[14px]">
              {/* Barra de Busca e Ações em Lote */}
              <div className="flex items-center justify-between gap-[12px] flex-wrap bg-surface border border-line p-[12px] rounded-[8px] shadow-sm">
                <div className="relative flex items-center w-[280px]">
                  <Search size={14} className="absolute left-[11px] text-text-mute" />
                  <Input
                    type="text"
                    value={buscaInd}
                    onChange={(e) => setBuscaInd(e.target.value)}
                    placeholder="Buscar nota, conjunto ou local..."
                    className="pl-[32px] pr-[10px] w-full"
                  />
                </div>

                <div className="flex items-center gap-[8px]">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelecionarTodasInd}
                    className="h-[34px] text-[12px] gap-[6px]"
                  >
                    {selecionadasInd.size === dfDivergentesFiltradas.length ? <CheckSquare size={14} /> : <Square size={14} />}
                    {selecionadasInd.size === dfDivergentesFiltradas.length ? 'Deselecionar Todas' : 'Selecionar Todas'}
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={igualarPlanejadoEmLote}
                    disabled={selecionadasInd.size === 0}
                    className="h-[34px] text-[12px] gap-[6px] bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    <Zap size={14} /> Igualar ao Planejado DDPM ({selecionadasInd.size})
                  </Button>
                </div>
              </div>

              {/* Tabela de Notas Divergentes */}
              <div className="border border-line rounded-[8px] overflow-hidden bg-surface max-h-[460px] overflow-y-auto shadow-xs">
                <table className="w-full border-collapse text-[12.5px] text-left">
                  <thead>
                    <tr className="bg-surface-2 border-b border-b-line text-text-mute sticky top-0 z-10">
                      <th className="py-[10px] px-[12px] font-medium w-[60px] text-center">Corrigir?</th>
                      <th className="py-[10px] px-[12px] font-medium">Nº Nota</th>
                      <th className="py-[10px] px-[12px] font-medium">Conjunto</th>
                      <th className="py-[10px] px-[12px] font-medium">Local Instalação</th>
                      <th className="py-[10px] px-[12px] font-medium text-right">Planejado DDPM</th>
                      <th className="py-[10px] px-[12px] font-medium">Medida SAP Atual</th>
                      <th className="py-[10px] px-[12px] font-medium">Nota Mãe</th>
                      <th className="py-[10px] px-[12px] font-medium w-[90px]">Unidade</th>
                      <th className="py-[10px] px-[12px] font-medium w-[140px]">Nova Medida</th>
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
                        <tr key={num} className={`border-b border-b-line hover:bg-surface-2 ${isUnValError ? 'bg-red/5' : ''}`}>
                          <td className="py-[10px] px-[12px] text-center">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => handleIndCheckboxToggle(num)}
                              className="w-[15px] h-[15px] cursor-pointer"
                            />
                          </td>
                          <td className="py-[10px] px-[12px] font-mono font-medium">{num}</td>
                          <td className="py-[10px] px-[12px]">{r.Conjunto}</td>
                          <td className="py-[10px] px-[12px] font-mono">{r.Local_Instalacao}</td>
                          <td className="py-[10px] px-[12px] text-right font-medium">{r.Planejado_DDPM}</td>
                          <td className="py-[10px] px-[12px]">{r.Medida_SAP}</td>
                          <td className="py-[10px] px-[12px] font-mono">{r.Nota_Mae}</td>
                          <td className="py-[6px] px-[12px]">
                            <select
                              value={unit}
                              onChange={(e) => setUnidadesInd((prev) => ({ ...prev, [num]: e.target.value as 'km' | 'un' }))}
                              className="h-[28px] w-full rounded-[4px] border border-line bg-bg-2 text-[12px] outline-none"
                            >
                              <option value="km">km</option>
                              <option value="un">un</option>
                            </select>
                          </td>
                          <td className="py-[6px] px-[12px]">
                            <Input
                              type="number"
                              step={unit === 'un' ? '1' : '0.001'}
                              value={val}
                              onChange={(e) => {
                                const v = parseFloat(e.target.value) || 0;
                                setNovasMedidasInd((prev) => ({ ...prev, [num]: v }));
                              }}
                              className={`h-[28px] py-0 px-[6px] text-right text-[12.5px] font-mono ${isUnValError ? 'border-red' : 'border-line'}`}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Avisos e Envio em Lote */}
              <div className="flex flex-col gap-[10px]">
                {!individualValido && (
                  <div className="p-[10px] bg-red/10 border border-red/20 text-red text-[12px] rounded-[6px]">
                    ❌ <strong>Erro de Validação:</strong> Algumas notas selecionadas possuem unidade &quot;un&quot; mas seus novos valores não são inteiros.
                  </div>
                )}
                {selecionadasInd.size === 0 && (
                  <div className="p-[10px] bg-amber/10 border border-amber/20 text-amber text-[12px] rounded-[6px]">
                    ⚠️ Nenhuma nota selecionada para envio. Marque a caixa de seleção &quot;Corrigir?&quot; de pelo menos uma nota.
                  </div>
                )}

                <div className="flex items-center justify-between mt-[6px]">
                  <span className="text-[12.5px] text-text-mute">
                    Selecionadas para envio: <strong>{selecionadasInd.size}</strong> nota(s)
                  </span>
                  <Button
                    variant="default"
                    onClick={executarNoSap}
                    disabled={loadingRobot || selecionadasInd.size === 0 || !individualValido}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground"
                  >
                    {loadingRobot ? 'Processando SAP...' : '🚀 Corrigir Selecionadas no SAP'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* RELATÓRIO DE EXECUÇÃO DO ROBÔ SAP */}
      {relatorio && (
        <Card className="mt-[20px] border-line bg-surface shadow-xs">
          <CardHeader className="pb-[10px] border-b border-line">
            <CardTitle className="text-[14px] font-semibold">📋 Relatório de Execução do Robô SAP</CardTitle>
          </CardHeader>
          <CardContent className="pt-[12px]">
            <div className="border border-line rounded-[6px] overflow-hidden max-h-[220px] overflow-y-auto">
              <table className="w-full border-collapse text-[12px] text-left">
                <thead>
                  <tr className="bg-surface-2 text-text-mute font-medium border-b border-line">
                    <th className="py-[8px] px-[12px]">Nota</th>
                    <th className="py-[8px] px-[12px] w-[90px] text-center">Status</th>
                    <th className="py-[8px] px-[12px]">Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {relatorio.map((r, i) => (
                    <tr key={i} className="border-b border-line hover:bg-surface-2">
                      <td className="py-[8px] px-[12px] font-mono font-medium">{r.Nota}</td>
                      <td className="py-[8px] px-[12px] text-center">
                        <span
                          className={`inline-block py-[2px] px-[6px] rounded-[4px] font-semibold text-[10px] uppercase ${
                            r.Status === 'OK'
                              ? 'bg-green/15 text-green'
                              : r.Status === 'TESTE'
                              ? 'bg-amber/15 text-amber'
                              : 'bg-red/15 text-red'
                          }`}
                        >
                          {r.Status}
                        </span>
                      </td>
                      <td className="py-[8px] px-[12px] text-text-mute">{r.Mensagem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </SectionPage>
  );
}
