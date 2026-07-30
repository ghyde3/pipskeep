export const meta = {
  name: 'round2f-progression-spine',
  description: 'The progression spine: Keep XP with a visible bar, ~12 Keep tiers, buildings with mechanical purpose, item info + icons, milestone celebration',
  phases: [
    { title: 'Design', detail: 'progression bible: the loop at every timescale, the numbers, the anti-trivialization rules' },
    { title: 'Core', detail: 'XP/levels, then building effects — sequential, both touch state' },
    { title: 'Content', detail: 'the ladder, building effects + icons, milestone rewards' },
    { title: 'UI', detail: 'XP bar + level-up, build sheet info/icons, milestone celebration — parallel' },
    { title: 'Integrate', detail: 'wire seams, mobile layout, full suite green' },
    { title: 'Verify', detail: 'gate + game-design audit + mutation' },
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

const CONTEXT = `Project: /Users/gary/dev/pipskeep (1580 tests green, HEAD ee9178b). Read CLAUDE.md, then PIPSKEEP_SPEC.md §16's changelog IN FULL (v1.1/v1.2/v1.3 amendments override earlier sections), plus §4.4, §9, §12, §15.5. Then read docs/retention-bible.md (round 2C) and docs/content-bible.md (round 2B) — this round builds on both.

WHERE THE GAME IS: v1.0 shipped, then 2A fixed playtest bugs + retuned feel, 2B added 14 species forms / 6 biomes / 10 foods / 20 decorations, 2C added the Album, the Long Meadow sanctuary, streaks, 34 milestones, bounties, expedition mastery, an egg pity counter, events and the Doorstep. 2E fixed portrait rendering.

THE OWNER'S GOAL FOR THIS ROUND, in their words: turn this into a game with a loop good enough for a top-tier store listing. Their specific diagnosis, which you must treat as the brief:
- "I think we need that visual progress bar for experience, I think this is one of the major driving levers that we're missing from the UI"
- "Building need to be improved as well to have a better reason to build"
- '"pips will use this" and "just lovely" is FAR too vague, the items need more info, and if we can use some icons for them that would be great, with that our item build options is far too limited, we need reasons to build items, reasons to want to progress, reasons to keep playing. got to build up the game loop, otherwise we're good for a simple 5 minute game "oh thats cute" but no solid reason yet to entice players to come back'
- "Level 3 keep is too little to keep the players coming back long term"
- "Need better notification when milestones are completed"

ORCHESTRATOR RULINGS (binding):
1. XP IS KEEP XP — ONE SPINE. Not per-pip XP. Every meaningful action (care, expeditions, hatching, building, bounties, milestones, evolutions) grants Keep XP so NO session feels wasted and the bar always moves. This is the single most important mechanic in the round.
2. \`KeepLevel = 1 | 2 | 3\` is a union type in core/keep — WIDENING IT IS AUTHORIZED THIS ROUND. It was declined in 2B only because that round was a §3 content-only proof. Target roughly 12 tiers. EVERY tier must unlock something real; a tier that just raises a number is a dead tier.
3. BUILDINGS MUST DO SOMETHING. Cosmetic-only decoration is why "just lovely" reads as filler. Give placeables mechanical purpose — Keep-wide comfort effects (slower decay, faster rest, higher happiness floor), job/recipe enablement, expedition bonuses, themed set bonuses. CAP EVERYTHING: effects should shorten the care CHORE, never trivialize care. src/core/pips/balance.test.ts is the guard and it must still pass — if an effect breaks it, the effect is wrong, not the test.
4. THE §4.4 TONE RULE AND 2C's GUARDRAIL STILL BIND: never punish absence, never punish the player. Progression is opt-in delight, not a treadmill with a whip.
5. NO DEAD FEATURES. This codebase has now shipped THREE features that wrote state nothing read (evolved.variantId, milestone flair, the Album's bucketed patterns). Spec §16 v1.3 made it a standing rule: "written to state" and "visible to the player" are SEPARATE acceptance criteria. Every XP source, every building effect, and every unlock in this round must be observable by the player, and your report must say where each one is visible.

Architecture: core/ pure (no Date.now outside clock.ts, no Math.random outside rng.ts, no pixi/DOM); tuning numbers in content/tuning.ts; time via action 'at' timestamps; rng cursors in GameState; save changes need ONE schema bump + migration + fixture for the whole round. npm test + npm run build green before finishing. Do not commit. Do not touch PROGRESS.md or .claude/. Do not hand-edit files another agent in this workflow owns.`

phase('Design')
const design = await agent(`${CONTEXT}

You are the progression designer. Write THE PROGRESSION BIBLE to /Users/gary/dev/pipskeep/docs/progression-bible.md. Design only — no feature code. You MAY add a fully-commented \`tuning.progression\` block to src/content/tuning.ts (numbers only, leave every existing value byte-identical).

Before designing, READ THE ACTUAL CODE you are designing onto: core/state.ts (every reducer arm — you need the full list of player actions to assign XP to), core/keep/index.ts (the KeepLevel union, gridBounds), core/economy/index.ts, core/progression/* (2C's systems — mastery, milestones, bounties, streak — your XP must compose with them, not duplicate them), content/keep.ts, content/placeables.ts, content/decorations.ts, content/tuning.ts, and both guard suites (core/pips/balance.test.ts, core/economy/reachability.test.ts) so you know exactly what you must not break.

DESIGN THESE, each with data shape, numbers, and a "where the player SEES it" line:

1. KEEP XP + LEVEL CURVE. Every action's XP value (make a complete table covering every player action in state.ts). The curve for ~12 tiers: early levels within the first session, mid-game in days, late-game in weeks — show the cumulative-XP table and estimate wall-clock-to-level for an engaged player and a casual one. Anti-grind rule: the bar must move visibly for a single care action at EVERY level, so late-game XP values must scale or the bar must be per-level.
2. THE 12-TIER UNLOCK LADDER. What each tier gives. You have real things to hand out: the 6 expeditions, grid plots, roster slots (Cozy Bunks), the 2 jobs, new placeables, recipe/crafting seams, Album features, mastery caps, event participation. Every tier needs a headline unlock a player can look forward to by name. Say explicitly which tiers gate which of the 6 existing expeditions (2B put them at levels 1-3; re-spread them across the new ladder and update reachability expectations).
3. BUILDING EFFECTS. A typed effect system (content-defined so new buildings are a data change). Per-building: what it does, exact numbers, and its cap. Include: comfort effects on the four needs, rest-speed, expedition duration/loot, job enablement, and THEMED SET BONUSES (build 3 of a biome's decorations → a small keep-wide perk) because sets are what make building feel like collecting. Prove against balance.test.ts's leave-safe-floor arithmetic that a maximally-built Keep still requires real care — show the worst-case math.
4. ITEM INFO MODEL + ICONS. Replace "the Pips will use this" / "just lovely" with a structured per-item description: what it does (concrete numbers), footprint, cost, and an ICON. Icons must be procedural CSS/inline-SVG glyphs — NO new dependencies, NO asset pipeline. Specify the icon vocabulary (a small set of shapes/motifs reused across items) rather than 30 bespoke drawings.
5. MORE BUILD ITEMS. The owner says the catalog is "far too limited". Specify the additions (target 35+ placeables/decorations total) grouped into themed sets, each with its effect and cost, all reachability-safe.
6. MILESTONE COMPLETION MOMENT. 2C's milestones currently complete quietly. Design the celebration: what surface, what it shows, how it sequences against the Doorstep and loot reveals (2C's session shape is the constraint — do NOT create a sixth stacked modal).
7. THE LOOP AT EVERY TIMESCALE. Write an explicit map: what a player does in their first 5 minutes, first session, first day, first week, first month — and what pulls them back at each scale. Name the specific mechanic doing the pulling. THIS SECTION IS THE POINT OF THE ROUND; if you cannot name a compelling reason to open the app on day 14, say so plainly and propose what would provide one.
8. Every risk, every interaction with 2A/2B/2C systems and guards, and the exact save-schema change needed.`, { label: 'design:progression-bible', phase: 'Design', schema: REPORT })

phase('Core')
const c1 = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/progression-bible.md and implement its XP + LEVEL LADDER in core. Designer summary: ${JSON.stringify(design?.summary ?? 'read the bible')}

You own src/core/progression/xp.ts (new), the KeepLevel widening in src/core/keep/index.ts, and the state/reducer/save changes they need. Do NOT touch src/core/progression/{streak,milestones,bounties,mastery,pity,events,multipliers}.ts (2C's, read them to compose), and do NOT touch building effects (a peer agent owns those).

1. Widen \`KeepLevel\` to the bible's ladder. This ripples: content/keep.ts, expedition unlock gating, reachability tagging, grid bounds, save validation. Follow every type error to its home rather than casting.
2. XP: award table from tuning, applied in ONE place (a wrapper like 2C's touchProgressionVisit, so no reducer arm can forget it — and so a unit test dispatching FEED in isolation does not silently gain XP it did not ask for; follow the boundary 2C documented).
3. Level-up: derived-or-stored per the bible; emit a transient outcome the UI can celebrate from (\`lastLevelUp\`), following the lastCareOutcome/lastEvolveOutcome pattern already in state.ts.
4. Expedition unlocks re-spread across the new ladder; core/economy/reachability.test.ts MUST pass for EVERY new tier — run it constantly, it is the deadlock guard that already caught two shipped deadlocks.
5. ONE save-schema bump for the round (coordinate: peers may also need fields — leave a clearly-marked note in your report so the integrator merges into a single version).
6. Tests: XP granted for every action in the award table (loop the table — do not hand-write a few); level-up fires at exact thresholds; the bar-moves-at-every-level property (a single care action at max level still produces a visible XP delta); unlocks gate correctly per tier; migration of a v6 save to the new version preserving Keep level and deriving sane XP.`, { label: 'core:xp-ladder', phase: 'Core', schema: REPORT, model: 'sonnet' })

const c2 = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/progression-bible.md and implement its BUILDING EFFECTS in core. Peer c1 built XP/levels (summary: ${JSON.stringify(c1?.summary ?? 'read src/core/progression/xp.ts')}) — read its code, do not edit it.

You own src/core/keep/effects.ts (new) plus the wiring that makes effects actually apply. Do NOT edit xp.ts or 2C's progression modules.

1. A typed, content-defined effect system: placements → an aggregated KeepEffects value (comfort per need, rest multiplier, expedition duration/loot modifiers, job enablement, set bonuses). Pure, derived from state.keep.placements + the content registry. Caps enforced in the aggregation, not per-item.
2. WIRE IT WHERE IT MATTERS — this is the part that must not become another dead feature: needs decay must consult comfort effects (compose with core/pips/needs.ts's effectiveRates WITHOUT editing that file's ownership — if the seam does not exist, add the smallest possible injectable parameter and say so loudly in your report), rest speed must consult the rest multiplier, expeditions must consult duration/loot modifiers.
3. THE GUARD: src/core/pips/balance.test.ts must still pass. A maximally-built Keep must still need real care — add a test that computes the leave-safe floor WITH every effect maxed and asserts a 24h absence still leaves needs meaningfully below full. If the bible's numbers break this, fix the NUMBERS and report it.
4. Set bonuses: themed groups, detected from placements, capped.
5. Tests: effect aggregation from placements; every cap holds at maximum stacking; decay/rest/expedition paths actually observe the effects (assert through the real reducer, not just the pure function — a wired-up test, because the aggregation existing is not the same as it applying); the maxed-Keep-still-needs-care test above.`, { label: 'core:building-effects', phase: 'Core', schema: REPORT, model: 'sonnet' })

phase('Content')
const content = await agent(`${CONTEXT}

Read /Users/gary/dev/pipskeep/docs/progression-bible.md. Core is built: XP/ladder (${JSON.stringify(c1?.summary ?? 'read core/progression/xp.ts')}), building effects (${JSON.stringify(c2?.summary ?? 'read core/keep/effects.ts')}).

You own src/content/: keep.ts (the 12-tier ladder costs + unlock copy), placeables.ts, decorations.ts (the expanded 35+ catalog with effects, info, icons), tuning.ts's progression/effect numbers, milestones.ts (rewards for the new tiers), and any new content module the bible calls for (e.g. an icon registry). Do NOT touch core/ or ui/.

1. Author the full ladder with escalating resource-bundle costs and the unlock copy for each tier — warm, specific, something to look forward to by name (§15.5 tone).
2. Author the expanded catalog. EVERY item needs: name, concrete effect description with real numbers, footprint, cost, an icon id, and warm flavor. Replace every instance of the vague "the Pips will use this" / "just lovely" copy. Group items into the bible's themed sets.
3. Icon registry: procedural glyph ids from the bible's vocabulary (no deps, no assets).
4. reachability.test.ts must pass for every tier and every placeable — run it constantly. balance.test.ts must pass with the new effect numbers.
5. content/validate.ts must catch new failure modes: an item with an effect referencing an unknown need, an unknown icon id, a set bonus naming a nonexistent item, a tier with no unlock. Extend it and test each.`, { label: 'content:ladder-catalog', phase: 'Content', schema: REPORT, model: 'sonnet' })

phase('UI')
const [u1, u2] = await parallel([
  () => agent(`${CONTEXT}

Read docs/progression-bible.md (especially the XP and milestone-moment sections). Core + content are built.

You own the XP BAR and the CELEBRATION MOMENTS: a new src/ui/xpBar.ts, src/ui/levelUp.ts, src/ui/milestoneCelebration.ts and their own CSS file. Do NOT edit ui.css, modals.css, pipdex.css, topBar.ts, or other agents' modules — export init functions and let the integrator mount them. Round 2G will revise the top bar and OWNS where the XP bar finally lives; build the bar as a self-contained component that can be mounted anywhere, and say so in your report.

1. XP BAR — the owner calls this the major missing lever. Always visible, always moving. Show current level, progress within the level, and (on gain) a satisfying animated fill with the delta floating up. It must feel good for a SINGLE care tap, at every level.
2. LEVEL-UP MOMENT: a real celebration — the new tier's name, what it unlocked (by name, from content), confetti + sound seams. Must not collide with 2C's session sequence: if a level-up happens while the Doorstep or a loot reveal is open, it QUEUES behind them.
3. MILESTONE COMPLETION: 2C's milestones complete quietly and the owner asked for better. A proper moment — the milestone's name, its reward, a celebratory surface. Batched if several land at once (2C batches past two — respect that).
4. THE LAYERING HAZARD: this project has a known stacking-context trap — .pk-phase5's keep bar could not be z-index'd under sheets and had to be HIDDEN instead. src/ui/layers.test.ts pins the ladder. Register your new surfaces in that ladder and verify against every existing overlay (keep bar, sound toggle, debug wrench, toasts, Doorstep, Album, Long Meadow, Today sheet).
5. Pure controllers + dumb DOM; unit-test the models (XP-within-level math incl. the max-level case, level-up queueing behind other surfaces, milestone batching).
6. Verify visually at 375px AND desktop on the dev server (port 5317 is pinned; kill stale vite first). Report what you saw.`, { label: 'ui:xp-celebrations', phase: 'UI', schema: REPORT, model: 'sonnet' }),
  () => agent(`${CONTEXT}

Read docs/progression-bible.md (the item-info and icon sections). Core + content are built.

You own the BUILD/ITEM SURFACES: src/ui/buildSheet.ts, src/ui/buildMode.ts, src/ui/itemsSheet.ts, src/ui/keepUpgrade.ts, plus src/ui/icons.ts (new, the procedural glyph renderer) and its CSS. Do NOT edit xpBar/levelUp/milestoneCelebration (peer agent) or ui.css.

1. ICONS: implement the content icon registry as procedural inline-SVG or CSS glyphs — one renderer, \`renderIcon(iconId)\`, no dependencies, no assets. They must read clearly at build-card size AND in the items satchel.
2. BUILD SHEET: replace the vague "the Pips will use this" / "just lovely" with the real per-item info from content — icon, name, what it DOES with numbers, footprint, cost with affordability, and set-membership ("2 of 3 Shoreline pieces placed"). With a 35+ item catalog this must group by set/category and scroll cleanly at 375px. Affordability and shortfall copy stays warm.
3. KEEP UPGRADE CARD: now a 12-tier ladder — show the next tier's cost and unlock by name, plus a sense of the road ahead (the tier list) without becoming a wall of text.
4. ITEMS SATCHEL: foods/gifts get icons and clearer effect text too.
5. KNOWN BUG TO NOT REINTRODUCE: the keep bar sits in its own stacking context and must be hidden while a sheet is open — buildSheet.ts already does this via \`onOpenChange\`. Preserve it, and keep src/ui/layers.test.ts passing.
6. Pure controllers + dumb DOM; unit-test the models (item info model incl. set progress, affordability/shortfall, tier-ladder model).
7. Verify visually at 375px AND desktop (dev server on 5317, kill stale vite first). Confirm the 35+ item catalog scrolls without the page scrolling sideways — that exact bug was found once before at 375px. Report what you saw.`, { label: 'ui:build-items-icons', phase: 'UI', schema: REPORT, model: 'sonnet' }),
])

