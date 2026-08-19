import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InputDataset } from './types';
import { getUsuario, InputApi, setUsuario } from './api';
import { toast } from 'sonner';
import { useRecarregarInput } from './use-input-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Eyebrow } from '@/components/branded/section';
import { useDashboardRelatorios } from '../relatorios/use-dashboard';
import { RefreshCw, UserCheck, Download, Upload, Plus, Trash2, CheckCircle2, Bot } from 'lucide-react';

function Cartao({ titulo, eyebrow, children }: { titulo: string; eyebrow?: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <Card className="border border-line bg-surface shadow-sm">
      <CardHeader className="pb-3">
        {eyebrow && <Eyebrow className="text-xs tracking-wider">{eyebrow}</Eyebrow>}
        <CardTitle className="text-base font-semibold text-foreground">{titulo}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function Settings({ dados }: { dados: InputDataset }): React.JSX.Element {
  const recarregar = useRecarregarInput();
  const queryClient = useQueryClient();
  const [msg, setMsg] = React.useState('');
  const [nome, setNome] = React.useState(getUsuario() ?? '');
  const [linhasResp, setLinhasResp] = React.useState<[string, string][] | null>(null);
  const [linhasEmail, setLinhasEmail] = React.useState<[string, string][] | null>(null);
  const [sincronizando, setSincronizando] = React.useState(false);
  const [sincronizandoSap, setSincronizandoSap] = React.useState(false);

  const responsaveis = useQuery({ queryKey: ['input-resp'], queryFn: InputApi.responsaveis });
  const emailsQuery = useQuery({ queryKey: ['input-emails-resp'], queryFn: InputApi.obterEmailsResponsaveis });
  const backups = useQuery({ queryKey: ['input-backups'], queryFn: InputApi.backups });
  const dashboard = useDashboardRelatorios(null);

  function sincronizarMetas(): void {
    setSincronizando(true);
    const p = InputApi.sincronizarMetas().finally(() => setSincronizando(false));
    toast.promise(p, {
      loading: 'Sincronizando metas...',
      success: 'Metas sincronizadas',
      error: (e) => `Falha ao sincronizar: ${e instanceof Error ? e.message : String(e)}`,
    });
    void p.then(() => queryClient.invalidateQueries({ queryKey: ['relatorios-dashboard'] }), () => { /* toast informou erro */ });
  }

  function dispararSap(): void {
    setSincronizandoSap(true);
    const p = InputApi.syncSap().finally(() => setSincronizandoSap(false));
    toast.promise(p, {
      loading: 'Iniciando extração SAP em background...',
      success: 'Extração SAP iniciada em background.',
      error: (e) => `Falha ao iniciar extração SAP: ${e instanceof Error ? e.message : String(e)}`,
    });
    void p.then(
      () => {
        void recarregar();
      },
      () => { /* toast informou erro */ },
    );
  }

  const linhas = linhasResp ?? Object.entries(responsaveis.data ?? {});
  const linhasEmailsAtuais = linhasEmail ?? Object.entries(emailsQuery.data ?? {});

  async function agir(fn: () => Promise<unknown>, ok: string): Promise<void> {
    setMsg('');
    try { await fn(); setMsg(ok); toast.success(ok); }
    catch (e) { const t = e instanceof Error ? e.message : String(e); setMsg(`Erro: ${t}`); toast.error('Falha na operação', { description: t }); }
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-full">
      {msg && (
        <div className="p-3 rounded-md bg-green/10 border border-green/20 text-green text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-green" />
          <span>{msg}</span>
        </div>
      )}

      <Cartao eyebrow="Integração de Metas" titulo="Metas do Plano de Recomposição">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <span className="text-xs text-text-dim">
            {dashboard.data?.metas_info.atualizadas_em
              ? `Última sincronização com SharePoint/Databricks: ${new Date(dashboard.data.metas_info.atualizadas_em).toLocaleString('pt-BR')}`
              : 'Ainda não sincronizado.'}
          </span>
          <Button variant="outline" size="sm" className="h-9 text-xs" disabled={sincronizando} onClick={sincronizarMetas}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${sincronizando ? 'animate-spin' : ''}`} />
            {sincronizando ? 'Sincronizando...' : 'Sincronizar Agora'}
          </Button>
        </div>
        {dashboard.data?.metas_info.erro && (
          <p className="text-xs text-red mt-2">{dashboard.data.metas_info.erro}</p>
        )}
      </Cartao>

      <Cartao eyebrow="Automação SAP" titulo="Extração de Bases SAP (Sap Robot)">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex flex-col gap-1 max-w-xl">
            <span className="text-xs text-text-dim">
              Dispara a extração automatizada das bases IW28, IW38 e IW66 no SAP GUI em segundo plano e atualiza as bases locais.
            </span>
            <span className="text-[11.5px] text-text-mute">
              Nota: Conecta-se automaticamente à sessão do SAP GUI aberta ou utiliza credenciais do sistema.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            disabled={sincronizandoSap}
            onClick={dispararSap}
          >
            <Bot className={`mr-1.5 h-3.5 w-3.5 ${sincronizandoSap ? 'animate-spin' : ''}`} />
            {sincronizandoSap ? 'Executando...' : 'Executar Robô SAP'}
          </Button>
        </div>
      </Cartao>

      <Cartao eyebrow="Identificação" titulo="Seu Nome (Log de Auditoria)">
        <div className="flex items-center gap-3">
          <Input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Digite seu nome..."
            className="w-72 h-9 text-xs bg-bg-2 border-line font-medium"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-4 text-xs"
            disabled={!nome.trim()}
            onClick={() => { setUsuario(nome); setMsg('Nome atualizado com sucesso.'); toast.success('Nome atualizado.'); }}
          >
            <UserCheck className="mr-1.5 h-3.5 w-3.5" />
            Salvar Nome
          </Button>
        </div>
      </Cartao>

      <Cartao eyebrow="Mapeamento Operacional" titulo="Responsáveis por Conjunto / Regional">
        <p className="text-xs text-text-dim mb-3">
          Mapeia os engenheiros responsáveis pelas notas de cada conjunto/regional. Para atribuir mais de um engenheiro na mesma área, separe os nomes por vírgula (ex: <code className="font-mono text-foreground font-semibold">Fabricio, Danilo</code>).
        </p>
        <div className="flex flex-col gap-2 mb-4">
          {linhas.map(([conjunto, pessoa], i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={conjunto}
                placeholder="Conjunto / Regional (ex: Mogi das Cruzes)"
                className="w-56 h-9 text-xs bg-bg-2 border-line font-mono"
                onChange={(e) => { const c = [...linhas] as [string, string][]; c[i] = [e.target.value, pessoa]; setLinhasResp(c); }}
              />
              <Input
                value={pessoa}
                placeholder="Responsável(is) (ex: Fabricio, Danilo)"
                className="w-72 h-9 text-xs bg-bg-2 border-line font-medium"
                onChange={(e) => { const c = [...linhas] as [string, string][]; c[i] = [conjunto, e.target.value]; setLinhasResp(c); }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-text-mute hover:text-red"
                aria-label={`Remover responsável ${conjunto || i + 1}`}
                onClick={() => setLinhasResp(linhas.filter((_, j) => j !== i) as [string, string][])}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t border-line">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-accent"
            onClick={() => setLinhasResp([...linhas, ['', '']] as [string, string][])}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Adicionar Conjunto
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-4 text-xs"
            onClick={() => { void agir(async () => {
              await InputApi.salvarResponsaveis(Object.fromEntries(linhas.filter(([c]) => c.trim() !== '')));
              await responsaveis.refetch(); setLinhasResp(null);
            }, 'Mapeamento de responsáveis atualizado.'); }}
          >
            Salvar Alterações
          </Button>
        </div>
      </Cartao>

      <Cartao eyebrow="Comunicação & Notificações" titulo="E-mails dos Engenheiros Responsáveis">
        <div className="flex flex-col gap-2 mb-4">
          {linhasEmailsAtuais.map(([pessoa, email], i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                value={pessoa}
                placeholder="Nome do Engenheiro (ex: James)"
                className="w-56 h-9 text-xs bg-bg-2 border-line font-semibold"
                onChange={(e) => {
                  const c = [...linhasEmailsAtuais] as [string, string][];
                  c[i] = [e.target.value, email];
                  setLinhasEmail(c);
                }}
              />
              <Input
                value={email}
                placeholder="E-mail (ex: james.junior@edp.com)"
                className="w-80 h-9 text-xs bg-bg-2 border-line font-mono"
                onChange={(e) => {
                  const c = [...linhasEmailsAtuais] as [string, string][];
                  c[i] = [pessoa, e.target.value];
                  setLinhasEmail(c);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-text-mute hover:text-red"
                aria-label={`Remover e-mail de ${pessoa || i + 1}`}
                onClick={() => setLinhasEmail(linhasEmailsAtuais.filter((_, j) => j !== i) as [string, string][])}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2 border-t border-line">
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs text-accent"
            onClick={() => setLinhasEmail([...linhasEmailsAtuais, ['', '']] as [string, string][])}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Adicionar Engenheiro
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-4 text-xs"
            onClick={() => {
              void agir(async () => {
                await InputApi.gravarEmailsResponsaveis(
                  Object.fromEntries(linhasEmailsAtuais.filter(([p]) => p.trim() !== ''))
                );
                await emailsQuery.refetch();
                setLinhasEmail(null);
              }, 'E-mails dos engenheiros responsáveis atualizados.');
            }}
          >
            Salvar E-mails
          </Button>
        </div>
      </Cartao>

      <Cartao eyebrow="Rede Corporativa" titulo="Bases de Apoio (Rede EDP)">
        <div className="flex flex-col gap-2.5 mb-3">
          {dados.meta.bases.map((b) => {
            const gerenciavel = !b.arquivo.startsWith('Gerada_');
            return (
              <div key={b.arquivo} className="flex gap-3 items-center justify-between p-3 rounded-md bg-bg-2/40 border border-line text-xs flex-wrap">
                <div className="flex items-center gap-2.5">
                  <div className={`h-2 w-2 rounded-full ${b.encontrada ? 'bg-green' : 'bg-red'}`} />
                  <span className="font-semibold text-foreground">{b.nome}</span>
                  <span className="font-mono text-text-mute">({b.arquivo})</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${b.encontrada ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
                    {b.encontrada ? 'Conectada' : 'Indisponível'}
                  </span>
                  {gerenciavel && b.encontrada && (
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                      <a href={InputApi.urlDownloadBase(b.arquivo)} download>
                        <Download className="mr-1.5 h-3 w-3" />
                        Baixar
                      </a>
                    </Button>
                  )}
                  {gerenciavel && (
                    <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                      <label className="cursor-pointer">
                        <Upload className="mr-1.5 h-3 w-3" />
                        Substituir
                        <input
                          type="file"
                          accept=".xlsx"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            if (!getUsuario()) { setMsg('Defina seu nome acima antes de substituir bases.'); return; }
                            if (!window.confirm(`Substituir "${b.arquivo}" na rede pelo arquivo "${f.name}"?`)) return;
                            void agir(async () => {
                              await InputApi.substituirBase(b.arquivo, f);
                              await recarregar();
                            }, `Base "${b.arquivo}" substituída.`);
                          }}
                        />
                      </label>
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11.5px] text-text-mute italic">
          Importante: Não altere o nome das abas ou os cabeçalhos das planilhas Excel — a engenharia do backend busca exatamente as colunas padrão.
        </p>
      </Cartao>

      <Cartao eyebrow="Segurança de Dados" titulo="Backups do Banco de Dados (SQLite Rotativo)">
        <div className="flex flex-col gap-2">
          {(backups.data?.backups ?? []).map((b) => (
            <div key={b.arquivo} className="flex gap-3 items-center justify-between p-2.5 rounded-md bg-bg-2/30 border border-line text-xs">
              <span className="font-mono text-foreground font-medium">{b.arquivo}</span>
              <div className="flex items-center gap-3">
                <span className="text-text-dim font-mono">{new Date(b.modificado).toLocaleString('pt-BR')} · {b.tamanho_mb} MB</span>
                <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                  <a href={InputApi.urlDownloadBackup(b.arquivo)} download>
                    <Download className="mr-1 h-3 w-3" />
                    Baixar
                  </a>
                </Button>
              </div>
            </div>
          ))}
          {(backups.data?.backups ?? []).length === 0 && (
            <span className="text-xs text-text-mute italic">
              Nenhum backup local localizado — o primeiro backup rotativo é gerado automaticamente na próxima edição.
            </span>
          )}
        </div>
      </Cartao>
    </div>
  );
}
