import React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Eyebrow } from '@/components/branded/section';
import type { CoffeeConsulta } from '../coffee/types';
import { AlimentadorCorrection } from './alimentador-correction';
import {
  GRUPOS_ORDEM,
  agruparCampo,
  formatarValorCru,
  rotularCampo,
} from './campos-coffee';

/** Chaves já mostradas em `Identificação & localização` (dashboard.tsx), pra
 * não repetir nos grupos "campos adicionais" da ficha. */
const CHAVES_CRUAS_JA_MOSTRADAS = new Set([
  'observacao', 'observacoes', 'referencia_eletrica', 'referencia_fisica',
  'postes', 'poste', 'alimentador', 'id_sap', 'local_instalacao',
  'problema', 'componente', 'componente_novo', 'sintoma', 'causa',
]);

interface CampoAgrupado {
  chave: string;
  label: string;
  valor: string;
}

function agruparCamposRestantes(
  campos: Record<string, unknown>,
): Array<[string, CampoAgrupado[]]> {
  const porGrupo = new Map<string, CampoAgrupado[]>();
  for (const [chave, valor] of Object.entries(campos)) {
    if (CHAVES_CRUAS_JA_MOSTRADAS.has(chave)) continue;
    if (valor === null || valor === undefined || valor === '') continue;
    const grupo = agruparCampo(chave, valor);
    const lista = porGrupo.get(grupo) ?? [];
    lista.push({ chave, label: rotularCampo(chave), valor: formatarValorCru(valor) });
    porGrupo.set(grupo, lista);
  }
  return GRUPOS_ORDEM
    .map((grupo): [string, CampoAgrupado[]] => [grupo, porGrupo.get(grupo) ?? []])
    .filter(([, lista]) => lista.length > 0);
}

interface NotaFichaCompletaProps {
  noteId: string;
  consulta: UseQueryResult<CoffeeConsulta>;
}

export function NotaFichaCompleta({ noteId, consulta }: NotaFichaCompletaProps): React.JSX.Element {
  const campos = consulta.data?.campos ?? {};
  const grupos = agruparCamposRestantes(campos);
  const totalResto = grupos.reduce((total, [, lista]) => total + lista.length, 0);

  return (
    <section className="rounded-app-sm border border-line bg-surface p-[14px]">
      <Eyebrow asChild><h3>Ficha completa (COFFEE)</h3></Eyebrow>
      {consulta.isLoading && <p className="mt-[8px] text-[12.5px] text-text-mute">Consultando…</p>}
      {consulta.error && (
        <p role="alert" className="mt-[8px] text-[12.5px] text-red">
          {consulta.error instanceof Error ? consulta.error.message : String(consulta.error)}
        </p>
      )}
      {consulta.data && (
        <React.Fragment>
          {totalResto > 0 && (
            <div className="mt-[10px] flex flex-col gap-[8px]">
              <span className="text-[11px] text-text-mute">
                Mais {totalResto} campo{totalResto === 1 ? '' : 's'} do COFFEE, agrupados por assunto
              </span>
              {grupos.map(([grupo, lista]) => (
                <details key={grupo} className="rounded-app-sm border border-line px-[10px] py-[6px]">
                  <summary className="cursor-pointer text-[12px] font-medium text-text-dim">
                    {grupo} <span className="text-text-mute">({lista.length})</span>
                  </summary>
                  <dl className="mt-[8px] grid grid-cols-2 gap-x-[16px] gap-y-[6px] sm:grid-cols-3">
                    {lista.map((campo) => (
                      <div key={campo.chave} className="min-w-0">
                        <dt className="font-mono text-[9.5px] uppercase tracking-[.1em] text-text-mute">{campo.label}</dt>
                        <dd className="text-[13px] break-words [overflow-wrap:anywhere]">{campo.valor}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </div>
          )}
        </React.Fragment>
      )}
      <div className="mt-[14px] border-t border-line pt-[14px]">
        <AlimentadorCorrection noteId={noteId} />
      </div>
    </section>
  );
}
