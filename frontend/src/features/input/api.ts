import type {
  BackupInfo, BaseStatus, Bloqueio, EdicaoResultado, HierarquiaInfo, InputDataset, LogArquivo,
  LogRegistro, NotaInput, NotaRamal, RamalDataset, TravarResultado,
} from './types';

const base = (): string => localStorage.getItem('edp_api') ?? '/api';

export function getUsuario(): string | null {
  return localStorage.getItem('edp_input_user');
}
export function setUsuario(nome: string): void {
  localStorage.setItem('edp_input_user', nome.trim());
}

async function req<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base()}/input${caminho}`, init);
  if (!r.ok) {
    const corpo = await r.text();
    let detalhe = corpo;
    try {
      const parsed = JSON.parse(corpo);
      if (typeof parsed.detail === 'string') {
        detalhe = parsed.detail;
      } else if (Array.isArray(parsed.detail)) {
        detalhe = parsed.detail
          .map((d: { loc?: unknown[]; msg?: string }) => {
            const campo = Array.isArray(d.loc) ? d.loc.slice(-1)[0] : '';
            return campo ? `${campo}: ${d.msg}` : (d.msg ?? JSON.stringify(d));
          })
          .join(' | ');
      } else if (parsed.message) {
        detalhe = String(parsed.message);
      }
    } catch { /* texto puro */ }
    throw new Error(detalhe || `HTTP ${r.status}`);
  }
  return r.json() as Promise<T>;
}

function escrita(method: string, corpo?: unknown): RequestInit {
  const usuario = getUsuario();
  return {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(usuario ? { 'X-User': usuario } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  };
}

export const InputApi = {
  me: () => req<{ usuario: string }>('/me'),
  dados: () => req<InputDataset>('/notas'),
  sync: () => req<{ ultima_alteracao: string | null; versao: string; sincronizando?: boolean }>('/sync'),

  editar: (linhas: Partial<NotaInput>[]) =>
    req<EdicaoResultado>('/notas', escrita('PATCH', { linhas })),
  criar: (nota: Partial<NotaInput>) =>
    req<{ inseridas: number }>('/notas', escrita('POST', nota)),
  criarLote: (notas: Partial<NotaInput>[]) =>
    req<{ inseridas: number }>('/notas/bulk', escrita('POST', { notas })),
  excluir: (numeros: number[], motivo?: string) =>
    req<{ excluidas: number }>('/notas', escrita('DELETE', { numeros, motivo })),
  desfazer: () =>
    req<{ ok: boolean; mensagem: string }>('/desfazer', escrita('POST', {})),

  bloqueios: () => req<{ bloqueios: Bloqueio[] }>('/bloqueios'),
  travarNota: (numero: number) =>
    req<TravarResultado>(`/notas/${numero}/travar`, escrita('POST', {})),
  destravarNotas: (numeros: number[]) =>
    req<{ liberadas: number }>('/notas/destravar', escrita('POST', { numeros })),

  logs: () => req<{ registros: LogRegistro[] }>('/logs'),
  logsArquivos: () => req<{ registros: LogArquivo[] }>('/logs/arquivos'),
  timeline: (numero: number) => req<{ registros: LogRegistro[] }>(`/logs/nota/${numero}`),

  responsaveis: () => req<Record<string, string>>('/responsaveis'),
  salvarResponsaveis: (mapa: Record<string, string>) =>
    req<{ ok: boolean }>('/responsaveis', escrita('PUT', mapa)),

  bases: () => req<{ bases: BaseStatus[] }>('/bases'),
  syncSap: () => req<{ mensagem: string }>('/bases/sync-sap', escrita('POST')),
  urlDownloadBase: (arquivo: string) => `${base()}/input/bases/${encodeURIComponent(arquivo)}/download`,
  substituirBase: async (arquivo: string, f: File): Promise<void> => {
    const usuario = getUsuario();
    const fd = new FormData();
    fd.append('arquivo', f);
    const r = await fetch(`${base()}/input/bases/${encodeURIComponent(arquivo)}`, {
      method: 'POST', headers: usuario ? { 'X-User': usuario } : {}, body: fd,
    });
    if (!r.ok) throw new Error(await r.text());
  },

  backups: () => req<{ backups: BackupInfo[] }>('/backups'),
  urlDownloadBackup: (nome: string) => `${base()}/input/backups/${encodeURIComponent(nome)}/download`,

  migrar: () => req<{ resultado: string }>('/migrar', escrita('POST')),

  // Fase 4a: o dashboard de Relatórios passou a derivar de CarteiraApi.dashboard
  // (superset). O endpoint /api/input/relatorios/dashboard segue vivo no backend
  // como compat, mas não é mais consumido pelo front — por isso o client foi
  // removido (CLAUDE.md: sem dead code).
  sincronizarMetas: () =>
    req<import('../relatorios/types').MetasInfo & { sincronizou: boolean }>(
      '/metas/sincronizar', escrita('POST')),

  ramal: () => req<RamalDataset>('/ramal'),
  importarRamal: (notas: Partial<NotaRamal>[]) =>
    req<{ inseridas: number }>('/ramal/bulk', escrita('POST', { notas })),
  excluirRamal: (numeros: number[]) =>
    req<{ excluidas: number }>('/ramal', escrita('DELETE', { numeros })),
  vincularHierarquia: (dados: Record<string, number[]>) =>
    req<{ atualizadas: number }>('/hierarquia', escrita('POST', { dados })),
  obterHierarquia: (numero: number) =>
    req<HierarquiaInfo>(`/hierarquia/${numero}`),

  executarRateio: (
    correcoes: Array<{ nota: number; quantidade: number; unidade: string }>,
    login_sap?: string,
    senha_sap?: string,
    modo_teste?: boolean,
  ) =>
    req<{
      relatorio: Array<{ Nota: number; Status: 'OK' | 'ERRO' | 'TESTE'; Mensagem: string }>;
    }>('/rateio/executar', escrita('POST', { correcoes, login_sap, senha_sap, modo_teste })),

  exportar: async (numeros: number[], colunas: string[]): Promise<Blob> => {
    const r = await fetch(`${base()}/input/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ numeros, colunas }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.blob();
  },
  obterStatus10Resumo: async (): Promise<import('./types').Status10Resumo> => {
    return req<import('./types').Status10Resumo>('/status10/resumo');
  },
  extrairSapStatus10: async (): Promise<{ ok: boolean; mensagem: string; total_notas?: number }> => {
    return req<{ ok: boolean; mensagem: string; total_notas?: number }>('/status10/extrair-sap', escrita('POST'));
  },
  enviarEmailStatus10: async (): Promise<{ ok: boolean; mensagem: string }> => {
    return req<{ ok: boolean; mensagem: string }>('/status10/enviar-email', escrita('POST'));
  },

  obterEmailsResponsaveis: () =>
    req<Record<string, string>>('/responsaveis/emails'),
  gravarEmailsResponsaveis: (novo: Record<string, string>) =>
    req<{ ok: boolean }>('/responsaveis/emails', escrita('PUT', novo)),

  obterResumoNotificacoesDiarias: (data?: string) =>
    req<import('./types').ResumoNotificacoesDiarias>(
      data ? `/notificacoes/resumo-diario?data=${encodeURIComponent(data)}` : '/notificacoes/resumo-diario'
    ),
  enviarEmailNotificacao: (engenheiro: string = '__todos__', data?: string) =>
    req<{ ok: boolean; mensagem: string; enviados?: number }>(
      '/notificacoes/enviar-email',
      escrita('POST', { engenheiro, data })
    ),
};

export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
