import React from 'react';
import {
  Download,
  CheckCircle2,
  GitMerge,
  Eye,
  EyeOff,
  PlusCircle,
  FileSpreadsheet,
  PieChart,
  Mail,
  Undo2,
  Save,
  Trash2,
  X,
  Loader2,
} from 'lucide-react';
import type { Celula, EdicaoResultado, InputDataset, NotaInput } from './types';
import { InputApi, getUsuario, baixarBlob } from './api';
import { toast } from 'sonner';
import { aplicarFiltros, ehNotaOculta, buscarNotasOcultas, parseColagemTsv } from './lib';
import { COLUNAS, COLUNAS_COLAGEM, ROTULOS } from './columns';
import { type FiltersState } from './filters';
import { DataGrid } from './data-grid';
import { NotesTable } from './notes-table';
import { InputNotaInspector } from './input-nota-inspector';
import { useRecarregarInput, INPUT_DADOS_KEY } from './use-input-data';
import { useQueryClient } from '@tanstack/react-query';
import { useBloqueios } from './use-bloqueios';
import { CadastroModal } from './cadastro-modal';
import { ColagemPlanilha, type AjusteMaeColagem } from './colagem-planilha';
import { NotificacaoModal } from './notificacao-modal';
import { ExclusaoModal } from './exclusao-modal';
import { OcultacaoModal } from './ocultacao-modal';
import { MesExecucaoPicker } from '@/components/branded/mes-execucao-picker';
import { CLASSE_SELECT_MONO } from './ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Eyebrow, StatNumber, SegTabs, type SegTab } from '@/components/branded/section';

export type ModoNotas = 'visao' | 'rapida' | 'lote' | 'colagem';

const MODOS_NOTAS: SegTab<ModoNotas>[] = [
  { id: 'visao',   rotulo: 'Visão Geral' },
  { id: 'rapida',  rotulo: 'Edição Rápida' },
  { id: 'lote',    rotulo: 'Edição em Lote' },
  { id: 'colagem', rotulo: 'Inserir em Massa' },
];

type Visualizacao = 'hierarquica' | 'plana';
const VISUALIZACOES: { id: Visualizacao; rotulo: string }[] = [
  { id: 'hierarquica', rotulo: '📁 Visão Hierárquica' },
  { id: 'plana', rotulo: '📊 Visão Planilha' },
];

export function filtrarRegistros(registros: NotaInput[], estado: FiltersState): NotaInput[] {
  let resultado = registros;

  if (!estado.mostrarOcultas) {
    resultado = resultado.filter((r) => !ehNotaOculta(r));
  }

  const buscaStr = estado.busca.trim();
  if (buscaStr !== '') {
    const query = buscaStr.toLowerCase();
    const termos = buscaStr.split(/[ ,;]+/).map((s) => s.trim()).filter(Boolean);
    const numeros = termos.filter((s) => /^\d+$/.test(s)).map(Number);
    const setNums = new Set(numeros);

    const pontuados: { item: NotaInput; score: number }[] = [];

    for (const r of resultado) {
      const idNota = r.Numero_Nota;
      const idStr = String(idNota);
      const maeStr = String(r.Nota_Mae ?? '').trim();

      let score = 0;
      if (setNums.has(idNota)) score = 100;
      else if (idStr.startsWith(query)) score = 80;
      else if (idStr.includes(query)) score = 60;
      else if (setNums.has(Number(maeStr)) || maeStr.startsWith(query)) score = 50;
      else if (maeStr.includes(query)) score = 40;
      else if (
        Object.values(r).some(
          (v) => v !== null && v !== undefined && String(v).toLowerCase().includes(query)
        )
      ) {
        score = 10;
      }

      if (score > 0) {
        pontuados.push({ item: r, score });
      }
    }

    pontuados.sort((a, b) => b.score - a.score);
    resultado = pontuados.map((p) => p.item);
  }

  if (estado.somente2026) {
    const anoAtual = String(new Date().getFullYear());
    resultado = resultado.filter((r) => {
      const mes = String(r.Mes_Execucao_Planejado ?? '').toLowerCase();
      return mes.includes('2026') || mes.includes('26') || mes.includes(anoAtual);
    });
  }

  if (estado.somenteNotasMaes) {
    const setMaesComFilhas = new Set<number>();
    for (const r of registros) {
      const maeStr = String(r.Nota_Mae ?? '').trim();
      if (maeStr && maeStr !== '-' && maeStr !== 'None' && maeStr !== 'null') {
        const maeId = Number(maeStr);
        if (Number.isFinite(maeId) && maeId !== r.Numero_Nota) {
          setMaesComFilhas.add(maeId);
        }
      }
    }
    resultado = resultado.filter((r) => setMaesComFilhas.has(r.Numero_Nota));
  }

  return aplicarFiltros(resultado, estado.filtros);
}

