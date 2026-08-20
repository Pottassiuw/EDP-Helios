import React from 'react';
import { Loader2, PlusCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eyebrow } from '@/components/branded/section';
import { MesExecucaoPicker } from '@/components/branded/mes-execucao-picker';

import { ROTULOS_RAMAL } from './columns-ramal';
import { InputApi } from './api';
import { useRecarregarRamal } from './use-ramal-data';
import type { InputDataset, NotaRamal } from './types';

const NOTA_RAMAL_VAZIA: Record<string, string> = {
  Numero_Nota: '',
  Status_Nota: '00 Pendente',
  Prioridade_Nota: 'Programável',
  Planejado_DDPM: '0',
  Conjunto: '-',
  Circuito: '-',
  Local_Instalacao: '-',
  Mes_Execucao_Planejado: '-',
  CenTrab_Respon: '-',
  Observacao: '',
  Extracao_Antiga: '-',
  Status_Anterior: '-',
  Check_Btzero: '-',
  Plano: '-',
};

interface CadastroRamalModalProps {
  aberto: boolean;
  onFechar: () => void;
  dadosPrincipais: InputDataset;
}

export function CadastroRamalModal({
  aberto,
  onFechar,
  dadosPrincipais,
}: CadastroRamalModalProps): React.JSX.Element {
  const recarregar = useRecarregarRamal();
  const [salvando, setSalvando] = React.useState(false);
  const [form, setForm] = React.useState<Record<string, string>>({ ...NOTA_RAMAL_VAZIA });

  React.useEffect(() => {
    if (aberto) {
      setForm({ ...NOTA_RAMAL_VAZIA });
    }
  }, [aberto]);

  async function salvar(): Promise<void> {
    const num = Number(form.Numero_Nota);
    if (!num || isNaN(num)) {
      toast.error('Informe um Número de Nota válido.');
      return;
    }
    setSalvando(true);
    try {
      const payload: Partial<NotaRamal> = {
        Numero_Nota: num,
        Status_Nota: form.Status_Nota,
        Prioridade_Nota: form.Prioridade_Nota,
        Planejado_DDPM: Number(form.Planejado_DDPM) || 0,
        Conjunto: form.Conjunto,
        Circuito: form.Circuito,
        Local_Instalacao: form.Local_Instalacao,
        Mes_Execucao_Planejado: form.Mes_Execucao_Planejado,
        CenTrab_Respon: form.CenTrab_Respon,
        Observacao: form.Observacao,
        Extracao_Antiga: form.Extracao_Antiga,
        Status_Anterior: form.Status_Anterior,
        Check_Btzero: form.Check_Btzero,
        Plano: form.Plano,
      };

      await InputApi.importarRamal([payload]);
      toast.success(`Nota Ramal #${num} cadastrada com sucesso!`);
      await recarregar();
      onFechar();
    } catch (e) {
      toast.error('Erro ao cadastrar nota ramal', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open && !salvando) onFechar(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <Eyebrow>Cadastro de Ramal</Eyebrow>
          <DialogTitle>Cadastrar Nova Nota no Ramal</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 py-2">
          {Object.keys(NOTA_RAMAL_VAZIA).map((campo) => (
            <div key={campo} className="flex flex-col gap-1">
              <Label htmlFor={`cad-ramal-${campo}`} className="text-xs text-text-dim">
                {ROTULOS_RAMAL[campo] ?? campo}
              </Label>
              {campo === 'Status_Nota' ? (
                <Select
                  value={form[campo]}
                  onValueChange={(v) => setForm({ ...form, [campo]: v })}
                >
                  <SelectTrigger id={`cad-ramal-${campo}`} className="h-8 text-xs bg-bg-2 border-line">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dadosPrincipais.meta.status_opcoes.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : campo === 'Prioridade_Nota' ? (
                <Select
                  value={form[campo]}
                  onValueChange={(v) => setForm({ ...form, [campo]: v })}
                >
                  <SelectTrigger id={`cad-ramal-${campo}`} className="h-8 text-xs bg-bg-2 border-line">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dadosPrincipais.meta.prioridade_opcoes.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : campo === 'Mes_Execucao_Planejado' ? (
                <MesExecucaoPicker
                  id={`cad-ramal-${campo}`}
                  value={form[campo]}
                  onChange={(v) => setForm({ ...form, [campo]: v })}
                  valorNeutro="-"
                  rotuloNeutro="—"
                  className="h-8 text-xs bg-bg-2 border-line"
                />
              ) : (
                <Input
                  id={`cad-ramal-${campo}`}
                  value={form[campo]}
                  placeholder={campo === 'Numero_Nota' ? 'Ex: 14118256' : ''}
                  className="h-8 text-xs bg-bg-2 border-line font-mono"
                  onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button variant="outline" size="sm" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="mr-1.5 h-3.5 w-3.5" />}
            Cadastrar no Ramal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
