import React from 'react';
import {
  Loader2,
  Download,
  CheckCircle2,
  GitMerge,
  Eye,
  EyeOff,
  PlusCircle,
  TableProperties,
  PieChart,
  Mail,
  Undo2,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { Celula, EdicaoResultado, InputDataset, NotaInput } from './types';
import { InputApi, getUsuario, baixarBlob } from './api';
import { toast } from 'sonner';
import { aplicarFiltros, parseBuscaGlobal, ehNotaOculta, buscarNotasOcultas } from './lib';
import { COLUNAS } from './columns';
import { type FiltersState } from './filters';
import { DataGrid } from './data-grid';
import { NotesTable } from './notes-table';
import { InputNotaInspector } from './input-nota-inspector';
import { useRecarregarInput } from './use-input-data';
import { useBloqueios } from './use-bloqueios';
import { CadastroModal } from './cadastro-modal';
import { ColagemModal } from './colagem-modal';
import { Rateio } from './rateio';
import { NotificacaoModal } from './notificacao-modal';
import { ExclusaoModal } from './exclusao-modal';
import { OcultacaoModal } from './ocultacao-modal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow, StatNumber, SegTabs } from '@/components/branded/section';

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
    const numeros = parseBuscaGlobal(buscaStr);
    if (numeros.length > 0) {
      const setNums = new Set(numeros);
      const setNumsStr = new Set(numeros.map(String));
      resultado = resultado.filter((r) => {
        const idNota = r.Numero_Nota;
        const maeStr = String(r.Nota_Mae ?? '').trim();
        return setNums.has(idNota) || setNumsStr.has(maeStr);
      });
    } else {
      const query = buscaStr.toLowerCase();
      resultado = resultado.filter((r) =>
        Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(query))
      );
    }
  }

  if (estado.somente2026) {
    const anoAtual = String(new Date().getFullYear());
    resultado = resultado.filter((r) => String(r.Mes_Execucao_Planejado ?? '').includes(anoAtual));
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
}