phase('Integrate')
const integ = await agent(`${CONTEXT}

All builders finished. design: ${JSON.stringify(design?.summary ?? 'missing')} | xp/ladder: ${JSON.stringify(c1?.summary ?? 'missing')} | effects: ${JSON.stringify(c2?.summary ?? 'missing')} | content: ${JSON.stringify(content?.summary ?? 'missing')} | xp/celebrations UI: ${JSON.stringify(u1?.summary ?? 'missing')} | build/items UI: ${JSON.stringify(u2?.summary ?? 'missing')}

Make it one coherent game:
1. EXACTLY ONE save-schema bump for the whole round (merge if several builders bumped), with migration + fixture, and a test loading a v6 save that lands with its Keep level intact, sane XP, and no lost data.
2. MOUNT EVERYTHING: the XP bar must be visible in the running game (2G will move it later — mount it somewhere sensible now and note where); level-up and milestone celebrations wired and queueing correctly behind the Doorstep and loot reveals; new build sheet live.
3. NO DEAD FEATURES — the round's hard rule. Walk EVERY XP source, EVERY building effect, and EVERY tier unlock and confirm each is (a) applied in core and (b) visible to the player. Report a table: mechanic → where core applies it → where the player sees it. Anything you cannot fill in both columns for is a finding, not a footnote.
4. Full npm test + npm run build green; tsc clean; balance.test.ts, reachability.test.ts and layers.test.ts MUST pass.
5. Browser smoke at 375px AND desktop (restart the dev server first): earn XP from a care action and watch the bar move; use the debug menu to grant resources and buy a tier, confirming the level-up celebration; open the build sheet and confirm icons + real effect info + set progress; place an effect-bearing building and verify via the debug time-skip that its effect actually changes decay; trigger a milestone and see the celebration. Report REAL observed numbers.`, { label: 'integrate', phase: 'Integrate', schema: REPORT })

