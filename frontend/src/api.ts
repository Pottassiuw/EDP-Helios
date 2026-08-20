import type {
  RuleKey,
  RuleMeta,
  FetchResult,
  Note,
  NoteError,
  NoteGenerator,
  NoteRaw,
  NoteStatus,
  DuplicateCandidate,
  TriageDailyForwarding,
  TriageForwarding,
  TriageSourceInfo,
  ToggleResult,
  DuplicateResult,
} from "./types";
import { getUsuario, setUsuario, InputApi } from "./features/input/api";
export const BASE: string =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('edp_api') || '/api'
    : '/api';
const hash_api_url = import.meta.env.VITE_HASH_API_URL;
const COFFEE_BASE = `https://coffee.edp.gpti.com.br/${hash_api_url}/informativo/`;
export const coffeeUrl = (id: string): string =>
  COFFEE_BASE + encodeURIComponent(id) + "/change/";
export const mapsUrl = (lat: string, lon: string): string =>
  "https://www.google.com/maps/search/?api=1&query=" + lat + "," + lon;

let coffeeWarned = false;
export function openCoffee(ids: string | string[]): void {
  const list = Array.isArray(ids) ? ids : [ids];
  if (list.length > 3 && !coffeeWarned) {
    coffeeWarned = true;
    window.alert(
      "Vamos abrir " +
        list.length +
        " abas no COFFEE. Se o navegador bloquear, " +
        "permita popups para este site e tente de novo.",
    );
  }
  list.forEach((id, i) => {
    window.setTimeout(
      () => window.open(coffeeUrl(id), "_blank", "noopener"),
      i * 250,
    );
  });
}

