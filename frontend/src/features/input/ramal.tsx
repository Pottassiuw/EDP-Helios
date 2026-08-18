import React from 'react';
import {
  Download,
  PlusCircle,
  FileSpreadsheet,
  Undo2,
  Save,
  Trash2,
  X,
  Loader2,
  GitMerge,
  CheckCircle2,
} from 'lucide-react';
import type { InputDataset, NotaInput, NotaRamal, Celula } from './types';
import type { FiltersState } from './filters';
import { filtrarRegistros } from './overview';
import { InputApi, baixarBlob } from './api';
import { toast } from 'sonner';
import { parseColagemTsv } from './lib';
import { COLUNAS_RAMAL, COLUNAS_COLAGEM_RAMAL, ROTULOS_RAMAL } from './columns-ramal';
import { useRamalData, useRecarregarRamal, RAMAL_KEY } from './use-ramal-data';
import { useQueryClient } from '@tanstack/react-query';
import { DataGrid } from './data-grid';
import { NotesTable } from './notes-table';
import { MesExecucaoPicker } from '@/components/branded/mes-execucao-picker';
import { ColagemPlanilha } from './colagem-planilha';
import { CadastroRamalModal } from './cadastro-ramal-modal';
import { ExclusaoModal } from './exclusao-modal';
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
import { SegTabs, Eyebrow, StatNumber, type SegTab } from '@/components/branded/section';
import { getInputEmptyState, InputEmptyState } from './empty-state';

export type ModoRamal = 'visao' | 'rapida' | 'lote' | 'colagem';

