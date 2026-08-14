import React from 'react';
import type {
  Note,
  NoteGenerator,
  TriageDailyForwarding,
  TriageForwarding,
  UrgBand,
  RuleKey,
} from '../../types';
import { EDPApi, ruleMeta } from '../../api';
import { regraLocalInstalacao } from '../../lib/local-instalacao';
import { PriorityChip, StatusTag, Field } from './shared';
import { DuplicateCompare } from './duplicate-compare';
import { calculateDuplicateScore } from './duplicate-score';
import { KpiDrawer } from './kpi-drawer';
import { detectarNoveExtra } from './malha-fina';
import { MalhaFinaPanel } from './malha-fina-panel';
import { LocalInstalacaoCorrection } from './local-instalacao-correction';
import { NotaFichaCompleta } from './nota-ficha-completa';
import { useConsultaCoffee } from './use-consulta-coffee';
import { usePersistedState } from '../../hooks/use-persisted-state';
import { toast } from 'sonner';
import { Eyebrow } from '@/components/branded/section';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Maximize2, Minimize2, RotateCcw, Check, Coffee, MapPin } from 'lucide-react';

const URG: Record<UrgBand, string> = { high: "Alta (1–2)", med: "Média (3–4)", low: "Baixa (5+)" };
function urgBand(p: number): UrgBand { return p <= 2 ? "high" : p <= 4 ? "med" : "low"; }

const DUPLICATE_INDICATOR = {
  forte: { symbol: '●', className: 'text-green', label: 'Forte' },
  possivel: { symbol: '◐', className: 'text-amber', label: 'Possível' },
  distinta: { symbol: '×', className: 'text-red', label: 'Distinta' },
  insuficiente: { symbol: '◌', className: 'text-indigo', label: 'Evidência insuficiente' },
} as const;

function duplicateIndicator(note: Note): { symbol: string; className: string; label: string; coverage: number } | null {
  const ranked = note.duplicates.map((candidate) => calculateDuplicateScore(
    note,
    candidate,
    note.campos_com_erro ?? [],
    candidate.campos_com_erro ?? [],
  )).sort((left, right) => {
    const rank = { forte: 3, possivel: 2, distinta: 1, insuficiente: 0 };
    return rank[right.faixa] - rank[left.faixa]
      || (right.score ?? -1) - (left.score ?? -1)
      || right.cobertura - left.cobertura;
  });
  const best = ranked[0];
  if (!best) return null;
  const indicator = DUPLICATE_INDICATOR[best.faixa];
  const coverage = Math.round(best.cobertura * 100);
  const evidence = best.faixa === 'insuficiente'
    ? `evidência insuficiente (cobertura ${coverage}%)`
    : `${Math.round((best.score ?? 0) * 100)}% · cobertura ${coverage}%`;
  return { ...indicator, coverage, label: `${indicator.label}: ${evidence}` };
}


function notaRequerCorrecaoLocal(note: Note): boolean {
  return note.errors.some((error) => regraLocalInstalacao(error.rule));
}

export function idsEncaminhaveisEmLote(
  ids: string[],
  notes: Note[],
  completed: Set<string>,
): string[] {
  const notesById = new Map(notes.map((note) => [note.id, note]));
  return ids.filter((id) => {
    const note = notesById.get(id);
    return note !== undefined
      && !completed.has(id)
      && !notaRequerCorrecaoLocal(note);
  });
}

export interface DashboardProps {
  showKpis: boolean;
  notes: Note[];
  completed: Set<string>;
  encaminhamentos: Record<string, TriageForwarding>;
  encaminhadasHoje: TriageDailyForwarding[];
  dupResolved: Set<string>;
  onToggleComplete: (id: string) => void;
  onMarkMany: (ids: string[], action: "done" | "reopen") => void;
  onMarkDuplicate: (id: string, justificativa?: string) => void;
  onSendToCoffee: (ids: string[], sourceId?: string) => void;
}

