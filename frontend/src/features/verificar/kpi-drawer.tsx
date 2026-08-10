import React from 'react';
import { Eyebrow } from '@/components/branded/section';
import { Progress } from '@/components/ui/progress';
import type { KpiDrawerProps } from '../../types';

export function KpiDrawer(props: KpiDrawerProps): React.JSX.Element {
  const {
    pct,
    cTotal,
    cOk,
    cErr,
    cDup,
    cEncaminhadas,
    cFalhasOperacionais,
    cRetornadas,
    cVisible,
    encaminhadasHoje,
    selectedNotes = [],
    onRemoveSelected,
  } = props;
  const [open, setOpen] = React.useState(false);

  const safePct = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;

  const fabRef = React.useRef<HTMLButtonElement>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const mountedRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      closeRef.current?.focus();
    } else if (mountedRef.current) {
      fabRef.current?.focus();
    }
    mountedRef.current = true;
  }, [open]);

  const encaminhadasHojeTotal = encaminhadasHoje.reduce((total, item) => total + item.total, 0);
  const rows: Array<[string, number, "red" | "indigo" | "blue" | "green" | "accent"]> = [
    ["Falhas de validação", cErr, "red"], ["Duplicatas", cDup, "indigo"],
    ["Encaminhadas", cEncaminhadas, "green"], ["Falha operacional", cFalhasOperacionais, "red"],
    ["Retornadas pela Operação", cRetornadas, "accent"],
    ["Visíveis (filtro atual)", cVisible, "blue"],
  ];

  return (
    <React.Fragment>
      <style>{`@keyframes kpi-slide-in{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
      {!open && (
        <button ref={fabRef} onClick={() => setOpen(true)} title="Indicadores" aria-label="Abrir indicadores"
                className="flex items-center gap-[8px] py-[10px] px-[16px] text-[14px] fixed right-[18px] bottom-[18px] z-[40]
                         border-0 rounded-[999px] cursor-pointer
                         bg-[var(--accent)] text-primary-foreground [font-family:var(--font-display)]
                         font-extrabold"
                style={{ boxShadow: "var(--shadow-floating)" }}>
          <span className="text-[15px] leading-none">⊞</span>{safePct}%
        </button>
      )}
      {open && (
        <React.Fragment>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-[41]" />
          <aside role="dialog" aria-modal="true" aria-label="Indicadores"
                 className="bg-surface flex flex-col py-[16px] px-[18px] gap-[12px] fixed top-0 right-0 bottom-0 w-[320px] z-[42]
                          border-l-[2px] border-l-[var(--accent)]
                          [animation:kpi-slide-in_.2s_ease-out]
                          overflow-y-auto"
                 style={{ boxShadow: "var(--shadow-drawer)" }}>
            <div className="flex items-center justify-between">
              <Eyebrow>Indicadores</Eyebrow>
              <button ref={closeRef} onClick={() => setOpen(false)} title="Fechar" aria-label="Fechar indicadores"
                      className="text-[18px] text-text-mute py-[2px] px-[6px] cursor-pointer leading-none">×</button>
            </div>
            <div className="bg-surface-2 rounded-app-sm py-[12px] px-[14px]">
              <Eyebrow asChild><div>Conformidade</div></Eyebrow>
              <div className="text-[30px] [font-family:var(--font-display)] font-extrabold leading-[1.2] text-[var(--accent)]">{safePct}%</div>
              <Progress
                value={safePct}
                className="bg-surface-3 h-[6px] rounded-[999px] mt-[8px] mx-0 mb-[6px]"
                indicatorClassName="bg-[var(--accent)] rounded-[999px]"
              />
              <span className="font-mono text-[12px] text-text-dim">{cOk}/{cTotal} prontas para o SAP</span>
            </div>
            {rows.map(([lbl, val, c]) => (
              <div key={lbl} className="flex items-center justify-between bg-surface-2 rounded-app-sm py-[10px] px-[14px]">
                <Eyebrow>{lbl}</Eyebrow>
                <span className="text-[18px] [font-family:var(--font-display)] font-extrabold leading-none" style={{ color: "var(--" + c + ")" }}>{val}</span>
              </div>
            ))}
            <div className="bg-surface-2 rounded-app-sm py-[10px] px-[14px]">
              <Eyebrow asChild><div>Encaminhadas hoje</div></Eyebrow>
              <div className="flex items-baseline justify-between mt-[4px]">
                <span className="text-[18px] [font-family:var(--font-display)] font-extrabold leading-none text-green">
                  {encaminhadasHojeTotal}
                </span>
                <span className="font-mono text-[10px] text-text-mute">todos os usuários</span>
              </div>
              {encaminhadasHoje.length > 0 && (
                <div className="flex flex-col gap-[4px] mt-[9px] pt-[8px] border-t border-line">
                  {encaminhadasHoje.map((item) => (
                    <div key={item.usuario} className="flex items-center justify-between gap-[8px] text-[12px]">
                      <span className="text-text-dim truncate">{item.usuario}</span>
                      <span className="font-mono text-text font-semibold">{item.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {selectedNotes.length > 0 && (
              <div className="bg-surface-2 rounded-app-sm py-[10px] px-[14px]">
                <Eyebrow asChild><div className="mb-[8px]">
                  Notas Selecionadas · {selectedNotes.length}</div></Eyebrow>
                <div className="flex flex-col gap-[6px] overflow-auto max-h-[220px]">
                  {selectedNotes.map((n) => (
                    <div key={n.id} className="flex items-center gap-[8px]">
                      <span className="font-mono text-[12px] font-semibold">{n.id}</span>
                      <span className="flex-1 min-w-0 text-[11px] text-text-mute overflow-hidden text-ellipsis whitespace-nowrap">
                        {n.tipo_nota} · {n.uf}/{n.setor}</span>
                      {onRemoveSelected && (
                        <span role="button" aria-label={"Remover " + n.id} onClick={() => onRemoveSelected(n.id)}
                              className="text-text-mute text-[14px] py-[0px] px-[4px] cursor-pointer leading-none">×</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </React.Fragment>
      )}
    </React.Fragment>
  );
}
