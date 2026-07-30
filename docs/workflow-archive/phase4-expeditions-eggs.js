export const meta = {
  name: 'phase4-expeditions-eggs',
  description: 'Three expeditions with seeded loot, egg lifecycle through player-witnessed hatching, roster cap, loot reveal, away sheet',
  phases: [
    { title: 'Core', detail: 'expedition + egg systems, combineGenomes, catch-up integration' },
    { title: 'UI', detail: 'focus view + multi-pip selector, loot reveal + eggs + away sheet, in parallel' },
    { title: 'Integrate', detail: 'wire the parallel UI into main.ts, full suite green' },
    { title: 'Verify', detail: 'gate runner + spec/tone audit + mutation tester' },
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

const SHARED = `Project: /Users/gary/dev/pipskeep. Read CLAUDE.md, then PIPSKEEP_SPEC.md sections named in your task. Existing: full Pip core (needs/mood/machine with departExpedition/beginReturn/arriveHome + pendingSulk, lifecycle, catchup with custom-event seam + extraEvents collector), GameState + reducer (src/core/state.ts), care actions, save layer with quarantine recovery, OffsetClock debug menu with time-skip and a marked egg-spawn seam, working game on :5317. Content registries in src/content/ (expeditions.ts has meadow/forest/shore data, species.ts genome fields). Purity rules as ever: core pure, tuning numbers from content, rng streams only (cursors in state.rngState). npm test + npm run build green before finishing. Do not commit; do not touch PROGRESS.md/.claude/.`

phase('Core')
const b1 = await agent(`${SHARED}

Spec sections: 6.1, 6.3, 7 (all), 12 (breeding seam), 13 Phase 4 gate. You own src/core/expeditions/, src/core/eggs/, extensions to src/core/state.ts, and src/core/pips/genome work.

1. Expeditions (core/expeditions/): assignExpedition(state, pipId, expeditionId, at) — legality: pip Idle (machine handles refusals: Sulking refuses with dialogue, Piplings cannot go per spec 4.6), expedition unlocked (state.keepLevel — ADD keepLevel: number to GameState, default 1; meadow needs 1, forest 2, shore 3). Duration = content duration x personality modifier (Hardworking x0.85 from tuning). Completion is DERIVED: departedAt + durationMs (never setTimeout; reload mid-expedition preserves remaining time by construction — but write the explicit test). On return (TICK or catch-up, chronological): roll loot from the 'expedition-loot' stream — weighted table from content, Curious +10% loot (implement as tuning-defined bonus-roll chance, document exact semantics in a comment), plus egg chance per expedition (8/12/18%). Loot + optional egg go to state.pendingReveals (queue) — NOT directly to inventory. ACKNOWLEDGE_REVEAL action transfers loot to inventory/resources and eggs to state.eggs. Multiple pips out simultaneously on DIFFERENT expeditions (one pip per expedition — enforce).
2. Eggs (core/eggs/): EggState machine Found -> Incubating -> Pipping -> Hatched (spec 7.2). Incubation: content-defined per rarity (2h default), timer derived from foundAt/incubationStartedAt; NOT capped by the offline rate cap — during catch-up an egg completion registers via the catchup extraEvents seam ({kind:'custom', tag:'eggReady'}) and sets Pipping. Pipping WAITS for the player (never auto-hatches — hard rule). HATCH_EGG action: at roster cap (tuning, 3) refuse with a friendly typed message (no hatch, egg stays Pipping, never expires); otherwise roll genome from the 'egg' stream (species weighted by registry rarity, palette/pattern/personality random) -> create Pipling via a shared createPipFromGenome (refactor createNewGame to use it), add to roster.
3. Genome (spec 7.3): TraitGenome exists in types.ts — implement combineGenomes(a, b, rng) NOW as the breeding seam: per-field inheritance (species from either parent 50/50, palette/pattern each from either parent with small mutation chance from tuning, personality either parent). Unit-test it thoroughly (determinism from stream, field provenance, mutation bounds). NOTHING calls it in gameplay (spec 12: seam only).
4. State/reducer: new actions ASSIGN_EXPEDITION, ACKNOWLEDGE_REVEAL, HATCH_EGG, DEBUG_SPAWN_EGG (dev seam). TICK now also: expedition returns (roll loot chronologically if multiple), egg incubation completion -> Pipping. CATCHUP: register egg events through the existing seam; expedition returns during catch-up must roll loot IN CHRONOLOGICAL ORDER across multiple pips (rng determinism depends on order — test this explicitly with two expeditions returning in opposite assignment order).
5. Tests (the section 13 Phase 4 gate + more, all FakeClock): send pip -> advance duration -> Returning -> ACKNOWLEDGE -> exact seeded loot (assert item-by-item against a fixed seed); egg completes fully during a 3-day absence and WAITS in Pipping at load; hatch at cap -> typed friendly refusal, egg intact; save mid-expedition -> reload -> remaining time exact to the ms; need hits 0 mid-expedition -> Sulking deferred to return, loot unaffected; Hardworking duration x0.85 exact; Curious loot bonus deterministic; one-pip-per-expedition enforced; pipling assignment refused; locked expedition refused; chronological multi-return rng order; combineGenomes suite; eggs never expire (30-day-old Pipping egg still hatches).`, { label: 'build:expeditions-eggs-core', phase: 'Core', schema: REPORT })

phase('UI')
const [b2, b3] = await parallel([
  () => agent(`${SHARED}

Core builder finished: ${JSON.stringify(b1?.summary ?? 'inspect src/core yourself')}. Spec sections: 6.1, 10 (two views, top bar as ACTIVE PIP SELECTOR), 15.5 (tone).

You own: src/ui/topBar.ts, src/ui/focusView.ts, src/ui/actionBar.ts (only if needed), src/ui/ui.css, src/app/main.ts. Do NOT touch: keepScene.ts, lootReveal/awaySheet (a parallel agent owns those — it will export init functions from src/ui/phase4.ts; add exactly one call \`initPhase4Ui(store, clock)\` in main.ts guarded so it type-errors loudly if missing rather than silently skipping).

1. Top bar -> active Pip selector (spec 10): one portrait chip per roster pip (mood dot via displayedMood, tiny status glyph when OnExpedition/Resting/Sulking), tap to switch activePipId (new SET_ACTIVE_PIP action if core lacks it — coordinate with state.ts, add reducer case + test if you add it). Need bars show the ACTIVE pip. Away pips: bars still visible when selected (needs decay while away).
2. Pip focus view (spec 10): tap the active pip's portrait (or an Info affordance) -> overlay panel: large procedural portrait, name + species + personality with a one-line personality blurb (write these five blurbs, on-tone), four stat readouts, life stage, and EXPEDITIONS: the three destinations with name/flavor/duration/unlock state (locked ones show "Keep level N" requirement, friendly), Send button per unlocked destination when pip is eligible; personality-appropriate refusal line surfaces when Sulking (use the core refusal + dialogue); OnExpedition pip shows destination + live remaining-time countdown (derived, ticks down). Close returns to Keep view.
3. Expedition lifecycle UX: when a pip departs -> it trots off-screen in the scene (dispatch through existing render hooks if available; keep DOM-side minimal), status glyph in selector, notify toast on return ("Mosspip is back from the Meadow!") wired from state change (pendingReveals growing), tapping the toast or a bouncing "!" chip opens the loot reveal (the parallel agent's module — call its exported open function via the phase4 module).
4. Keep all copy warm + mischievous. npm test + build green (jsdom tests for selector switching + focus view state rendering where cheap; logic in pure controllers).`, { label: 'build:focus-selector', phase: 'UI', schema: REPORT }),
  () => agent(`${SHARED}

Core builder finished: ${JSON.stringify(b1?.summary ?? 'inspect src/core yourself')}. Spec sections: 6.1 (loot reveal moment — THE dopamine core), 4.5 (away summary), 7.2 (pipping/hatch), 15.5 (tone).

You own: src/ui/lootReveal.ts, src/ui/awaySheet.ts, src/ui/phase4.ts (exports initPhase4Ui(store, clock) that wires your modules + exposes openLootReveal()), src/ui/modals.css (your styles — do NOT touch ui.css), src/render/keepScene.ts (egg rendering only — additive), src/ui/debugMenu.ts (fill the marked egg-spawn seam with a "Spawn egg" button). Do NOT touch: topBar.ts, focusView.ts, main.ts (a parallel agent owns those and will call your initPhase4Ui).

1. Loot reveal modal (make it JUICY — this is the game's dopamine core per spec 6.1): staged reveals — items flip in one by one (croissant-timing stagger, scale-pop + particle burst per item, sound() slot per reveal), commons quick, uncommon/rare items get a pause + bigger flair (glow ring, confetti), and an EGG reveal is the showstopper (screen-dim, wobble, spotlight, big confetti). Then a single warm summary line and a Collect button dispatching ACKNOWLEDGE_REVEAL. Queue-aware: multiple pending reveals play sequentially.
2. Egg in the Keep (keepScene, additive layer): eggs from state.eggs render as speckled eggs near the pip area; Incubating = gentle breathing pulse + subtle progress ring; Pipping = wobble + crack particles + tap affordance ("!"); tapping dispatches HATCH_EGG -> hatch burst (shell pop, confetti, bounce) and the new Pipling drops in at 0.7 scale with a hello line via the dialogue system. Roster-cap refusal surfaces the core's friendly message as a toast + the egg does a polite "not yet" wiggle. Piplings visually distinct (smaller, already handled by resolver stage param).
3. "While you were away…" sheet (spec 4.5): on boot after CATCHUP when lastCatchup shows meaningful elapsed (> a few minutes), show a warm summary sheet: per-pip needs deltas (arrows, not doom), expeditions completed (with destination), eggs now Pipping ("Something is tapping from inside…"), resources gathered count, capped-time note when applicable ("we stopped counting after 12h, they insisted"). Dismiss -> then loot reveals queue plays.
4. Debug: "Spawn egg" button in the marked seam (dev only, instant Pipping egg for QA).
5. Tests: pure controller logic (reveal queue sequencing, away-sheet data derivation from CatchupSummary, egg tap -> HATCH dispatch, cap-refusal path) in node/jsdom. npm test + build green.`, { label: 'build:reveal-eggs-away', phase: 'UI', schema: REPORT }),
])

phase('Integrate')
const integ = await agent(`${SHARED}

Three builders finished. b2 (focus/selector/main.ts): ${JSON.stringify(b2?.summary ?? 'missing')}. b3 (reveal/eggs/away, exports initPhase4Ui from src/ui/phase4.ts): ${JSON.stringify(b3?.summary ?? 'missing')}.

Your job: make the seams meet. Verify main.ts calls initPhase4Ui correctly (add/fix the call if the parallel timing left it broken), the toast->openLootReveal path works, SET_ACTIVE_PIP exists exactly once, no duplicate CSS class collisions between ui.css and modals.css, tsc clean, FULL suite green, npm run build green, and do a dev-server smoke: start vite (port 5317 may already be running — reuse or use --port 5318 --strictPort false for your check), curl the page, confirm no import errors in the served module graph. Fix whatever integration friction you find. Report what you changed.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, audit, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep Phase 4 (PIPSKEEP_SPEC.md section 13 Phase 4 — read it). Run npm test + npm run build YOURSELF. Map every clause to named passing tests: (1) FakeClock send -> advance -> Returning -> collect = correct SEEDED loot asserted item-by-item; (2) egg completes during offline absence and WAITS in Pipping (never auto-hatches); (3) hatching at roster cap blocks with friendly message, egg intact + never expires; (4) reload mid-expedition preserves remaining time EXACTLY; (5) need hitting 0 mid-expedition defers Sulking until return with loot unaffected; (6) Hardworking x0.85 duration + Curious loot bonus tested; (7) chronological rng ordering for multi-pip returns tested; (8) combineGenomes tested as seam (and grep: NOTHING in gameplay code calls it — spec 12). pass only on full evidence.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Spec/tone audit for /Users/gary/dev/pipskeep Phase 4 against PIPSKEEP_SPEC.md sections 6, 7, 10, 12, 15.5 (read first). (1) Expedition values match content tables (5/15/30min, 8/12/18% egg, unlock levels) and ALL tuning numbers flow from content (grep core for literals). (2) One pip per expedition; multiple pips out simultaneously allowed on different ones. (3) Egg lifecycle per 7.2; hatching always player-witnessed (grep for any auto-hatch path in TICK/CATCHUP — finding if exists). (4) Scope fence: breeding UI absent, combineGenomes uncalled by gameplay, no attraction/seasonal/push features. (5) Copy tone: away sheet, roster-cap message, expedition flavor, reveal lines — warm, mischievous, zero guilt; flag corporate strings. (6) Purity re-grep + rng streams only. (7) UI: top bar is now a real multi-pip selector with mood dots; focus view has assign-to-expedition; in-app-only notifications. pass=true only if zero blocker/major.`, { label: 'audit:spec-tone', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep. Phase 4 work is UNCOMMITTED — copy targets to /tmp, restore + cmp after each cycle, NEVER git-restore. Mutations vs src (never tests): (1) loot rolls bypass the 'expedition-loot' stream (fresh unseeded rng); (2) expedition remaining time recomputed from load-time instead of departedAt (reload drift); (3) HATCH_EGG ignores roster cap; (4) egg incubation obeys the 12h offline rate cap (should NOT); (5) Pipping egg auto-hatches during TICK; (6) Curious bonus removed; (7) Hardworking modifier removed; (8) catchup processes multi-pip returns in reverse order (rng order dependence); (9) ACKNOWLEDGE_REVEAL double-grants on repeat dispatch (idempotency). For each: apply, npm test, FAILED (good) or SURVIVED (major + missing assertion named), restore + cmp. Finish: suite green, git status only legit files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, audit, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${SHARED}

Fix these Phase 4 findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build. Real output. pass=true only if fully green and git status shows only legitimate Phase 4 files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — Phase 4 verified clean')
}

return {
  core: b1?.summary,
  focusSelector: b2?.summary,
  revealEggsAway: b3?.summary,
  integration: integ?.summary,
  decisions: [b1, b2, b3, integ].filter(Boolean).flatMap(b => b.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}