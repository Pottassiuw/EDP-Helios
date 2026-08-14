# Correção do Verificar: consulta COFFEE, re-renderização e ficha completa

Você é o implementador principal desta tarefa no repositório EDP-Helios.

Trabalhe em `C:\Helios` (`/c/Helios` no Git Bash).

## Escopo

Corrigir os erros introduzidos no fluxo de edição do local diretamente no Verificar e na ficha completa do COFFEE.

Sintomas observados:

- ao consultar o local atual no COFFEE, a ficha completa parece ser atualizada/reconstruída de forma desnecessária;
- a consulta pode estar sendo disparada mais vezes que o necessário;
- informações adicionais do COFFEE aparecem antes do conteúdo mais importante;
- a ficha completa repete dados que deveriam aparecer em `Identificação & localização`;
- referência elétrica, observação e outros campos importantes ficam na ficha, enquanto o bloco principal continua incompleto;
- o detalhe ficou com a ordem visual errada: ficha completa, correção de local, falhas e só depois identificação;
- Strict Mode pode tornar o sintoma mais visível, mas não deve ser usado como explicação para uma arquitetura que refaz consultas desnecessariamente.

As imagens usadas na investigação estão fora do repositório e não devem ser copiadas para o projeto.

## Segurança do working tree

Antes de qualquer alteração:

```bash
git status --short --branch
git diff --check
```

O working tree já contém alterações do Sonnet e de outras etapas. Preserve tudo que não for relacionado a esta correção. Não use:

- `git reset`;
- `git clean`;
- `git stash`;
- checkout destrutivo;
- remoção de arquivos não relacionados;
- commit, push, merge ou PR.

Não leia `.env`, credenciais, bancos reais, SAP real, Databricks real ou dados corporativos. Use mocks, fixtures e dados sintéticos.

## Investigação obrigatória antes do fix

Leia estes arquivos:

- `frontend/src/features/verificar/dashboard.tsx`
- `frontend/src/features/verificar/nota-ficha-completa.tsx`
- `frontend/src/features/verificar/use-consulta-coffee.ts`
- `frontend/src/features/verificar/use-local-instalacao-correction.ts`
- `frontend/src/features/verificar/local-instalacao-correction.tsx`
- `frontend/src/features/verificar/campos-coffee.ts`
- `frontend/src/features/verificar/nota-ficha-completa.test.tsx`
- `frontend/src/features/verificar/campos-coffee.test.ts`
- `frontend/src/features/verificar/dashboard.test.tsx`
- `frontend/src/features/coffee/coffee-query-keys.ts`
- `frontend/src/features/coffee/types.ts`
- `frontend/src/api.ts`
- `docs/dev/01-frontend-verificar.md`
- `docs/dev/12-integracao-edicao-coffee.md`

Confirme no código o seguinte fluxo:

1. `NotaFichaCompleta` chama `useConsultaCoffee(noteId)`.
2. `useConsultaCoffee` observa `COFFEE_CONSULTA_KEY(id)` e usa `refetchOnMount: 'always'`.
3. `useLocalInstalacaoCorrection` cria outra observação da mesma query e também usa `refetchOnMount: 'always'`.
4. O botão `Atualizar consulta` chama `consulta.refetch()`.
5. O efeito do hook do local faz `setRascunho(...)` sempre que `consulta.data` muda de referência.
6. A ficha completa aparece antes de `Identificação & localização` em `dashboard.tsx`.
7. A ficha completa exibe destaques que também deveriam fazer parte do detalhe principal.

Não assuma que todo re-render é um bug. React precisa renderizar novamente quando os dados mudam. O bug é consulta duplicada, remontagem desnecessária, perda de estado visual ou uma ficha cuja ordem e fonte de dados ficaram erradas.

## Feedback loop / testes de regressão

Antes do código de produção, escreva testes que reproduzam os sintomas.

### Teste 1: política de consulta compartilhada

Usando a infraestrutura de testes existente no frontend:

- monte um detalhe que renderize simultaneamente a ficha completa e a correção de local;
- use um `QueryClient` de teste;
- mocke `EDPApi.consultarNota` com dado sintético;
- desabilite retry no teste;
- conte chamadas reais à função mockada;
- confirme que os dois componentes compartilham a mesma consulta e não fazem duas chamadas independentes ao montar;
- confirme que `refetchOnMount` não causa uma nova chamada toda vez que um observador monta enquanto os dados ainda estão frescos;
- confirme que clicar explicitamente em `Atualizar consulta` faz uma nova chamada, mas apenas uma chamada por clique;
- confirme que Strict Mode não produz chamadas duplicadas indevidas no contrato final.

