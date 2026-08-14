# Contribuindo para o EDP-Helios

Este repositório usa **GitHub Issues + Project + Pull Requests** como fonte de rastreabilidade da entrega. A linha de integração do desenvolvimento é `develop`; não envie código diretamente para ela.

> O repositório é público. Nunca registre em Issues, comentários, anexos, commits ou Pull Requests credenciais, dados pessoais, caminhos internos de rede, dados de produção ou instruções exploráveis de segurança.

## 1. Comece por uma Issue

1. Pesquise por duplicatas e abra ou selecione uma Issue.
2. Defina objetivo, escopo, critérios de aceite, risco, dependências e testes esperados.
3. Classifique a Issue com área, prioridade e milestone. Para a Sprint 1 do Input, associe-a ao milestone `Sprint 1 — Input: integridade e operação`.
4. No [Project de entrega](https://github.com/users/Pottassiuw/projects/2), preencha `Sprint`, `Priority`, `Batch` e mova para **Ready** apenas quando o escopo estiver sem bloqueios.

## 2. Crie uma branch isolada

Use um worktree para não misturar uma entrega com alterações locais não relacionadas:

```bash
git fetch origin
git worktree add -b fix/input-criacao-atomica-18 \
  .worktrees/fix-input-criacao-atomica-18 origin/develop
cd .worktrees/fix-input-criacao-atomica-18
```

Convenção de nomes:

- `fix/<assunto>-<issue>` — correção;
- `feat/<assunto>-<issue>` — funcionalidade;
- `docs/<assunto>-<issue>` — documentação;
- `ci/<assunto>-<issue>` — automação de qualidade.

Ao iniciar, mova a Issue para **In Progress**. Cada Pull Request deve permanecer focado em uma Issue ou lote explicitamente justificado.

### Commits

Use Conventional Commits com escopo e referência à Issue:

```text
tipo(escopo): resumo no imperativo

Refs #<número>
```

Tipos aceitos: `fix`, `feat`, `docs`, `test`, `ci`, `perf`, `refactor` e
`chore`. Exemplos: `fix(input): impede criação concorrente de notas` e
`ci(github): valida metadados obrigatórios do PR`. O vínculo que fecha a
Issue fica no PR, com `Closes #<número>`, para que o fechamento ocorra apenas
quando o trabalho for integrado.

## 3. Desenvolva com teste e escopo mínimo

Para mudança de comportamento, escreva primeiro um teste que falhe pelo motivo esperado. Depois implemente o mínimo para fazê-lo passar e atualize a documentação de `docs/dev/` que descreve o módulo alterado.

Gates mínimos da base atual:

```bash
# Backend — executado a partir de backend/, após ativar o ambiente virtual
python -m pytest test_upload.py test_input_module.py

# Frontend — executado a partir de frontend/
npm ci
npx vitest run src/features/input
npm run build

# Raiz do repositório
git diff --check
```

Use os gates direcionados ao módulo alterado e acrescente testes de regressão para o defeito corrigido. Os testes do backend isolam o perfil/local de dados; não substitua essa blindagem por acesso a bases reais.

## 4. Abra o Pull Request

1. Revise o diff e confira que nenhum arquivo, segredo ou alteração fora de escopo entrou na branch.
2. Envie somente a branch da Issue: `git push -u origin HEAD`.
3. Abra um PR **para `develop`**, usando o template do repositório.
4. Inclua `Closes #<número>` quando o PR concluir integralmente a Issue.
5. Registre os comandos executados, resultados, riscos e rollback no corpo do PR.
6. Mova o cartão para **In Review** e solicite revisão.

Um PR não está pronto para merge sem:

- escopo e critérios de aceite atendidos;
- testes de regressão apropriados;
- build/frontend e verificações aplicáveis verdes;
- documentação atualizada quando o comportamento ou arquitetura mudou;
- revisão humana aprovada antes do merge.

## 5. Merge e encerramento

Após o merge em `develop` e a confirmação dos checks:

1. confirme no job `Synchronize merged delivery` que a Issue foi fechada e o Project foi movido para **Done**;
2. se o job falhar por acesso ao Project, corrija o secret `PROJECT_TOKEN` e execute o `workflow_dispatch` de `Delivery synchronization` para reconciliar o PR;
3. anote bloqueios, acompanhamento ou rollback em uma Issue separada quando necessário;
4. remova o worktree quando não precisar mais dele:

```bash
cd ../..
git worktree remove .worktrees/fix-input-criacao-atomica-18
```

## Estados do Project

| Estado | Significado |
|---|---|
| **Backlog** | Trabalho conhecido, ainda não selecionado. |
| **Ready** | Escopo e dependências claros; pode receber branch. |
| **In Progress** | Implementação ou validação em andamento. |
| **In Review** | PR, evidências e checks disponíveis para revisão. |
| **Blocked** | Aguarda decisão, acesso, dependência ou reconciliação de baseline. |
| **Done** | Merge em `develop` e gates declarados aprovados. |
