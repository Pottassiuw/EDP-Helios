# CLAUDE.md

This document defines the engineering rules for this repository.

These rules take priority over default coding habits unless the user explicitly requests otherwise.

---

# Philosophy

This project values maintainability above speed.

Every change should make the codebase easier to understand.

Always optimize for:

- readability
- consistency
- simplicity
- low coupling
- high cohesion

Avoid clever code.

Avoid unnecessary abstractions.

Prefer boring solutions.

---

# Development Workflow

Every implementation follows this order.

## 1. Understand

Before writing code:

- Understand the request.
- Search the existing code.
- Understand current patterns.
- Reuse existing solutions whenever possible.

Never start coding immediately.

---

## 2. Plan

Think before implementing.

If the task is non-trivial:

- identify affected modules
- identify possible side effects
- explain the implementation plan

Never implement blindly.

---

## 3. Implement

Write the minimum amount of code required.

Do not refactor unrelated areas.

Avoid introducing new patterns unless clearly superior.

---

## 4. Review

Before finishing, verify:

- duplicated logic
- dead code
- unnecessary complexity
- unused imports
- unused state
- accessibility
- typing
- naming
- formatting

Leave the project slightly better than you found it.

---

# Architecture

Prefer Feature-first architecture.

Business logic belongs inside features.

Global folders should contain only reusable code.

Good:

features/
    coffee/       (components, hooks, types — flat today; split into
                   sub-folders if a single feature grows large enough
                   to need it)
    input/
    verificar/
    configuracoes/
components/
    ui/           (shadcn, vendored — editable, see the shadcn/ui
                   section below)
    branded/      (compositions built on top of ui/)

Bad:

components/
coffee/
hooks/
pages/

where feature code is spread across the project.

If creating a new feature, suggest moving toward feature-based organization instead of creating another top-level folder.

---

# Frontend

Stack

- React 18
- TypeScript
- Vite
- Tailwind v4
- Radix UI
- React Query
- Lucide
- Sonner

---

## React

Prefer:

- functional components
- composition
- early returns
- derived state

Avoid:

- deeply nested JSX
- prop drilling
- unnecessary Context
- unnecessary effects

If state can be derived,
don't store it.

---

## Components

Components should only render UI.

Business logic belongs in:

- hooks
- services
- feature modules

Split components when they become difficult to understand.

Target:

<200 lines

---

## Hooks

Hooks encapsulate behavior.

Hooks should never render UI.

Avoid hooks that become "god objects".

---

## React Query

React Query is the default server state solution.

Do not duplicate server state into Context.

Prefer:

- invalidateQueries
- optimistic updates only when beneficial
- proper query keys

---

## Context

Use Context only for:

- authentication
- theme
- user preferences
- truly shared UI state

Do not use Context as a global store.

---

# Backend

Stack

- FastAPI
- Python
- Pandas
- OpenPyXL
- httpx

---

## FastAPI

Keep endpoints thin.

Endpoints should:

- validate
- call services
- return responses

Business logic belongs elsewhere.

---

## Services

Complex processing belongs inside feature modules.

Keep SQL separated from business rules.

Avoid giant utility files.

---

## Pandas

Prefer readable transformations.

Avoid chained operations that reduce readability.

Name intermediate DataFrames when it improves understanding.

---

# TypeScript

Never use:

any

Prefer:

unknown

or proper types.

Infer whenever possible.

Export types separately from implementations.

---

# Naming

Names should explain intent.

Good:

calculateCoffeeYield()

Bad:

processData()

Avoid abbreviations.

---

# Functions

Functions should do one thing.

Prefer:

30–40 lines

Return early.

Avoid deep nesting.

---

# Imports

Order

1. React

2. Third-party

3. Internal aliases

4. Relative imports

Remove unused imports.

---

# Styling

Tailwind v4

Source of truth:

app.css

Never use arbitrary colors.

Never use Tailwind palette except:

- white
- black
- transparent

Use design tokens only.

---

# shadcn/ui

src/components/ui/ is vendored, but it is project code — edit it
directly to theme, resize, or adjust a primitive's default behavior.

Add new components using:

npx shadcn@latest add

Re-running `add` on a component you've customized overwrites your
edits. Check `git diff` after re-adding and reapply anything lost.

Bigger compositions (multiple primitives wired together, feature-
specific behavior) still belong in:

src/components/branded/

Never copy documentation code manually — always use the CLI.

Preserve Radix structure and accessibility behavior when editing.

---

# Accessibility

Never remove Radix accessibility behavior.

Buttons must always have accessible labels.

Interactive elements must be keyboard accessible.

---

# Errors

Never silently ignore exceptions.

Errors should explain:

- what failed
- why
- possible next action

---

# Dependencies

Before adding a dependency ask:

1.

Can existing code solve this?

2.

Can it be implemented simply?

3.

Is the dependency maintained?

Prefer fewer dependencies.

---

# Refactoring

Follow the Rule of Three.

1 occurrence

Duplicate.

2 occurrences

Still duplicate.

3 occurrences

Extract abstraction.

Never abstract for hypothetical future use.

---

# Documentation

Whenever architecture changes:

Update relevant documentation.

Do not let docs drift from implementation.

Every code change must also update the developer manual (`docs/dev/`).

If a change touches a feature or module covered there, update the
corresponding doc in the same commit/PR — not as a follow-up.

---

# Specs

Specifications are the source of truth.

Workflow:

Spec

↓

Questions

↓

Plan

↓

Implementation

↓

Review

Never guess missing requirements.

Ask instead.

---

# Agent Autonomy and Coordination