Se a implementação escolhida mudar o desenho do hook, teste o comportamento e não o nome interno da função.

### Teste 2: atualização do local sem remontar a ficha

Monte o detalhe com dados de consulta sintéticos. Ao atualizar o local:

- a ficha deve receber os novos dados da mesma query;
- a ficha não pode perder seções abertas, foco ou conteúdo por causa de uma remontagem artificial;
- não deve haver uma segunda consulta automática causada apenas pelo `setQueryData` ou pela atualização do estado local;
- o rascunho do local deve ser atualizado apenas quando o valor consultado realmente mudar;
- não faça `setState` incondicional em cada mudança de referência do objeto de dados.

### Teste 3: ordem do detalhe

Renderize o detalhe e valide a ordem dos marcadores principais no HTML/DOM:

1. identificação e localização;
2. painel de correção do local, quando aplicável, próximo da identificação;
3. falhas/status;
4. ficha completa com campos adicionais do COFFEE no rodapé.

A ordem pode manter o bloco de duplicatas ou retorno operacional antes disso quando o fluxo exigir, mas a ficha completa não pode continuar ocupando o topo antes da identificação.

### Teste 4: não duplicar campos

A informação principal deve ter uma única fonte de renderização no detalhe. Cubra pelo menos:

- observação;
- referência elétrica;
- referência física;
- problema;
- local de instalação;
- poste;
- alimentador;
- ID SAP.

Esses campos devem aparecer em `Identificação & localização` quando a consulta COFFEE estiver disponível. A ficha de campos adicionais não deve renderizar os mesmos campos novamente.

A ficha deve continuar preservando campos crus que não estejam no resumo principal.

## Direção de arquitetura

Escolha a menor solução que elimine a causa, mas não faça um remendo local cego.

A direção preferida é ter um único fluxo de consulta por detalhe:

- uma política de query compartilhada;
- `staleTime` de 30 minutos mantido, se compatível com o contrato atual;
- nenhum `refetchOnMount: 'always'` para essa consulta fresca;
- atualização somente quando necessária ou explicitamente solicitada;
- uma única observação/owner no detalhe, se for simples passar o resultado para os subcomponentes;
- a correção de local usa a mesma consulta compartilhada para exibir o valor atual;
- após salvar, `setQueryData` atualiza a ficha sem disparar uma segunda consulta automática;
- releitura explícita continua existindo como confirmação da escrita, conforme o contrato atual;
- `setRascunho` só deve ocorrer se o valor formatado recebido for diferente do rascunho atual;
- não colocar `key={sel.id}` em componentes como forma de forçar atualização. Só mantenha uma key se ela for necessária para identidade real e comprovada.

Não remova a confirmação por releitura do COFFEE. Não transforme a consulta simples em escrita. Não faça o frontend fingir que a alteração foi confirmada sem o retorno correspondente.

Se houver duas queries legítimas, documente por que elas precisam existir e garanta deduplicação real. Não basta trocar uma flag sem testar o número de chamadas.

## Nova ordem e composição visual

O detalhe deve ficar organizado assim:

### Identificação & localização

Este é o bloco principal, visível antes da ficha adicional. Deve reunir as informações que o operador precisa para decidir e corrigir:

- tipo de nota;
- referência;
- problema;
- observação;
- referência física;
- **referência elétrica**;
- local de instalação;
- poste;
- alimentador;
- ID SAP;
- gerada por;
- UF/estado;
- setor;
- imagens;
- latitude;
- longitude;
- link para o mapa quando houver coordenadas válidas.

A referência elétrica não pode ficar apenas em `NotaFichaCompleta`. Ela deve aparecer no grid principal sempre que vier da consulta COFFEE ou de um campo normalizado equivalente. Cubra isso com teste usando um valor sintético, por exemplo `ELE-22`, e valide que o valor aparece no bloco `Identificação & localização`.

Use os dados normalizados de `Note` quando existirem e complemente com a consulta COFFEE compartilhada. Não exiba `undefined`, `null` ou objetos crus. Valores longos precisam quebrar linha sem estourar o layout.

Não crie dois cards com o mesmo campo apenas para reaproveitar código. Extraia uma configuração ou componente pequeno para os campos principais.

