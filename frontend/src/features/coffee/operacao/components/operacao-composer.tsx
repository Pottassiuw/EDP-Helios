import React from 'react';
import { Plus, Search } from 'lucide-react';
import { Eyebrow } from '@/components/branded/section';
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

interface OperacaoComposerProps {
  pending: boolean;
  /** IDs já presentes na Operação (fila/pronta/processando/aguardando SAP),
   * pra avisar antes de consultar de novo. Omitido quando o quadro ainda não
   * carregou. */
  idsNaOperacao?: Set<number>;
  onConsultar: (ids: number[]) => Promise<void>;
}

export function OperacaoComposer({
  pending,
  idsNaOperacao,
  onConsultar,
}: OperacaoComposerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [erro, setErro] = React.useState<string | null>(null);
  const parsed = React.useMemo(() => parseCoffeeIds(value), [value]);
  const jaNaOperacao = idsNaOperacao
    ? parsed.ids.filter((id) => idsNaOperacao.has(id)).length
    : 0;

  function fechar(): void {
    setOpen(false);
    setValue('');
    setErro(null);
  }

  async function consultar(): Promise<void> {
    if (parsed.ids.length === 0 || pending) return;
    setErro(null);
    try {
      await onConsultar(parsed.ids);
      fechar();
    } catch (error) {
      setErro(error instanceof Error ? error.message : String(error));
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void consultar();
    }
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus /> Adicionar notas
      </Button>
    );
  }

  return (
    <section className="w-full max-w-xl rounded-[11px] border border-line bg-surface p-4">
      <Eyebrow asChild>
        <label htmlFor="coffee-operation-ids">IDs COFFEE</label>
      </Eyebrow>
      <p className="mt-1 text-xs text-text-mute">
        Cole os IDs separados por espaço, vírgula, ponto e vírgula ou linha.
        Só números positivos e únicos seguem para a consulta.
      </p>
      <Textarea
        id="coffee-operation-ids"
        value={value}
        onChange={(event) => { setValue(event.target.value); setErro(null); }}
        onKeyDown={onKeyDown}
        placeholder={'101\n102\n103'}
        rows={8}
        aria-invalid={erro !== null}
        className="mt-3 min-h-40 max-h-72 resize-y overflow-y-auto font-mono"
        disabled={pending}
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-mute">
        <span className="font-medium text-text">{parsed.ids.length} válidos</span>
        <span>{parsed.repetidos} repetidos</span>
        <span>{parsed.invalidos.length} inválidos</span>
        {jaNaOperacao > 0 && (
          <span className="text-amber">{jaNaOperacao} já na operação</span>
        )}
      </div>
      {erro && (
        <p role="alert" className="mt-2 text-xs text-red">
          {erro}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[11px] text-text-mute">Ctrl+Enter para consultar</span>
        <Button variant="ghost" size="sm" disabled={pending} onClick={fechar}>
          Cancelar
        </Button>
        <Button
          size="sm"
          disabled={parsed.ids.length === 0 || pending}
          onClick={() => void consultar()}
        >
          <Search /> {pending ? 'Consultando…' : 'Consultar'}
        </Button>
      </div>
    </section>
  );
}
