/** Rotulagem e agrupamento dos campos crus do `json_all` do COFFEE (`campos`
 * em `CoffeeConsulta`). A API devolve dezenas de nomes técnicos em
 * snake_case sem estrutura nenhuma — este módulo só melhora a leitura,
 * nunca descarta ou transforma o valor original. */

export const GRUPOS_ORDEM = [
  'Identificação',
  'Local e rede',
  'Execução',
  'Estado',
  'Risco e segurança',
  'Metadados',
] as const;

export type GrupoCampo = typeof GRUPOS_ORDEM[number];

/** Rótulos conhecidos pra chaves já observadas em `json_all` (ver
 * `coffee_module/routes.py: consultar` e `docs/dev/12-integracao-edicao-coffee.md`).
 * Qualquer chave fora daqui cai no fallback de `humanizarChave`. */
const LABEL_MAP: Record<string, string> = {
  id_sap: 'ID SAP',
  pk: 'Chave COFFEE (pk)',
  arquivado: 'Arquivado',
  cidade: 'Cidade',
  tipo_local_instalacao: 'Tipo do local de instalação',
  local_instalacao_numero: 'Número do local de instalação',
  local_corrigido: 'Local corrigido',
  alimentador: 'Alimentador',
  alimentador_corrigido: 'Alimentador corrigido',
  cidade_trafo: 'Cidade do trafo',
  trafo_numero: 'Número do trafo',
  trafo_corrigido: 'Trafo corrigido',
  poste: 'Poste',
  postes: 'Poste',
  referencia_fisica: 'Referência física',
  referencia_eletrica: 'Referência elétrica',
  componente: 'Componente',
  componente_novo: 'Componente',
  sintoma: 'Sintoma',
  causa: 'Causa',
  prioridade: 'Prioridade',
  quantidade: 'Quantidade',
  observacao: 'Observação',
  observacoes: 'Observação',
  latitude: 'Latitude',
  longitude: 'Longitude',
  anonima: 'Anônima',
  feedback: 'Feedback',
  usuario_responsavel: 'Usuário responsável',
};

/** Fallback seguro pra qualquer chave sem rótulo mapeado: "tipo_defeito"
 * vira "Tipo Defeito". Nunca falha, nunca esconde a informação original. */
export function humanizarChave(chave: string): string {
  return chave
    .split('_')
    .filter(Boolean)
    .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

export function rotularCampo(chave: string): string {
  return LABEL_MAP[chave] ?? humanizarChave(chave);
}

const PADROES_GRUPO: Array<[RegExp, GrupoCampo]> = [
  [/risco|preserva|desaprumo|engastamento|deteriorad|abalroamento|ferragem|cerne|exposta|terceiros|mutuo/, 'Risco e segurança'],
  [/cidade|local|alimentador|trafo|referencia|poste/, 'Local e rede'],
  [/componente|sintoma|causa|prioridade|quantidade|executor|colaborador|vao|fabricacao/, 'Execução'],
  [/arquivad|corrigid|confirmad|esforco|suplementad|morro|status|situacao|religador/, 'Estado'],
  [/^id_sap$|^pk$|anonima|feedback|usuario|responsavel/, 'Identificação'],
];

/** Agrupa por assunto usando o nome da chave — robusto a campos nunca vistos
 * antes, já que não depende de uma lista fixa e completa dos 38+ campos do
 * COFFEE. Booleanos sem outro sinal caem em Estado; o resto vai pra
 * Metadados (datas, coordenadas, contagens). */
export function agruparCampo(chave: string, valor: unknown): GrupoCampo {
  const chaveNormalizada = chave.toLowerCase();
  for (const [padrao, grupo] of PADROES_GRUPO) {
    if (padrao.test(chaveNormalizada)) return grupo;
  }
  if (typeof valor === 'boolean') return 'Estado';
  return 'Metadados';
}

export function formatarValorCru(valor: unknown): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (Array.isArray(valor) || (typeof valor === 'object')) {
    return JSON.stringify(valor);
  }
  return String(valor);
}
