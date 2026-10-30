# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root — the domain glossary. Use its vocabulary; don't drift to synonyms it explicitly avoids.
- **`ARCHITECTURE.md`** at the repo root — the consolidated architectural decisions for this repo (the de-facto ADR file; this repo has no `docs/adr/`). Read the sections that touch the area you're about to work in.
- **`CONTEXT-MAP.md`** at the repo root, if it exists: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo:

```
/
├── CONTEXT.md
├── ARCHITECTURE.md                     ← consolidated decisions (no docs/adr/)
├── docs/research/                      ← research notes backing individual decisions
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── ARCHITECTURE.md                     ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                   ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing decision in `ARCHITECTURE.md` (or an ADR), surface it explicitly rather than silently overriding:

> _Contradicts the ARCHITECTURE.md decision on <topic>, but worth reopening because…_
