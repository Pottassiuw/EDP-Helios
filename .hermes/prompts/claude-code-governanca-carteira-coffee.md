# Prompt operacional para Claude Code — EDP-Helios

> Este arquivo é um briefing operacional. O Claude Code deve ser iniciado na raiz do repositório, e não dentro de `.hermes`.
>
> Objetivo da primeira sessão: investigar e planejar. Não implementar, commitar, fazer push ou alterar ambientes externos sem autorização explícita.

---

## Prompt para colar no Claude Code

Você é o agente principal de engenharia do projeto EDP-Helios, anteriormente relacionado ao EDP Verify.

O projeto é um sistema interno para apoiar o Planejamento de Manutenção, reunindo os módulos Verificar, COFFEE, Input/Plano, Carteira, Relatórios e Configurações. O sistema importa, valida, compara, acompanha, planeja e reporta notas SAP, com integrações a bases locais, arquivos compartilhados, APIs corporativas, Databricks e automações SAP em ambiente Windows autorizado.

Sua responsabilidade nesta sessão é compreender profundamente o estado atual do repositório, confrontar o código com o plano de governança e produzir um diagnóstico técnico acionável antes de qualquer implementação.

## Regra essencial de contexto

Você tem acesso ao repositório atual e, portanto, deve consultar o código, os contratos, os testes e a documentação antes de fazer perguntas ao usuário.

Não pergunte algo que possa ser respondido com segurança por:

- leitura do código;
- leitura da documentação;
- histórico Git;
- testes existentes;
- contratos de API;
- schemas, modelos, migrations ou fixtures;
- configuração do projeto;
- comportamento observável em testes locais seguros.

Quando uma decisão não puder ser resolvida por evidência do repositório e realmente depender de regra de negócio, apresente-a explicitamente em uma seção chamada `Decisões que exigem o usuário`.

Não invente respostas para essas decisões.

## Ordem obrigatória de leitura

Antes de propor alterações, leia e considere:

1. `CLAUDE.md`;
2. `AGENTS.md`, se existir;
3. `DESIGN.md`, se existir;
4. README e documentação de arquitetura;
5. documentação de desenvolvimento em `docs/dev/`;
6. especificações relevantes em `docs/superpowers/specs/`;
7. o plano existente:

   `.hermes/plans/2026-08-11_112340-helios-governanca-carteira-coffee-plano.md`

8. todos os módulos atuais de Carteira, Relatórios, COFFEE, Input/Plano e Integração;
9. tipos, schemas, rotas, serviços, repositórios, jobs e adapters relacionados;
10. testes existentes e fixtures;
11. histórico da branch atual e diferença em relação à `develop`.

Use buscas direcionadas. Não leia indiscriminadamente arquivos enormes ou dados corporativos reais.

Não abra, copie, imprima, versione ou inclua no relatório:

- credenciais;
- tokens;
- cookies;
- chaves privadas;
- arquivos `.env`;
- conteúdo real de planilhas corporativas;
- dados reais de notas SAP;
- sessões ou dumps sensíveis.

Se encontrar um arquivo potencialmente sensível, registre apenas o caminho, o tipo do risco e a recomendação de proteção.

## Estado esperado de Git

Antes de qualquer alteração, informe:

- branch atual;
- commit atual;
- estado do working tree;
- remote configurado;
- relação da branch atual com `develop`;
- alterações pré-existentes que não pertencem a esta tarefa.

Não descarte, sobrescreva, faça stash ou inclua automaticamente alterações preexistentes.

A implementação futura deverá ocorrer em branch própria baseada na `develop`. Não trabalhar diretamente em `main` ou `develop`.

## Objetivo de produto

A prioridade atual é estabelecer uma semântica única e governada para os dados da Carteira, do COFFEE, do Plano/Input e dos Relatórios.

Os engenheiros precisam visualizar, por mês, regional e conjunto:

- a meta;
- a quantidade planejada;
- a quantidade executada;
- a quantidade cancelada;
- a quantidade faltante;
- unidades separadas de medidas/distância, especialmente quilômetros;
- notas COFFEE elegíveis já geradas;
- quais notas já estão no Plano;
- quais notas podem ser promovidas para o Plano;
- a data, versão e frescor do último snapshot disponível.

O dashboard não pode esconder erro de fonte mostrando zero como se fosse dado válido.

## Regras de domínio já confirmadas

Trate os pontos abaixo como decisões de negócio já estabelecidas, salvo se o próprio código demonstrar uma contradição que precise ser reportada:

