import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { InputApi } from './api';
import type { LogArquivo, LogRegistro } from './types';
import { formatarDataHora } from './lib';
import { SegTabs, type SegTab } from '@/components/branded/section';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

type SubAba = 'notas' | 'arquivos' | 'timeline';

const LOG_TABS: SegTab<SubAba>[] = [
  { id: 'notas', rotulo: 'Alterações nas Notas' },
  { id: 'arquivos', rotulo: 'Bases de Apoio' },
  { id: 'timeline', rotulo: 'Linha do Tempo' },
];

export function Logs(): React.JSX.Element {
  const [sub, setSub] = React.useState<SubAba>('notas');
  const [filtroNota, setFiltroNota] = React.useState('');
  const [filtroUsuario, setFiltroUsuario] = React.useState('');
  const [notaTimeline, setNotaTimeline] = React.useState('');

  const logs = useQuery({ queryKey: ['input-logs'], queryFn: InputApi.logs });
  const logsArquivos = useQuery({ queryKey: ['input-logs-arquivos'], queryFn: InputApi.logsArquivos });
  const numeroTimeline = /^\d+$/.test(notaTimeline) ? Number(notaTimeline) : null;
  const timeline = useQuery({
    queryKey: ['input-timeline', numeroTimeline],
    queryFn: () => InputApi.timeline(numeroTimeline as number),
    enabled: numeroTimeline !== null,
  });

  const registros: LogRegistro[] = (logs.data?.registros ?? []).filter((r) =>
    (filtroNota === '' || String(r.Numero_Nota) === filtroNota.trim()) &&
    (filtroUsuario === '' || r.Usuario === filtroUsuario));
  const usuarios = [...new Set((logs.data?.registros ?? []).map((r) => r.Usuario))].sort();

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      <div className="flex items-center justify-between gap-4 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
        <SegTabs tabs={LOG_TABS} value={sub} onChange={setSub} ariaLabel="Tipo de log" />
      </div>

      {sub === 'notas' && (
        <React.Fragment>
          <div className="flex items-center gap-3 flex-wrap bg-surface p-4 rounded-lg border border-line shadow-sm">
            <Input
              value={filtroNota}
              placeholder="Filtrar por nº da nota..."
              className="w-64 h-9 text-xs bg-bg-2 border-line font-mono"
              onChange={(e) => setFiltroNota(e.target.value)}
            />
            <Select value={filtroUsuario || "__todos"} onValueChange={(v) => setFiltroUsuario(v === "__todos" ? "" : v)}>
              <SelectTrigger className="w-56 h-9 text-xs bg-bg-2 border-line">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__todos">Todos os usuários</SelectItem>
                {usuarios.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-surface-2 border-b border-line">
                  {['Nº Nota', 'Usuário', 'Data e Hora', 'Campo Alterado', 'Valor Antigo', 'Valor Novo']
                    .map((h) => (
                      <th key={h} className="px-3 py-2.5 font-mono font-medium text-text-mute uppercase text-[10px]">
                        {h}
                      </th>
                    ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {registros.slice(0, 500).map((r) => (
                  <tr key={r.ID_Log} className="even:bg-[var(--zebra)] hover:bg-accent-tint/40 transition-colors">
                    <td className="px-3 py-2 font-mono font-semibold text-accent">{r.Numero_Nota}</td>
                    <td className="px-3 py-2 text-foreground font-medium">{r.Usuario}</td>
                    <td className="px-3 py-2 text-text-dim font-mono">{formatarDataHora(r.Data_Hora)}</td>
                    <td className="px-3 py-2 text-foreground font-medium">{r.Campo_Alterado}</td>
                    <td className="px-3 py-2 text-text-mute font-mono max-w-[200px] truncate">{r.Valor_Antigo || '—'}</td>
                    <td className="px-3 py-2 text-green font-mono max-w-[200px] truncate">{r.Valor_Novo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {registros.length === 0 && (
              <div className="p-8 text-center text-text-mute text-xs italic">
                Nenhum registro de alteração encontrado.
              </div>
            )}
          </div>
        </React.Fragment>
      )}

      {sub === 'arquivos' && (
        <div className="rounded-lg border border-line bg-surface overflow-hidden shadow-sm">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-2 border-b border-line">
                {['Arquivo', 'Usuário', 'Data e Hora', 'Ação Realizada'].map((h) => (
                  <th key={h} className="px-3 py-2.5 font-mono font-medium text-text-mute uppercase text-[10px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(logsArquivos.data?.registros ?? []).map((r: LogArquivo) => (
                <tr key={r.ID_Log} className="even:bg-[var(--zebra)] hover:bg-accent-tint/40 transition-colors">
                  <td className="px-3 py-2 font-mono font-medium text-foreground">{r.Nome_Arquivo}</td>
                  <td className="px-3 py-2 text-text-dim">{r.Usuario}</td>
                  <td className="px-3 py-2 text-text-dim font-mono">{formatarDataHora(r.Data_Hora)}</td>
                  <td className="px-3 py-2 text-accent font-medium">{r.Acao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sub === 'timeline' && (
        <React.Fragment>
          <div className="bg-surface p-4 rounded-lg border border-line shadow-sm">
            <Input
              value={notaTimeline}
              placeholder="Digite o nº da nota (ex: 100123456)..."
              className="w-64 h-9 text-xs bg-bg-2 border-line font-mono"
              onChange={(e) => setNotaTimeline(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-3">
            {(timeline.data?.registros ?? []).map((r) => (
              <Card key={r.ID_Log} className="border border-line bg-surface shadow-sm">
                <CardContent className="p-4 flex flex-col gap-1">
                  <div className="text-xs text-text-dim flex items-center justify-between">
                    <span className="font-mono font-medium text-foreground">{formatarDataHora(r.Data_Hora)}</span>
                    <span className="text-text-mute font-mono text-[11px]">Usuário: {r.Usuario}</span>
                  </div>
                  <div className="text-xs text-foreground mt-1">
                    Alterou <strong className="text-accent">{r.Campo_Alterado}</strong> de <code className="bg-bg-2 px-1.5 py-0.5 rounded text-text-mute font-mono">{r.Valor_Antigo || '—'}</code[...]
                  </div>
                </CardContent>
              </Card>
            ))}
            {numeroTimeline !== null && timeline.data?.registros.length === 0 && (
              <div className="p-6 text-center text-text-mute text-xs italic bg-surface rounded-lg border border-line">
                Nenhum histórico de alteração localizado para a nota {numeroTimeline}.
              </div>
            )}
          </div>
        </React.Fragment>
      )}
    </div>
  );
}
