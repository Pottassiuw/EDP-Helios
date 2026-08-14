import { BASE } from '../../../api';
import type {
  CoffeeJob,
  CoffeeOperacaoQuadro,
} from '../types';

interface JobResponse {
  job_id: string;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as {
      detail?: string;
    };
    throw new Error(
      body.detail ?? `${init?.method ?? 'GET'} ${url} -> ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

const postIds = (path: string, ids: number[]): Promise<JobResponse> =>
  json<JobResponse>(`${BASE}/coffee/operacao/${path}`, {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });

export const OperacaoApi = {
  quadro: (): Promise<CoffeeOperacaoQuadro> =>
    json(`${BASE}/coffee/operacao`),
  consultar: (ids: number[]): Promise<JobResponse> =>
    postIds('consultar', ids),
  gerar: (ids: number[]): Promise<JobResponse> =>
    postIds('gerar', ids),
  atualizarSap: (ids: number[]): Promise<JobResponse> =>
    postIds('atualizar-sap', ids),
  job: (id: string): Promise<CoffeeJob> =>
    json(`${BASE}/coffee/job/${id}`),
  remover: (ids: number[], justificativa: string): Promise<{ removidas: number }> =>
    json(`${BASE}/coffee/operacao/remover`, {
      method: 'POST',
      body: JSON.stringify({ ids, justificativa }),
    }),
  arquivar: (id: number, justificativa: string): Promise<{ ok: true }> =>
    json(`${BASE}/coffee/arquivar`, {
      method: 'POST',
      body: JSON.stringify({ id, justificativa }),
    }),
};