const MODOS_RAMAL: SegTab<ModoRamal>[] = [
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

export function Ramal({
  dadosPrincipais,
  estadoFiltros,
  onClearFilters,
}: {
  dadosPrincipais: InputDataset;
  estadoFiltros?: FiltersState;
  onClearFilters?: () => void;
}): React.JSX.Element {
  const { data: dadosRamal, isLoading, error } = useRamalData();
  const qc = useQueryClient();
  const recarregar = useRecarregarRamal();

  const [modo, setModo] = React.useState<ModoRamal>('visao');
  const [modoVisualizacao, setModoVisualizacao] = React.useState<'planilha' | 'hierarquia'>('hierarquia');
  const [modalCadastro, setModalCadastro] = React.useState(false);
  const [modalExclusao, setModalExclusao] = React.useState(false);

  const [edicoes, setEdicoes] = React.useState<Map<number, Partial<NotaRamal>>>(new Map());
  const [selecionados, setSelecionados] = React.useState<Set<number>>(new Set());
  const [salvando, setSalvando] = React.useState(false);
  const [exportando, setExportando] = React.useState(false);

  // Estados de Edição em Lote
  const [loteStatus, setLoteStatus] = React.useState('');
  const [lotePrioridade, setLotePrioridade] = React.useState('');
  const [loteMes, setLoteMes] = React.useState('');
  const [loteObservacao, setLoteObservacao] = React.useState('');

  // Estados de Colagem
  const [textoColagem, setTextoColagem] = React.useState('');

  const registros = dadosRamal?.registros ?? [];
  const registrosComoNotaInput = React.useMemo(() => {
    const raw = registros as unknown as NotaInput[];
    if (!estadoFiltros) return raw;
    return filtrarRegistros(raw, estadoFiltros);
  }, [registros, estadoFiltros]);
  const emptyState = getInputEmptyState(registros.length, registrosComoNotaInput.length);

  const previewColagem = React.useMemo(
    () => parseColagemTsv(textoColagem, COLUNAS_COLAGEM_RAMAL),
    [textoColagem],
  );

  const onEditar = React.useCallback((numero: number, campo: string, valor: Celula) => {
    setEdicoes((prev) => {
      const next = new Map(prev);
      const atual = next.get(numero) ?? { Numero_Nota: numero };
      next.set(numero, { ...atual, [campo]: valor } as Partial<NotaRamal>);
      return next;
    });
  }, []);

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

  async function salvarEdicoes(): Promise<void> {
    if (edicoes.size === 0) return;
    const edicoesAtuais = new Map(edicoes);
    setEdicoes(new Map());

    const payload = Array.from(edicoesAtuais.values());

    // Otimista: atualiza cache do ramal imediatamente (0ms)
    qc.setQueryData<{ registros: NotaRamal[] }>(RAMAL_KEY, (antigo) => {
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
      await InputApi.importarRamal(payload);
      toast.success(`${payload.length} nota(s) ramal atualizada(s) com sucesso.`);
      void recarregar();
    } catch (e) {
      toast.error('Erro ao salvar alterações do ramal', {
        description: e instanceof Error ? e.message : String(e),
      });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  }

  function descartarEdicoes(): void {
    setEdicoes(new Map());
    toast.info('Edições pendentes do ramal descartadas.');
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

    // Otimista: atualiza cache do ramal imediatamente (0ms)
    qc.setQueryData<{ registros: NotaRamal[] }>(RAMAL_KEY, (antigo) => {
      if (!antigo) return antigo;
      return {
        ...antigo,
        registros: antigo.registros.map((r) => {
          if (!setNumLote.has(r.Numero_Nota)) return r;
          const patch: Partial<NotaRamal> = {};
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

    const payload: Partial<NotaRamal>[] = numeros.map((n) => {
      const item: Partial<NotaRamal> = { Numero_Nota: n };
      if (loteStatus) item.Status_Nota = loteStatus;
      if (lotePrioridade) item.Prioridade_Nota = lotePrioridade;
      if (loteMes.trim()) item.Mes_Execucao_Planejado = loteMes.trim();
      if (loteObservacao.trim()) {
        const original = registros.find((r) => r.Numero_Nota === n);
        const obsOrig = String(original?.Observacao ?? '').trim();
        item.Observacao = obsOrig ? `${obsOrig} | ${loteObservacao.trim()}` : loteObservacao.trim();
      }
      return item;
    });

    setSalvando(true);
    try {
      await InputApi.importarRamal(payload);
      toast.success(`Lote aplicado com sucesso em ${payload.length} nota(s) ramal.`);
      setLoteStatus('');
      setLotePrioridade('');
      setLoteMes('');
      setLoteObservacao('');
      void recarregar();
    } catch (e) {
      toast.error('Falha ao aplicar lote no ramal', {
        description: e instanceof Error ? e.message : String(e),
      });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  };

  async function confirmarExclusao(_justificativa: string): Promise<void> {
    if (selecionados.size === 0) return;
    const numeros = Array.from(selecionados);
    const setExcluir = new Set(numeros);
    setSelecionados(new Set());
    setModalExclusao(false);

    // Otimista: remove do cache do ramal imediatamente (0ms)
    qc.setQueryData<{ registros: NotaRamal[] }>(RAMAL_KEY, (antigo) => {
      if (!antigo) return antigo;
      return {
        ...antigo,
        registros: antigo.registros.filter((r) => !setExcluir.has(r.Numero_Nota)),
      };
    });

    setSalvando(true);
    try {
      await InputApi.excluirRamal(numeros);
      toast.success(`${numeros.length} nota(s) ramal excluída(s) com sucesso.`);
      void recarregar();
    } catch (e) {
      toast.error('Erro ao excluir notas ramal', {
        description: e instanceof Error ? e.message : String(e),
      });
      void recarregar();
    } finally {
      setSalvando(false);
    }
  }

  async function salvarColagem(): Promise<void> {
    const payload = previewColagem
      .filter((r) => r.Numero_Nota && Number.isFinite(Number(r.Numero_Nota)))
      .map((r) => ({
        Numero_Nota: Number(r.Numero_Nota),
        Status_Nota: r.Status_Nota ? String(r.Status_Nota).trim() : '00 Pendente',
        Prioridade_Nota: r.Prioridade_Nota ? String(r.Prioridade_Nota).trim() : 'Programável',
        Planejado_DDPM: Number(r.Planejado_DDPM) || 0,
        Conjunto: r.Conjunto ? String(r.Conjunto).trim() : '-',
        Circuito: r.Circuito ? String(r.Circuito).trim() : '-',
        Local_Instalacao: r.Local_Instalacao ? String(r.Local_Instalacao).trim() : '-',
        Mes_Execucao_Planejado: r.Mes_Execucao_Planejado ? String(r.Mes_Execucao_Planejado).trim() : '-',
        CenTrab_Respon: (r as Record<string, unknown>).CenTrab_Respon ? String((r as Record<string, unknown>).CenTrab_Respon).trim() : '-',
        Observacao: r.Observacao ? String(r.Observacao).trim() : '',
        Extracao_Antiga: (r as Record<string, unknown>).Extracao_Antiga ? String((r as Record<string, unknown>).Extracao_Antiga).trim() : '-',
        Status_Anterior: (r as Record<string, unknown>).Status_Anterior ? String((r as Record<string, unknown>).Status_Anterior).trim() : '-',
        Check_Btzero: (r as Record<string, unknown>).Check_Btzero ? String((r as Record<string, unknown>).Check_Btzero).trim() : '-',
        Plano: (r as Record<string, unknown>).Plano ? String((r as Record<string, unknown>).Plano).trim() : '-',
      }));

    if (payload.length === 0) {
      toast.warning('Nenhum dado válido para integrar. Cole dados com Número de Nota preenchido.');
      return;
    }

    setSalvando(true);
    try {
      await InputApi.importarRamal(payload);

      toast.success(`${payload.length} nota(s) ramal integradas com sucesso.`);
      setTextoColagem('');
      await recarregar();
      setModo('visao');
    } catch (e) {
      toast.error('Erro ao integrar colagem do ramal', {
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

  async function exportar(): Promise<void> {
    setExportando(true);
    try {
      const blob = await InputApi.exportar(
        registrosComoNotaInput.map((r) => r.Numero_Nota), COLUNAS_RAMAL.map((c) => c.key));
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
      baixarBlob(blob, `export_ramal_${stamp}.xlsx`);
      toast.success('Exportação do ramal concluída');
    } catch (e) {
      toast.error('Falha na exportação', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setExportando(false);
    }
  }

  const trocarModo = (novoModo: ModoRamal): void => {
    setModo(novoModo);
    setSelecionados(new Set());
  };

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      {/* Modais de Cadastro e Exclusão */}
      <CadastroRamalModal
        aberto={modalCadastro}
        onFechar={() => setModalCadastro(false)}
        dadosPrincipais={dadosPrincipais}
      />
      <ExclusaoModal
        aberto={modalExclusao}
        notas={Array.from(selecionados)}
        busy={salvando}
        onConfirmar={confirmarExclusao}
        onCancelar={() => setModalExclusao(false)}
      />

      {/* Barra de Navegação de Modos e Ações do Cabeçalho */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          <SegTabs tabs={MODOS_RAMAL} value={modo} onChange={trocarModo} ariaLabel="Modo do ramal" />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5"
            onClick={() => setModalCadastro(true)}
            title="Cadastrar uma nova nota ramal"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Nova Nota Ramal
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
            onClick={() => setModo('colagem')}
            title="Inserir lote de notas ramal em massa colando planilha Excel / TSV"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-text-dim" />
            Inserir em Massa
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
            disabled={salvando}
            onClick={desfazer}
            title="Reverte a última alteração realizada"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Reverter
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-medium gap-1.5 border-line hover:bg-surface-2 hover:text-text hover:border-line-2"
            disabled={exportando || registrosComoNotaInput.length === 0}
            onClick={() => { void exportar(); }}
            title="Baixar planilha Excel do Ramal"
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

<<<<<<< HEAD
      {isLoading && (
        <div className="p-8 flex items-center justify-center gap-2 text-text-dim text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <span>Carregando notas do ramal...</span>
        </div>
      )}

=======
      {isLoading && <div role="status" className="p-8 text-center text-text-dim text-sm">Carregando notas ramal...</div>}
>>>>>>> origin/develop
      {error != null && !dadosRamal && (
        <div role="alert" className="p-4 rounded-md bg-red/10 border border-red/20 text-red text-sm">
          Erro ao carregar ramal: {String((error as Error).message)}
        </div>
      )}
<<<<<<< HEAD
=======
      {error != null && dadosRamal && (
        <div role="alert" className="px-3 py-1.5 rounded-md bg-amber/10 border border-amber/20 text-amber text-xs">
          {`Backend indisponível — mostrando dados salvos${dataUpdatedAt ? ` de ${new Date(dataUpdatedAt).toLocaleString('pt-BR')}` : ''}.`}
        </div>
      )}
>>>>>>> origin/develop

      {/* MODO 1: VISÃO GERAL */}
      {modo === 'visao' && dadosRamal && (
        <React.Fragment>
          <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
            <div className="flex items-baseline gap-3">
              <StatNumber>
                {registrosComoNotaInput.length.toLocaleString('pt-BR')}
              </StatNumber>
              <Eyebrow className="text-xs tracking-wider">
                {registrosComoNotaInput.length !== registros.length
                  ? `de ${registros.length.toLocaleString('pt-BR')} notas ramal encontradas`
                  : 'notas cadastradas no ramal'}
              </Eyebrow>
            </div>
            <SegTabs
              tabs={VISUALIZACOES}
              value={modoVisualizacao === 'hierarquia' ? 'hierarquica' : 'plana'}
              onChange={(v) => setModoVisualizacao(v === 'hierarquica' ? 'hierarquia' : 'planilha')}
              ariaLabel="Alternar visualização hierárquica ou plana de notas ramal"
            />
          </div>

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
<<<<<<< HEAD
            {modoVisualizacao === 'planilha' ? (
              <DataGrid registros={registrosComoNotaInput} colunas={COLUNAS_RAMAL} altura={580} />
            ) : (
              <NotesTable
                registros={registrosComoNotaInput}
                todosOsRegistros={registrosComoNotaInput}
                colunas={COLUNAS_RAMAL}
                agruparGavetinhas={true}
              />
            )}
=======
            {emptyState ? (
              emptyState === 'filter'
                ? <InputEmptyState state="filter" onClearFilters={onClearFilters} />
                : <InputEmptyState state="dataset" />
            ) : <DataGrid registros={registrosComoNotaInput} colunas={COLUNAS_RAMAL} />}
>>>>>>> origin/develop
          </div>
        </React.Fragment>
      )}

      {/* MODO 2: EDIÇÃO RÁPIDA */}
      {modo === 'rapida' && dadosRamal && (
        <React.Fragment>
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-3 items-center justify-between flex-wrap">
                <span className="text-xs text-text-dim">
                  Duplo clique numa célula para editar. <strong>{edicoes.size}</strong> nota(s) ramal com alterações pendentes.
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
<<<<<<< HEAD

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
            <NotesTable
              registros={registrosComoNotaInput}
              todosOsRegistros={registrosComoNotaInput}
              colunas={COLUNAS_RAMAL}
              edicoes={edicoes as unknown as Map<number, Partial<NotaInput>>}
              onEditar={onEditar}
              statusOpcoes={dadosPrincipais.meta.status_opcoes}
              prioridadeOpcoes={dadosPrincipais.meta.prioridade_opcoes}
              agruparGavetinhas={true}
            />
          </div>
=======
          <Card>
            <CardContent className="pt-6">
              {emptyState ? (
                emptyState === 'filter'
                  ? <InputEmptyState state="filter" onClearFilters={onClearFilters} />
                  : <InputEmptyState state="dataset" />
              ) : <NotesTable
                registros={registrosComoNotaInput}
                colunas={COLUNAS_RAMAL}
                edicoes={edicoes as unknown as Map<number, Partial<NotaInput>>}
                onEditar={onEditar}
                statusOpcoes={dadosPrincipais.meta.status_opcoes}
                prioridadeOpcoes={dadosPrincipais.meta.prioridade_opcoes} />}
            </CardContent>
          </Card>
>>>>>>> origin/develop
        </React.Fragment>
      )}

      {/* MODO 3: EDIÇÃO EM LOTE */}
      {modo === 'lote' && dadosRamal && (
        <React.Fragment>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center justify-between">
                <span>Edição em Lote — Selecione as notas ramal e defina os novos valores:</span>
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
                      {dadosPrincipais.meta.status_opcoes.map((s) => (
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
                      {dadosPrincipais.meta.prioridade_opcoes.map((p) => (
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
                    variant="destructive"
                    size="sm"
                    disabled={salvando || selecionados.size === 0}
                    onClick={() => setModalExclusao(true)}
                    className="gap-1.5"
                    title="Excluir notas ramal selecionadas (exige motivo)"
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
<<<<<<< HEAD
                )}
              </div>
=======
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="pt-6">
              {emptyState ? (
                emptyState === 'filter'
                  ? <InputEmptyState state="filter" onClearFilters={onClearFilters} />
                  : <InputEmptyState state="dataset" />
              ) : <NotesTable
                registros={registrosComoNotaInput}
                colunas={COLUNAS_RAMAL}
                selecionados={selecionados}
                onToggleSelecionado={toggleSelecionado}
                onToggleTodos={toggleTodos}
                statusOpcoes={dadosPrincipais.meta.status_opcoes}
                prioridadeOpcoes={dadosPrincipais.meta.prioridade_opcoes} />}
>>>>>>> origin/develop
            </CardContent>
          </Card>

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
            <NotesTable
              registros={registrosComoNotaInput}
              todosOsRegistros={registrosComoNotaInput}
              colunas={COLUNAS_RAMAL}
              selecionados={selecionados}
              onToggleSelecionado={toggleSelecionado}
              onToggleTodos={toggleTodos}
              agruparGavetinhas={true}
            />
          </div>
        </React.Fragment>
      )}

      {/* MODO 4: COLAR PLANILHA */}
      {modo === 'colagem' && (
        <ColagemPlanilha
          titulo="Colar Planilha Ramal"
          colunasColagem={COLUNAS_COLAGEM_RAMAL}
          colunasPreview={COLUNAS_RAMAL.filter((c) => COLUNAS_COLAGEM_RAMAL.includes(c.key))}
          rotulos={ROTULOS_RAMAL}
          texto={textoColagem}
          setTexto={setTextoColagem}
          preview={previewColagem}
          salvando={salvando}
          rotuloSalvar={`Salvar lote ramal (${previewColagem.length})`}
          onSalvar={salvarColagem}
        />
      )}

      <div className="flex items-center justify-between text-xs text-text-mute font-mono px-3 py-2 bg-surface-2/50 rounded-md border border-line">
        <div className="flex items-center gap-2">
          <GitMerge className="h-3.5 w-3.5 text-accent shrink-0" />
          <span>Base Ramal · {registros.length} notas cadastradas</span>
        </div>
        <CheckCircle2 className="h-3.5 w-3.5 text-green shrink-0" />
      </div>

      {/* Barra Flutuante de Edições Pendentes */}
      {edicoes.size > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 p-3.5 bg-surface border border-accent/60 rounded-xl shadow-2xl animate-in slide-in-from-bottom-5">
          <div className="flex items-center gap-2 pr-2 border-r border-line">
            <span className="flex h-2.5 w-2.5 rounded-full bg-accent animate-pulse" />
            <span className="text-xs font-semibold text-foreground">
              {edicoes.size} nota(s) ramal alterada(s)
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
