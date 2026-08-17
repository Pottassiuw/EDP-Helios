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
  return {
    campo: 'Mes_Execucao_Planejado', tipo: 'multi',
    valores: [`${MESES_ABREV_PT[mes - 1]}-${ano}`]
  };
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

/** Cola TSV do Excel em registros na ordem fixa de colunas, ignorando cabeçalhos e convertendo tipos. */
export function parseColagemTsv(texto: string, colunas: string[]): Partial<NotaInput>[] {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (linhas.length === 0) return [];

  const primeiraLinha = linhas[0];
  const primeiraCelula = (primeiraLinha.split('\t')[0] ?? '').trim();
  const ehCabecalho = !/^\d+$/.test(primeiraCelula);
  const linhasDados = ehCabecalho ? linhas.slice(1) : linhas;

  return linhasDados
    .map((linha) => {
      const celulas = linha.split('\t');
      const registro: Partial<NotaInput> = {};
      colunas.forEach((c, i) => {
        const val = (celulas[i] ?? '').trim();
        if (c === 'Numero_Nota') {
          const num = Number(val);
          if (Number.isFinite(num) && num > 0) {
            registro[c] = num;
          }
        } else if (c === 'Planejado_DDPM') {
          const num = Number(val.replace(',', '.'));
          registro[c] = Number.isFinite(num) ? num : 0;
        } else {
          registro[c] = val || (c === 'Nota_Mae' || c === 'Check' ? '-' : '');
        }
      });
      return registro;
    })
    .filter((r) => r.Numero_Nota !== undefined && Number.isFinite(Number(r.Numero_Nota)));
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
  const todasNotas = new Set<string>();

  for (const r of registros) {
    const nStr = String(r.Numero_Nota);
    todasNotas.add(nStr);
    dictConj[nStr] = String(r['Conjunto'] ?? '').trim().toUpperCase();
  }

  const ehOrfa = (r: NotaInput): boolean => {
    const mae = String(r['Nota_Mae'] ?? '-').trim();
    return mae === '-' || mae === '' || mae === 'None' || mae === 'null';
  };

  const seen = new Set<number>();
  const sugestoes: SugestaoDetetive[] = [];

  // 1. Varredura Direta: Notas órfãs que citam a nota mãe ou referência no texto
  for (const row of registros) {
    if (!ehOrfa(row)) continue;
    const obs = String(row['Observacao'] ?? '');
    const statusObra = String(row['Status_Obra'] ?? '');
    const texto = `${statusObra} ${obs}`.toUpperCase();
    if (PALAVRAS_PROIBIDAS.some((p) => texto.includes(p))) continue;

    // Se o texto diz "FILHAS:" no plural listando notas filhas, este registro é mãe (tratado no passo 2)
    if (/\bFILHAS\s*[:\s]/i.test(texto)) continue;

    const nums = [...texto.matchAll(/\b\d{6,9}\b/g)].map((m) => m[0]);
    const conjOrfa = String(row['Conjunto'] ?? '').trim().toUpperCase();

    for (const num of nums) {
      if (todasNotas.has(num) && num !== String(row.Numero_Nota)) {
        const conjMae = dictConj[num] ?? '';
        const mesmoConjunto = !conjOrfa || !conjMae || conjOrfa === '-' || conjMae === '-' || conjOrfa === conjMae;
        if (mesmoConjunto && !seen.has(row.Numero_Nota)) {
          seen.add(row.Numero_Nota);
          sugestoes.push({ Nota_Filha_Orfa: row.Numero_Nota, Possivel_Nota_Mae: num });
          break;
        }
      }
    }
  }

  // 2. Varredura Inversa: Uma Nota Mãe que lista suas filhas em Observacao (ex: "Filhas vinculadas: 16000001 e 16000002")
  for (const row of registros) {
    if (seen.has(row.Numero_Nota)) continue;
    const obsMae = String(row['Observacao'] ?? '').toUpperCase();
    if (!obsMae || PALAVRAS_PROIBIDAS.some((p) => obsMae.includes(p))) continue;
    if (!/\bFILHA/i.test(obsMae)) continue;

    const numsCitados = [...obsMae.matchAll(/\b\d{6,9}\b/g)].map((m) => Number(m[0]));
    const maeIdStr = String(row.Numero_Nota);

    for (const numFilha of numsCitados) {
      if (numFilha === row.Numero_Nota || seen.has(numFilha)) continue;
      const filhaRow = registros.find((r) => r.Numero_Nota === numFilha);
      if (filhaRow && ehOrfa(filhaRow)) {
        seen.add(numFilha);
        sugestoes.push({ Nota_Filha_Orfa: numFilha, Possivel_Nota_Mae: maeIdStr });
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

/** Verifica se a nota está marcada como oculta (Check = 'Oculta', 'oculto', '[oculta]' ou Observação com '[OCULTA]'). */
export function ehNotaOculta(nota: Partial<NotaInput>): boolean {
  const check = String(nota.Check ?? '').trim().toLowerCase();
  if (check === 'oculta' || check === 'ocultar' || check === 'oculto' || check === '[oculta]') return true;
  const obs = String(nota.Observacao ?? '').toUpperCase();
  if (obs.includes('[OCULTA]') || obs.includes('[OCULTO]')) return true;
  return false;
}

/** Encontra notas ocultas que atendem aos critérios de busca por texto ou número de nota. */
export function buscarNotasOcultas(registros: NotaInput[], buscaStr: string): NotaInput[] {
  const query = buscaStr.trim();
  if (!query) return [];
  const qLower = query.toLowerCase();
  const termos = query.split(/[ ,;]+/).map((s) => s.trim()).filter(Boolean);
  const numeros = termos.filter((s) => /^\d+$/.test(s)).map(Number);
  const setNums = new Set(numeros);

  return registros.filter((r) => {
    if (!ehNotaOculta(r)) return false;
    const idNota = r.Numero_Nota;
    const idStr = String(idNota);
    const maeStr = String(r.Nota_Mae ?? '').trim();

    if (setNums.has(idNota) || setNums.has(Number(maeStr))) return true;
    if (idStr.includes(query) || maeStr.includes(query)) return true;

    return Object.values(r).some((v) =>
      v !== null && v !== undefined && String(v).toLowerCase().includes(qLower)
    );
  });
}