phase('Verify')
const [gate, gameDesign, mutation] = await parallel([
  () => agent(`Gate runner for /Users/gary/dev/pipskeep round 2F. Run npm test + npm run build YOURSELF and map each requirement to named passing tests, quoting assertions: (1) XP is granted for every action in the award table, proven by a test that LOOPS the table rather than sampling; (2) a single care action produces a visible XP delta at EVERY level incl. max; (3) level-up fires at exact thresholds and emits an outcome the UI consumes; (4) the ~12-tier ladder gates unlocks correctly and reachability.test.ts covers EVERY tier; (5) building effects are observed by the real decay/rest/expedition paths through the REDUCER, not merely by the pure aggregator; (6) every effect cap holds at maximum stacking; (7) a maximally-built Keep still requires real care (balance.test.ts + the new maxed-Keep test); (8) layers.test.ts covers the new surfaces; (9) exactly ONE schema bump with migration + fixture, and a v6 save migrates preserving Keep level. Also: grep for any \`kind: "flair"\`-style promise with no renderer — this codebase has shipped three dead features and the round forbids a fourth. pass=true only on evidence you gathered yourself.`, { label: 'gate-runner', phase: 'Verify', schema: FINDINGS }),
  () => agent(`GAME-DESIGN AUDIT for /Users/gary/dev/pipskeep round 2F. You are judging whether the LOOP is actually good — the owner's goal is a loop worthy of a top store listing, and their fear is "a simple 5 minute game 'oh thats cute' but no solid reason yet to entice players to come back".

Read docs/progression-bible.md, then PLAY THE GAME. Start the dev server (port 5317, kill stale vite first), use the debug menu's time slider and grants to simulate progression, and actually experience: minute 1, minute 5, the end of session 1, a day-2 return, and a simulated week-2 return.

Answer with evidence, naming specific mechanics and real numbers you observed:
(a) Does the XP bar move satisfyingly for a single care tap at low AND high level? Measure it.
(b) At the end of session one, is there a named thing the player is visibly working toward? What is it and how far away?
(c) On a day-2 return, what specifically pulls the player in, and is it visible within 5 seconds of opening?
(d) At simulated week 2, is there still something to chase? Name it. If the answer is "grind the same expeditions", that is a MAJOR finding.
(e) Does building now feel worth doing? Pick three items and say what a player gains and whether the sheet communicates it clearly.
(f) Is any tier of the 12 a dead tier (no headline unlock)? List them.
(g) Do the effects trivialize care? Try a maximally-built Keep with a 24h skip and report the actual needs.
(h) Count taps from cold open to normal play on a day-2 return. More than ~3 is a finding.
Findings for anything that fails to give a reason to return, any dead tier, any mechanic the player cannot perceive, and any place the loop feels like a chore rather than a pleasure. pass=false if (d) has no good answer.`, { label: 'audit:game-design', phase: 'Verify', schema: FINDINGS }),
  () => agent(`Mutation tester for /Users/gary/dev/pipskeep round 2F. Work is UNCOMMITTED — copy each target to the session scratchpad, restore + cmp after EACH cycle, NEVER git-restore. Mutations vs src (never tests): (1) XP award for care actions set to 0 (the bar stops moving on the commonest action); (2) level-up threshold check removed (never levels); (3) a mid-ladder tier's unlock dropped (dead tier ships); (4) comfort effects computed but never consulted by decay (the dead-feature pattern, again); (5) rest-speed effect ignored; (6) expedition duration effect ignored; (7) an effect cap removed so stacking compounds; (8) set-bonus detection always returns empty; (9) the XP delta at max level rounds to zero (bar visually frozen late-game); (10) reachability broken by making a new tier cost a resource only its own unlock provides (the deadlock shape that shipped TWICE — the guard must catch it); (11) milestone celebration never fires; (12) the v6→v7 migration drops Keep level. For each: apply, npm test, record FAILED (good, name the catching test) or SURVIVED (major finding + the missing assertion). Mutations 4/5/6/11 are the most important — they are the dead-feature class this round explicitly forbids. Finish with the suite green and git status showing only legitimate round-2F files.`, { label: 'audit:mutation', phase: 'Verify', schema: FINDINGS }),
])

