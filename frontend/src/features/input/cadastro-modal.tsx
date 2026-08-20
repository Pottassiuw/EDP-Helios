import React from 'react';
import { Copy, GitBranch, Loader2, PlusCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eyebrow } from '@/components/branded/section';
import { MesExecucaoPicker } from '@/components/branded/mes-execucao-picker';

import { ROTULOS } from './columns';
import { InputApi } from './api';
import { useRecarregarInput } from './use-input-data';
import type { InputDataset, NotaInput } from './types';

const NOTA_VAZIA: Record<string, string> = {
  Numero_Nota: '',
  Nota_Mae: '',
  Status_Nota: '00 Pendente',
  Prioridade_Nota: 'Programável',
  Planejado_DDPM: '',
  Conjunto: '',
  Circuito: '',
  Local_Instalacao: '',
  Mes_Execucao_Planejado: '-',
  Data_Envio_Projeto: new Date().toLocaleDateString('pt-BR'),
  Observacao: '',
  Check: '',
};

interface CadastroModalProps {
  aberto: boolean;
  onFechar: () => void;
  dados: InputDataset;
}

export function CadastroModal({
  aberto,
  onFechar,
  dados,
}: CadastroModalProps): React.JSX.Element {
  const recarregar = useRecarregarInput();
  const [salvando, setSalvando] = React.useState(false);
  const [descontarMae, setDescontarMae] = React.useState(true);
  const [form, setForm] = React.useState<Record<string, string>>({ ...NOTA_VAZIA });

  React.useEffect(() => {
    if (aberto) {
      setForm({ ...NOTA_VAZIA });
      setDescontarMae(true);
    }
  }, [aberto]);

  const notaMae = React.useMemo(() => {
    const maeStr = form.Nota_Mae?.trim();
    if (!maeStr || maeStr === '-' || !/^\d+$/.test(maeStr)) return null;
    const num = Number(maeStr);
    const maeObj = dados.registros.find((r) => r.Numero_Nota === num);
    if (!maeObj) return null;
    const medAtual = Number(maeObj.Planejado_DDPM) || 0;
    const medFilha = Number(form.Planejado_DDPM) || 0;
    const novaMed = Math.max(0, medAtual - medFilha);
    return {
      obj: maeObj,
      medidaAtual: medAtual,
      medidaFilha: medFilha,
      novaMedida: novaMed,
      diferenca: medFilha,
    };
  }, [form.Nota_Mae, form.Planejado_DDPM, dados.registros]);

  const copiarMetadadosMae = (): void => {
    if (!notaMae) return;
    const m = notaMae.obj;
    setForm((prev) => ({
      ...prev,
      Conjunto: String(m.Conjunto || prev.Conjunto || ''),
      Circuito: String(m.Circuito || prev.Circuito || ''),
      Local_Instalacao: String(m.Local_Instalacao || prev.Local_Instalacao || ''),
      Mes_Execucao_Planejado: String(m.Mes_Execucao_Planejado || prev.Mes_Execucao_Planejado || '-'),
      Prioridade_Nota: String(m.Prioridade_Nota || prev.Prioridade_Nota || 'Programável'),
    }));
    toast.success(`Metadados da Nota Mãe #${notaMae.obj.Numero_Nota} copiados!`);
  };

  async function salvar(): Promise<void> {
    const num = Number(form.Numero_Nota);
    if (!num || isNaN(num)) {
      toast.error('Informe um Número de Nota válido.');
      return;
    }
    setSalvando(true);
    try {
      const payload: Partial<NotaInput> = {
        Numero_Nota: num,
        Nota_Mae: form.Nota_Mae?.trim() || '-',
        Status_Nota: form.Status_Nota || '00 Pendente',
        Prioridade_Nota: form.Prioridade_Nota || 'Programável',
        Planejado_DDPM: Number(form.Planejado_DDPM) || 0,
        Conjunto: form.Conjunto?.trim() || '-',
        Circuito: form.Circuito?.trim() || '-',
        Local_Instalacao: form.Local_Instalacao?.trim() || '-',
        Mes_Execucao_Planejado: form.Mes_Execucao_Planejado?.trim() || '-',
        Data_Envio_Projeto: form.Data_Envio_Projeto?.trim() || new Date().toLocaleDateString('pt-BR'),
        Observacao: form.Observacao?.trim() || '',
        Check: form.Check?.trim() || '-',
      };

      await InputApi.criar(payload);

      if (notaMae && descontarMae) {
        try {
          await InputApi.editar([
            { Numero_Nota: notaMae.obj.Numero_Nota, Planejado_DDPM: notaMae.novaMedida },
          ]);
          toast.success(
            `Nota #${num} criada e medida da Mãe #${notaMae.obj.Numero_Nota} ajustada para ${notaMae.novaMedida}!`,
          );
        } catch (eMae) {
          toast.warning(
            `Nota #${num} criada, mas falhou ao ajustar medida da mãe: ${String(eMae)}`,
          );
        }
      } else {
        toast.success(`Nota #${num} criada com sucesso!`);
      }

      onFechar();
      void recarregar();
    } catch (e) {
      toast.error('Erro ao cadastrar nota', {
        description: e instanceof Error ? e.message : String(e),
      });
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open && !salvando) onFechar(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <Eyebrow>Cadastro de Nota</Eyebrow>
          <DialogTitle>Cadastrar Nova Nota no Sistema</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 py-2">
          {Object.keys(NOTA_VAZIA).map((campo) => (
            <div key={campo} className="flex flex-col gap-1">
              <Label htmlFor={`cad-${campo}`} className="text-xs text-text-dim">
                {ROTULOS[campo] ?? campo}
              </Label>
              {campo === 'Status_Nota' ? (
                <Select
                  value={form[campo]}
                  onValueChange={(v) => setForm({ ...form, [campo]: v })}
                >
                  <SelectTrigger id={`cad-${campo}`} className="h-8 text-xs bg-bg-2 border-line">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dados.meta.status_opcoes.map((s) => (
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
                  <SelectTrigger id={`cad-${campo}`} className="h-8 text-xs bg-bg-2 border-line">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {dados.meta.prioridade_opcoes.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : campo === 'Mes_Execucao_Planejado' ? (
                <MesExecucaoPicker
                  id={`cad-${campo}`}
                  value={form[campo] || '-'}
                  onChange={(v) => setForm({ ...form, [campo]: v })}
                  valorNeutro="-"
                  rotuloNeutro="—"
                  className="h-8 text-xs bg-bg-2 border-line"
                />
              ) : (
                <Input
                  id={`cad-${campo}`}
                  value={form[campo]}
                  placeholder={
                    campo === 'Numero_Nota'
                      ? 'Ex: 14118256'
                      : campo === 'Planejado_DDPM'
                      ? '0'
                      : '-'
                  }
                  className="h-8 text-xs bg-bg-2 border-line font-mono"
                  onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                />
              )}
            </div>
          ))}
        </div>

        {notaMae && (
          <div className="mt-2 p-3 bg-surface-2 rounded-lg border border-accent/30 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-accent" />
                <span className="text-xs font-medium text-foreground">
                  Vínculo com Nota Mãe #{notaMae.obj.Numero_Nota}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="gap-1 text-xs text-accent border-accent/40 hover:bg-surface"
                onClick={copiarMetadadosMae}
              >
                <Copy className="h-3 w-3" />
                Copiar Metadados da Mãe
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-surface p-2 rounded border border-line">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-text-mute block">Regional / Cj:</span>
                <span className="font-medium text-foreground truncate block">
                  {notaMae.obj.Regional} · {notaMae.obj.Conjunto}
                </span>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-text-mute block">Planejado Mãe:</span>
                <span className="font-medium text-foreground">{notaMae.medidaAtual}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-text-mute block">Medida Filha:</span>
                <span className="font-medium text-accent">{notaMae.medidaFilha}</span>
              </div>
              <div>
                <span className="text-[10px] uppercase tracking-wider text-text-mute block">Nova Medida Mãe:</span>
                <span className="font-medium text-green-600 dark:text-green-400">{notaMae.novaMedida}</span>
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={descontarMae}
                onChange={(e) => setDescontarMae(e.target.checked)}
                className="rounded border-line text-accent focus:ring-accent"
              />
              <span>Dedução Automática: Descontar a medida desta filha na Nota Mãe ao salvar</span>
            </label>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 mt-4">
          <Button variant="outline" size="sm" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={salvar} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PlusCircle className="mr-1.5 h-3.5 w-3.5" />}
            Cadastrar Nota
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
