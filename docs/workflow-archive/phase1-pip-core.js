export const meta = {
  name: 'phase1-pip-core',
  description: 'Pip core logic: needs decay, personalities, moods, Sulking, segmented offline catch-up, life stages — pure core, FakeClock-tested',
  phases: [
    { title: 'Build', detail: 'three sequential builders: needs/moods, state machine/lifecycle, catch-up engine' },
    { title: 'Verify', detail: 'gate-clause runner + spec-fidelity audit + mutation tester' },
    { title: 'Fix', detail: 'apply findings, re-gate' },
  ],
}

const REPORT = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    testsOk: { type: 'boolean' },
    testOutput: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'testsOk', 'testOutput'],
}

const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['file', 'severity', 'summary'],
      },
    },
    pass: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['findings', 'pass'],
}

const SHARED = `Project: /Users/gary/dev/pipskeep. Read CLAUDE.md, then PIPSKEEP_SPEC.md sections 4 (ALL subsections — this is v1.1 with precise semantics), 5 (refusal rules only for thresholds), and Phase 1 of section 13. Existing code: src/core/clock.ts (Clock/FakeClock), src/core/rng.ts, src/core/store.ts, src/content/tuning.ts (every tuning number — core must import from there, ZERO numeric literals for tuning values in core/), src/content/personalities.ts.
Hard rules: core/ stays pure (no Date.now/new Date outside clock.ts, no Math.random outside rng.ts, no pixi/DOM). Vitest tests alongside code, all driven by FakeClock. npm test green before you finish. Do not commit; do not touch PROGRESS.md, CLAUDE.md, .claude/, or files another builder owns unless integrating.
Vocabulary (spec section 0): the aggregate per-Pip state type MUST be named PipState (Phase 0 left only PipActivity — keep that as the activity enum inside PipState).`

phase('Build')
const b1 = await agent(`${SHARED}

You own src/core/pips/types.ts, needs.ts, mood.ts (+ tests).

1. types.ts: PipState = { id, speciesId, name, genome fields placeholder (species/palette/pattern/accessorySlots/personality per spec 7.3 — define the TraitGenome type here or in a genome.ts), personalityId, lifeStage (Pipling|Adult), hatchedAt (ms timestamp), ageMs, happinessIntegral, needs: { hunger, cleanliness, happiness, energy } each 0-100, activity: PipActivity (Idle|Resting|AssignedJob|OnExpedition|Returning|Sulking), pendingSulk: boolean, readyToEvolve: boolean, lastGiftItemId: string|null, expedition: { expeditionId, departedAt, durationMs } | null, needsUpdatedAt (ms timestamp of last needs recompute) }.
2. needs.ts: pure functions. effectiveRates(pip, tuning): per-need rate/hour = base x personality multiplier x lifestage (Pipling x1.2) x situational (Clingy happiness x2.0 while OnExpedition/Returning; Resting flips energy to +15/h). applyNeedsDelta(pip, hours): advances needs by rates x hours, clamps [0,100], accrues ageMs and happinessIntegral (time-weighted: use average happiness over the interval — trapezoidal with clamping is fine, document the choice), updates needsUpdatedAt. MUST be exact for the gate: 6h at base hunger -6/h on a neutral adult = exactly -36.
3. mood.ts: deriveMood(needs) with precedence Miserable(any<15) -> Grumpy(any<40) -> Beaming(all>=70) -> Content(all>=40) evaluated IN THAT ORDER, first match wins. Export the Mood type + the 6 dialogue contexts type (4 moods + sulking + refusal).
4. Tests: exact-value decay for each need over fractional and multi-hour advances; every one of the five personality multiplier rows from the spec 4.2 table asserted numerically; pipling x1.2 stacking asserted MULTIPLICATIVELY (e.g. Hardworking pipling hunger = 6 x 1.2 x 1.2); mood precedence order incl. boundary values exactly at 15/40/70; clamping at 0 and 100; happinessIntegral accrual.

Neutral test personality: add a test-only personality with all x1.0 multipliers OR use direct rate params — do not pollute content/ with test data.`, { label: 'build:needs-moods', phase: 'Build', schema: REPORT })

