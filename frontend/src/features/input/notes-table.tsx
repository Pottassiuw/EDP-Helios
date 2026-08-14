import React from "react";
import type { Celula, NotaInput } from "./types";
import type { ColunaDef } from "./columns";
import { compararDatas, formatarNumero } from "./lib";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, CornerDownRight, Folder, FolderOpen } from "lucide-react";
import { Input } from "@/components/ui/input";

const ALTURA_LINHA = 32;

export interface NotesTableProps {
  registros: NotaInput[];
  /** Opcional: dataset completo sem filtros para permitir expandir filhas mesmo com busca ativa. */
  todosOsRegistros?: NotaInput[];
  colunas: ColunaDef[];
  altura?: number;
  /** Seleção por checkbox (edição em lote / exclusão). Ausente = sem coluna de seleção. */
  selecionados?: Set<number>;
  onToggleSelecionado?: (numero: number) => void;
  onToggleTodos?: (numeros: number[], marcar: boolean) => void;
  /** Edições pendentes (sobrepõem o valor exibido). Presente = células editáveis. */
  edicoes?: Map<number, Partial<NotaInput>>;
  onEditar?: (numero: number, campo: string, valor: Celula) => void;
  statusOpcoes?: string[];
  prioridadeOpcoes?: string[];
  /** Ativa/desativa agrupamento hierárquico (gavetinhas Nota Mãe -> Filhas). Padrão: true. */
  agruparGavetinhas?: boolean;
}

interface CelulaEditando {
  numero: number;
  campo: string;
}

interface LinhaHierarquica {
  registro: NotaInput;
  nivel: number;
  temFilhas: boolean;
  qtdFilhas: number;
  filhas?: NotaInput[];
}

const HEADER_STICKY_CLASS =
  "sticky top-[0px] z-[1] bg-surface shadow-[inset_0_-1px_0_var(--line)]";

