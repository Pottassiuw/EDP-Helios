import React from 'react';
import { Trash2, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';

interface ExclusaoModalProps {
  aberto: boolean;
  notas: number[];
  busy?: boolean;
  onConfirmar: (justificativa: string) => void;
  onCancelar: () => void;
}

export function ExclusaoModal({
  aberto,
  notas,
  busy = false,
  onConfirmar,
  onCancelar,
}: ExclusaoModalProps): React.JSX.Element {
  const [justificativa, setJustificativa] = React.useState('');

  React.useEffect(() => {
    if (aberto) setJustificativa('');
  }, [aberto]);

  const justOk = justificativa.trim().length >= 3;

  return (
    <AlertDialog open={aberto} onOpenChange={(next) => { if (!next && !busy) onCancelar(); }}>
      <AlertDialogContent className="w-[450px] max-w-[92vw] gap-3 p-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold flex items-center gap-2 text-red-600 dark:text-red-400">
            <Trash2 className="h-5 w-5" />
            Excluir {notas.length === 1 ? `Nota #${notas[0]}` : `${notas.length} Notas Selecionadas`}
          </AlertDialogTitle>
          <div className="text-xs text-text-mute flex items-start gap-2 bg-red-500/10 border border-red-500/20 p-2.5 rounded-md text-red-600 dark:text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <strong>Atenção:</strong> Esta ação apagará permanentemente o registro da base de dados e registrará a exclusão no log de auditoria.
            </span>
          </div>
        </AlertDialogHeader>

        <div className="flex flex-col gap-1.5 pt-1">
          <label className="text-xs font-medium text-foreground flex items-center justify-between">
            <span>Motivo / Justificativa da Exclusão</span>
            <span className="text-[11px] text-red-600 dark:text-red-400 font-semibold">* obrigatório</span>
          </label>
          <textarea
            value={justificativa}
            onChange={(e) => setJustificativa(e.target.value)}
            rows={3}
            autoFocus
            disabled={busy}
            placeholder="Explique o motivo do cancelamento / exclusão desta nota..."
            className="resize-y p-2.5 rounded-lg border border-line bg-surface-2 text-foreground text-xs placeholder:text-text-mute focus:outline-none focus:ring-1 focus:ring-red-500"
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
            variant="destructive"
            size="sm"
            disabled={busy || !justOk}
            onClick={() => onConfirmar(justificativa.trim())}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Confirmar Exclusão
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
