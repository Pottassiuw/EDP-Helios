import { EDPApi } from '../../api';
import type { CoffeeConsulta } from '../coffee/types';
import { normalizarLocalInstalacao } from '../../lib/local-instalacao';

export async function corrigirEConfirmarLocal(
  id: number,
  local: string,
): Promise<CoffeeConsulta> {
  await EDPApi.alterarLocalInstalacao(id, local);
  const consulta = await EDPApi.consultarNota(id);
  const confirmado = normalizarLocalInstalacao(
    consulta.local_instalacao ?? '',
  );
  if (confirmado !== local) {
    throw new Error('O valor reconsultado não corresponde ao local solicitado.');
  }
  return consulta;
}
