import type { CoffeeJob } from '../types';

type Etapa = 'pronta' | 'aguardando_sap' | 'processando' | 'ignorada';

const ETAPA_LABEL: Record<Etapa, (quantidade: number) => string> = {
  pronta: (n) => (n === 1 ? 'pronta para gerar' : 'prontas para gerar'),
  aguardando_sap: () => 'aguardando SAP',
  processando: () => 'em processamento',
  ignorada: (n) => (n === 1 ? 'já em estado final (ignorada)' : 'já em estado final (ignoradas)'),
};

const ETAPAS: Etapa[] = ['pronta', 'aguardando_sap', 'processando', 'ignorada'];

/** Resume o resultado de um job de consulta avulsa em texto legível, pra
 * substituir o "Consulta iniciada" isolado por um retrato do que de fato
 * aconteceu com cada nota. */
export function resumoJobConsulta(job: Pick<CoffeeJob, 'total' | 'erros' | 'por_etapa'>): string {
  const partes = [`${job.total} ${job.total === 1 ? 'nota consultada' : 'notas consultadas'}`];

  const porEtapa = job.por_etapa ?? {};
  for (const etapa of ETAPAS) {
    const quantidade = porEtapa[etapa] ?? 0;
    if (quantidade > 0) partes.push(`${quantidade} ${ETAPA_LABEL[etapa](quantidade)}`);
  }

  if (job.erros.length > 0) {
    partes.push(`${job.erros.length} ${job.erros.length === 1 ? 'falhou' : 'falharam'}`);
  }

  return partes.join(' · ');
}
