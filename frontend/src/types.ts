// ── Domínio ──────────────────────────────────────────────────────────────
export type RuleKey = string;
export type NoteStatus = "erro" | "ok";
export type Theme = "system" | "dark" | "light";
export type Density = "compact" | "cozy";
export type UrgBand = "high" | "med" | "low";
export type Source = "api";
export type AppSection =
  | "relatorios"
  | "coffee"
  | "input"
  | "carteira"
  | "configuracoes";
export type RelatoriosPage =
  | "dashboard"
  | "regional"
  | "mensalizacao"
  | "financeiro"
  | "postergacoes"
  | "exportar";
export type CoffeeSubPage =
  | "abrir"
  | "operacao"
  | "concluidas"
  | "verificar"
  | "logs";
export type CoffeeConclusaoFiltro = "todas" | "gerada" | "corrigida";
export type RelatoriosSubPage = "mes" | "planos" | "mensalizacao";
export type CarteiraSubPage = "dashboard" | "explorador" | "sincronizacao" | "divergencias";

export function normalizeRelatoriosPage(value: string): RelatoriosPage {
  if (
    value === "dashboard"
    || value === "regional"
    || value === "mensalizacao"
    || value === "financeiro"
    || value === "postergacoes"
    || value === "exportar"
  ) {
    return value;
  }
  return "dashboard";
}

export function normalizeCoffeeSubPage(value: string): CoffeeSubPage {
  if (value === "geradas" || value === "pendentes") return "operacao";
  if (value === "corrigidas") return "concluidas";
  if (
    value === "abrir"
    || value === "operacao"
    || value === "concluidas"
    || value === "verificar"
    || value === "logs"
  ) {
    return value;
  }
  return "verificar";
}

export interface NoteError {
  rule: RuleKey;
  rule_name: string;
  value: string;
}

// Fields used for side-by-side duplicate comparison
export type DuplicateField = "local_instalacao" | "poste" | "referencia" | "problema";

export interface ComparableFields {
  local_instalacao: string;
  poste: string;
  referencia: string;
  problema: string;
  tipo_nota: string;
  setor: string;
  uf: string;
  prioridade: number;
  observacao?: string;
  referencia_eletrica?: string;
  campos_com_erro?: DuplicateField[];
}

export interface DuplicateCandidate extends ComparableFields {
  id: string;
  in_sheet: boolean;
  match: DuplicateField[];
  latitude: string | null;
  longitude: string | null;
  /** Presente só para candidatas externas (in_sheet=false): achou linha na Carteira? */
  carteira_match?: boolean;
  status_sap?: string | null;
  prioridade_sap?: number | null;
  conjunto?: string | null;
  /** Data em que a nota saiu da última sincronização da Carteira (tombstone), se aplicável. */
  carteira_ausente_em?: string | null;
}

export interface NoteGenerator {
  matricula: string;
  nome: string;
  uf: string;
  inspetor: boolean;
  cadastrado: boolean;
}

export interface NoteRaw {
  id: string;
  tipo_nota: string;
  referencia_fisica: string;
  prioridade: number;
  setor: string;
  uf: string;
  local_instalacao: string;
  alimentador: string;
  colaborador: string;
  executor: string;
  imagens_totais: number;
  imagens_recebidas: number;
  latitude: string;
  longitude: string;
  id_sap: string;
  descricao: string;
  poste: string;
}

export interface Note extends ComparableFields {
  id: string;
  latitude: string | null;
  longitude: string | null;
  colaborador: string | null;
  gerador?: NoteGenerator;
  imagens_totais: number | null;
  imagens_recebidas: number | null;
  // kept for Detail view display; not comparison keys
  id_sap?: string;
  descricao?: string;
  errors: NoteError[];
  status: NoteStatus;
  duplicates: DuplicateCandidate[];
  raw: NoteRaw;
}

export interface RuleDef {
  label: string;
  short: string;
  field?: string;
}
export interface RuleMeta {
  label: string;
  short: string;
}

// ── Estado de Tweaks ─────────────────────────────────────────────────────
/** [sólido, hover, tint, tipo-sobre-o-sólido].
 *  O quarto valor existe porque o pareamento não é derivável: o esmeralda
 *  pede tipo quase-preto e os acentos escuros pedem branco. */
export type Accent = [string, string, string, string];

// ── Camada de dados / API ────────────────────────────────────────────────
export interface TriageSourceInfo {
  arquivo: string;
  schema_version: number;
  atualizado_em: string | null;
}

export type TriageSituation = 'encaminhada' | 'falha_operacional' | 'retornada';

export interface TriageForwarding {
  situacao: TriageSituation;
  etapa: string | null;
  erro: string | null;
  encaminhada_em: string | null;
  encaminhada_por: string | null;
  retornada_em: string | null;
  retornada_por: string | null;
  retorno_justificativa: string | null;
}

export interface TriageDailyForwarding {
  usuario: string;
  total: number;
}

export interface FetchResult {
  notes: Note[];
  completed: Set<string>;
  source: Source;
  fonte: TriageSourceInfo | null;
  encaminhamentos: Record<string, TriageForwarding>;
  encaminhadasHoje: TriageDailyForwarding[];
}
export interface ToggleResult {
  status: string;
  completed: boolean;
}
export interface DuplicateResult {
  status: string;
}

// ── Props dos componentes ────────────────────────────────────────────────
export interface FieldProps {
  label: string;
  accent?: boolean;
  children?: React.ReactNode;
  grow?: boolean;
}
export interface DuplicateCompareProps {
  note: Note;
  resolved: boolean;
  onMarkDuplicate: (id: string, justificativa?: string) => void;
  onSendToCoffee?: (ids: string[], sourceId?: string) => void;
}

export interface KpiDrawerProps {
  pct: number;      // conformidade %
  cTotal: number;   // total de notas
  cOk: number;      // notas sem falha
  cErr: number;     // notas com erro
  cDup: number;     // notas com duplicatas
  cEncaminhadas: number; // notas atualmente encaminhadas ao COFFEE
  cFalhasOperacionais: number;
  cRetornadas: number;
  cVisible: number; // notas visíveis no filtro atual
  encaminhadasHoje: TriageDailyForwarding[];
  selectedNotes?: Note[];
  onRemoveSelected?: (id: string) => void;
}
