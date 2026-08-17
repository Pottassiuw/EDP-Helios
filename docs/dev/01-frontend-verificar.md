# Módulo Verificar

## O que faz

**Verificar** é a triagem de notas do COFFEE. A fonte é a tabela
`ids_verificacao` de `Verificar.db`, lida diretamente pela API em modo somente
leitura; o usuário não importa mais uma planilha.

O backend preserva o contrato já consumido pelo dashboard: converte as colunas
`chk_*` em falhas, ignora `chk_trafo`, resolve `chk_duplicada`, monta o de-para
do gerador e devolve somente as colunas de `raw` usadas no frontend. Coordenadas
inválidas, `NaN` ou infinitas são normalizadas para `null`, preservando a
resposta JSON e a nota na triagem.

## Fonte SQLite

O caminho padrão é o `Verificar.db` compartilhado. `VERIFICAR_DB_PATH` permite
apontar para um clone local, usado para testes de schema ou mudanças aprovadas.
A conexão usa `mode=ro` e `PRAGMA query_only`: o app não cria tabela, coluna,
journal ou outro artefato no banco da rede.

Se a fonte estiver indisponível, a seção mostra uma mensagem com ação **Tentar
novamente**. Não há fallback silencioso para dados antigos ou cópia local. A
query React Query atualiza a fonte a cada 30 segundos. O cabeçalho mostra o
arquivo, a `schema_version` SQLite e a data de modificação; `user_version` não
é usado porque a fonte atual o mantém em `0`.

## Fluxo COFFEE

1. Uma nota com falha aparece em **COFFEE > Verificar**.
2. **Encaminhar** registra a origem no `coffee.db`, relacionando `verificar_id`
   ao `pk` real retornado pelo COFFEE. A relação é persistida porque os IDs não
   são assumidos como iguais.
3. Enquanto estiver em tratamento, a nota recebe o estado **Encaminhada**.
   Uma falha registrada pela fila operacional é exposta como **Falha operacional**,
   sem confundi-la com as falhas de validação da fonte. Se for removida da
   Operação com justificativa, volta à triagem como **Retornada pela Operação**;
   a justificativa e o usuário ficam visíveis no detalhe.
4. Com SAP real, a transição a classifica como `corrigida`, registra data/hora
   e usuário da conclusão e a remove da triagem.
5. Ela fica em **COFFEE > Concluídas > Corrigidas**.

Retirar uma nota da fila do COFFEE a torna visível novamente em Verificar. SAP
real é terminal para este fluxo; notas corrigidas não retornam à triagem.

### Consulta COFFEE compartilhada

O detalhe de uma nota tem um único dono da consulta ao vivo (`json_all`):
`Detail` (em `dashboard.tsx`) chama `useConsultaCoffee(noteId)` uma vez e
repassa o resultado (`UseQueryResult<CoffeeConsulta>`) por prop para
`NotaFichaCompleta` e `LocalInstalacaoCorrection` — nenhuma das duas monta
sua própria query. A política (`use-consulta-coffee.ts`,
`consultaCoffeeQueryOptions`) usa `staleTime` de 30 minutos e **não** usa
`refetchOnMount: 'always'`: montar um segundo observador da mesma nota reusa
o dado em cache em vez de refazer a consulta, inclusive sob Strict Mode.
Atualização só acontece por ação explícita — o botão **Atualizar consulta**
chama `consulta.refetch()`. Depois de salvar uma correção,
`queryClient.setQueryData` atualiza o cache com a resposta confirmada pelo
backend sem disparar uma nova consulta automática; a releitura de
confirmação da escrita continua existindo como parte do próprio fluxo de
salvar, não como um refetch adicional do `Detail`.

Nenhum dos dois componentes usa `key={noteId}` para forçar remontagem ao
trocar de nota selecionada: `LocalInstalacaoCorrection` ajusta seu rascunho
durante o render quando o `noteId` muda (em vez de depender de remount), e
só sincroniza o rascunho com o valor consultado quando esse valor
efetivamente muda — não a cada nova referência de objeto.

### Correção direta de local

Na tela **Verificar**, selecione na fila uma nota cuja falha seja de local de
instalação — `regraLocalInstalacao` reconhece qualquer variante da fonte
(`chk_local_instal`, `chk_local_instalacao`, `chk_local_de_instalacao`, com
ou sem acento) por normalização, não por lista fixa. No painel de detalhe à
direita, logo depois de **Identificação & localização**, aparece **Corrigir
local no COFFEE**. O painel consulta o valor atual (via consulta
compartilhada), valida o contrato de 13 caracteres (3 cidade + 2 tipo + 8
número), salva pela API existente e confirma por releitura antes de
habilitar **Encaminhar para operação**. A edição sozinha não cria card na
Operação e o encaminhamento em lote exclui notas cuja correção de local
ainda está pendente. O botão **Abrir COFFEE** não existe mais nesse painel —
é redundante com o fluxo de correção direta. A matriz de campos editáveis e
não editáveis está em
[`12-integracao-edicao-coffee.md`](12-integracao-edicao-coffee.md).

