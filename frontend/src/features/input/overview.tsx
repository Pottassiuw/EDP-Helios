import React from 'react';
import { Loader2, Download, RefreshCw, CheckCircle2, GitMerge, TableProperties, FolderOpen } from 'lucide-react';
import type { InputDataset, NotaInput } from './types';
import { InputApi, baixarBlob } from './api';
import { toast } from 'sonner';
import { aplicarFiltros, parseBuscaGlobal } from './lib';
import { COLUNAS } from './columns';
import { type FiltersState } from './filters';
import { DataGrid } from './data-grid';
import { NotesTable } from './notes-table';
import { InputNotaInspector } from './input-nota-inspector';
import { useRecarregarInput } from './use-input-data';
import { Button } from '@/components/ui/button';
import { Eyebrow, StatNumber } from '@/components/branded/section';

export function filtrarRegistros(registros: NotaInput[], estado: FiltersState): NotaInput[] {
  let resultado = registros;

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
  onIrParaSincronizacao?: () => void;
}

export function Overview({
  dados,
  estado,
  onIrParaSincronizacao = () => {},
}: OverviewProps): React.JSX.Element {
  const [exportando, setExportando] = React.useState(false);
  const [modoVisualizacao, setModoVisualizacao] = React.useState<'planilha' | 'hierarquia'>('planilha');
  const [notaDetalhe, setNotaDetalhe] = React.useState<NotaInput | null>(null);
  const botaoDetalheRef = React.useRef<HTMLButtonElement | null>(null);

  const recarregar = useRecarregarInput();
  const filtrados = React.useMemo(
    () => filtrarRegistros(dados.registros, estado), [dados.registros, estado]);

  const abrirDetalhes = React.useCallback(
    (nota: NotaInput, trigger: HTMLButtonElement): void => {
      botaoDetalheRef.current = trigger;
      setNotaDetalhe(nota);
    },
    [],
  );

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
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
        <div className="flex items-baseline gap-3">
          <StatNumber>
            {filtrados.length.toLocaleString('pt-BR')}
          </StatNumber>
          <Eyebrow className="text-xs tracking-wider">
            {filtrado ? `de ${dados.registros.length.toLocaleString('pt-BR')} notas encontradas` : 'notas cadastradas'}
          </Eyebrow>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs font-semibold gap-2 border-line bg-surface hover:bg-surface-2 transition-colors cursor-pointer shadow-2xs"
            onClick={() => setModoVisualizacao((prev) => (prev === 'planilha' ? 'hierarquia' : 'planilha'))}
            title={
              modoVisualizacao === 'planilha'
                ? "Clique para alternar para a Visão Hierárquica (gavetinhas de notas mães/filhas)"
                : "Clique para alternar para a Visão Planilha (grid interativo com cópia e seleção)"
            }
          >
            {modoVisualizacao === 'planilha' ? (
              <>
                <TableProperties className="h-4 w-4 text-green shrink-0" />
                <span>📊 Visão Planilha</span>
              </>
            ) : (
              <>
                <FolderOpen className="h-4 w-4 text-green shrink-0" />
                <span>📁 Visão Hierárquica</span>
              </>
            )}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs"
            disabled={dados.meta.sincronizando}
            onClick={() => {
              toast.promise(
                (async () => {
                  await InputApi.syncSap();
                  recarregar();
                })(),
                {
                  loading: 'Iniciando extração do SAP...',
                  success: 'Sincronização SAP rodando em background!',
                  error: 'Erro ao iniciar SAP',
                }
              );
            }}
          >
            {dados.meta.sincronizando ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Sincronizar SAP
              </>
            )}
          </Button>
          <Button
            size="sm"
            className="h-9 px-3 text-xs"
            disabled={exportando || filtrados.length === 0}
            onClick={() => { void exportar(); }}
          >
            {exportando ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Gerando...
              </>
            ) : (
              <>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Exportar Excel
              </>
            )}
          </Button>
        </div>
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
            agruparGavetinhas={true}
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

