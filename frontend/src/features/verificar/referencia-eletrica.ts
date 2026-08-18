import type { TipoEquipamento } from '../coffee/types';

export interface EquipamentoExtraido {
  tipo: string;
  descricao: string;
  codigo: string;
}

/** Acha menções de "TIPO-número" no texto livre de referencia_eletrica, TIPO
 * restrito ao depara de tipos de equipamento já usado na correção de local
 * (evita casar sigla de 2 letras que aparece sem número junto, ex.: "RL (NA)").
 * Número completado com zeros à esquerda até 8 dígitos — mesma regra do
 * local_instalacao (ver `comporLocalInstalacao`). */
export function extrairEquipamentos(
  texto: string | null | undefined,
  tipos: TipoEquipamento[],
): EquipamentoExtraido[] {
  if (!texto || tipos.length === 0) return [];
  const alternativas = tipos.map((t) => t.id).join('|');
  const regex = new RegExp(`\\b(${alternativas})[\\s-]?(\\d{1,8})\\b`, 'g');
  const encontrados: EquipamentoExtraido[] = [];
  for (const match of texto.matchAll(regex)) {
    const equipamento = tipos.find((t) => t.id === match[1]);
    if (!equipamento) continue;
    encontrados.push({
      tipo: equipamento.id,
      descricao: equipamento.descricao,
      codigo: match[2].padStart(8, '0'),
    });
  }
  return encontrados;
}
