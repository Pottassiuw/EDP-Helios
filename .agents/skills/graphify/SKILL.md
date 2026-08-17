---
name: graphify
description: >
  Navigate a large codebase with Graphify's local code graph while minimizing
  token use and preserving verified context. Use when the user says "graphify",
  "grafo do código", "mapa do código", asks for impact analysis, dependencies,
  call paths, architectural orientation, or needs context-efficient exploration
  of a repository containing graphify-out/.
---

Use Graphify as navigation index, never as source of truth. Goal: inspect least code needed, retain only verified facts.

## Locate and freshness

1. Find nearest `graphify-out/graph.json`; default CLI graph is `graphify-out/graph.json` from project root.
2. Never read full `graph.json`, `graph.html`, or `GRAPH_REPORT.md` for a focused task. They are large and waste context.
3. Before relying on graph for a changed area, run `graphify check-update .`. If stale, say so and verify current source. Run `graphify update .` only when user asks to refresh graph or task needs broad impact analysis. It is local AST work; do not run `extract` or `label` unless explicitly requested because those may use an LLM/API.
4. Graph edges marked `INFERRED` are hypotheses. Verify them in source before stating them as facts or changing code.

## Token-first exploration

Start with one narrow question and a strict budget:

```bash
graphify query "where is <concept> implemented and what calls it?" --budget 300
graphify explain "<exact symbol>"
graphify path "<source symbol>" "<target symbol>"
graphify affected "<symbol>" --depth 2
```

- Use `query` first for orientation; use `explain` for one symbol; use `path` only for a known pair; use `affected` before altering shared APIs, schemas, or contracts.
- Begin `--budget 200–400`; raise once only if result lacks a needed path or symbol. Never use default 2000 blindly.
- Query exact symbol, feature, endpoint, or business term. Do not ask broad questions such as "explain architecture".
- Read returned paths/symbols selectively with `rg` then the smallest relevant source ranges. Read tests and `docs/dev/` only for affected feature.
- Prefer graph commands over recursive file listings; prefer targeted source reads over raw graph artifacts.

## Context discipline

Maintain a compact working ledger in reasoning, not repeated prose:

`goal | verified files/symbols | contract/invariants | open question | next read`

- Add facts only after source verification. Keep file paths and symbol names; discard raw query output once navigated.
- On long or multi-turn work, give a <=5-line checkpoint only when changing phase, blocked, or asked. Include changed/verified paths, invariant, next action.
- Do not restate task, architecture, command logs, or already verified facts every turn.
- Persist only reusable, verified discoveries after a completed investigation:

```bash
graphify save-result --question "<question>" --answer "<verified concise answer>" --type query --nodes "<symbol>" --outcome useful
graphify reflect --graph graphify-out/graph.json
```

Never save secrets, transient logs, guesses, or a result later corrected. Mark corrections with `--outcome corrected --correction "<fact>"`.

## Change workflow

1. Orient with a bounded graph query.
2. Verify direct code, contract, tests, and relevant developer manual.
3. Make minimal change.
4. Run targeted tests/type checks.
5. Run `graphify affected` again only when public/shared behavior changed; update required `docs/dev/` documentation.
6. Report only outcome, affected paths, verification, and remaining risk.

If Graphify is unavailable, graph is absent, or result is stale/ambiguous, fall back to `rg` plus targeted reads. Do not fabricate graph findings.
