export const meta = {
  name: 'round2c-gamification',
  description: 'Full gamification: Pipdex + Sanctuary, daily streak, milestones, bounties, expedition mastery, egg pity counter, events, multipliers',
  phases: [
    { title: 'Design', detail: 'retention bible: the loops, the numbers, the anti-dark-pattern rules' },
    { title: 'Core', detail: 'collection/sanctuary + progression systems in core, sequentially' },
    { title: 'UI', detail: 'Pipdex screen, streak/bounty surfaces, mastery + pity displays in parallel' },
    { title: 'Integrate', detail: 'wire seams, mobile layout, full suite green' },
    { title: 'Verify', detail: 'gate runner + tone/dark-pattern audit + mutation tester' },
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

const CONTEXT = `Project: /Users/gary/dev/pipskeep (PipsKeep, 1053 tests green). Read CLAUDE.md, then PIPSKEEP_SPEC.md — ALL of §16's changelog (v1.1/v1.2/v1.3 are amendments that override earlier sections), plus §0 vocabulary, §4.4 (Pips never die/punish), §12 scope fence, §15.5 tone. Also read docs/content-bible.md §9 (its risk list drives this round).

STATE OF THE GAME: v1.0 shipped; round 2A fixed playtest bugs and retuned feel; round 2B added 14 species forms across 7 evolution lines, 6 biomes (quick trip + deep trip per Keep level, with biome-themed egg pools), 10 foods, 20 decorations, 2 jobs.

THE PROBLEM THIS ROUND SOLVES — stated plainly by the project owner: "this still begs the problem of why would anyone play this." The game has a great 5-minute experience and NO 5-day experience. Nothing accumulates visibly, nothing is being chased, and today's session is indistinguishable from yesterday's. The owner chose "FULL MONKEY BRAIN" for gamification depth: collection album, forgiving daily streak with escalating rewards, milestone achievements, daily bounties, per-pip expedition mastery, an egg rarity chase with a VISIBLE pity counter, limited-time flavor events, loot multipliers.

THE ONE HARD GUARDRAIL (orchestrator ruling, non-negotiable): REWARD SHOWING UP, NEVER PUNISH ABSENCE. §4.4 says Pips never punish the player, and that rule outranks every retention mechanic here.
- A broken streak loses a BONUS, never progress, never an item, never a Pip.
- Limited-time events must not create permanently-missed content anxiety: anything obtainable in an event must remain obtainable afterwards (an event makes it EASIER or more flavorful, never exclusive-forever).
- The pity counter is VISIBLE, never hidden.
- No countdown timers designed to induce urgency, no "your Pips missed you" guilt, no streak-loss shaming. A returning player after two weeks should feel welcomed, not billed.
If a mechanic cannot be built without violating this, report it instead of building it.

THE STRUCTURAL PROBLEM YOU MUST SOLVE (content-bible §9's sharpest risk): there are 14 collectable forms but the roster cap is 3 (5 upgraded). With no storage and no release, a completionist would have to DELETE Pips to see new ones — which collides head-on with "Pips never die, never leave". The orchestrator's ruling: build a SANCTUARY (or equivalent) where Pips retire — still named, still visitable, never destroyed, retrievable back into the active roster. Nothing is ever deleted, only relocated. Design it so the fiction is warm ("they've gone to help out at the meadow sanctuary; visit any time"), never disposal.

Architecture rules as ever: core/ pure (no Date.now outside clock.ts, no Math.random outside rng.ts, no pixi/DOM); tuning numbers in content/tuning.ts; time enters reducers via action 'at' timestamps; rng cursors in GameState; save changes need a migration + fixture. Every core system gets Vitest tests. npm test + npm run build green before finishing. Do not commit. Do not touch PROGRESS.md or .claude/.
IMPORTANT: do NOT hand-edit files another agent in this workflow owns; the integrate stage resolves seams.`

phase('Design')
const design = await agent(`${CONTEXT}

You are the retention designer. Produce THE RETENTION BIBLE at /Users/gary/dev/pipskeep/docs/retention-bible.md. Design only — author no registries, write no feature code. You MAY add numbers to src/content/tuning.ts.

Design these systems concretely, each with its data shape, its numbers, and its anti-dark-pattern justification:
1. PIPDEX: the collection record. What counts as "seen" vs "caught"? (Biome egg pools mean a player can know a species exists before owning it.) 14 forms × shiny × gift variants is a big matrix — decide what the completion target actually IS so it feels achievable but long. Per-entry detail: where found, evolution line, flavor, first-caught date. It must read as a scrapbook, not a spreadsheet.
2. SANCTUARY: the storage answer. Capacity (generous or unlimited?), the retire and retrieve flows, what a retired Pip's needs do (they must NOT decay into misery while retired — that would be punishment by storage; decide and justify), and the warm fiction. This is load-bearing: without it the collection is unreachable.
3. DAILY STREAK: forgiving. Define what counts as a "visit day" (a care action? just opening?), the escalating reward ladder, and what a break costs (a bonus tier, nothing more). Include a grace mechanism so real life doesn't nuke a long streak — justify whichever you pick.
4. MILESTONES/ACHIEVEMENTS: a spread from first-hour to long-haul. Rewards should be resources, decorations, or Pipdex flair — never power that makes care trivial.
5. DAILY BOUNTIES: 2-3 per day, rerollable?, sourced from what the player can actually do at their Keep level (a bounty for a locked biome is a bug — make the generator level-aware and prove it).
6. EXPEDITION MASTERY: per-pip-per-biome progression. What improves (loot quantity? rare odds? duration?) and by how much, with a cap so it never trivializes the economy. Respect round 2A's balance guards.
7. EGG PITY: visible counter. Define the rarity tiers, base odds, and the pity threshold at which a rare is guaranteed. Must be deterministic from the seeded RNG and survive save/reload.
8. EVENTS: limited-time FLAVOR (not exclusive content). Use the §12 availableWindow field that already exists unused in the content registries. Nothing missable forever.
9. LOOT MULTIPLIERS: where they come from, their cap, and how they interact with mastery without compounding into absurdity.

ALSO: specify the SESSION SHAPE — what a returning player sees, in order, on opening the app after a day away (away sheet, streak, bounties, reveals, Pipdex nudges all want that moment; sequence them so it is a warm welcome and not five modals in a queue). This is the single most important UX decision in the round.

Enumerate every risk, every balance interaction with round 2A's guards, and every save-schema change needed.`, { label: 'design:retention-bible', phase: 'Design', schema: REPORT })

phase('Core')
const c1 = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/retention-bible.md and implement its COLLECTION half in core. Designer summary: ${JSON.stringify(design?.summary ?? 'read the bible')}

You own src/core/collection/ (new), src/core/sanctuary/ (new, or fold into collection if the bible says so), plus the state/reducer/save changes they need. Do NOT touch src/core/progression/ (a peer agent owns it), or ui/render.

1. PIPDEX record in GameState: seen/caught per the bible's definition, first-caught timestamps, shiny and variant tracking. It must be derivable-safe: existing saves migrate with everything currently owned marked caught (a veteran must not lose credit for Pips they already have).
2. SANCTUARY: retire/retrieve actions with the bible's capacity rule. HARD REQUIREMENT: a retired Pip is never destroyed and never degrades into misery — implement whatever the bible chose (needs frozen, or slowly self-maintaining) and TEST that a Pip retired for 30 simulated days comes back happy and intact, with its name, genome, age, mastery and shiny status preserved bit-for-bit.
3. Roster/cap interaction: retiring frees a roster slot; retrieving respects the cap and refuses warmly when full. Hatching at cap should now suggest the Sanctuary rather than dead-ending (the §7.4 message gets better).
4. Save migration + fixture for the new schema version. Existing-save path must be exercised by a test.
5. Tests: Pipdex marking on hatch/evolve/retrieve; completion percentage math; sanctuary round-trip integrity over long absences; cap refusals; migration of a pre-Pipdex save marking owned Pips caught.`, { label: 'core:collection-sanctuary', phase: 'Core', schema: REPORT, model: 'sonnet' })

const c2 = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/retention-bible.md and implement its PROGRESSION half in core. Peer agent c1 built collection/sanctuary (summary: ${JSON.stringify(c1?.summary ?? 'inspect src/core/collection')}) — read its code, do not edit it.

You own src/core/progression/ (new: streak, milestones, bounties, mastery, pity, events, multipliers) plus the state/reducer/save changes they need. Do NOT edit src/core/collection/ or src/core/sanctuary/; if you need something from them, read and compose.

1. STREAK: visit-day tracking per the bible (day boundaries from injected timestamps ONLY — no Date, no timezone library; document the day-boundary rule you use and test it across a boundary). Forgiving break behavior: losing a streak must lose only a bonus tier. Test that a break destroys no progress and no items.
2. MILESTONES: a registry-driven achievement system (content-defined so new milestones are a data change), with claim actions and idempotency (claiming twice must not double-grant — test it).
3. BOUNTIES: daily generation from the seeded RNG, LEVEL-AWARE so a bounty never asks for a locked biome or an unobtainable item — test that at Keep level 1 no generated bounty is impossible. Deterministic per day from seed + day index, surviving reload.
4. MASTERY: per-pip-per-biome counters and their effects, capped per the bible. Must not break src/core/pips/balance.test.ts or src/core/economy/reachability.test.ts — run both constantly; they are the guards.
5. PITY: visible counter in state, deterministic, survives save/reload; guarantees a rare at the bible's threshold. Test the guarantee fires exactly at the threshold and resets after.
6. EVENTS: read the availableWindow field already present in the content registries (§12 seam); an inactive window must never make content permanently unobtainable — test that.
7. MULTIPLIERS: composition with mastery, capped. Test the cap holds under maximum stacking.
8. Save migration + fixture (coordinate: c1 may also bump the version — if so, merge into ONE version bump and say so loudly in your report).`, { label: 'core:progression', phase: 'Core', schema: REPORT, model: 'sonnet' })

phase('UI')
const [u1, u2] = await parallel([
  () => agent(`${CONTEXT}

Read docs/retention-bible.md. Core is built: collection/sanctuary (${JSON.stringify(c1?.summary ?? 'read src/core/collection')}), progression (${JSON.stringify(c2?.summary ?? 'read src/core/progression')}).

You own the PIPDEX + SANCTUARY UI: src/ui/pipdex.ts, src/ui/sanctuary.ts, their CSS (your own file, do not edit ui.css or modals.css), and src/render additions ONLY if a Pipdex portrait needs the resolver (it should reuse resolvePipSprite/the DOM portrait pattern already in topBar/focusView). Do NOT touch other ui/ modules; the integrate stage wires you in via an exported init function.

1. PIPDEX screen: a scrapbook, not a spreadsheet. Grid of species entries; caught entries show their real procedural portrait, seen-but-uncaught show a soft silhouette with a hint of where to find them, unknown show a gentle placeholder. Tapping an entry opens detail: portrait, evolution line, biome(s) it comes from, its flavor line from speciesLines, first-caught date, shiny/variant badges. Completion progress at the top, phrased warmly. MUST scroll cleanly at 375px wide.
2. SANCTUARY screen: the warm fiction, never disposal. List retired Pips with portraits and names, "visit" detail, and Retrieve. Retiring flows from the focus view (the integrate stage adds that entry point — expose an openRetireConfirm(pipId) you export). Copy must make it feel like a fond farewell with an open door, never deletion. The confirm must be unambiguous that the Pip is safe and retrievable.
3. Both screens need a way in — expose init + open functions; integrate wires the entry points.
4. Pure-controller pattern: derive view models in testable functions, keep DOM dumb, unit-test the models (completion math display, entry states, sanctuary list ordering).
5. Verify visually yourself on a 375px viewport via the dev server (restart it first; stale HMR has bitten this project). Report what you saw.`, { label: 'ui:pipdex-sanctuary', phase: 'UI', schema: REPORT, model: 'sonnet' }),
  () => agent(`${CONTEXT}

Read docs/retention-bible.md, especially its SESSION SHAPE section — you own the returning-player moment, the most important UX decision in the round. Core is built: collection (${JSON.stringify(c1?.summary ?? 'read src/core/collection')}), progression (${JSON.stringify(c2?.summary ?? 'read src/core/progression')}).

You own src/ui/dailies.ts (streak + bounties + milestones surfaces), src/ui/welcome.ts (the sequenced returning-player flow), their own CSS file, and mastery/pity display bits that live in the focus view — for focusView.ts changes, keep them ADDITIVE and minimal and list them precisely in your report so the integrator can check them. Do NOT touch pipdex/sanctuary (peer agent) or phase4/phase5 internals.

1. SESSION SHAPE: implement the bible's sequence for opening after time away. Today the away sheet and loot reveals already queue; streak/bounties/milestones must join that sequence WITHOUT becoming five stacked modals. One warm welcome, progressive disclosure, everything skippable/dismissible in one tap. This is the round's headline UX — get it right and say why your sequencing works.
2. STREAK surface: current streak, next reward, and (critically) copy that is warm when a streak breaks — "welcome back" energy, never "you lost your 12-day streak". Show the grace mechanism if the bible defined one.
3. BOUNTIES: 2-3 daily cards with progress, claim buttons, and reroll if the bible allows. Claiming must feel juicy (reuse the confetti/sound seams).
4. MILESTONES: a browsable list with claimed/unclaimed state; claiming grants + celebrates.
5. MASTERY + PITY displays: mastery per biome on the focus view's expedition rows (a subtle rank/pips indicator, not a numbers dump); the pity counter visible near egg/expedition UI, phrased as encouragement ("a rare find is due soon"), never as a slot machine.
6. Pure controllers + dumb DOM; unit-test the models (sequence ordering, streak copy selection incl. the break case, bounty progress math).
7. Verify visually at 375px on the dev server (restart first). Report what you saw.`, { label: 'ui:dailies-welcome', phase: 'UI', schema: REPORT, model: 'sonnet' }),
])

phase('Integrate')
const integ = await agent(`${CONTEXT}

All four builders finished. collection/sanctuary core: ${JSON.stringify(c1?.summary ?? 'missing')} | progression core: ${JSON.stringify(c2?.summary ?? 'missing')} | pipdex/sanctuary UI: ${JSON.stringify(u1?.summary ?? 'missing')} | dailies/welcome UI: ${JSON.stringify(u2?.summary ?? 'missing')}

Your job — make it one coherent game:
1. EXACTLY ONE save-schema version bump for this whole round (merge if builders each bumped), with a migration + fixture, and a test loading a pre-round save that ends up with owned Pips marked caught and no lost data.
2. Wire every entry point: Pipdex and Sanctuary need a way in from the main UI (add navigation — the top bar or a small menu; keep it thumb-friendly and do not crowd the care bar). Retire flows from the focus view. Welcome sequence runs at boot ahead of/around the existing away sheet + loot reveal queue WITHOUT double-showing anything.
3. LAYERING: this project has a known stacking-context hazard — .pk-phase5's keep bar could not be z-index'd under sheets and had to be hidden instead (see the onOpenChange fix in buildSheet.ts/phase5.ts). Your new screens MUST NOT repeat that bug: verify every new overlay against the keep bar, the sound toggle, the debug wrench, the toast stack, and each other. Fix what collides.
4. Full npm test + npm run build green; tsc clean; balance.test.ts and reachability.test.ts MUST still pass (they are the round-2A/2B guards).
5. Browser smoke at 375px (RESTART the dev server first): open Pipdex, open Sanctuary, retire a Pip and retrieve it, check the welcome sequence by using the debug time slider to skip a day, claim a bounty, confirm nothing overlaps and everything scrolls. Report REAL observations with what you actually saw.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, tone, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep round 2C. Run npm test + npm run build YOURSELF and map each system to named passing tests, quoting assertions: (1) Pipdex seen/caught marking + completion math + migration marking existing Pips caught; (2) SANCTUARY: a Pip retired for 30 simulated days returns intact and NOT miserable — this is the round's most important test, quote it; (3) streak: a break loses only a bonus, no progress/items lost; day-boundary rule tested; (4) milestone claim idempotency (double-claim cannot double-grant); (5) bounties are level-aware — at Keep level 1 no impossible bounty can generate; (6) mastery capped, and balance.test.ts + reachability.test.ts still pass; (7) pity guarantee fires exactly at threshold, resets after, survives reload; (8) event windows never make content permanently unobtainable; (9) multiplier cap holds under max stacking; (10) exactly ONE schema bump with a fixture. pass=true only on evidence you gathered yourself.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`DARK-PATTERN + TONE AUDIT for /Users/gary/dev/pipskeep round 2C. This is the most important audit of the round: the owner asked for "full monkey brain" and the orchestrator's hard guardrail is REWARD SHOWING UP, NEVER PUNISH ABSENCE (§4.4 outranks every retention mechanic).

Read PIPSKEEP_SPEC.md §4.4, §12, §15.5 and docs/retention-bible.md, then read EVERY new player-facing string and every mechanic. Flag as a MAJOR any of: a broken streak costing progress/items/Pips rather than just a bonus; guilt copy ("your Pips missed you", "don't lose your streak"); urgency countdowns engineered to pressure; event content that becomes permanently unobtainable; a hidden pity counter; anything that makes a returning absent player feel billed rather than welcomed; retire/sanctuary copy that reads as deletion or disposal; any mechanic that punishes NOT playing. Also check: milestone rewards do not grant power that trivializes care; the Pipdex reads as a scrapbook not a spreadsheet; §0 vocabulary clean (no Pal/gotchi/pokemon/palworld/tamagotchi, case-insensitive, whole repo); the welcome sequence is one warm moment rather than a modal pile-up (count the taps a returning player needs to reach normal play — more than ~3 is a finding). Quote the offending copy in every finding. pass=true only if zero blocker/major.`, { label: 'audit:dark-patterns', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep round 2C. Work is UNCOMMITTED — copy each target to the session scratchpad, restore + verify with cmp after EACH cycle, NEVER git-restore. Mutations vs src (never tests): (1) a retired Pip's needs decay normally while in the Sanctuary (punishment-by-storage); (2) retrieve loses the Pip's shiny flag; (3) breaking a streak resets milestone progress; (4) milestone claim is not idempotent (double-claim double-grants); (5) bounty generation ignores Keep level (can ask for a locked biome); (6) the pity counter does not persist across save/reload; (7) pity never guarantees (threshold check removed); (8) mastery effect uncapped; (9) multipliers compound without cap; (10) the Pipdex migration marks existing Pips as NOT caught (a veteran loses credit); (11) an expired event window makes its content unobtainable rather than merely un-flavored. For each: apply, npm test, record FAILED (good, name the catching test) or SURVIVED (major finding, name the missing assertion). Surviving mutations in the sanctuary/streak group are the most serious — they are the ones that would punish a real player. Finish with the suite green and git status showing only legitimate round-2C files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, tone, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${CONTEXT}

Fix these round-2C findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. Dark-pattern and tone findings are AS IMPORTANT as correctness findings — rewrite copy rather than patching around it, and if a mechanic cannot be made non-punishing, remove it and say so. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build, and specifically re-run and name balance.test.ts, reachability.test.ts, and the sanctuary long-absence test. Report real output. pass=true only if fully green and git status shows only legitimate round-2C files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — round 2C verified clean')
}

return {
  bible: design?.summary,
  collectionSanctuary: c1?.summary,
  progression: c2?.summary,
  pipdexUi: u1?.summary,
  dailiesUi: u2?.summary,
  integration: integ?.summary,
  decisions: [design, c1, c2, u1, u2, integ].filter(Boolean).flatMap(x => x.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}