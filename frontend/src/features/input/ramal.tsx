import React from 'react';
import type { InputDataset, NotaInput, NotaRamal } from './types';
import type { FiltersState } from './filters';
import { filtrarRegistros } from './overview';
import { InputApi } from './api';
import { toast } from 'sonner';
import { parseColagemTsv } from './lib';
import { COLUNAS_RAMAL, COLUNAS_COLAGEM_RAMAL, ROTULOS_RAMAL } from './columns-ramal';
import { useRamalData, useRecarregarRamal } from './use-ramal-data';
import { DataGrid } from './data-grid';
import { NotesTable } from './notes-table';
import { NotesTableSkeleton } from './notes-table-skeleton';
import { MesExecucaoPicker } from '@/components/branded/mes-execucao-picker';
import { ColagemPlanilha } from './colagem-planilha';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { SegTabs, Banner, Eyebrow, StatNumber } from '@/components/branded/section';
import { ConfirmModal } from '../coffee/confirm-modal';
import { getInputEmptyState, InputEmptyState } from './empty-state';

type ModoRamal = 'visao' | 'rapida' | 'lote' | 'exclusao' | 'cadastro' | 'colagem';

const MODOS: { id: ModoRamal; rotulo: string }[] = [
  { id: 'visao',    rotulo: 'Visão Geral' },
  { id: 'rapida',   rotulo: 'Edição Rápida' },
  { id: 'lote',     rotulo: 'Edição em Lote' },
  { id: 'exclusao', rotulo: 'Exclusão' },
  { id: 'cadastro', rotulo: 'Cadastrar Nota' },
  { id: 'colagem',  rotulo: 'Colar Planilha' },
];

const NOTA_RAMAL_VAZIA: Record<string, string> = {
  Numero_Nota: '', Status_Nota: '-', Prioridade_Nota: '-',
  Planejado_DDPM: '0', Conjunto: '-', Circuito: '-',
  Local_Instalacao: '-', Mes_Execucao_Planejado: '-',
  CenTrab_Respon: '-', Observacao: '', Extracao_Antiga: '-',
  Status_Anterior: '-', Check_Btzero: '-', Plano: '-',
};

interface Mensagem { tipo: 'ok' | 'erro'; texto: string; }

