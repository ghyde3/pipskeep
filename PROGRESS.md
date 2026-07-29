# PipsKeep — Progress Log

Phase-gate log and decision journal, per spec §13–§15. Append entries; never rewrite history.

## Phase status

| Phase | Status | Gate logged |
|---|---|---|
| 0 — Scaffold | **gate passed** | 2026-07-29 |
| 1 — Pip core (logic only) | **gate passed** | 2026-07-29 |
| 2 — Care actions + first playable | **gate passed** | 2026-07-29 |
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

### Phase 1 — Pip core (logic only) — 2026-07-29
- Tests: `npm test` → 9 files, **239 passed** (needs 30, mood 14, machine 79, lifecycle 34, catchup 24, plus Phase 0's 48+). All 11 gate clauses mapped by the gate-runner to named exact-value FakeClock tests: 6h hunger −36 ±0, all five §4.2 multiplier rows, sulk enter-at-0/exit-all-≥25-inclusive, 7-day absence = exactly 12h rate changes, Clingy segmentation (2h×(−5·1.3·2.0)+4h×(−5·1.3) exact), negative-elapsed clamp, pipling ×1.2 multiplicative + adult at exactly 24h, mood precedence with boundary values, deferred sulking on expedition, rest auto-wake at exactly 100, evolution readiness flag-only at avg≥70/age≥72h.
- Build: `tsc --noEmit && vite build` green.
- Review: mutation tester ran 8 targeted mutations; 1 survived (Beaming-before-Grumpy precedence swap) → fixer added overlapping-threshold precedence tests; re-gate green. Spec audit clean.
- Notes for Phase 2: Chaotic's 10% displayed-mood offset (§4.3) is a display-layer concern — tuning value exists, must be consumed where mood selects dialogue/portrait. Dialogue underfill validation must flip warn→error after the authoring pass.

### Phase 2 — Care actions + first playable — 2026-07-29
- Tests: `npm test` → 17 files, **361 passed**. Every care action has exact stat-effect + cooldown-boundary tests (60s/30s exact via FakeClock); refusal matrix at 9.99/10 and 29.99/30; deep-equal save round-trip incl. RNG-cursor continuation (draw-5-compare); dialogue validation now hard-fails below 8 lines/pool (all 30 pools pass — 340 lines authored).
- Mutation: 8/8 mutations killed (cooldown removal, refusal thresholds, inventory decrement, rngState drop, context swap, Chaotic quirk).
- Manual check (human at the controls, browser on :5317): Feed → berry arc + munch + "Stay forever?" + Food 60→85 + Berry ×3→×2; Pet → hearts + lean-in + 30s conic cooldown ring counting down; Play → confetti + Energy −10; Rest → eyes closed + Z's + button flips to Wake; Clean → sparkle. **Reload restored everything exactly** — still Resting, cooldown expired in real time, inventory/needs intact.
- Notes for later phases: action buttons need accessible names (a11y, Phase 6); top bar is single-portrait — becomes the §10 multi-pip selector when Phase 4 hatching lands; idle animation should vary by mood (§4.3) — Phase 6 juice pass; 4 cross-personality duplicate jokes to deduplicate in a Phase 6 dialogue pass.

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
