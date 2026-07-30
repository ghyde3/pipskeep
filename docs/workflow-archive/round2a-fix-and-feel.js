export const meta = {
  name: 'round2a-fix-and-feel',
  description: 'Playtest fixes: Sulking-Rest bug, wood deadlock + reachability harness, pipling rework, decay retune to a tested target, debug time slider, procedural WebAudio sound',
  phases: [
    { title: 'Design', detail: 'derive the decay curve + progression numbers that hit the stated targets' },
    { title: 'Build', detail: 'core fixes, debug tools, and the sound engine in parallel' },
    { title: 'Integrate', detail: 'wire seams, full suite green' },
    { title: 'Verify', detail: 'gate runner + playtest-sim audit + mutation tester' },
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

const CONTEXT = `Project: /Users/gary/dev/pipskeep (PipsKeep v1.0, 692 tests green, tagged v1.0). Read CLAUDE.md first. PIPSKEEP_SPEC.md is the contract but THIS ROUND DELIBERATELY AMENDS IT based on real playtest feedback from the project owner — where this task conflicts with the spec, THIS TASK WINS and you note the amendment in your report (the orchestrator writes the spec changelog).

Architecture reminders: core/ is pure (no Date.now outside clock.ts, no Math.random outside rng.ts, no pixi/DOM); ALL tuning numbers live in src/content/tuning.ts (zero tuning literals in core/); time enters reducers via action 'at' timestamps; rng cursors live in GameState. npm test + npm run build must be green before you finish. Do not commit. Do not touch PROGRESS.md or .claude/.

PLAYTEST FINDINGS (all verified by the orchestrator against the code):
1. PROGRESSION DEADLOCK (critical): Meadow drops only berry(60)/fiber(40); the Gathering Station only produces berry(70)/fiber(30); wood appears ONLY in the Forest loot table; Forest requires Keep level 2; Keep level 2 costs 15 wood + 10 fiber. Wood is therefore UNOBTAINABLE and the game cannot progress past level 1.
2. SULKING PIPS CANNOT REST (spec violation): src/core/pips/machine.ts beginRest() requires activity===Idle, but spec §4.7 says care actions are legal in Idle, Resting AND Sulking. Rest is the ONLY source of Energy, so a pip that Sulks at 0 Energy can never recover — breaking §4.4's promise that recovery is always one good care session away.
3. PIPLINGS FEEL PUNISHING: 24h before they can go on expeditions (spec §4.6) AND they decay ×1.2 meanwhile, with no UI explanation. The owner hatched two eggs and found them useless with no idea why.
4. 24h SKIP DEPLETES EVERYTHING: the debug time-skip skews the clock then dispatches TICK, applying RAW uncapped decay — so it never exercises the §4.5 12-hour offline rate cap and is far harsher than a real absence. The owner concluded decay is too fast; partly a tool bug, partly tuning.`

phase('Design')
const design = await agent(`${CONTEXT}

You are the systems designer. Produce the NUMBERS for this round — do not write feature code, but you MAY write/modify src/content/tuning.ts and add a simulation test file.

TARGETS from the project owner:
- "Noticeably grumpy, ~25%": after 24 hours away, a well-cared-for Keep (all needs ~85-100 at save time) should come back with needs around 25% — clearly neglected, possibly ONE pip Sulking, recoverable in a few care actions. NOT all-zeros, NOT a wasteland.
- A 2-hour absence should be barely noticeable. An 8-hour (overnight) absence should be mild — the daily player is never punished.
- Piplings should stop feeling like dead weight.

DELIVERABLES:
1. Analyse the current curve mathematically first (base rates × personality × pipling × the 12h cap) and write down what the CURRENT outcomes are at 2h / 8h / 24h / 72h for a neutral adult and for each personality. Include this table in your report.
2. Choose new base decay rates + offline cap (both in tuning.ts) that hit the targets. Consider: the cap is the dominant lever for long absences, the rates dominate short sessions. You may change the cap from 12h if that serves the target better — justify it. Energy regen while Resting may need rebalancing so recovery is not tedious.
3. Pipling rework: reduce pipling.durationMs (owner found 24h punishing — 6-8h is the suggested range), and REMOVE the decay penalty or invert it (a baby that decays FASTER than an adult while being unable to do anything is anti-fun; consider ×1.0 or a small ×0.9 "everyone helps look after the baby" bonus). Also decide: should Piplings be allowed on the shortest expedition (Meadow) as a supervised "short trip"? Recommend one and justify.
4. Economy repair for THIS round (a full content expansion lands in a later round, so keep this minimal and safe): make Keep level 2 genuinely reachable from level-1 activities. Prefer adding a small wood weight to the Meadow table ("fallen twigs") over changing costs, but decide what actually plays best and state the reachability arithmetic: at N Meadow runs of ~5 min each, how long until level 2 in wall-clock minutes of active play? Target: reachable within roughly 30-45 minutes of engaged play, or a few hours of casual play.
5. WRITE THE SIMULATION TEST HARNESS: a new src/core/pips/balance.test.ts that encodes these targets AS TESTS using FakeClock + the real catch-up engine — e.g. "seed a Keep with all needs at 90, run runCatchup over 24h, assert every need lands in [18,35]", plus the 2h and 8h cases, plus a per-personality sweep asserting nobody bottoms out at 0 from a healthy start. These tests are the permanent guard against re-breaking feel. They MUST fail before your tuning change and pass after — state that you verified both directions.
6. ALSO write a PROGRESSION REACHABILITY TEST (src/core/economy/reachability.test.ts): for every Keep level, prove its cost bundle is obtainable using only the expeditions/jobs unlocked at the PREVIOUS level, by simulating N runs against the seeded loot tables and asserting expected yield covers the cost. This is the systemic guard so the wood-deadlock class of bug can never return. Make it data-driven off the registries so it automatically covers future content.

Report the before/after tables and every number you changed with its justification.`, { label: 'design:balance', phase: 'Design', schema: REPORT })

phase('Build')
const [b1, b2, b3] = await parallel([
  () => agent(`${CONTEXT}

Designer's output (numbers already in tuning.ts — do NOT re-tune, consume them): ${JSON.stringify(design?.summary ?? 'inspect src/content/tuning.ts and balance.test.ts')}

You own CORE FIXES: src/core/pips/machine.ts, src/core/pips/care.ts, src/core/state.ts, src/core/expeditions/index.ts, src/core/pips/lifecycle.ts (+ their tests). Do NOT touch src/app/, src/ui/, src/render/, or tuning.ts.

1. FIX THE SULKING-REST BUG (finding 2): make Rest legal from Sulking. Audit EVERY care action against spec §4.7's "legal in Idle, Resting, Sulking" rule — Feed/Clean/Play/Pet/Rest/GiveItem — and fix any others that wrongly require Idle. Rest from Sulking should put the pip in Resting and let evaluateSulk still govern the Sulking flag correctly (a pip resting its way out of 0 Energy must exit Sulking when all needs >= 25 per §4.4; make sure Resting and Sulking compose sensibly — decide and document whether Sulking is an activity or a flag-over-activity, and if the current activity-enum modelling makes "Sulking while Resting" unrepresentable, FIX THE MODEL: add a sulking boolean to PipState and keep activity orthogonal, migrating the enum's Sulking member carefully with a save migration bump). This is the highest-value fix in the round: a player whose pip hits 0 Energy currently has a soft-locked pip.
2. PIPLING REWORK (finding 3) per the designer's decision: new duration from tuning, decay multiplier from tuning, and if the designer allowed Piplings on Meadow, implement that legality (a typed refusal must still block them from longer expeditions with a reason the UI can render, e.g. { kind: 'pipling', growsUpAt: <timestamp> } so the UI can show a live countdown).
3. Make expedition/job refusals CARRY THE DATA THE UI NEEDS: every typed refusal should include enough to write a helpful sentence (why + when it resolves). The UI agent is depending on this.
4. Tests: Sulking→Rest→recovery end-to-end under FakeClock (pip at 0 energy sulking, Rest, energy climbs, exits Sulking at the threshold, all asserted exactly); every care action's legality matrix across all activities; pipling legality + refusal payload shape; save migration if you changed the state model.`, { label: 'build:core-fixes', phase: 'Build', schema: REPORT, model: 'sonnet' }),
  () => agent(`${CONTEXT}

Designer's output: ${JSON.stringify(design?.summary ?? 'inspect tuning.ts')}

You own DEBUG TOOLING + THE TIME MODEL: src/ui/debugMenu.ts, src/app/appClock.ts, and the debug-related parts of src/app/main.ts. Do NOT touch core/, render/, or other ui/ modules.

1. FIX THE TIME-SKIP SEMANTICS (finding 4 — important): today the skip skews the OffsetClock then dispatches TICK, which applies RAW decay and never exercises the §4.5 offline rate cap, so it misrepresents what a real absence does. Change the default skip to SIMULATE A REAL ABSENCE: skew the clock, then dispatch CATCHUP with savedAt = the pre-skew now and now = the post-skew now, so the catch-up engine's segmentation + 12h rate cap + expedition/egg completion all run exactly as they would after closing the tab. Verify with a test that a 24h debug skip now produces IDENTICAL state to closing the tab for 24h (compare against a direct runCatchup call — this equivalence test is the point).
   Keep a secondary "raw tick" mode available for QA (a small toggle labelled honestly, e.g. "live decay (no cap)"), since it is useful for testing live-play behaviour.
2. BUILD THE TIME SLIDER the owner asked for: a unit toggle (Minutes / Hours / Days) where the slider's max is dynamic per unit — minutes max 60, hours max 24, days max 30 — with a live readout of the selected amount and a Skip button that applies it. KEEP quick-jump buttons too and add the requested +5m and +15m alongside the existing +1h/+6h/+24h. Make the whole thing thumb-friendly and keep it dev-only (it must stay out of the production bundle — verify by grepping dist after a build, as the existing menu does).
3. The clock-offset readout should show a human-friendly total (e.g. "clock +2d 6h").
4. Tests: slider model (unit → max → clamped value → ms conversion) as a pure controller; the catch-up-equivalence test above; dev-only tree-shaking verified in your report with the actual grep output.`, { label: 'build:debug-time', phase: 'Build', schema: REPORT, model: 'sonnet' }),
  () => agent(`${CONTEXT}

You own SOUND — a scope change the project owner explicitly approved: procedural WebAudio, ZERO new dependencies (the §1 allowlist stands: pixi.js + idb only). You own src/app/sound.ts and a new src/app/audio/ directory, plus a mute control in src/ui/ (add ONE small button — coordinate by keeping all your DOM inside your own module and mounting it into the existing UI root; do not edit other ui/ modules' internals).

Today src/app/sound.ts is a no-op seam called throughout render/ and ui/ with slot ids (grep for sound( to find every slot — they include care actions, egg hatch, shiny hatch, evolution fanfare, place.drop, parade.kazoo, ui.tap and more). Make them REAL, synthesized in code:

1. A tiny WebAudio engine: lazily create AudioContext on first user gesture (browsers block autoplay), a master gain, and a small library of synthesis primitives — sine/triangle/square voices with ADSR envelopes, a noise burst generator, simple detuned-pair "chime", pitch sweeps, and a light lowpass for warmth. No external assets, no base64 blobs.
2. Design a COHESIVE cozy palette — think soft marimba/kalimba blips, gentle wooden pops, airy chimes — in a pentatonic scale so overlapping sounds never clash. Each existing sound slot gets a voice that MATCHES ITS MOMENT: munchy pops for Feed, a sparkle arpeggio for Clean, a bouncy two-note for Play, a warm low "purr" chord for Pet, a descending sigh for Rest, an ascending 4-note fanfare for hatch, a bigger shimmering one for shiny hatch, a triumphant rising run for evolution, a soft thunk for placement, a genuinely silly kazoo-ish buzz for the parade, and a tiny tick for ui.tap. Refusals get a gentle downward "nope" that is funny, never harsh.
3. Musicality guards: a per-slot cooldown/voice-cap so rapid taps never machine-gun, master limiting so nothing clips, and slight random pitch variation (via core/rng, NOT Math.random) so repeated sounds do not feel robotic.
4. A mute toggle (speaker icon) persisted in the save or localStorage-free equivalent — put the preference in GameState if that is cheapest, else an idb key via the existing persistence layer; default ON but respect prefers-reduced-motion? No — sound has no such media query; instead default to ON and make the toggle obvious and accessible (aria-label, keyboard reachable).
5. Tests: the synthesis layer must be unit-testable WITHOUT a real AudioContext — inject an audio-context factory so tests pass a stub and assert on the scheduled graph (oscillator types, frequencies, envelope times, voice-cap behaviour). Zero DOM/audio dependencies in the pure layer.
6. Verify in a real browser on port 5317 that sounds actually fire on care actions and that muting works; report what you heard (describe the graph you scheduled if you cannot literally hear it).`, { label: 'build:sound', phase: 'Build', schema: REPORT }),
])

phase('Integrate')
const integ = await agent(`${CONTEXT}

Builders finished. design: ${JSON.stringify(design?.summary ?? 'missing')} | core-fixes: ${JSON.stringify(b1?.summary ?? 'missing')} | debug-time: ${JSON.stringify(b2?.summary ?? 'missing')} | sound: ${JSON.stringify(b3?.summary ?? 'missing')}

Make the seams meet AND close the UI gap none of them owned:
1. Full npm test + npm run build green; exactly one save-schema version bump if any builder needed one (merge duplicates); tsc clean.
2. UI GAP — piplings (finding 3): the focus view's expedition rows must now explain a Pipling's status warmly and specifically using the refusal payload the core builder added, e.g. "Still a Pipling — ready to explore in 5h 20m" with a LIVE countdown, rather than a silent or generic refusal. If Piplings were allowed on Meadow, make that row clearly available and label it as a little supervised trip. Edit src/ui/focusView.ts for this.
3. UI GAP — sound: make sure the mute control is actually mounted and visible in the running app.
4. Browser smoke on :5317 (RESTART the dev server first — stale HMR module graphs have bitten this project before): verify (a) a Sulking pip can now be sent to Rest and recovers, (b) the debug slider skips time with the cap applied (a 24h skip should NOT zero everything — report the actual before/after need values), (c) sounds fire, (d) a Pipling's expedition row shows its countdown. Report REAL observed numbers, not expectations.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, playtest, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep round 2A. Run npm test + npm run build YOURSELF and map each requirement to a named passing test, quoting the assertion: (1) a Sulking pip can Rest and recover — end-to-end FakeClock test exists; (2) every care action's legality matches spec §4.7 (Idle/Resting/Sulking) with a full matrix test; (3) balance simulation tests exist and encode the 24h ≈25% target plus 2h/8h cases across personalities; (4) progression reachability test proves every Keep level is obtainable from the prior level's activities, and is data-driven off the registries; (5) debug skip now equals a real absence — the catch-up-equivalence test exists; (6) time slider model tested (unit → dynamic max → ms); (7) sound synthesis layer tested against a stubbed AudioContext with no real audio needed; (8) debug menu + slider still absent from the production bundle (build, then grep dist and show the output). pass=true only on evidence you gathered yourself.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`PLAYTEST SIMULATION audit for /Users/gary/dev/pipskeep round 2A. Your job is to answer, with arithmetic and by running code, whether the game now FEELS right — the project owner's actual complaints were about feel, not correctness.

Write a throwaway simulation script under the session scratchpad (NOT in the repo, and delete it after) that drives the real core modules to answer:
(a) Starting a fresh game, how many minutes of active play until Keep level 2? Show the math from real loot tables and expedition durations. Target 30-45 min engaged / a few hours casual — report the actual number and judge it.
(b) After 24h away from a healthy Keep, what are the exact resulting needs per personality? Is anyone at 0? Is at most one pip Sulking? Does one care session per need restore them?
(c) After 8h (overnight) — is it mild?
(d) A brand-new Pipling: how long until it can explore, and does it now decay slower or the same as an adult?
(e) Is the 0-Energy soft-lock actually gone? Simulate a pip at 0 Energy, Sulking, and prove Rest recovers it.
Report each answer with real numbers and a verdict. Findings for anything that still feels punishing, unreachable, or soft-locked. pass=false if any target is missed.`, { label: 'audit:playtest-sim', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep round 2A. Work is UNCOMMITTED — copy each target file to the session scratchpad before mutating, restore + verify with cmp after EACH cycle, NEVER git-restore. Mutations vs src (never tests): (1) beginRest rejects Sulking again (the regression the owner hit); (2) the offline rate cap is ignored during catch-up; (3) debug skip reverts to raw TICK instead of CATCHUP; (4) pipling decay multiplier reverts to a penalty; (5) Meadow's wood drop removed (deadlock returns) — the reachability test MUST catch this; (6) sulk exit threshold raised so recovery becomes impossible; (7) sound voice-cap removed (rapid taps schedule unbounded voices); (8) balance: hunger decay doubled (the feel test MUST catch this). For each: apply, npm test, record FAILED (good, name the test that caught it) or SURVIVED (major finding, name the missing assertion), restore + cmp. Finish with the suite green and git status showing only legitimate round-2A files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, playtest, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${CONTEXT}

Fix these round-2A findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. Feel findings (things still punishing or unreachable) are as important as correctness findings — retune tuning.ts if that is the right fix, keeping the balance tests as the target. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build. Report real output. pass=true only if fully green and git status shows only legitimate round-2A files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — round 2A verified clean')
}

return {
  design: design?.summary,
  coreFixes: b1?.summary,
  debugTime: b2?.summary,
  sound: b3?.summary,
  integration: integ?.summary,
  playtestVerdict: playtest?.notes,
  decisions: [design, b1, b2, b3, integ].filter(Boolean).flatMap(x => x.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}