export function Ramal({
  dadosPrincipais,
  estadoFiltros,
  onClearFilters,
}: {
  dadosPrincipais: InputDataset;
  estadoFiltros?: FiltersState;
  onClearFilters?: () => void;
}): React.JSX.Element {
  const { data: dadosRamal, isLoading, error, dataUpdatedAt } = useRamalData();
  const recarregar = useRecarregarRamal();

  const [modo, setModo] = React.useState<ModoRamal>('visao');
  const [edicoes, setEdicoes] = React.useState<Map<number, Partial<NotaRamal>>>(new Map());
  const [selecionados, setSelecionados] = React.useState<Set<number>>(new Set());
  const [msg, setMsg] = React.useState<Mensagem | null>(null);
  const [salvando, setSalvando] = React.useState(false);
  const [loteStatus, setLoteStatus] = React.useState('');
  const [lotePrioridade, setLotePrioridade] = React.useState('');
  const [loteMes, setLoteMes] = React.useState('');
  const [novaNota, setNovaNota] = React.useState<Record<string, string>>({ ...NOTA_RAMAL_VAZIA });
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

  function onEditar(numero: number, campo: string, valor: string | number | null): void {
    setEdicoes((prev) => {
      const m = new Map(prev);
      m.set(numero, { ...(m.get(numero) ?? {}), [campo]: valor } as Partial<NotaRamal>);
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
    void executar(`${edicoes.size} nota(s) ramal atualizada(s).`, async () => {
      const notas = [...edicoes.entries()].map(([n, campos]) => ({ Numero_Nota: n, ...campos }));
      await InputApi.importarRamal(notas);
      setEdicoes(new Map());
    });
  };

  const aplicarLote = (): void => {
    const notas = [...selecionados].map((n) => {
      const nota: Partial<NotaRamal> = { Numero_Nota: n };
      if (loteStatus) nota.Status_Nota = loteStatus;
      if (lotePrioridade) nota.Prioridade_Nota = lotePrioridade;
      if (loteMes.trim()) nota.Mes_Execucao_Planejado = loteMes.trim();
      return nota;
    });
    if (notas.length === 0 || (!loteStatus && !lotePrioridade && !loteMes.trim())) {
      setMsg({ tipo: 'erro', texto: 'Selecione notas e escolha pelo menos um novo valor.' });
      return;
    }
    void executar(`Lote aplicado em ${notas.length} nota(s) ramal.`, async () => {
      await InputApi.importarRamal(notas);
      setSelecionados(new Set());
    });
  };

  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  const excluirSelecionadas = (): void => {
    if (selecionados.size === 0) { setMsg({ tipo: 'erro', texto: 'Nenhuma nota selecionada.' }); return; }
    setConfirmDeleteOpen(true);
  };

  const confirmarExcluir = (): void => {
    setConfirmDeleteOpen(false);
    void executar(`${selecionados.size} nota(s) ramal excluída(s).`, async () => {
      await InputApi.excluirRamal([...selecionados]);
      setSelecionados(new Set());
    });
  };

  const cadastrar = (): void => {
    if (!/^\d+$/.test(novaNota.Numero_Nota)) { setMsg({ tipo: 'erro', texto: 'Nº da Nota inválido.' }); return; }
    void executar(`Nota ramal ${novaNota.Numero_Nota} cadastrada.`, async () => {
      await InputApi.importarRamal([{
        ...(novaNota as unknown as Partial<NotaRamal>),
        Numero_Nota: Number(novaNota.Numero_Nota),
        Planejado_DDPM: Number(novaNota.Planejado_DDPM) || 0,
      }]);
      setNovaNota({ ...NOTA_RAMAL_VAZIA });
    });
  };

  const salvarColagem = (): void => {
    if (previewColagem.length === 0) { setMsg({ tipo: 'erro', texto: 'Cole os dados antes de salvar.' }); return; }
    void executar(`${previewColagem.length} nota(s) ramal integradas.`, async () => {
      await InputApi.importarRamal(previewColagem.map((r) => ({
        ...(r as unknown as Partial<NotaRamal>),
        Numero_Nota: Number(r.Numero_Nota),
        Planejado_DDPM: Number(r.Planejado_DDPM) || 0,
      })));
      setTextoColagem('');
    });
  };

  function trocarModo(m: ModoRamal): void {
    setModo(m); setMsg(null); setSelecionados(new Set()); setEdicoes(new Map());
  }

  const comSelecao = modo === 'lote' || modo === 'exclusao';

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
        <SegTabs tabs={MODOS} value={modo} onChange={trocarModo} ariaLabel="Modo do ramal" />
      </div>

      {isLoading && <div role="status" className="p-8 text-center text-text-dim text-sm">Carregando notas ramal...</div>}
      {error != null && !dadosRamal && (
        <div role="alert" className="p-4 rounded-md bg-red/10 border border-red/20 text-red text-sm">
          Erro ao carregar ramal: {String((error as Error).message)}
        </div>
      )}
      {error != null && dadosRamal && (
        <div role="alert" className="px-3 py-1.5 rounded-md bg-amber/10 border border-amber/20 text-amber text-xs">
          {`Backend indisponível — mostrando dados salvos${dataUpdatedAt ? ` de ${new Date(dataUpdatedAt).toLocaleString('pt-BR')}` : ''}.`}
        </div>
      )}

      {msg && <Banner tipo={msg.tipo === 'ok' ? 'ok' : 'err'}>{msg.texto}</Banner>}

      {/* VISÃO GERAL — DataGrid com keyboard nav, resize, soma/média */}
      {modo === 'visao' && dadosRamal && (
        <React.Fragment>
          <div className="flex items-baseline gap-3 bg-surface p-4 rounded-lg border border-line shadow-sm">
            <StatNumber>{registros.length.toLocaleString('pt-BR')}</StatNumber>
            <Eyebrow className="text-xs tracking-wider">notas cadastradas no ramal</Eyebrow>
          </div>
          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
            {emptyState ? (
              emptyState === 'filter'
                ? <InputEmptyState state="filter" onClearFilters={onClearFilters} />
                : <InputEmptyState state="dataset" />
            ) : <DataGrid registros={registrosComoNotaInput} colunas={COLUNAS_RAMAL} />}
          </div>
        </React.Fragment>
      )}

      {/* EDIÇÃO RÁPIDA */}
      {modo === 'rapida' && dadosRamal && (
        <React.Fragment>
          <Card>
            <CardContent className="pt-6">
              <div className="flex gap-[12px] items-center flex-wrap">
                <span className="text-[12.5px] text-text-dim">
                  Duplo clique numa célula para editar. {edicoes.size} nota(s) com alterações pendentes.
                </span>
                <Button size="sm" disabled={salvando || edicoes.size === 0} onClick={salvarRapida}>
                  💾 Salvar edições
                </Button>
                <Button variant="ghost" size="sm" disabled={edicoes.size === 0}
                        onClick={() => setEdicoes(new Map())}>❌ Descartar</Button>
              </div>
            </CardContent>
          </Card>
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
        </React.Fragment>
      )}

      {/* EDIÇÃO EM LOTE / EXCLUSÃO */}
      {comSelecao && dadosRamal && (
        <React.Fragment>
          {modo === 'lote' && (
            <Card>
              <CardHeader><CardTitle>Edição em lote — Ramal</CardTitle></CardHeader>
              <CardContent>
                <div className="flex gap-[10px] items-center flex-wrap">
                  <Select value={loteStatus || undefined}
                          onValueChange={(v) => setLoteStatus(v === '__manter' ? '' : v)}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Status: (manter atual)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manter">Status: (manter atual)</SelectItem>
                      {dadosPrincipais.meta.status_opcoes.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={lotePrioridade || undefined}
                          onValueChange={(v) => setLotePrioridade(v === '__manter' ? '' : v)}>
                    <SelectTrigger className="w-[220px]">
                      <SelectValue placeholder="Prioridade: (manter atual)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__manter">Prioridade: (manter atual)</SelectItem>
                      {dadosPrincipais.meta.prioridade_opcoes.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <MesExecucaoPicker value={loteMes} onChange={setLoteMes}
                                     valorNeutro="" rotuloNeutro="Mês: (manter atual)"
                                     className="w-[240px]" />
                  <Button disabled={salvando} onClick={aplicarLote}>
                    Aplicar e salvar lote ({selecionados.size})
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {modo === 'exclusao' && (
            <Card>
              <CardContent className="pt-6">
                <div className="flex gap-[12px] items-center flex-wrap">
                  <span className="text-[12.5px] text-text-dim">
                    Marque as notas ramal e confirme a exclusão. {selecionados.size} selecionada(s).
                  </span>
                  <Button variant="destructive" size="sm" disabled={salvando} onClick={excluirSelecionadas}>
                    🗑 Excluir selecionadas
                  </Button>
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
            </CardContent>
          </Card>
        </React.Fragment>
      )}

      {/* CADASTRAR NOTA RAMAL */}
      {modo === 'cadastro' && (
        <Card>
          <CardHeader><CardTitle>Cadastrar nota ramal</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-[repeat(3,minmax(180px,1fr))] gap-[14px]">
              {Object.keys(NOTA_RAMAL_VAZIA).map((campo) => (
                <div key={campo} className="flex flex-col gap-[6px]">
                  <Label htmlFor={`nova-ramal-${campo}`} className="text-muted-foreground">
                    {ROTULOS_RAMAL[campo] ?? campo}
                  </Label>
                  {campo === 'Status_Nota' ? (
                    <Select value={novaNota[campo]}
                            onValueChange={(v) => setNovaNota({ ...novaNota, [campo]: v })}>
                      <SelectTrigger id={`nova-ramal-${campo}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dadosPrincipais.meta.status_opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : campo === 'Prioridade_Nota' ? (
                    <Select value={novaNota[campo]}
                            onValueChange={(v) => setNovaNota({ ...novaNota, [campo]: v })}>
                      <SelectTrigger id={`nova-ramal-${campo}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {dadosPrincipais.meta.prioridade_opcoes.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : campo === 'Mes_Execucao_Planejado' ? (
                    <MesExecucaoPicker id={`nova-ramal-${campo}`}
                                       value={novaNota[campo]}
                                       onChange={(v) => setNovaNota({ ...novaNota, [campo]: v })}
                                       valorNeutro="-" rotuloNeutro="—" />
                  ) : (
                    <Input id={`nova-ramal-${campo}`} value={novaNota[campo]}
                           onChange={(e) => setNovaNota({ ...novaNota, [campo]: e.target.value })} />
                  )}
                </div>
              ))}
            </div>
            <div className="mt-[16px]">
              <Button disabled={salvando} onClick={cadastrar}>💾 Salvar nota ramal</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* COLAR PLANILHA */}
      {modo === 'colagem' && (
        <ColagemPlanilha
          titulo="Colar planilha ramal"
          colunasColagem={COLUNAS_COLAGEM_RAMAL}
          colunasPreview={COLUNAS_RAMAL.filter((c) => COLUNAS_COLAGEM_RAMAL.includes(c.key))}
          rotulos={ROTULOS_RAMAL}
          texto={textoColagem}
          setTexto={setTextoColagem}
          preview={previewColagem}
          salvando={salvando}
          rotuloSalvar={`Salvar lote ramal (${previewColagem.length})`}
          onSalvar={salvarColagem} />
      )}

      <ConfirmModal
        open={confirmDeleteOpen}
        title="Excluir ramais selecionados?"
        message={`Deseja realmente excluir ${selecionados.size} nota(s) ramal do banco de dados? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        tone="danger"
        requireJustification={false}
        onConfirm={confirmarExcluir}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}
