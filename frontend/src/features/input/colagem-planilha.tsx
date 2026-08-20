import React from 'react';
import type { ColunaDef } from './columns';
import type { NotaInput } from './types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  GitBranch,
  Plus,
  Trash2,
  Copy,
  ClipboardPaste,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';

export interface AjusteMaeColagem {
  numeroMae: number;
  medidaAtual: number;
  deducao: number;
  novaMedida: number;
}

interface ColagemPlanilhaProps {
  titulo: string;
  colunasColagem: string[];
  colunasPreview: ColunaDef[];
  rotulos: Record<string, string>;
  texto: string;
  setTexto: (v: string) => void;
  preview: Array<Partial<NotaInput>>;
  salvando: boolean;
  rotuloSalvar: string;
  onSalvar: () => void;
  ajustesMaes?: AjusteMaeColagem[];
  descontarMaes?: boolean;
  onToggleDescontarMaes?: (v: boolean) => void;
}

const LINHA_EM_BRANCO = (dataAtual: string): Record<string, string> => ({
  Numero_Nota: '',
  Nota_Mae: '-',
  Status_Nota: '00 Pendente',
  Prioridade_Nota: 'Programável',
  Planejado_DDPM: '0',
  Conjunto: '-',
  Circuito: '-',
  Local_Instalacao: '-',
  Mes_Execucao_Planejado: '-',
  Data_Envio_Projeto: dataAtual,
  Observacao: '',
  Check: '-',
});

