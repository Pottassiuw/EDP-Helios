import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { DuplicateCandidate, DuplicateField, Note } from '../../types';
import { EDPApi } from '../../api';
import { COFFEE_CONSULTA_KEY } from '../coffee/coffee-query-keys';
import { Button } from '@/components/ui/button';
import { CompareRow, DuplicateScoreEvidence } from './duplicate-compare';

interface ScoreFieldDef { key: DuplicateField; label: string; }
interface ContextFieldDef { label: string; get: (candidate: DuplicateCandidate) => string; }

const SCORE_FIELDS: ScoreFieldDef[] = [
  { key: 'problema', label: 'Problema' },
  { key: 'local_instalacao', label: 'Local instal.' },
  { key: 'poste', label: 'Poste(s)' },
  { key: 'referencia', label: 'Referência' },
  { key: 'referencia_eletrica', label: 'Referência elétrica' },
];
const CONTEXT_FIELDS: ContextFieldDef[] = [
  { label: 'Status SAP', get: (candidate) => candidate.status_sap ?? '' },
  { label: 'Prioridade SAP', get: (candidate) => candidate.prioridade_sap != null ? String(candidate.prioridade_sap) : '' },
  { label: 'Conjunto', get: (candidate) => candidate.conjunto ?? '' },
];

export interface ConsultaCampos {
  local_instalacao: string | null;
  problema: string | null;
  poste: string | null;
  referencia: string | null;
  referencia_eletrica: string | null;
  observacao: string | null;
}

function valorConsultado(valor: string | null, anterior: string | undefined): string | undefined {
  return valor?.trim() ? valor : anterior;
}

/** Funde em memória os campos retornados pelo COFFEE, sem alterar a candidata recebida. */
export function mergeConsultaCampos(candidate: DuplicateCandidate, consulta: ConsultaCampos): DuplicateCandidate {
  return {
    ...candidate,
    local_instalacao: valorConsultado(consulta.local_instalacao, candidate.local_instalacao) ?? '',
    problema: valorConsultado(consulta.problema, candidate.problema) ?? '',
    poste: valorConsultado(consulta.poste, candidate.poste) ?? '',
    referencia: valorConsultado(consulta.referencia, candidate.referencia) ?? '',
    referencia_eletrica: valorConsultado(consulta.referencia_eletrica, candidate.referencia_eletrica),
    observacao: valorConsultado(consulta.observacao, candidate.observacao),
  };
}

function ComparisonGrid({ note, candidate, showContext }: { note: Note; candidate: DuplicateCandidate; showContext: boolean }): React.JSX.Element {
  return (
    <div className="dupc-grid">
      <div className="dupc-colh" />
      <div className="dupc-colh">Esta nota · {note.id}</div>
      <div className="dupc-colh">Candidata · {candidate.id}</div>
      {SCORE_FIELDS.map((field) => (
        <CompareRow key={field.key} label={field.label} open={note[field.key] ?? ""} cand={candidate[field.key] ?? ""} keyField={true} />
      ))}
      <CompareRow label="Observação" open={note.observacao ?? ''} cand={candidate.observacao ?? ''} keyField={false} />
      {showContext && CONTEXT_FIELDS.map((field) => (
        <CompareRow key={field.label} label={field.label} open="" cand={field.get(candidate)} keyField={false} />
      ))}
    </div>
  );
}

interface ExternalCandidateCardProps { note: Note; candidate: DuplicateCandidate; }

export function ExternalCandidateCard({ note, candidate }: ExternalCandidateCardProps): React.JSX.Element {
  const consultaQuery = useQuery({
    queryKey: COFFEE_CONSULTA_KEY(Number(candidate.id)),
    queryFn: async (): Promise<ConsultaCampos> => {
      const resposta = await EDPApi.consultarNota(Number(candidate.id));
      return {
        local_instalacao: resposta.local_instalacao,
        problema: resposta.problema,
        poste: resposta.poste,
        referencia: resposta.referencia,
        referencia_eletrica: resposta.referencia_eletrica,
        observacao: resposta.observacao,
      };
    },
    enabled: false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
  });
  const consulta = consultaQuery.data ?? null;

  async function buscarDadosCoffee(): Promise<void> {
    const resultado = await consultaQuery.refetch();
    if (resultado.error) {
      const error = resultado.error;
      toast.error(`Não foi possível consultar a nota ${candidate.id} no COFFEE`, {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const display = consulta ? mergeConsultaCampos(candidate, consulta) : candidate;
  const botaoBuscar = (
    <Button variant="outline" size="sm" disabled={consultaQuery.isFetching} onClick={() => void buscarDadosCoffee()}>
      ⌕ {consultaQuery.isFetching ? 'Buscando…' : consulta ? 'Atualizar dados do COFFEE' : 'Buscar dados no COFFEE'}
    </Button>
  );

  if (!candidate.carteira_match) {
    return (
      <div className="py-[14px] px-[16px]">
        <div className="flex items-center justify-end gap-[8px] mb-[10px]">
          <DuplicateScoreEvidence note={note} candidate={display} suffix="Sem match · Carteira" />
        </div>
        <div className="dupc-ext">
          <span className="text-[16px] shrink-0 leading-none">⧉</span>
          <div><strong className="text-text">Não encontrada na Carteira de Notas</strong><br />
            Essa candidata não está no espelho local da base COFFEE — pode não ter sido sincronizada ainda. {consulta ? 'Dados abaixo vieram direto do COFFEE.' : 'Busque direto no COFFEE para conferir.'}
          </div>
        </div>
        <div className="mt-[10px]">{botaoBuscar}</div>
        {consulta && <div className="mt-[10px]"><ComparisonGrid note={note} candidate={display} showContext={false} /></div>}
      </div>
    );
  }

  return (
    <React.Fragment>
      {candidate.carteira_ausente_em && <div className="dupc-warn">⚠ Ausente da Carteira desde {candidate.carteira_ausente_em} — dados podem estar desatualizados.</div>}
      <div className="flex items-center justify-end gap-[8px] px-[14px] py-[8px] border-b border-line">
        <DuplicateScoreEvidence note={note} candidate={display} suffix="Carteira" />
      </div>
      <ComparisonGrid note={note} candidate={display} showContext={true} />
      <div className="px-[14px] py-[10px]">{botaoBuscar}</div>
    </React.Fragment>
  );
}
