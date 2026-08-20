import React from "react";
import { PanelRightOpen } from "lucide-react";
import {
  DataSheetGrid,
  keyColumn,
  type CellProps,
  type Column,
  type SimpleColumn,
} from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import "./data-grid.css";
import { Button } from "@/components/ui/button";
import type { Celula, NotaInput } from "./types";
import type { ColunaDef } from "./columns";
import { calcularSelecao, compararDatas, formatarNumero, type ResumoSelecao, type SelecaoRetangulo } from "./lib";

const ALTURA_LINHA = 32;
const LARGURA_PADRAO = 120;
const LARGURA_MIN = 60;
const LARGURA_MAX = 600;

type Ordem = { campo: string; asc: boolean };

interface DetalhesColumnData {
  onOpenDetails: (nota: NotaInput, trigger: HTMLButtonElement) => void;
}

function CelulaDetalhes({
  rowData,
  columnData,
}: CellProps<NotaInput, DetalhesColumnData>): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-11"
        aria-label={`Abrir detalhes da nota ${rowData.Numero_Nota}`}
        title="Abrir detalhes"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          columnData.onOpenDetails(rowData, event.currentTarget);
        }}
        onClick={(event) => {
          event.stopPropagation();
          columnData.onOpenDetails(rowData, event.currentTarget);
        }}
      >
        <PanelRightOpen />
      </Button>
    </div>
  );
}

function textoCelula(v: Celula | undefined, c: ColunaDef): string {
  if (c.key === "Nota_Mae") {
    const s = String(v ?? "").trim();
    if (!s || s === "-" || s === "." || s === "0" || s === "0.0" || s.toLowerCase() === "none" || s.toLowerCase() === "nan") {
      return "-";
    }
    return s.endsWith(".0") ? s.slice(0, -2) : s;
  }
  if (!c.numeric) return String(v ?? "");
  return c.key === "Numero_Nota" || c.key === "ranking"
    ? formatarNumero(v ?? null, 0, false)
    : formatarNumero(v ?? null, 2);
}

// Medição de texto via canvas (autofit), reaproveitando um contexto único.
let _ctxMedida: CanvasRenderingContext2D | null = null;
function medirTexto(texto: string, fonte: string): number {
  if (!_ctxMedida) _ctxMedida = document.createElement("canvas").getContext("2d");
  if (!_ctxMedida) return texto.length * 7;
  _ctxMedida.font = fonte;
  return _ctxMedida.measureText(texto).width;
}

/** Largura que comporta cabeçalho + todos os valores da coluna (estilo Excel). */
function larguraAutofit(c: ColunaDef, registros: NotaInput[]): number {
  const fonteCelula = `12.5px ${c.numeric ? "'IBM Plex Mono', monospace" : "Inter, system-ui, sans-serif"}`;
  const fonteHeader = "500 10px 'IBM Plex Mono', monospace";
  let max = medirTexto(c.label, fonteHeader);
  for (const r of registros) max = Math.max(max, medirTexto(textoCelula(r[c.key], c), fonteCelula));
  return Math.min(LARGURA_MAX, Math.max(LARGURA_MIN, Math.ceil(max) + 28)); // 28 = padding célula + alça + seta
}

/** Célula só-leitura: exibe o valor formatado conforme a ColunaDef. */
function CelulaLeitura({ rowData, columnData }: {
  rowData: Celula | undefined;
  columnData: ColunaDef;
}): React.JSX.Element {
  const texto = textoCelula(rowData, columnData);
  return (
    <div className={"dsg-leitura" + (columnData.numeric ? " is-num" : "")} title={texto}>
      {texto}
    </div>
  );
}

