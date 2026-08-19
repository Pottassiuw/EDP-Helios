import React from "react";
import { toast } from "sonner";
import type { Bloqueio, Celula, NotaInput } from "./types";
import type { ColunaDef } from "./columns";
import { compararDatas, formatarDataHora, formatarNumero, ehNotaOculta } from "./lib";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, Lock, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

const ALTURA_LINHA = 40;

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
  /** Bloqueios ativos (Numero_Nota -> quem está editando agora). */
  bloqueios?: Map<number, Bloqueio>;
  /** Usuário atual — o próprio bloqueio não conta como "de outro". */
  usuarioAtual?: string | null;
  /** Chamado antes de entrar em modo de edição; deve tentar travar a nota e
   *  devolver se pode prosseguir. Sem isso, a edição entra direto (ex.: Ramal). */
  onIniciarEdicao?: (numero: number) => Promise<boolean>;
  /** Chamado ao clicar no número da nota para abrir painel lateral com detalhes. */
  onOpenDetails?: (nota: NotaInput, trigger: HTMLButtonElement) => void;
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
  /** Última filha da gavetinha — encurta a linha-guia vertical do indicador de hierarquia. */
  ultimoFilho: boolean;
}

const HEADER_STICKY_CLASS =
  "sticky top-[0px] z-[1] bg-surface shadow-[inset_0_-1px_0_var(--line)]";

