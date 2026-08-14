# Helios — Governança de Dados, Carteira, Relatórios e COFFEE → Plano

> **Para o Claude Code:** executar somente após revisão do usuário. Usar Sonnet, trabalhar em branch própria baseada em `develop`, seguir `CLAUDE.md`/`AGENTS.md`/`DESIGN.md` e executar os gates do projeto.

**Objetivo:** corrigir a semântica das métricas da Carteira/Relatórios, reconciliar notas COFFEE com Carteira e Plano/Input e criar promoção robusta, auditável e parcialmente tolerante a falhas.

**Arquitetura:** manter Carteira como fonte de regional/conjunto e metas como referência temporal pelo mês da meta; manter Plano/Input como fonte operacional consumida pelos Relatórios; integrar COFFEE como fonte de notas SAP reais; centralizar normalização, identidade, status, unidades e reconciliação no backend, sem duplicar regras no React.

**Estado:** planejamento somente. Nenhum código foi alterado por este plano.

---

## Decision ledger

### Decisões confirmadas pelo usuário

1. `id_onr` da Carteira corresponde ao identificador do registro COFFEE (`pk`). Deve ser validado no código e documentado no contrato.
2. Interpretação provisória do item 2: a reconciliação considera a chave composta `id_onr + id_sap`. **Confirmar antes da implementação**, pois o código atual usa somente `id_sap == Numero_Nota`.
3. Valores `99999999` e `1000000` são placeholders/IDs inválidos para a integração. O código atual também usa `10000000`; a lista final precisa ser consolidada, sem espalhar literais.
4. Status canônico de execução: `99`.
5. A quantidade deve ser normalizada segundo a unidade/regra do conjunto ao copiar Carteira → Plano.
6. Canceladas aparecem separadas e não devem ser misturadas com executadas.
7. Atualização automática da Carteira: job a cada 15 minutos.
8. Carteira deve mostrar somente SAP real; EP e DD ficam fora da Carteira.
9. Promoção para Plano é uma cópia com campos manuais, seleção persistente, validação e auditoria.
10. Promoção em lote deve seguir sucesso parcial: válidas são promovidas; inválidas são reportadas individualmente.

### Pontos comprovados na investigação read-only

- Dashboard principal: `GET /api/carteira/dashboard`.
- Composição: `backend/carteira_module/service.py`, `backend/carteira_module/dashboard.py` e `backend/input_module/relatorios.py`.
- Meta: grão `Ano × Mês × Regional × Plano`.
- Unidade: `planos_depara.Unidade`; `KM` atualmente usa conversão de quantidade `/ 1000`.
- Plano/Input: `Numero_Nota` é a identidade usada pela integração atual.
- COFFEE: API externa + `coffee.db`; tabelas `notas_coffee`, `coffee_logs`, `coffee_operacoes`, `coffee_fila_operacao`.
- Ponte existente: `/api/integracao/nota/{pk}/revisao` e `/api/integracao/mover-para-plano`.
- O lote atual é all-or-nothing e a UI restringe `corrigida`, mas o backend aceita nota gerada com SAP real.
- Não há scheduler periódico da Carteira; sincronização atual é manual/síncrona.
- Canceladas não têm métrica quantitativa própria em Relatórios.
- Há duas definições atuais de executada: código `99`/`ENCE EXEC` em Relatórios e `Encerrado`/data de execução na Carteira.

### Riscos conhecidos

- Somar `Und.`, `KM` e `Ponto` em KPI global produz total sem unidade física única.
- Cópia atual para Input pode preservar quantidade bruta enquanto dashboard converte KM.
- Igualdade textual de rubrica/plano é frágil.
- Leitura de existência e escrita no Plano não formam uma transação de negócio única.
- Jobs daemon e scheduler no processo não são seguros para múltiplas instâncias.
- UI e backend possuem regras divergentes sobre quais notas podem ser promovidas.
- Placeholder real do código (`10000000`) diverge dos valores informados pelo usuário.

---

## Plano de implementação para Claude Code/Sonnet

### Fase 0 — Fechar contrato e baseline

**Arquivos de referência:**
- `CLAUDE.md`
- `AGENTS.md`
- `DESIGN.md`
- `docs/dev/10-backend-carteira-module.md`
- `docs/dev/11-frontend-carteira.md`
- `docs/dev/09-frontend-relatorios.md`
- `docs/superpowers/specs/2026-07-23-carteira-fase-3-dashboard-design.md`
- `docs/superpowers/specs/2026-07-29-carteira-fase-4a-convergencia-relatorios-design.md`