const all = [gate, gameDesign, mutation].filter(Boolean)
const majors = all.flatMap(r => r.findings).filter(f => f.severity !== 'minor')
const minors = all.flatMap(r => r.findings).filter(f => f.severity === 'minor')

phase('Fix')
let fixReport = null
let regate = null
if (majors.length > 0) {
  fixReport = await agent(`${CONTEXT}

Fix these round-2F findings (majors mandatory, minors if cheap): ${JSON.stringify(majors)} Minors: ${JSON.stringify(minors)}. GAME-DESIGN findings are the POINT of this round and rank equal to correctness: a dead tier, an imperceptible mechanic, or "nothing to chase at week 2" must be fixed by changing the DESIGN (add the unlock, surface the mechanic, add the long-haul goal), not by adjusting a test. End green: npm test + npm run build.`, { label: 'fixer', phase: 'Fix', schema: REPORT })
  regate = await agent(`In /Users/gary/dev/pipskeep: npm test + npm run build, and specifically re-run and NAME balance.test.ts, reachability.test.ts and layers.test.ts. Report real output. pass=true only if fully green and git status shows only legitimate round-2F files.`, { label: 're-gate', phase: 'Fix', schema: FINDINGS })
} else {
  log('No blocker/major findings — round 2F verified clean')
}

return {
  bible: design?.summary,
  xpLadder: c1?.summary,
  effects: c2?.summary,
  content: content?.summary,
  xpUi: u1?.summary,
  buildUi: u2?.summary,
  integration: integ?.summary,
  loopVerdict: gameDesign?.notes,
  decisions: [design, c1, c2, content, u1, u2, integ].filter(Boolean).flatMap(x => x.decisions ?? []),
  gatePass: (regate ?? gate)?.pass ?? false,
  majorsFixed: majors,
  minorsOutstanding: minors,
  fixReport: fixReport?.summary ?? null,
}