export function NotesTable(props: NotesTableProps): React.JSX.Element {
  const {
    registros,
    todosOsRegistros,
    colunas,
    altura = 580,
    selecionados,
    onToggleSelecionado,
    edicoes,
    onEditar,
    statusOpcoes = [],
    prioridadeOpcoes = [],
    agruparGavetinhas = true,
    bloqueios,
    usuarioAtual,
    onIniciarEdicao,
    onOpenDetails,
  } = props;
  const [scrollTop, setScrollTop] = React.useState(0);
  const [ordem, setOrdem] = React.useState<{
    campo: string;
    asc: boolean;
  } | null>(null);
  const [editando, setEditando] = React.useState<CelulaEditando | null>(null);
  const [expandidos, setExpandidos] = React.useState<Set<number>>(new Set());
  const [indiceFocado, setIndiceFocado] = React.useState<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

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
          ultimoFilho: false,
        })),
        totalMaesComFilhas: 0,
      };
    }

    const setMaesNaBusca = new Set(ordenados.map((r) => r.Numero_Nota));
    const fonteBase = todosOsRegistros ?? ordenados;
    const filhasPorMae = new Map<number, NotaInput[]>();
    const idsNotasFilhas = new Set<number>();
    const mapaRegistros = new Map<number, NotaInput>();
    for (const r of fonteBase) {
      mapaRegistros.set(r.Numero_Nota, r);
    }

    for (const r of fonteBase) {
      const maeStr = String(r.Nota_Mae ?? "").trim();
      if (maeStr && maeStr !== "-" && maeStr !== "None" && maeStr !== "null") {
        const maeId = Number(maeStr);
        if (Number.isFinite(maeId) && maeId !== r.Numero_Nota && setMaesNaBusca.has(maeId)) {
          // Proteção contra vínculo circular mútuo (ex: A aponta para B e B aponta para A)
          const maeReg = mapaRegistros.get(maeId);
          const maeMaeId = maeReg ? Number(maeReg.Nota_Mae) : null;
          if (maeMaeId === r.Numero_Nota && r.Numero_Nota < maeId) {
            // Em caso de ciclo direto mútuo, a nota de menor ID permanece como raiz/mãe
            continue;
          }
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
        ultimoFilho: false,
      });

      if (temFilhas && expandidos.has(r.Numero_Nota)) {
        filhas.forEach((f, i) => {
          resultado.push({
            registro: f,
            nivel: 1,
            temFilhas: false,
            qtdFilhas: 0,
            ultimoFilho: i === filhas.length - 1,
          });
        });
      }
    }

    return { linhasProcessadas: resultado, totalMaesComFilhas: filhasPorMae.size };
  }, [ordenados, agruparGavetinhas, expandidos, todosOsRegistros]);

  const garantirVisivel = React.useCallback(
    (index: number) => {
      const container = containerRef.current;
      if (!container) return;

      const headerHeight = 36;
      const margemSeguranca = 40; // Margem para garantir que a linha e a borda inferior fiquem 100% visíveis
      const itemTop = index * ALTURA_LINHA;
      const itemBottom = itemTop + ALTURA_LINHA;

      const currentScrollTop = container.scrollTop;
      const clientHeight = container.clientHeight || altura;

      // Se a linha está acima da área visível (ou coberta pelo TableHeader sticky)
      if (itemTop < currentScrollTop + headerHeight) {
        container.scrollTop = Math.max(0, itemTop - headerHeight - margemSeguranca);
      }
      // Se a linha está abaixo da área visível (ou cortada pela borda inferior / scrollbar)
      else if (itemBottom > currentScrollTop + clientHeight - margemSeguranca) {
        container.scrollTop = itemBottom - clientHeight + margemSeguranca;
      }
    },
    [altura]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editando !== null) return;
    const targetTag = (e.target as HTMLElement).tagName;
    if (targetTag === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox') return;
    if (targetTag === 'SELECT' || targetTag === 'TEXTAREA') return;

    const totalLinhas = linhasProcessadas.length;
    if (totalLinhas === 0) return;

    const container = containerRef.current;
    const headerHeight = 36;
    const scrollAtual = container ? container.scrollTop : 0;
    const clientHeight = container?.clientHeight || altura;

    // Linhas que estão atualmente 100% visíveis dentro da janela de rolagem
    const primeiraLinhaVisivel = Math.ceil((scrollAtual + headerHeight) / ALTURA_LINHA);
    const ultimaLinhaVisivel = Math.max(0, Math.floor((scrollAtual + clientHeight - 40) / ALTURA_LINHA));

    const foraDeVisao =
      indiceFocado === null ||
      indiceFocado < primeiraLinhaVisivel ||
      indiceFocado > ultimaLinhaVisivel;

    const atual = indiceFocado ?? primeiraLinhaVisivel;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const proximo = foraDeVisao
        ? Math.min(totalLinhas - 1, primeiraLinhaVisivel)
        : Math.min(totalLinhas - 1, atual + 1);
      setIndiceFocado(proximo);
      garantirVisivel(proximo);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const anterior = foraDeVisao
        ? Math.max(0, ultimaLinhaVisivel)
        : Math.max(0, atual - 1);
      setIndiceFocado(anterior);
      garantirVisivel(anterior);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      const salto = Math.max(1, Math.floor(clientHeight / ALTURA_LINHA) - 3);
      const proximo = Math.min(totalLinhas - 1, atual + salto);
      setIndiceFocado(proximo);
      garantirVisivel(proximo);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      const salto = Math.max(1, Math.floor(clientHeight / ALTURA_LINHA) - 3);
      const anterior = Math.max(0, atual - salto);
      setIndiceFocado(anterior);
      garantirVisivel(anterior);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIndiceFocado(0);
      garantirVisivel(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      const ultimo = totalLinhas - 1;
      setIndiceFocado(ultimo);
      garantirVisivel(ultimo);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (indiceFocado !== null && indiceFocado < totalLinhas) {
        const item = linhasProcessadas[indiceFocado];
        if (item.temFilhas && !expandidos.has(item.registro.Numero_Nota)) {
          setExpandidos((prev) => new Set(prev).add(item.registro.Numero_Nota));
        } else if (atual + 1 < totalLinhas) {
          setIndiceFocado(atual + 1);
          garantirVisivel(atual + 1);
        }
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (indiceFocado !== null && indiceFocado < totalLinhas) {
        const item = linhasProcessadas[indiceFocado];
        if (item.temFilhas && expandidos.has(item.registro.Numero_Nota)) {
          setExpandidos((prev) => {
            const next = new Set(prev);
            next.delete(item.registro.Numero_Nota);
            return next;
          });
        } else if (item.nivel === 1) {
          const maeId = Number(item.registro.Nota_Mae);
          const idxMae = linhasProcessadas.findIndex((l) => l.registro.Numero_Nota === maeId);
          if (idxMae !== -1) {
            setIndiceFocado(idxMae);
            garantirVisivel(idxMae);
          }
        }
      }
    } else if (e.key === 'Enter') {
      if (indiceFocado !== null && indiceFocado < totalLinhas) {
        const item = linhasProcessadas[indiceFocado];
        if (onOpenDetails) {
          e.preventDefault();
          onOpenDetails(item.registro, e.currentTarget as unknown as HTMLButtonElement);
        } else if (item.temFilhas) {
          e.preventDefault();
          setExpandidos((prev) => {
            const next = new Set(prev);
            if (next.has(item.registro.Numero_Nota)) next.delete(item.registro.Numero_Nota);
            else next.add(item.registro.Numero_Nota);
            return next;
          });
        }
      }
    } else if (e.key === ' ') {
      if (indiceFocado !== null && indiceFocado < totalLinhas) {
        const item = linhasProcessadas[indiceFocado];
        if (onToggleSelecionado && selecionados) {
          e.preventDefault();
          onToggleSelecionado(item.registro.Numero_Nota);
        } else if (item.temFilhas) {
          e.preventDefault();
          setExpandidos((prev) => {
            const next = new Set(prev);
            if (next.has(item.registro.Numero_Nota)) next.delete(item.registro.Numero_Nota);
            else next.add(item.registro.Numero_Nota);
            return next;
          });
        }
      }
    }
  };

  const inicio = Math.max(0, Math.floor(scrollTop / ALTURA_LINHA) - 5);
  const qtdVisiveis = Math.ceil(altura / ALTURA_LINHA) + 10;
  const fatia = linhasProcessadas.slice(inicio, inicio + qtdVisiveis);
  const espacoTopo = inicio * ALTURA_LINHA;
  const espacoFundo = Math.max(
    0,
    (linhasProcessadas.length - inicio - fatia.length) * ALTURA_LINHA,
  );
  const totalColunas = colunas.length + (selecionados ? 1 : 0);

  function bloqueioDeOutro(numero: number): Bloqueio | undefined {
    const b = bloqueios?.get(numero);
    if (!b || b.Usuario === usuarioAtual) return undefined;
    return b;
  }

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
        <TableCell key={c.key} className="p-[0px] h-[40px]">
          {opcoes ? (
            <select
              autoFocus
              defaultValue={String(v ?? "")}
              aria-label={`Editar ${c.label}`}
              className="w-full h-[32px] text-[12.5px] bg-surface text-foreground border border-line rounded px-1 cursor-pointer focus:outline-none focus:ring-1 focus:ring-accent"
              onBlur={(e) => confirmar(e.target.value)}
              onChange={(e) => confirmar(e.target.value)}
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
              className="w-[100%] h-[32px] text-[12.5px] box-border"
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

    // Renderização especial da coluna ID (Numero_Nota) para exibir gavetinha / indentação
    if (c.key === "Numero_Nota") {
      const estaExpandido = expandidos.has(r.Numero_Nota);
      const bloqueio = bloqueioDeOutro(r.Numero_Nota);
      const ehFilha = item.nivel === 1;
      return (
        <TableCell
          key={c.key}
          className={`whitespace-nowrap overflow-hidden text-ellipsis min-w-[185px] h-[40px] text-[12.5px] border-b-[1px] border-b-line font-mono ${
            ehFilha ? "relative" : ""
          }`}
        >
          {ehFilha && (
            <React.Fragment>
              {/* Linha-guia de árvore: traço vertical (conecta ao irmão anterior/pai) + conector horizontal até o número. */}
              <span
                aria-hidden="true"
                className="absolute left-[15px] top-0 w-px bg-line-2"
                style={{ height: item.ultimoFilho ? ALTURA_LINHA / 2 : ALTURA_LINHA }}
              />
              <span
                aria-hidden="true"
                className="absolute left-[15px] w-[9px] h-px bg-line-2"
                style={{ top: ALTURA_LINHA / 2 }}
              />
            </React.Fragment>
          )}
          <div className={`flex items-center gap-2 ${ehFilha ? "pl-[26px]" : ""}`}>
            {onOpenDetails ? (
              <button
                type="button"
                onClick={(e) => onOpenDetails(r, e.currentTarget)}
                className="font-semibold text-foreground tracking-tight hover:text-accent hover:underline cursor-pointer text-left"
                title="Abrir detalhes e enriquecimento desta nota"
              >
                {formatarNumero(v, 0, false)}
              </button>
            ) : (
              <span className="font-semibold text-foreground tracking-tight">
                {formatarNumero(v, 0, false)}
              </span>
            )}
            {ehNotaOculta(r) && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-sans font-medium bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shrink-0"
                title="Esta nota está marcada como Oculta"
              >
                <EyeOff size={10} />
                Oculta
              </span>
            )}
            {bloqueio && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-sans font-medium bg-amber/15 text-amber border border-amber/30 shrink-0"
                title={`Em edição por ${bloqueio.Usuario} desde ${formatarDataHora(bloqueio.Data_Hora)}`}
              >
                <Lock size={10} />
                {bloqueio.Usuario}
              </span>
            )}
            {item.temFilhas ? (
              <React.Fragment>
                <button
                  type="button"
                  onClick={(e) => toggleExpandir(r.Numero_Nota, e)}
                  className={`inline-flex items-center justify-center h-[18px] w-[18px] rounded-[4px] border shrink-0 cursor-pointer transition-colors ${
                    estaExpandido
                      ? "bg-accent-tint border-[var(--accent)]/40 text-[var(--accent)]"
                      : "bg-bg-2 border-line-2 text-text-dim hover:border-[var(--accent)]/40 hover:text-[var(--accent)]"
                  }`}
                  aria-label={`${estaExpandido ? "Recolher" : "Expandir"} ${item.qtdFilhas} ${
                    item.qtdFilhas === 1 ? "nota filha" : "notas filhas"
                  }`}
                  title={estaExpandido ? "Recolher notas filhas" : "Expandir notas filhas (gavetinha)"}
                >
                  {estaExpandido ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
                <span className="font-mono text-[10.5px] text-text-mute shrink-0">
                  ×{item.qtdFilhas}
                </span>
              </React.Fragment>
            ) : null}
          </div>
        </TableCell>
      );
    }

    const estaExpandido = expandidos.has(r.Numero_Nota);
    const COLUNAS_SOMA_HIERARQUICA = new Set([
      "Planejado_DDPM",
      "Total_planejado_ordem",
      "Total_real_ordem",
      "Modular",
      "Total_planejado_modular",
    ]);

    // Para Planejado_DDPM: filhas com conjunto diferente da mãe não entram na soma
    const filhasValidas = (item.filhas ?? []).filter((f) => {
      if (c.key === "Planejado_DDPM") {
        const cjMae = String(r.Conjunto ?? "").trim().toLowerCase();
        const cjFilha = String(f.Conjunto ?? "").trim().toLowerCase();
        return cjMae === cjFilha && cjMae !== "" && cjMae !== "-";
      }
      return true;
    });

    const deveSomarHierarquia =
      item.temFilhas &&
      !estaExpandido &&
      COLUNAS_SOMA_HIERARQUICA.has(c.key) &&
      (c.key !== "Planejado_DDPM" || filhasValidas.length > 0);

    let valorExibicao = v;
    let tooltipSoma: string | undefined = undefined;

    if (deveSomarHierarquia) {
      const valorProprio = Number(v) || 0;
      const somaFilhas = filhasValidas.reduce(
        (acc, f) => acc + (Number(valor(f, c.key)) || 0),
        0,
      );
      const somaTotal = valorProprio + somaFilhas;
      valorExibicao = somaTotal;
      tooltipSoma = `Soma consolidada do grupo: ${formatarNumero(somaTotal, 2)} (Mãe: ${formatarNumero(valorProprio, 2)} + ${filhasValidas.length} ${filhasValidas.length === 1 ? 'filha' : 'filhas'}: ${formatarNumero(somaFilhas, 2)})`;
    }

    const tentarEditar = (): void => {
      const b = bloqueioDeOutro(r.Numero_Nota);
      if (b) {
        toast.warning(`Nota ${r.Numero_Nota} em edição por ${b.Usuario}`, {
          description: `Desde ${formatarDataHora(b.Data_Hora)} — aguarde a liberação para editar.`,
        });
        return;
      }
      setEditando({ numero: r.Numero_Nota, campo: c.key });
      if (onIniciarEdicao) {
        void onIniciarEdicao(r.Numero_Nota);
      }
    };

    return (
      <TableCell
        key={c.key}
        title={tooltipSoma ?? (editavel ? "Duplo clique para editar" : undefined)}
        onDoubleClick={editavel ? tentarEditar : undefined}
        className={`whitespace-nowrap overflow-hidden text-ellipsis max-w-[320px] h-[40px] text-[12.5px] border-b-[1px] border-b-line ${
          c.numeric ? "text-right font-mono" : ""
        } ${editavel ? "hover:bg-accent/10 select-none cursor-pointer" : ""}`}
        style={{
          cursor: editavel ? "pointer" : "default",
          color: alterada ? "var(--accent)" : deveSomarHierarquia ? "var(--green)" : undefined,
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
          formatarNumero(valorExibicao)
        ) : (
            valorExibicao !== null && valorExibicao !== undefined && valorExibicao !== "" && (c.key !== "Ordem" || String(valorExibicao).trim().toUpperCase() !== "FORA SAP")
              ? String(valorExibicao)
              : "-"
        )}
      </TableCell>
    );
  }

  const todosNumeros = React.useMemo(() => {
    return ordenados.map((r) => r.Numero_Nota);
  }, [ordenados]);

  return (
    <div className="flex flex-col gap-[6px]">
      {agruparGavetinhas && totalMaesComFilhas > 0 && (
        <div className="flex items-center justify-between px-[4px] py-[2px] text-[11px] text-text-mute font-sans">
          <span>
            {totalMaesComFilhas} Nota(s) Mãe com vínculo ({expandidos.size} expandida(s))
            <span className="ml-2 text-text-dim text-[10.5px]">
              • Use <kbd className="px-1 py-0.5 bg-bg-2 border border-line-2 rounded text-[10px]">↑</kbd> <kbd className="px-1 py-0.5 bg-bg-2 border border-line-2 rounded text-[10px]">↓</kbd> para navegar e <kbd className="px-1 py-0.5 bg-bg-2 border border-line-2 rounded text-[10px]">←</kbd> <kbd className="px-1 py-0.5 bg-bg-2 border border-line-2 rounded text-[10px]">→</kbd> para abrir/fechar gavetas
            </span>
          </span>
          <div className="flex gap-[6px]">
            <Button
              variant="ghost"
              size="xs"
              onClick={expandirTodas}
              className="h-[22px] px-[8px] text-[11px] text-primary hover:bg-accent-tint cursor-pointer"
            >
              Expandir todas
            </Button>
            <span>•</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={recolherTodas}
              className="h-[22px] px-[8px] text-[11px] text-text-mute hover:text-text cursor-pointer"
            >
              Recolher todas
            </Button>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
        className="overflow-auto border border-line rounded-[8px] outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
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
            {fatia.map((item, idx) => {
              const r = item.registro;
              const indiceAbsoluto = inicio + idx;
              const isPar = indiceAbsoluto % 2 === 0;
              const ehFilha = item.nivel === 1;
              const travadaPorOutro = Boolean(bloqueioDeOutro(r.Numero_Nota));
              const selecionado = selecionados?.has(r.Numero_Nota);
              const estaFocado = indiceAbsoluto === indiceFocado;

              let bgClasse = isPar ? "bg-surface hover:bg-surface-2" : "bg-[var(--zebra)] hover:bg-surface-2";
              if (selecionado) {
                bgClasse = "bg-accent-tint hover:bg-accent-tint/90";
              } else if (estaFocado) {
                bgClasse = "bg-primary/10 border-l-[4px] border-l-primary hover:bg-primary/15";
              } else if (travadaPorOutro) {
                bgClasse = "border-l-[3px] border-l-amber bg-amber/5 hover:bg-amber/10";
              } else if (ehFilha) {
                bgClasse = "border-l-[3px] border-l-blue-400 bg-surface-2 hover:bg-surface-2/80 font-medium";
              } else if (item.temFilhas) {
                bgClasse = "border-l-[3px] border-l-green bg-green/5 hover:bg-green/12 font-semibold";
              }

              return (
                <TableRow
                  key={r.Numero_Nota}
                  onClick={() => {
                    setIndiceFocado(indiceAbsoluto);
                    garantirVisivel(indiceAbsoluto);
                  }}
                  style={{
                    background: selecionado ? "var(--accent-tint)" : undefined,
                  }}
                  className={`${bgClasse} transition-none cursor-default`}
                >
                  {selecionados && (
                    <TableCell className="text-center h-[40px] border-b-[1px] border-b-line">
                      <input
                        type="checkbox"
                        checked={selecionado}
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
