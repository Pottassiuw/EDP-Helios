import React from 'react';
import { PlusCircle, Loader2, Save, FolderPlus, Calculator } from 'lucide-react';
import type { HierarquiaInfo, NotaInput } from './types';
import { InputApi } from './api';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Eyebrow } from '@/components/branded/section';
import { formatarNumero } from './lib';

interface HierarquiaCardProps {
  registros: NotaInput[];
  recarregar: () => Promise<void>;
}

export function HierarquiaCard({ registros, recarregar }: HierarquiaCardProps): React.JSX.Element {
  const [maeInput, setMaeInput] = React.useState('');
  const [hierarquia, setHierarquia] = React.useState<HierarquiaInfo | null>(null);
  const [buscando, setBuscando] = React.useState(false);
  const [filhasSelecionadas, setFilhasSelecionadas] = React.useState<Set<number>>(new Set());
  const [vinculando, setVinculando] = React.useState(false);

  // Estados para criação rápida de filha diretamente para a mãe consultada
  const [mostrarCriarFilha, setMostrarCriarFilha] = React.useState(false);
  const [novaFilhaNumero, setNovaFilhaNumero] = React.useState('');
  const [novaFilhaMedida, setNovaFilhaMedida] = React.useState('1.00');
  const [novaMedidaMae, setNovaMedidaMae] = React.useState('');
  const [ajustarMae, setAjustarMae] = React.useState(true);
  const [salvandoFilha, setSalvandoFilha] = React.useState(false);

  const maeRegistro = React.useMemo(() => {
    const num = Number(maeInput.trim());
    if (!num) return null;
    return registros.find((r) => r.Numero_Nota === num) ?? null;
  }, [registros, maeInput]);

  const candidatas = React.useMemo(() => {
    if (!hierarquia || !maeRegistro) return [];
    const conjMae = String(maeRegistro['Conjunto'] ?? '').trim().toUpperCase();
    return registros.filter((r) => {
      const mae = String(r['Nota_Mae'] ?? '-').trim();
      const ehOrfa = mae === '-' || mae === '' || mae === 'None' || mae === 'null';
      const conjOrfa = String(r['Conjunto'] ?? '').trim().toUpperCase();
      const mesmoConjunto = !conjMae || !conjOrfa || conjMae === '-' || conjOrfa === '-' || conjOrfa === conjMae;
      return ehOrfa && mesmoConjunto && r.Numero_Nota !== Number(maeInput);
    });
  }, [registros, hierarquia, maeRegistro, maeInput]);

  // Atualiza sugestão de nova medida da mãe
  React.useEffect(() => {
    if (maeRegistro) {
      const medMae = Number(maeRegistro['Planejado_DDPM']) || 0;
      const medFilha = Number(novaFilhaMedida) || 0;
      setNovaMedidaMae(String(Math.max(0, medMae - medFilha)));
    }
  }, [maeRegistro, novaFilhaMedida]);

  async function buscar(): Promise<void> {
    const n = Number(maeInput.trim());
    if (!n) return;
    setBuscando(true);
    try {
      setHierarquia(await InputApi.obterHierarquia(n));
      setFilhasSelecionadas(new Set());
    } catch (e) {
      toast.error('Nota não encontrada', { description: e instanceof Error ? e.message : String(e) });
      setHierarquia(null);
    } finally {
      setBuscando(false);
    }
  }

  async function vincular(): Promise<void> {
    if (filhasSelecionadas.size === 0) return;
    setVinculando(true);
    try {
      const { atualizadas } = await InputApi.vincularHierarquia({
        [maeInput]: [...filhasSelecionadas],
      });
      toast.success(`${atualizadas} vínculo(s) aplicado(s).`);
      setFilhasSelecionadas(new Set());
      await recarregar();
      setHierarquia(await InputApi.obterHierarquia(Number(maeInput)));
    } catch (e) {
      toast.error('Falha ao vincular', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setVinculando(false);
    }
  }

  async function salvarNovaFilha(): Promise<void> {
    if (!/^\d+$/.test(novaFilhaNumero.trim())) {
      toast.error('Informe um número de nota filha válido.');
      return;
    }
    if (!maeRegistro) {
      toast.error('Nota Mãe não encontrada.');
      return;
    }

    setSalvandoFilha(true);
    try {
      // 1. Criar nota filha
      await InputApi.criar({
        Numero_Nota: Number(novaFilhaNumero.trim()),
        Nota_Mae: String(maeRegistro.Numero_Nota),
        Planejado_DDPM: Number(novaFilhaMedida) || 0,
        Status_Nota: '00 Pendente',
        Prioridade_Nota: String(maeRegistro.Prioridade_Nota ?? 'Programável'),
        Conjunto: String(maeRegistro.Conjunto ?? '-'),
        Circuito: String(maeRegistro.Circuito ?? '-'),
        Local_Instalacao: String(maeRegistro.Local_Instalacao ?? '-'),
        Mes_Execucao_Planejado: String(maeRegistro.Mes_Execucao_Planejado ?? '-'),
        Observacao: `Nota Filha da ${maeRegistro.Numero_Nota}`,
      });

      // 2. Se optou por atualizar a medida da mãe no banco
      if (ajustarMae && novaMedidaMae.trim() !== '') {
        await InputApi.editar([
          { Numero_Nota: maeRegistro.Numero_Nota, Planejado_DDPM: Number(novaMedidaMae) || 0 },
        ]);
      }

      toast.success(`Nota Filha ${novaFilhaNumero} criada e vinculada com sucesso!`);
      setNovaFilhaNumero('');
      setMostrarCriarFilha(false);
      await recarregar();
      setHierarquia(await InputApi.obterHierarquia(maeRegistro.Numero_Nota));
    } catch (e) {
      toast.error('Falha ao cadastrar nota filha', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSalvandoFilha(false);
    }
  }

  function toggleFilha(numero: number): void {
    setFilhasSelecionadas((prev) => {
      const s = new Set(prev);
      if (s.has(numero)) s.delete(numero); else s.add(numero);
      return s;
    });
  }

  return (
    <Card className="border border-line bg-surface shadow-sm">
      <CardHeader className="pb-3">
        <Eyebrow className="text-xs tracking-wider">Hierarquia & Vínculos</Eyebrow>
        <CardTitle className="text-base font-semibold text-foreground">Gerenciador de Nota-Mãe e Filhas</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 items-end mb-4 flex-wrap">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hier-nota-mae" className="text-xs text-text-dim font-medium">Nota Mãe (ID)</Label>
            <Input
              id="hier-nota-mae"
              value={maeInput}
              placeholder="ex: 100123456"
              onChange={(e) => setMaeInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void buscar(); }}
              className="w-48 h-9 text-xs bg-bg-2 border-line font-mono"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 px-3 text-xs"
            disabled={buscando || !maeInput.trim()}
            onClick={() => void buscar()}
          >
            {buscando ? 'Buscando...' : 'Buscar Nota'}
          </Button>
        </div>

        {hierarquia && (
          <div className="flex flex-col gap-4 pt-2 border-t border-line">
            {maeRegistro && (
              <div className="p-3 bg-surface-2 rounded-lg border border-line flex items-center justify-between flex-wrap gap-2 text-xs">
                <div className="flex items-center gap-3">
                  <span className="font-mono font-bold text-accent">Mãe #{maeRegistro.Numero_Nota}</span>
                  <span>Conjunto: <strong>{String(maeRegistro.Conjunto ?? '-')}</strong></span>
                  <span>Medida Planejada: <strong className="font-mono text-green">{formatarNumero(maeRegistro['Planejado_DDPM'] ?? null, 2)}</strong></span>
                </div>
                <Button
                  size="sm"
                  variant={mostrarCriarFilha ? "secondary" : "default"}
                  className="h-8 text-xs font-semibold gap-1.5"
                  onClick={() => setMostrarCriarFilha((prev) => !prev)}
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  {mostrarCriarFilha ? 'Fechar Formulário' : '+ Cadastrar Nova Filha'}
                </Button>
              </div>
            )}

            {/* Painel para criar nova filha diretamente para esta mãe */}
            {mostrarCriarFilha && maeRegistro && (
              <div className="p-4 bg-green/5 border border-green/30 rounded-lg flex flex-col gap-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                  <FolderPlus className="h-4 w-4 text-green" />
                  <span>Cadastrar Nova Filha para a Mãe #{maeRegistro.Numero_Nota}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-text-dim font-medium">Nº da Nova Nota Filha *</Label>
                    <Input
                      value={novaFilhaNumero}
                      placeholder="ex: 16958288"
                      className="h-9 text-xs bg-bg-2 border-line font-mono"
                      onChange={(e) => setNovaFilhaNumero(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-text-dim font-medium">Medida Planejada da Filha *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={novaFilhaMedida}
                      placeholder="1.00"
                      className="h-9 text-xs bg-bg-2 border-line font-mono"
                      onChange={(e) => setNovaFilhaMedida(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-text-dim font-medium flex items-center gap-1">
                      <Calculator className="h-3 w-3 text-accent" />
                      <span>Nova Medida da Mãe</span>
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={novaMedidaMae}
                      disabled={!ajustarMae}
                      className="h-9 text-xs bg-bg-2 border-line font-mono"
                      onChange={(e) => setNovaMedidaMae(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
                  <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer">
                    <input
                      type="checkbox"
                      checked={ajustarMae}
                      onChange={(e) => setAjustarMae(e.target.checked)}
                      className="rounded border-line text-accent focus:ring-accent"
                    />
                    <span>Atualizar medida da mãe no banco de dados</span>
                  </label>

                  <Button
                    size="sm"
                    className="h-8 text-xs font-semibold gap-1.5"
                    disabled={salvandoFilha || !novaFilhaNumero.trim()}
                    onClick={() => void salvarNovaFilha()}
                  >
                    {salvandoFilha ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Salvar e Vincular Filha
                  </Button>
                </div>
              </div>
            )}

            {hierarquia.filhas.length > 0 && (
              <div className="text-xs text-text-dim flex items-center gap-1.5 bg-surface-2 p-2.5 rounded-md border border-line">
                <span className="font-semibold text-foreground">Filhas vinculadas ({hierarquia.filhas.length}):</span>
                <span className="font-mono text-accent font-semibold">{hierarquia.filhas.map((f) => f.Numero_Nota).join(', ')}</span>
              </div>
            )}

            {candidatas.length > 0 ? (
              <React.Fragment>
                <span className="text-xs text-text-dim font-medium">
                  {candidatas.length} nota(s) candidata(s) órfãs no conjunto:
                </span>
                <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 p-2 bg-bg-2/50 rounded-md border border-line">
                  {candidatas.map((r) => (
                    <label
                      key={r.Numero_Nota}
                      className="flex gap-2.5 items-center text-xs p-1.5 rounded hover:bg-surface transition-colors cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-line text-accent focus:ring-accent"
                        checked={filhasSelecionadas.has(r.Numero_Nota)}
                        onChange={() => toggleFilha(r.Numero_Nota)}
                      />
                      <span className="font-mono text-foreground font-semibold">{r.Numero_Nota}</span>
                      <span className="text-text-dim">
                        {String(r['Status_Nota'] ?? '-')} · Plan: {formatarNumero(r['Planejado_DDPM'] ?? null, 2)} · {String(r['Conjunto'] ?? '-')}
                      </span>
                    </label>
                  ))}
                </div>
                <div>
                  <Button
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    disabled={vinculando || filhasSelecionadas.size === 0}
                    onClick={() => void vincular()}
                  >
                    Vincular Selecionadas ({filhasSelecionadas.size})
                  </Button>
                </div>
              </React.Fragment>
            ) : (
              <p className="text-xs text-text-mute italic m-0">
                Nenhuma nota órfã candidata no mesmo conjunto.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
