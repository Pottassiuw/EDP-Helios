export interface ColunaDef {
  key: string;
  label: string;
  numeric?: boolean;
  largura?: number;
  editavel?: boolean;
  opcoes?: 'status' | 'prioridade' | 'mes';
}

/** Colunas do painel na ordem especificada (Regional, Nº Nota, Nota Mãe, Observação, etc.). */
export const COLUNAS: ColunaDef[] = [
  { key: 'Regional', label: 'Regional' },
  { key: 'Numero_Nota', label: 'Nº Nota (ID)', numeric: true, largura: 110 },
  { key: 'Nota_Mae', label: 'Nota Mãe', largura: 110 },
  { key: 'Observacao', label: 'Observação', editavel: true, largura: 260 },
  { key: 'Conjunto', label: 'Conjunto', editavel: true },
  { key: 'Circuito', label: 'Circuito', editavel: true },
  { key: 'Local_Instalacao', label: 'Local Instalação', editavel: true, largura: 170 },
  { key: 'Planejado_DDPM', label: 'Planejado', numeric: true, editavel: true },
  { key: 'Medida_SAP', label: 'Medida SAP' },
  { key: 'Medida_vs_Planejado', label: 'Medida vs Planejado' },
  { key: 'Mes_Execucao_Planejado', label: 'Mês Execução Planejado', editavel: true, opcoes: 'mes', largura: 170 },
  { key: 'Data_programada_SAP', label: 'Data Programada SAP', largura: 150 },
  { key: 'Comparacao_Data_SAP', label: 'Comparação Data SAP', largura: 150 },
  { key: 'Data_Nota_SAP', label: 'Data Abertura Nota SAP', largura: 150 },
  { key: 'Data_Envio_Projeto', label: 'Data Envio Projeto', editavel: true },
  { key: 'Centro_Responsavel', label: 'Centro de Trabalho Responsável', largura: 210 },
  { key: 'Prioridade_Nota', label: 'Prioridade Nota', editavel: true, opcoes: 'prioridade' },
  { key: 'Status_Nota', label: 'Status Nota', editavel: true, opcoes: 'status', largura: 180 },
  { key: 'Cidade', label: 'Cidade' },
  { key: 'CJ_Aneel', label: 'Cj. Aneel' },
  { key: 'substacao_conjunto', label: 'Subestação Conj' },
  { key: 'Conj.critico', label: 'Conjunto Crítico' },
  { key: 'ranking', label: 'Ranking', numeric: true },
  { key: 'Check', label: 'Check', editavel: true },
  { key: 'Export_status', label: 'Export Status' },
  { key: 'Status_Final', label: 'Status Final' },
  { key: 'Status_Anterior', label: 'Status Anterior' },
  { key: 'Ordem', label: 'Ordem', largura: 120 },
  { key: 'Status_Usuário_Ordem', label: 'Status Usuário Ordem' },
  { key: 'Status_Sistema', label: 'Status Sistema' },
  { key: 'Total_planejado_ordem', label: 'Total Planejado Ordem (R$)', numeric: true },
  { key: 'Total_real_ordem', label: 'Total Real Ordem (R$)', numeric: true },
  { key: 'Exec_percentagem_ordem', label: 'Exec %', numeric: true },
  { key: 'Ordem_Executada', label: 'Ordem Executada' },
  { key: 'Modular', label: 'Modular (R$)', numeric: true },
  { key: 'Total_planejado_modular', label: 'Total Planejado Modular', numeric: true },
  { key: 'Regional_CSD', label: 'Regional CSD' },
  { key: 'N_Clientes_Conjunto', label: 'Nº Clientes Conjunto', numeric: true },
  { key: 'CHI', label: 'CHI', numeric: true },
  { key: 'CI', label: 'CIH', numeric: true },
  { key: 'Ocorrencia', label: 'Ocorrências', numeric: true },
  { key: 'DEC', label: 'DEC', numeric: true },
  { key: 'FEC', label: 'FEC', numeric: true },
  { key: 'CHI_Conj', label: 'CHI Conjunto', numeric: true },
  { key: 'Equipamento_Protecao', label: 'DIS Proteção' },
  { key: 'DEC_PROG_CHI', label: 'DEC Prog. CHI', numeric: true },
];

export const ROTULOS: Record<string, string> =
  Object.fromEntries(COLUNAS.map((c) => [c.key, c.label]));

/** Espelho de db.CAMPOS_EDITAVEIS no backend. */
export const CAMPOS_EDITAVEIS = COLUNAS.filter((c) => c.editavel).map((c) => c.key);

/** Campos oferecidos nos filtros avançados, por tipo (Input/app.py:216-217). */
export const FILTROS_TEXTO = [
  'Local_Instalacao', 'Observacao', 'Ordem', 'Centro_Responsavel',
  'Equipamento_Protecao', 'Numero_Nota'
];
export const FILTROS_FAIXA = [
  'Planejado_DDPM', 'ranking', 'Total_planejado_ordem', 'Total_real_ordem',
  'Exec_percentagem_ordem', 'N_Clientes_Conjunto', 'CHI', 'CI', 'Ocorrencia',
  'DEC', 'FEC', 'Modular', 'Total_planejado_modular', 'CHI_Conj', 'DEC_PROG_CHI'
];
export const FILTROS_MULTI = [
  'Status_Nota', 'Regional', 'Mes_Execucao_Planejado', 'Prioridade_Nota',
  'Conjunto', 'Cidade', 'CJ_Aneel', 'Conj.critico', 'Export_status',
  'Status_Final', 'Ordem_Executada', 'Regional_CSD', 'Nota_Mae',
  'Circuito', 'Medida_SAP', 'Medida_vs_Planejado'
];

/** Colunas da colagem em massa, na ordem. */
export const COLUNAS_COLAGEM = [
  'Numero_Nota',
  'Nota_Mae',
  'Observacao',
  'Status_Nota',
  'Prioridade_Nota',
  'Planejado_DDPM',
  'Conjunto',
  'Circuito',
  'Local_Instalacao',
  'Mes_Execucao_Planejado',
  'Data_Envio_Projeto',
  'Check',
];