**Passos:**
1. Confirmar se a chave de reconciliação é realmente `id_onr + id_sap`, ou somente `id_sap`.
2. Localizar o contrato real de `id_onr` no Databricks/C​​arteira e documentar sua equivalência com `coffee.pk`.
3. Consolidar placeholders inválidos em configuração central, incluindo a decisão sobre `10000000`.
4. Fixar o status canônico `99` e mapear os nomes dos campos de COFFEE/Input.
5. Definir o payload canônico de métricas separando `unidades`, `medidas/km` e demais unidades.
6. Registrar snapshot inicial e rodar os gates sem modificar dados de produção.

**Validação:** não usar `EDP_PERFIL=producao`; registrar `git status`; confirmar testes baseline.

### Fase 1 — Domínio de medidas e métricas

**Arquivos prováveis:**
- `backend/carteira_module/dashboard.py`
- `backend/carteira_module/mapping.py`
- `backend/input_module/relatorios.py`
- `backend/input_module/metas.py`
- `backend/carteira_module/service.py`
- `backend/carteira_module/repository.py`
- testes correspondentes em `backend/test_*.py`

**Passos:**
1. Criar testes vermelhos para agregação por tipo de unidade e conjunto.
2. Implementar normalização explícita de quantidade com unidade de origem, unidade normalizada e fator de conversão.
3. Separar métricas de unidade, KM/medida e ponto no contrato backend.
4. Calcular meta, planejado, executado, cancelado e faltante por `mês da meta × regional × conjunto/plano × unidade`.
5. Manter canceladas em série própria; não agregá-las com executadas.
6. Usar status canônico `99` para executada, documentando exceções de origem.
7. Diferenciar `meta mensal` de `visão anual` no payload, evitando que filtro mensal altere parcialmente um payload anual.
8. Retornar estado de fonte: versão, última atualização, sincronizado/desatualizado/erro.

**Testes:**
- unidade não soma com KM;
- KM converte metros para km exatamente uma vez;
- meta usa o mês da meta;
- executada usa status `99`;
- cancelada é separada;
- meta zero não divide;
- sobra de um plano não compensa falta de outro quando o KPI for por plano.

### Fase 2 — Reconciliação Carteira ↔ COFFEE ↔ Plano

**Arquivos prováveis:**
- `backend/coffee_module/classify.py`
- `backend/coffee_module/config.py`
- `backend/coffee_module/client.py`
- `backend/coffee_module/db.py`
- `backend/integracao_module/service.py`
- `backend/integracao_module/mapping.py`
- `backend/integracao_module/routes.py`
- `backend/carteira_module/repository.py`
- `backend/carteira_module/movimentacao.py`

**Passos:**
1. Criar função única de elegibilidade: SAP real, não EP/DD, sem placeholder, campos mínimos válidos.
2. Remover literais de placeholder de filtros espalhados.
3. Criar consulta de candidatas COFFEE baseada nos filtros de mês/regional/conjunto do dashboard.
4. Reconciliar por chave definida no Fase 0 e preservar também `coffee_pk`, `id_onr`, `id_sap` e `Numero_Nota` para auditoria.
5. Consultar existência no Plano em lote, não carregar o Plano repetidamente por nota.
6. Retornar candidatas com motivos: elegível, já no Plano, sem SAP real, EP/DD, placeholder, duplicada, campos faltantes ou conflito.
7. Reusar a mesma reconciliação no Relatórios e na Carteira.

**Testes:**
- EP/DD nunca aparece como candidata;
- placeholders nunca aparecem;
- SAP real aparece;
- candidato já no Plano é marcado sem duplicar;
- chaves divergentes são reportadas;
- filtros alterados não perdem seleção por ID estável.

### Fase 3 — Promoção para Plano com sucesso parcial

**Arquivos prováveis:**
- `backend/integracao_module/service.py`
- `backend/integracao_module/routes.py`
- `backend/input_module/service.py`
- `backend/input_module/db.py`
- `backend/carteira_module/movimentacao.py`
- `frontend/src/features/coffee/mover-plano-modal.tsx`
- `frontend/src/features/carteira/mover/mover-modal.tsx`

**Passos:**
1. Criar preview que retorna resultado individual por nota antes da mutação.
2. Validar campos manuais de domínio; não aceitar `"-"`/vazio como válidos onde o negócio exigir preenchimento.
3. Normalizar quantidade conforme conjunto/unidade e persistir origem, unidade original e valor normalizado.
4. Promover notas válidas e continuar após inválidas.
5. Retornar `promovidas`, `já existentes`, `inválidas`, `conflitos` e `erros` por nota.
6. Garantir idempotência por chave de negócio e tratar concorrência no banco.
7. Registrar auditoria com usuário, filtros, origem, timestamp, chave e resultado.
8. Fazer UI refletir a regra do backend; não restringir elegibilidade somente em React.