### Identificação & localização, e ficha completa no rodapé

O bloco **Identificação & localização** é o principal do detalhe: reúne os
dados normalizados da nota (`Note`) e, quando existem, os campos
equivalentes da consulta COFFEE compartilhada — Observação, Referência
elétrica, Referência física, Alimentador e ID SAP usam o valor da nota
quando presente e caem para o valor da consulta COFFEE quando o dado bruto
da triagem vier vazio. Referência elétrica só existe do lado COFFEE (não faz
parte do contrato de `Note`).

Quando o texto de Referência elétrica cita um ou mais equipamentos no
formato `TIPO-número` (ex.: `FF-655816`), a linha ganha um chip por
equipamento reconhecido — com botão de copiar o código (`referencia-
eletrica.ts: extrairEquipamentos`) — pra facilitar a busca do equipamento no
COFFEE. `TIPO` é validado contra o depara de tipos de equipamento
(`GET /coffee/tipos-equipamento`, o mesmo usado na correção de local de
instalação); o número é completado com zeros à esquerda até 8 dígitos, igual
`local_instalacao`. Texto sem menção reconhecível não mostra chip nenhum.

**Ficha completa (COFFEE)** (`nota-ficha-completa.tsx`) é a seção de
informações adicionais, no rodapé do detalhe — depois de
Identificação, correção de local e falhas, não antes. Ela não repete os
campos já exibidos no bloco principal: a lista de exclusão
(`CHAVES_CRUAS_JA_MOSTRADAS` em `nota-ficha-completa.tsx`) cobre aliases
conhecidos (`observacao`/`observacoes`, `referencia_eletrica`,
`referencia_fisica`, `poste`/`postes`, `alimentador`, `id_sap`,
`local_instalacao`, `problema`, `componente`/`componente_novo`, `sintoma`,
`causa`) por chave, independente do valor. Os demais campos do `json_all`
(`campos`, repassado cru pelo backend) são rotulados (`campos-coffee.ts`:
mapa de rótulos pros campos de domínio conhecidos, com fallback que
humaniza `snake_case` — `tipo_defeito_raro` → "Tipo Defeito Raro") e
agrupados por assunto (Identificação, Local e rede, Execução, Estado, Risco
e segurança, Metadados) usando o nome da própria chave — robusto a campos
nunca vistos antes. Cada grupo é um `<details>` recolhido independente, sem
descartar nenhum campo; grupo sem conteúdo não aparece.

Dentro da ficha, **Alimentador (circuito)** (`alimentador-correction.tsx`)
edita o circuito da nota por `Select` populado por `GET
/api/coffee/alimentadores` — lookup estático de 1199 alimentadores
(`coffee_module/data/alimentadores.csv`, carregado uma vez e cacheado). Ao
salvar, `POST /api/coffee/alimentador` valida o ID contra esse lookup antes
de chamar a API COFFEE (nunca aceita texto livre), grava via
`client.alterar_alimentador`, reconsulta e só confirma se o valor bater —
mesmo padrão de escrita-e-confirma-por-releitura do local de instalação.
Diferente do local, a edição do alimentador não depende de nenhuma falha
`chk_*` — fica sempre disponível.

## Duplicatas externas × Carteira de Notas

Candidatas de `chk_duplicada` fora da planilha Verificar (`in_sheet: false`,
maioria dos casos reais) são cruzadas em lote com a Carteira de Notas
(`carteira_module`, espelho local da base COFFEE/Databricks) por `id_onr` —
mesmo espaço de ID das duplicatas. O cruzamento roda uma única query `IN`
por request de `/api/data` (`main.py: enriquecer_candidatos_externos`),
nunca uma chamada por candidata.

Candidata com linha na Carteira ganha comparação de Local de instalação e
Problema (`componente_novo` + `sintoma`), além de contexto (Status SAP,
Prioridade SAP, Conjunto). A Carteira não contém Poste, Referência ou
Observação. O botão por card consulta sob demanda `GET
/api/coffee/consultar/{id}` e projeta cinco campos do COFFEE em memória:
Local, Problema (`componente`/`sintoma`/`causa`), Poste, Referência e
Observação. A resposta não faz `upsert`, não escreve na Carteira e não altera
o estado persistido. Ela fica no cache em memória do React Query por 30 minutos,
chaveada pelo ID da candidata: ao navegar para outra nota e voltar, os valores
COFFEE não vazios reaparecem; atualizar a página ou encerrar a sessão descarta
esse enriquecimento temporário. Isso permite comparar uma candidata ausente da
Carteira sem esperar uma sincronização em lote.

A evidência de possível duplicata usa os cinco campos pontuados Problema (2),
Referência elétrica (2), Local de instalação (1,6), Poste (1,3) e Referência
física (1,1) — peso total 8 —, normalizada pelo peso dos campos disponíveis.
Observação fica lado a lado para decisão humana, mas não entra no score. Uma
regra `chk_*` que afete um desses campos reduz apenas aquele peso para 1;
sentinelas/valores ausentes não são match nem diferença. A faixa exige
cobertura suficiente e ao menos dois matches: Forte
(verde), Possível (âmbar), Distinta (vermelho) ou Evidência insuficiente
(índigo). A fila usa o melhor indicador com evidência entre as candidatas e
mostra a cobertura visível como `NN% cob.`; o card explica percentual,
cobertura e pesos reduzidos.

