# PipsKeep — Progress Log

Phase-gate log and decision journal, per spec §13–§15. Append entries; never rewrite history.

## Phase status

| Phase | Status | Gate logged |
|---|---|---|
| 0 — Scaffold | **gate passed** | 2026-07-29 |
| 1 — Pip core (logic only) | not started | — |
| 2 — Care actions + first playable | not started | — |
| 3 — Save system hardening | not started | — |
| 4 — Expeditions + eggs | not started | — |
| 5 — The Keep | not started | — |
| 6 — Polish, PWA, onboarding | not started | — |

## Gate log

### Phase 0 — Scaffold — 2026-07-29
- Tests: `npm test` → 4 files, **48 passed** (clock, rng, store, content validation). Includes golden known-answer vectors pinning mulberry32 + FNV-1a (algorithm changes now fail tests — protects save determinism across versions) and a mutation-hardened FakeClock frozen-time test.
- Build: `tsc --noEmit && vite build` green; app bundle 32 KB gzipped (well under 350 KB budget); Pixi chunks ~58 KB gzipped.
- Manual check: blank pastel canvas verified in browser via `vite preview` (canvas mounted, zero console errors); dev server confirmed on port 5317.
- Review: adversarial audit (purity greps, spec-table fidelity, vocabulary) clean; one major finding (vacuous FakeClock drift test) found by mutation testing and fixed.
- Notes for Phase 1: aggregate per-Pip type must be named `PipState` (§0 vocabulary — only `PipActivity` exists so far); dialogue underfill validation is warn-only until Phase 2's authoring pass, then must become an error.

<!-- One entry per completed phase:

### Phase N — <name> — <date>
- Tests: <command run, pass/fail counts, decisive output pasted>
- Manual check: <what was verified by hand in the browser>
- Notes: <anything the next phase should know>
-->

## Decisions

<!-- One line each, newest last: date — decision — why.
Per spec §15.4: record small decisions here; stop and ask only for hard-to-reverse ones. -->

- 2026-07-29 — Dev server pinned to port 5317 with `strictPort: true` — 5173/3000/5000/8080 are occupied by other local projects.
- 2026-07-29 — typescript resolved to 7.0.2 (native tsc); works cleanly with strict + noUncheckedIndexedAccess, kept unpinned.
- 2026-07-29 — Added `grovepip` species entry as Mosspip's evolved form so evolution-target validation runs against real data (spec §4.6 requires the evolved form anyway).
- 2026-07-29 — `Rng.getState()` snapshots only streams touched so far; untouched streams re-derive from seed (tested) — keeps saves minimal without losing determinism.
- 2026-07-29 — Store throws on dispatch-from-inside-a-reducer: one-way flow is mechanically enforced, not conventional.
- 2026-07-29 — Golden known-answer tests pin mulberry32/FNV-1a exact outputs so a silent algorithm swap can't invalidate saved RNG cursors.
