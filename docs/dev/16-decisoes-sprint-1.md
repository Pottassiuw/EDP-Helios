# Decisões pendentes da Sprint 1 (Input)

Dossiê da issue #16. Para cada decisão: o que o código faz hoje (verificado),
as opções reais, o impacto de cada uma e a recomendação técnica. A escolha é
de produto/operação — este documento existe para que ela seja tomada com
evidência, não para tomá-la.

Preenchimento esperado por decisão: **dono**, **opção escolhida**,
**justificativa** e **issues desbloqueadas**.

> Repositório público: nenhuma credencial, dado pessoal, caminho de rede
> interno ou passo de exploração entra aqui. O que for sensível é tratado fora
> do tracker.

## D1 — não especificado

A própria issue #16 observa que o diagnóstico cita "D1–D10" mas só define
D2–D10. Até alguém definir o que era D1, não há decisão a tomar.

## D2 — Perfil alvo: execução local por máquina ou produção centralizada

**Hoje:** `config.em_producao()` decide tudo. No perfil local, as escritas
ficam na máquina e nada é publicado na rede (`engine.gerar_copia_excel_rede`
sai antes de tocar qualquer caminho compartilhado). No perfil de produção, o
banco em uso já **é** o arquivo da rede, compartilhado com o robô SAP e o app
legado, e o esquema é somente-leitura para este app.

**Opções**

- **Servidor único de produção** (recomendado): uma instância com
  `EDP_PERFIL=producao`; as estações usam o navegador. É a premissa que o
  código já assume — banco compartilhado, cópia Excel publicada, agendador
  noturno único.
- **Execução local por máquina**: cada pessoa roda o backend. Multiplica
  escritores no banco compartilhado, torna o agendador noturno ambíguo (todo
  mundo dispara) e deixa a publicação do espelho em disputa.

**Desbloqueia:** D4, e o desenho de #24, #25 e #30.

## D3 — Credenciais SAP: credencial do servidor ou fluxo por usuário

**Hoje:** `POST /rateio/executar` recebe `login_sap` e `senha_sap` **no corpo
da requisição** e executa o robô SAP dentro da própria request.

**Opções**

- **Credencial de serviço no servidor** (recomendado): a senha nunca sai da
  máquina que roda o robô, fica fora do repositório e do payload; o rateio
  vira job assíncrono com estado consultável. É o desenho que a #25 pede.
- **Por usuário, repassada na chamada**: o que existe hoje. Mantém rastro
  individual no SAP, mas trafega senha do navegador ao backend a cada
  execução.
- **Por usuário com credencial de curta duração**: preserva a identidade sem
  guardar senha, ao custo de integração adicional com o SAP.

**Desbloqueia:** #25.

## D4 — Scheduler noturno: Agendador do Windows ou lock persistido no app

**Hoje:** `main.py` cria uma task `asyncio` que acorda a cada 30s e dispara às
03:00. O impedimento de execução concorrente (`sap_sync`) é **em memória**:
não sobrevive a reinício e não cobre dois processos. Se o app estiver parado
às 03:00, a extração simplesmente não acontece, e não fica registro disso.

**Opções**

- **Agendador de Tarefas do Windows** (recomendado se D2 for servidor único):
  o app deixa de ter laço próprio; a tarefa do SO chama a rota/CLI. Ganha
  histórico, reexecução manual e "rodou/não rodou" fora do app.
- **Lock persistido no app**: tabela de execuções com dono e heartbeat,
  tolerante a reinício e a múltiplos workers. Necessário se houver mais de uma
  instância.

**Desbloqueia:** #24.

## D5 — Vínculos de Nota Mãe: sugestão confirmada ou automação

**Hoje:** o vínculo automático foi **desligado**. A varredura
(`varrerVinculos`, o "detetive" que lê `Observacao`/`Status_Obra`) continua no
código, mas nenhum componente a chama — só os testes.

**Opções**

- **Sugestão com confirmação** (recomendado, e o que a #19 propõe): a
  varredura volta como lista de sugestões que alguém confirma antes de gravar.
- **Remover de vez**: se ninguém for confirmar sugestão, a função é código
  morto e sai junto com os testes.
- **Voltar a automatizar**: grava vínculo sem confirmação. Foi desligado por
  algum motivo; reverter exige justificativa explícita.

**Desbloqueia:** #19 e parte de #33.

## D6 — Logs: tamanho de página, janela padrão e retenção

**Hoje (após #27):** `GET /logs` pagina e filtra no banco; o teto por página é
`db.LIMITE_MAXIMO_LOGS = 1000`; a tela usa 100 por página e 500 na linha do
tempo. **Não existe expurgo**: o histórico cresce indefinidamente.

**A decidir**

- Tamanho de página padrão (100 é o valor em uso; muda em uma linha).
- Retenção: sem expurgo, expurgo por idade (ex.: 24 meses, com exportação
  antes) ou arquivamento em tabela fria. Qualquer expurgo é **destrutivo** e
  não será implementado sem aprovação explícita — apagar auditoria não tem
  volta.

**Desbloqueia:** o fechamento formal de D6 (a paginação já está entregue).

## D7 — Inspector: remover código morto ou religar o fluxo de detalhe

**A premissa mudou.** O inspector está em uso: `InputNotaInspector` é montado
por `overview.tsx`. Não há fluxo de detalhe desconectado a religar.

O código morto que sobra na feature é a varredura de vínculos, tratada em D5.
Sugestão: encerrar D7 como resolvida por inspeção e deixar o restante com #33.

## D8 — Status 10: unidade do total planejado

**Hoje:** `status10_service.rotulos_resumo_status10()` rotula
`Total_Planejado` como **"Total Planejado (un)"**, somando `Planejado_DDPM`
como quantidade; o valor monetário sai separado em "Total Modular (R$)".

**A confirmar com quem usa o relatório:** se "un" é mesmo a unidade correta
para todo plano (há planos medidos em km na base de medidas — a conversão
km→m existe no caminho de rateio). Se houver mistura de unidades no mesmo
total, somar é errado independentemente do rótulo, e a correção é de cálculo,
não de texto.

**Desbloqueia:** ajuste de rótulo ou de cálculo no relatório Status 10.

## D9 — Destinatários: dono e configuração segura da lista de e-mail

**Hoje:** a lista vive em `config_emails_responsaveis.json` no diretório de
dados e é escrita por `PUT /responsaveis/emails`, que exige identidade
(`X-User`) mas **não registra auditoria** da alteração. Qualquer pessoa
autenticada muda para onde as notificações vão.

**Opções**

- **Dono único** (recomendado): a rota fica restrita a um papel e a alteração
  passa a gerar registro de auditoria, como as demais escritas.
- **Manter aberta com auditoria**: mais simples, mas todo mundo continua
  podendo redirecionar notificação.

**Desbloqueia:** #37 na parte de destinatários.

## D10 — Dados e configuração sensíveis versionados

Há artefato sensível no versionamento. Detalhe, avaliação de impacto e plano
de remediação são tratados **fora do tracker público**, como a própria #37
determina. O que precisa ser decidido: aprovar (ou não) a remediação, e se ela
inclui reescrita de histórico — que exige coordenação de re-clone com todo
mundo que tem cópia do repositório.

**Desbloqueia:** #37.
