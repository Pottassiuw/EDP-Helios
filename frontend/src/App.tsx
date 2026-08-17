import React from 'react';
import { normalizeCoffeeSubPage, normalizeRelatoriosPage } from './types';
import type {
  AppSection,
  CarteiraSubPage,
  CoffeeConclusaoFiltro,
  CoffeeSubPage,
  Note,
  RelatoriosPage,
  Source,
} from './types';
import type { AbaInput } from './features/input/types';
import type { FiltersState } from './features/input/filters';
import { filtroPorMes, filtroPorPlano, type Filtro } from './features/input/lib';
import type { TriageHandoff } from './features/coffee/coffee-verificar';
import { usePersistedState } from './hooks/use-persisted-state';
import { SettingsProvider, useSettings } from './context/settings-context';
import { EDPApi } from './api';
import { AppSidebar } from './components/app-sidebar';
import { useTriageData } from './features/verificar/useTriageData';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { toast, Toaster } from 'sonner';

const InputSection = React.lazy(() =>
  import('./features/input/input-section').then((m) => ({ default: m.InputSection })));
const CoffeeHub = React.lazy(() =>
  import('./features/coffee/coffee-hub').then((m) => ({ default: m.CoffeeHub })));
const ConfiguracoesPage = React.lazy(() =>
  import('./features/configuracoes/configuracoes').then((m) => ({ default: m.ConfiguracoesPage })));
const RelatoriosSection = React.lazy(() =>
  import('./features/relatorios/relatorios-section').then((m) => ({ default: m.RelatoriosSection })));
const CarteiraSection = React.lazy(() =>
  import('./features/carteira/carteira-section').then((m) => ({ default: m.CarteiraSection })));

type CssVars = React.CSSProperties & Record<`--${string}`, string>;

const NUMERIC_ID_RE = /^\d{5,12}$/;

function SectionLoading(): React.JSX.Element {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--text-mute)", fontFamily: "var(--font-mono)", fontSize: 13 }}>
      Carregando…
    </div>
  );
}

