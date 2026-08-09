# Backend: integracao_module

## O que faz

`backend/integracao_module/` é a ponte entre o COFFEE (geração de notas
reais no SAP) e o Input (plano de notas do departamento): dado o `pk`
de uma nota já gerada no COFFEE, monta uma proposta de registro do
plano do Input e, sob confirmação do usuário, cria (ou atualiza) esse
registro. Não implementa cruzamento SAP nem geração — reusa
`coffee_module` e `input_module` como estão.

## Regra de direção

`integracao_module` conhece `coffee_module` e `input_module`;
**nenhum dos dois conhece `integracao_module`**. `coffee_module` e
`input_module` continuam sem se conhecer entre si — a composição
acontece só aqui. Essa regra está registrada no docstring de
`service.py` ("Direção de dependência: integracao -> {coffee,
input}.") e existe para que COFFEE e Input continuem podendo evoluir
(ou ser removidos) de forma independente.

`backend/integracao_module/mapping.py` é o **único ponto do sistema
que conhece os dois vocabulários** (campos do COFFEE de um lado,
colunas do plano do Input do outro). Qualquer de-para novo entre os
dois módulos deve entrar em `mapping.py`, não espalhado em `service.py`
ou nas rotas.

## Arquivos principais

| Arquivo | Responsabilidade |
|---|---|
| `backend/integracao_module/mapping.py` | De-para COFFEE → Input: `montar_proposta` (campos deriváveis do snapshot COFFEE + IW28), `avisos_proposta` (mapeamentos incertos, ex. prioridade fora da faixa), `montar_nova_nota` (proposta + campos manuais do usuário, manual vence). `Planejado_DDPM` vem de `fields.quantidade` (COFFEE); se a nota já está na extração IW28 e seu `Denom.conjunto` é um dos `CONJUNTOS_METRICOS` (rede — RDA, RDS, blindagem, multiplexada, etc.), o valor é convertido de metros para km (÷1000, rótulo "Km" só na exibição); para os demais conjuntos — ou enquanto o IW28 não tem a nota — o valor fica como veio (contagem de unidades), sem rótulo. |
| `backend/integracao_module/service.py` | Orquestração: `montar_revisao` (junta COFFEE + IW28 + plano existente numa revisão só) e `mover_para_plano` (cria ou atualiza o registro no plano do Input a partir de uma nota COFFEE). |
| `backend/integracao_module/routes.py` | Router FastAPI `/api/integracao/*` — endpoints finos que só validam, chamam `service` e traduzem exceções para status HTTP. |

## Endpoints

### `GET /api/integracao/nota/{pk}/revisao`

Monta a tela de revisão antes de mover uma nota COFFEE para o plano.
`pk` é a chave local da nota no snapshot do COFFEE (`coffee.db`), não o
número SAP.

Resposta (200) = retorno de `service.montar_revisao`:

```json
{
  "coffee": { "...": "snapshot bruto da nota no coffee.db" },
  "iw28": { "...": "registro da base_iw28, ou null se a nota ainda não tem SAP real" },
  "iw28_extraida_em": "2026-07-15T03:00:00",
  "plano": { "...": "registro já existente no plano do Input, ou null" },
  "ja_no_plano": false,
  "proposta": { "Numero_Nota": 12345678, "Local_Instalacao": "718ET00026773", "...": "..." },
  "avisos": ["Prioridade 7 do COFFEE está fora do de-para (1-6); usando 'Programável' — confira antes de mover."],
  "pode_mover": true,
  "motivo_bloqueio": null
}
```

Erros:

- `404` — `pk` não existe no snapshot local do COFFEE
  (`service.NotaNaoEncontradaErro`).

### `GET /api/integracao/resumo-fora-do-plano`

Contador para o botão "N nota(s) fora do plano" da home (Relatórios):
`{corrigidas_fora_do_plano: N}` — notas COFFEE com SAP real
(`service._sap_real`), não arquivadas (`coffee_db.listar_notas()` já
exclui), cujo `id_sap` não existe na tabela `notas` do plano
(`input_db.carregar_dados()`, lida uma única vez — sem N+1 por nota).