Candidata sem linha na Carteira mantém estado dedicado ("não encontrada na
Carteira") e uma única badge; após a consulta ao vivo ela exibe a mesma grade
completa. O estado legado restaurado de `app_state.json` passa pelo mesmo
enriquecimento antes de ser exposto; se a Carteira estiver indisponível,
`GET /api/data` responde `503` em vez de devolver uma falha 500 sem contexto.

### Marcar como duplicata

No cabeçalho do bloco de duplicatas, **⧉ Marcar como duplicata** abre um modal
com justificativa opcional (`duplicate-compare.tsx: MarcarDuplicataModal`).
Confirmar chama `POST /api/duplicata/{note_id}`, que reusa o mecanismo real do
`coffee_module` em vez de um campo local: `id_sap` recebe o sentinel
`SAP_DUPLICATA = 99999999` **ao vivo** na API COFFEE (`client.definir_sap`,
mesmo caminho que já grava `SAP_PENDENTE = 10000000` no fluxo de `regerar`) —
fica visível pra qualquer sistema que consome o COFFEE. A nota também é
arquivada localmente (`db.arquivar_nota`, some de toda listagem do
`coffee_module` — fila, concluídas, Operação) e sai de qualquer item pendente
de geração (`remover_item_operacao` + `marcar_gerar(False)`). `classify.py`
reconhece o sentinel como classificação própria (`duplicada`), nunca como
`corrigida`/`gerada`.

Com a nota resolvida, o botão vira **↺ Reabrir** e o botão **→ Fila COFFEE**
some (não faz sentido encaminhar uma nota arquivada). Reabrir chama `POST
/api/duplicata/{note_id}/desfazer` sem modal: restaura `id_sap = 10000000` ao
vivo e desarquiva localmente (`db.desarquivar_nota`). Justificativa só vai
para o log de auditoria (`registrar_log`), nunca é obrigatória.

## Interface

`dashboard.tsx` é responsável por filtros, seleção e apresentação. A ação que
antes dizia “Concluir” agora é **Encaminhar**; “concluída” fica reservado ao
resultado real no SAP. `source-screen.tsx` representa carregamento ou
indisponibilidade da fonte. O botão **Atualizar** exibe Sonner de carregamento
e conclusão, indicando quantas notas entraram ou saíram da triagem. O filtro
**Situação** separa notas não encaminhadas, encaminhadas, com falha operacional
e retornadas pela Operação; as falhas de validação continuam nos bloqueios e no
detalhe da nota.

O painel de KPIs mostra encaminhamentos atuais, falhas operacionais, retornos
da Operação e o total **Encaminhadas hoje** para todos os usuários, discriminado por usuário. O
backend persiste o último encaminhamento em `coffee.db`, sem escrever na fonte
compartilhada.

O filtro **Gerada por** alterna entre **Todos** e **Inspetores ES/SP**. O
segundo escopo mantém somente notas cujo gerador esteja no De-Para, tenha UF
`ES` ou `SP` e a permissão `inspetor_planejamento`. Só então aparece o filtro
**Inspetor**: suas opções são os geradores desse escopo, deduplicadas por
matrícula e exibidas como nome e UF — restritas ao **Estado (UF)** já
selecionado no outro filtro (`inspetorOptions`, `dashboard.tsx`); com UF em
"Todos", cobre todos os estados. A fila sempre mostra nome e UF de quem
gerou a nota e sinaliza matrículas não cadastradas no De-Para.

Em Concluídas, a lista informa quando a nota veio de Verificar e quando foi
corrigida. A ficha lateral mostra também quem a encaminhou e quem concluiu.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `backend/verificar_module/source.py` | Abre `Verificar.db` somente leitura e lê `ids_verificacao`. |
| `backend/main.py` | Normaliza a tabela no contrato de triagem e expõe `GET /api/data`. Upload é compatibilidade de API/testes. |
| `frontend/src/features/verificar/useTriageData.ts` | Query React Query da fonte, com atualização de 30 segundos. |
| `frontend/src/features/verificar/source-screen.tsx` | Estado de carregamento/erro da fonte SQLite. |
| `frontend/src/features/verificar/dashboard.tsx` | Filtros, fila e encaminhamento para COFFEE. |
| `frontend/src/features/coffee/concluidas/` | Histórico de notas geradas/corrigidas e rastreabilidade. |

## Testes

`backend/test_verificar_source.py` usa clone SQLite temporário para validar
leitura sem mutação e o vínculo entre o ID de Verificar e um PK COFFEE
diferente.

- Backend: `python -m pytest test_verificar_source.py test_upload.py`
- Frontend: `npm test -- --run` e `npm run build`
