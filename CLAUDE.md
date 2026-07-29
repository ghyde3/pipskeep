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

## Records

- `PROGRESS.md` — phase-gate log + decision journal (spec §13–§15). Append; never rewrite history.
- Vocabulary (spec §0): Pip, Pipling, Pipping, the Keep. Never "Pal", "-gotchi", or any Pokémon/Palworld/Tamagotchi term in code, copy, assets, or docs.
