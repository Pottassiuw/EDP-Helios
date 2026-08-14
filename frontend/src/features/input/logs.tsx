import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  PlusCircle,
  Search,
  Trash2,
  User,
  Mail,
} from 'lucide-react';
import { InputApi } from './api';
import type { LogArquivo, LogRegistro } from './types';
import { formatarDataHora } from './lib';
import { SegTabs, type SegTab } from '@/components/branded/section';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { NotificacaoModal } from './notificacao-modal';

type SubAba = 'notas' | 'arquivos' | 'timeline';
type TipoAcao = 'todos' | 'criacao' | 'edicao' | 'exclusao';

const LOG_TABS: SegTab<SubAba>[] = [
  { id: 'notas', rotulo: 'Alterações nas Notas' },
  { id: 'arquivos', rotulo: 'Bases de Apoio' },
  { id: 'timeline', rotulo: 'Linha do Tempo' },
];


function ehCriacao(campo: string): boolean {
  const c = campo.toUpperCase();
  return c.includes('CRIAÇÃO') || c.includes('INSERÇÃO');
}

function ehExclusao(campo: string): boolean {
  const c = campo.toUpperCase();
  return c.includes('EXCLUSÃO') || c.includes('APAGADO');
}

function parseNotasBusca(texto: string): string[] {
  const raw = texto.trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;\n\t]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function Logs(): React.JSX.Element {
  const [sub, setSub] = React.useState<SubAba>('notas');
  const [filtroNota, setFiltroNota] = React.useState('');
  const [filtroUsuario, setFiltroUsuario] = React.useState('');
  const [filtroTipo, setFiltroTipo] = React.useState<TipoAcao>('todos');
  const [notaTimeline, setNotaTimeline] = React.useState('');
  const [modalNotificacao, setModalNotificacao] = React.useState(false);

  const logs = useQuery({ queryKey: ['input-logs'], queryFn: InputApi.logs });
  const logsArquivos = useQuery({ queryKey: ['input-logs-arquivos'], queryFn: InputApi.logsArquivos });

  const todosLogs: LogRegistro[] = logs.data?.registros ?? [];
  const termosNotas = React.useMemo(() => parseNotasBusca(filtroNota), [filtroNota]);
  const termosTimeline = React.useMemo(() => parseNotasBusca(notaTimeline), [notaTimeline]);

  const registros: LogRegistro[] = React.useMemo(() => {
    return todosLogs.filter((r) => {
      const matchNota =
        termosNotas.length === 0 ||
        termosNotas.some((termo) => String(r.Numero_Nota).includes(termo));

      const matchUsuario =
        filtroUsuario === '' || r.Usuario === filtroUsuario;

      let matchTipo = true;
      if (filtroTipo === 'criacao') matchTipo = ehCriacao(r.Campo_Alterado);
      else if (filtroTipo === 'exclusao') matchTipo = ehExclusao(r.Campo_Alterado);
      else if (filtroTipo === 'edicao') matchTipo = !ehCriacao(r.Campo_Alterado) && !ehExclusao(r.Campo_Alterado);

      return matchNota && matchUsuario && matchTipo;
    });
  }, [todosLogs, termosNotas, filtroUsuario, filtroTipo]);

  const logsTimelineFiltrados = React.useMemo(() => {
    if (termosTimeline.length === 0) return [];
    return todosLogs.filter((r) =>
      termosTimeline.some((termo) => String(r.Numero_Nota).includes(termo)),
    );
  }, [todosLogs, termosTimeline]);

  const usuarios = React.useMemo(() => {
    const s = new Set<string>();
    for (const r of todosLogs) if (r.Usuario) s.add(r.Usuario);
    return Array.from(s).sort();
  }, [todosLogs]);

  const stats = React.useMemo(() => {
    let criacoes = 0;
    let exclusoes = 0;
    let edicoes = 0;
    for (const r of todosLogs) {
      if (ehCriacao(r.Campo_Alterado)) criacoes++;
      else if (ehExclusao(r.Campo_Alterado)) exclusoes++;
      else edicoes++;
    }
    return { total: todosLogs.length, criacoes, exclusoes, edicoes };
  }, [todosLogs]);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      <NotificacaoModal aberto={modalNotificacao} onFechar={() => setModalNotificacao(false)} />
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-xs">
        <div className="flex items-center gap-3">
          <SegTabs tabs={LOG_TABS} value={sub} onChange={setSub} ariaLabel="Tipo de log" />
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs font-semibold gap-1.5 border-line hover:border-accent hover:text-accent"
            onClick={() => setModalNotificacao(true)}
            title="Consolidar e enviar notificações diárias aos engenheiros por regional"
          >
            <Mail className="h-3.5 w-3.5 text-accent" />
            Notificar Engenheiros
          </Button>
        </div>

        {sub === 'notas' && (
          <div className="flex items-center gap-2 text-xs flex-wrap">
            <span className="px-2.5 py-1 rounded-full bg-surface-2 text-text-mute font-mono border border-line">
              Total: <strong className="text-foreground">{stats.total}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-full bg-green/15 text-green dark:text-green-2 font-mono font-semibold border border-green/30">
              + {stats.criacoes} criações
            </span>
            <span className="px-2.5 py-1 rounded-full bg-accent/15 text-accent font-mono font-semibold border border-accent/30">
              ✎ {stats.edicoes} edições
            </span>
            <span className="px-2.5 py-1 rounded-full bg-red/15 text-red dark:text-red-2 font-mono font-semibold border border-red/30">
              ✕ {stats.exclusoes} exclusões
            </span>
          </div>
        )}
      </div>

      {sub === 'notas' && (
        <React.Fragment>
          <div className="flex items-center gap-3 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-xs">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-mute" />
              <Input
                value={filtroNota}
                placeholder="Buscar nota(s) (ex: 1001, 1002 ou cole do Excel)..."
                className="pl-8 h-9 text-xs bg-bg-2 border-line font-mono"
                onChange={(e) => setFiltroNota(e.target.value)}
              />
            </div>

            {termosNotas.length > 1 && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-accent/15 text-accent font-mono font-semibold border border-accent/30">
                {termosNotas.length} notas no filtro
              </span>
            )}

            <Select
              value={filtroUsuario || '__todos'}
              onValueChange={(v) => setFiltroUsuario(v === '__todos' ? '' : v)}
            >
              <SelectTrigger className="w-48 h-9 text-xs bg-bg-2 border-line">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos os usuários</SelectItem>
                {usuarios.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filtroTipo}
              onValueChange={(v) => setFiltroTipo(v as TipoAcao)}
            >
              <SelectTrigger className="w-44 h-9 text-xs bg-bg-2 border-line">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os eventos</SelectItem>
                <SelectItem value="criacao">Apenas Criações (+)</SelectItem>
                <SelectItem value="edicao">Apenas Edições (✎)</SelectItem>
                <SelectItem value="exclusao">Apenas Exclusões (✕)</SelectItem>
              </SelectContent>
            </Select>

            {(filtroNota || filtroUsuario || filtroTipo !== 'todos') && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2.5 text-xs text-text-mute hover:text-foreground"
                onClick={() => {
                  setFiltroNota('');
                  setFiltroUsuario('');
                  setFiltroTipo('todos');
                }}
              >
                Limpar filtros
              </Button>
            )}
          </div>

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {['Nº Nota', 'Usuário', 'Data e Hora', 'Evento / Campo Alterado', 'Valor Antigo', 'Valor Novo'].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 font-mono font-medium text-text-mute uppercase text-[10px]"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {registros.slice(0, 500).map((r) => {
                  const criacao = ehCriacao(r.Campo_Alterado);
                  const exclusao = ehExclusao(r.Campo_Alterado);

                  return (
                    <tr
                      key={r.ID_Log}
                      className={`even:bg-[var(--zebra)] hover:bg-accent-tint/40 transition-colors ${
                        criacao ? 'bg-green/5' : exclusao ? 'bg-red/5' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5 font-mono font-bold text-accent" style={{ color: "var(--accent, #3ecf8e)" }}>
                        {r.Numero_Nota}
                      </td>
                      <td className="px-3 py-2.5 text-foreground font-medium flex items-center gap-1.5">
                        <User className="h-3 w-3 text-text-mute shrink-0" />
                        <span>{r.Usuario}</span>
                      </td>
                      <td className="px-3 py-2.5 text-text-dim font-mono">
                        {formatarDataHora(r.Data_Hora)}
                      </td>
                      <td className="px-3 py-2.5">
                        {criacao ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-green/15 text-green dark:text-green-2 border border-green/30">
                            <PlusCircle className="h-3 w-3 shrink-0" />
                            Criação de Nota
                          </span>
                        ) : exclusao ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-red/15 text-red dark:text-red-2 border border-red/30">
                            <Trash2 className="h-3 w-3 shrink-0" />
                            Exclusão de Nota
                          </span>
                        ) : (
                          <span className="font-semibold text-foreground">
                            {r.Campo_Alterado}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text-mute font-mono max-w-[200px] truncate">
                        {r.Valor_Antigo || '—'}
                      </td>
                      <td className="px-3 py-2.5 font-mono max-w-[300px] truncate">
                        {criacao ? (
                          <span className="text-green dark:text-green-2 font-medium">
                            {r.Valor_Novo || '—'}
                          </span>
                        ) : exclusao ? (
                          <span className="text-red dark:text-red-2 font-medium">
                            {r.Valor_Novo || '—'}
                          </span>
                        ) : (
                          <span className="text-foreground font-semibold">
                            {r.Valor_Novo || '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {registros.length === 0 && (
              <div className="p-8 text-center text-text-mute text-xs italic">
                Nenhum registro de alteração localizado com os filtros selecionados.
              </div>
            )}
          </div>
        </React.Fragment>
      )}

      {sub === 'arquivos' && (
        <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-xs">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-line">
                {['Arquivo', 'Usuário', 'Data e Hora', 'Ação Realizada'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 font-mono font-medium text-text-mute uppercase text-[10px]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(logsArquivos.data?.registros ?? []).map((r: LogArquivo) => (
                <tr
                  key={r.ID_Log}
                  className="even:bg-[var(--zebra)] hover:bg-accent-tint/40 transition-colors"
                >
                  <td className="px-3 py-2 font-mono font-medium text-foreground flex items-center gap-1.5">
                    <FileText className="h-3 w-3 text-accent shrink-0" />
                    <span>{r.Nome_Arquivo}</span>
                  </td>
                  <td className="px-3 py-2 text-text-dim">{r.Usuario}</td>
                  <td className="px-3 py-2 text-text-dim font-mono">
                    {formatarDataHora(r.Data_Hora)}
                  </td>
                  <td className="px-3 py-2 text-accent font-medium">{r.Acao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'timeline' && (
        <React.Fragment>
          <div className="flex items-center gap-3 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-xs">
            <div className="relative flex-1 min-w-[260px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-mute" />
              <Input
                value={notaTimeline}
                placeholder="Digite ou cole nota(s) (ex: 1001234, 1001235)..."
                className="pl-8 h-9 text-xs bg-bg-2 border-line font-mono"
                onChange={(e) => setNotaTimeline(e.target.value)}
              />
            </div>
            {termosTimeline.length > 0 && (
              <span className="text-[11px] px-2.5 py-1 rounded-full bg-accent/15 text-accent font-mono font-semibold border border-accent/30">
                {logsTimelineFiltrados.length} evento(s) em {termosTimeline.length} nota(s)
              </span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            {logsTimelineFiltrados.map((r) => {
              const criacao = ehCriacao(r.Campo_Alterado);
              const exclusao = ehExclusao(r.Campo_Alterado);

              return (
                <Card
                  key={r.ID_Log}
                  className={`border border-line bg-surface shadow-xs ${
                    criacao
                      ? 'border-l-4 border-l-green'
                      : exclusao
                        ? 'border-l-4 border-l-red'
                        : 'border-l-4 border-l-accent'
                  }`}
                >
                  <CardContent className="p-4 flex flex-col gap-2">
                    <div className="text-xs text-text-dim flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-accent text-sm">
                          Nota #{r.Numero_Nota}
                        </span>
                        <span className="font-mono text-text-dim text-[11px]">
                          {formatarDataHora(r.Data_Hora)}
                        </span>
                      </div>
                      <span className="text-text-mute font-mono text-[11px] flex items-center gap-1">
                        <User className="h-3 w-3 text-text-mute" />
                        {r.Usuario}
                      </span>
                    </div>

                    <div className="text-xs text-foreground mt-0.5">
                      {criacao ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-green/15 text-green dark:text-green-2 border border-green/30">
                            <PlusCircle className="h-3 w-3 shrink-0" />
                            Nota Inserida no Sistema
                          </span>
                          <span className="font-mono text-text-dim">
                            {r.Valor_Novo}
                          </span>
                        </div>
                      ) : exclusao ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-red/15 text-red dark:text-red-2 border border-red/30">
                            <Trash2 className="h-3 w-3 shrink-0" />
                            Nota Excluída do Banco
                          </span>
                          <span className="font-mono text-text-dim">
                            {r.Valor_Novo}
                          </span>
                        </div>
                      ) : (
                        <div>
                          Alterou <strong className="text-accent">{r.Campo_Alterado}</strong> de{' '}
                          <code className="bg-bg-2 px-1.5 py-0.5 rounded text-text-mute font-mono">
                            {r.Valor_Antigo || '—'}
                          </code>{' '}
                          para{' '}
                          <code className="bg-green/10 text-green dark:text-green-2 px-1.5 py-0.5 rounded font-mono font-semibold">
                            {r.Valor_Novo || '—'}
                          </code>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {termosTimeline.length > 0 && logsTimelineFiltrados.length === 0 && (
              <div className="p-8 text-center text-text-mute text-xs italic bg-surface rounded-lg border border-line">
                Nenhum histórico de alteração localizado para as notas pesquisadas ({termosTimeline.join(', ')}).
              </div>
            )}

            {termosTimeline.length === 0 && (
              <div className="p-8 text-center text-text-mute text-xs italic bg-surface rounded-lg border border-line">
                Digite um ou mais números de notas acima para visualizar a linha do tempo cronológica.
              </div>
            )}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}