const NICE: Record<RuleKey, string> = {
  chk_coordenada: "Coordenada",
  chk_referencia: "Referência",
  chk_imagens: "Imagens",
  chk_executor: "Executor",
  chk_local_instal: "Local Instalação",
  chk_local_instalacao: "Local Instalação",
  chk_tipo_nota: "Tipo de Nota",
  chk_id_sap: "ID SAP",
  chk_setor: "Setor",
  chk_prioridade: "Prioridade",
  chk_duplicata: "Duplicata",
};
function titleize(s: string): string {
  return String(s)
    .replace(/^chk_/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
export function ruleMeta(rule: RuleKey): RuleMeta {
  const label = NICE[rule] ?? titleize(rule);
  return { label, short: label };
}

interface ApiRecord {
  id: string;
  prioridade: number;
  tipo_nota: string;
  referencia: string;
  uf: string;
  setor: string;
  latitude?: string | null;
  longitude?: string | null;
  colaborador?: string | null;
  gerador?: NoteGenerator;
  imagens_totais?: number | null;
  imagens_recebidas?: number | null;
  local_instalacao?: string;
  poste?: string;
  problema?: string;
  id_sap?: string;
  descricao?: string;
  errors: NoteError[];
  status: NoteStatus;
  duplicates?: DuplicateCandidate[];
  raw?: Partial<NoteRaw> & Record<string, unknown>;
}
interface ApiData {
  records?: ApiRecord[];
  completed?: string[];
  fonte?: TriageSourceInfo | null;
  encaminhamentos?: Record<string, TriageForwarding>;
  encaminhadas_hoje?: TriageDailyForwarding[];
}

function str(v: unknown, fb = ""): string {
  return v == null ? fb : String(v);
}
function num(v: unknown): number | null {
  return v == null || v === "" ? null : Number(v);
}

function normalize(j: ApiData): FetchResult {
  const records = j.records ?? [];
  const notes: Note[] = records.map((r): Note => {
    const raw = (r.raw ?? {}) as Partial<NoteRaw> & Record<string, unknown>;
    const ref = r.referencia;
    const local = r.local_instalacao ?? str(raw.local_instalacao);
    return {
      id: r.id,
      prioridade: r.prioridade,
      tipo_nota: r.tipo_nota,
      referencia: ref,
      uf: r.uf,
      setor: r.setor,
      local_instalacao: local || ref,
      poste: r.poste ?? str(raw.postes ?? raw.poste),
      problema: r.problema ?? str(raw.problema, ""),
      // kept for Detail display only
      id_sap: r.id_sap ?? str(raw.id_sap, "-"),
      descricao: r.descricao ?? str(raw.descricao, ""),
      latitude:
        r.latitude ?? (raw.latitude != null ? String(raw.latitude) : null),
      longitude:
        r.longitude ?? (raw.longitude != null ? String(raw.longitude) : null),
      colaborador: r.colaborador ?? (str(raw.colaborador) || null),
      gerador: r.gerador,
      imagens_totais: r.imagens_totais ?? num(raw.imagens_totais),
      imagens_recebidas: r.imagens_recebidas ?? num(raw.imagens_recebidas),
      errors: r.errors ?? [],
      status: r.status,
      duplicates: (r.duplicates ?? []).map((d) => ({
        ...d,
        in_sheet: d.in_sheet ?? false,
      })),
      raw: raw as NoteRaw,
    };
  });
  return {
    notes,
    completed: new Set(j.completed ?? []),
    source: "api",
    fonte: j.fonte ?? null,
    encaminhamentos: j.encaminhamentos ?? {},
    encaminhadasHoje: j.encaminhadas_hoje ?? [],
  };
}

// Instrumentação opcional da abertura da seção COFFEE:
// localStorage.setItem('edp_perf', '1') e recarregue. Loga rede, parse e
// normalização separados, além da contagem de chamadas (chamadas duplicadas
// aparecem como #2, #3… para a mesma rota).
const perfAtivo =
  typeof localStorage !== 'undefined'
    ? localStorage.getItem('edp_perf') === '1'
    : false;
const perfChamadas = new Map<string, number>();
function perfLog(rota: string, etapas: Record<string, number>, sufixo = ""): void {
  const n = (perfChamadas.get(rota) ?? 0) + 1;
  perfChamadas.set(rota, n);
  const detalhe = Object.entries(etapas)
    .map(([k, v]) => `${k}=${Math.round(v)}ms`)
    .join(" ");
  console.info(`[COFFEE-PERF] ${rota} #${n} ${detalhe} ${sufixo}`.trimEnd());
}

export async function fetchData(): Promise<FetchResult> {
  const t0 = performance.now();
  const res = await fetch(BASE + "/data", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("GET /data -> " + res.status);
  const t1 = performance.now();
  const json = (await res.json()) as ApiData;
  const t2 = performance.now();
  const resultado = normalize(json);
  if (perfAtivo) {
    perfLog("GET /data", {
      rede: t1 - t0,
      parse: t2 - t1,
      normalize: performance.now() - t2,
    }, `notas=${resultado.notes.length}`);
  }
  return resultado;
}

async function erroComDetail(res: Response, fallback: string): Promise<Error> {
  const e = await res.json().catch(() => ({})) as { detail?: string };
  return new Error(e.detail ?? (fallback + " -> " + res.status));
}

export async function toggleComplete(id: string): Promise<ToggleResult> {
  const res = await fetch(BASE + "/complete/" + encodeURIComponent(id), {
    method: "POST",
  });
  if (!res.ok) throw new Error("POST /complete -> " + res.status);
  return res.json() as Promise<ToggleResult>;
}

export async function markDuplicate(id: string, justificativa?: string): Promise<DuplicateResult> {
  const res = await fetch(BASE + "/duplicata/" + encodeURIComponent(id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ justificativa: justificativa || null }),
  });
  if (!res.ok) throw new Error("POST /duplicata -> " + res.status);
  return res.json() as Promise<DuplicateResult>;
}

export async function desfazerDuplicata(id: string): Promise<DuplicateResult> {
  const res = await fetch(BASE + "/duplicata/" + encodeURIComponent(id) + "/desfazer", {
    method: "POST",
  });
  if (!res.ok) throw new Error("POST /duplicata/desfazer -> " + res.status);
  return res.json() as Promise<DuplicateResult>;
}

export async function marcarGerar(id: string, aGerar: boolean, justificativa?: string): Promise<void> {
  const res = await coffeeFetch(BASE + "/coffee/marcar-gerar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: Number(id), a_gerar: aGerar, justificativa }),
  });
  if (!res.ok) throw await erroComDetail(res, "POST /marcar-gerar");
}

export interface AlterarLocalInstalacaoResultado {
  ok: true;
  local_instalacao: string;
}

export async function alterarLocalInstalacao(
  id: number,
  local: string,
): Promise<AlterarLocalInstalacaoResultado> {
  const res = await coffeeFetch(BASE + "/coffee/local-instalacao", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, local }),
  });
  if (!res.ok) throw await erroComDetail(res, "POST /local-instalacao");
  return res.json() as Promise<AlterarLocalInstalacaoResultado>;
}

export interface AlterarAlimentadorResultado {
  ok: true;
  alimentador: string;
}

