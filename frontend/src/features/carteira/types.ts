import type { DashboardRelatorios, LinhaBaseSemMeta } from '../relatorios/types';

export type SituacaoCarteira =
  | 'cancelada' | 'executada' | 'no_plano' | 'fora_do_plano';

export interface NotaCarteira {
  id_onr: number;
  id_sap: string | null;
  sap_real: number;
  conjunto: string | null;
  descricao_conjunto: string | null;
  regional: string | null;
  csd_origem: string | null;
  empresa: string | null;
  quantidade: number | null;
  quantidade_valida: number;
  prioridade: string | null;
  prioridade_sap: number | null;
  status_sap: string | null;
  data_encerramento_exec: string | null;
  local_instalacao: string | null;
  alimentador: string | null;
  executor: string | null;
  sintoma: string | null;
  situacao: SituacaoCarteira;
  ausente_na_origem_em: string | null;
}

export type EstadoCarteiraEnriquecimento =
  | 'encontrada'
  | 'ausente_na_origem'
  | 'sem_correspondencia'
  | 'base_nao_sincronizada';

export interface DadosCarteiraEnriquecimento {
  descricao_conjunto: string | null;
  conjunto: string | null;
  sintoma: string | null;
  componente_novo: string | null;
  kit: string | null;
  n_trafo: string | null;
  dispositivo_protecao: string | null;
  status_sap: string | null;
  prioridade_sap: number | null;
}

export interface AvisoCarteiraEnriquecimento {
  codigo: string;
  bloco: string;
  campos: Array<keyof DadosCarteiraEnriquecimento>;
  mensagem: string;
  acao: string;
}

export interface CarteiraEnriquecimento {
  numero_sap: number;
  estado: EstadoCarteiraEnriquecimento;
  dados: DadosCarteiraEnriquecimento | null;
  ausente_na_origem_em: string | null;
  avisos: AvisoCarteiraEnriquecimento[];
  versao: string;
}

export interface PaginaNotas {
  registros: NotaCarteira[];
  total: number;
  page: number;
  size: number;
  versao: string;
}

export interface ResumoCarteira {
  total: number;
  por_situacao: Record<string, number>;
  por_regional: Record<string, number>;
}

export interface ExecucaoSync {
  id?: number;
  estrategia: string;
  status: string;
  refresh_marker: string | null;
  iniciado_em?: string | null;
  finalizado_em?: string | null;
  novas: number;
  atualizadas: number;
  inalteradas: number;
  ausentes: number;
  erro: string | null;
  versao_resultante: string | null;
  duracao_seg?: number | null;
}

export interface MetricasCarteira {
  n_linhas: number;
  tamanho_mb: number;
  journal_mode: string;
}

export interface EstadoSync {
  ultimo_refresh_marker: string | null;
  execucoes: ExecucaoSync[];
  metricas?: MetricasCarteira;
}

export interface FiltrosCarteira {
  regional?: string;
  conjunto?: string;
  status_sap?: string;
  situacao?: SituacaoCarteira;
  sap_real?: number;
  q?: string;
  incluir_ausentes?: boolean;
}

export interface PropostaPlano {
  Numero_Nota: number;
  Conjunto: string;
  Local_Instalacao: string;
  Circuito: string;
  Prioridade_Nota: string;
  Planejado_DDPM: number;
  Status_Nota: string;
  Data_Envio_Projeto: string;
}

export interface PreviewItem {
  id_onr: number;
  numero_nota: string | null;
  movivel: boolean;
  motivo_bloqueio: string | null;
  proposta: PropostaPlano | null;
  avisos: string[];
}

export interface MoverPedido {
  id_onrs: number[];
  mes_execucao: string;
  status_obra?: string;
  observacao?: string;
  check?: string;
}

export interface MoverResultado {
  inseridas: number;
  lote_id: string;
}

export interface Movimentacao {
  id: number;
  id_onr: number;
  numero_nota: string;
  acao: string;
  usuario: string;
  lote_id: string;
  mes_execucao: string | null;
  status_obra: string | null;
  movido_em: string;
}

export type Divergencia = NotaCarteira & { tipo_divergencia: 'cancelada' | 'ausente_na_origem' };

export interface MesMensalizacao {
  mes: number;
  meta: number;
  carteira: number;
  executado: number;
}

// Fase 4a: o dashboard da Carteira e o de Relatórios convergem para um único
// contrato (superset). A base disponível vive dentro de visao_anual/regionais
// (ver relatorios/types.ts); a Carteira só acrescenta os extras abaixo.
export type DashboardCarteira = DashboardRelatorios & {
  base_por_plano_sem_meta: LinhaBaseSemMeta[];
  versao: string;
};
