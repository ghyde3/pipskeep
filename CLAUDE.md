# PipsKeep

Browser-based virtual pet game. **PIPSKEEP_SPEC.md is the contract** — read the relevant section before coding anything. When this file and the spec disagree, the spec wins.

## Hard rules (repeated here because they're the easiest to violate)

1. `core/` is pure: no Pixi, no DOM, no `Date.now()`/`new Date()` outside `core/clock.ts`, no `Math.random()` outside `core/rng.ts`. Time via the injected `Clock`; randomness via seeded streams whose cursors live in `GameState`.
2. Dependency allowlist: `pixi.js`, `idb`; dev deps: `vite`, `typescript`, `vitest`, Vite PWA plugin. Anything else: stop and ask.
3. Scope fence (spec §12): deferred features get their named seam only — never a speculative implementation.
4. Phase discipline (spec §13): work only in the current phase; a phase ends when its gate is verified AND logged in PROGRESS.md.

## Commands

- `npm test` — Vitest (all core logic)
- `npm run dev` — dev server on **port 5317** (fixed, strictPort — 5173 belongs to other local projects)
- `npm run build` — production build

## Agents (.claude/agents/)

- **scout** (haiku) — read-only search/existence checks; use before grepping yourself for anything non-trivial
- **builder** (sonnet) — scoped implementation tasks
- **reviewer** (opus) — adversarial review, required before logging any phase gate
- **oracle** (fable) — only for catch-up segmentation, RNG determinism, save migrations, or a bug that survived one fix attempt

## ⏸ Picking up mid-build? READ THIS FIRST

The build is **paused mid-round**. Before doing anything, read the **"⏸ PAUSED MID-ROUND"** section at the top of `PROGRESS.md` — it names exactly what is done, what is unverified, and the outstanding blockers.

State at pause: tree green (2285 tests, clean build), everything committed and pushed. Nine rounds shipped (Phases 0–6, then rounds 2A–2F). Two rounds are incomplete:
- **Round 2G (HUD)** — built and passing, but its fix stage never ran; **4 blockers + 11 majors are listed in PROGRESS.md and remain unfixed.**
- **Round 2H (Pip lifecycle)** — design only. `docs/lifecycle-bible.md` exists; **no lifecycle code has been written**, yet spec §16 v1.5 already commits to it. The spec is deliberately ahead of the code here.

**To resume**, run the committed workflows by name:
- `Workflow({name: "round2g-legible-progression"})`
- `Workflow({name: "round2h-lifecycle-lineage-risk"})`

Run them **one at a time** — they were given disjoint file ownership on purpose, and 2H's UI phase needs seams in files 2G owns.

⚠️ `resumeFromRunId` will NOT work in a new session or machine. That cache lives in `~/.claude/projects/.../workflows/` and is never committed, so a fresh run re-pays the design passes. The scripts themselves are in `.claude/workflows/` and do travel.

Design documents that carry the reasoning (all committed): `docs/content-bible.md`, `retention-bible.md`, `progression-bible.md`, `hud-redesign.md`, `lifecycle-bible.md`. `PIPSKEEP_SPEC.md` §16 holds every amendment — v1.5 made Pips finite (the five promises), v1.6 retired the scope fence.

## Records

- `PROGRESS.md` — phase-gate log + decision journal (spec §13–§15). Append; never rewrite history.
- Vocabulary (spec §0): Pip, Pipling, Pipping, the Keep. Never "Pal", "-gotchi", or any Pokémon/Palworld/Tamagotchi term in code, copy, assets, or docs.