export function ColagemPlanilha({
  titulo,
  colunasColagem,
  rotulos,
  texto,
  setTexto,
  preview,
  salvando,
  rotuloSalvar,
  onSalvar,
  ajustesMaes = [],
  descontarMaes = true,
  onToggleDescontarMaes,
}: ColagemPlanilhaProps): React.JSX.Element {
  const dataHoje = React.useMemo(() => new Date().toLocaleDateString('pt-BR'), []);
  const [mostrarCaixaColagem, setMostrarCaixaColagem] = React.useState(false);

  // Inicializa linhas da planilha a partir do preview ou com 5 linhas vazias padrão
  const [linhasPlanilha, setLinhasPlanilha] = React.useState<Array<Record<string, string>>>(() => {
    if (preview.length > 0) {
      return preview.map((p) => {
        const item: Record<string, string> = {};
        for (const c of colunasColagem) {
          item[c] = String(p[c as keyof NotaInput] ?? (c === 'Nota_Mae' ? '-' : ''));
        }
        return item;
      });
    }
    return [
      LINHA_EM_BRANCO(dataHoje),
      LINHA_EM_BRANCO(dataHoje),
      LINHA_EM_BRANCO(dataHoje),
      LINHA_EM_BRANCO(dataHoje),
      LINHA_EM_BRANCO(dataHoje),
    ];
  });

  // Atualiza o texto TSV original quando as linhas da planilha mudam
  const sincronizarComTexto = React.useCallback(
    (novasLinhas: Array<Record<string, string>>) => {
      const linhasValidas = novasLinhas.filter(
        (l) => l.Numero_Nota && l.Numero_Nota.trim() !== '' && l.Numero_Nota.trim() !== '-'
      );
      if (linhasValidas.length === 0) {
        setTexto('');
        return;
      }
      const tsv = linhasValidas
        .map((linha) => colunasColagem.map((c) => (linha[c] ?? '').trim()).join('\t'))
        .join('\n');
      setTexto(tsv);
    },
    [colunasColagem, setTexto]
  );

  const alterarCelula = (index: number, campo: string, valor: string): void => {
    setLinhasPlanilha((prev) => {
      const proximo = [...prev];
      proximo[index] = { ...proximo[index], [campo]: valor };
      sincronizarComTexto(proximo);
      return proximo;
    });
  };

  const adicionarLinhas = (quantidade: number = 1): void => {
    setLinhasPlanilha((prev) => {
      const novas = Array.from({ length: quantidade }, () => LINHA_EM_BRANCO(dataHoje));
      const proximo = [...prev, ...novas];
      return proximo;
    });
  };

  const removerLinha = (index: number): void => {
    setLinhasPlanilha((prev) => {
      const proximo = prev.filter((_, i) => i !== index);
      const resultado = proximo.length > 0 ? proximo : [LINHA_EM_BRANCO(dataHoje)];
      sincronizarComTexto(resultado);
      return resultado;
    });
  };

  const limparPlanilha = (): void => {
    const iniciais = [
      LINHA_EM_BRANCO(dataHoje),
      LINHA_EM_BRANCO(dataHoje),
      LINHA_EM_BRANCO(dataHoje),
    ];
    setLinhasPlanilha(iniciais);
    setTexto('');
    toast.info('Planilha limpa.');
  };

  // Trata colagem (Paste) direta via Ctrl+V no container da tabela
  const handlePaste = (e: React.ClipboardEvent): void => {
    const pasteData = e.clipboardData.getData('text');
    if (!pasteData || !pasteData.includes('\t') && !pasteData.includes('\n')) return;

    e.preventDefault();
    const linhas = pasteData
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (linhas.length === 0) return;

    // Se a primeira linha contiver cabeçalhos (não começa com número), pula
    const primeiraLinha = linhas[0];
    const primeiraCelula = (primeiraLinha.split('\t')[0] ?? '').trim();
    const linhasDados = !/^\d+$/.test(primeiraCelula) ? linhas.slice(1) : linhas;
    if (linhasDados.length === 0) return;

    const novasLinhasParsed: Array<Record<string, string>> = [];
    for (const linha of linhasDados) {
      const celulas = linha.split('\t');
      const reg: Record<string, string> = {};
      colunasColagem.forEach((c, idx) => {
        reg[c] = (celulas[idx] ?? '').trim();
      });
      // Fallback para campos essenciais se estiverem em branco
      if (!reg.Status_Nota) reg.Status_Nota = '00 Pendente';
      if (!reg.Prioridade_Nota) reg.Prioridade_Nota = 'Programável';
      if (!reg.Planejado_DDPM) reg.Planejado_DDPM = '0';
      if (!reg.Nota_Mae) reg.Nota_Mae = '-';
      if (!reg.Data_Envio_Projeto) reg.Data_Envio_Projeto = dataHoje;
      if (!reg.Check) reg.Check = '-';
      novasLinhasParsed.push(reg);
    }

    setLinhasPlanilha(novasLinhasParsed);
    sincronizarComTexto(novasLinhasParsed);
    toast.success(`${novasLinhasParsed.length} linha(s) importada(s) do Excel para a planilha!`);
  };

  const copiarCabecalhoExcel = (): void => {
    const cabecalho = colunasColagem.map((c) => rotulos[c] ?? c).join('\t');
    navigator.clipboard.writeText(cabecalho);
    toast.success('Cabeçalho copiado! Cole na 1ª linha do seu Excel para montar as colunas.');
  };

  const totalPreenchidas = linhasPlanilha.filter(
    (l) => l.Numero_Nota && /^\d+$/.test(l.Numero_Nota.trim())
  ).length;

  return (
    <Card className="border border-line bg-surface shadow-sm" onPaste={handlePaste}>
      <CardHeader className="pb-3 border-b border-line">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-accent" />
              <CardTitle className="text-base font-bold text-foreground">{titulo}</CardTitle>
            </div>
            <CardDescription className="text-xs text-text-dim mt-0.5">
              Grade estruturada de notas. Preencha diretamente nas células ou cole (Ctrl+V) dados do Excel.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5 border-line hover:border-accent"
              onClick={copiarCabecalhoExcel}
              title="Copiar lista de colunas na ordem correta para usar no Excel"
            >
              <Copy className="h-3.5 w-3.5 text-accent" />
              Copiar Cabeçalhos p/ Excel
            </Button>

            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs font-semibold gap-1.5 border-line"
              onClick={() => setMostrarCaixaColagem(!mostrarCaixaColagem)}
            >
              <ClipboardPaste className="h-3.5 w-3.5 text-text-mute" />
              {mostrarCaixaColagem ? 'Ocultar Área de Texto' : 'Área de Texto (Ctrl+V)'}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-text-mute hover:text-red gap-1"
              onClick={limparPlanilha}
              title="Limpar todas as linhas da planilha"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar
            </Button>
          </div>
        </div>

        {/* Caixa de Texto Colapsável para colagem tradicional se preferir */}
        {mostrarCaixaColagem && (
          <div className="mt-3 p-3 bg-bg-2 rounded-lg border border-line flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-text-dim">
              <span>Cole o bloco de texto copiado do Excel aqui:</span>
              <span className="font-mono text-[11px] text-text-mute">Separado por Tabulação (TSV)</span>
            </div>
            <textarea
              value={texto}
              rows={4}
              placeholder="Cole aqui (Ctrl+V)..."
              onChange={(e) => {
                setTexto(e.target.value);
                const linhas = e.target.value
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0);
                if (linhas.length > 0) {
                  const parsed = linhas.map((linha) => {
                    const celulas = linha.split('\t');
                    const reg: Record<string, string> = {};
                    colunasColagem.forEach((c, idx) => {
                      reg[c] = (celulas[idx] ?? '').trim();
                    });
                    if (!reg.Status_Nota) reg.Status_Nota = '00 Pendente';
                    if (!reg.Prioridade_Nota) reg.Prioridade_Nota = 'Programável';
                    if (!reg.Planejado_DDPM) reg.Planejado_DDPM = '0';
                    if (!reg.Nota_Mae) reg.Nota_Mae = '-';
                    if (!reg.Data_Envio_Projeto) reg.Data_Envio_Projeto = dataHoje;
                    if (!reg.Check) reg.Check = '-';
                    return reg;
                  });
                  setLinhasPlanilha(parsed);
                }
              }}
              className="w-full p-2.5 rounded border border-line bg-surface font-mono text-xs focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
        )}
      </CardHeader>

      <CardContent className="pt-4 flex flex-col gap-4">
        {/* Tabela Planilha Interativa */}
        <div className="rounded-lg border border-line overflow-hidden bg-bg-2/40">
          <div className="max-h-[380px] overflow-auto">
            <Table className="w-full border-collapse text-xs">
              <TableHeader className="bg-surface-2 sticky top-0 z-10 border-b border-line shadow-xs">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 text-center font-mono text-[10px] text-text-mute font-bold">#</TableHead>
                  {colunasColagem.map((c) => {
                    const obrigatorio = c === 'Numero_Nota';
                    const destaque = c === 'Nota_Mae';
                    return (
                      <TableHead
                        key={c}
                        className={`font-mono text-[11px] font-semibold tracking-wider uppercase whitespace-nowrap px-3 py-2 ${
                          destaque ? 'text-accent bg-accent/5' : 'text-text-mute'
                        }`}
                      >
                        <div className="flex items-center gap-1">
                          <span>{rotulos[c] ?? c}</span>
                          {obrigatorio && <span className="text-red font-bold">*</span>}
                        </div>
                      </TableHead>
                    );
                  })}
                  <TableHead className="w-10 text-center"></TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {linhasPlanilha.map((linha, rowIdx) => {
                  const notaValida = linha.Numero_Nota && /^\d+$/.test(linha.Numero_Nota.trim());
                  const ehFilha = linha.Nota_Mae && linha.Nota_Mae.trim() !== '-' && linha.Nota_Mae.trim() !== '';

                  return (
                    <TableRow
                      key={rowIdx}
                      className={`border-b border-line/60 transition-colors ${
                        ehFilha ? 'bg-accent/5' : rowIdx % 2 === 0 ? 'bg-surface/30' : 'bg-surface/70'
                      }`}
                    >
                      <TableCell className="text-center font-mono text-[10.5px] text-text-mute font-medium py-1.5">
                        {rowIdx + 1}
                      </TableCell>

                      {colunasColagem.map((colKey) => (
                        <TableCell key={colKey} className="p-1 min-w-[110px]">
                          <Input
                            value={linha[colKey] ?? ''}
                            onChange={(e) => alterarCelula(rowIdx, colKey, e.target.value)}
                            placeholder={
                              colKey === 'Numero_Nota'
                                ? 'Ex: 14118256'
                                : colKey === 'Nota_Mae'
                                ? '-'
                                : colKey === 'Planejado_DDPM'
                                ? '0.0'
                                : ''
                            }
                            className={`h-7 text-xs px-2 rounded font-mono border-line/60 bg-surface focus-visible:bg-bg-2 focus-visible:ring-1 focus-visible:ring-accent ${
                              colKey === 'Numero_Nota' && !notaValida && linha.Numero_Nota.trim() !== ''
                                ? 'border-red/60 text-red font-bold'
                                : colKey === 'Nota_Mae' && ehFilha
                                ? 'border-accent/50 text-accent font-semibold'
                                : ''
                            }`}
                          />
                        </TableCell>
                      ))}

                      <TableCell className="text-center p-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-text-mute hover:text-red hover:bg-surface"
                          onClick={() => removerLinha(rowIdx)}
                          title="Remover linha"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <div className="p-2.5 bg-surface-2 border-t border-line flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold gap-1 bg-surface border-line"
                onClick={() => adicionarLinhas(1)}
              >
                <Plus className="h-3.5 w-3.5 text-accent" />
                + 1 Linha
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold gap-1 bg-surface border-line"
                onClick={() => adicionarLinhas(5)}
              >
                <Plus className="h-3.5 w-3.5 text-accent" />
                + 5 Linhas
              </Button>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono text-text-dim">
              <span>
                Total de Linhas: <strong className="text-foreground">{linhasPlanilha.length}</strong>
              </span>
              <span>·</span>
              <span>
                Notas Válidas: <strong className="text-accent">{totalPreenchidas}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Resumo de Deduções de Notas Mães Detectadas */}
        {ajustesMaes.length > 0 && (
          <div className="p-3.5 bg-surface-2 rounded-lg border border-line flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-accent" />
                <span className="text-xs font-semibold text-foreground">
                  Notas Mães Detectadas na Planilha ({ajustesMaes.length})
                </span>
              </div>
              {onToggleDescontarMaes && (
                <label className="flex items-center gap-2 text-xs text-text-dim cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={descontarMaes}
                    onChange={(e) => onToggleDescontarMaes(e.target.checked)}
                    className="rounded border-line text-accent focus:ring-accent"
                  />
                  <span className="font-semibold text-foreground">
                    Descontar medidas das Notas Mães automaticamente no banco de dados
                  </span>
                </label>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-0.5">
              {ajustesMaes.map((aj) => (
                <div
                  key={aj.numeroMae}
                  className="px-2.5 py-1.5 bg-surface rounded border border-line text-xs font-mono flex items-center gap-1.5"
                >
                  <span className="font-bold text-accent">Mãe #{aj.numeroMae}:</span>
                  <span className="text-text-mute">{aj.medidaAtual}</span>
                  <span>➔</span>
                  <span className="font-bold text-foreground">{aj.novaMedida}</span>
                  <span className="text-red font-semibold text-[11px]">(-{aj.deducao})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rodapé de Ações e Salvamento */}
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-line flex-wrap">
          <div className="flex items-center gap-2 text-xs text-text-dim">
            {totalPreenchidas > 0 ? (
              <span className="flex items-center gap-1.5 text-green">
                <CheckCircle2 className="h-4 w-4" />
                {totalPreenchidas} nota(s) pronta(s) para integração no banco.
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-text-mute">
                <AlertCircle className="h-4 w-4" />
                Preencha o Nº da Nota nas linhas ou cole (Ctrl+V) do Excel.
              </span>
            )}
          </div>

          <Button
            disabled={salvando || totalPreenchidas === 0}
            onClick={onSalvar}
            size="sm"
            className="h-9 px-5 text-xs font-semibold gap-1.5"
          >
            💾 {salvando ? 'Salvando...' : rotuloSalvar || `Salvar Lote (${totalPreenchidas})`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
