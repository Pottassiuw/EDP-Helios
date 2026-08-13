# Integração de edição do COFFEE

## Objetivo

Mapear a tela de edição do `Informativo` para decidir quais correções o Helios
pode oferecer diretamente, sem automatizar o Django Admin e sem reproduzir sua
lógica de backend.

A análise foi feita em modo somente leitura sobre o snapshot `52dfafe` do
repositório `ddpm-dev/coffee-edp`. O HTML autenticado do Admin não foi coletado:
o acesso anônimo leva ao login Microsoft/CSRF e nenhuma sessão, cookie ou
credencial foi reutilizado. Como `InformativoAdmin` não declara `fields`,
`fieldsets`, `exclude` nem formulário customizado, o Django gera o formulário a
partir dos campos editáveis do modelo, na ordem de declaração. Isso permite
mapear o formulário sem automatizar a tela.

Uma tentativa de validar os nomes contra `json_all` ao vivo foi encerrada sem
chamada externa porque o banco local da execução não continha uma nota
candidata. Valores reais de notas não foram copiados para esta documentação.

## Campos do formulário

Campos herdados de `AppCoffee.AbstractInformativo`:

- observações, quantidade de imagens;
- longitude, latitude, precisão e datas de captura/recebimento;
- arquivada, ID SAP, anônima e feedback.

Campos próprios de `AppDeOlhoNaRede2.Informativo`, agrupados por finalidade:

- **localização elétrica:** cidade, tipo de local de instalação, número do
  local, flag de local corrigido, alimentador, flag de alimentador corrigido,
  cidade do trafo, número do trafo e flag de trafo corrigido;
- **classificação:** componente, sintoma, prioridade e quantidade;
- **referências:** referência física, referência elétrica e postes;
- **condição do poste:** contém trafo/religador, sob esforço, suplementado, no
  morro, quantidade de vãos e data de fabricação;
- **critérios de risco:** cerne comprometido, ferragem exposta, fogo ou
  abalroamento, equipamento, final de rede/ponto de tração, risco a terceiros ou
  preservação ambiental, desaprumo, engastamento, série de postes deteriorados,
  parafuso deteriorado/ausente e uso mútuo fora do padrão;
- **auditoria:** usuário responsável.

Anexos aparecem como inline no Admin. Campos automáticos ou não editáveis podem
ser ocultados pelo próprio Django conforme as opções declaradas no modelo.

## APIs encontradas e decisão no Helios

| Operação/campo | API COFFEE existente | Estado no Helios | Decisão |
|---|---|---|---|
| Leitura de todos os campos | `json_all/{id}` | Implementada por `GET /api/coffee/consultar/{id}` | Usar para consultar e confirmar, sem persistir durante a simples consulta. |
| Local de instalação | `local_instalacao/{id}/{local}` | **Implementada em Verificar e no Inspector** | Escrita geral suportada. Formato: 3 cidade + 2 tipo + 8 número. |
| Alimentador | dispatcher `alimentador` | **Implementada em Verificar** (ficha completa da nota) | Escrita suportada via `Select` populado por lookup estático (`coffee_module/alimentadores.py`, 1199 alimentadores); nunca aceita texto livre, confirma por releitura. |
| Trafo | dispatcher `trafo` | Não implementada na UI | Próxima candidata, mas somente após integrar cidade/lookup de trafos e confirmação; não aceitar número livre sem contexto. |
| ID SAP | `sap/{id}/{sap}` | Implementada apenas no fluxo interno de geração | Não expor como edição manual; o job controla placeholder, geração e transição. |
| Arquivamento | `desarquivar/{id}` | Implementada apenas no fluxo interno de geração | Não expor como correção de campo isolada. |
| Demais campos do Admin | Nenhuma escrita estruturada confirmada | Não implementados | Permanecem somente leitura até existir API oficial com validação e auditoria. |

## UX implementada em Verificar

O painel **Corrigir local no COFFEE** aparece em **Verificar**, no detalhe da
nota selecionada, logo depois do bloco **Identificação & localização** — não
mais antes dele. Consulta o valor atual pela mesma query COFFEE compartilhada
do detalhe (`useConsultaCoffee`, ver
[`01-frontend-verificar.md`](01-frontend-verificar.md)), não abre uma consulta
própria. O nome da regra (`rule`) é literalmente o nome da coluna `chk_*` da
fonte — não uma lista fixa que o Helios controla. Por isso
`regraLocalInstalacao` (`frontend/src/lib/local-instalacao.ts`) não compara
contra um conjunto fechado de strings: normaliza acento e caixa
(`chk_local_de_instalação` → `chk_local_de_instalacao`) e reconhece qualquer
chave que contenha `local` e `instal`, incluindo variantes com "de"
(`chk_local_de_instalacao`) nunca vistas antes:

1. consulta automaticamente o valor atual via `json_all` (consulta
   compartilhada do detalhe, sem refazer a chamada a cada painel montado);
2. compara visualmente o valor da triagem com o valor atual do COFFEE;
3. bloqueia a escrita até a consulta terminar;
4. o frontend normaliza para maiúsculas e remove separadores;
5. o backend valida exatamente 13 caracteres antes de chamar a integração;
6. salva pela integração existente de local;
7. o backend reconsulta e rejeita sucesso sem confirmação;
8. o frontend faz uma segunda releitura e só então libera **Encaminhar para
   operação**.

O painel não tem mais botão **Abrir COFFEE** — era redundante com a correção
direta neste mesmo fluxo. Abrir a nota no COFFEE continua disponível no
cabeçalho do detalhe.

Editar não encaminha a nota implicitamente. Se ainda não existe card na
Operação, a rota atualiza apenas o espelho local. Se o card já existe, sua ficha
é reclassificada com o conteúdo reconsultado. O encaminhamento continua sendo
uma ação separada e consciente.

A mesma normalização, validação e chamada identificada por `X-User` é usada pelo
Inspector COFFEE; não há duas implementações concorrentes.

## Fora do escopo atual

- scraping autenticado, automação do Admin, cookies, sessão Microsoft ou CSRF;
- edição livre de trafo sem lookup de domínio (alimentador já tem lookup e
  está implementado; trafo segue como próxima candidata);
- edição de componente, sintoma, prioridade, referências, postes, observações e
  critérios de risco sem endpoint oficial;
- geração automática logo após salvar o local;
- persistência no backend durante a consulta simples do formulário.
