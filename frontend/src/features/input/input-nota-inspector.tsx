import React from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/branded/section';

import { CarteiraEnriquecimentoCard } from '../carteira/carteira-enriquecimento-card';
import { ROTULOS } from './columns';
import { ehNotaOculta } from './lib';
import { InputApi } from './api';
import { useRecarregarInput } from './use-input-data';
import { OcultacaoModal } from './ocultacao-modal';
import type { NotaInput } from './types';

const CAMPOS_RESUMO = [
  'Numero_Nota',
  'Regional',
  'Status_Obra',
  'Conjunto',
  'Circuito',
  'Local_Instalacao',
  'Planejado_DDPM',
  'Mes_Execucao_Planejado',
  'Prioridade_Nota',
  'Status_Nota',
] as const;

export function InputNotaResumo({
  nota,
}: {
  nota: NotaInput;
}): React.JSX.Element {
  return (
    <section aria-labelledby="input-nota-resumo">
      <Eyebrow asChild className="mb-3">
        <h2 id="input-nota-resumo">
          Resumo do Input
        </h2>
      </Eyebrow>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CAMPOS_RESUMO.map((campo) => (
          <div key={campo} className="min-w-0">
            <dt className="text-xs text-text-mute">
              {ROTULOS[campo] ?? campo}
            </dt>
            <dd className="font-mono mt-1 break-words text-sm">
              {String(nota[campo] ?? '—')}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

interface InputNotaInspectorProps {
  nota: NotaInput | null;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onIrParaSincronizacao: () => void;
}

export function InputNotaInspector({
  nota,
  onClose,
  returnFocusRef,
  onIrParaSincronizacao,
}: InputNotaInspectorProps): React.JSX.Element {
  const recarregar = useRecarregarInput();
  const [salvando, setSalvando] = React.useState(false);
  const [modalOcultar, setModalOcultar] = React.useState(false);
  const oculta = nota ? ehNotaOculta(nota) : false;

  async function reexibirNota() {
    if (!nota) return;
    setSalvando(true);
    try {
      await InputApi.editar([{ Numero_Nota: nota.Numero_Nota, Check: '-' }]);
      toast.success(`Nota #${nota.Numero_Nota} reexibida com sucesso!`);
      await recarregar();
      onClose();
    } catch (e) {
      toast.error('Erro ao reexibir nota', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarOcultacao(justificativa: string) {
    if (!nota) return;
    setSalvando(true);
    try {
      const obsOriginal = String(nota.Observacao ?? '').trim();
      const tagMotivo = `[OCULTA: ${justificativa}]`;
      const novaObs = obsOriginal ? `${obsOriginal} ${tagMotivo}` : tagMotivo;
      await InputApi.editar([
        { Numero_Nota: nota.Numero_Nota, Check: 'Oculta', Observacao: novaObs },
      ]);
      toast.success(`Nota #${nota.Numero_Nota} marcada como oculta.`);
      setModalOcultar(false);
      await recarregar();
      onClose();
    } catch (e) {
      toast.error('Erro ao ocultar nota', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <React.Fragment>
      <OcultacaoModal
        aberto={modalOcultar}
        notas={nota ? [nota.Numero_Nota] : []}
        busy={salvando}
        onConfirmar={confirmarOcultacao}
        onCancelar={() => setModalOcultar(false)}
      />

      <Sheet open={nota !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent
          side="right"
          className="flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-[560px]"
          onEscapeKeyDown={(event) => event.stopPropagation()}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <SheetHeader className="border-b border-line p-4 flex flex-row items-center justify-between gap-3">
            <SheetTitle className="flex items-center gap-2">
              <span>Nota SAP</span> <span className="font-mono">#{nota?.Numero_Nota ?? '—'}</span>
              {oculta && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                  <EyeOff size={11} />
                  Oculta
                </span>
              )}
            </SheetTitle>
            {nota && (
              <Button
                variant={oculta ? "default" : "outline"}
                size="xs"
                disabled={salvando}
                onClick={() => {
                  if (oculta) {
                    void reexibirNota();
                  } else {
                    setModalOcultar(true);
                  }
                }}
                className="gap-1.5 text-xs mr-6"
                title={oculta ? "Reexibir esta nota no painel" : "Ocultar esta nota do painel geral"}
              >
                {salvando ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : oculta ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
                {oculta ? 'Reexibir Nota' : 'Ocultar Nota'}
              </Button>
            )}
          </SheetHeader>
          {nota !== null && (
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
              <InputNotaResumo nota={nota} />
              <CarteiraEnriquecimentoCard
                numeroSap={nota.Numero_Nota}
                enabled
                onIrParaSincronizacao={onIrParaSincronizacao}
              />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </React.Fragment>
  );
}
