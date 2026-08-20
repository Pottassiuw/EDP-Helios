import React from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-[6px] text-xs text-text-mute">
      <span className="font-medium text-text">{parsed.ids.length} válidos</span>
      {parsed.repetidos.map((id) => (
        <span key={`rep-${id}`} className="rounded-full bg-tint-amber px-[9px] py-[3px] font-mono text-[11px] text-amber">
          repetido: {id}
        </span>
      ))}
      {parsed.invalidos.map((token, indice) => (
        <span key={`inv-${indice}-${token}`} className="rounded-full bg-tint-red px-[9px] py-[3px] font-mono text-[11px] text-red">
          inválido: {token}
        </span>
      ))}
      {jaNaOperacao > 0 && (
        <span className="text-amber">{jaNaOperacao} já na operação</span>
      )}
    </div>
  );
}

interface OperacaoComposerProps {
  pendingConsulta: boolean;
  pendingAdicionar: boolean;
  /** IDs já presentes na Operação, pra avisar antes de enfileirar de novo.
   * Omitido quando o quadro ainda não carregou. */
  idsNaOperacao?: Set<number>;
  onConsultar: (ids: number[]) => Promise<void>;
  onAdicionarFila: (ids: number[]) => Promise<void>;
}

export function OperacaoComposer({
  pendingConsulta,
  pendingAdicionar,
  idsNaOperacao,
  onConsultar,
  onAdicionarFila,
}: OperacaoComposerProps): React.JSX.Element {
  const [value, setValue] = React.useState('');
  const [erro, setErro] = React.useState<string | null>(null);
  const parsed = React.useMemo(() => parseCoffeeIds(value), [value]);
  const jaNaOperacao = idsNaOperacao
    ? parsed.ids.filter((id) => idsNaOperacao.has(id)).length
    : 0;
  const pending = pendingConsulta || pendingAdicionar;

  async function consultar(): Promise<void> {
    if (parsed.ids.length === 0 || pending) return;
    setErro(null);
    try {
      await onConsultar(parsed.ids);
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    }
  }

  async function adicionarFila(): Promise<void> {
    if (parsed.ids.length === 0 || pending) return;
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
    <section className="flex flex-col gap-[9px] border-b border-line bg-bg-2 px-[22px] py-[14px]">
      <div className="flex items-start gap-[10px]">
        <Textarea
          value={value}
          onChange={(event) => { setValue(event.target.value); setErro(null); }}
          onKeyDown={onKeyDown}
          placeholder="Cole IDs — espaço, vírgula ou linha"
          aria-label="IDs COFFEE"
          rows={2}
          aria-invalid={erro !== null}
          className="min-h-[52px] flex-1 resize-none font-mono text-[12.5px]"
          disabled={pending}
        />
        <div className="flex shrink-0 flex-col gap-[6px]">
          <Button
            variant="outline"
            size="sm"
            disabled={parsed.ids.length === 0 || pending}
            onClick={() => void consultar()}
          >
            <Search /> {pendingConsulta ? 'Consultando…' : 'Consultar'}
          </Button>
          <Button
            size="sm"
            disabled={parsed.ids.length === 0 || pending}
            onClick={() => void adicionarFila()}
          >
            <Plus /> {pendingAdicionar ? 'Adicionando…' : 'Adicionar à fila'}
          </Button>
        </div>
      </div>
      <ComposerFeedback parsed={parsed} jaNaOperacao={jaNaOperacao} />
      {erro && (
        <p role="alert" className="text-xs text-red">{erro}</p>
      )}
      <span className="text-[11px] text-text-mute">Ctrl+Enter adiciona à fila</span>
    </section>
  );
}
