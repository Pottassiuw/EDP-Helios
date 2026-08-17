import { EDPApi } from '../../api';
import type { CoffeeConsulta } from '../coffee/types';

export async function corrigirEConfirmarAlimentador(
  id: number,
  alimentador: string,
): Promise<CoffeeConsulta> {
  await EDPApi.alterarAlimentador(id, alimentador);
  const consulta = await EDPApi.consultarNota(id);
  if (consulta.alimentador !== alimentador) {
    throw new Error('O valor reconsultado não corresponde ao alimentador solicitado.');
  }
  return consulta;
}
