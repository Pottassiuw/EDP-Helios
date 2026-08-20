import React from 'react';
import { EyeOff, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

interface OcultacaoModalProps {
  aberto: boolean;
  notas: number[];
  busy?: boolean;
  onConfirmar: (justificativa: string) => void;
  onCancelar: () => void;
}

export function OcultacaoModal({
  aberto,
  notas,
  busy = false,
  onConfirmar,
  onCancelar,
}: OcultacaoModalProps): React.JSX.Element {
  const [justificativa, setJustificativa] = React.useState('');

  React.useEffect(() => {
    if (aberto) setJustificativa('');
  }, [aberto]);

  const justOk = justificativa.trim().length >= 3;

  return (
    <AlertDialog open={aberto} onOpenChange={(next) => { if (!next && !busy) onCancelar(); }}>
      <AlertDialogContent className="w-[440px] max-w-[92vw] gap-3 p-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <EyeOff className="h-5 w-5 text-amber-500" />
            Ocultar {notas.length === 1 ? `Nota #${notas[0]}` : `${notas.length} Notas Selecionadas`}
          </AlertDialogTitle>
          <div className="text-xs text-text-mute">
            {notas.length === 1
              ? `A nota #${notas[0]} não será apagada do banco, mas ficará oculta da visualização padrão da tabela.`
              : `As ${notas.length} notas selecionadas não serão apagadas do banco, mas ficarão ocultas da visualização padrão da tabela.`}
          </div>
        </AlertDialogHeader>

        <div className="flex flex-col gap-1.5 pt-1">
          <label className="text-xs font-medium text-foreground flex items-center justify-between">
            <span>Motivo / Justificativa da Ocultação</span>
            <span className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">* obrigatório</span>
          </label>
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={3}
            autoFocus
            disabled={busy}
            placeholder="Ex: Nota suspensa pela engenharia, aguardando definição de projeto..."
            className="resize-y p-2.5 rounded-lg border border-line bg-surface-2 text-foreground text-xs placeholder:text-text-mute focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {justificativa.trim().length > 0 && justificativa.trim().length < 3 && (
            <span className="text-[11px] text-red-500">Mínimo de 3 caracteres.</span>
          )}
        </div>

        <AlertDialogFooter className="gap-2 sm:gap-0 mt-2">
          <Button variant="outline" size="sm" onClick={onCancelar} disabled={busy}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={busy || !justOk}
            onClick={() => onConfirmar(justificativa.trim())}
            className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <EyeOff className="h-3.5 w-3.5" />}
            Confirmar Ocultação
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