These rules apply to Hermes Agent, Claude Code, Codex, and any other coding agent working in this repository. Autonomy means acting without asking for confirmation at every mechanical step, not guessing business rules or bypassing safety controls.

## Default autonomy

When the scope is clear and the work is local, reversible, and isolated, an agent may autonomously:

- inspect the repository, project instructions, Graphify index, source, tests, and documentation;
- create a task branch or separate worktree when the task is authorized;
- implement the scoped change;
- add or update tests and relevant `docs/dev/` documentation;
- run local tests, builds, linters, and static checks;
- fix regressions caused by its own change;
- create local architecture diagrams, Excalidraw files, or HTML prototypes;
- review its own diff and report the real results;
- create a commit on the task branch after the implementation scope is authorized and applicable gates pass, unless the user says not to commit.

The agent does not need to ask for approval for each file, command, test, or small corrective edit inside the approved scope.

## Investigate before acting

For non-trivial work, follow:

```text
Understand → Investigate → Plan → Implement → Review → Test → Report
```

A diagnostic request is read-only unless implementation is explicitly included. An implementation request authorizes scoped local code changes, but not unrelated refactoring, production access, deployment, merge, or publication.

Before editing, the agent must confirm the repository, branch, commit, working tree, remote, applicable instructions, and pre-existing changes. If the working tree is dirty, preserve it and use a separate worktree or stop when isolation is not possible.

## Pause and ask the user

Pause only when the next action requires a decision that cannot be resolved safely from code, documentation, tests, schemas, or existing contracts. Examples:

- ambiguous business rules or conflicting definitions;
- a schema migration or change to a shared database contract;
- destructive data repair or retroactive rewriting of real records;
- access to SAP, Databricks, VPN, network shares, production APIs, or real corporate files;
- credentials, authentication, authorization, retention, or security policy decisions;
- adding a dependency when the trade-off is material;
- publishing, opening a PR, pushing, merging, deploying, or changing production;
- deleting files, rewriting Git history, or discarding pre-existing work.

When asking, provide the evidence found, the available options, and the impact of each option. Do not ask the user to decide something that can be verified locally.

## Never do autonomously

- activate `EDP_PERFIL=producao` or silently fall back to a local copy;
- use real credentials, secrets, corporate datasets, SAP data, or shared files without explicit authorization;
- use destructive Git commands such as reset, clean, force push, or unrequested stash;
- disable, weaken, skip, or delete tests to make a gate pass;
- invent API fields, business rules, acceptance criteria, or test results;
- claim success based only on another agent's report;
- expose secrets or sensitive corporate data in code, logs, prompts, artifacts, memory, or responses.

Push, merge, pull request, deployment, and production operations always require explicit authorization even when local implementation is autonomous.

## Visual review gate

For broad architecture, workflow, or UI changes spanning multiple modules, the agent should first produce a local visual aid when it materially improves review:

1. map the current system using Graphify and verified source;
2. label observed facts, inferred relationships, and open decisions;
3. present one or more architecture diagrams, Excalidraw flows, or local HTML prototypes;
4. implement only the approved direction.

This gate is not required for a small, explicitly scoped bug fix. Visual artifacts are review aids, not substitutes for source code, tests, or product specifications.

## Agent roles

- **Hermes Agent:** coordinator, investigator, planner, reviewer, verifier, and governance guard. Hermes may perform safe local investigation and approved artifact or documentation work, but must not launch or control external coding agents automatically.
- **Claude Code:** primary implementation agent for cross-layer changes, architecture-sensitive work, and difficult debugging. It may act autonomously within the approved scope and must verify its own work.
- **Codex:** implementation and test agent for localized UI, focused backend changes, repetitive corrections, and small refactors that already have a clear contract. It follows the same safety, evidence, and review rules.

Every handoff must include objective, scope, constraints, confirmed rules, affected paths, acceptance criteria, prohibited operations, and required gates. The receiving agent must verify the current repository rather than treating the handoff as proof.

## Completion report

Before finishing, report:

- objective and scope;
- files changed and why;
- branch and commit;
- tests, build, and static checks actually executed;
- diff and sensitive-data review;
- push, merge, or deployment status;
- remaining risks, limitations, and user decisions.

Never use “done”, “fixed”, “published”, or “passed” without corresponding evidence.

---

# Output

When presenting code changes, always explain:

- what changed
- why
- tradeoffs
- future considerations (if relevant)

Keep explanations concise.

---

# Writing quality

When writing prose for users, documentation, PRs, issue reports, comments, or commit messages:

- Prefer direct, concrete language over inflated importance or promotional phrasing.
- Preserve the source's facts, voice, and level of certainty. Never invent names, dates, numbers, citations, or rationale.
- Remove filler, vague attributions, excessive hedging, repetitive synonym changes, canned openings, generic conclusions, and dramatic fragments.
- Use headings, bold text, lists, emojis, and em dashes only when they improve clarity. Do not add them mechanically.
- Match the context. Technical, legal, and reference text should stay precise and neutral; do not force a casual voice.
- Keep quoted text, code, identifiers, logs, data, contracts, and examples intact unless the task explicitly asks for a content change.
- Before finishing, read the prose once for factual fidelity, clarity, natural rhythm, and unnecessary verbosity.

For substantial rewrites, do a draft pass and a final anti-AI pass. Keep the final result focused on the requested content.

---

# Code Quality Checklist

Before considering a task complete, verify:

☐ No duplicated logic

☐ No dead code

☐ No console.log

☐ No unused imports

☐ Proper typing

☐ Consistent naming

☐ Existing conventions followed

☐ No unnecessary abstractions

☐ Accessible UI

☐ Uses existing architecture

☐ Minimal implementation

☐ Easy to review

If any item fails, fix it before finishing.