import React from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { usePersistedState } from '@/hooks/use-persisted-state';

export interface ParsedIds {
  ids: number[];
  invalidos: string[];
  repetidos: number[];
}

export function parseCoffeeIds(value: string): ParsedIds {
  const tokens = value.split(/[\s,;]+/).filter(Boolean);
  const validos = tokens
    .filter((token) => /^\d+$/.test(token) && Number(token) > 0)
    .map(Number);
  const ids = [...new Set(validos)];
  const ocorrencias = new Map<number, number>();
  validos.forEach((id) => ocorrencias.set(id, (ocorrencias.get(id) ?? 0) + 1));

  return {
    ids,
    invalidos: tokens.filter(
      (token) => !/^\d+$/.test(token) || Number(token) <= 0,
    ),
    repetidos: [...ocorrencias.entries()]
      .filter(([, vezes]) => vezes > 1)
      .map(([id]) => id),
  };
}

interface ComposerFeedbackProps {
  parsed: ParsedIds;
  jaNaOperacao: number;
}

/** Pura: renderiza a contagem de válidos e um chip por token exato de
 * repetido/inválido, dado um ParsedIds já calculado. Extraída de
 * OperacaoComposer pra poder ser testada diretamente com um `parsed`
 * arbitrário (ver a nota de testes no cabeçalho da Task 6 do plano). */
export function ComposerFeedback({ parsed, jaNaOperacao }: ComposerFeedbackProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-mute">
      <span className="font-mono text-xs font-medium text-text">{parsed.ids.length} válidos</span>
      {parsed.repetidos.map((id) => (
        <span key={`rep-${id}`} className="rounded-[5px] border border-status-amber-border/50 bg-tint-amber px-2 py-0.5 font-mono text-[11px] font-medium text-amber">
          repetido: {id}
        </span>
      ))}
      {parsed.invalidos.map((token, indice) => (
        <span key={`inv-${indice}-${token}`} className="rounded-[5px] border border-status-red-border/50 bg-tint-red px-2 py-0.5 font-mono text-[11px] font-medium text-red">
          inválido: {token}
        </span>
      ))}
      {jaNaOperacao > 0 && (
        <span className="rounded-[5px] border border-status-blue-border/50 bg-tint-blue px-2 py-0.5 font-mono text-[11px] font-medium text-blue">
          {jaNaOperacao} já na operação
        </span>
      )}
    </div>
  );
}

interface OperacaoComposerProps {
  pendingAdicionar: boolean;
  /** IDs já presentes na Operação, pra avisar antes de enfileirar de novo.
   * Omitido quando o quadro ainda não carregou. */
  idsNaOperacao?: Set<number>;
  onAdicionarFila: (ids: number[]) => Promise<void>;
  onAbrirConsulta: () => void;
}

export function OperacaoComposer({
  pendingAdicionar,
  idsNaOperacao,
  onAdicionarFila,
  onAbrirConsulta,
}: OperacaoComposerProps): React.JSX.Element {
  const [value, setValue] = usePersistedState('edp_coffee_operacao_composer_text', '');
  const [erro, setErro] = React.useState<string | null>(null);
  const parsed = React.useMemo(() => parseCoffeeIds(value), [value]);
  const jaNaOperacao = idsNaOperacao
    ? parsed.ids.filter((id) => idsNaOperacao.has(id)).length
    : 0;

  async function adicionarFila(): Promise<void> {
    if (parsed.ids.length === 0 || pendingAdicionar) return;
    setErro(null);
    try {
      await onAdicionarFila(parsed.ids);
      setValue('');
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void adicionarFila();
    }
  }

  return (
    <section className="flex flex-col gap-2 border-b border-line bg-bg-2 px-6 py-2.5">
      <div className="flex items-center gap-2">
        <Textarea
          value={value}
          onChange={(event) => { setValue(event.target.value); setErro(null); }}
          onKeyDown={onKeyDown}
          placeholder="Cole IDs das notas para adicionar à fila..."
          aria-label="IDs COFFEE"
          rows={1}
          aria-invalid={erro !== null}
          className="min-h-[36px] max-h-[72px] flex-1 resize-none bg-surface py-1.5 font-mono text-xs leading-normal placeholder:text-text-mute"
          disabled={pendingAdicionar}
        />
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            disabled={parsed.ids.length === 0 || pendingAdicionar}
            onClick={() => void adicionarFila()}
            className="h-9 gap-1.5 px-3.5 text-xs font-medium"
          >
            <Plus className="size-3.5" /> {pendingAdicionar ? 'Adicionando…' : 'Adicionar à fila'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onAbrirConsulta}
            className="h-9 gap-1.5 px-3 text-xs font-medium"
          >
            <Search className="size-3.5" /> Consultar notas…
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ComposerFeedback parsed={parsed} jaNaOperacao={jaNaOperacao} />
        <span className="font-mono text-[11px] text-text-mute">
          Dica: <kbd className="rounded border border-line bg-surface px-1 py-0.5 text-[9.5px] text-text-dim">Ctrl</kbd> + <kbd className="rounded border border-line bg-surface px-1 py-0.5 text-[9.5px] text-text-dim">Enter</kbd> adiciona diretamente à fila
        </span>
      </div>
      {erro && (
        <p role="alert" className="text-xs font-mono text-red">{erro}</p>
      )}
    </section>
  );
}
