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

export interface RetornoMaeInfo {
  numeroMae: number;
  medidaAtual: number;
  somaRetorno: number;
  novaMedida: number;
}

interface ExclusaoModalProps {
  aberto: boolean;
  notas: number[];
  busy?: boolean;
  filhasInfo?: RetornoMaeInfo[];
  onConfirmar: (justificativa: string, somarAMae: boolean) => void;
  onCancelar: () => void;
}

export function ExclusaoModal({
  aberto,
  notas,
  busy = false,
  filhasInfo = [],
  onConfirmar,
  onCancelar,
}: ExclusaoModalProps): React.JSX.Element {
  const [justificativa, setJustificativa] = React.useState('');
  const [somarAMae, setSomarAMae] = React.useState(true);

  React.useEffect(() => {
    if (aberto) {
      setJustificativa('');
      setSomarAMae(true);
    }
  }, [aberto]);

  const justOk = justificativa.trim().length >= 3;
  const temFilhasComMae = filhasInfo.length > 0;

  return (
    <AlertDialog open={aberto} onOpenChange={(next) => { if (!next && !busy) onCancelar(); }}>
      <AlertDialogContent className="w-[480px] max-w-[94vw] gap-3 p-5">
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

        {/* Opção de reintegrar medida da nota filha à nota mãe */}
        {temFilhasComMae && (
          <div className="p-3 bg-accent/5 border border-accent/20 rounded-lg flex flex-col gap-2">
            <label className="flex items-start gap-2.5 text-xs cursor-pointer select-none">
              <input
                type="checkbox"
                checked={somarAMae}
                onChange={(e) => setSomarAMae(e.target.checked)}
                className="rounded border-line text-accent focus:ring-accent mt-0.5"
              />
              <div className="flex flex-col">
                <span className="font-semibold text-foreground">
                  Somar medida da(s) nota(s) filha(s) de volta à nota mãe
                </span>
                <span className="text-text-dim text-[11.5px] leading-tight">
                  Reintegra o saldo físico ({filhasInfo.reduce((acc, f) => acc + f.somaRetorno, 0)} un) ao cadastro da(s) nota(s) mãe.
                </span>
              </div>
            </label>

            {somarAMae && (
              <div className="flex flex-wrap gap-2 pt-1 border-t border-accent/15">
                {filhasInfo.map((f) => (
                  <div
                    key={f.numeroMae}
                    className="px-2 py-1 bg-surface rounded border border-line text-xs font-mono flex items-center gap-1.5"
                  >
                    <span className="font-bold text-accent">Mãe #{f.numeroMae}:</span>
                    <span className="text-text-mute">{f.medidaAtual}</span>
                    <span>➔</span>
                    <span className="font-bold text-green">{f.novaMedida}</span>
                    <span className="text-green font-semibold text-[11px]">(+{f.somaRetorno})</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
            onClick={() => onConfirmar(justificativa.trim(), somarAMae)}
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