function AppContent(): React.JSX.Element {
  const { settings, resolvedTheme } = useSettings();
  const [notes, setNotes] = React.useState<Note[]>([]);
  const [completed, setCompleted] = React.useState<Set<string>>(new Set());
  const [dupResolved, setDupResolved] = React.useState<Set<string>>(new Set());
  const source: Source = "api";
  const [section, setSection] = usePersistedState<AppSection>("edp_active_section", "relatorios");
  const [storedRelatoriosPage, setStoredRelatoriosPage] =
    usePersistedState<string>("edp_relatorios_page", "dashboard");
  const relatoriosPage = normalizeRelatoriosPage(storedRelatoriosPage);
  const setRelatoriosPage = React.useCallback(
    (page: RelatoriosPage): void => setStoredRelatoriosPage(page),
    [setStoredRelatoriosPage],
  );
  const [coffeeReturn, setCoffeeReturn] = React.useState<{ noteId: string; noteRef: string } | null>(null);
  const [storedCoffeeSub, setStoredCoffeeSub] =
    usePersistedState<string>("edp_coffee_sub", "verificar");
  const coffeeSub = normalizeCoffeeSubPage(storedCoffeeSub);
  const setCoffeeSub = React.useCallback(
    (sub: CoffeeSubPage): void => setStoredCoffeeSub(sub),
    [setStoredCoffeeSub],
  );
  const [coffeeConcluidasHandoff, setCoffeeConcluidasHandoff] =
    React.useState<{ filtro: CoffeeConclusaoFiltro; id: number } | null>(null);
  const [inputSub, setInputSub] = usePersistedState<AbaInput>("edp_input_sub", "visao");
  const [carteiraSub, setCarteiraSub] = usePersistedState<CarteiraSubPage>("edp_carteira_sub", "dashboard");
  const [filtrosHandoff, setFiltrosHandoff] =
    React.useState<{ estado: FiltersState; id: number } | null>(null);

  function irParaInputFiltrado(filtros: Filtro[]): void {
    setFiltrosHandoff((prev) => ({
      estado: { busca: "", filtros, somente2026: true, somenteNotasMaes: false },
      id: (prev?.id ?? 0) + 1,
    }));
    setInputSub("visao");
    changeSection("input");
  }

  const accentStyle: CssVars = {
    "--accent": settings.accent[0],
    "--accent-2": settings.accent[1],
    "--accent-tint": settings.accent[2],
  };

  React.useEffect(() => {
    if (storedCoffeeSub !== coffeeSub) setStoredCoffeeSub(coffeeSub);
  }, [coffeeSub, setStoredCoffeeSub, storedCoffeeSub]);

  React.useEffect(() => {
    if (storedRelatoriosPage !== relatoriosPage) setStoredRelatoriosPage(relatoriosPage);
  }, [relatoriosPage, setStoredRelatoriosPage, storedRelatoriosPage]);

  function changeSection(s: AppSection): void {
    if (s !== "coffee") setCoffeeReturn(null);
    setSection(s);
  }

  function irParaSincronizacaoCarteira(): void {
    setCarteiraSub("sincronizacao");
    changeSection("carteira");
  }

  const triagemQuery = useTriageData();

  React.useEffect(() => {
    if (!triagemQuery.data) return;
    setNotes(triagemQuery.data.notes);
    setCompleted(triagemQuery.data.completed);
  }, [triagemQuery.data]);

  const atualizarTriagem = React.useCallback((): void => {
    const idsAnteriores = new Set(notes.map((note) => note.id));
    const atualizacao = triagemQuery.refetch({ throwOnError: true });
    toast.promise(atualizacao, {
      loading: 'Atualizando Verificar.db…',
      success: (resultado) => {
        const notasAtuais = resultado.data?.notes ?? [];
        const idsAtuais = new Set(notasAtuais.map((note) => note.id));
        const novas = notasAtuais.filter((note) => !idsAnteriores.has(note.id)).length;
        const removidas = notes.filter((note) => !idsAtuais.has(note.id)).length;
        if (novas > 0) {
          const saida = removidas > 0
            ? ` ${removidas} ${removidas === 1 ? 'saiu' : 'saíram'} da triagem.`
            : '';
          return `Atualização concluída: ${novas} nova${novas === 1 ? '' : 's'} nota${novas === 1 ? '' : 's'}.${saida}`;
        }
        if (removidas > 0) {
          return `Atualização concluída: ${removidas} nota${removidas === 1 ? '' : 's'} ${removidas === 1 ? 'saiu' : 'saíram'} da triagem.`;
        }
        return 'Atualização concluída: nenhuma nota nova.';
      },
      error: (error: unknown) => (
        `Falha ao atualizar: ${error instanceof Error ? error.message : String(error)}`
      ),
    });
  }, [notes, triagemQuery]);

  function toggleComplete(id: string): void {
    const reopening = completed.has(id);
    const concluding = !reopening;
    setCompleted((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
    if (reopening) setDupResolved((prev) => { const s = new Set(prev); s.delete(id); return s; });

    const numeric = NUMERIC_ID_RE.test(id);
    if (numeric) {
      EDPApi.marcarGerar(id, concluding, concluding ? undefined : "Nota retirada da correção na Verificar")
        .then(() => triagemQuery.refetch())
        .catch((error: unknown) => {
          setCompleted((current) => {
            const next = new Set(current);
            if (concluding) next.delete(id);
            else next.add(id);
            return next;
          });
          toast.error(
            concluding ? "Falha ao encaminhar para correção" : "Falha ao retirar da correção",
            { description: error instanceof Error ? error.message : String(error) },
          );
        });
    }
    toast.success(
      concluding ? `Nota ${id} encaminhada para correção` : `Nota ${id} reaberta`,
    );
  }

  async function markMany(ids: string[], action: "done" | "reopen"): Promise<void> {
    const marking = action === "done";
    const targets = ids.filter((id) => completed.has(id) !== marking);
    if (targets.length === 0) return;

    setCompleted((prev) => {
      const next = new Set(prev);
      targets.forEach((id) => { if (marking) next.add(id); else next.delete(id); });
      return next;
    });
    const numericTargets = targets.filter((id) => NUMERIC_ID_RE.test(id));
    const resultados = await Promise.allSettled(numericTargets.map((id) => EDPApi.marcarGerar(
      id,
      marking,
      marking ? undefined : "Nota retirada da correção na Verificar",
    )));
    const falhas = resultados.filter((resultado) => resultado.status === "rejected");
    if (falhas.length > 0) {
      await triagemQuery.refetch();
      toast.error(
        `${falhas.length} nota${falhas.length === 1 ? " não foi" : "s não foram"} ${marking ? "encaminhada" : "reaberta"}${falhas.length === 1 ? "" : "s"}.`,
      );
      return;
    }
    if (numericTargets.length > 0) await triagemQuery.refetch();
    toast.success(
      `${targets.length} nota${targets.length === 1 ? "" : "s"} ${marking ? "encaminhada" : "reaberta"}${targets.length === 1 ? "" : "s"}.`,
    );
  }

  function sendToCoffeeQueue(ids: string[], sourceId?: string): void {
    const existing = JSON.parse(localStorage.getItem("edp_coffee_ids") ?? "[]") as string[];
    const valid = ids.filter((id) => NUMERIC_ID_RE.test(id));
    const merged = [...new Set([...existing, ...valid])];
    localStorage.setItem("edp_coffee_ids", JSON.stringify(merged));
    if (sourceId) {
      const src = notes.find((n) => n.id === sourceId);
      setCoffeeReturn(src ? { noteId: src.id, noteRef: src.referencia } : null);
    }
    setCoffeeSub("abrir");
    setSection("coffee");
    if (valid.length > 0) toast.success(`${valid.length} nota(s) enviada(s) para a fila do COFFEE`);
  }

  function markDuplicate(id: string, justificativa?: string): void {
    const undo = dupResolved.has(id);
    setDupResolved((prev) => { const s = new Set(prev); if (undo) s.delete(id); else s.add(id); return s; });
    setCompleted((prev) => { const s = new Set(prev); if (undo) s.delete(id); else s.add(id); return s; });
    if (source === "api") {
      if (undo) EDPApi.desfazerDuplicata(id).catch((e) => toast.error("Falha ao desfazer duplicata", { description: e instanceof Error ? e.message : String(e) }));
      else EDPApi.markDuplicate(id, justificativa).catch((e) => toast.error("Falha ao marcar duplicata", { description: e instanceof Error ? e.message : String(e) }));
    }
    toast.success(undo ? "Duplicata desfeita" : "Nota marcada como duplicata");
  }

  const triage: TriageHandoff = {
    resolvedTheme,
    showKpis: settings.showKpis,
    notes, completed, dupResolved, source,
    fonte: triagemQuery.data?.fonte ?? null,
    encaminhamentos: triagemQuery.data?.encaminhamentos ?? {},
    encaminhadasHoje: triagemQuery.data?.encaminhadasHoje ?? [],
    isLoading: triagemQuery.isLoading,
    isRefreshing: triagemQuery.isFetching,
    error: triagemQuery.error,
    onRetry: atualizarTriagem,
    onToggleComplete: toggleComplete,
    onMarkMany: markMany,
    onMarkDuplicate: markDuplicate,
    onSendToCoffee: sendToCoffeeQueue,
  };

  return (
    <div className="triage" data-theme={resolvedTheme} data-density={settings.density}
         style={{ height: "100vh", overflow: "hidden", background: "var(--bg)", ...accentStyle } as CssVars}>
      <SidebarProvider style={{ height: "100%", minHeight: 0 }}>
        <AppSidebar section={section} setSection={changeSection}
                    relatoriosPage={relatoriosPage} setRelatoriosPage={setRelatoriosPage}
                    coffeeSub={coffeeSub} setCoffeeSub={setCoffeeSub}
                    inputSub={inputSub} setInputSub={setInputSub}
                    carteiraSub={carteiraSub} setCarteiraSub={setCarteiraSub} />
        <SidebarInset style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
          <React.Suspense fallback={<SectionLoading />}>
            {section === "relatorios" ? (
              <RelatoriosSection
                page={relatoriosPage}
                setPage={setRelatoriosPage}
                onVerNotasDoMes={(mes, ano) => irParaInputFiltrado([filtroPorMes(mes, ano)])}
                onVerPlano={(plano, regional) => irParaInputFiltrado(filtroPorPlano(plano, regional))}
                onIrParaCoffee={() => {
                  setCoffeeConcluidasHandoff((prev) => ({
                    filtro: "corrigida",
                    id: (prev?.id ?? 0) + 1,
                  }));
                  setCoffeeSub("concluidas");
                  changeSection("coffee");
                }}
              />
            ) : section === "input" ? (
              <InputSection
                sub={inputSub}
                setSub={setInputSub}
                filtrosHandoff={filtrosHandoff}
                onIrParaSincronizacao={irParaSincronizacaoCarteira}
              />
            ) : section === "carteira" ? (
              <CarteiraSection sub={carteiraSub} setSub={setCarteiraSub} />
            ) : section === "configuracoes" ? <ConfiguracoesPage /> :
             <CoffeeHub notes={notes}
                        sub={coffeeSub} setSub={setCoffeeSub}
                        triage={triage}
                        coffeeReturn={coffeeReturn}
                        concluidasHandoff={coffeeConcluidasHandoff}
                        onIrParaInput={() => {
                          setInputSub("visao");
                          changeSection("input");
                        }}
                        onIrParaSincronizacao={irParaSincronizacaoCarteira}
                        onClearReturn={() => setCoffeeReturn(null)}
                        onBackToTriagem={() => { setCoffeeSub("verificar"); }} />}
          </React.Suspense>
        </SidebarInset>
      </SidebarProvider>
      <Toaster theme={resolvedTheme} position="bottom-right" richColors closeButton />
    </div>
  );
}

export default function App(): React.JSX.Element {
  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}
