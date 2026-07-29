# PipsKeep — Progress Log

Phase-gate log and decision journal, per spec §13–§15. Append entries; never rewrite history.

## Phase status

| Phase | Status | Gate logged |
|---|---|---|
| 0 — Scaffold | not started | — |
| 1 — Pip core (logic only) | not started | — |
| 2 — Care actions + first playable | not started | — |
| 3 — Save system hardening | not started | — |
| 4 — Expeditions + eggs | not started | — |
| 5 — The Keep | not started | — |
| 6 — Polish, PWA, onboarding | not started | — |

## Gate log

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
