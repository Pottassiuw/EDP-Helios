# EDP Verify — De olho no Problema

Painel de triagem de notas SAP: importa a planilha de verificação, lista as
notas com falhas (coordenada, imagens, referência, duplicata…), permite
comparar duplicatas lado a lado e abrir notas direto no COFFEE.

## Estrutura

```
├── frontend/   React 18 + TypeScript + Vite + TanStack Query
│   └── src/
│       ├── features/
│       │   ├── verificar/      triagem de notas (dashboard, upload,
│       │   │                   KPIs, comparação de duplicatas)
│       │   ├── coffee/         hub COFFEE (verificar, abrir,
│       │   │                   operação, concluídas, logs)
│       │   ├── input/          gestão de notas do departamento
│       │   └── configuracoes/  preferências (tema, densidade, cor)
│       ├── components/
│       │   ├── ui/             shadcn (vendored, editável)
│       │   ├── branded/        composições sobre ui/
│       │   └── app-sidebar.tsx navegação principal
│       ├── api.ts              integração com o backend + COFFEE/Maps
│       └── types.ts            tipos compartilhados
├── backend/    FastAPI + pandas
│   ├── main.py           endpoints /api/* + parsing da planilha
│   ├── coffee_module/    hub COFFEE: banco SQLite, jobs, cliente da API COFFEE
│   ├── input_module/     módulo Input: banco SQLite local + motor de
│   │                     enriquecimento (Excels da rede EDP) + /api/input/*
│   └── test_*.py         testes (pytest)
└── docs/       especificações e planos de design
```

## Desenvolvimento

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

O app exige o backend rodando — não há modo demo. A base da API é
configurável via `localStorage.setItem('edp_api', 'http://SEU_HOST:8000/api')`.

## Produção

```bash
cd frontend && npm run build   # gera frontend/dist/ (não versionado)
cd ../backend
set EDP_PERFIL=producao        # banco de notas = arquivo da rede
uvicorn main:app
```

O FastAPI serve `frontend/dist/` como estático e expõe a API no mesmo
processo (porta 8000).

`EDP_PERFIL=producao` faz o módulo Input ler e gravar direto no banco
compartilhado da rede — é o que faz notas criadas por outra pessoa
aparecerem para todo mundo. Sem acesso à rede o servidor **falha de forma
explícita** em vez de servir a cópia local desatualizada. O padrão
(`local`) mantém `backend/data/notas_departamento.db` para
desenvolvimento. Variáveis em `backend/.env.example`, detalhes em
[docs/dev/06-backend-input-module.md](docs/dev/06-backend-input-module.md).

## Hub COFFEE

O fluxo de COFFEE é dividido em **Verificar**, **Abrir**, **Operação**,
**Concluídas** e **Logs**. Verificar lê o `Verificar.db` compartilhado em modo
somente leitura e encaminha as notas selecionadas à fila persistida de
Operação, exibida como Kanban (Fila, Prontas para gerar,
Processando e Aguardando SAP). Concluídas é o histórico separado: notas
geradas podem ser arquivadas e somente notas corrigidas podem ser movidas para
o plano.

## API

| Ação                  | Requisição                     | Retorno |
|-----------------------|--------------------------------|---------|
| Carregar dados        | `GET  /api/data`               | `{ records, completed, rule_stats, … }` |
| Triagem SQLite        | `GET /api/data`                | Lê `ids_verificacao` de `Verificar.db` |
| Importar planilha     | `POST /api/upload` (multipart) | Compatibilidade/testes; não é usado pela interface |
| Encaminhar / retirar  | `POST /api/coffee/marcar-gerar` | Controla a fila COFFEE e a rastreabilidade |
| Marcar como duplicata | `POST /api/duplicata/{id}`     | `{ status }` |

## Módulo Input (Gestão de Notas)

Porte do painel Streamlit do departamento (spec em
`docs/superpowers/specs/2026-06-11-input-module-design.md`).

- Banco: em `EDP_PERFIL=producao`, o próprio arquivo compartilhado da rede
  (sem cópia local, sem espelhamento). Em `local` (padrão),
  `backend/data/notas_departamento.db`, migrado da rede na primeira
  execução — nesse perfil as escritas **não** voltam para a rede.
- O motor cruza o banco com as planilhas da rede EDP (SAP IW28/IW38,
  indicadores ANEEL etc.); sem rede, o painel funciona com indicadores parciais.
- Após cada salvamento, regrava `Base_Notas_Sincronizada.xlsx` na rede
  (alimenta o BI do departamento) e mantém backups rotativos locais.
- Escritas exigem o header `X-User` (a UI pede o nome na primeira edição).
- API: `GET/PATCH/POST/DELETE /api/input/notas`, `/api/input/desfazer`,
  `/api/input/logs*`, `/api/input/export`, `/api/input/responsaveis`,
  `/api/input/bases*`, `/api/input/backups*`, `/api/input/sync`.
- O módulo não tem modo demo: exige o backend rodando.

## Testes

```bash
cd backend && python -m pytest test_upload.py test_input_module.py   # backend
cd frontend && npm run build                    # type-check (tsc) + build
```

## Entrega no GitHub

O fluxo de entrega usa Issue → branch isolada → Pull Request → revisão →
merge em `develop`. As regras operacionais, gates e estados do Project estão
em [CONTRIBUTING.md](CONTRIBUTING.md) e no manual
[docs/dev/13-github-delivery-workflow.md](docs/dev/13-github-delivery-workflow.md).
