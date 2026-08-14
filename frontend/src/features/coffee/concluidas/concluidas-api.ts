import { BASE, coffeeFetch } from '../../../api';
import type { CoffeeNota } from '../types';

export async function fetchCoffeeConcluidas(): Promise<CoffeeNota[]> {
  const response = await coffeeFetch(
    `${BASE}/coffee/notas?status=concluida`,
    { headers: { Accept: 'application/json' } },
  );
  if (!response.ok) {
    throw new Error(`GET /coffee/notas?status=concluida -> ${response.status}`);
  }
  const body = await response.json() as { registros: CoffeeNota[] };
  return body.registros;
}

export async function exportCoffeeConcluidas(pks: number[]): Promise<Blob> {
  const response = await coffeeFetch(`${BASE}/coffee/notas/concluidas/exportar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pks }),
  });
  if (!response.ok) {
    throw new Error(`POST /coffee/notas/concluidas/exportar -> ${response.status}`);
  }
  return response.blob();
}
