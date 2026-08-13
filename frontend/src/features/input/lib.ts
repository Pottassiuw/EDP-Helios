import type { Celula, NotaInput } from './types';
import type { ColunaDef } from './columns';

export const MESES_PT_REV: Record<string, number> = {
  jan: 1, fev: 2, mar: 3, abr: 4, maio: 5, jun: 6,
  jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
};

const ANO_ATUAL = new Date().getFullYear();

/** Chave de ordenação cronológica de "mes-ano" (porte de Input/app.py:53-59). */
export function chaveOrdenacaoData(val: Celula): [number, number, number] {
  const partes = String(val ?? '').split('-');
  if (partes.length === 2) {
    const mes = MESES_PT_REV[partes[0].toLowerCase()];
    const ano = Number(partes[1]);
    if (mes && Number.isFinite(ano)) return ano > ANO_ATUAL ? [1, ano, mes] : [0, -ano, mes];
  }
  return [2, 0, 0];
}

export function compararDatas(a: Celula, b: Celula): number {
  const ka = chaveOrdenacaoData(a);
  const kb = chaveOrdenacaoData(b);
  for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

/** "12345, 678; 90" -> [12345, 678, 90] (porte de Input/app.py:136). */
export function parseBuscaGlobal(texto: string): number[] {
  return texto.split(/[ ,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map(Number);
}

interface EntradaIndiceBuscaGlobal {
  registro: NotaInput;
  numeroNota: number;
  notaMae: string;
  valores: string[];
}

export type IndiceBuscaGlobal = EntradaIndiceBuscaGlobal[];

const indicesBuscaGlobal = new WeakMap<NotaInput[], IndiceBuscaGlobal>();

/** Índice memoizado pela identidade do dataset, preservando os limites entre campos. */
export function indiceBuscaGlobal(registros: NotaInput[]): IndiceBuscaGlobal {
  const existente = indicesBuscaGlobal.get(registros);
  if (existente) return existente;

  const indice = registros.map((registro) => ({
    registro,
    numeroNota: registro.Numero_Nota,
    notaMae: String(registro.Nota_Mae ?? '').trim(),
    valores: Object.values(registro).map((valor) => String(valor ?? '').toLowerCase()),
  }));
  indicesBuscaGlobal.set(registros, indice);
  return indice;
}

/** Busca global por número de nota/mãe ou, como fallback, por qualquer campo textual. */
export function buscarPorTextoGlobal(registros: NotaInput[], texto: string): NotaInput[] {
  const query = texto.trim();
  if (query === '') return registros;

  const indice = indiceBuscaGlobal(registros);
  const numeros = parseBuscaGlobal(query);
  if (numeros.length > 0) {
    const numerosSet = new Set(numeros);
    const numerosTextoSet = new Set(numeros.map(String));
    return indice
      .filter((entrada) =>
        numerosSet.has(entrada.numeroNota) || numerosTextoSet.has(entrada.notaMae))
      .map((entrada) => entrada.registro);
  }

  const queryNormalizada = query.toLowerCase();
  return indice
    .filter((entrada) => entrada.valores.some((valor) => valor.includes(queryNormalizada)))
    .map((entrada) => entrada.registro);
}

export interface Filtro {
  campo: string;
  tipo: 'texto' | 'multi' | 'faixa';
  texto?: string;
  valores?: string[];
  min?: number;
  max?: number;
}

/** Abreviação pt-BR usada em Mes_Execucao_Planejado ("maio" por extenso, demais com 3 letras). */
export const MESES_ABREV_PT = ['jan', 'fev', 'mar', 'abr', 'maio', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

/** Filtro por mês de execução planejado (ex.: mes=7, ano=2026 -> "jul-2026"). */
export function filtroPorMes(mes: number, ano: number): Filtro {
  return { campo: 'Mes_Execucao_Planejado', tipo: 'multi',
    valores: [`${MESES_ABREV_PT[mes - 1]}-${ano}`] };
}

/** Filtro por Conjunto (plano), opcionalmente combinado com Regional_CSD. */
export function filtroPorPlano(plano: string, regional: string | null): Filtro[] {
  return [
    { campo: 'Conjunto', tipo: 'multi', valores: [plano] },
    ...(regional ? [{ campo: 'Regional_CSD', tipo: 'multi' as const, valores: [regional] }] : []),
  ];
}

/** Motor de filtragem (porte de Input/app.py:247-262, aplicado no cliente). */
export function aplicarFiltros(registros: NotaInput[], filtros: Filtro[]): NotaInput[] {
  const ativos = filtros.filter((f) =>
    (f.tipo === 'texto' && (f.texto ?? '').trim() !== '') ||
    (f.tipo === 'multi' && (f.valores?.length ?? 0) > 0) ||
    (f.tipo === 'faixa' && (f.min !== undefined || f.max !== undefined)));
  if (ativos.length === 0) return registros;
  return registros.filter((r) => ativos.every((f) => {
    const bruto = r[f.campo];
    if (f.tipo === 'texto') {
      const valStr = String(bruto ?? '').toUpperCase();
      const query = (f.texto ?? '').trim().toUpperCase();
      if (query.startsWith('*') && query.endsWith('*') && query.length > 2) {
        const exclude = query.slice(1, -1);
        return !valStr.includes(exclude);
      }
      return valStr.includes(query);
    }
    if (f.tipo === 'multi') {
      return (f.valores ?? []).includes(String(bruto ?? ''));
    }
    const n = Number(bruto);
    if (!Number.isFinite(n)) return false;
    if (f.min !== undefined && n < f.min) return false;
    if (f.max !== undefined && n > f.max) return false;
    return true;
  }));
}

export function valoresUnicos(registros: NotaInput[], campo: string): string[] {
  const valores = new Set<string>();
  for (const r of registros) {
    const v = r[campo];
    if (v !== null && v !== undefined && String(v).trim() !== '') valores.add(String(v));
  }
  return [...valores].sort((a, b) =>
    campo === 'Mes_Execucao_Planejado' ? compararDatas(a, b) : a.localeCompare(b, 'pt-BR'));
}

/** Cola TSV do Excel em registros na ordem fixa de colunas. */
export function parseColagemTsv(texto: string, colunas: string[]): Partial<NotaInput>[] {
  return texto.split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((linha) => {
      const celulas = linha.split('\t');
      const registro: Partial<NotaInput> = {};
      colunas.forEach((c, i) => { registro[c] = (celulas[i] ?? '').trim(); });
      return registro;
    });
}

export function formatarDataHora(v: string | number | null): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString('pt-BR');
}

export function formatarNumero(v: Celula, casas = 2, agrupar = true): string {
  if (v === null || v === undefined) return '-';
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
    useGrouping: agrupar,
  });
}

export interface SelecaoRetangulo {
  min: { col: number; row: number };
  max: { col: number; row: number };
}
export interface ResumoSelecao { soma: number; media: number; contagem: number; }

/** Agrega as células NUMÉRICAS do retângulo selecionado (estilo Excel). */
export interface SugestaoDetetive {
  Nota_Filha_Orfa: number;
  Possivel_Nota_Mae: string;
}

const PALAVRAS_PROIBIDAS = ['SUBSTITUIDA', 'SUBSTITUÍDA', 'SUBST.', 'SUBST ', 'CANCELADA'];

export function varrerVinculos(registros: NotaInput[]): SugestaoDetetive[] {
  const dictConj: Record<string, string> = {};
  for (const r of registros) {
    dictConj[String(r.Numero_Nota)] = String(r['Conjunto'] ?? '').trim().toUpperCase();
  }
  const orfas = registros.filter((r) => {
    const mae = String(r['Nota_Mae'] ?? '-').trim();
    return (mae === '-' || mae === '' || mae === 'None') && Number(r['Planejado_DDPM']) === 0;
  });
  const seen = new Set<number>();
  const sugestoes: SugestaoDetetive[] = [];
  for (const row of orfas) {
    const texto = `${String(row['Status_Obra'] ?? '')} ${String(row['Observacao'] ?? '')}`.toUpperCase();
    if (PALAVRAS_PROIBIDAS.some((p) => texto.includes(p))) continue;
    const nums = [...texto.matchAll(/\b\d{6,9}\b/g)].map((m) => m[0]);
    const conjOrfa = String(row['Conjunto'] ?? '').trim().toUpperCase();
    for (const num of nums) {
      if (num in dictConj && num !== String(row.Numero_Nota) && dictConj[num] === conjOrfa) {
        if (!seen.has(row.Numero_Nota)) {
          seen.add(row.Numero_Nota);
          sugestoes.push({ Nota_Filha_Orfa: row.Numero_Nota, Possivel_Nota_Mae: num });
        }
        break;
      }
    }
  }
  return sugestoes;
}

export function calcularSelecao(
  registros: NotaInput[],
  colunas: ColunaDef[],
  sel: SelecaoRetangulo | null,
): ResumoSelecao | null {
  if (!sel) return null;
  const nums: number[] = [];
  for (let r = sel.min.row; r <= sel.max.row; r++) {
    const reg = registros[r];
    if (!reg) continue;
    for (let ci = sel.min.col; ci <= sel.max.col; ci++) {
      const col = colunas[ci];
      if (!col || !col.numeric) continue;
      const bruto = reg[col.key];
      if (bruto === null || bruto === undefined || bruto === '') continue;
      const n = Number(bruto);
      if (Number.isFinite(n)) nums.push(n);
    }
  }
  if (nums.length === 0) return { soma: 0, media: 0, contagem: 0 };
  const soma = nums.reduce((a, b) => a + b, 0);
  return { soma, media: soma / nums.length, contagem: nums.length };
}
