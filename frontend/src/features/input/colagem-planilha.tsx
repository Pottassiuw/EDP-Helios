import React from 'react';
import type { ColunaDef } from './columns';
import type { NotaInput } from './types';
import { NotesTable } from './notes-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { GitBranch } from 'lucide-react';

export interface AjusteMaeColagem {
  numeroMae: number;
  medidaAtual: number;
  deducao: number;
  novaMedida: number;
}

interface ColagemPlanilhaProps {
  titulo: string;
  colunasColagem: string[];
  colunasPreview: ColunaDef[];
  rotulos: Record<string, string>;
  texto: string;
  setTexto: (v: string) => void;
  preview: Array<Partial<NotaInput>>;
  salvando: boolean;
  rotuloSalvar: string;
  onSalvar: () => void;
  ajustesMaes?: AjusteMaeColagem[];
  descontarMaes?: boolean;
  onToggleDescontarMaes?: (v: boolean) => void;
}

export function ColagemPlanilha({
  titulo,
  colunasColagem,
  colunasPreview,
  rotulos,
  texto,
  setTexto,
  preview,
  salvando,
  rotuloSalvar,
  onSalvar,
  ajustesMaes = [],
  descontarMaes = true,
  onToggleDescontarMaes,
}: ColagemPlanilhaProps): React.JSX.Element {
  return (
    <Card className="border border-line bg-surface shadow-sm">
      <CardHeader>
        <CardTitle className="text-base font-semibold text-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-[12.5px] text-text-dim mt-0 mb-3">
          Cole as linhas copiadas do Excel (sem cabeçalho), na ordem das colunas abaixo:
        </p>

        <div className="rounded-lg border border-line overflow-hidden">
          <div className="flex bg-surface-2 border-b border-line overflow-x-auto">
            {colunasColagem.map((c) => (
              <span
                key={c}
                className="flex-1 min-w-[100px] px-2.5 py-1.5 font-mono text-[10px] font-medium
                           tracking-wider uppercase text-text-mute border-r border-line
                           last:border-r-0 whitespace-nowrap overflow-hidden text-ellipsis text-center"
              >
                {rotulos[c] ?? c}
              </span>
            ))}
          </div>
          <Textarea
            value={texto}
            rows={8}
            placeholder="Ctrl+V com as linhas copiadas do Excel..."
            onChange={(e) => setTexto(e.target.value)}
            className="border-0 rounded-none font-mono text-xs focus-visible:ring-0 bg-bg-2"
          />
        </div>

        {preview.length > 0 && (
          <div className="mt-4 flex flex-col gap-3">
            <span className="text-xs font-semibold text-foreground">
              {preview.length} linha(s) reconhecida(s) — confira antes de salvar:
            </span>

            <NotesTable
              colunas={colunasPreview}
              registros={
                preview.map((r, i) => ({
                  ...r,
                  Numero_Nota: Number(r.Numero_Nota) || -(i + 1),
                })) as unknown as NotaInput[]
              }
              altura={240}
            />

            {/* Alerta de deduções automáticas de Notas Mães detectadas */}
            {ajustesMaes.length > 0 && (
              <div className="p-3 bg-surface-2/80 rounded-lg border border-line flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-accent" />
                    <span className="text-xs font-semibold text-foreground">
                      Notas Mães Detectadas no Lote ({ajustesMaes.length})
                    </span>
                  </div>
                  {onToggleDescontarMaes && (
                    <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={descontarMaes}
                        onChange={(e) => onToggleDescontarMaes(e.target.checked)}
                        className="rounded border-line text-accent focus:ring-accent"
                      />
                      <span className="font-medium text-foreground">
                        Descontar medidas das Notas Mães automaticamente no banco
                      </span>
                    </label>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {ajustesMaes.map((aj) => (
                    <div
                      key={aj.numeroMae}
                      className="px-2.5 py-1 bg-surface rounded border border-line text-xs font-mono flex items-center gap-1.5"
                    >
                      <span className="font-bold text-accent">Mãe {aj.numeroMae}:</span>
                      <span className="text-text-mute">{aj.medidaAtual}</span>
                      <span>➔</span>
                      <span className="font-bold text-foreground">{aj.novaMedida}</span>
                      <span className="text-red font-semibold text-[11px]">(-{aj.deducao})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2">
              <Button disabled={salvando} onClick={onSalvar} size="sm" className="h-9 px-4 text-xs font-semibold">
                💾 {rotuloSalvar}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
