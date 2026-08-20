import React from 'react';
import { Copy, FileSpreadsheet, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { usePersistedState } from '@/hooks/use-persisted-state';
import type { ConsultaLoteItem } from '../../types';
import { parseCoffeeIds } from './operacao-composer';
import { useConsultaLeitura } from '../use-consulta-leitura';

interface ConsultaNotasModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface ResumoConsulta {
  elegiveis: number;
  concluidas: number;
  naOperacao: number;
  erros: number;
}

export function resumir(resultados: ConsultaLoteItem[]): ResumoConsulta {
  const inicial: ResumoConsulta = { elegiveis: 0, concluidas: 0, naOperacao: 0, erros: 0 };
  return resultados.reduce((acc, item) => {
    if (item.erro) return { ...acc, erros: acc.erros + 1 };
    if (item.ja_na_operacao) return { ...acc, naOperacao: acc.naOperacao + 1 };
    if (item.elegivel) return { ...acc, elegiveis: acc.elegiveis + 1 };
    return { ...acc, concluidas: acc.concluidas + 1 };
  }, inicial);
}

async function copiarTexto(texto: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success(`${label} copiado`);
  } catch {
    toast.error('Erro ao copiar para a área de transferência');
  }
}

async function copiarTabela(resultados: ConsultaLoteItem[]): Promise<void> {
  if (resultados.length === 0) return;
  const header = ['ID', 'Local de Instalação', 'ID SAP', 'Situação', 'Erro'].join('\t');
  const rows = resultados.map((r) => [
    r.pk,
    r.local_instalacao ?? '—',
    r.id_sap ?? '—',
    r.ja_na_operacao
      ? 'Já na Operação'
      : r.classificacao === 'gerada'
        ? 'Concluída'
        : r.classificacao === 'pendente'
          ? 'Aguardando SAP'
          : r.classificacao === 'duplicada'
            ? 'Duplicada'
            : 'Ainda não gerada',
    r.erro ?? '—',
  ].join('\t')).join('\n');

  try {
    await navigator.clipboard.writeText(`${header}\n${rows}`);
    toast.success('Tabela copiada em formato TSV (pronta para o Excel)');
  } catch {
    toast.error('Erro ao copiar tabela');
  }
}