const b2 = await agent(`${SHARED}

Builder 1 finished (summary: ${JSON.stringify(b1?.summary ?? 'missing — inspect src/core/pips/ yourself')}). You own src/core/pips/machine.ts and lifecycle.ts (+ tests). Build on types.ts/needs.ts/mood.ts as-is; extend types.ts only if a field is genuinely missing.

1. machine.ts: the spec 4.7 state machine as pure transition functions with legality checks. Transitions: Idle<->Resting; Idle->AssignedJob->Idle; Idle->OnExpedition->Returning->Idle; {Idle,Resting,AssignedJob}->Sulking->Idle. Sulk entry: any need hits exactly 0 while in Idle/Resting/AssignedJob. If OnExpedition/Returning when a need hits 0: set pendingSulk=true, do NOT change activity; on transition Returning->Idle, pendingSulk converts to Sulking immediately. Sulk exit: ALL four needs >= 25 (inclusive) -> Idle. Care-action legality: legal only in Idle/Resting/Sulking. Sulking pips refuse Job/Expedition assignment (return a typed refusal result, not an exception). Rest auto-wake: Resting pip whose energy reaches exactly 100 -> Idle (the moment is computable: (100-energy)/15 hours).
2. lifecycle.ts: Pipling->Adult at exactly hatchedAt+24h (from tuning). Evolution readiness per spec 4.6: ageMs >= 72h AND happinessIntegral/ageMs >= 70 -> readyToEvolve=true (flag only, never auto-evolves). checkEvolution(pip, speciesRegistry) returns the variant that lastGiftItemId maps to (default variant when null).
3. Tests: every legal transition; every ILLEGAL transition rejected; sulk entry from each eligible activity; pendingSulk deferral (need hits 0 'mid-expedition', pip stays OnExpedition, sulks exactly on return); exit at exactly 25 (24.99 stays sulking — inclusive boundary); auto-wake at exactly 100 not beyond; adult at exactly 24h; readyToEvolve boundary (avg 69.99 no, 70 yes, age 71h59m no).`, { label: 'build:machine-lifecycle', phase: 'Build', schema: REPORT })

const b3 = await agent(`${SHARED}

Builders 1-2 finished (b2 summary: ${JSON.stringify(b2?.summary ?? 'missing — inspect src/core/pips/ yourself')}). You own src/core/pips/catchup.ts (+ tests) — the hairiest system in the game. Read spec section 4.5 (v1.1) with extreme care; it specifies a chronological segmented pass.

Design:
1. A CatchupEvent discriminated union: { kind: 'restAutoWake', at, pipId } | { kind: 'expeditionReturn', at, pipId } | { kind: 'custom', at, ... } (generic seam — Phase 4 adds eggCompletion, Phase 5 adds jobTick, WITHOUT modifying the engine: the engine takes a collectEvents(state, windowStart, windowEnd) function or an event list as input).
2. runCatchup(state, savedAt, now, tuning): elapsed = max(0, now - savedAt) — negative clamps to 0, NOTHING moves backwards. Collect events with absolute timestamps in (savedAt, now]. Sort chronologically. Process segment by segment: within each segment, needs rates use the pip's activity DURING that segment (Clingy x2.0 happiness only while OnExpedition; Resting energy regen until its auto-wake event fires, then awake decay after). THE RATE CAP: need changes accrue only for the portion of each segment that overlaps [savedAt, savedAt + 12h] (capMs from tuning). Events beyond 12h STILL FIRE and change activity — rates just contribute zero there. happinessIntegral/ageMs still accrue across the ENTIRE window (frozen happiness value keeps accruing — spec 4.6). Rest auto-wake events must be generated iteratively (a pip that starts Resting mid-window wakes at a computable time). Sulk entry/exit evaluated at every segment boundary and at the end (pendingSulk for away pips).
3. Output: new state + a CatchupSummary { perPip needs deltas, events fired with timestamps, elapsedMs, cappedMs } — the data source for the Phase 4 'While you were away' sheet.
4. Tests (the gate lives here): (a) 7-day absence on an Idle neutral adult = EXACTLY 12h of decay, bit-exact vs applyNeedsDelta(12h); (b) negative elapsed = zero change; (c) THE SEGMENTATION TEST: Clingy adult departs on expedition before save, expedition completes 2h into a 6h absence -> happiness decay = 2h at (5 x 1.3 x 2.0) + 4h at (5 x 1.3), asserted exactly, and activity ends Idle via Returning; (d) cap interacts with segments: expedition returns at hour 10 of a 20h absence -> expedition-rate portion 10h, post-return portion 2h (cap boundary at 12h), zero after; (e) Resting pip: energy rises +15/h, auto-wake fires at computed timestamp, decay resumes after, all within cap; (f) pip whose hunger hits 0 at hour 3 while Idle -> Sulking at the boundary; while OnExpedition -> pendingSulk then Sulking on return; (g) event beyond cap still fires: expedition returning at hour 30 of a 48h absence -> pip is Idle at load, rates stopped at 12h; (h) happinessIntegral accrues for the full window including capped portion at frozen value.

After your module: run the ENTIRE suite (npm test) green, and run npm run build. Report honestly.`, { label: 'build:catchup', phase: 'Build', schema: REPORT })

