export interface CoffeeNota {
  pk: number;
  id_sap: number;
  id_sap_anterior: number | null;
  arquivado: boolean | null;
  classificacao: string;
  dados_json: Record<string, unknown> | null;
  buscado_em: string;
  classificacao_em?: string | null;
  erro: string | null;
  a_gerar?: boolean;
  origem?: string | null;
  verificar_id?: number | null;
  verificar_ativa?: boolean;
  verificar_em?: string | null;
  verificar_por?: string | null;
  encaminhada_em?: string | null;
  encaminhada_por?: string | null;
  retornada_em?: string | null;
  retornada_por?: string | null;
  retorno_justificativa?: string | null;
  corrigida_em?: string | null;
  corrigida_por?: string | null;
}

export interface CoffeeJob {
  id?: string;
  tipo?: "consulta" | "geracao" | "atualizacao_sap" | "consulta_leitura" | string;
  estado: "rodando" | "concluido" | "interrompido";
  total: number;
  feitas: number;
  erros: Array<{ pk: number | string; msg: string }>;
  arquivadas?: Array<{ pk: number; id_sap: number | null; local_instalacao: string | null }>;
  corrigidas?: number[];
  ja_corrigidas?: number[];
  geradas?: number[];
  divergentes?: Array<{ id: number; local_atual: string | null }>;
  /** Só presente em jobs de consulta avulsa/operação: quantas notas terminaram
   * em cada etapa do quadro. */
  por_etapa?: Partial<Record<'pronta' | 'aguardando_sap' | 'processando' | 'ignorada', number>>;
  /** Só presente em jobs `consulta_leitura`: o resultado somente-leitura
   * de cada nota consultada. */
  resultados?: ConsultaLoteItem[];
  iniciado_em: string;
  atualizado_em?: string;
}

export type OperacaoEtapa =
  | "fila"
  | "pronta"
  | "processando"
  | "aguardando_sap";

export type OperacaoOrigem = "avulsa" | "verificar";

export interface CoffeeOperacaoItem {
  entrada_id: number;
  nota_pk: number | null;
  etapa: OperacaoEtapa;
  origem: OperacaoOrigem | null;
  operacao_id: string | null;
  erro: string | null;
  criado_em: string;
  atualizado_em: string;
  nota: CoffeeNota | null;
}

export interface CoffeeOperacaoQuadro {
  itens: CoffeeOperacaoItem[];
  operacoes_ativas: CoffeeJob[];
  contagens: Record<OperacaoEtapa, number>;
}

export interface ConsultaLoteItem {
  pk: number;
  id_sap: number | null;
  classificacao: string | null;
  ja_na_operacao: boolean;
  elegivel: boolean;
  local_instalacao: string | null;
  erro: string | null;
}

export interface CoffeeLog {
  id: number;
  timestamp: string;
  tipo: "api_call" | "transicao" | "acao_usuario";
  acao: string;
  nota_pk: number | null;
  detalhes: Record<string, unknown> | null;
  sucesso: boolean;
  usuario: string | null;
  trace_id: string | null;
}

export interface CoffeeConsulta {
  pk: number;
  id_sap: number | null;
  local_instalacao: string | null;
  classificacao: string;
  arquivado: boolean | null;
  poste: string | null;
  referencia: string | null;
  referencia_fisica: string | null;
  referencia_eletrica: string | null;
  alimentador: string | null;
  problema: string | null;
  observacao: string | null;
  /** Campos crus do json_all, pra ficha completa mostrar tudo sem o backend projetar campo a campo. */
  campos: Record<string, unknown>;
}

export interface Alimentador {
  id: string;
  cidade: string;
}

export interface Municipio {
  codigo: string;
  nome: string;
}

export interface TipoEquipamento {
  id: string;
  descricao: string;
}

export interface PropostaPlano {
  Numero_Nota: number;
  Local_Instalacao: string;
  Circuito: string;
  Prioridade_Nota: string;
  Status_Nota: string;
  Data_Envio_Projeto: string;
  Observacao: string;
  Planejado_DDPM: number;
  Planejado_Unidade: string | null;
}

export interface CamposManuais {
  Mes_Execucao_Planejado: string;
  Status_Obra: string;
  Observacao: string;
  Check: string;
}

export interface NotaRevisao {
  coffee: CoffeeNota;
  iw28: Record<string, string | number | null> | null;
  iw28_extraida_em: string | null;
  plano: Record<string, string | number | null> | null;
  ja_no_plano: boolean;
  proposta: PropostaPlano;
  avisos: string[];
  pode_mover: boolean;
  motivo_bloqueio: string | null;
}

export interface MoverResultado {
  inseridas: number;
  atualizadas: number;
}
