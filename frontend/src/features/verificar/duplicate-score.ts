export const DUPLICATE_SCORE_FIELDS = [
  "problema",
  "local_instalacao",
  "poste",
  "referencia",
] as const;

export type DuplicateScoreField = (typeof DUPLICATE_SCORE_FIELDS)[number];
export type DuplicateScoreValues = Record<DuplicateScoreField, string | null | undefined>;
export type DuplicateScoreIndicator = "match" | "diferente" | "indisponivel";
export type DuplicateScoreBand = "forte" | "possivel" | "distinta" | "insuficiente";

export interface DuplicateScoreFieldResult {
  indicador: DuplicateScoreIndicator;
  peso: number;
  pesoEfetivo: number;
  erroOrigem: boolean;
  erroCandidata: boolean;
}

export interface DuplicateScoreResult {
  score: number | null;
  cobertura: number;
  matches: number;
  pesoElegivel: number;
  pesoMatches: number;
  faixa: DuplicateScoreBand;
  campos: Record<DuplicateScoreField, DuplicateScoreFieldResult>;
}

const FIELD_WEIGHTS: Record<DuplicateScoreField, number> = {
  problema: 2,
  local_instalacao: 1.6,
  poste: 1.3,
  referencia: 1.1,
};

const TOTAL_WEIGHT = 6;

export function normalizeDuplicateValue(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, "").toLocaleLowerCase("pt-BR");
}

export function isDuplicateValueUnavailable(value: string | null | undefined): boolean {
  const normalized = normalizeDuplicateValue(value);
  return ["", "-", "—", "nan", "none", "n/a", "desconhecido"].includes(normalized);
}

function getBand(score: number | null, matches: number, coverage: number): DuplicateScoreBand {
  if (coverage < 0.6 || matches < 2 || score === null) return "insuficiente";
  if (score >= 0.85) return "forte";
  if (score >= 0.6) return "possivel";
  return "distinta";
}

export function calculateDuplicateScore(
  origem: DuplicateScoreValues,
  candidata: DuplicateScoreValues,
  camposComErroOrigem: DuplicateScoreField[] = [],
  camposComErroCandidata: DuplicateScoreField[] = [],
): DuplicateScoreResult {
  const errosOrigem = new Set(camposComErroOrigem);
  const errosCandidata = new Set(camposComErroCandidata);
  const campos = {} as Record<DuplicateScoreField, DuplicateScoreFieldResult>;
  let matches = 0;
  let pesoElegivel = 0;
  let pesoMatches = 0;

  for (const campo of DUPLICATE_SCORE_FIELDS) {
    const peso = FIELD_WEIGHTS[campo];
    const erroOrigem = errosOrigem.has(campo);
    const erroCandidata = errosCandidata.has(campo);
    const indisponivel = isDuplicateValueUnavailable(origem[campo]) || isDuplicateValueUnavailable(candidata[campo]);

    if (indisponivel) {
      campos[campo] = { indicador: "indisponivel", peso, pesoEfetivo: 0, erroOrigem, erroCandidata };
      continue;
    }

    const pesoEfetivo = erroOrigem || erroCandidata ? 1 : peso;
    const match = normalizeDuplicateValue(origem[campo]) === normalizeDuplicateValue(candidata[campo]);
    pesoElegivel += pesoEfetivo;

    if (match) {
      matches += 1;
      pesoMatches += pesoEfetivo;
    }

    campos[campo] = {
      indicador: match ? "match" : "diferente",
      peso,
      pesoEfetivo,
      erroOrigem,
      erroCandidata,
    };
  }

  const score = pesoElegivel === 0 ? null : pesoMatches / pesoElegivel;
  const cobertura = pesoElegivel / TOTAL_WEIGHT;

  return {
    score,
    cobertura,
    matches,
    pesoElegivel,
    pesoMatches,
    faixa: getBand(score, matches, cobertura),
    campos,
  };
}