interface OverviewProps {
  dados: InputDataset;
  estado: FiltersState;
  onSetEstadoFiltros?: (e: FiltersState) => void;
  onIrParaSincronizacao?: () => void;
  onIrParaRateio?: () => void;
}

export function Overview({
  dados,
  estado,
  onSetEstadoFiltros,
  onIrParaSincronizacao = () => {},
  onIrParaRateio,
}: OverviewProps): React.JSX.Element {
  const qc = useQueryClient();
  const recarregar = useRecarregarInput();
  const usuarioAtual = getUsuario();

  // Modo de exibição da aba Notas Gerais
  const [modo, setModo] = React.useState<ModoNotas>('visao');

  // Estados de Modais
  const [modalCadastro, setModalCadastro] = React.useState(false);
  const [modalNotificacao, setModalNotificacao] = React.useState(false);
  const [modalExclusao, setModalExclusao] = React.useState(false);
  const [modalOcultacao, setModalOcultacao] = React.useState(false);

  // Estados de Tabela e Edição
  const [modoVisualizacao, setModoVisualizacao] = React.useState<'planilha' | 'hierarquia'>('hierarquia');
  const [notaDetalhe, setNotaDetalhe] = React.useState<NotaInput | null>(null);
  const botaoDetalheRef = React.useRef<HTMLButtonElement | null>(null);
  const [selecionados, setSelecionados] = React.useState<Set<number>>(new Set());
  const [edicoes, setEdicoes] = React.useState<Map<number, Partial<NotaInput>>>(new Map());
  const [salvando, setSalvando] = React.useState(false);
  const [exportando, setExportando] = React.useState(false);

  // Estados de Edição em Lote
  const [loteStatus, setLoteStatus] = React.useState('');
  const [lotePrioridade, setLotePrioridade] = React.useState('');
  const [loteMes, setLoteMes] = React.useState('');
  const [loteObservacao, setLoteObservacao] = React.useState('');

  // Estados de Colagem de Planilha
  const [textoColagem, setTextoColagem] = React.useState('');
  const [descontarMaes, setDescontarMaes] = React.useState(true);

  const { mapa: bloqueios, recarregar: recarregarBloqueios } = useBloqueios(edicoes.size > 0);

  const filtrados = React.useMemo(
    () => filtrarRegistros(dados.registros, estado), [dados.registros, estado]);

  const ocultasNaBusca = React.useMemo(() => {
    if (!estado.busca.trim() || estado.mostrarOcultas) return [];
    return buscarNotasOcultas(dados.registros, estado.busca);
  }, [dados.registros, estado.busca, estado.mostrarOcultas]);

  const previewColagem = React.useMemo(
    () => parseColagemTsv(textoColagem, COLUNAS_COLAGEM),
    [textoColagem],
  );

  const ajustesMaesColagem = React.useMemo<AjusteMaeColagem[]>(() => {
    if (previewColagem.length === 0) return [];
    const deducoesPorMae = new Map<number, number>();
    for (const r of previewColagem) {
      const maeStr = r.Nota_Mae ? String(r.Nota_Mae).trim() : '';
      if (maeStr && maeStr !== '-' && /^\d+$/.test(maeStr)) {
        const numMae = Number(maeStr);
        const med = Number(r.Planejado_DDPM) || 0;
        deducoesPorMae.set(numMae, (deducoesPorMae.get(numMae) ?? 0) + med);
      }
    }

    const lista: AjusteMaeColagem[] = [];
    for (const [numMae, deducao] of deducoesPorMae.entries()) {
      const maeObj = dados.registros.find((r) => r.Numero_Nota === numMae);
      if (maeObj && deducao > 0) {
        const medAtual = Number(maeObj.Planejado_DDPM) || 0;
        const novaMed = Math.max(0, medAtual - deducao);
        lista.push({
          numeroMae: numMae,
          medidaAtual: medAtual,
          deducao,
          novaMedida: novaMed,
        });
      }
    }
    return lista;
  }, [previewColagem, dados.registros]);

  const abrirDetalhes = React.useCallback(
    (nota: NotaInput, trigger: HTMLButtonElement): void => {
      botaoDetalheRef.current = trigger;
      setNotaDetalhe(nota);
    },
    [],
  );

  const toggleSelecionado = React.useCallback((numero: number) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(numero)) next.delete(numero);
      else next.add(numero);
      return next;
    });
  }, []);

  const toggleTodos = React.useCallback((numeros: number[], marcar: boolean) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      for (const n of numeros) {
        if (marcar) next.add(n);
        else next.delete(n);
      }
      return next;
    });
  }, []);

  const onEditar = React.useCallback((numero: number, campo: string, valor: Celula) => {
    setEdicoes((prev) => {
      const next = new Map(prev);
      const atual = next.get(numero) ?? { Numero_Nota: numero };
      next.set(numero, { ...atual, [campo]: valor });
      return next;
    });
  }, []);

  const onIniciarEdicao = React.useCallback(async (numero: number): Promise<boolean> => {
    try {
      const res = await InputApi.travarNota(numero);
      if (!res.ok) {
        toast.warning(
          `Nota #${numero} está em edição por ${res.usuario ?? 'outro usuário'}. Suas alterações podem sobrescrever.`,
        );
      }
      recarregarBloqueios();
      return res.ok;
    } catch {
      return false;
    }
  }, [recarregarBloqueios]);

  async function salvarEdicoes(): Promise<void> {
    if (edicoes.size === 0) return;
    const edicoesAtuais = new Map(edicoes);
    setEdicoes(new Map());

    const payload = Array.from(edicoesAtuais.entries()).map(([numero, campos]) => ({
      Numero_Nota: numero,
      ...campos,
    }));

    // Atualização otimista imediata no cache (0ms)
    qc.setQueryData<InputDataset>(INPUT_DADOS_KEY, (antigo) => {
      if (!antigo) return antigo;
      return {
        ...antigo,
        registros: antigo.registros.map((r) => {
          const ed = edicoesAtuais.get(r.Numero_Nota);
          return ed ? { ...r, ...ed } : r;
        }),
      };
    });

    setSalvando(true);
    try {
      const res: EdicaoResultado = await InputApi.editar(payload);
      if (res.bloqueadas && res.bloqueadas.length > 0) {
        toast.warning(`${res.bloqueadas.length} nota(s) estavam travadas e continuam pendentes.`);
        setEdicoes((prev) => {
          const next = new Map(prev);
          for (const num of res.bloqueadas) {
            const ed = edicoesAtuais.get(num);
            if (ed) next.set(num, ed);
          }
          return next;
        });
      } else {
        toast.success(`${res.alteradas} nota(s) atualizada(s) com sucesso.`);
      }
      void recarregar();
    } catch (e) {
      toast.error('Erro ao salvar alterações', {
        description: e instanceof Error ? e.message : String(e),
      });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  }

  function descartarEdicoes(): void {
    setEdicoes(new Map());
    toast.info('Edições pendentes descartadas.');
  }

  const aplicarLote = async (): Promise<void> => {
    const numeros = Array.from(selecionados);
    if (numeros.length === 0) {
      toast.warning('Selecione pelo menos uma nota na tabela para aplicar o lote.');
      return;
    }

    const temCampo = Boolean(loteStatus || lotePrioridade || loteMes.trim() || loteObservacao.trim());
    if (!temCampo) {
      toast.warning('Escolha pelo menos um novo valor para aplicar nas notas selecionadas.');
      return;
    }

    const setNumLote = new Set(numeros);
    setSelecionados(new Set());

    // Atualização otimista imediata no cache (0ms)
    qc.setQueryData<InputDataset>(INPUT_DADOS_KEY, (antigo) => {
      if (!antigo) return antigo;
      return {
        ...antigo,
        registros: antigo.registros.map((r) => {
          if (!setNumLote.has(r.Numero_Nota)) return r;
          const patch: Partial<NotaInput> = {};
          if (loteStatus) patch.Status_Nota = loteStatus;
          if (lotePrioridade) patch.Prioridade_Nota = lotePrioridade;
          if (loteMes.trim()) patch.Mes_Execucao_Planejado = loteMes.trim();
          if (loteObservacao.trim()) {
            const obsOrig = String(r.Observacao ?? '').trim();
            patch.Observacao = obsOrig ? `${obsOrig} | ${loteObservacao.trim()}` : loteObservacao.trim();
          }
          return { ...r, ...patch };
        }),
      };
    });

    const payload: Partial<NotaInput>[] = numeros.map((n) => {
      const item: Partial<NotaInput> = { Numero_Nota: n };
      if (loteStatus) item.Status_Nota = loteStatus;
      if (lotePrioridade) item.Prioridade_Nota = lotePrioridade;
      if (loteMes.trim()) item.Mes_Execucao_Planejado = loteMes.trim();
      if (loteObservacao.trim()) {
        const original = dados.registros.find((r) => r.Numero_Nota === n);
        const obsOrig = String(original?.Observacao ?? '').trim();
        item.Observacao = obsOrig ? `${obsOrig} | ${loteObservacao.trim()}` : loteObservacao.trim();
      }
      return item;
    });

    setSalvando(true);
    try {
      const res = await InputApi.editar(payload);
      toast.success(`Lote aplicado com sucesso em ${res.alteradas} nota(s).`);
      setLoteStatus('');
      setLotePrioridade('');
      setLoteMes('');
      setLoteObservacao('');
      void recarregar();
    } catch (e) {
      toast.error('Falha ao aplicar lote', {
        description: e instanceof Error ? e.message : String(e),
      });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  };

  async function salvarColagem(): Promise<void> {
    const payload = previewColagem
      .filter((r) => r.Numero_Nota && Number.isFinite(Number(r.Numero_Nota)))
      .map((r) => ({
        Numero_Nota: Number(r.Numero_Nota),
        Nota_Mae: r.Nota_Mae ? String(r.Nota_Mae).trim() : '-',
        Status_Nota: r.Status_Nota ? String(r.Status_Nota).trim() : '00 Pendente',
        Prioridade_Nota: r.Prioridade_Nota ? String(r.Prioridade_Nota).trim() : 'Programável',
        Planejado_DDPM: Number(r.Planejado_DDPM) || 0,
        Status_Obra: r.Status_Obra ? String(r.Status_Obra).trim() : '-',
        Conjunto: r.Conjunto ? String(r.Conjunto).trim() : '-',
        Circuito: r.Circuito ? String(r.Circuito).trim() : '-',
        Local_Instalacao: r.Local_Instalacao ? String(r.Local_Instalacao).trim() : '-',
        Mes_Execucao_Planejado: r.Mes_Execucao_Planejado ? String(r.Mes_Execucao_Planejado).trim() : '-',
        Data_Envio_Projeto: r.Data_Envio_Projeto ? String(r.Data_Envio_Projeto).trim() : '-',
        Observacao: r.Observacao ? String(r.Observacao).trim() : '',
        Check: r.Check ? String(r.Check).trim() : '-',
      }));

    if (payload.length === 0) {
      toast.warning('Nenhum dado válido para integrar. Cole dados com Número de Nota preenchido.');
      return;
    }

    setSalvando(true);
    try {
      const res = await InputApi.criarLote(payload);

      if (ajustesMaesColagem.length > 0 && descontarMaes) {
        const updatesMae = ajustesMaesColagem.map((a) => ({
          Numero_Nota: a.numeroMae,
          Planejado_DDPM: a.novaMedida,
        }));
        try {
          await InputApi.editar(updatesMae);
          toast.success(
            `${res.inseridas} nota(s) inserida(s) e ${ajustesMaesColagem.length} Nota(s) Mãe ajustada(s)!`,
          );
        } catch {
          toast.warning(
            `${res.inseridas} nota(s) inserida(s), mas falhou ao ajustar medidas das mães.`,
          );
        }
      } else {
        toast.success(`${res.inseridas} nota(s) inserida(s) com sucesso.`);
      }

      setTextoColagem('');
      await recarregar();
      setModo('visao');
    } catch (e) {
      toast.error('Erro ao integrar colagem', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSalvando(false);
    }
  }

  async function desfazer(): Promise<void> {
    setSalvando(true);
    try {
      const res = await InputApi.desfazer();
      if (res.ok) {
        toast.success(res.mensagem);
        await recarregar();
      } else {
        toast.warning(res.mensagem);
      }
    } catch (e) {
      toast.error('Erro ao reverter', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao(justificativa: string): Promise<void> {
    if (selecionados.size === 0) return;
    const numeros = Array.from(selecionados);
    const setExcluir = new Set(numeros);
    setSelecionados(new Set());
    setModalExclusao(false);

    // Otimista: remove do cache do React Query instantaneamente (0ms!)
    qc.setQueryData<InputDataset>(INPUT_DADOS_KEY, (antigo) => {
      if (!antigo) return antigo;
      return {
        ...antigo,
        registros: antigo.registros.filter((r) => !setExcluir.has(r.Numero_Nota)),
      };
    });

    setSalvando(true);
    try {
      const res = await InputApi.excluir(numeros, justificativa);
      toast.success(`${res.excluidas} nota(s) excluída(s) com sucesso.`);
      void recarregar();
    } catch (e) {
      toast.error('Erro ao excluir notas', {
        description: e instanceof Error ? e.message : String(e),
      });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarOcultacaoLote(justificativa: string): Promise<void> {
    if (selecionados.size === 0) return;
    const numeros = Array.from(selecionados);
    const setOcultar = new Set(numeros);
    setSelecionados(new Set());
    setModalOcultacao(false);

    const tagMotivo = `[OCULTA: ${justificativa}]`;

    // Otimista: marca como oculta no cache do React Query instantaneamente (0ms!)
    qc.setQueryData<InputDataset>(INPUT_DADOS_KEY, (antigo) => {
      if (!antigo) return antigo;
      return {
        ...antigo,
        registros: antigo.registros.map((r) => {
          if (!setOcultar.has(r.Numero_Nota)) return r;
          const obs = String(r.Observacao ?? '').trim();
          const novaObs = obs ? `${obs} ${tagMotivo}` : tagMotivo;
          return { ...r, Check: 'Oculta', Observacao: novaObs };
        }),
      };
    });

    setSalvando(true);
    try {
      const updates = Array.from(setOcultar).map((num) => {
        const original = dados.registros.find((r) => r.Numero_Nota === num);
        const obs = String(original?.Observacao ?? '').trim();
        const novaObs = obs ? `${obs} ${tagMotivo}` : tagMotivo;
        return { Numero_Nota: num, Check: 'Oculta', Observacao: novaObs };
      });
      await InputApi.editar(updates);
      toast.success(`${numeros.length} nota(s) marcada(s) como oculta(s).`);
      void recarregar();
    } catch (e) {
      toast.error('Erro ao ocultar notas', {
        description: e instanceof Error ? e.message : String(e),
      });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  }

  async function exportar(): Promise<void> {
    setExportando(true);
    try {
      const blob = await InputApi.exportar(
        filtrados.map((r) => r.Numero_Nota), COLUNAS.map((c) => c.key));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      baixarBlob(blob, `export_notas_${stamp}.xlsx`);
      toast.success('Exportação concluída');
    } catch (e) {
      toast.error('Falha na exportação', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExportando(false);
    }
  }

  const trocarModo = (novoModo: ModoNotas): void => {
    setModo(novoModo);
    setSelecionados(new Set());
  };

  const filtrado = filtrados.length !== dados.registros.length;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      {/* Modais de Ações Unitárias e Globais */}
      <CadastroModal aberto={modalCadastro} onFechar={() => setModalCadastro(false)} dados={dados} />
      <NotificacaoModal aberto={modalNotificacao} onFechar={() => setModalNotificacao(false)} />
      <ExclusaoModal
        aberto={modalExclusao}
        notas={Array.from(selecionados)}
        busy={salvando}
        onConfirmar={confirmarExclusao}
        onCancelar={() => setModalExclusao(false)}
      />
      <OcultacaoModal
        aberto={modalOcultacao}
        notas={Array.from(selecionados)}
        busy={salvando}
        onConfirmar={confirmarOcultacaoLote}
        onCancelar={() => setModalOcultacao(false)}
      />

      {/* Barra de Navegação de Modos e Ações do Cabeçalho */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <SegTabs tabs={MODOS_NOTAS} value={modo} onChange={trocarModo} ariaLabel="Modo de operação de Notas Gerais" />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5"
            onClick={() => setModalCadastro(true)}
            title="Cadastrar uma nova nota unitária com vínculo à Nota Mãe opcional"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Nova Nota
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
            onClick={() => setModo('colagem')}
            title="Inserir lote de notas em massa colando planilha Excel / TSV"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-text-dim" />
            Inserir em Massa
          </Button>

          {onIrParaRateio && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
              onClick={onIrParaRateio}
              title="Acessar subaba de Rateio de Medidas"
            >
              <PieChart className="h-3.5 w-3.5 text-text-mute" />
              Rateio
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
            onClick={() => setModalNotificacao(true)}
            title="Consolidar resumo do dia e gerar e-mails via Outlook"
          >
            <Mail className="h-3.5 w-3.5 text-text-dim" />
            Notificar
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
            disabled={salvando}
            onClick={desfazer}
            title="Reverte a última alteração realizada pelo seu usuário"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Reverter
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
            disabled={exportando || filtrados.length === 0}
            onClick={() => { void exportar(); }}
            title="Baixar planilha Excel com os registros e filtros aplicados"
          >
            {exportando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1" />
            )}
            Exportar
          </Button>
        </div>
      </div>

      {/* Alerta inteligente quando a busca coincide com notas ocultas */}
      {ocultasNaBusca.length > 0 && (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 text-xs shadow-sm">
          <div className="flex items-center gap-2.5 min-w-0">
            <EyeOff className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="truncate">
              <strong>Aviso de Ocultação:</strong>{' '}
              {ocultasNaBusca.length === 1
                ? `A nota #${ocultasNaBusca[0].Numero_Nota} foi encontrada, mas está marcada como OCULTA.`
                : `${ocultasNaBusca.length} notas encontradas para esta busca estão marcadas como OCULTAS.`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onSetEstadoFiltros && (
              <Button
                size="xs"
                variant="outline"
                className="h-7 text-xs border-amber-500/40 text-amber-800 dark:text-amber-300 hover:bg-amber-500/20"
                onClick={() => onSetEstadoFiltros({ ...estado, mostrarOcultas: true })}
              >
                <Eye className="h-3.5 w-3.5 mr-1" />
                Exibir notas ocultas
              </Button>
            )}
            {ocultasNaBusca.length === 1 && (
              <Button
                size="xs"
                variant="default"
                className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                onClick={async () => {
                  try {
                    await InputApi.editar([{ Numero_Nota: ocultasNaBusca[0].Numero_Nota, Check: '-' }]);
                    toast.success(`Nota #${ocultasNaBusca[0].Numero_Nota} desocultada com sucesso`);
                    recarregar();
                  } catch (e) {
                    toast.error('Erro ao desocultar nota', { description: e instanceof Error ? e.message : String(e) });
                  }
                }}
              >
                Desocultar agora
              </Button>
            )}
          </div>
        </div>
      )}

      {/* MODO 1: VISÃO GERAL */}
      {modo === 'visao' && (
        <React.Fragment>
          <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
            <div className="flex items-baseline gap-3">
              <StatNumber>
                {filtrados.length.toLocaleString('pt-BR')}
              </StatNumber>
              <Eyebrow className="text-xs tracking-wider">
                {filtrado ? `de ${dados.registros.length.toLocaleString('pt-BR')} notas encontradas` : 'notas cadastradas'}
              </Eyebrow>
            </div>
            <SegTabs
              tabs={VISUALIZACOES}
              value={modoVisualizacao === 'hierarquia' ? 'hierarquica' : 'plana'}
              onChange={(v) => setModoVisualizacao(v === 'hierarquica' ? 'hierarquia' : 'planilha')}
              ariaLabel="Alternar visualização hierárquica ou plana de notas"
            />
          </div>

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
            {modoVisualizacao === 'planilha' ? (
              <DataGrid
                registros={filtrados}
                colunas={COLUNAS}
                altura={580}
                onOpenDetails={abrirDetalhes}
              />
            ) : (
              <NotesTable
                registros={filtrados}
                todosOsRegistros={dados.registros}
                colunas={COLUNAS}
                altura={580}
                agruparGavetinhas={true}
                onOpenDetails={abrirDetalhes}
              />
            )}
          </div>
        </React.Fragment>
      )}

      {/* MODO 2: EDIÇÃO RÁPIDA */}
      {modo === 'rapida' && (
        <React.Fragment>
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-3 items-center justify-between flex-wrap">
                <span className="text-xs text-text-dim">
                  Duplo clique numa célula para editar. <strong>{edicoes.size}</strong> nota(s) com alterações pendentes.
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={salvando || edicoes.size === 0} onClick={salvarEdicoes} className="gap-1.5">
                    {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Salvar edições ({edicoes.size})
                  </Button>
                  <Button variant="ghost" size="sm" disabled={edicoes.size === 0} onClick={descartarEdicoes} className="text-text-mute">
                    <X className="h-3.5 w-3.5 mr-1" />
                    Descartar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
            <NotesTable
              registros={filtrados}
              todosOsRegistros={dados.registros}
              colunas={COLUNAS}
              altura={580}
              edicoes={edicoes}
              onEditar={onEditar}
              statusOpcoes={dados.meta.status_opcoes}
              prioridadeOpcoes={dados.meta.prioridade_opcoes}
              agruparGavetinhas={true}
              bloqueios={bloqueios}
              usuarioAtual={usuarioAtual}
              onIniciarEdicao={onIniciarEdicao}
              onOpenDetails={abrirDetalhes}
            />
          </div>
        </React.Fragment>
      )}

      {/* MODO 3: EDIÇÃO EM LOTE */}
      {modo === 'lote' && (
        <React.Fragment>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Edição em Lote — Selecione as notas abaixo e defina os novos valores:</span>
                <span className="font-mono text-xs font-normal text-text-mute">
                  {selecionados.size} nota(s) marcada(s)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-mute">Status da Nota</label>
                  <Select
                    value={loteStatus || '__manter'}
                    onValueChange={(v) => setLoteStatus(v === '__manter' ? '' : v)}
                  >
                    <SelectTrigger className="h-8 text-xs bg-bg-2 border-line">
                      <SelectValue placeholder="Status: (manter atual)" />
                    </SelectTrigger>
                    <SelectContent className={CLASSE_SELECT_MONO}>
                      <SelectItem value="__manter">Status: (manter atual)</SelectItem>
                      {dados.meta.status_opcoes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-mute">Prioridade da Nota</label>
                  <Select
                    value={lotePrioridade || '__manter'}
                    onValueChange={(v) => setLotePrioridade(v === '__manter' ? '' : v)}
                  >
                    <SelectTrigger className="h-8 text-xs bg-bg-2 border-line">
                      <SelectValue placeholder="Prioridade: (manter atual)" />
                    </SelectTrigger>
                    <SelectContent className={CLASSE_SELECT_MONO}>
                      <SelectItem value="__manter">Prioridade: (manter atual)</SelectItem>
                      {dados.meta.prioridade_opcoes.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-mute">Mês de Execução</label>
                  <MesExecucaoPicker
                    value={loteMes}
                    onChange={setLoteMes}
                    valorNeutro=""
                    rotuloNeutro="Mês: (manter atual)"
                    className="w-full h-8 text-xs"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-medium text-text-mute">Adicionar Observação</label>
                  <Input
                    value={loteObservacao}
                    onChange={(e) => setLoteObservacao(e.target.value)}
                    placeholder="Obs: (manter atual)"
                    className="h-8 text-xs bg-bg-2 border-line"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-line flex-wrap">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={salvando || selecionados.size === 0}
                    onClick={aplicarLote}
                    className="gap-1.5"
                  >
                    {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Aplicar e Salvar Lote ({selecionados.size})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={salvando || selecionados.size === 0}
                    onClick={() => setModalOcultacao(true)}
                    className="gap-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                    title="Ocultar notas selecionadas (exige motivo)"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    Ocultar ({selecionados.size})
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={salvando || selecionados.size === 0}
                    onClick={() => setModalExclusao(true)}
                    className="gap-1.5"
                    title="Excluir notas selecionadas (exige motivo)"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Excluir ({selecionados.size})
                  </Button>
                </div>

                {selecionados.size > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelecionados(new Set())}
                    className="text-xs text-text-mute"
                  >
                    Limpar Seleção
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
            <NotesTable
              registros={filtrados}
              todosOsRegistros={dados.registros}
              colunas={COLUNAS}
              altura={580}
              selecionados={selecionados}
              onToggleSelecionado={toggleSelecionado}
              onToggleTodos={toggleTodos}
              agruparGavetinhas={true}
              onOpenDetails={abrirDetalhes}
            />
          </div>
        </React.Fragment>
      )}

      {/* MODO 4: COLAR PLANILHA (INSERIR EM MASSA) */}
      {modo === 'colagem' && (
        <ColagemPlanilha
          titulo="Colagem Direta de Planilha (Excel / TSV)"
          colunasColagem={COLUNAS_COLAGEM}
          colunasPreview={COLUNAS}
          rotulos={ROTULOS}
          texto={textoColagem}
          setTexto={setTextoColagem}
          preview={previewColagem}
          salvando={salvando}
          rotuloSalvar={`Salvar ${previewColagem.length} nota(s) no sistema`}
          onSalvar={salvarColagem}
          ajustesMaes={ajustesMaesColagem}
          descontarMaes={descontarMaes}
          onToggleDescontarMaes={setDescontarMaes}
        />
      )}

      <InputNotaInspector
        nota={notaDetalhe}
        onClose={() => setNotaDetalhe(null)}
        returnFocusRef={botaoDetalheRef}
        onIrParaSincronizacao={onIrParaSincronizacao}
      />

      <div className="flex items-center justify-between text-xs text-text-mute font-mono px-3 py-2 bg-surface-2/50 rounded-md border border-line">
        <div className="flex items-center gap-2">
          <GitMerge className="h-3.5 w-3.5 text-accent shrink-0" />
          <span>Base de dados operacional · {dados.registros.length} notas no plano</span>
        </div>
        <CheckCircle2 className="h-3.5 w-3.5 text-green shrink-0" />
      </div>

      {/* Barra Flutuante de Edições Pendentes */}
      {edicoes.size > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 p-3.5 bg-surface border border-accent/60 rounded-xl shadow-2xl animate-in slide-in-from-bottom-5">
          <div className="flex items-center gap-2 pr-2 border-r border-line">
            <span className="flex h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
            <span className="text-xs font-semibold text-foreground">
              {edicoes.size} nota(s) alterada(s)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={salvando} onClick={salvarEdicoes} className="gap-1.5 h-8 text-xs font-semibold">
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Salvar Alterações
            </Button>
            <Button variant="outline" size="sm" onClick={descartarEdicoes} className="h-8 text-xs text-text-mute">
              <X className="h-3.5 w-3.5 mr-1" />
              Descartar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
