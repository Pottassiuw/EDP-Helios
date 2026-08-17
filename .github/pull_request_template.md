## Issue

Closes #<número da Issue>

## Objetivo e escopo

- Descreva o objetivo e o limite do PR.

## Alterações realizadas

- Liste alterações observáveis.

## Critérios de aceite

- [ ] Critérios da Issue atendidos.
- [ ] Nenhuma alteração fora de escopo foi incluída.
- [ ] A documentação em `docs/dev/` foi atualizada quando o comportamento ou a arquitetura mudou.

## Evidências de validação

- [ ] `python -m pytest test_upload.py test_input_module.py` *(quando aplicável; executado em `backend/` com o ambiente virtual ativado)*
- [ ] `npx vitest run src/features/input` *(quando aplicável; executado em `frontend/`)*
- [ ] `npm run build` *(quando aplicável; executado em `frontend/`)*
- [ ] `git diff --check`

Resultado e observações (registre ao menos um gate marcado acima):

```text
Substitua este texto pelo resultado resumido. Não inclua dados, caminhos ou credenciais sensíveis.
```

## Riscos e rollback

- Risco:
- Rollback:

## Checklist de revisão

- [ ] O cartão do Project está em **In Review**.
- [ ] Não há segredos, dados pessoais, caminhos internos ou dados de produção no diff, PR ou anexos.
- [ ] A branch referencia a Issue e o PR é direcionado a `develop`.
- [ ] Os checks automatizados relevantes estão verdes.
- [ ] Solicitei revisão antes do merge.