Opcionalmente filtrado pelo header `X-User` (a rota reusa a dependency
`usuario_coffee` de `coffee_module/routes.py`): quando presente,
`service.contar_fora_do_plano(usuario)` repassa o filtro direto para o
SQL de `coffee_db.listar_notas(usuario=...)` — só as notas do próprio
usuário **ou** sem dono (mesma regra estrita de visibilidade, ver
`05-backend-coffee-module.md`); sem o header, conta todas — mesmo
contrato "sem X-User = sem filtro" que a rota já tinha antes desta
mudança. O frontend (`EDPApi.resumoForaDoPlano`) sempre envia o header
via `coffeeFetch()` (`02-frontend-coffee.md`), então na prática o card
de Relatórios já mostra o número do usuário logado.

### `POST /api/integracao/mover-para-plano`

Cria (ou atualiza) registros do plano do Input a partir de notas
COFFEE já revisadas.

Requer o header `X-User` (mesma dependência `usuario_atual` de
`input_module/routes.py` — usada para carimbar o log de auditoria).

Corpo:

```json
{
  "pks": [4242],
  "campos_usuario": {
    "Mes_Execucao_Planejado": "ago-2026",
    "Status_Obra": "Linha Viva",
    "Observacao": "Texto editado pelo usuário",
    "Check": "OK"
  },
  "atualizar_existente": false
}
```

Resposta (200): `{"inseridas": <int>, "atualizadas": <int>}`.

Erros:

- `400` — header `X-User` ausente, ou `atualizar_existente=true` com
  mais de um `pk` (atualização vale para uma nota por vez).
- `404` — algum `pk` não existe no snapshot local do COFFEE, **ou**
  `atualizar_existente=true` para uma nota que ainda não está no plano
  (`service.NotaNaoEncontradaErro`).
- `409` — alguma nota já está no plano e `atualizar_existente=false`
  (`service.JaNoPlanoErro`), ou colisão de número de nota detectada
  pelo Input (`input_module.service.NotasDuplicadasErro`).
- `422` — alguma nota ainda não tem SAP real (pendente no COFFEE) —
  mover quebraria o cruzamento com o IW28 (`service.SapPendenteErro`).

Como no `POST /api/input/notas` existente, uma escrita bem-sucedida
invalida o cache em memória do `engine.py` do Input
(`engine.invalidar_cache()`) e agenda a cópia do Excel para a rede em
background (`tasks.add_task(engine.gerar_copia_excel_rede)`).

## Decisões do usuário (2026-07-15)

Registradas nos docstrings de `mapping.py`/`service.py`; documentadas
aqui para não ficarem só no código:

- **Prioridade é o índice 1–6** da lista `config.PRIORIDADES` do Input
  (`DE_PARA_PRIORIDADE` em `mapping.py`). O COFFEE só usa 1–6; valores
  fora da faixa (7–8, ou ausente) caem no fallback `"Programável"` e
  geram um aviso em `avisos_proposta` para o usuário conferir antes de
  mover — nunca bloqueiam a revisão.
- **Atualizar não reseta `Status_Nota`.** Ao mover com
  `atualizar_existente=true`, apenas `CAMPOS_ATUALIZAVEIS`
  (`Local_Instalacao`, `Circuito`, `Prioridade_Nota`, `Planejado_DDPM`) e os campos
  manuais do usuário são sobrescritos — inclusive `Status_Obra`, que é permitido
  somente nesse fluxo interno e não pelo editor genérico do Input. `Status_Nota` e
  `Data_Envio_Projeto` são estado do planejamento, não da nota COFFEE,
  e ficam intocados.
- **Lote é all-or-nothing.** `mover_para_plano` valida todas as notas
  do lote (`_carregar_validas`) antes de escrever qualquer coisa: se
  uma nota não existe ou está pendente no COFFEE, nada é criado/
  atualizado, mesmo que as demais notas do lote sejam válidas.

## Testes

`backend/test_integracao_module.py` cobre três camadas:

- `mapping` (de-para puro, sem banco).
- `service` (com o fixture `ambiente`, que cria bancos COFFEE/Input
  temporários e uma base `base_iw28` mínima).
- API (`test_api_revisao`, `test_api_mover_fluxo_completo`) — monta um
  `FastAPI()` isolado só com `integracao_module.routes.router` e usa
  `TestClient`, cobrindo os status HTTP 200/400/404/409/422 do fluxo
  completo (mover, tentar mover de novo, atualizar, mover nota
  pendente).

Rodar:

```bash
cd backend && python -m pytest test_integracao_module.py -v
```
