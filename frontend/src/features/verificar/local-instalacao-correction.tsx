import React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight, RefreshCw, Save, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eyebrow } from '@/components/branded/section';
import {
  formatarLocalInstalacao,
  localInstalacaoValido,
} from '@/lib/local-instalacao';
import type { CoffeeConsulta } from '../coffee/types';
import { useLocalInstalacaoCorrection } from './use-local-instalacao-correction';

interface LocalInstalacaoCorrectionProps {
  noteId: string;
  localTriagem: string;
  encaminhada: boolean;
  consulta: UseQueryResult<CoffeeConsulta>;
  onEncaminhar: () => void;
}

export function LocalInstalacaoCorrection({
  noteId,
  localTriagem,
  encaminhada,
  consulta,
  onEncaminhar,
}: LocalInstalacaoCorrectionProps): React.JSX.Element {
  const fluxo = useLocalInstalacaoCorrection(noteId, localTriagem, consulta);
  const valido = localInstalacaoValido(fluxo.proposto);
  const ocupado = fluxo.consultando || fluxo.salvando;

  return (
    <section
      aria-labelledby="correcao-local-coffee"
      className="rounded-app-sm border border-[color:var(--accent)] bg-[var(--accent-tint)] p-[14px]"
    >
      <div className="flex flex-wrap items-center gap-[8px]">
        <ShieldCheck className="size-[16px] text-[var(--accent)]" />
        <Eyebrow asChild>
          <h3 id="correcao-local-coffee" className="text-[var(--accent)]">
            Corrigir local no COFFEE
          </h3>
        </Eyebrow>
        <Badge variant="outline" className="text-[10px]">
          Disponível via API
        </Badge>
      </div>
      <p className="mt-[6px] text-[12.5px] text-text-dim">
        Esta alteração atualiza diretamente cidade, tipo e número do local no COFFEE.
        Os demais campos continuam somente para consulta.
      </p>

      <div className="mt-[12px] grid gap-[10px] sm:grid-cols-2">
        <div className="rounded-app-sm border border-line bg-surface px-[11px] py-[9px]">
          <div className="font-mono text-[9.5px] uppercase tracking-[.1em] text-text-mute">
            Valor da triagem
          </div>
          <div className="mt-[3px] font-mono text-[12.5px]">
            {formatarLocalInstalacao(localTriagem) || '—'}
          </div>
        </div>
        <div className="rounded-app-sm border border-line bg-surface px-[11px] py-[9px]">
          <div className="font-mono text-[9.5px] uppercase tracking-[.1em] text-text-mute">
            Valor atual no COFFEE
          </div>
          <div className="mt-[3px] font-mono text-[12.5px]">
            {fluxo.consultando
              ? 'Consultando…'
              : formatarLocalInstalacao(fluxo.localCoffee) || 'Não informado'}
          </div>
        </div>
      </div>

      <label className="mt-[12px] block">
        <span className="text-[12px] font-medium">Novo local de instalação</span>
        <div className="mt-[5px] flex flex-wrap items-center gap-[8px]">
          <Input
            aria-label="Novo local de instalação"
            aria-invalid={!valido && fluxo.proposto.length > 0}
            value={fluxo.rascunho}
            disabled={ocupado}
            onChange={(event) => fluxo.alterarRascunho(event.target.value)}
            placeholder="701-CF-12345678"
            className="max-w-[260px] font-mono"
          />
          <Button
            size="sm"
            disabled={!fluxo.podeSalvar}
            onClick={fluxo.salvar}
          >
            <Save /> {fluxo.salvando ? 'Salvando…' : 'Salvar no COFFEE'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={ocupado}
            onClick={() => void fluxo.atualizarConsulta()}
          >
            <RefreshCw /> Atualizar consulta
          </Button>
        </div>
        <span className="mt-[5px] block font-mono text-[10.5px] text-text-mute">
          3 cidade · 2 tipo · 8 número · {fluxo.proposto.length}/13 caracteres
        </span>
      </label>

      {fluxo.erro && (
        <div role="alert" className="mt-[10px] text-[12px] text-red">
          {fluxo.erro}
        </div>
      )}
      {fluxo.confirmado && (
        <div role="status" className="mt-[10px] text-[12px] text-green">
          {fluxo.salvo
            ? 'Local corrigido e confirmado por releitura do COFFEE.'
            : 'Valor atual confirmado por consulta ao COFFEE.'}
        </div>
      )}

      <div className="mt-[12px] flex flex-wrap items-center gap-[8px] border-t border-line pt-[10px]">
        <span className="mr-auto text-[11.5px] text-text-dim">
          Próximo passo: encaminhar a nota para a Operação.
        </span>
        <Button
          size="sm"
          disabled={!fluxo.confirmado || encaminhada}
          onClick={onEncaminhar}
        >
          <ArrowRight /> {encaminhada ? 'Já encaminhada' : 'Encaminhar para operação'}
        </Button>
      </div>
    </section>
  );
}