1. O conjunto define a grandeza da informação: unidade, medida/distância, quilômetro ou outra categoria válida.
2. Unidades e medidas/distâncias nunca devem ser somadas no mesmo KPI.
3. A meta deve ser indexada pelo mês da meta, e não pelo mês de criação, geração ou execução da nota.
4. O status operacional canônico de execução é o código `99`, mas o campo exato e eventuais precedências devem ser descobertos no código e documentados.
5. Gerada, executada, concluída, cancelada e disponível no Plano são estados diferentes.
6. Canceladas devem permanecer em métricas próprias e não devem ser misturadas com executadas.
7. A Carteira é a fonte das dimensões originais de regional e conjunto.
8. O Plano/Input é a fonte operacional consumida pelos Relatórios.
9. O COFFEE deve ser integrado como fonte de notas SAP reais.
10. Notas EP, DD, registros sem SAP real, IDs sentinela e registros incompletos não devem aparecer como elegíveis na Carteira.
11. `id_onr` e `id_sap` precisam ser preservados para rastreabilidade e reconciliação. A chave definitiva deve ser confirmada por evidência do código e, se necessário, pelo usuário.
12. Os IDs `99999999`, `1000000` e o literal `10000000` encontrado no código devem ser investigados e centralizados. Não espalhe literais de placeholder.
13. A promoção Carteira/COFFEE → Plano é uma cópia auditável, com origem, identidade, campos manuais e timestamp.
14. Promoções em lote devem suportar sucesso parcial: válidas continuam, inválidas são reportadas individualmente.
15. Repetir a promoção não pode criar duplicatas.
16. Jobs de atualização devem ser idempotentes, observáveis e seguros contra execução concorrente.
17. A periodicidade desejada para a atualização da Carteira é de 15 minutos, mas a implementação não pode presumir que um scheduler em processo é seguro para múltiplas instâncias.
18. Em falha de atualização, o sistema deve preservar o último snapshot válido e marcar a fonte como desatualizada ou com erro.
19. Nenhuma operação deve usar `EDP_PERFIL=producao` autonomamente.
20. Nenhuma validação de elegibilidade pode existir somente no React; o backend deve ser a autoridade.

## Perguntas arquiteturais que você deve responder investigando o código

Para cada item, procure evidência concreta e cite os arquivos, símbolos, endpoints ou testes relevantes:

### Carteira e métricas

- Qual é o modelo real de dados da Carteira?
- Qual é o grão real da meta?
- Como regional, conjunto, plano e mês são identificados?
- Onde acontece hoje a soma de quantidade?
- Onde ocorre a conversão de medida para quilômetro?
- A quantidade está sendo convertida mais de uma vez?
- Qual unidade original é preservada?
- Como o sistema diferencia meta, planejado, gerado, executado, cancelado e faltante?
- Existem duas ou mais definições de executada?
- O que acontece quando a meta é zero?
- Um saldo de um conjunto/plano compensa o déficit de outro?
- O contrato atual consegue representar grandezas incompatíveis sem ambiguidade?
- Quais endpoints e componentes frontend dependem desse contrato?

### COFFEE

- Qual é a fonte real do COFFEE: API, banco local, arquivo ou combinação?
- Qual é a relação entre `id_onr`, `pk`, `id_sap` e `Numero_Nota`?
- Qual é o campo real de status e como o código `99` é interpretado?
- Como EP, DD, placeholders e SAP real são identificados hoje?
- Existem filtros divergentes entre backend e frontend?
- Quais registros inválidos são apenas ocultados e quais são efetivamente rejeitados?
- O que acontece quando há duplicidade, conflito ou campos faltantes?

### Plano/Input

- Qual é a chave de negócio usada atualmente para verificar existência?
- A consulta de existência é feita uma vez por nota ou em lote?
- Quais campos manuais são obrigatórios?
- Quais campos são herdados da Carteira e quais podem ser corrigidos?
- Quais campos devem ser protegidos contra sobrescrita?
- A escrita é idempotente e segura contra concorrência?
- Existe auditoria suficiente para saber origem, usuário, filtros e resultado?

### Relatórios

- Os Relatórios consomem Carteira, Plano/Input, COFFEE ou uma combinação?
- O filtro mensal usa o mês da meta ou outro período?
- Os filtros de regional e conjunto têm o mesmo significado da Carteira?
- Há cálculos duplicados no frontend?
- Um erro de COFFEE ou ausência de sincronização pode virar zero silencioso?
- Existem métricas que usam semânticas diferentes para a mesma palavra?

### Jobs e snapshots

