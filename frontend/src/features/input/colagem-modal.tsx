import React from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Eyebrow } from '@/components/branded/section';
import { COLUNAS, COLUNAS_COLAGEM, ROTULOS } from './columns';
import { parseColagemTsv } from './lib';
import { ColagemPlanilha, type AjusteMaeColagem } from './colagem-planilha';
import { InputApi } from './api';
import { useRecarregarInput } from './use-input-data';
import type { InputDataset, NotaInput } from './types';

interface ColagemModalProps {
  aberto: boolean;
  onFechar: () => void;
  dados: InputDataset;
}

export function ColagemModal({
  aberto,
  onFechar,
  dados,
}: ColagemModalProps): React.JSX.Element {
  const recarregar = useRecarregarInput();
  const [texto, setTexto] = React.useState('');
  const [salvando, setSalvando] = React.useState(false);
  const [descontarMaes, setDescontarMaes] = React.useState(true);

  React.useEffect(() => {
    if (aberto) {
      setTexto('');
      setDescontarMaes(true);
    }
  }, [aberto]);

  const preview = React.useMemo<Array<Partial<NotaInput>>>(() => {
    return parseColagemTsv(texto, COLUNAS_COLAGEM);
  }, [texto]);

  const ajustesMaes = React.useMemo<AjusteMaeColagem[]>(() => {
    if (preview.length === 0) return [];
    const deducoesPorMae = new Map<number, number>();
    for (const r of preview) {
      const maeStr = r.Nota_Mae ? String(r.Nota_Mae).trim() : '';
      if (maeStr && maeStr !== '-' && /^\d+$/.test(maeStr)) {
        const numMae = Number(maeStr);
        const med = Number(r.Planejado_DDPM) || 0;
        deducoesPorMae.set(numMae, (deducoesPorMae.get(numMae) ?? 0) + med);
      }
    }

    const lista: AjusteMaeColagem[] = [];
    for (const [numMae, deducao] of deducoesPorMae.entries()) {
      const maeObj = dados.registros.find((r) => r.Numero_Nota === numMae);
      if (maeObj && deducao > 0) {
        const medAtual = Number(maeObj.Planejado_DDPM) || 0;
        const novaMed = Math.max(0, medAtual - deducao);
        lista.push({
          numeroMae: numMae,
          medidaAtual: medAtual,
          deducao,
          novaMedida: novaMed,
        });
      }
    }
    return lista;
  }, [preview, dados.registros]);

  async function salvar(): Promise<void> {
    if (preview.length === 0) {
      toast.warning('Nenhum registro para salvar. Cole dados de uma planilha.');
      return;
    }

    setSalvando(true);
    try {
      const res = await InputApi.criarLote(preview);

      if (ajustesMaes.length > 0 && descontarMaes) {
        const updatesMae = ajustesMaes.map((a) => ({
          Numero_Nota: a.numeroMae,
          Planejado_DDPM: a.novaMedida,
        }));
        try {
          await InputApi.editar(updatesMae);
          toast.success(
            `${res.inseridas} nota(s) inserida(s) e ${ajustesMaes.length} Nota(s) Mãe ajustada(s)!`,
          );
        } catch {
          toast.warning(
            `${res.inseridas} nota(s) inserida(s), mas falhou ao ajustar medidas das mães.`,
          );
        }
      } else {
        toast.success(`${res.inseridas} nota(s) inserida(s) com sucesso.`);
      }

      await recarregar();
      onFechar();
    } catch (e) {
      toast.error('Erro ao salvar notas em lote', {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open && !salvando) onFechar(); }}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto p-6">
        <DialogHeader>
          <Eyebrow>Inserção em Massa</Eyebrow>
          <DialogTitle>Colagem Direta de Planilha (Excel / TSV)</DialogTitle>
        </DialogHeader>

        <ColagemPlanilha
          titulo="Cole as linhas copiadas do Excel diretamente abaixo:"
          colunasColagem={COLUNAS_COLAGEM}
          colunasPreview={COLUNAS}
          rotulos={ROTULOS}
          texto={texto}
          setTexto={setTexto}
          preview={preview}
          salvando={salvando}
          rotuloSalvar={`Salvar ${preview.length} nota(s) no sistema`}
          onSalvar={salvar}
          ajustesMaes={ajustesMaes}
          descontarMaes={descontarMaes}
          onToggleDescontarMaes={setDescontarMaes}
        />
      </DialogContent>
    </Dialog>
  );
}
