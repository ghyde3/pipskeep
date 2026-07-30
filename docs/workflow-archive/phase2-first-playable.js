export const meta = {
  name: 'phase2-first-playable',
  description: 'Care actions + GameState reducers, serialization round-trip, 240+ line dialogue corpus, Pixi render + DOM UI — first playable',
  phases: [
    { title: 'Core', detail: 'GameState, reducers, care actions, cooldowns, refusals, dialogue selection' },
    { title: 'Fan-out', detail: 'serialization + 5 personality dialogue writers + render/UI, in parallel' },
    { title: 'Verify', detail: 'gate runner + tone/spec audit + mutation tester' },
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

const SHARED = `Project: /Users/gary/dev/pipskeep. Read CLAUDE.md first, then the PIPSKEEP_SPEC.md sections named in your task. Existing: src/core/ (clock, rng with getState/createRngFromState, store, pips/ complete: types PipState, needs, mood deriveMood + DialogueContext, machine with canReceiveCare/refusals, lifecycle, catchup). src/content/tuning.ts has every number. Purity: core/ has no DOM/pixi/Date.now/Math.random; time enters via action payloads or injected Clock; randomness via rng streams whose cursors live in state. npm test green before finishing. Do not commit; do not touch PROGRESS.md/.claude/; stay inside the files your task assigns.`

phase('Core')
const b1 = await agent(`${SHARED}

Spec sections: 3 (dialogue keying), 4.3 (Chaotic display quirk), 5 (care actions + refusal rules — v1.1), 6.3 (inventory/resources), 8 (save shape awareness only).

You own: src/core/state.ts (GameState + root reducer), src/core/pips/care.ts, src/core/pips/dialogue.ts, refactoring src/content/dialogue.ts into src/content/dialogue/{lazy,curious,hardworking,chaotic,clingy}.ts + index.ts, and tests.

1. GameState: { pips: Record<PipId, PipState>, rosterOrder: PipId[], activePipId, inventory: Record<itemId, count>, resources: Record<resourceId, count>, rngState: Record<string, number>, seed: number, cooldowns: Record<PipId, Partial<Record<CareAction, number>>> (last-used ms timestamps), createdAt, lastTickAt }. createNewGame(seed, now): one starter mosspip (random personality via rng stream 'genesis', hunger ~60 per spec 10.1) + 3 berries.
2. Root reducer via existing store: actions carry an 'at' timestamp (clock stays outside reducers). Actions: TICK {at} (applyNeedsDelta for elapsed since lastTickAt + evaluateSulk + auto-wake + lifecycle updates), FEED {pipId, foodId, at}, CLEAN, PLAY, PET, REST_TOGGLE, GIVE_ITEM {pipId, itemId, at}, plus CATCHUP {savedAt, now} delegating to runCatchup.
3. care.ts: effects from tuning/content — Feed consumes inventory, +hunger (+sides); Clean -> 100 with 60s cooldown; Play +20 happy −10 energy; Pet +8 (+14 Clingy) 30s cooldown; Rest toggles via machine; Give Item sets lastGiftItemId + content effects. Refusals (v1.1 spec 5): any pip refuses Play below 10 energy; Lazy below 30; Lazy 15% random refusal via rng stream 'quirks'; refusals cost nothing, no cooldown, produce context 'refusal'. Care legality via canReceiveCare (machine). Every action returns a CareOutcome { applied, dialogueContext, lineId? } the UI can animate from.
4. dialogue.ts (core): displayedMood(pip, rngStream) — Chaotic has tuning.quirks.chaoticMoodDisplayOffsetChance (10%) to show a mood one step off (both directions, clamp at ends). pickDialogueLine(state, pipId, context): deterministic via rng stream 'dialogue', avoids repeating the immediately-previous line per pip (track lastLineIndex per pip in state).
5. Dialogue registry refactor: same typed shape, split per personality file exporting one DialoguePool; index.ts merges; keep existing placeholder lines so tests stay green (writers will replace file contents in parallel — make each file's shape dead simple to author).
6. Tests: exact stat effect per action; cooldown blocks within 60s/30s and unblocks at exactly the boundary (FakeClock timestamps); refusal matrix (energy 9.99/10, lazy 29.99/30, lazy 15% deterministic via seeded stream); inventory decrement + refuse-when-empty; Clingy pet +14; TICK exactness vs applyNeedsDelta; displayedMood offset determinism; pickDialogueLine no-immediate-repeat; reducer purity (input state not mutated — structural sharing ok).`, { label: 'build:care-core', phase: 'Core', schema: REPORT })

phase('Fan-out')
const VOICES = [
  { id: 'lazy', voice: 'Lazy: horizontal philosopher. Considers standing up a scam. Loves Rest with religious fervor, negotiates everything down to zero effort. Deadpan, slow, secretly affectionate.' },
  { id: 'curious', voice: 'Curious: everything is FASCINATING. Asks unanswerable questions, licks things to understand them, keeps a mental museum of rocks. Breathless, wonder-struck, slightly feral academic energy.' },
  { id: 'hardworking', voice: 'Hardworking: tiny foreman energy. Measures everything in productivity, schedules naps as sprints, suspicious of idleness but endearing about it. Clipped, earnest, secretly proud of you.' },
  { id: 'chaotic', voice: 'Chaotic: gremlin. Answers questions nobody asked, claims credit for weather, occasionally helps aggressively wrong. Non sequiturs, unhinged confidence, zero malice.' },
  { id: 'clingy', voice: 'Clingy: velcro heart. Counts seconds you were gone, negotiates for one more pet, dramatic about goodbyes but instantly forgiving. Big feelings, zero chill, deeply lovable.' },
]
const writerTasks = VOICES.map(v => () => agent(`${SHARED}

Spec sections: 0 (vocabulary), 3 (dialogue), 15.5 (tone). You own EXACTLY ONE file: src/content/dialogue/${v.id}.ts — replace its placeholder lines with the real corpus, keeping the exported typed shape intact.

Character: ${v.voice}

Write MINIMUM 10 lines per context (spec floor is 8 — exceed it), for all 6 contexts: beaming, content, grumpy, miserable, sulking, refusal. Rules: lines short (aim under 60 chars), opinionated, occasionally weird, memeable. Sulking = funny-sad guilt-trip, NEVER bleak ("I ate my sadness. It was low quality." energy). Refusal = funny, never hostile. Grumpy/miserable = comedic suffering, not despair. No emoji, no trademarks (never Pal/-gotchi/Pokemon/anything from spec section 0), no fourth-wall-breaking EXCEPT exactly 1-2 subtle winks in the whole file (e.g. a pip suspecting it lives inside a very small weather system). Vary sentence shapes; no two lines with the same skeleton. After writing: npm test must stay green (the dialogue type + validation enforce shape).`, { label: `write:${v.id}`, phase: 'Fan-out', schema: REPORT }))

const [b2, b4, ...writers] = await parallel([
  () => agent(`${SHARED}

Spec sections: 2 (rule 3 — RNG cursors in save), 8 (save shape). Builder of care-core finished: ${JSON.stringify(b1?.summary ?? 'inspect src/core/state.ts yourself')}.

You own src/core/save/ (serialize.ts, persistence contract) + tests. Do NOT touch src/app/main.ts (the render builder integrates).

1. serialize.ts: SaveBlob = { schemaVersion: 1, seed, savedAt, state: GameState }. toSaveBlob(state, savedAt) / fromSaveBlob(blob) with structural validation (wrong shape -> typed error, never throw raw). RNG cursors are already in state.rngState — assert in tests that a mid-play save/load round-trips them.
2. migrate.ts: migrate(unknownBlob) keyed by schemaVersion — v1 passthrough today, but the harness + a fixture test (fixtures/v1.json) exist NOW so Phase 3 slots in.
3. src/app/persistence.ts: initPersistence(store, clock) using idb — load latest save on init (return { loaded: boolean, savedAt? }), autosave debounced 2s after any dispatch, immediate save on visibilitychange->hidden. Export savePipskeepNow/loadPipskeep for the render builder. Keep it thin; hardening is Phase 3.
4. Tests: DEEP-EQUAL round-trip (the Phase 2 gate): build a rich GameState (multiple pips, touched rng streams, cooldowns mid-tick, sulking pip, pipling), toSaveBlob -> JSON.stringify -> parse -> fromSaveBlob -> expect deep equal AND rng continuation identical (draw 5 from a stream pre-save, save, restore, draw from restored + original — identical). Fixture test for migrate. idb layer: unit-test the debounce logic with FakeClock (mock idb with an in-memory stub).`, { label: 'build:save', phase: 'Fan-out', schema: REPORT }),
  () => agent(`${SHARED}

Spec sections: 5 (actions feel), 10 (full UI spec), 10.1 (first-90-seconds bar), 11 (art standard + SpriteResolver + juice). Care-core builder finished: ${JSON.stringify(b1?.summary ?? 'inspect src/core/state.ts + care.ts yourself')}. A save builder is IN PARALLEL creating src/app/persistence.ts exporting initPersistence(store, clock) -> Promise<{loaded: boolean}> plus savePipskeepNow/loadPipskeep — code against that contract, do not create that file; if it is missing at your integration moment, stub the import locally in ONE line-commented place.

You own src/render/, src/ui/, src/app/main.ts, src/app/ticker.ts, index.html, styling. Build the first playable:

1. render/spriteResolver.ts (spec 11): (genome, stage) -> composed Pixi container. Placeholder pips: layered Pixi Graphics — rounded blob body (palette from genome via content/palette.ts which you create: soft pastels + one vibrant accent per species), big eyes (blink on a timer), pattern overlay (dots/stripes/moss swirl by genome.pattern), accessory anchor point. Piplings render at 0.7 scale. EVERYTHING loads through this resolver.
2. render/tween.ts: tiny tween utility (no deps) — easeOut/easeIn/elastic, squash-and-stretch helper. render/keepScene.ts: pastel ground diorama, active pip centered with idle bob + occasional blink/wiggle, Resting pip shows drifting Z particles, Sulking pip greyed tint + slumped pose.
3. Care animations (< 1.5s, juicy per spec 10.1.3): Feed — food item arcs to pip, munch squash cycles + crumb particles; Clean — sparkle sweep; Play — bounce spin; Pet — heart particle + lean-in; Rest — yawn squash + Z's start. sound(slotId) no-op hook called in each (src/app/sound.ts). Simple particle helper in render/.
4. ui/: DOM overlay, plain TS + CSS (mobile-first portrait, thumb-friendly). Top bar: pip portrait chip (mini canvas or CSS blob) with mood dot (color by displayedMood — the Chaotic quirk routes through core displayedMood), four need bars (live, smooth width transitions, color shifts when < 40 / < 15), resource counts. Bottom bar: big buttons Feed / Clean / Play / Pet / Rest / Items with pressed states; disabled+countdown ring while on cooldown; Items opens a bottom-sheet inventory grid (foods with counts, tap to feed/give). Speech bubble above pip on every CareOutcome: line via pickDialogueLine, typewriter-in, auto-dismiss ~2.5s. Refusals shake the pip gently + refusal line. notify(event) seam: src/ui/notify.ts -> toast stack (in-app only, spec 10).
5. app/main.ts + ticker.ts: boot = initPersistence; if no save createNewGame(seed from crypto.getRandomValues or Date-seed via SystemClock — seed generation is app-layer, allowed); if save loaded dispatch CATCHUP (summary sheet UI is Phase 4 — console.info the summary for now). ticker: requestAnimationFrame-driven dispatch TICK at most every 1000ms (SystemClock), pause when document hidden (catchup on visible via CATCHUP).
6. Verify with the vite build + vite preview (curl the page, check assets). You cannot click a browser; ensure zero console errors at boot via a quick node/jsdom smoke if convenient, otherwise rely on tsc strictness. Keep DOM logic dumb: read state, dispatch actions, never mutate.`, { label: 'build:render-ui', phase: 'Fan-out', schema: REPORT }),
  ...writerTasks,
])

phase('Verify')
const [gate, audit, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep Phase 2 (spec 13 Phase 2). Run npm test + npm run build YOURSELF. Map each gate clause to named passing tests: (1) EVERY care action (feed/clean/play/pet/rest/give-item) has a unit test for exact stat effect AND cooldown where applicable (clean 60s, pet 30s boundaries); (2) refusal rules tested (energy<10 all, lazy<30, lazy 15% seeded, refusal costs nothing); (3) save/reload preserves state EXACTLY — deep-equal test incl. RNG cursor continuation; (4) dialogue validation now HARD-FAILS (error not warn) below 8 lines per context per personality and npm test proves all 5x6 pools pass; (5) vite preview serves the page with the canvas + UI markup present (curl and inspect HTML+JS). pass only if all clauses map to real assertions you saw pass.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Tone + spec audit for /Users/gary/dev/pipskeep Phase 2. Read PIPSKEEP_SPEC.md sections 0, 3, 5, 10, 11, 15.5 first. (1) READ EVERY DIALOGUE LINE in src/content/dialogue/*.ts — flag any line that is bleak, harshly guilting, hostile, off-voice for its personality, or generic filler ("I'm happy!"-grade); flag if fewer than 8 lines in any pool; flag trademark/forbidden vocabulary anywhere (Pal, gotchi, pokemon, palworld, tamagotchi, case-insensitive, whole repo incl. index.html + package.json); count fourth-wall winks per file (>2 = finding). (2) Care effects/cooldowns in code vs spec section 5 table exactly. (3) UI vs spec section 10: top bar has portraits+mood dot+4 need bars+resources; bottom bar big care buttons; in-app-only notifications with notify(event) seam; no Web Push. (4) SpriteResolver is the single sprite path (grep render/ for any pip drawing outside it); palette tokens in content/palette.ts. (5) Purity re-grep (Date.now/new Date outside clock.ts EXCEPT app-layer seed generation if inline-justified, Math.random anywhere, pixi imports in core/). (6) Chaotic displayedMood quirk consumed by the UI (grep for displayedMood usage in ui/render). pass=true only if zero blocker/major.`, { label: 'audit:tone-spec', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep (repo is committed-clean at HEAD... actually Phase 2 work is UNCOMMITTED — so use 'git stash' NEVER; instead copy each target file to /tmp before mutating and restore it after, verifying byte-identical with cmp. If any restore fails, restore from your /tmp copy). Mutations against src/core (never tests): (1) remove the clean-action 60s cooldown check; (2) pet cooldown 30s -> 3s; (3) feed does not decrement inventory; (4) lazy play-refusal threshold 30 -> 3; (5) refusal consumes the cooldown anyway; (6) serialize drops state.rngState; (7) pickDialogueLine ignores context (always 'content' pool); (8) displayedMood never offsets for Chaotic. For each: apply, npm test, record FAILED (good) or SURVIVED (major finding + name the missing assertion), restore, verify cmp clean. Finish with full npm test green and zero unexplained diffs (git status should show only the legitimately-new Phase 2 files, untouched by you).`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, audit, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${SHARED}

Fix these Phase 2 audit findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. Dialogue tone findings: rewrite the flagged lines in the flagged personality's voice. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build, then curl the vite preview page and confirm canvas + UI roots in served HTML. Real output. pass=true only if fully green.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — Phase 2 verified clean')
}

return {
  core: b1?.summary,
  save: b2?.summary,
  renderUi: b4?.summary,
  writers: writers.filter(Boolean).map(w => w.summary),
  decisions: [b1, b2, b4, ...writers].filter(Boolean).flatMap(b => b.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}