- Existe scheduler atual?
- Ele roda em processo web, worker separado ou tarefa externa?
- Há lock distribuído ou proteção contra duas instâncias?
- Como são persistidos versão, timestamp, duração, contagens e falhas?
- O último snapshot válido é preservado após falha?
- Como o frontend sabe se os dados estão atuais, atrasados, vazios ou indisponíveis?

## Método de trabalho exigido

Execute o trabalho em duas fases.

### Fase A — Investigação somente leitura

Nesta fase:

- não altere arquivos;
- não execute mutações em Azure, SAP, COFFEE, Databricks ou bases corporativas;
- não faça commit;
- não faça push;
- não altere dados de produção;
- use fixtures, mocks, testes e dados sintéticos quando precisar executar algo.

Faça baseline seguro dos gates existentes, se possível, sem modificar o working tree. Se algum comando produzir arquivos gerados, limpe somente os artefatos gerados pela própria execução e informe o que aconteceu.

Entregue um relatório com exatamente estas seções:

1. `Estado do repositório`
2. `Arquitetura encontrada`
3. `Fluxo de dados atual`
4. `Contrato atual de métricas`
5. `Inconsistências e riscos`
6. `O que o código/documentação já responde`
7. `Decisões que exigem o usuário`
8. `Plano técnico recomendado`
9. `Arquivos afetados por fase`
10. `Testes existentes e lacunas`
11. `Critérios de aceitação`
12. `Riscos de migração e rollback`

Para cada conclusão importante, forneça evidência no formato:

- arquivo;
- função, classe, endpoint ou teste;
- comportamento observado;
- impacto.

### Fase B — Implementação, somente após aprovação

Não inicie esta fase automaticamente. Aguarde aprovação explícita do usuário.

Quando autorizado:

1. confirme branch e working tree novamente;
2. crie uma branch própria baseada na `develop`;
3. implemente em incrementos pequenos;
4. escreva testes antes ou junto da mudança;
5. mantenha a lógica de domínio centralizada no backend;
6. mantenha Carteira, COFFEE, Plano/Input e Relatórios semanticamente consistentes;
7. atualize a documentação `docs/dev/` sempre que a arquitetura ou contrato mudar;
8. não faça refatorações não relacionadas;
9. pare e reporte se encontrar uma decisão de negócio não resolvida;
10. execute os testes específicos após cada fase;
11. execute os gates completos antes de concluir.

Não use `--dangerously-skip-permissions` sem autorização explícita.

## Critérios técnicos mínimos

A implementação futura somente será considerada aceitável quando:

- nenhum KPI somar grandezas incompatíveis;
- o mês da meta for usado de forma consistente;
- a regra do conjunto determinar a grandeza;
- a conversão de unidade ocorrer exatamente uma vez;
- executadas e canceladas forem métricas distintas;
- EP/DD/placeholders não forem elegíveis no backend;
- a mesma regra de elegibilidade for reutilizada por Carteira, COFFEE e Relatórios;
- a reconciliação preservar IDs e motivos de decisão;
- a promoção parcial reportar cada resultado;
- repetição e concorrência não criarem duplicatas;
- campos manuais forem validados no backend;
- cada promoção tiver auditoria;
- erro de fonte não for convertido em zero silencioso;
- último snapshot válido for preservado após falha;
- jobs não rodarem duplicados;
- o frontend não duplicar regras de negócio;
- testes e documentação refletirem o contrato implementado;
- nenhuma operação atingir produção automaticamente.

## Gates do projeto

Use os comandos definidos pelo repositório. Como baseline, investigar e executar, quando compatível com o ambiente:

```bash
cd backend
python -m pytest test_upload.py test_input_module.py

cd ../frontend
npm run build

git diff --check
```

No Windows, adapte os comandos ao shell e ao ambiente virtual existente, sem assumir que `python`, `py` ou caminhos Linux estarão disponíveis.

Se um gate falhar:

- reproduza a falha;
- identifique a causa;
- não esconda o erro;
- não desabilite o teste;
- diferencie falha ambiental de falha causada pela alteração;
- reporte a saída real.

## Formato da resposta inicial

Finalize a Fase A com:

```text
DIAGNOSTICO_HELIOS=COMPLETO
IMPLEMENTACAO_INICIADA=NAO
ALTERACOES_REALIZADAS=0
COMMIT_REALIZADO=NAO
PUSH_REALIZADO=NAO
```

Em seguida, apresente o relatório nas doze seções exigidas e destaque claramente as perguntas que precisam ser respondidas pelo usuário.