function ordenar(registros: NotaInput[], ordem: Ordem | null): NotaInput[] {
  if (!ordem) return registros;
  const fator = ordem.asc ? 1 : -1;
  const copia = [...registros];
  if (ordem.campo === "Mes_Execucao_Planejado") {
    copia.sort((a, b) => fator * compararDatas(a[ordem.campo] ?? null, b[ordem.campo] ?? null));
  } else {
    copia.sort((a, b) => {
      const va = a[ordem.campo];
      const vb = b[ordem.campo];
      const na = Number(va);
      const nb = Number(vb);
      if (Number.isFinite(na) && Number.isFinite(nb)) return fator * (na - nb);
      return fator * String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR");
    });
  }
  return copia;
}

/** Cabeçalho custom: ordenação (com seta) + alça de redimensionamento.
   O DSG só aplica largura na MONTAGEM (não reage a basis depois). Então durante
   o arrasto só movemos a linha-guia; ao soltar comitamos (remonta a grade).
   Duplo-clique na alça faz autofit (igual Excel). */
function CabecalhoColuna({ c, ordem, onSort, onResizeDrag, onResizeCommit, onResizeCancel, onAutofit }: {
  c: ColunaDef;
  ordem: Ordem | null;
  onSort: (campo: string) => void;
  onResizeDrag: (clientX: number) => void;
  onResizeCommit: (key: string, largura: number) => void;
  onResizeCancel: () => void;
  onAutofit: (key: string) => void;
}): React.JSX.Element {
  const ativa = ordem?.campo === c.key;

  const iniciarResize = (e: React.PointerEvent<HTMLSpanElement>): void => {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    const headerEl = handle.closest(".dsg-cell-header") as HTMLElement | null;
    const startW = headerEl ? headerEl.getBoundingClientRect().width : LARGURA_PADRAO;
    const startX = e.clientX;
    let moveu = false;
    handle.setPointerCapture(e.pointerId);
    const mover = (ev: PointerEvent): void => { moveu = true; onResizeDrag(ev.clientX); };
    const soltar = (ev: PointerEvent): void => {
      handle.releasePointerCapture(e.pointerId);
      handle.removeEventListener("pointermove", mover);
      handle.removeEventListener("pointerup", soltar);
      if (moveu) onResizeCommit(c.key, Math.max(LARGURA_MIN, startW + (ev.clientX - startX)));
      else onResizeCancel();
    };
    handle.addEventListener("pointermove", mover);
    handle.addEventListener("pointerup", soltar);
  };

  return (
    <div className="dsg-th-wrap">
      <button type="button" className="dsg-th" onClick={() => onSort(c.key)} title="Ordenar">
        <span className="dsg-th-label">{c.label}</span>
        {ativa && <span className="dsg-th-arrow">{ordem!.asc ? "↑" : "↓"}</span>}
      </button>
      <span
        className="dsg-th-resize"
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onPointerDown={iniciarResize}
        onDoubleClick={(e) => { e.stopPropagation(); onAutofit(c.key); }}
        title="Arrastar para redimensionar · duplo-clique para ajustar"
      />
    </div>
  );
}

export interface DataGridProps {
  registros: NotaInput[];
  colunas: ColunaDef[];
  altura?: number;
  onOpenDetails?: (nota: NotaInput, trigger: HTMLButtonElement) => void;
}

