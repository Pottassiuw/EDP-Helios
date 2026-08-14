import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Mail,
  Send,
  Loader2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Building2,
} from 'lucide-react';
import { InputApi } from './api';
import type { ResumoNotificacoesDiarias } from './types';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/branded/section';

interface NotificacaoModalProps {
  aberto: boolean;
  onFechar: () => void;
}

export function NotificacaoModal({ aberto, onFechar }: NotificacaoModalProps): React.JSX.Element {
  const [dataSel, setDataSel] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [expandidos, setExpandidos] = React.useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = React.useState(false);

  const { data: resumo, isLoading, refetch } = useQuery<ResumoNotificacoesDiarias>({
    queryKey: ['notificacoes-resumo-diario', dataSel],
    queryFn: () => InputApi.obterResumoNotificacoesDiarias(dataSel),
    enabled: aberto,
  });

  const toggleExpandir = (eng: string): void => {
    setExpandidos((prev) => ({ ...prev, [eng]: !prev[eng] }));
  };

  const enviarEmail = async (engenheiro: string = '__todos__'): Promise<void> => {
    setEnviando(true);
    const rotulo = engenheiro === '__todos__' ? 'todos os engenheiros com alterações' : engenheiro;
    const p = InputApi.enviarEmailNotificacao(engenheiro, dataSel);

    toast.promise(p, {
      loading: `Gerando rascunho de e-mail no Outlook para ${rotulo}...`,
      success: (res) => res.mensagem || `E-mail gerado com sucesso no Outlook para ${rotulo}!`,
      error: (e) => `Erro ao gerar e-mail: ${e instanceof Error ? e.message : String(e)}`,
    });

    try {
      await p;
      await refetch();
    } catch {
      // toast já cuidou da mensagem de erro
    } finally {
      setEnviando(false);
    }
  };

  const listaEngenheiros = React.useMemo(() => {
    if (!resumo?.engenheiros) return [];
    return Object.values(resumo.engenheiros).sort((a, b) => b.total_alteracoes - a.total_alteracoes);
  }, [resumo]);

  const totalComAlteracao = listaEngenheiros.filter((e) => e.total_alteracoes > 0).length;

  return (
    <Dialog open={aberto} onOpenChange={(open) => { if (!open) onFechar(); }}>
      <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col p-6 overflow-hidden bg-surface border-line">
        <DialogHeader className="pb-3 border-b border-line shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <Eyebrow className="text-xs tracking-wider text-accent">Comunicação & Auditoria</Eyebrow>
              <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
                <Mail className="h-5 w-5 text-accent" />
                <span>Notificação Diária aos Engenheiros</span>
              </DialogTitle>
              <DialogDescription className="text-xs text-text-dim mt-0.5">
                Consolidação diária de notas editadas, vinculadas ou excluídas por regional para envio via Outlook.
              </DialogDescription>
            </div>

            <div className="flex items-center gap-2 bg-surface-2 px-3 py-1.5 rounded-lg border border-line">
              <Calendar className="h-4 w-4 text-text-mute" />
              <span className="text-xs text-text-dim font-medium">Data:</span>
              <Input
                type="date"
                value={dataSel}
                onChange={(e) => setDataSel(e.target.value)}
                className="h-8 text-xs bg-bg-2 border-line w-36 font-mono"
              />
            </div>
          </div>
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 gap-3 text-text-dim">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <span className="text-xs">Carregando alterações do dia...</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto flex flex-col gap-4 py-3 pr-1">
            {/* Cards de Resumo */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-surface-2 rounded-lg border border-line flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-text-mute font-semibold">Total de Alterações</span>
                <span className="text-xl font-bold font-mono text-foreground">{resumo?.total_alteracoes ?? 0}</span>
                <span className="text-[11px] text-text-dim">Eventos registrados no log nesta data</span>
              </div>

              <div className="p-3 bg-surface-2 rounded-lg border border-line flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-text-mute font-semibold">Notas Impactadas</span>
                <span className="text-xl font-bold font-mono text-accent">{resumo?.total_notas_afetadas ?? 0}</span>
                <span className="text-[11px] text-text-dim">Notas distintas alteradas no plano</span>
              </div>

              <div className="p-3 bg-surface-2 rounded-lg border border-line flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wider text-text-mute font-semibold">Engenheiros com Alterações</span>
                <span className={`text-xl font-bold font-mono ${totalComAlteracao > 0 ? 'text-green' : 'text-text-mute'}`}>
                  {totalComAlteracao} de {listaEngenheiros.length}
                </span>
                <span className="text-[11px] text-text-dim">
                  {totalComAlteracao > 0 ? 'Elegíveis para notificação hoje' : 'Nenhuma notificação necessária hoje'}
                </span>
              </div>
            </div>

            {/* Lista de Engenheiros */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Status por Engenheiro Responsável:
              </span>

              {listaEngenheiros.map((eng) => {
                const temAlteracoes = eng.total_alteracoes > 0;
                const expandido = expandidos[eng.engenheiro] ?? false;

                return (
                  <div
                    key={eng.engenheiro}
                    className={`rounded-lg border transition-colors ${
                      temAlteracoes ? 'border-line bg-surface-2/60' : 'border-line/60 bg-bg-2/30 opacity-75'
                    }`}
                  >
                    <div className="p-3.5 flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3">
                        <div
                          className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs ${
                            temAlteracoes ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-text-mute'
                          }`}
                        >
                          {eng.engenheiro.slice(0, 2).toUpperCase()}
                        </div>

                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground">{eng.engenheiro}</span>
                            <span className="text-xs text-text-dim font-mono">({eng.email || 'Sem e-mail cadastrado'})</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-[11.5px] text-text-dim flex-wrap">
                            <Building2 className="h-3 w-3 text-text-mute" />
                            <span>Regionais: <strong>{eng.regionais.join(', ') || 'Geral'}</strong></span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {temAlteracoes ? (
                          <React.Fragment>
                            <Badge variant="outline" className="bg-green/10 text-green border-green/30 text-xs px-2 py-0.5 font-medium">
                              {eng.total_alteracoes} alteração(ões) em {eng.total_notas_afetadas} nota(s)
                            </Badge>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 text-xs font-semibold gap-1.5 border-line hover:bg-surface hover:border-accent"
                              disabled={enviando}
                              onClick={() => void enviarEmail(eng.engenheiro)}
                              title={`Gerar rascunho de e-mail no Outlook para ${eng.engenheiro}`}
                            >
                              <Send className="h-3.5 w-3.5 text-accent" />
                              Gerar E-mail
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 px-2 text-text-dim"
                              onClick={() => toggleExpandir(eng.engenheiro)}
                              title={expandido ? 'Ocultar detalhes' : 'Ver detalhes das alterações'}
                            >
                              {expandido ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </React.Fragment>
                        ) : (
                          <span className="text-xs text-text-mute italic flex items-center gap-1.5 py-1">
                            <CheckCircle2 className="h-3.5 w-3.5 text-text-mute" />
                            Sem alterações nesta data
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Detalhes das alterações quando expandido */}
                    {expandido && temAlteracoes && (
                      <div className="p-3 pt-0 border-t border-line/60">
                        <div className="max-h-56 overflow-y-auto rounded border border-line bg-bg-2/70 mt-2">
                          <table className="w-full text-left text-xs border-collapse font-sans">
                            <thead>
                              <tr className="bg-surface-2 border-b border-line text-text-dim font-medium">
                                <th className="p-2 pl-3">Nº Nota</th>
                                <th className="p-2">Regional</th>
                                <th className="p-2">Conjunto</th>
                                <th className="p-2">Tipo</th>
                                <th className="p-2">Detalhe da Alteração</th>
                                <th className="p-2">Usuário</th>
                                <th className="p-2 pr-3">Horário</th>
                              </tr>
                            </thead>
                            <tbody>
                              {eng.alteracoes.map((item, idx) => (
                                <tr key={idx} className="border-b border-line/40 hover:bg-surface/50 transition-colors">
                                  <td className="p-2 pl-3 font-mono font-semibold text-accent">{item.Numero_Nota}</td>
                                  <td className="p-2 text-text-dim">{item.Regional}</td>
                                  <td className="p-2 text-text-dim">{item.Conjunto}</td>
                                  <td className="p-2">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10.5px] font-semibold ${
                                        item.Tipo_Evento.includes('Criação')
                                          ? 'bg-green/15 text-green'
                                          : item.Tipo_Evento.includes('Exclusão')
                                          ? 'bg-red/15 text-red'
                                          : item.Tipo_Evento.includes('Vínculo')
                                          ? 'bg-purple-500/15 text-purple-400'
                                          : 'bg-accent/15 text-accent'
                                      }`}
                                    >
                                      {item.Tipo_Evento}
                                    </span>
                                  </td>
                                  <td className="p-2 text-foreground font-mono text-[11.5px]">{item.Detalhe}</td>
                                  <td className="p-2 text-text-dim text-[11px]">{item.Usuario}</td>
                                  <td className="p-2 pr-3 text-text-mute font-mono text-[11px]">{item.Data_Hora.slice(11, 16)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="pt-3 border-t border-line flex items-center justify-between gap-3 shrink-0">
          <Button variant="outline" size="sm" className="h-9 px-4 text-xs" onClick={onFechar}>
            Fechar
          </Button>

          <Button
            size="sm"
            className="h-9 px-4 text-xs font-semibold gap-1.5"
            disabled={enviando || totalComAlteracao === 0}
            onClick={() => void enviarEmail('__todos__')}
          >
            {enviando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Gerar E-mails no Outlook para Todos com Alterações ({totalComAlteracao})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
