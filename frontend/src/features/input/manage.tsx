import React from 'react';
import { Loader2, Undo2, Save, Trash2, Mail } from 'lucide-react';
import type { Celula, InputDataset, NotaInput } from './types';
import { InputApi } from './api';
import { toast } from 'sonner';
import { parseColagemTsv } from './lib';
import { COLUNAS, COLUNAS_COLAGEM, ROTULOS } from './columns';
import { type FiltersState } from './filters';
import { filtrarRegistros } from './overview';
import { NotesTable } from './notes-table';
import { useRecarregarInput } from './use-input-data';
import { MesExecucaoPicker } from '@/components/branded/mes-execucao-picker';
import { ColagemPlanilha } from './colagem-planilha';
import { CLASSE_SELECT_MONO } from './ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SegTabs, Banner, Eyebrow } from '@/components/branded/section';
import { ConfirmModal } from '../coffee/confirm-modal';
import { NotificacaoModal } from './notificacao-modal';

import { Rateio } from './rateio';
import { HierarquiaCard } from './hierarquia-card';
import { Ramal } from './ramal';

type Modo = 'rapida' | 'lote' | 'rateio' | 'exclusao' | 'cadastro' | 'colagem';
const MODOS: { id: Modo; rotulo: string }[] = [
  { id: 'rapida', rotulo: 'Edição Rápida' },
  { id: 'lote', rotulo: 'Edição em Lote' },
  { id: 'rateio', rotulo: 'Rateio de Medidas' },
  { id: 'exclusao', rotulo: 'Exclusão' },
  { id: 'cadastro', rotulo: 'Cadastrar Nota' },
  { id: 'colagem', rotulo: 'Colar Planilha' },
];

interface Mensagem { tipo: 'ok' | 'erro'; texto: string; }

const NOTA_VAZIA: Record<string, string> = {
  Numero_Nota: '', Status_Nota: '00 Pendente', Prioridade_Nota: 'Programável',
  Planejado_DDPM: '0', Conjunto: '-', Circuito: '-',
  Local_Instalacao: '-', Mes_Execucao_Planejado: '-',
  Data_Envio_Projeto: new Date().toLocaleDateString('pt-BR'), Observacao: '', Check: '-',
};

interface ManageProps {
  dados: InputDataset;
  estadoFiltros: FiltersState;
}

