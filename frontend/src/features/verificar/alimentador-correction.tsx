import React from 'react';
import { RefreshCw, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Eyebrow } from '@/components/branded/section';
import { useAlimentadores, useAlimentadorCorrection } from './use-alimentador-correction';

export function AlimentadorCorrection({ noteId }: { noteId: string }): React.JSX.Element {
  const opcoes = useAlimentadores();
  const fluxo = useAlimentadorCorrection(noteId);

  return (
    <section className="rounded-app-sm border border-line bg-surface p-[14px]">
      <Eyebrow asChild><h3>Alimentador (circuito)</h3></Eyebrow>
      <div className="mt-[8px] flex flex-wrap items-center gap-[8px]">
        <Select
          value={fluxo.proposto || undefined}
          disabled={fluxo.consultando || fluxo.salvando || opcoes.isLoading}
          onValueChange={fluxo.escolher}
        >
          <SelectTrigger className="max-w-[280px] font-mono" aria-label="Alimentador">
            <SelectValue placeholder={fluxo.consultando ? 'Consultando…' : 'Selecione o alimentador'} />
          </SelectTrigger>
          <SelectContent>
            {(opcoes.data ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.id}{a.cidade ? ` — ${a.cidade}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!fluxo.podeSalvar} onClick={fluxo.salvar}>
          <Save /> {fluxo.salvando ? 'Salvando…' : 'Salvar no COFFEE'}
        </Button>
        <Button variant="ghost" size="sm" disabled={fluxo.consultando}
                onClick={() => void fluxo.atualizar()}>
          <RefreshCw /> Atualizar
        </Button>
      </div>
      <div className="mt-[6px] font-mono text-[10.5px] text-text-mute">
        Atual no COFFEE: {fluxo.atual || '—'}
      </div>
      {fluxo.erro && (
        <div role="alert" className="mt-[8px] text-[12px] text-red">{fluxo.erro}</div>
      )}
    </section>
  );
}
