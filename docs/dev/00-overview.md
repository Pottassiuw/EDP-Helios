# Manual do Desenvolvedor — Visão Geral

## O que é este projeto

O EDP Verify ("De olho no Problema") é um painel de triagem de notas SAP
para a equipe de manutenção da EDP. Ele importa a planilha de verificação,
lista notas com falhas (coordenada, imagens, referência, duplicata…) e
permite comparar duplicatas lado a lado. Três módulos principais cobrem o
fluxo de trabalho do usuário: **Verificar** (triagem inicial da planilha),
**COFFEE** (gera e acompanha notas reais no SAP a partir das notas
triadas) e **Input** (gestão contínua das notas do departamento, cruzando
bases SAP IW28/IW38/IW66). O usuário tipicamente triagem na aba Verificar,
envia notas válidas para a fila do COFFEE, e usa o Input para
acompanhamento e correção de dados no dia a dia.

## Arquitetura

O frontend segue arquitetura feature-first: `features/{verificar, coffee,
input, configuracoes}` concentram a lógica de negócio de cada módulo, e
`components/{ui, branded}` ficam reservados a código genérico e reutilizável
— `components/ui/` é o shadcn vendorizado (editável) e `components/branded/`
são composições sobre `ui/`. Essa regra está registrada em `CLAUDE.md`
("Business logic belongs inside features. Global folders should contain
only reusable code.").

Essa estrutura foi introduzida no SP1
([spec](../superpowers/specs/2026-07-06-refatoracao-sp1-limpeza-estrutura-design.md)).
Antes do SP1, o frontend estava "meio feature-first": `coffee/` e `input/`
já eram features, mas a feature Verificar vivia espalhada em `components/`
(dashboard, upload-screen, kpi-drawer, duplicate-compare, shared)
misturada com o shell da aplicação (`app-sidebar`) e o código vendorizado
(`ui/`, `branded/`). O SP1 moveu esses arquivos de Verificar para
`features/verificar/` com `git mv`, deixando uma feature = uma pasta em
todo o frontend.

## Stack

### Frontend

- **React 18** — biblioteca de UI usada em todo o frontend.
- **TypeScript** — tipagem estática; `CLAUDE.md` proíbe `any` e pede
  `unknown` ou tipos próprios.
- **Vite** — build tool e dev server (`npm run dev` sobe em `:5173` com
  proxy `/api` → `:8000`, conforme README).
- **Tailwind v4** — o preflight global foi ligado no SP2a, substituindo o
  hack `.ui-reset` que existia antes (detalhado em
  `04-frontend-shared.md`).
- **Radix UI via shadcn** (`components/ui/`) — vendorizado, mas é
  editável diretamente por decisão explícita registrada em `CLAUDE.md`
  ("`src/components/ui/` is vendored, but it is project code — edit it
  directly to theme, resize, or adjust a primitive's default behavior.").
  Ver `04-frontend-shared.md`.
- **React Query** — solução padrão de estado de servidor, conforme
  `CLAUDE.md` ("React Query is the default server state solution.").
- **Lucide** — biblioteca de ícones usada nos componentes (ex.:
  `ChevronDown` em `app-sidebar.tsx`).
- **Sonner** — usada para toasts (`Toaster` em `App.tsx`); não foi
  encontrada uma justificativa documentada além de ser a lib de toast
  listada no stack do `CLAUDE.md`.

### Backend

- **FastAPI** — framework do backend; `CLAUDE.md` pede endpoints finos
  ("validate, call services, return responses").
- **Python** — linguagem do backend.
- **Pandas** — usado para ler a planilha de upload (`pd.read_excel`/
  `pd.read_csv` em `backend/main.py`) e, no `input_module`, para cruzar as
  bases SAP IW28/IW38/IW66 (detalhado em `06-backend-input-module.md`).
- **OpenPyXL** — leitura/escrita de arquivos `.xlsx` (dependência de
  suporte do Pandas para Excel).
- **httpx** — cliente HTTP usado em `coffee_module/client.py` para a
  integração com a API externa do COFFEE (detalhado em
  `05-backend-coffee-module.md`).

Uma decisão notável do módulo Input: o cache local em SQLite
(`salvar_base_dataframe`/`carregar_base_dataframe`) substituiu a leitura
direta de Excel a cada requisição — detalhado em
`06-backend-input-module.md`.

## Como rodar localmente

Comandos extraídos do `README.md` e de `frontend/package.json`/
`backend/requirements.txt`:

```bash
# Terminal 1 — backend (porta 8000)
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

# Terminal 2 — frontend (porta 5173, com proxy /api → :8000)
cd frontend
npm install
npm run dev
```

O app exige o backend rodando — não há modo demo (removido no SP1). A base
da API é configurável via
`localStorage.setItem('edp_api', 'http://SEU_HOST:8000/api')`.

Build de produção (`README.md`):

```bash
cd frontend && npm run build   # gera frontend/dist/ (não versionado)
cd ../backend && uvicorn main:app
```

O FastAPI serve `frontend/dist/` como estático e expõe a API no mesmo
processo (`backend/main.py:330-332`). No Windows, `iniciar_sistema.bat` oferece cinco opções: produção
(backend + frontend compilado), desenvolvimento (backend + Vite), build do
frontend sem iniciar servidor, apenas backend com `--reload` e saída. O modo
de produção sempre executa `npm run build` antes de iniciar o servidor; se o
Node, as dependências (`npm ci`) ou o build falharem, ele informa o erro e
não inicia com um `dist` potencialmente desatualizado. O script inicializa o `fnm`
antes de buscar `npm`, priorizando `%USERPROFILE%\Documents\fnm-windows\fnm.exe`
e aceitando também `%USERPROFILE%\AppData\Local\fnm\fnm.exe` ou o `PATH`.
Se o FNM/Node/npm não estiver disponível, o script aborta em vez de usar
silenciosamente uma versão do sistema. As versões ativas de Node e npm são
exibidas no início; `npm.cmd` é chamado com `call`, pois executá-lo sem
`call` encerra o fluxo do batch antes do menu. O cabeçalho do `.bat` também registra uma regra de
manutenção: não alterar executáveis, Node/npm, FNM, versões ou caminhos sem
solicitação explícita.

Testes (`README.md`):

```bash
cd backend && python -m pytest test_upload.py test_input_module.py   # backend
cd frontend && npm run build                    # type-check (tsc) + build
```

## Mapa dos módulos

| Módulo | Caminho | O que faz | Doc detalhado |
|---|---|---|---|
| Relatórios | `frontend/src/features/relatorios/` | Central de Recomposição com Dashboard geral, carteira regional, mensalização, financeiro, postergações e exportação | [09-frontend-relatorios.md](./09-frontend-relatorios.md) |
| Verificar | `frontend/src/features/verificar/` | Triagem da planilha, upload, KPIs, comparação de duplicatas | [01-frontend-verificar.md](./01-frontend-verificar.md) |
| COFFEE | `frontend/src/features/coffee/` | Geração de notas no SAP via COFFEE, consulta de status, correção, logs | [02-frontend-coffee.md](./02-frontend-coffee.md) |
| Input | `frontend/src/features/input/` | Gestão de notas do departamento, edição em lote, sincronização SAP | [03-frontend-input.md](./03-frontend-input.md) |
| Compartilhado | `frontend/src/components/`, `frontend/src/features/configuracoes/`, `frontend/src/context/`, `frontend/src/hooks/` | shadcn (`ui/`), composições (`branded/`), sidebar, tema/densidade/accent, hooks utilitários | [04-frontend-shared.md](./04-frontend-shared.md) |
| Backend — coffee_module | `backend/coffee_module/` | Integração com COFFEE/SAP, jobs em background, classificação de notas | [05-backend-coffee-module.md](./05-backend-coffee-module.md) |
| Backend — input_module | `backend/input_module/` | Cruzamento IW28/IW38/IW66, cache SQLite, sincronização SAP | [06-backend-input-module.md](./06-backend-input-module.md) |
| Fluxos de negócio | (cross-cutting) | Ciclo de vida de uma nota, regra de geração COFFEE, timings consolidados | [07-fluxos-de-negocio.md](./07-fluxos-de-negocio.md) |
| Backend — integracao_module | `backend/integracao_module/` | Ponte COFFEE → Input: monta revisão de uma nota gerada e move (cria/atualiza) o registro correspondente no plano | [08-integracao-coffee-input.md](./08-integracao-coffee-input.md) |
| Backend — databricks_module | `backend/databricks_module/` | Integração genérica e reutilizável com o Databricks SQL Warehouse (client, config, descoberta de schema); base da Carteira de Notas | [09-backend-databricks-module.md](./09-backend-databricks-module.md) |
| Backend — carteira_module | `backend/carteira_module/` | Projeção local da base COFFEE (Databricks), sync idempotente, situação derivada e API do explorador da Carteira de Notas | [10-backend-carteira-module.md](./10-backend-carteira-module.md) |
| Carteira | `frontend/src/features/carteira/` | Explorador da base COFFEE (Databricks): tabela paginada, filtros, situação, detalhe e sincronização — referência de não-regressão da direção visual Supabaze (DESIGN.md), hoje global | [11-frontend-carteira.md](./11-frontend-carteira.md) |
| Backend — Verificar | `backend/verificar_module/`, `backend/main.py` | Leitura read-only de `Verificar.db`, normalização da triagem e endpoint `/api/data`; o upload é só compatibilidade | [01-frontend-verificar.md](./01-frontend-verificar.md) |
| Entrega no GitHub | `.github/`, `CONTRIBUTING.md`, GitHub Issues/Project/PRs | Processo de Issue → branch isolada → Pull Request → revisão → merge, templates e gates automatizados | [13-github-delivery-workflow.md](./13-github-delivery-workflow.md) |

## Pontos de atenção

- A triagem de produção não depende de `RECORDS`/`COMPLETED` nem de
  `app_state.json`: `GET /api/data` lê o `Verificar.db` compartilhado em modo
  somente leitura. Esses estados e o endpoint `/api/upload` restam apenas para
  compatibilidade/testes e não são restaurados no startup.
- `backend/main.py:17-22` — CORS liberado para `allow_origins=["*"]`,
  `allow_methods=["*"]`, `allow_headers=["*"]`.
- `backend/main.py` — `GET /api/data` só envia em `raw` as colunas da
  interface `NoteRaw` (`_RAW_UTEIS`/`slim_raw`). A fonte Verificar contém
  dezenas de colunas extras que o frontend nunca lê: mandar todas
  representava ~76% do corpo. Medido com a sonda `[COFFEE-PERF]`
  (5000 notas): 1232 ms / 10,6 MB antes, 459 ms / 3,4 MB depois. Esse é o
  payload que a seção COFFEE > Verificar consome ao abrir.
- Instrumentação de performance: `EDP_PERF=1` no backend loga
  `[COFFEE-PERF] <método> <rota> <status> <ms> <bytes>` para `/api/data` e
  `/api/coffee/*` (mais o tempo de banco em `GET /coffee/notas` e
  `GET /coffee/operacao`); `localStorage.setItem('edp_perf','1')` no
  navegador loga rede/parse/normalize e numera as chamadas, expondo
  chamadas duplicadas. Desligada por padrão nos dois lados.
- Perfil de banco do módulo Input (`EDP_PERFIL`): em `producao` o banco de
  notas **é** o arquivo da rede e a falta de acesso levanta erro em vez de
  cair no banco local. Detalhes em
  [06-backend-input-module.md](./06-backend-input-module.md).
- `backend/main.py:37-53` — o agendador da extração noturna do SAP não usa
  um scheduler de verdade: é um `while True` que testa `hour == 3 and
  minute == 0` a cada 30 segundos e depois dorme 61 minutos para não
  repetir no mesmo minuto.
