export function ehNotaAtiva(status: string | number | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  const statusNormalizado = String(status).trim().toUpperCase();
  const statusInativos = ['ENCE CANC', 'SUPR CANC', 'ENCE EXEC', 'SUPR', '999', '998', '997', '55', '99'];
  if (statusInativos.includes(statusNormalizado)) return false;
  if (statusNormalizado.startsWith('55') || statusNormalizado.startsWith('99')) return false;
  return true;
}

export function ehNotaMaeValida(valor: string | number | null | undefined): boolean {
  if (valor === null || valor === undefined) return false;
  const texto = String(valor).trim();
  return /^\d+$/.test(texto) && Number.parseInt(texto, 10) > 0;
}

export function limparNotaMae(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  const numero = Number.parseFloat(String(valor).trim());
  return Number.isNaN(numero) ? '' : String(Math.floor(numero));
}

export function extrairValorUnidadeMedida(medida: string | number | null | undefined): [number, 'km' | 'un' | null] {
  if (medida === null || medida === undefined) return [0, null];
  const normalizada = String(medida).trim().toLowerCase().replace(',', '.');
  if (!normalizada || normalizada === '-') return [0, null];
  const correspondencia = normalizada.match(/[\d.]+/);
  if (!correspondencia) return [0, null];
  const valor = Number.parseFloat(correspondencia[0]);
  if (Number.isNaN(valor)) return [0, null];
  if (normalizada.includes('km')) return [valor, 'km'];
  if (normalizada.includes('un')) return [valor, 'un'];
  return [valor, null];
}