### Correção do local

Quando a nota tiver uma regra reconhecida por `regraLocalInstalacao`, o painel de correção deve continuar disponível. Ele deve ficar próximo da identificação, de modo que o usuário veja o valor apresentado, o valor atual do COFFEE e a ação de salvar no mesmo contexto.

Manter:

- valor da triagem;
- valor atual no COFFEE;
- rascunho editável;
- validação;
- salvar;
- atualizar consulta explícito;
- confirmação por releitura;
- encaminhar somente quando a confirmação permitir.

Remover do painel o botão **Abrir COFFEE**. Ele é redundante neste fluxo e ocupa espaço visual sem contribuir para a correção direta. Não substitua por outro botão de navegação equivalente. O painel deve terminar com a ação de salvar/atualizar e, quando confirmado, encaminhar para a Operação.

A consulta do painel não pode reconstruir ou reposicionar a ficha completa. Atualizar o dado é esperado; remontar a árvore inteira sem necessidade não é.

### Falhas e status

Manter as falhas de triagem e os estados de encaminhamento, mas sem repetir na ficha adicional os campos já mostrados acima.

### Ficha completa no rodapé

`NotaFichaCompleta` deve ser uma seção de informações adicionais do COFFEE, posicionada depois das informações principais e das ações de triagem/correção.

Ela pode permanecer visível como seção identificável, com grupos recolhidos, mas não pode roubar o primeiro lugar do detalhe.

Não renderizar novamente na ficha os campos já exibidos no bloco principal. O conjunto de exclusão deve cobrir aliases conhecidos, incluindo pelo menos:

- `observacao`;
- `observacoes`;
- `referencia_eletrica`;
- `referencia_fisica`;
- `poste`;
- `postes`;
- `alimentador`;
- `id_sap`;
- `problema`;
- `componente`;
- `componente_novo`;
- `sintoma`;
- `causa`;
- `local_instalacao`;
- aliases de cidade/tipo/número do local quando já aparecerem no resumo.

Não descartar campos adicionais. Os demais campos devem continuar agrupados e legíveis em:

- Identificação, se ainda houver campo adicional de identificação não exposto no resumo;
- Local e rede;
- Execução;
- Estado;
- Risco e segurança;
- Metadados.

Se um grupo não tiver conteúdo, não mostre grupo vazio.

## Restrições de implementação

- TypeScript sem `any`;
- manter componentes razoavelmente pequenos;
- usar os tokens de `app.css`/design existentes;
- não alterar contrato backend sem prova de que o frontend recebe dados insuficientes;
- não alterar regras de negócio de local, encaminhamento ou geração;
- não esconder campos para fazer o número parecer menor;
- não usar `JSON.stringify` como apresentação principal de um campo de domínio;
- não usar `key` ou remount para “resolver” dados stale;
- não silenciar erros de consulta;
- não deixar logs temporários de diagnóstico.

## Documentação

Atualize, se o comportamento mudar:

- `docs/dev/01-frontend-verificar.md`;
- `docs/dev/12-integracao-edicao-coffee.md`.

Documente:

- que consulta COFFEE, ficha adicional e correção de local compartilham a mesma fonte/cache;
- quando uma nova consulta pode ser disparada;
- que a ficha principal mostra os campos relevantes e a ficha adicional não os duplica;
- que atualizar consulta é uma ação explícita;
- que Strict Mode não é requisito para o comportamento correto.

## Validação obrigatória

Execute no frontend:

```bash
npm exec vitest run src/features/verificar
npm run build
git diff --check
```

Se o projeto tiver um comando específico para lint/typecheck, execute também.

Não declare sucesso se os testes não puderem ser executados. Registre exatamente o erro e diferencie falha preexistente de falha introduzida.

## Relatório final

Informe:

1. causa raiz confirmada da reconsulta/re-renderização;
2. por que Strict Mode não era a explicação completa, ou confirme se a evidência apontar o contrário;
3. arquivos alterados;
4. política final de consulta e quantidade de chamadas nos testes;
5. como o detalhe foi reorganizado;
6. quais campos foram movidos para `Identificação & localização`;
7. como a ficha adicional evita duplicação sem perder campos;
8. testes executados e resultados reais;
9. resultado do build e `git diff --check`;
10. qualquer limitação restante.

Não faça commit, push, merge, PR ou deploy.