export function DataGrid({
  registros,
  colunas,
  altura = 520,
  onOpenDetails,
}: DataGridProps): React.JSX.Element {
  const [ordem, setOrdem] = React.useState<Ordem | null>(null);
  const [larguras, setLarguras] = React.useState<Record<string, number>>({});
  const [guia, setGuia] = React.useState<number | null>(null);
  const [remontar, setRemontar] = React.useState(0);
  const [resumo, setResumo] = React.useState<ResumoSelecao | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const scrollRef = React.useRef<{ left: number; top: number } | null>(null);

  // Calcula a altura ideal do grid dinamicamente baseada nas linhas
  // para evitar que a barra de rolagem horizontal sobreponha as células se houverem poucos registros.
  const gridHeight = React.useMemo(() => {
    if (registros.length === 0) return 100;
    // 35px header + 32px por linha + 18px margem da scrollbar
    const calculada = registros.length * 32 + 35 + 18;
    return Math.max(160, Math.min(altura, calculada));
  }, [registros.length, altura]);

  const garantirSelecaoVisivel = React.useCallback(
    (selection: SelecaoRetangulo | null) => {
      if (!selection || !wrapRef.current) return;
      const cont = wrapRef.current.querySelector(".dsg-container") as HTMLElement | null;
      if (!cont) return;

      const gutterWidth = 70;
      const stickyRightWidth = onOpenDetails ? 44 : 0;
      const margemSeguranca = 20;

      // 1. Cálculo de colunas horizontais
      const colWidths = colunas.map((c) => larguras[c.key] ?? c.largura ?? LARGURA_PADRAO);

      const minCol = Math.max(0, Math.min(selection.min.col, colWidths.length - 1));
      const maxCol = Math.max(0, Math.min(selection.max.col, colWidths.length - 1));

      let selLeft = gutterWidth;
      for (let i = 0; i < minCol; i++) {
        selLeft += colWidths[i];
      }
      let selRight = selLeft;
      for (let i = minCol; i <= maxCol; i++) {
        selRight += colWidths[i];
      }

      const currentScrollLeft = cont.scrollLeft;
      const clientWidth = cont.clientWidth;
      const visibleLeft = currentScrollLeft + gutterWidth;
      const visibleRight = currentScrollLeft + clientWidth - stickyRightWidth;

      if (selRight > visibleRight - margemSeguranca) {
        cont.scrollLeft = Math.max(0, selRight - clientWidth + stickyRightWidth + margemSeguranca);
      } else if (selLeft < visibleLeft + margemSeguranca) {
        cont.scrollLeft = Math.max(0, selLeft - gutterWidth - margemSeguranca);
      }

      // 2. Cálculo de linhas verticais
      const selTop = selection.min.row * ALTURA_LINHA;
      const selBottom = (selection.max.row + 1) * ALTURA_LINHA;

      const currentScrollTop = cont.scrollTop;
      const clientHeight = cont.clientHeight;
      const headerHeight = 35;
      const scrollbarHeight = 18;
      const visibleTop = currentScrollTop;
      const visibleBottom = currentScrollTop + clientHeight - headerHeight - scrollbarHeight;

      if (selBottom > visibleBottom - margemSeguranca) {
        cont.scrollTop = Math.max(0, selBottom - clientHeight + headerHeight + scrollbarHeight + margemSeguranca);
      } else if (selTop < visibleTop + margemSeguranca) {
        cont.scrollTop = Math.max(0, selTop - margemSeguranca);
      }
    },
    [colunas, larguras, onOpenDetails],
  );

  const garantirColunaVisivel = React.useCallback(
    (key: string) => {
      const idx = colunas.findIndex((x) => x.key === key);
      if (idx !== -1) {
        garantirSelecaoVisivel({
          min: { col: idx, row: 0 },
          max: { col: idx, row: 0 },
        });
      }
    },
    [colunas, garantirSelecaoVisivel],
  );

  const alternar = React.useCallback(
    (campo: string) => {
      const cont = wrapRef.current?.querySelector(".dsg-container") as HTMLElement | null;
      scrollRef.current = cont ? { left: cont.scrollLeft, top: cont.scrollTop } : null;

      setOrdem((o) => {
        if (!o || o.campo !== campo) return { campo, asc: true };
        if (o.asc) return { campo, asc: false };
        return null;
      });
      setRemontar((n) => n + 1);
      garantirColunaVisivel(campo);
    },
    [garantirColunaVisivel],
  );

  const onResizeDrag = React.useCallback((clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    setGuia(rect ? clientX - rect.left : null);
  }, []);
  const onResizeCancel = React.useCallback(() => setGuia(null), []);

  // O DSG só lê basis na montagem → preserva o scroll e remonta com a nova largura.
  const aplicarLargura = React.useCallback((key: string, largura: number) => {
    const cont = wrapRef.current?.querySelector(".dsg-container") as HTMLElement | null;
    scrollRef.current = cont ? { left: cont.scrollLeft, top: cont.scrollTop } : null;
    setLarguras((prev) => ({ ...prev, [key]: largura }));
    setRemontar((n) => n + 1);
    setGuia(null);
  }, []);

  const onAutofit = React.useCallback((key: string) => {
    const c = colunas.find((x) => x.key === key);
    if (c) aplicarLargura(key, larguraAutofit(c, registros));
  }, [colunas, registros, aplicarLargura]);

  React.useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const cont = wrapRef.current?.querySelector(".dsg-container") as HTMLElement | null;
    if (cont) {
      cont.scrollLeft = scrollRef.current.left;
      cont.scrollTop = scrollRef.current.top;
    }
    scrollRef.current = null;
  }, [remontar]);

  const ordenados = React.useMemo(() => ordenar(registros, ordem), [registros, ordem]);

  const aoSelecionar = React.useCallback(
    (opts: { selection: SelecaoRetangulo | null }) => {
      setResumo(calcularSelecao(ordenados, colunas, opts.selection));
      garantirSelecaoVisivel(opts.selection);
    },
    [ordenados, colunas, garantirSelecaoVisivel],
  );

  const cols = React.useMemo(
    () => colunas.map((c): Column<NotaInput> => {
      const largura = larguras[c.key] ?? c.largura ?? LARGURA_PADRAO;
      return {
        ...keyColumn<NotaInput, string>(c.key, {
          component: CelulaLeitura as never,
          columnData: c as never,
          disabled: true,
          // ponytail: copia o valor cru (Excel calcula em cima); o display é formatado.
          copyValue: ({ rowData }) => (rowData == null ? "" : String(rowData)),
        }),
        title: (
          <CabecalhoColuna
            c={c}
            ordem={ordem}
            onSort={alternar}
            onResizeDrag={onResizeDrag}
            onResizeCommit={aplicarLargura}
            onResizeCancel={onResizeCancel}
            onAutofit={onAutofit}
          />
        ),
        basis: largura,
        grow: 0,
        shrink: 0,
        minWidth: LARGURA_MIN,
      };
    }),
    [colunas, larguras, ordem, alternar, onResizeDrag, aplicarLargura, onResizeCancel, onAutofit],
  );

  const detailsColumn = React.useMemo<
    SimpleColumn<NotaInput, DetalhesColumnData> | undefined
  >(() => (
    onOpenDetails
      ? {
        title: <span className="sr-only">Detalhes</span>,
        component: CelulaDetalhes,
        columnData: { onOpenDetails },
        basis: 44,
        minWidth: 44,
        maxWidth: 44,
        grow: 0,
        shrink: 0,
      }
      : undefined
  ), [onOpenDetails]);

  return (
    <div ref={wrapRef} className="dsg-wrap">
      <DataSheetGrid<NotaInput>
        key={remontar}
        value={ordenados}
        onChange={() => { /* read-only: todas as colunas disabled */ }}
        columns={cols}
        height={gridHeight}
        rowHeight={ALTURA_LINHA}
        lockRows
        disableContextMenu
        onSelectionChange={aoSelecionar}
        gutterColumn={{ basis: 70, grow: 0 }}
        stickyRightColumn={detailsColumn}
      />
      {guia !== null && <div className="dsg-resize-guide" style={{ left: guia }} />}
      <div className="dsg-statusbar">
        {resumo && resumo.contagem > 0 ? (
          <span>
            Soma <b className="font-mono">{formatarNumero(resumo.soma)}</b> ·{" "}
            Média <b className="font-mono">{formatarNumero(resumo.media)}</b> ·{" "}
            Contagem <b className="font-mono">{resumo.contagem}</b>
          </span>
        ) : (
          <span className="dsg-statusbar-dim">Selecione células numéricas para ver soma · média · contagem</span>
        )}
      </div>
    </div>
  );
}