phase('Verify')
const GATE_CLAUSES = `(1) advancing 6h drops Hunger by exactly the configured amount +-0; (2) all five personality multiplier rows verified numerically; (3) need at 0 -> Sulking, all needs >= 25 (inclusive) -> Idle; (4) 7-day absence applies exactly 12h of rate changes (first-12h cap); (5) segmentation: Clingy pip whose expedition spans part of the absence gets x2.0 happiness decay for exactly that segment; (6) negative elapsed clamps to 0; (7) Pipling x1.2 stacks multiplicatively, Adult at exactly 24h; (8) mood precedence Miserable->Grumpy->Beaming->Content asserted with boundary values; (9) need hitting 0 mid-expedition defers Sulking until return; (10) Rest +15/h with auto-wake at exactly 100 at the computable moment; (11) evolution readiness: lifetime avg happiness >= 70 at age >= 72h sets flag only.`
const [gate, specAudit, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep Phase 1. Run npm test and npm run build yourself. Then map EVERY gate clause to the specific test (file + test name) that proves it: ${GATE_CLAUSES} For each clause: quote the assertion that proves it. A clause with no exact-assertion test = major finding. pass=true only if all 11 clauses map to passing exact tests and build is green.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Adversarial spec-fidelity audit of /Users/gary/dev/pipskeep src/core/pips/ against PIPSKEEP_SPEC.md sections 0, 4, 13-Phase-1 (read them first). Check: (1) PipState named per section 0; (2) every number in needs/mood/lifecycle code comes from src/content/tuning.ts — grep core/ for numeric literals that duplicate tuning values (6, 4, 5, 3, 15, 1.2, 0.8, 1.4, 25, 70, 40, etc.) — literals in tests are fine, in core/ they are findings; (3) purity greps (Date.now/new Date outside clock.ts, Math.random outside rng.ts, pixi/DOM imports in core); (4) multiplier stacking is multiplicative per spec 4.1; (5) sulk semantics match 4.4 exactly (entry states, deferral, inclusive 25 exit); (6) catch-up matches 4.5: FIRST-12h cap (not last), rates-capped-timers-not, happinessIntegral accrues across full window; (7) no 'any' without justification comment; (8) forbidden vocabulary. pass=true only if zero blocker/major.`, { label: 'audit:spec', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep (git repo is committed-clean; use git stash/restore to revert between mutations, verify 'git status --porcelain' clean after EACH mutation cycle). Apply each mutation below to src/core/pips/*.ts (NOT tests), run 'npm test' with vitest, record whether the suite FAILS (good) or SURVIVES (major finding). Mutations: (1) cap the LAST 12h instead of first in catchup; (2) sulk exit at > 25 exclusive instead of >= 25; (3) swap mood precedence to check Beaming before Grumpy; (4) apply Clingy x2.0 across the whole catch-up window instead of only expedition segments; (5) make pipling multiplier additive (+0.2) instead of multiplicative; (6) skip negative-elapsed clamp (allow negative delta); (7) auto-wake pip at load time instead of at the computed moment (energy overshoots or timing wrong); (8) stop happinessIntegral accrual beyond the 12h cap. Any mutation the suite fails to catch = major finding naming the missing assertion. LEAVE THE REPO CLEAN (git status empty diff vs HEAD, then confirm npm test green one final time).`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, specAudit, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${SHARED}

Fix these audit findings (blocker/major first, minors if cheap). Findings: ${JSON.stringify(majors)}. Minors: ${JSON.stringify(minors)}. Repo must end clean and green: npm test + npm run build. Do not commit.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: run npm test and npm run build, verify git status shows only intentional new/modified source+test files (no stray mutation leftovers). Report real output. pass=true only if fully green.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — Phase 1 verified clean')
}

return {
  builders: [b1?.summary, b2?.summary, b3?.summary],
  decisions: [b1, b2, b3].filter(Boolean).flatMap(b => b.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}