export function ConsultaNotasModal({
  open,
  onOpenChange,
}: ConsultaNotasModalProps): React.JSX.Element {
  const [texto, setTexto] = usePersistedState('edp_coffee_modal_consulta_text', '');
  const consulta = useConsultaLeitura();
  const parsed = React.useMemo(() => parseCoffeeIds(texto), [texto]);
  const contagens = resumir(consulta.resultados ?? []);

  async function handleBuscar(): Promise<void> {
    if (parsed.ids.length === 0 || consulta.pending) return;
    try {
      await consulta.iniciar(parsed.ids);
      toast.success(`${parsed.ids.length} notas consultadas.`);
    } catch (error: unknown) {
      toast.error('Falha ao consultar notas', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function handleLimpar(): void {
    setTexto('');
    consulta.fechar();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void handleBuscar();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[900px] max-w-[95vw] flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="border-b border-line bg-bg-2 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <DialogTitle className="font-mono text-sm font-medium uppercase tracking-wider text-text">
                Consulta de Notas COFFEE
              </DialogTitle>
              {consulta.resultados && (
                <>
                  <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] font-medium text-text-dim">
                    {consulta.resultados.length} {consulta.resultados.length === 1 ? 'nota' : 'notas'}
                  </span>
                  <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-dim">
                    {contagens.elegiveis} não geradas
                  </span>
                  <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-dim">
                    {contagens.concluidas} concluídas
                  </span>
                  <span className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-dim">
                    {contagens.naOperacao} na operação
                  </span>
                  {contagens.erros > 0 && (
                    <span className="rounded border border-status-red-border/50 bg-tint-red px-1.5 py-0.5 font-mono text-[11px] text-red">
                      {contagens.erros} erros
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* Input Bar */}
        <div className="flex flex-col gap-2 border-b border-line bg-surface px-6 py-3">
          <div className="flex items-center gap-2">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Cole IDs das notas (separados por espaço, vírgula ou linha)..."
              aria-label="IDs para consulta"
              rows={1}
              className="min-h-[38px] max-h-[80px] flex-1 resize-none bg-surface py-2 font-mono text-xs placeholder:text-text-mute"
              disabled={consulta.pending}
            />
            <Button
              size="sm"
              disabled={parsed.ids.length === 0 || consulta.pending}
              onClick={() => void handleBuscar()}
              className="h-[38px] gap-1.5 px-3.5 text-xs font-medium"
            >
              <Search className="size-3.5" />
              {consulta.pending ? 'Consultando…' : 'Consultar'}
            </Button>
            {(texto || consulta.resultados) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLimpar}
                disabled={consulta.pending}
                className="h-[38px] gap-1.5 px-2.5 text-xs text-text-mute hover:text-text"
              >
                <Trash2 className="size-3.5" /> Limpar
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between text-[11px] text-text-mute">
            <span className="font-mono">
              {parsed.ids.length} {parsed.ids.length === 1 ? 'ID válido' : 'IDs válidos'}
              {parsed.invalidos.length > 0 && ` · ${parsed.invalidos.length} inválidos`}
              {parsed.repetidos.length > 0 && ` · ${parsed.repetidos.length} repetidos`}
            </span>
            <span className="font-mono text-[10.5px]">
              <kbd className="rounded border border-line bg-bg-2 px-1 py-0.5 text-[9.5px]">Ctrl+Enter</kbd> para consultar
            </span>
          </div>
        </div>

        {/* Table Results */}
        <div className="min-h-[220px] max-h-[48vh] flex-1 overflow-y-auto bg-surface">
          {!consulta.resultados ? (
            <div className="flex min-h-[220px] flex-col items-center justify-center gap-1.5 p-8 text-center text-text-mute">
              <Search className="size-7 text-text-mute/40" />
              <span className="text-xs font-medium text-text">Nenhuma consulta realizada.</span>
              <span className="font-mono text-[11px] text-text-mute">
                Cole os IDs das notas no campo acima e clique em &quot;Consultar&quot;.
              </span>
            </div>
          ) : consulta.resultados.length === 0 ? (
            <div className="flex min-h-[200px] flex-col items-center justify-center p-8 text-center text-xs text-text-mute">
              Nenhuma nota encontrada para os IDs informados.
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 border-b border-line bg-bg-2 font-mono text-[11px] uppercase tracking-wider text-text-mute">
                <tr>
                  <th className="px-6 py-2">ID COFFEE</th>
                  <th className="px-4 py-2">Local de Instalação</th>
                  <th className="px-4 py-2">ID SAP</th>
                  <th className="px-4 py-2">Situação</th>
                  <th className="px-6 py-2 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {consulta.resultados.map((item) => (
                  <tr key={item.pk} className="transition-colors even:bg-bg-2/30 hover:bg-surface-2">
                    <td className="px-6 py-2.5">
                      <button
                        type="button"
                        onClick={() => void copiarTexto(String(item.pk), `ID #${item.pk}`)}
                        className="group inline-flex items-center gap-1 font-mono font-medium text-text hover:text-primary"
                        title="Clique para copiar ID"
                      >
                        <span>#{item.pk}</span>
                        <Copy className="size-3 opacity-0 group-hover:opacity-100 transition-opacity text-text-mute" />
                      </button>
                    </td>
                    <td className="px-4 py-2.5">
                      {item.local_instalacao ? (
                        <button
                          type="button"
                          onClick={() => void copiarTexto(item.local_instalacao!, `Local ${item.local_instalacao}`)}
                          className="group inline-flex items-center gap-1 font-mono text-text-dim hover:text-text"
                          title="Clique para copiar local"
                        >
                          <span>{item.local_instalacao}</span>
                          <Copy className="size-3 opacity-0 group-hover:opacity-100 transition-opacity text-text-mute" />
                        </button>
                      ) : (
                        <span className="font-mono text-text-mute">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.id_sap ? (
                        <button
                          type="button"
                          onClick={() => void copiarTexto(String(item.id_sap), `SAP ${item.id_sap}`)}
                          className="group inline-flex items-center gap-1 font-mono font-medium text-text hover:text-primary"
                          title="Clique para copiar SAP"
                        >
                          <span>SAP {item.id_sap}</span>
                          <Copy className="size-3 opacity-0 group-hover:opacity-100 transition-opacity text-text-mute" />
                        </button>
                      ) : (
                        <span className="font-mono text-text-mute">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {item.erro ? (
                        <span className="font-mono text-xs text-red">{item.erro}</span>
                      ) : item.ja_na_operacao ? (
                        <span className="inline-flex rounded border border-status-blue-border/50 bg-tint-blue px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-blue">
                          Já na Operação
                        </span>
                      ) : item.classificacao === 'gerada' ? (
                        <span className="inline-flex rounded border border-status-green-border/50 bg-tint-green px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-green">
                          Concluída
                        </span>
                      ) : item.classificacao === 'pendente' ? (
                        <span className="inline-flex rounded border border-status-amber-border/50 bg-tint-amber px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-amber">
                          Aguardando SAP
                        </span>
                      ) : item.classificacao === 'duplicada' ? (
                        <span className="inline-flex rounded border border-status-red-border/50 bg-tint-red px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-red">
                          Duplicada
                        </span>
                      ) : (
                        <span className="inline-flex rounded border border-line bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-text-dim">
                          Ainda não gerada
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-2.5 text-right">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => void copiarTexto(
                          `#${item.pk} | Local: ${item.local_instalacao ?? '—'} | SAP: ${item.id_sap ?? '—'} | Status: ${item.classificacao}`,
                          `Dados da nota #${item.pk}`,
                        )}
                        className="h-6 gap-1 px-2 text-xs font-mono text-text-dim hover:text-text"
                        title="Copiar linha completa"
                      >
                        <Copy className="size-3" /> Copiar linha
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-bg-2 px-6 py-2.5">
          <span className="font-mono text-[11px] text-text-mute">
            {consulta.resultados ? `${consulta.resultados.length} registros listados` : 'Pronto para consultar'}
          </span>
          <div className="flex items-center gap-2">
            {consulta.resultados && consulta.resultados.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copiarTabela(consulta.resultados!)}
                className="h-7 gap-1.5 text-xs font-medium"
              >
                <FileSpreadsheet className="size-3.5" /> Copiar tabela (Excel)
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-7 px-3 text-xs font-medium"
            >
              Fechar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