export function Dashboard(props: DashboardProps): React.JSX.Element {
  const {
    showKpis,
    notes,
    completed,
    encaminhamentos,
    encaminhadasHoje,
    dupResolved,
    onToggleComplete,
    onMarkMany,
    onMarkDuplicate,
    onSendToCoffee,
  } = props;
  const [q, setQ] = usePersistedState("edp_verify_q", "");
  const [uf, setUf] = usePersistedState("edp_verify_uf", "all");
  const [gerador, setGerador] = usePersistedState("edp_verify_gerador", "all");
  const [inspetor, setInspetor] = usePersistedState("edp_verify_inspetor", "all");
  const [setor, setSetor] = usePersistedState("edp_verify_setor", "all");
  const [urg, setUrg] = usePersistedState("edp_verify_urg", "all");
  const [situacao, setSituacao] = usePersistedState("edp_verify_situacao", "all");
  const situacaoAtual = situacao === "pending" ? "nao_encaminhada"
    : situacao === "done" ? "encaminhada" : situacao;
  const [rulesArr, setRulesArr] = usePersistedState<RuleKey[]>("edp_verify_rules", []);
  const rules = React.useMemo(() => new Set(rulesArr), [rulesArr]);
  const setRules = React.useCallback((s: Set<RuleKey>) => setRulesArr([...s]), [setRulesArr]);
  const [selBatch, setSelBatch] = React.useState<Set<string>>(() => new Set());
  const [selId, setSelId] = usePersistedState<string | null>("edp_verify_sel", notes[0] ? notes[0].id : null);
  const [queueCollapsed, setQueueCollapsed] = React.useState<boolean>(() => localStorage.getItem("edp_queue_collapsed") === "1");
  function toggleQueue(): void {
    setQueueCollapsed((c) => { const v = !c; localStorage.setItem("edp_queue_collapsed", v ? "1" : "0"); return v; });
  }

  const ufOpts = [...new Set(notes.map((n) => n.uf).filter(Boolean))].sort();
  const setorOpts = [...new Set(notes.map((n) => n.setor).filter(Boolean))].sort();
  const inspetorOpts = React.useMemo(() => {
    const porMatricula = new Map<string, NoteGenerator>();
    notes.forEach((n) => { if (n.gerador?.inspetor) porMatricula.set(n.gerador.matricula, n.gerador); });
    return [...porMatricula.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [notes]);
  const ruleStats: Record<RuleKey, number> = {};
  notes.forEach((n) => n.errors.forEach((e) => { ruleStats[e.rule] = (ruleStats[e.rule] ?? 0) + 1; }));
  const gruposNoveExtra = React.useMemo(() => detectarNoveExtra(notes), [notes]);

  const terms = q.toLowerCase().split(/[\s,;]+/).filter(Boolean);
  function matches(n: Note): boolean {
    if (terms.length) {
      const hay = `${n.id} ${n.referencia} ${n.tipo_nota} ${n.setor} ${n.gerador?.nome ?? ""}`.toLowerCase();
      if (!terms.some((tm) => hay.includes(tm))) return false;
    }
    if (uf !== "all" && n.uf !== uf) return false;
    if (gerador === "inspectors" && !n.gerador?.inspetor) return false;
    if (gerador === "inspectors" && inspetor !== "all" && n.gerador?.matricula !== inspetor) return false;
    if (setor !== "all" && n.setor !== setor) return false;
    if (urg !== "all" && urgBand(n.prioridade) !== urg) return false;
    const encaminhamento = encaminhamentos[n.id];
    if (situacaoAtual === "nao_encaminhada" && encaminhamento) return false;
    if (situacaoAtual === "encaminhada" && encaminhamento?.situacao !== "encaminhada") return false;
    if (situacaoAtual === "falha_operacional" && encaminhamento?.situacao !== "falha_operacional") return false;
    if (situacaoAtual === "retornada" && encaminhamento?.situacao !== "retornada") return false;
    if (rules.size && !n.errors.some((e) => rules.has(e.rule))) return false;
    return true;
  }
  const filtered = notes.filter(matches).sort((a, b) =>
    (Number(b.errors.length > 0) - Number(a.errors.length > 0)) || a.prioridade - b.prioridade);

  React.useEffect(() => {
    if (filtered.length && !filtered.some((n) => n.id === selId)) setSelId(filtered[0]?.id ?? null);
  }, [q, uf, gerador, inspetor, setor, urg, situacaoAtual, rules]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel: Note | undefined = notes.find((n) => n.id === selId) ?? filtered[0];

  const cTotal = notes.length;
  const cErr = notes.filter((n) => n.errors.length).length;
  const cOk = notes.filter((n) => !n.errors.length).length;
  const cEncaminhadas = notes.filter(
    (n) => encaminhamentos[n.id]?.situacao === "encaminhada",
  ).length;
  const cFalhasOperacionais = notes.filter(
    (n) => encaminhamentos[n.id]?.situacao === "falha_operacional",
  ).length;
  const cRetornadas = notes.filter(
    (n) => encaminhamentos[n.id]?.situacao === "retornada",
  ).length;
  const cDup = notes.filter((n) => n.duplicates.length).length;
  const pct = Math.round(cOk / cTotal * 100);

  // IDs da search bar não viram chips: com muitos IDs a barra "Ativos" estourava
  // (1 chip por nota, sem scroll). Gerenciamento de IDs é feito direto na search bar.
  const chips: Array<{ k: string; clear: () => void }> = [];
  if (uf !== "all") chips.push({ k: "UF: " + uf, clear: () => setUf("all") });
  if (gerador === "inspectors") chips.push({ k: "Gerada por: Inspetores ES/SP", clear: () => { setGerador("all"); setInspetor("all"); } });
  if (gerador === "inspectors" && inspetor !== "all") {
    const selecionado = inspetorOpts.find((opcao) => opcao.matricula === inspetor);
    chips.push({ k: "Inspetor: " + (selecionado?.nome ?? inspetor), clear: () => setInspetor("all") });
  }
  if (setor !== "all") chips.push({ k: "Setor: " + setor, clear: () => setSetor("all") });
  if (urg !== "all") chips.push({ k: "Urgência: " + URG[urg as UrgBand], clear: () => setUrg("all") });
  if (situacaoAtual !== "all") {
    const situacoes: Record<string, string> = {
      nao_encaminhada: "Não encaminhadas",
      encaminhada: "Encaminhadas",
      falha_operacional: "Falha operacional",
      retornada: "Retornadas pela Operação",
    };
    chips.push({ k: "Situação: " + situacoes[situacaoAtual], clear: () => setSituacao("all") });
  }
  rules.forEach((r) => chips.push({ k: "Bloqueio: " + ruleMeta(r).short, clear: () => { const s = new Set(rules); s.delete(r); setRules(s); } }));
  function clearAll(): void { setQ(""); setUf("all"); setGerador("all"); setInspetor("all"); setSetor("all"); setUrg("all"); setSituacao("all"); setRules(new Set()); }
  function changeGerador(value: string): void { setGerador(value); if (value === "all") setInspetor("all"); }

  function toggleRule(r: RuleKey): void { const s = new Set(rules); if (s.has(r)) s.delete(r); else s.add(r); setRules(s); }
  function toggleBatch(id: string): void { const s = new Set(selBatch); if (s.has(id)) s.delete(id); else s.add(id); setSelBatch(s); }

  return (
    <React.Fragment>
      <style>{`
        .triage .q{display:flex;align-items:center;gap:11px;padding:var(--row-py) 15px;cursor:pointer;
          border-bottom:1px solid var(--line);border-left:3px solid transparent;transition:background .1s}
        .triage .q:hover{background:var(--surface-2)}
        .triage .q.on{background:var(--surface-2);border-left-color:var(--accent)}
        .triage .q.dimdone{opacity:.55}
        .triage .kv{display:flex;flex-direction:column;gap:3px;background:var(--surface);padding:11px 14px}
        .triage .kv small{font-family:var(--font-mono);font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--text-mute)}
        .triage .kv div{font-size:13px;color:var(--text)}
        .triage .rchip{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:500;
          padding:6px 11px;border-radius:999px;cursor:pointer;white-space:nowrap;border:1px solid var(--line-2);
          background:var(--surface);color:var(--text-dim);transition:all .12s}
        .triage .rchip:hover{border-color:var(--text-mute);color:var(--text)}
        .triage .rchip.on{background:var(--accent-tint);border-color:var(--accent);color:var(--accent)}
        .triage .rchip .c{font-family:var(--font-mono);font-size:11px;font-weight:600;opacity:.85}
        .triage .fchip{display:inline-flex;align-items:center;gap:7px;font-family:var(--font-mono);font-size:11.5px;
          padding:4px 6px 4px 10px;border-radius:999px;background:var(--surface-2);border:1px solid var(--line-2);
          color:var(--text);cursor:pointer}
        .triage .fchip:hover{border-color:var(--red);color:var(--red)}
        .triage select:focus,.triage input:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-tint)}
      `}</style>

      <div className="shrink-0 bg-surface border-b-[1px] border-b-line">
        <div className="flex gap-[12px] items-end py-[12px] px-[22px] flex-wrap">
          <Field label="Buscar · ID, referência, tipo, setor" grow>
            <div className="relative w-full">
              <Input className="w-full" style={{ paddingRight: q ? 30 : 11 }} value={q}
                     onChange={(e) => setQ(e.target.value)} placeholder="Ex.: 104728801, VIX-04, poda…" />
              {q && (
                <button type="button" aria-label="Limpar busca" onClick={() => setQ("")}
                        className="text-text-mute text-[16px] py-[2px] px-[4px] absolute right-[6px] top-[50%] [transform:translateY(-50%)]
                                 border-0 bg-transparent cursor-pointer
                                 leading-none">×</button>
              )}
            </div>
          </Field>
          <Field label="Estado (UF)" accent>
            <Select value={uf} onValueChange={setUf}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {ufOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Gerada por" accent>
            <Select value={gerador} onValueChange={changeGerador}>
              <SelectTrigger className="w-full" aria-label="Filtrar por quem gerou a nota">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="inspectors">Inspetores ES/SP</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {gerador === "inspectors" && inspetorOpts.length > 0 && (
            <Field label="Inspetor" accent>
              <Select value={inspetor} onValueChange={setInspetor}>
                <SelectTrigger className="w-full" aria-label="Filtrar por inspetor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os inspetores</SelectItem>
                  {inspetorOpts.map((opcao) => (
                    <SelectItem key={opcao.matricula} value={opcao.matricula}>
                      {opcao.nome} ({opcao.uf})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Setor" accent>
            <Select value={setor} onValueChange={setSetor}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {setorOpts.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Urgência">
            <Select value={urg} onValueChange={setUrg}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(URG).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Situação">
            <Select value={situacaoAtual} onValueChange={setSituacao}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="nao_encaminhada">Não encaminhadas</SelectItem>
                <SelectItem value="encaminhada">Encaminhadas</SelectItem>
                <SelectItem value="falha_operacional">Falha operacional</SelectItem>
                <SelectItem value="retornada">Retornadas pela Operação</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex items-center gap-[9px] flex-wrap pt-0 px-[22px] pb-[13px]">
          <Eyebrow className="mr-[2px]">Bloqueio</Eyebrow>
          {Object.entries(ruleStats).sort((a, b) => b[1] - a[1]).map(([r, n]) => (
            <button key={r} className={"rchip" + (rules.has(r) ? " on" : "")} onClick={() => toggleRule(r)}>
              {ruleMeta(r).label}<span className="c">{n}</span></button>
          ))}
        </div>

        {chips.length > 0 && (
          <div className="flex items-center gap-[8px] flex-wrap pt-0 px-[22px] pb-[13px]">
            <Eyebrow className="mr-[2px]">Ativos</Eyebrow>
            {chips.map((c, i) => (
              <button key={i} className="fchip" onClick={c.clear}>{c.k}<span className="text-[14px] leading-none">×</span></button>
            ))}
            <button className="fchip text-red bg-tint-red" style={{ borderColor: "var(--status-red-border)" }}
                    onClick={clearAll}>Limpar tudo</button>
          </div>
        )}
      </div>

      <MalhaFinaPanel grupos={gruposNoveExtra} />

      <div className="flex-1 overflow-hidden grid" style={{
                    gridTemplateColumns: queueCollapsed ? "46px 1fr" : "minmax(430px,1fr) 1.2fr" }}>
        <div className="flex flex-col overflow-hidden bg-surface border-r-[1px] border-r-line">
          {queueCollapsed && (
            <button onClick={toggleQueue} title="Expandir fila" aria-label="Expandir fila"
                    className="flex flex-col items-center gap-[16px] py-[12px] px-[0px] box-border cursor-pointer h-full w-full">
              <span className="text-[15px] text-text-dim">»</span>
              <span className="font-mono text-[10.5px] text-text-mute whitespace-nowrap
                    [writing-mode:vertical-rl] [transform:rotate(180deg)] tracking-[.16em] uppercase">
                Fila · {filtered.length} {filtered.length === 1 ? "nota" : "notas"}</span>
            </button>
          )}
          {!queueCollapsed && (<React.Fragment>
          <div className="flex items-center justify-between py-[9px] px-[15px] bg-bg-2 border-b-[1px] border-b-line">
            <div className="flex items-center gap-[9px]">
              <Button variant="ghost" size="icon-sm" title="Recolher fila" aria-label="Recolher fila"
                      onClick={toggleQueue}>«</Button>
              <Eyebrow>Fila · {filtered.length} {filtered.length === 1 ? "nota" : "notas"}</Eyebrow>
            </div>
            {filtered.length > 0 && (
              <Button variant="ghost" size="sm"
                      onClick={() => setSelBatch(new Set(filtered.map((n) => n.id)))}>Selecionar todas</Button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {filtered.length === 0 ? (
              <div className="py-[48px] px-[20px] text-text-mute text-[13px] text-center">
                Nenhuma nota com os filtros atuais.<br />
                <Button variant="outline" size="sm" className="mt-[14px]" onClick={clearAll}>Limpar filtros</Button>
              </div>
            ) : filtered.map((n) => {
              const done = completed.has(n.id);
              const encaminhamento = encaminhamentos[n.id];
              const isDup = dupResolved.has(n.id);
              const isSel = selBatch.has(n.id);
              const flagDup = n.duplicates.length > 0 && !isDup;
              const dupIndicator = flagDup ? duplicateIndicator(n) : null;
              return (
                <div key={n.id} className={"q" + (n.id === selId ? " on" : "") + (done ? " dimdone" : "")}
                     onClick={() => setSelId(n.id)}>
                  <input type="checkbox" checked={isSel} onClick={(e) => e.stopPropagation()}
                         onChange={() => toggleBatch(n.id)}
                         className="shrink-0 w-[16px] h-[16px] [accent-color:var(--accent)] cursor-pointer" />
                  <PriorityChip p={n.prioridade} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-[8px]">
                      <span className="font-mono text-[13px] font-semibold">{n.id}</span>
                      {dupIndicator && <span className="inline-flex items-center gap-[3px]" title={dupIndicator.label}>
                        <span role="img" aria-label={dupIndicator.label} className={`${dupIndicator.className} text-[13px]`}>{dupIndicator.symbol}</span>
                        <span className="font-mono text-[10px] text-text-mute">{dupIndicator.coverage}% cob.</span>
                      </span>}
                      <span className="text-[11px] text-text-mute">· {n.uf}/{n.setor}</span>
                    </div>
                    <div className="text-[12px] text-text-dim whitespace-nowrap overflow-hidden text-ellipsis">{n.tipo_nota}</div>
                    {n.gerador && (
                      <div className="text-[11px] text-text-mute whitespace-nowrap overflow-hidden text-ellipsis">
                        Gerada por {n.gerador.nome}
                        {n.gerador.uf && ` · ${n.gerador.uf}`}
                        {n.gerador.cadastrado === false && n.gerador.matricula && " (matrícula não cadastrada)"}
                      </div>
                    )}
                  </div>
                  {flagDup && !isDup && (
                    <button title="Enviar candidatas para a fila COFFEE" aria-label="Enviar candidatas para a fila COFFEE"
                            className="text-amber shrink-0 py-[2px] px-[4px] cursor-pointer leading-none inline-flex"
                            onClick={(e) => { e.stopPropagation(); onSendToCoffee(n.duplicates.map((d) => d.id), n.id); }}>
                      <Coffee size={14} />
                    </button>
                  )}
                  {isDup ? <Badge variant="tagDup"><span className="w-[6px] h-[6px] rounded-full bg-current" />Dup.</Badge>
                    : encaminhamento ? <StatusTag status={n.status} done={done} encaminhamento={encaminhamento} />
                    : n.errors.length ? <span className="font-mono text-[11px] text-red font-semibold shrink-0">
                        {n.errors.length} {n.errors.length > 1 ? "falhas" : "falha"}</span>
                    : <Badge variant="tagOk"><span className="w-[6px] h-[6px] rounded-full bg-current" />OK</Badge>}
                </div>
              );
            })}
          </div>

          {selBatch.size > 0 && (() => {
            const ids = [...selBatch];
            const allDone = ids.every((id) => completed.has(id));
            const allOpen = ids.every((id) => !completed.has(id));
            const encaminhaveis = idsEncaminhaveisEmLote(ids, notes, completed);
            const pendentes = ids.filter((id) => !completed.has(id));
            const bloqueadas = pendentes.length - encaminhaveis.length;
            const doAction = (action: "done" | "reopen"): void => {
              if (action === "done") {
                if (encaminhaveis.length === 0) return;
                onMarkMany(encaminhaveis, action);
                const encaminhadas = new Set(encaminhaveis);
                setSelBatch(new Set(ids.filter((id) => !encaminhadas.has(id))));
                return;
              }
              onMarkMany(ids, action);
              setSelBatch(new Set());
            };
            return (
              <div className="shrink-0 flex items-center gap-[10px] py-[10px] px-[15px] bg-bg-2 flex-wrap border-t-[1px] border-t-line-2">
                <span className="text-[13px] text-text-dim mr-[2px]">
                  <strong className="text-[15px] text-[var(--accent)] [font-family:var(--font-display)]">{selBatch.size}</strong> selec.</span>
                {bloqueadas > 0 && (
                  <span className="font-mono text-[11px] text-amber">
                    {bloqueadas} {bloqueadas === 1 ? "exige" : "exigem"} correção de local
                  </span>
                )}
                {!allDone && (
                  <Button size="sm" disabled={encaminhaveis.length === 0} onClick={() => doAction("done")}>
                    <Check /> {bloqueadas > 0
                      ? `Encaminhar elegíveis (${encaminhaveis.length})`
                      : allOpen ? "Encaminhar" : "Encaminhar pendentes"}
                  </Button>
                )}
                {!allOpen && (
                  <Button variant="ghost" size="sm" onClick={() => doAction("reopen")}>
                    ↺ {allDone ? "Retirar da correção" : "Retirar selecionadas"}
                  </Button>
                )}
                <Button size="sm" onClick={() => { toast("Abrindo no COFFEE…"); EDPApi.openCoffee(ids); }}>
                  <Coffee /> COFFEE
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelBatch(new Set())}>Limpar</Button>
              </div>
            );
          })()}
          </React.Fragment>)}
        </div>

        <Detail sel={sel} done={!!sel && completed.has(sel.id)} dup={!!sel && dupResolved.has(sel.id)}
                encaminhamento={sel ? encaminhamentos[sel.id] : undefined}
                onToggleDone={onToggleComplete} onMarkDuplicate={onMarkDuplicate} onSendToCoffee={onSendToCoffee} />
      </div>

      {showKpis && (
        <KpiDrawer pct={pct} cTotal={cTotal} cOk={cOk} cErr={cErr} cDup={cDup}
                   cEncaminhadas={cEncaminhadas} cFalhasOperacionais={cFalhasOperacionais}
                   cRetornadas={cRetornadas}
                   cVisible={filtered.length} encaminhadasHoje={encaminhadasHoje}
                   selectedNotes={notes.filter((n) => selBatch.has(n.id))}
                   onRemoveSelected={(id) => toggleBatch(id)} />
      )}
    </React.Fragment>
  );
}

interface DetailProps {
  sel: Note | undefined;
  done: boolean;
  dup: boolean;
  encaminhamento?: TriageForwarding;
  onToggleDone: (id: string) => void;
  onMarkDuplicate: (id: string, justificativa?: string) => void;
  onSendToCoffee: (ids: string[], sourceId?: string) => void;
}

function Detail({ sel, done, dup, encaminhamento, onToggleDone, onMarkDuplicate, onSendToCoffee }: DetailProps): React.JSX.Element {
  const [fs, setFs] = React.useState(false);
  React.useEffect(() => {
    if (!fs) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setFs(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fs]);
  // Owner único da consulta COFFEE do detalhe: NotaFichaCompleta e
  // LocalInstalacaoCorrection recebem o mesmo resultado por prop, em vez de
  // cada uma observar a query por conta própria.
  const consulta = useConsultaCoffee(sel?.id ?? "");
  if (!sel) return <div className="bg-bg-2" />;
  const v = (x: string | number | null | undefined, fb = "—"): string => {
    const s = x == null ? "" : String(x);
    return s === "" || s === "-" ? fb : s;
  };
  const coffee = consulta.data;
  const fields: Array<{ label: string; value: string; wide?: boolean }> = [
    { label: "Tipo de nota", value: v(sel.tipo_nota) },
    { label: "Referência", value: v(sel.referencia) },
    { label: "Problema", value: v(sel.problema || sel.descricao), wide: true },
    { label: "Observação", value: v(sel.observacao ?? coffee?.observacao), wide: true },
    { label: "Referência física", value: v(sel.raw.referencia_fisica || coffee?.referencia_fisica) },
    { label: "Referência elétrica", value: v(coffee?.referencia_eletrica) },
    { label: "Local instal.", value: v(sel.local_instalacao) },
    { label: "Poste", value: v(sel.poste) },
    { label: "Alimentador", value: v(sel.raw.alimentador || coffee?.alimentador) },
    { label: "ID SAP", value: v(sel.id_sap || (coffee?.id_sap != null ? String(coffee.id_sap) : undefined)) },
    { label: "Gerada por", wide: true, value: sel.gerador
      ? sel.gerador.matricula
        ? `${sel.gerador.nome} · ${sel.gerador.matricula}${sel.gerador.cadastrado === false ? " (não cadastrado)" : ""}`
        : sel.gerador.nome
      : v(sel.colaborador) },
    { label: "Estado", value: v(sel.uf) }, { label: "Setor", value: v(sel.setor) },
    { label: "Imagens", value: v(sel.imagens_recebidas) + " / " + v(sel.imagens_totais) },
    { label: "Latitude", value: v(sel.latitude) }, { label: "Longitude", value: v(sel.longitude) },
  ];
  const otherErrors = sel.errors.filter((e) => e.rule !== "chk_duplicata");
  const hasLocalError = notaRequerCorrecaoLocal(sel);
  const hasDup = sel.duplicates.length > 0;
  return (
    <div className={"flex flex-col overflow-hidden bg-bg-2" + (fs ? " fixed inset-0 z-[60]" : "")}>
      <div className="py-[15px] px-[24px] bg-surface flex items-start justify-between gap-[16px] shrink-0 border-b-[1px] border-b-line">
        <div>
          <div className="flex items-center gap-[10px]">
            {/* ponytail: sem `text-balance` — o `whitespace-nowrap` do call site já vencia a classe legada. */}
            <h2 className="text-lg font-semibold leading-[1.15] tracking-display whitespace-nowrap m-0">Nota {sel.id}</h2>
            <PriorityChip p={sel.prioridade} />
            <StatusTag status={sel.status} done={done} dup={dup} encaminhamento={encaminhamento} />
          </div>
          <div className="font-mono text-[12px] text-text-mute mt-[5px]">
            {sel.tipo_nota} · {sel.referencia} · {sel.uf}/{sel.setor}</div>
        </div>
        <div className="flex gap-[8px] shrink-0">
          <Button size="sm" onClick={() => { toast("Abrindo no COFFEE…"); EDPApi.openCoffee(sel.id); }}>
            <Coffee /> COFFEE
          </Button>
          <Button variant="outline" size="icon-sm" title={fs ? "Sair da tela cheia" : "Expandir"}
                  aria-label={fs ? "Sair da tela cheia" : "Expandir"} onClick={() => setFs((v) => !v)}>
            {fs ? <Minimize2 /> : <Maximize2 />}
          </Button>
          {(!hasLocalError || done) && (
            <Button variant={done ? "outline" : "default"} size="sm" onClick={() => onToggleDone(sel.id)}>
              {done ? <><RotateCcw /> Retirar do COFFEE</> : <><Check /> Encaminhar</>}
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto flex flex-col gap-[22px] p-[24px]">
        {hasDup && <DuplicateCompare note={sel} resolved={dup} onMarkDuplicate={onMarkDuplicate} onSendToCoffee={onSendToCoffee} />}

        {encaminhamento?.situacao === "retornada" && (
          <section className="bg-[var(--accent-tint)] rounded-app-sm py-[12px] px-[14px]" style={{ borderLeft: "3px solid var(--accent)" }}>
            <Eyebrow asChild><div className="text-[var(--accent)] mb-[4px]">Retorno da Operação</div></Eyebrow>
            <div className="text-[14px] text-text font-medium">{encaminhamento.retorno_justificativa}</div>
            {encaminhamento.retornada_por && (
              <div className="font-mono text-[11px] text-text-dim mt-[5px]">
                Registrado por {encaminhamento.retornada_por}
              </div>
            )}
          </section>
        )}

        <section>
          <Eyebrow asChild><div className="mb-[11px]">Identificação & localização</div></Eyebrow>
          <div className="gap-[1px] rounded-app-sm overflow-hidden border border-line grid [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] bg-line">
            {fields.map((f) => (
              <div key={f.label} className="kv" style={f.wide ? { gridColumn: "span 2" } : undefined}>
                <small>{f.label}</small>
                <div className="font-mono text-[12.5px] break-words [overflow-wrap:anywhere]">{f.value}</div>
              </div>
            ))}
          </div>
          {sel.latitude && sel.longitude && (
            <Button asChild variant="outline" size="sm" className="text-blue mt-[12px]" style={{ borderColor: "var(--status-blue-border)" }}>
              <a target="_blank" rel="noopener" href={EDPApi.mapsUrl(sel.latitude, sel.longitude)}><MapPin /> Abrir no Google Maps</a>
            </Button>
          )}
        </section>

        {hasLocalError && (
          <LocalInstalacaoCorrection
            noteId={sel.id}
            localTriagem={sel.local_instalacao}
            encaminhada={done}
            consulta={consulta}
            onEncaminhar={() => onToggleDone(sel.id)}
          />
        )}

        <section>
          <Eyebrow asChild><div className="mb-[11px]">
            {otherErrors.length ? `⚠ Falhas encontradas (${otherErrors.length})`
              : hasDup ? "Outras falhas" : "Status"}</div></Eyebrow>
          {otherErrors.length ? (
            <div className="flex flex-col gap-[8px]">
              {otherErrors.map((e) => (
                <div key={e.rule} className="bg-tint-red rounded-app-sm py-[11px] px-[14px]" style={{ border: "1px solid var(--status-red-border)", borderLeft: "3px solid var(--red)" }}>
                  <div className="font-mono text-[10.5px] text-red tracking-[.08em]">{e.rule}</div>
                  <div className="text-[14px] font-semibold mt-[2px]">{e.rule_name}</div>
                  <div className="text-[12.5px] text-text-dim mt-[2px]">Valor: {e.value}</div>
                </div>
              ))}
            </div>
          ) : !hasDup ? <Badge variant="tagOk"><span className="w-[6px] h-[6px] rounded-full bg-current" />Conforme — nenhuma falha encontrada</Badge>
            : <div className="text-[12.5px] text-text-dim">Sem outras falhas além da duplicata.</div>}
        </section>

        <NotaFichaCompleta noteId={sel.id} consulta={consulta} />
      </div>
    </div>
  );
}