export function Overview({
  dados,
  estado,
  onSetEstadoFiltros,
  onIrParaSincronizacao = () => {},
}: OverviewProps): React.JSX.Element {
  const recarregar = useRecarregarInput();
  const usuarioAtual = getUsuario();

  // Estados de Modais
  const [modalCadastro, setModalCadastro] = React.useState(false);
  const [modalColagem, setModalColagem] = React.useState(false);
  const [modalRateio, setModalRateio] = React.useState(false);
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

  const { mapa: bloqueios, recarregar: recarregarBloqueios } = useBloqueios(edicoes.size > 0);

  const filtrados = React.useMemo(
    () => filtrarRegistros(dados.registros, estado), [dados.registros, estado]);

  const ocultasNaBusca = React.useMemo(() => {
    if (!estado.busca.trim() || estado.mostrarOcultas) return [];
    return buscarNotasOcultas(dados.registros, estado.busca);
  }, [dados.registros, estado.busca, estado.mostrarOcultas]);

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
    setSalvando(true);
    try {
      const payload = Array.from(edicoes.values());
      const res: EdicaoResultado = await InputApi.editar(payload);
      if (res.bloqueadas && res.bloqueadas.length > 0) {
        toast.warning(`${res.bloqueadas.length} nota(s) estavam travadas e continuam pendentes.`);
        setEdicoes((prev) => {
          const next = new Map();
          for (const num of res.bloqueadas) {
            const ed = prev.get(num);
            if (ed) next.set(num, ed);
          }
          return next;
        });
      } else {
        setEdicoes(new Map());
      }
      toast.success(`${res.alteradas} nota(s) atualizada(s) com sucesso.`);
      await recarregar();
    } catch (e) {
      toast.error('Erro ao salvar alterações', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSalvando(false);
    }
  }

  function descartarEdicoes(): void {
    setEdicoes(new Map());
    toast.info('Edições pendentes descartadas.');
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
    setSalvando(true);
    try {
      const numeros = Array.from(selecionados);
      const res = await InputApi.excluir(numeros, justificativa);
      toast.success(`${res.excluidas} nota(s) excluída(s) com sucesso.`);
      setSelecionados(new Set());
      setModalExclusao(false);
      await recarregar();
    } catch (e) {
      toast.error('Erro ao excluir notas', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarOcultacaoLote(justificativa: string): Promise<void> {
    if (selecionados.size === 0) return;
    setSalvando(true);
    try {
      const tagMotivo = `[OCULTA: ${justificativa}]`;
      const updates = Array.from(selecionados).map((num) => {
        const original = dados.registros.find((r) => r.Numero_Nota === num);
        const obs = String(original?.Observacao ?? '').trim();
        const novaObs = obs ? `${obs} ${tagMotivo}` : tagMotivo;
        return { Numero_Nota: num, Check: 'Oculta', Observacao: novaObs };
      });
      await InputApi.editar(updates);
      toast.success(`${selecionados.size} nota(s) marcada(s) como oculta(s).`);
      setSelecionados(new Set());
      setModalOcultacao(false);
      await recarregar();
    } catch (e) {
      toast.error('Erro ao ocultar notas', {
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

  const filtrado = filtrados.length !== dados.registros.length;

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      {/* Modais de Ações */}
      <CadastroModal aberto={modalCadastro} onFechar={() => setModalCadastro(false)} dados={dados} />
      <ColagemModal aberto={modalColagem} onFechar={() => setModalColagem(false)} dados={dados} />
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

      <Dialog open={modalRateio} onOpenChange={(open) => { if (!open) setModalRateio(false); }}>
        <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-6">
          <DialogHeader>
            <Eyebrow>Rateio de Medidas</Eyebrow>
            <DialogTitle>Distribuição e Rateio Proporcional entre Notas</DialogTitle>
          </DialogHeader>
          <Rateio dados={dados} estadoFiltros={estado} recarregar={recarregar} />
        </DialogContent>
      </Dialog>

      {/* Barra de Controles e Ações Rápidas */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
        <div className="flex items-baseline gap-3">
          <StatNumber>
            {filtrados.length.toLocaleString('pt-BR')}
          </StatNumber>
          <Eyebrow className="text-xs tracking-wider">
            {filtrado ? `de ${dados.registros.length.toLocaleString('pt-BR')} notas encontradas` : 'notas cadastradas'}
          </Eyebrow>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            className="h-9 px-3 text-xs font-semibold gap-1.5"
            onClick={() => setModalCadastro(true)}
            title="Cadastrar uma nova nota unitária com vínculo à Nota Mãe opcional"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Nova Nota
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-semibold gap-1.5 border-line hover:border-accent hover:text-accent"
            onClick={() => setModalColagem(true)}
            title="Inserir notas em lote através de planilha interativa (Ctrl+V do Excel)"
          >
            <TableProperties className="h-3.5 w-3.5 text-accent" />
            Inserir em Massa
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-semibold gap-1.5 border-line"
            onClick={() => setModalRateio(true)}
            title="Rateio automático de medidas entre filhas"
          >
            <PieChart className="h-3.5 w-3.5 text-text-mute" />
            Rateio
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-semibold gap-1.5 border-line hover:border-accent hover:text-accent"
            onClick={() => setModalNotificacao(true)}
            title="Consolidar resumo do dia e gerar e-mails via Outlook"
          >
            <Mail className="h-3.5 w-3.5 text-accent" />
            Notificar
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs"
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
            className="h-9 px-3 text-xs"
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

          <div className="h-6 w-px bg-line mx-1" />

          <SegTabs
            tabs={VISUALIZACOES}
            value={modoVisualizacao === 'hierarquia' ? 'hierarquica' : 'plana'}
            onChange={(v) => setModoVisualizacao(v === 'hierarquica' ? 'hierarquia' : 'planilha')}
            ariaLabel="Alternar visualização hierárquica ou plana de notas"
          />
        </div>
      </div>

      {/* Barra Flutuante de Ações em Lote e Edições Pendentes */}
      {(selecionados.size > 0 || edicoes.size > 0) && (
        <div className="flex items-center justify-between gap-4 flex-wrap bg-surface-2 border border-accent/40 p-3.5 rounded-lg shadow-md animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            {selecionados.size > 0 && (
              <span className="font-semibold text-foreground bg-accent/15 px-2.5 py-1 rounded-md border border-accent/30 font-mono">
                {selecionados.size} nota(s) selecionada(s)
              </span>
            )}
            {edicoes.size > 0 && (
              <span className="font-semibold text-accent bg-accent/15 px-2.5 py-1 rounded-md border border-accent/30 font-mono">
                {edicoes.size} alteração(ões) pendente(s)
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {edicoes.size > 0 && (
              <React.Fragment>
                <Button
                  size="xs"
                  className="h-8 text-xs gap-1.5"
                  disabled={salvando}
                  onClick={salvarEdicoes}
                >
                  {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Salvar Alterações
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-8 text-xs text-text-mute"
                  disabled={salvando}
                  onClick={descartarEdicoes}
                >
                  Descartar
                </Button>
              </React.Fragment>
            )}

            {selecionados.size > 0 && (
              <React.Fragment>
                <Button
                  variant="outline"
                  size="xs"
                  className="h-8 text-xs gap-1.5 border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"
                  onClick={() => setModalOcultacao(true)}
                  title="Ocultar notas selecionadas (exige motivo)"
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  Ocultar Selecionadas
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => setModalExclusao(true)}
                  title="Excluir notas selecionadas do banco (exige motivo)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Excluir Selecionadas
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-8 text-xs text-text-mute"
                  onClick={() => setSelecionados(new Set())}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Limpar Seleção
                </Button>
              </React.Fragment>
            )}
          </div>
        </div>
      )}

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

      {/* Tabela ou Planilha Virtualizada */}
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
            selecionados={selecionados}
            onToggleSelecionado={toggleSelecionado}
            onToggleTodos={toggleTodos}
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
        )}
      </div>

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
    </div>
  );
}