**Testes:**
- lote misto promove válidas e reporta inválidas;
- repetição não duplica;
- concorrência não cria duas linhas;
- campos manuais são validados;
- atualização explícita não sobrescreve campos protegidos.

### Fase 4 — Dashboard da Carteira e Relatórios

**Arquivos prováveis:**
- `frontend/src/features/carteira/dashboard/kpis-dashboard.tsx`
- `frontend/src/features/carteira/dashboard/*`
- `frontend/src/features/relatorios/*`
- `frontend/src/features/carteira/use-carteira-dashboard.ts`
- `frontend/src/features/relatorios/use-dashboard.ts`
- `frontend/src/features/relatorios/use-relatorios-data.ts`
- tipos compartilhados das duas features

**Passos:**
1. Substituir KPIs mistos por blocos separados por grandeza.
2. Adicionar filtros mensal, regional e conjunto usando contrato único.
3. Mostrar meta, executado, cancelado, faltante e cobertura separadamente.
4. Mostrar timestamp/versão do snapshot.
5. Adicionar painel de candidatas COFFEE para o contexto filtrado.
6. Preservar seleção por identificador estável ao trocar filtros/paginação.
7. Adicionar prévia, confirmação e resultado de promoção.
8. Tratar estados: sem sincronização, vazio real, erro, desatualizado e atualização em andamento.

**Testes:**
- filtro mensal não mistura payload anual;
- regional/conjunto mantêm consistência entre Carteira e Relatórios;
- unidades são renderizadas separadas;
- seleção persiste durante filtros;
- erro de COFFEE não aparece como zero silencioso.

### Fase 5 — Job de sincronização a cada 15 minutos

**Arquivos prováveis:**
- `backend/carteira_module/sync.py`
- `backend/carteira_module/service.py`
- entrypoint de aplicação/backend;
- configuração de jobs existente;
- documentação operacional.

**Passos:**
1. Definir executor único e lock de execução entre instâncias autorizadas.
2. Tornar sincronização idempotente e persistir versão/snapshot/resultado.
3. Registrar início, fim, duração, novas, atualizadas, removidas, inválidas e falhas.
4. Executar a cada 15 minutos sem bloquear requests da API.
5. Expor estado do job no dashboard.
6. Garantir recuperação após restart e evitar duas execuções simultâneas.
7. Definir política de falha: manter último snapshot válido e marcar desatualizado.

**Testes:**
- duas execuções simultâneas;
- restart durante sync;
- falha parcial da fonte;
- snapshot anterior preservado;
- ETag muda apenas quando a versão muda.

### Fase 6 — Documentação e gates

**Documentar:**
- dicionário de dados;
- chaves e origem;
- placeholders;
- status canônico;
- unidade/conversão;
- fluxo COFFEE → Plano;
- auditoria;
- job de 15 minutos;
- política de falha e frescor.

**Gates obrigatórios:**

```bash
cd backend
python -m pytest test_upload.py test_input_module.py

cd ../frontend
npm run build

git diff --check
```

Também executar testes novos específicos antes dos gates completos.

---

## Perguntas pendentes antes da implementação

1. Confirmar a interpretação do item 2: chave composta `id_onr + id_sap` ou somente `id_sap`?
2. Confirmar o destino de cada placeholder: `99999999`, `1000000` e `10000000`.
3. Confirmar se o status `99` é lido em `Status_Final`, `Status_Nota`, `Export_status` ou em mais de um campo com precedência definida.
4. Confirmar quais campos manuais são obrigatórios no domínio.
5. Confirmar se uma nota cancelada continua compondo o faltante.
6. Confirmar a unidade original da quantidade Carteira para cada plano KM.

## Critérios de aceitação globais

- Nenhum KPI soma grandezas incompatíveis.
- Relatórios e Carteira usam a mesma semântica de métrica.
- Apenas SAP real e elegível aparece para promoção.
- EP/DD e placeholders são excluídos no backend.
- Promoção parcial reporta cada inválida sem perder válidas.
- Repetição não duplica Plano.
- Todas as promoções possuem auditoria.
- Job de 15 minutos não duplica execução e preserva último snapshot válido.
- Nenhuma alteração usa produção automaticamente.
- Backend e frontend passam os gates existentes.
