export type Celula = string | number | null;

/** Uma nota enriquecida vinda de GET /api/input/notas (colunas dinâmicas). */
export interface NotaInput {
  Numero_Nota: number;
  [coluna: string]: Celula | undefined;
}

export interface BaseStatus {
  nome: string;
  arquivo: string;
  encontrada: boolean;
  modificada: string | null;
}

export interface InputMeta {
  status_opcoes: string[];
  prioridade_opcoes: string[];
  bases: BaseStatus[];
  ultima_alteracao: string | null;
  migracao: "ja-existe" | "migrado" | "rede-indisponivel";
  colunas: string[];
  versao: string;
  sincronizando?: boolean;
}

export interface InputDataset {
  registros: NotaInput[];
  meta: InputMeta;
}

export interface LogRegistro {
  ID_Log: number;
  Numero_Nota: number;
  Usuario: string;
  Data_Hora: string | number | null;
  Campo_Alterado: string;
  Valor_Antigo: string;
  Valor_Novo: string;
}

export interface LogArquivo {
  ID_Log: number;
  Nome_Arquivo: string;
  Usuario: string;
  Data_Hora: string | number | null;
  Acao: string;
}

export interface BackupInfo {
  arquivo: string;
  tamanho_mb: number;
  modificado: string;
}

export interface EdicaoResultado {
  alteradas: number;
  campos: number;
  /** Notas puladas por estarem travadas por outro usuário — não perdidas, seguem pendentes na UI. */
  bloqueadas: number[];
  ultima_alteracao: string | null;
}

/** Trava ativa de edição (tabela `bloqueios`, compartilhada com o banco da rede). */
export interface Bloqueio {
  Numero_Nota: number;
  Usuario: string;
  Data_Hora: string;
}

export interface TravarResultado {
  ok: boolean;
  usuario?: string;
  desde?: string;
}

export interface NotaRamal {
  Numero_Nota: number;
  Status_Obra?: string;
  Conjunto: string;
  Circuito: string;
  Local_Instalacao: string;
  Planejado_DDPM: number;
  Mes_Execucao_Planejado: string;
  CenTrab_Respon: string;
  Prioridade_Nota: string;
  Observacao: string;
  Extracao_Antiga: string;
  Status_Nota: string;
  Status_Anterior: string;
  Check_Btzero: string;
  Plano: string;
  ID_Cronologia: number;
}

export interface RamalDataset {
  registros: NotaRamal[];
}

export interface HierarquiaInfo {
  nota_mae: string;
  filhas: Array<{ Numero_Nota: number; Status_Nota: string; Conjunto: string }>;
}

export interface Status10Regional {
  Regional: string;
  Conjunto: string;
  Qtd_Notas: number;
  Total_Fisico: number;
  Total_Modular: number;
  Total_Custo_Ordem: number;
}

export interface Status10Registro {
  Numero_Nota: number;
  Ordem?: Celula;
  Status_Nota?: Celula;
  Status_Usuario?: Celula;
  Conjunto?: Celula;
  Denominacao_Conjunto?: Celula;
  Local_Instalacao?: Celula;
  Local_Instalacao_Afetado?: Celula;
  Planejado_DDPM?: number;
  Modular?: number;
  Modular_Obra?: number;
  Custo_Plan?: number;
  PEP?: Celula;
  Mes_Execucao_Planejado?: Celula;
  Prioridade_Nota?: Celula;
  Regional?: Celula;
  Centro_Responsavel?: Celula;
  Cidade?: Celula;
  Descricao?: Celula;
  Criado_Por?: Celula;
  Data_Nota?: Celula;
  Observacao?: Celula;
  [key: string]: Celula | undefined;
}

export interface Status10Resumo {
  total_notas: number;
  total_fisico: number;
  total_modular_obra: number;
  total_custo_ordem: number;
  resumo_regional: Status10Regional[];
  registros: Status10Registro[];
}

export interface ItemAlteracaoNotificacao {
  ID_Log: number;
  Numero_Nota: number;
  Regional: string;
  Conjunto: string;
  Circuito: string;
  Tipo_Evento: string;
  Campo_Alterado: string;
  Valor_Antigo: string;
  Valor_Novo: string;
  Detalhe: string;
  Usuario: string;
  Data_Hora: string;
}

export interface EngenheiroResumoNotificacao {
  engenheiro: string;
  email: string;
  regionais: string[];
  total_alteracoes: number;
  total_notas_afetadas: number;
  notas_afetadas: number[];
  alteracoes: ItemAlteracaoNotificacao[];
}

export interface ResumoNotificacoesDiarias {
  data_referencia: string;
  total_alteracoes: number;
  total_notas_afetadas: number;
  engenheiros: Record<string, EngenheiroResumoNotificacao>;
}

export type AbaInput = 'visao' | 'gerenciar' | 'rateio' | 'ramal' | 'relatorios' | 'logs' | 'config';