export function NotesTable(props: NotesTableProps): React.JSX.Element {
  const {
    registros,
    todosOsRegistros,
    colunas,
    altura = 520,
    selecionados,
    onToggleSelecionado,
    edicoes,
    onEditar,
    statusOpcoes = [],
    prioridadeOpcoes = [],
    agruparGavetinhas = true,
  } = props;
  const [scrollTop, setScrollTop] = React.useState(0);
  const [ordem, setOrdem] = React.useState<{
    campo: string;
    asc: boolean;
  } | null>(null);
  const [editando, setEditando] = React.useState<CelulaEditando | null>(null);
  const [expandidos, setExpandidos] = React.useState<Set<number>>(new Set());

  const MESES_OPCOES = React.useMemo(() => {
    const meses = ['jan', 'fev', 'mar', 'abr', 'maio', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const anoAtual = new Date().getFullYear();
    const anos = [anoAtual - 1, anoAtual, anoAtual + 1];
    const lista: string[] = ['-'];
    for (const ano of anos) {
      for (const m of meses) {
        lista.push(`${m}-${ano}`);
      }
    }
    return lista;
  }, []);

  const ordenados = React.useMemo(() => {
    if (!ordem) return registros;
    const fator = ordem.asc ? 1 : -1;
    const copia = [...registros];
    if (ordem.campo === "Mes_Execucao_Planejado") {
      copia.sort(
        (a, b) =>
          fator * compararDatas(a[ordem.campo] ?? null, b[ordem.campo] ?? null),
      );
    } else {
      copia.sort((a, b) => {
        const va = a[ordem.campo];
        const vb = b[ordem.campo];
        const na = Number(va);
        const nb = Number(vb);
        if (Number.isFinite(na) && Number.isFinite(nb))
          return fator * (na - nb);
        return (
          fator * String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR")
        );
      });
    }
    return copia;
  }, [registros, ordem]);

  // Lógica de agrupamento de gavetinhas (Nota Mãe -> Notas Filhas)
  const { linhasProcessadas, totalMaesComFilhas } = React.useMemo(() => {
    if (!agruparGavetinhas) {
      return {
        linhasProcessadas: ordenados.map((r) => ({
          registro: r,
          nivel: 0,
          temFilhas: false,
          qtdFilhas: 0,
        })),
        totalMaesComFilhas: 0,
      };
    }

    const setMaesNaBusca = new Set(ordenados.map((r) => r.Numero_Nota));
    const fonteBase = todosOsRegistros ?? ordenados;
    const filhasPorMae = new Map<number, NotaInput[]>();
    const idsNotasFilhas = new Set<number>();

    for (const r of fonteBase) {
      const maeStr = String(r.Nota_Mae ?? "").trim();
      if (maeStr && maeStr !== "-" && maeStr !== "None" && maeStr !== "null") {
        const maeId = Number(maeStr);
        if (Number.isFinite(maeId) && maeId !== r.Numero_Nota && setMaesNaBusca.has(maeId)) {
          idsNotasFilhas.add(r.Numero_Nota);
          const list = filhasPorMae.get(maeId) ?? [];
          list.push(r);
          filhasPorMae.set(maeId, list);
        }
      }
    }

    const resultado: LinhaHierarquica[] = [];
    for (const r of ordenados) {
      if (idsNotasFilhas.has(r.Numero_Nota)) continue;

      const filhas = filhasPorMae.get(r.Numero_Nota) ?? [];
      const temFilhas = filhas.length > 0;
      resultado.push({
        registro: r,
        nivel: 0,
        temFilhas,
        qtdFilhas: filhas.length,
        filhas,
      });

      if (temFilhas && expandidos.has(r.Numero_Nota)) {
        for (const f of filhas) {
          resultado.push({
            registro: f,
            nivel: 1,
            temFilhas: false,
            qtdFilhas: 0,
          });
        }
      }
    }

    return { linhasProcessadas: resultado, totalMaesComFilhas: filhasPorMae.size };
  }, [ordenados, agruparGavetinhas, expandidos, todosOsRegistros]);

  const inicio = Math.max(0, Math.floor(scrollTop / ALTURA_LINHA) - 5);
  const qtdVisiveis = Math.ceil(altura / ALTURA_LINHA) + 10;
  const fatia = linhasProcessadas.slice(inicio, inicio + qtdVisiveis);
  const espacoTopo = inicio * ALTURA_LINHA;
  const espacoFundo = Math.max(
    0,
    (linhasProcessadas.length - inicio - fatia.length) * ALTURA_LINHA,
  );
  const totalColunas = colunas.length + (selecionados ? 1 : 0);

  function valor(r: NotaInput, campo: string): Celula {
    const pendente = edicoes?.get(r.Numero_Nota);
    if (pendente && campo in pendente) return pendente[campo] ?? null;
    return r[campo] ?? null;
  }

  function toggleExpandir(numeroNota: number, e: React.MouseEvent): void {
    e.stopPropagation();
    setExpandidos((prev) => {
      const s = new Set(prev);
      if (s.has(numeroNota)) s.delete(numeroNota);
      else s.add(numeroNota);
      return s;
    });
  }

  function expandirTodas(): void {
    const todasMaes = new Set<number>();
    ordenados.forEach((r) => {
      const maeStr = String(r.Nota_Mae ?? "").trim();
      if (maeStr && maeStr !== "-" && maeStr !== "None") {
        const maeId = Number(maeStr);
        if (Number.isFinite(maeId) && maeId !== r.Numero_Nota) {
          todasMaes.add(maeId);
        }
      }
    });
    setExpandidos(todasMaes);
  }

  function recolherTodas(): void {
    setExpandidos(new Set());
  }

  function cabecalho(c: ColunaDef): React.JSX.Element {
    const ativa = ordem?.campo === c.key;
    return (
      <TableHead
        key={c.key}
        onClick={() =>
          setOrdem((o) => {
            if (!o || o.campo !== c.key) return { campo: c.key, asc: true };
            if (o.asc) return { campo: c.key, asc: false };
            return null;
          })
        }
        className={`${HEADER_STICKY_CLASS} cursor-pointer whitespace-nowrap font-mono text-[10px] font-medium tracking-[0.14em] uppercase`}
        style={{
          minWidth: c.largura ?? 90,
          color: ativa ? "var(--accent)" : "var(--text-mute)",
        }}
      >
        {c.label}
        {ativa ? (ordem!.asc ? " ↑" : " ↓") : ""}
      </TableHead>
    );
  }

  function celula(item: LinhaHierarquica, c: ColunaDef): React.JSX.Element {
    const r = item.registro;
    const v = valor(r, c.key);
    const editavel = Boolean(onEditar && c.editavel);
    const emEdicao =
      editando && editando.numero === r.Numero_Nota && editando.campo === c.key;
    const alterada = Boolean(
      edicoes?.get(r.Numero_Nota) &&
      c.key in (edicoes.get(r.Numero_Nota) ?? {}),
    );

    if (emEdicao && onEditar) {
      const confirmar = (novo: string): void => {
        onEditar(r.Numero_Nota, c.key, novo);
        setEditando(null);
      };
      const opcoes =
        c.opcoes === "status"
          ? statusOpcoes
          : c.opcoes === "prioridade"
            ? prioridadeOpcoes
            : c.opcoes === "mes"
              ? MESES_OPCOES
              : null;
      return (
        <TableCell key={c.key} className="p-[0px] h-[32px]">
          {opcoes ? (
            <select
              autoFocus
              defaultValue={String(v ?? "")}
              aria-label={`Editar ${c.label}`}
              className="w-full h-[28px] text-[12.5px] bg-surface text-foreground border border-line rounded px-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
              onChange={(e) => confirmar(e.target.value)}
              onBlur={(e) => confirmar(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditando(null);
              }}
            >
              {opcoes.map((o) => (
                <option key={o} value={o} className="bg-surface text-foreground py-1">
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <Input
              autoFocus
              defaultValue={String(v ?? "")}
              aria-label={`Editar ${c.label}`}
              className="w-[100%] h-[28px] text-[12.5px] box-border"
              onBlur={(e) => confirmar(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")
                  confirmar((e.target as HTMLInputElement).value);
                if (e.key === "Escape") setEditando(null);
              }}
            />
          )}
        </TableCell>
      );
    }

    // Renderização especial da coluna ID (Numero_Nota) para exibir gavetinha / indetação
    if (c.key === "Numero_Nota") {
      const estaExpandido = expandidos.has(r.Numero_Nota);
      return (
        <TableCell
          key={c.key}
          className="whitespace-nowrap overflow-hidden text-ellipsis min-w-[185px] h-[32px] text-[12.5px] border-b-[1px] border-b-line font-mono"
        >
          <div className="flex items-center gap-2">
            {item.nivel === 1 && (
              <span className="text-accent/80 pl-0.5 font-bold inline-flex items-center gap-1 shrink-0" title="Nota Filha">
                <CornerDownRight className="h-3.5 w-3.5 inline text-accent stroke-[2.5]" />
              </span>
            )}
            <span className="font-semibold text-foreground tracking-tight">
              {formatarNumero(v, 0, false)}
            </span>
            {item.temFilhas ? (
              <button
                type="button"
                onClick={(e) => toggleExpandir(r.Numero_Nota, e)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11.5px] font-sans transition-all cursor-pointer shadow-2xs ${
                  estaExpandido
                    ? "bg-green text-white font-bold border border-green hover:brightness-110 shadow-xs"
                    : "bg-green/12 dark:bg-green/20 text-green dark:text-green-2 font-bold border border-green/40 hover:bg-green/25 hover:border-green/60"
                }`}
                title={estaExpandido ? "Recolher notas filhas" : "Expandir notas filhas (gavetinha)"}
              >
                <Folder size={12} className={estaExpandido ? "fill-current text-white" : "text-green dark:text-green-2 shrink-0"} />
                <span>{item.qtdFilhas} {item.qtdFilhas === 1 ? "filha" : "filhas"}</span>
                {estaExpandido ? <ChevronUp size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />}
              </button>
            ) : null}
          </div>
        </TableCell>
      );
    }

    const COLUNAS_SOMA_HIERARQUICA = new Set([
      "Planejado_DDPM",
      "Total_planejado_ordem",
      "Total_real_ordem",
      "Modular",
      "Total_planejado_modular",
    ]);

    const estaExpandido = expandidos.has(r.Numero_Nota);
    const deveSomarHierarquia =
      item.temFilhas && !estaExpandido && COLUNAS_SOMA_HIERARQUICA.has(c.key);

    let valorExibicao = v;
    let tooltipSoma: string | undefined = undefined;

    if (deveSomarHierarquia) {
      const valorProprio = Number(v) || 0;
      const somaFilhas = (item.filhas ?? []).reduce(
        (acc, f) => acc + (Number(valor(f, c.key)) || 0),
        0,
      );
      const somaTotal = valorProprio + somaFilhas;
      valorExibicao = somaTotal;
      tooltipSoma = `Soma consolidada do grupo: ${formatarNumero(somaTotal, 2)} (Mãe: ${formatarNumero(valorProprio, 2)} + ${item.qtdFilhas} ${item.qtdFilhas === 1 ? 'filha' : 'filhas'}: ${formatarNumero(somaFilhas, 2)})`;
    }

    return (
      <TableCell
        key={c.key}
        title={
          tooltipSoma ??
          (editavel ? "Clique ou duplo clique para editar" : undefined)
        }
        onClick={
          editavel
            ? () => setEditando({ numero: r.Numero_Nota, campo: c.key })
            : undefined
        }
        onDoubleClick={
          editavel
            ? () => setEditando({ numero: r.Numero_Nota, campo: c.key })
            : undefined
        }
        className={`whitespace-nowrap overflow-hidden text-ellipsis max-w-[320px] h-[32px] text-[12.5px] border-b-[1px] border-b-line ${
          editavel ? "hover:bg-accent/10 transition-colors" : ""
        }`}
        style={{
          cursor: editavel ? "pointer" : "default",
          color: alterada
            ? "var(--accent)"
            : deveSomarHierarquia
              ? "var(--green)"
              : undefined,
          fontWeight: alterada || deveSomarHierarquia ? 600 : undefined,
        }}
      >
        {deveSomarHierarquia ? (
          <div className="flex items-center justify-between gap-1.5 w-full">
            <span>{formatarNumero(valorExibicao, 2)}</span>
            <span
              className="inline-flex items-center px-1.5 py-0.2 text-[10px] font-mono font-bold bg-green/15 text-green dark:text-green-2 border border-green/30 rounded"
              title={tooltipSoma}
            >
              Σ grupo
            </span>
          </div>
        ) : c.numeric ? (
          c.key === "ranking"
            ? formatarNumero(valorExibicao, 0, false)
            : formatarNumero(valorExibicao, 2)
        ) : (
          String(valorExibicao ?? "")
        )}
      </TableCell>
    );
  }

  const todosNumeros = ordenados.map((r) => r.Numero_Nota);

  return (
    <div className="flex flex-col gap-1">
      {agruparGavetinhas && totalMaesComFilhas > 0 && (
        <div className="flex items-center justify-between px-3.5 py-2 bg-surface border border-line rounded-t-[8px] text-xs text-foreground shadow-xs">
          <span className="flex items-center gap-2 font-medium">
            <FolderOpen className="h-4 w-4 text-green" />
            <span>
              <strong className="text-green font-bold">{totalMaesComFilhas}</strong> nota(s) mãe(s) com filhas agrupadas em gavetinhas.
            </span>
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={expandirTodas}
              className="h-7 px-2.5 text-[11px] font-semibold gap-1 text-foreground bg-surface hover:bg-green/15 hover:text-green border-line cursor-pointer"
            >
              <FolderOpen size={12} className="text-green" />
              Expandir Todas
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={recolherTodas}
              className="h-7 px-2.5 text-[11px] font-semibold gap-1 text-text-mute hover:text-foreground bg-surface hover:bg-surface-2 border-line cursor-pointer"
            >
              <Folder size={12} />
              Recolher Todas
            </Button>
          </div>
        </div>
      )}

      <div
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="overflow-auto border border-line rounded-[8px]"
        style={{ height: altura }}
      >
        <Table className="border-collapse">
          <TableHeader>
            <TableRow>
              {selecionados && (
                <TableHead className={`${HEADER_STICKY_CLASS} w-[36px] text-center`}>
                  <input
                    type="checkbox"
                    checked={
                      todosNumeros.length > 0 &&
                      todosNumeros.every((n) => selecionados.has(n))
                    }
                    onChange={(e) =>
                      props.onToggleTodos?.(todosNumeros, e.target.checked)
                    }
                  />
                </TableHead>
              )}
              {colunas.map(cabecalho)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {espacoTopo > 0 && (
              <tr style={{ height: espacoTopo }}>
                <td colSpan={totalColunas} className="p-[0px] border-0" />
              </tr>
            )}
            {fatia.map((item) => {
              const r = item.registro;
              const ehFilha = item.nivel === 1;
              return (
                <TableRow
                  key={r.Numero_Nota}
                  style={{
                    background: selecionados?.has(r.Numero_Nota)
                      ? "var(--accent-tint)"
                      : undefined,
                  }}
                  className={
                    ehFilha
                      ? "border-l-4 border-l-blue-400 bg-surface-2/90 font-medium hover:bg-surface-2 transition-colors"
                      : item.temFilhas
                        ? "border-l-4 border-l-green font-semibold bg-green/5 hover:bg-green/12 transition-colors"
                        : undefined
                  }
                >
                  {selecionados && (
                    <TableCell className="text-center h-[32px] border-b-[1px] border-b-line">
                      <input
                        type="checkbox"
                        checked={selecionados.has(r.Numero_Nota)}
                        onChange={() => onToggleSelecionado?.(r.Numero_Nota)}
                      />
                    </TableCell>
                  )}
                  {colunas.map((c) => celula(item, c))}
                </TableRow>
              );
            })}
            {espacoFundo > 0 && (
              <tr style={{ height: espacoFundo }}>
                <td colSpan={totalColunas} className="p-[0px] border-0" />
              </tr>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