export async function alterarAlimentador(
  id: number,
  alimentador: string,
): Promise<AlterarAlimentadorResultado> {
  const res = await coffeeFetch(BASE + "/coffee/alimentador", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, alimentador }),
  });
  if (!res.ok) throw await erroComDetail(res, "POST /alimentador");
  return res.json() as Promise<AlterarAlimentadorResultado>;
}

export async function listarAlimentadores(): Promise<import("./features/coffee/types").Alimentador[]> {
  const res = await coffeeFetch(BASE + "/coffee/alimentadores", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await erroComDetail(res, "GET /alimentadores");
  const body = await res.json() as { registros: import("./features/coffee/types").Alimentador[] };
  return body.registros;
}

export async function listarMunicipios(): Promise<import("./features/coffee/types").Municipio[]> {
  const res = await coffeeFetch(BASE + "/coffee/municipios", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await erroComDetail(res, "GET /municipios");
  const body = await res.json() as { registros: import("./features/coffee/types").Municipio[] };
  return body.registros;
}

export async function listarTiposEquipamento(): Promise<import("./features/coffee/types").TipoEquipamento[]> {
  const res = await coffeeFetch(BASE + "/coffee/tipos-equipamento", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await erroComDetail(res, "GET /tipos-equipamento");
  const body = await res.json() as { registros: import("./features/coffee/types").TipoEquipamento[] };
  return body.registros;
}

export async function consultarNota(
  id: number,
): Promise<import("./features/coffee/types").CoffeeConsulta> {
  const res = await coffeeFetch(BASE + "/coffee/consultar/" + id, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error("GET /consultar -> " + res.status);
  return res.json();
}

export interface CorrigirLocalItemApi {
  id: number;
  local: string;
}

export async function corrigirLocalLote(
  itens: CorrigirLocalItemApi[],
  gerarApos: boolean,
): Promise<{ job_id: string }> {
  const res = await coffeeFetch(BASE + "/coffee/corrigir-local-lote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itens, gerar_apos: gerarApos }),
  });
  if (!res.ok) throw await erroComDetail(res, "POST /corrigir-local-lote");
  return res.json() as Promise<{ job_id: string }>;
}

export async function garantirUsuario(): Promise<string> {
  const salvo = getUsuario();
  if (salvo) return salvo;
  let usuario = "sistema";
  try {
    usuario = (await InputApi.me()).usuario;
  } catch { /* backend fora: cai no fallback */ }
  setUsuario(usuario);
  return usuario;
}

/** fetch com o header X-User do COFFEE — identifica o dono das notas no backend. */
export async function coffeeFetch(
  url: string,
  init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
): Promise<Response> {
  const headers = { "X-User": await garantirUsuario(), ...init?.headers };
  return fetch(url, { ...init, headers });
}

export async function revisarNota(
  pk: number,
): Promise<import("./features/coffee/types").NotaRevisao> {
  const res = await fetch(BASE + "/integracao/nota/" + pk + "/revisao", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await erroComDetail(res, "GET /integracao/revisao");
  return res.json();
}

export async function moverParaPlano(
  pks: number[],
  camposUsuario: Partial<import("./features/coffee/types").CamposManuais>,
  atualizarExistente = false,
): Promise<import("./features/coffee/types").MoverResultado> {
  const res = await coffeeFetch(BASE + "/integracao/mover-para-plano", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pks,
      campos_usuario: camposUsuario,
      atualizar_existente: atualizarExistente,
    }),
  });
  if (!res.ok) throw await erroComDetail(res, "POST /integracao/mover-para-plano");
  return res.json();
}

export async function resumoForaDoPlano(): Promise<{ corrigidas_fora_do_plano: number }> {
  const res = await coffeeFetch(BASE + "/integracao/resumo-fora-do-plano", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw await erroComDetail(res, "GET /integracao/resumo-fora-do-plano");
  return res.json() as Promise<{ corrigidas_fora_do_plano: number }>;
}

export const EDPApi = {
  BASE,
  fetchData,
  toggleComplete,
  markDuplicate,
  desfazerDuplicata,
  marcarGerar,
  consultarNota,
  alterarLocalInstalacao,
  alterarAlimentador,
  listarAlimentadores,
  listarMunicipios,
  listarTiposEquipamento,
  coffeeUrl,
  mapsUrl,
  openCoffee,
  revisarNota,
  moverParaPlano,
  resumoForaDoPlano,
};