export function Manage({ dados, estadoFiltros }: ManageProps): React.JSX.Element {
  const recarregar = useRecarregarInput();
  const [base, setBase] = React.useState<'geral' | 'ramal'>('geral');
  const [modo, setModo] = React.useState<Modo>('rapida');
  const [agruparGavetinhas, setAgruparGavetinhas] = React.useState(true);
  const [edicoes, setEdicoes] = React.useState<Map<number, Partial<NotaInput>>>(new Map());
  const [selecionados, setSelecionados] = React.useState<Set<number>>(new Set());
  const [msg, setMsg] = React.useState<Mensagem | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const [loteStatus, setLoteStatus] = React.useState('');
  const [lotePrioridade, setLotePrioridade] = React.useState('');
  const [loteMes, setLoteMes] = React.useState('');
  const [novaNota, setNovaNota] = React.useState<Record<string, string>>({ ...NOTA_VAZIA });
  const [textoColagem, setTextoColagem] = React.useState('');
  const [modalNotificacao, setModalNotificacao] = React.useState(false);

  const filtrados = React.useMemo(
    () => filtrarRegistros(dados.registros, estadoFiltros), [dados.registros, estadoFiltros]);
  const previewColagem = React.useMemo(
    () => parseColagemTsv(textoColagem, COLUNAS_COLAGEM), [textoColagem]);

  async function executar(rotuloOk: string, fn: () => Promise<unknown>): Promise<void> {
    setSalvando(true); setMsg(null);
    try {
      await fn();
      await recarregar();
      setMsg({ tipo: 'ok', texto: rotuloOk });
      toast.success(rotuloOk);
    } catch (e) {
      const txt = e instanceof Error ? e.message : String(e);
      setMsg({ tipo: 'erro', texto: txt });
      toast.error('Falha na operação', { description: txt });
    } finally {
      setSalvando(false);
    }
  }

  function onEditar(numero: number, campo: string, valor: Celula): void {
    setEdicoes((prev) => {
      const m = new Map(prev);
      m.set(numero, { ...(m.get(numero) ?? {}), [campo]: valor });
      return m;
    });
  }
  function toggleSelecionado(numero: number): void {
    setSelecionados((prev) => {
      const s = new Set(prev);
      if (s.has(numero)) s.delete(numero); else s.add(numero);
      return s;
    });
  }
  function toggleTodos(numeros: number[], marcar: boolean): void {
    setSelecionados((prev) => {
      const s = new Set(prev);
      numeros.forEach((n) => { if (marcar) s.add(n); else s.delete(n); });
      return s;
    });
  }

  const salvarRapida = (): void => {
    void executar(`${edicoes.size} nota(s) atualizada(s).`, async () => {
      const linhas = [...edicoes.entries()].map(([n, campos]) => ({ Numero_Nota: n, ...campos }));
      await InputApi.editar(linhas);
      setEdicoes(new Map());
    });
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && modo === 'rapida' && edicoes.size > 0 && !salvando) {
        e.preventDefault();
        salvarRapida();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modo, edicoes, salvando]);

  const aplicarLote = (): void => {
    const linhas = [...selecionados].map((n) => {
      const linha: Partial<NotaInput> = { Numero_Nota: n };
      if (loteStatus) linha.Status_Nota = loteStatus;
      if (lotePrioridade) linha.Prioridade_Nota = lotePrioridade;
      if (loteMes.trim()) linha.Mes_Execucao_Planejado = loteMes.trim();
      return linha;
    });
    if (linhas.length === 0 || (!loteStatus && !lotePrioridade && !loteMes.trim())) {
      setMsg({ tipo: 'erro', texto: 'Selecione notas e escolha pelo menos um novo valor.' });
      return;
    }
    void executar(`Lote aplicado em ${linhas.length} nota(s).`, async () => {
      await InputApi.editar(linhas);
      setSelecionados(new Set());
    });
  };

  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);
  const [confirmUndoOpen, setConfirmUndoOpen] = React.useState(false);

  const excluirSelecionadas = (): void => {
    if (selecionados.size === 0) { setMsg({ tipo: 'erro', texto: 'Nenhuma nota selecionada.' }); return; }
    setConfirmDeleteOpen(true);
  };

  const confirmarExcluir = (): void => {
    setConfirmDeleteOpen(false);
    void executar(`${selecionados.size} nota(s) excluída(s).`, async () => {
      await InputApi.excluir([...selecionados]);
      setSelecionados(new Set());
    });
  };

  const desfazer = (): void => {
    setConfirmUndoOpen(true);
  };

  const confirmarDesfazer = (): void => {
    setConfirmUndoOpen(false);
    void executar('Última alteração desfeita.', async () => {
      const r = await InputApi.desfazer();
      if (!r.ok) throw new Error(r.mensagem);
    });
  };

  const cadastrar = (): void => {
    if (!/^\d+$/.test(novaNota.Numero_Nota)) { setMsg({ tipo: 'erro', texto: 'Nº da Nota inválido.' }); return; }
    void executar(`Nota ${novaNota.Numero_Nota} cadastrada.`, async () => {
      await InputApi.criar({
        ...novaNota, Numero_Nota: Number(novaNota.Numero_Nota),
        Planejado_DDPM: Number(novaNota.Planejado_DDPM) || 0
      });
      setNovaNota({ ...NOTA_VAZIA });
    });
  };

  const salvarColagem = (): void => {
    if (previewColagem.length === 0) { setMsg({ tipo: 'erro', texto: 'Cole os dados antes de salvar.' }); return; }
    void executar(`${previewColagem.length} nota(s) integradas ao banco.`, async () => {
      await InputApi.criarLote(previewColagem.map((r) => ({
        ...r, Numero_Nota: Number(r.Numero_Nota),
        Planejado_DDPM: Number(r.Planejado_DDPM) || 0,
      })));
      setTextoColagem('');
    });
  };

  const comSelecao = modo === 'lote' || modo === 'exclusao';

  function trocarModo(m: Modo): void {
    setModo(m); setMsg(null); setSelecionados(new Set());
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      {/* Seletor da Base (Geral vs Ramal) */}
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-text-mute">Base de Dados:</span>
          <SegTabs
            tabs={[
              { id: 'geral', rotulo: '📋 Geral' },
              { id: 'ramal', rotulo: '🔌 Ramal' },
            ]}
            value={base}
            onChange={(b) => setBase(b as 'geral' | 'ramal')}
            ariaLabel="Selecionar base de dados para gerenciar"
          />
        </div>

        {base === 'geral' && (
          <div className="flex items-center gap-2">
            <Button
              variant={agruparGavetinhas ? "secondary" : "outline"}
              size="sm"
              className="h-9 px-3 text-xs"
              onClick={() => setAgruparGavetinhas((prev) => !prev)}
              title="Alternar visualização agrupada (gavetinhas) de notas mães e filhas"
            >
              {agruparGavetinhas ? "📁 Visão Hierárquica" : "📄 Visão Plana"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs font-semibold gap-1.5 border-line hover:border-accent hover:text-accent"
              onClick={() => setModalNotificacao(true)}
              title="Consolidar e enviar notificações diárias aos engenheiros por regional"
            >
              <Mail className="h-3.5 w-3.5 text-accent" />
              Notificar Engenheiros
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-3 text-xs"
              disabled={salvando}
              onClick={desfazer}
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Reverter Última Alteração
            </Button>
          </div>
        )}
      </div>

      <NotificacaoModal aberto={modalNotificacao} onFechar={() => setModalNotificacao(false)} />

      {base === 'ramal' ? (
        <Ramal dadosPrincipais={dados} estadoFiltros={estadoFiltros} />
      ) : (
        <React.Fragment>
          <div className="flex items-center gap-4 bg-surface p-3 rounded-lg border border-line shadow-sm">
            <SegTabs tabs={MODOS} value={modo} onChange={trocarModo} ariaLabel="Modo de edição" />
          </div>

          {msg && <Banner tipo={msg.tipo === 'ok' ? 'ok' : 'err'}>{msg.texto}</Banner>}

          {(modo === 'rapida' || comSelecao) && (
            <React.Fragment>
              {modo === 'lote' && (
                <Card className="border border-line bg-surface shadow-sm">
                  <CardHeader className="pb-3">
                    <Eyebrow className="text-xs tracking-wider">Ação em Lote</Eyebrow>
                    <CardTitle className="text-base font-semibold text-foreground">Alterar Campos em Lote</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-3 items-center flex-wrap">
                      <Select value={loteStatus || undefined}
                        onValueChange={(v) => setLoteStatus(v === '__manter' ? '' : v)}>
                        <SelectTrigger className="w-56 h-9 text-xs bg-bg-2 border-line">
                          <SelectValue placeholder="Status: (manter atual)" />
                        </SelectTrigger>
                        <SelectContent className={CLASSE_SELECT_MONO}>
                          <SelectItem value="__manter">Status: (manter atual)</SelectItem>
                          {dados.meta.status_opcoes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <Select value={lotePrioridade || undefined}
                        onValueChange={(v) => setLotePrioridade(v === '__manter' ? '' : v)}>
                        <SelectTrigger className="w-56 h-9 text-xs bg-bg-2 border-line">
                          <SelectValue placeholder="Prioridade: (manter atual)" />
                        </SelectTrigger>
                        <SelectContent className={CLASSE_SELECT_MONO}>
                          <SelectItem value="__manter">Prioridade: (manter atual)</SelectItem>
                          {dados.meta.prioridade_opcoes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <MesExecucaoPicker value={loteMes} onChange={setLoteMes}
                        valorNeutro="" rotuloNeutro="Mês: (manter atual)"
                        className="w-60 h-9" />
                      <Button size="sm" className="h-9 px-4 text-xs" disabled={salvando} onClick={aplicarLote}>
                        {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                        Aplicar em ({selecionados.size}) Notas
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {modo === 'exclusao' && (
                <Card className="border border-line bg-surface shadow-sm">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-xs text-text-dim">
                        Selecione as notas na tabela abaixo para excluir do banco. <strong className="text-foreground">{selecionados.size} selecionada(s).</strong>
                      </span>
                      <Button variant="destructive" size="sm" className="h-9 text-xs" disabled={salvando} onClick={excluirSelecionadas}>
                        {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                        Excluir Selecionadas
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {modo === 'rapida' && (
                <Card className="border border-line bg-surface shadow-sm">
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <span className="text-xs text-text-dim">
                        Clique nas células para editar diretamente inline. <strong className="text-accent">{edicoes.size} alteração(ões) pendente(s).</strong> (Atalho: <kbd className="px-1 py-0.5 bg-surface-2 rounded font-mono text-[10px]">Ctrl+S</kbd>)
                      </span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="h-9 text-xs" disabled={salvando || edicoes.size === 0} onClick={salvarRapida}>
                          {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                          Salvar Alterações
                        </Button>
                        <Button variant="ghost" size="sm" className="h-9 text-xs" disabled={edicoes.size === 0}
                          onClick={() => setEdicoes(new Map())}>Descartar</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
                <NotesTable registros={filtrados} todosOsRegistros={dados.registros} colunas={COLUNAS}
                  selecionados={comSelecao ? selecionados : undefined}
                  onToggleSelecionado={comSelecao ? toggleSelecionado : undefined}
                  onToggleTodos={comSelecao ? toggleTodos : undefined}
                  edicoes={modo === 'rapida' ? edicoes : undefined}
                  onEditar={modo === 'rapida' ? onEditar : undefined}
                  statusOpcoes={dados.meta.status_opcoes}
                  prioridadeOpcoes={dados.meta.prioridade_opcoes}
                  agruparGavetinhas={agruparGavetinhas} />
              </div>
            </React.Fragment>
          )}

          {modo === 'cadastro' && (
            <Card className="border border-line bg-surface shadow-sm">
              <CardHeader className="pb-3">
                <Eyebrow className="text-xs tracking-wider">Nova Nota</Eyebrow>
                <CardTitle className="text-base font-semibold text-foreground">Cadastrar Nova Nota no Banco</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {Object.keys(NOTA_VAZIA).map((campo) => (
                    <div key={campo} className="flex flex-col gap-1.5">
                      <Label htmlFor={`nova-${campo}`} className="text-xs text-text-dim">{ROTULOS[campo] ?? campo}</Label>
                      {campo === 'Status_Nota' ? (
                        <Select value={novaNota[campo]} onValueChange={(v) => setNovaNota({ ...novaNota, [campo]: v })}>
                          <SelectTrigger className="h-9 text-xs bg-bg-2 border-line"><SelectValue /></SelectTrigger>
                          <SelectContent className={CLASSE_SELECT_MONO}>
                            {dados.meta.status_opcoes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : campo === 'Prioridade_Nota' ? (
                        <Select value={novaNota[campo]} onValueChange={(v) => setNovaNota({ ...novaNota, [campo]: v })}>
                          <SelectTrigger className="h-9 text-xs bg-bg-2 border-line"><SelectValue /></SelectTrigger>
                          <SelectContent className={CLASSE_SELECT_MONO}>
                            {dados.meta.prioridade_opcoes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input id={`nova-${campo}`} value={novaNota[campo]}
                          className="h-9 text-xs bg-bg-2 border-line"
                          onChange={(e) => setNovaNota({ ...novaNota, [campo]: e.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex justify-end">
                  <Button size="sm" className="h-9 px-4 text-xs" disabled={salvando} onClick={cadastrar}>
                    {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                    Salvar Nota
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {modo === 'rateio' && (
            <Rateio dados={dados} estadoFiltros={estadoFiltros} recarregar={recarregar} />
          )}

          {modo === 'colagem' && (
            <ColagemPlanilha
              titulo="Colar Planilha (TSV / Excel)"
              colunasColagem={COLUNAS_COLAGEM}
              colunasPreview={COLUNAS.filter((c) => COLUNAS_COLAGEM.includes(c.key))}
              rotulos={ROTULOS}
              texto={textoColagem}
              setTexto={setTextoColagem}
              preview={previewColagem}
              salvando={salvando}
              rotuloSalvar={`Salvar Lote (${previewColagem.length})`}
              onSalvar={salvarColagem} />
          )}

          {/* Ferramenta de Hierarquia Manual (Vincular Nota-Mãe e Filhas na Mão) */}
          <HierarquiaCard registros={dados.registros} recarregar={recarregar} />

          <ConfirmModal
            open={confirmDeleteOpen}
            title="Excluir notas selecionadas?"
            message={`Deseja realmente excluir ${selecionados.size} nota(s) do banco de dados? Esta ação não pode ser desfeita.`}
            confirmLabel="Excluir"
            tone="danger"
            requireJustification={false}
            onConfirm={confirmarExcluir}
            onCancel={() => setConfirmDeleteOpen(false)}
          />

          <ConfirmModal
            open={confirmUndoOpen}
            title="Desfazer última alteração?"
            message="Deseja realmente reverter a última alteração salva no banco de dados?"
            confirmLabel="Desfazer"
            tone="default"
            requireJustification={false}
            onConfirm={confirmarDesfazer}
            onCancel={() => setConfirmUndoOpen(false)}
          />
        </React.Fragment>
      )}
    </div>
  );
}
